#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "mp-api>=0.45",
#     "click>=8.1",
# ]
# ///
"""Build the unified materials manifest for ELvis.

Joins:
  - ElectrAI S3 filelists (task IDs per dataset)         [data/filelists/*.txt]
  - della task_id → material_id mapping                  [data/della/task_id_to_material_id.json.gz]
  - MP API summary metadata                              (fetched here via mp-api)
  - ElectrAI dataset paired-availability flags           (from input/label filelists)

Writes:
  - data/materials.json   (primary index, one record per material_id)
  - data/datasets.json    (corpus metadata: count, source, paired, license, ...)

Idempotent: MP metadata responses are cached under `tmp/mp-cache/` so
reruns are cheap.

Requires MP_API_KEY in the environment.
"""
from __future__ import annotations

import gzip
import json
import os
import sys
from datetime import datetime, timezone
from functools import partial
from pathlib import Path

import click
from mp_api.client import MPRester

err = partial(print, file=sys.stderr)
HERE = Path(__file__).resolve().parent
PKG = HERE.parent
DATA = PKG / 'data'

FIELDS = [
    'material_id',
    'formula_pretty',
    'elements',
    'chemsys',
    'nsites',
    'nelements',
    'symmetry',
    'density',
    'volume',
    'band_gap',
    'is_metal',
    'is_magnetic',
    'ordering',
    'theoretical',
]

CORPORA = {
    'electrai-205': {
        'source': 's3://openathena/electrai/{input,label}/',
        'format': 'CHGCAR',
        'paired': True,
        'description': 'ElectrAI paired SAD input + DFT label (original 205-sample set).',
        'license': 'MP: CC BY 4.0',
    },
    'dataset_4': {
        'source': 's3://openathena/electrai/mp/chg_datasets/dataset_4/{data,label}/',
        'format': 'CHGCAR',
        'paired': True,
        'grid': [128, 128, 128],
        'description': 'ElectrAI 2885-sample uniform-grid set (derived from MP dataset_4 via GGA DFT).',
        'license': 'MP: CC BY 4.0',
    },
}


def read_ids(path: Path) -> set[str]:
    return {ln.strip() for ln in path.read_text().splitlines() if ln.strip()}


def load_task_to_mat() -> dict[str, str]:
    path = DATA / 'della' / 'task_id_to_material_id.json.gz'
    if not path.exists():
        raise click.ClickException(f'Missing {path}; run scripts/fetch-della-metadata.sh first')
    with gzip.open(path, 'rt') as f:
        return json.load(f)


def serialize_doc(doc) -> dict:
    sym = doc.symmetry
    return {
        'id': str(doc.material_id),
        'formula': doc.formula_pretty,
        'elements': sorted(str(el) for el in doc.elements),
        'chemsys': doc.chemsys,
        'nsites': doc.nsites,
        'nelements': doc.nelements,
        'crystal_system': str(sym.crystal_system) if sym else None,
        'spacegroup_symbol': sym.symbol if sym else None,
        'spacegroup_number': sym.number if sym else None,
        'density': round(doc.density, 3) if doc.density is not None else None,
        'volume': round(doc.volume, 3) if doc.volume is not None else None,
        'band_gap': round(doc.band_gap, 4) if doc.band_gap is not None else None,
        'is_metal': doc.is_metal,
        'is_magnetic': doc.is_magnetic,
        'ordering': doc.ordering,
        'theoretical': doc.theoretical,
    }


def fetch_mp_metadata(material_ids: list[str], chunk_size: int, cache_dir: Path) -> dict[str, dict]:
    """Fetch summary docs for material_ids, caching per chunk."""
    api_key = os.environ.get('MP_API_KEY')
    if not api_key:
        raise click.ClickException('MP_API_KEY env var not set')

    cache_dir.mkdir(parents=True, exist_ok=True)
    records: dict[str, dict] = {}

    sorted_ids = sorted(set(material_ids))
    with MPRester(api_key) as mpr:
        for start in range(0, len(sorted_ids), chunk_size):
            batch = sorted_ids[start:start + chunk_size]
            key = f'{start:06d}-{start + len(batch):06d}-{len(sorted_ids)}.json'
            cache_path = cache_dir / key
            if cache_path.exists():
                err(f'  cached {key}')
                batch_recs = json.loads(cache_path.read_text())
            else:
                err(f'  fetching {start + 1}-{start + len(batch)} / {len(sorted_ids)}...')
                docs = mpr.materials.summary.search(material_ids=batch, fields=FIELDS)
                batch_recs = [serialize_doc(d) for d in docs]
                cache_path.write_text(json.dumps(batch_recs))
            for r in batch_recs:
                records[r['id']] = r
    return records


