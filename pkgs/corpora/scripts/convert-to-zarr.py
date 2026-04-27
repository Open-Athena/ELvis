#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pymatgen>=2025.1",
#     "zarr>=2.18,<3",
#     "numcodecs>=0.13",
#     "numpy>=2.0",
#     "click>=8.1",
#     "boto3>=1.35",
# ]
# ///
"""Convert a CHGCAR to a multi-resolution Zarr store with chunked, zstd-compressed
voxel data and OME-NGFF-style multiscales metadata. Designed for progressive
loading in the browser via zarrita.js: clients can fetch a small coarse level
(KB) for instant render, then refine on demand.

Usage:
  convert-to-zarr.py path/to/mp-XXX.CHGCAR [--s3 s3://bucket/prefix/]

  Writes:
    <out_dir>/<material_id>-<role>.zarr/

The lattice is non-orthogonal in general; OME-NGFF coordinate transforms
assume orthogonal axes, so we put the full 3x3 lattice matrix and the atom
list in a custom `elvis` metadata namespace.
"""
from __future__ import annotations

import re
import sys
from functools import partial
from pathlib import Path

import click

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _zarr_lib import convert_chgcar  # noqa: E402

err = partial(print, file=sys.stderr)


@click.command()
@click.option('-c', '--chunk', type=int, default=32, show_default=True, help='Target chunk size per axis')
@click.option('-l', '--levels', type=int, default=4, show_default=True, help='Pyramid levels (0=full, +N downsampled)')
@click.option('-o', '--out-dir', type=click.Path(path_type=Path), default='out/zarr', show_default=True)
@click.option('-s', '--s3-prefix', default=None, help='Upload under this s3://bucket/prefix/ after generating')
@click.option('-f', '--force', is_flag=True, help='Overwrite existing store')
@click.option('-r', '--role', type=click.Choice(['label', 'input', 'auto']), default='auto', show_default=True,
              help="Tag store with role: 'auto' parses 'input'/'label' from path, defaults to 'label'")
@click.argument('chgcar_path', type=click.Path(exists=True, path_type=Path))
def main(chgcar_path: Path, out_dir: Path, chunk: int, levels: int, s3_prefix: str | None, force: bool, role: str):
    mat_match = re.search(r'(mp-\d+)', chgcar_path.name)
    if not mat_match:
        raise click.ClickException(f'No mp-XXX ID in filename {chgcar_path.name!r}')
    mat_id = mat_match.group(1)

    if role == 'auto':
        parts = {p.lower() for p in chgcar_path.parts}
        role = 'input' if ('input' in parts or 'data' in parts) else 'label'

    err(f'[{mat_id}/{role}] loading {chgcar_path}')
    out_path = out_dir / f'{mat_id}-{role}.zarr'
    info = convert_chgcar(chgcar_path, out_path, mat_id, role, chunk=chunk, levels=levels, overwrite=force)
    err(f'[{mat_id}/{role}] grid {tuple(info["shape"])}, '
        f'min={info["min"]:.4f}, max={info["max"]:.4f}, mean={info["mean"]:.4f}, '
        f'volume={info["lattice_volume"]:.2f} A^3')
    err(f'[{mat_id}/{role}] pyramid: {info["pyramid_shapes"]}')
    err(f'[{mat_id}/{role}] wrote {out_path} ({info["total_bytes"] / 1024:.1f} KB total)')

    if s3_prefix:
        upload_to_s3(out_path, s3_prefix, mat_id, role)


def upload_to_s3(local_dir: Path, s3_prefix: str, mat_id: str, role: str) -> None:
    import boto3
    from urllib.parse import urlparse
    parsed = urlparse(s3_prefix)
    if parsed.scheme != 's3':
        raise click.ClickException(f'--s3 must be s3://bucket/prefix/: got {s3_prefix!r}')
    bucket = parsed.netloc
    key_prefix = parsed.path.lstrip('/')
    if not key_prefix.endswith('/'):
        key_prefix += '/'

    s3 = boto3.client('s3')
    n = 0
    for p in local_dir.rglob('*'):
        if not p.is_file():
            continue
        rel = p.relative_to(local_dir)
        key = f'{key_prefix}{mat_id}-{role}.zarr/{rel.as_posix()}'
        ctype = 'application/json' if p.name.startswith('.z') else 'application/octet-stream'
        s3.upload_file(str(p), bucket, key, ExtraArgs={'ContentType': ctype})
        n += 1
    err(f'[{mat_id}/{role}] uploaded {n} files to s3://{bucket}/{key_prefix}{mat_id}-{role}.zarr/')


if __name__ == '__main__':
    main()
