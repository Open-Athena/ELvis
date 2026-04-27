#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["modal>=0.66"]
# ///
"""Modal app for parallel CHGCAR -> multi-resolution Zarr conversion.

Runs `_zarr_lib.convert_chgcar` across many materials concurrently. Each
container fetches one CHGCAR from S3, converts to Zarr, uploads back to S3,
and returns stats. Saturates ~100 workers in seconds.

Uses Modal secret `aws-credentials` (must contain AWS_ACCESS_KEY_ID +
AWS_SECRET_ACCESS_KEY for an IAM user with R/W on the openathena bucket).

Run:
  modal run pkgs/corpora/scripts/modal_zarr.py \\
      --filelist=pkgs/corpora/data/filelists/electrai-205-label.txt \\
      --src-prefix=s3://openathena/electrai/label/ \\
      --dst-prefix=s3://openathena/electrai/zarr/ \\
      --role=label

Pass --skip-existing to skip materials whose dst already exists in S3.
Pass --limit=N to process only the first N IDs (for smoke testing).
"""
from __future__ import annotations

from pathlib import Path

import modal

SCRIPTS_DIR = Path(__file__).resolve().parent

image = (
    modal.Image.debian_slim(python_version='3.11')
    .pip_install([
        'pymatgen>=2025.1',
        'zarr>=2.18,<3',
        'numcodecs>=0.13',
        'numpy>=2.0',
        'boto3>=1.35',
    ])
    .add_local_file(str(SCRIPTS_DIR / '_zarr_lib.py'), '/root/_zarr_lib.py')
)

app = modal.App('elvis-zarr-etl', image=image)
aws_secret = modal.Secret.from_name('aws-credentials')


@app.function(
    secrets=[aws_secret],
    cpu=2,
    memory=2048,
    timeout=600,
    retries=modal.Retries(max_retries=2, backoff_coefficient=2.0),
)
def convert_one(
    material_id: str,
    src_prefix: str,
    dst_prefix: str,
    role: str,
    skip_existing: bool = False,
) -> dict:
    """Download one CHGCAR, convert to Zarr, upload result. Returns stats."""
    import sys
    import tempfile
    import time
    from pathlib import Path
    from urllib.parse import urlparse

    import boto3
    from botocore.exceptions import ClientError

    sys.path.insert(0, '/root')
    from _zarr_lib import convert_chgcar  # type: ignore

    def parse_s3(uri: str) -> tuple[str, str]:
        u = urlparse(uri.rstrip('/') + '/')
        return u.netloc, u.path.lstrip('/')

    src_bucket, src_key_prefix = parse_s3(src_prefix)
    dst_bucket, dst_key_prefix = parse_s3(dst_prefix)
    dst_dir_key = f'{dst_key_prefix}{material_id}-{role}.zarr/'

    s3 = boto3.client('s3')

    if skip_existing:
        resp = s3.list_objects_v2(Bucket=dst_bucket, Prefix=f'{dst_dir_key}.zattrs', MaxKeys=1)
        if resp.get('KeyCount', 0) > 0:
            return {'id': material_id, 'role': role, 'status': 'skipped'}

    t0 = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        chgcar_path = tmpdir / f'{material_id}.CHGCAR'
        zarr_path = tmpdir / f'{material_id}-{role}.zarr'
        try:
            s3.download_file(src_bucket, f'{src_key_prefix}{material_id}.CHGCAR', str(chgcar_path))
        except ClientError as e:
            return {'id': material_id, 'role': role, 'status': 'download-failed', 'error': str(e)}

        try:
            info = convert_chgcar(chgcar_path, zarr_path, material_id, role, overwrite=True)
        except Exception as e:
            return {'id': material_id, 'role': role, 'status': 'convert-failed', 'error': str(e)}

        n = 0
        for p in zarr_path.rglob('*'):
            if not p.is_file():
                continue
            rel = p.relative_to(zarr_path)
            key = f'{dst_dir_key}{rel.as_posix()}'
            ctype = 'application/json' if p.name.startswith('.z') else 'application/octet-stream'
            s3.upload_file(str(p), dst_bucket, key, ExtraArgs={'ContentType': ctype})
            n += 1

    return {
        'id': material_id,
        'role': role,
        'status': 'ok',
        'shape': info['shape'],
        'bytes': info['total_bytes'],
        'files': n,
        'seconds': round(time.time() - t0, 1),
    }


@app.local_entrypoint()
def main(
    filelist: str,
    src_prefix: str,
    dst_prefix: str,
    role: str = 'label',
    limit: int = 0,
    skip_existing: bool = False,
):
    """Driver: read filelist locally, fan out to remote convert_one workers."""
    ids = [line.strip() for line in Path(filelist).read_text().splitlines() if line.strip()]
    if limit > 0:
        ids = ids[:limit]
    print(f'Processing {len(ids)} IDs (role={role}) from {filelist}')

    args = [(mid, src_prefix, dst_prefix, role, skip_existing) for mid in ids]
    n_ok = n_skip = n_fail = 0
    total_bytes = 0
    for r in convert_one.starmap(args, return_exceptions=True):
        if isinstance(r, Exception):
            print(f'  EXCEPTION: {r}')
            n_fail += 1
            continue
        status = r['status']
        if status == 'ok':
            n_ok += 1
            total_bytes += r['bytes']
            print(f"  [{r['id']}/{r['role']}] {r['shape']} -> {r['bytes']/1024:.0f} KB ({r['files']} files, {r['seconds']}s)")
        elif status == 'skipped':
            n_skip += 1
            print(f"  [{r['id']}/{r['role']}] skipped (exists)")
        else:
            n_fail += 1
            print(f"  [{r['id']}/{r['role']}] FAILED: {status}: {r.get('error', '')}")

    print(f'\n{n_ok} ok, {n_skip} skipped, {n_fail} failed; {total_bytes/1024/1024:.1f} MB total')