@click.command()
@click.option('-c', '--chunk-size', default=500, show_default=True, help='MP API batch size')
@click.option('-C', '--cache-dir', type=click.Path(path_type=Path), default=PKG.parent.parent / 'tmp' / 'mp-cache', help='Per-chunk cache dir (avoids re-fetching)')
@click.option('-f', '--force', is_flag=True, help='Overwrite cache (force refetch from MP API)')
def main(chunk_size: int, cache_dir: Path, force: bool):
    filelists_dir = DATA / 'filelists'
    if not filelists_dir.exists():
        raise click.ClickException(f'Missing {filelists_dir}; run scripts/fetch-electrai-filelists.sh first')

    # Read per-dataset S3 listings
    ds_205_input = read_ids(filelists_dir / 'electrai-205-input.txt')
    ds_205_label = read_ids(filelists_dir / 'electrai-205-label.txt')
    ds_4_data = read_ids(filelists_dir / 'dataset_4-data.txt')
    ds_4_label = read_ids(filelists_dir / 'dataset_4-label.txt')

    electrai_205 = ds_205_input | ds_205_label
    dataset_4 = ds_4_data | ds_4_label
    err(f'electrai-205: {len(electrai_205)} task IDs ({len(ds_205_input)} input, {len(ds_205_label)} label)')
    err(f'dataset_4:    {len(dataset_4)} task IDs ({len(ds_4_data)} data, {len(ds_4_label)} label)')

    all_tasks = sorted(electrai_205 | dataset_4)
    err(f'Union: {len(all_tasks)} unique task IDs')

    # Map task IDs → material IDs via della mapping
    task2mat = load_task_to_mat()
    missing_tasks = [t for t in all_tasks if t not in task2mat]
    if missing_tasks:
        err(f'WARN: {len(missing_tasks)} task IDs have no material-ID mapping (skipping): {missing_tasks[:5]}')
    material_ids = sorted({task2mat[t] for t in all_tasks if t in task2mat})
    err(f'Mapped to {len(material_ids)} unique material IDs')

    # Fetch MP metadata (cached)
    if force and cache_dir.exists():
        import shutil
        shutil.rmtree(cache_dir)
    err(f'Fetching MP metadata (cache={cache_dir}):')
    mp_records = fetch_mp_metadata(material_ids, chunk_size, cache_dir)
    err(f'Got MP records for {len(mp_records)} / {len(material_ids)} material IDs')

    missing_mp = set(material_ids) - set(mp_records)
    if missing_mp:
        err(f'WARN: {len(missing_mp)} material IDs missing from MP API: {sorted(missing_mp)[:5]}')

    # Build per-material dataset membership
    # Record: material_id → dataset_label → { task_ids, has_input, has_label }
    membership: dict[str, dict[str, dict]] = {}

    def add(tasks: set[str], label: str, role: str):
        for t in tasks:
            mid = task2mat.get(t)
            if mid is None:
                continue
            ds = membership.setdefault(mid, {}).setdefault(label, {'task_ids': set()})
            ds['task_ids'].add(t)
            if role == 'input':
                ds['has_input'] = True
            elif role == 'label':
                ds['has_label'] = True

    add(ds_205_input, 'electrai-205', 'input')
    add(ds_205_label, 'electrai-205', 'label')
    add(ds_4_data, 'dataset_4', 'input')
    add(ds_4_label, 'dataset_4', 'label')

    # Attach membership to MP records; materialize sets → sorted lists
    out_records: list[dict] = []
    for mid in material_ids:
        rec = mp_records.get(mid)
        if rec is None:
            continue
        rec = dict(rec)
        ds_block: dict[str, dict] = {}
        for label, info in membership.get(mid, {}).items():
            ds_block[label] = {
                'task_ids': sorted(info['task_ids']),
                'has_input': info.get('has_input', False),
                'has_label': info.get('has_label', False),
            }
        rec['datasets'] = ds_block
        out_records.append(rec)

    out_records.sort(key=lambda r: r['id'])

    # Dataset counts reflect actual membership
    corpora_out = {}
    for label, meta in CORPORA.items():
        n = sum(1 for r in out_records if label in r['datasets'])
        corpora_out[label] = {**meta, 'count': n}

    manifest = {
        'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'schema_version': 1,
        'corpora': corpora_out,
        'records': out_records,
    }

    DATA.mkdir(parents=True, exist_ok=True)
    materials_path = DATA / 'materials.json'
    datasets_path = DATA / 'datasets.json'
    materials_path.write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
    datasets_path.write_text(json.dumps(corpora_out, indent=2) + '\n')

    err(f'Wrote {len(out_records)} records to {materials_path} ({materials_path.stat().st_size / 1024:.1f} KB)')
    err(f'Wrote {datasets_path}')


if __name__ == '__main__':
    main()
