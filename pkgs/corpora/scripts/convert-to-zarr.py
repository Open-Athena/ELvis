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
    <out_dir>/<material_id>.zarr/
      .zgroup
      .zattrs               # multiscales + lattice + atoms + density stats + quantile table
      0/  .zarray  chunks/  # full resolution
      1/  .zarray  chunks/  # 2x downsampled
      2/  ...               # 4x
      3/  ...               # 8x

The lattice is non-orthogonal in general; OME-NGFF coordinate transforms
assume orthogonal axes, so we put the full 3x3 lattice matrix and the atom
list in a custom `elvis` metadata namespace. Other Zarr-aware tools can still
open the pyramid via `multiscales`; only ELvis uses the lattice for rendering.
"""
from __future__ import annotations

import json
import re
import sys
from functools import partial
from pathlib import Path

import click
import numpy as np
import zarr
from numcodecs import Zstd
from pymatgen.io.vasp import Chgcar

err = partial(print, file=sys.stderr)


def downsample_2x(arr: np.ndarray) -> np.ndarray:
    """Block-mean downsample by 2 in each dim. Crops trailing odd voxel."""
    nx, ny, nz = arr.shape
    nx2, ny2, nz2 = nx - (nx % 2), ny - (ny % 2), nz - (nz % 2)
    cropped = arr[:nx2, :ny2, :nz2]
    return cropped.reshape(nx2 // 2, 2, ny2 // 2, 2, nz2 // 2, 2).mean(axis=(1, 3, 5))


def build_pyramid(grid: np.ndarray, n_levels: int) -> list[np.ndarray]:
    """Return [level0, level1, ...]; each level is 2x downsampled from the previous."""
    levels = [grid]
    for _ in range(n_levels - 1):
        nxt = downsample_2x(levels[-1])
        if min(nxt.shape) < 2:
            break
        levels.append(nxt)
    return levels


def chunk_shape(grid_shape: tuple[int, ...], target: int = 32) -> tuple[int, ...]:
    """Chunk = min(target, dim) per axis; small grids get a single chunk."""
    return tuple(min(target, d) for d in grid_shape)


def compute_quantile_table(grid: np.ndarray, n: int = 201, sample_cap: int = 50_000) -> np.ndarray:
    """Match the client-side quantile table: n equally-spaced quantiles from a
    random subsample, used to map iso-slider position [0..1] to density."""
    flat = grid.ravel()
    if flat.size > sample_cap:
        rng = np.random.default_rng(0)
        sample = rng.choice(flat, size=sample_cap, replace=False)
    else:
        sample = flat
    qs = np.linspace(0, 1, n)
    return np.quantile(sample, qs).astype(np.float32)


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
        if 'input' in parts or 'data' in parts:
            role = 'input'
        else:
            role = 'label'

    err(f'[{mat_id}/{role}] loading {chgcar_path}')
    chg = Chgcar.from_file(str(chgcar_path))
    grid = np.asarray(chg.data['total'], dtype=np.float32)
    lattice = np.asarray(chg.structure.lattice.matrix, dtype=np.float64)
    err(f'[{mat_id}/{role}] grid {grid.shape}, '
        f'min={grid.min():.4f}, max={grid.max():.4f}, mean={grid.mean():.4f}, '
        f'lattice volume={chg.structure.lattice.volume:.2f} A^3')

    pyramid = build_pyramid(grid, levels)
    err(f'[{mat_id}/{role}] pyramid: {[lvl.shape for lvl in pyramid]}')

    out_path = out_dir / f'{mat_id}-{role}.zarr'
    if out_path.exists():
        if not force:
            raise click.ClickException(f'{out_path} exists; pass --force to overwrite')
        import shutil
        shutil.rmtree(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    store = zarr.DirectoryStore(str(out_path))
    root = zarr.group(store=store, overwrite=True)
    compressor = Zstd(level=5)

    datasets_meta = []
    for i, lvl in enumerate(pyramid):
        chunks = chunk_shape(lvl.shape, target=chunk)
        z = root.create_dataset(
            str(i), shape=lvl.shape, chunks=chunks, dtype='float32',
            compressor=compressor, overwrite=True,
        )
        z[:] = lvl
        # Each level is 2^i times coarser; OME-NGFF scale is in source-coordinate units
        scale = float(2 ** i)
        datasets_meta.append({
            'path': str(i),
            'coordinateTransformations': [{'type': 'scale', 'scale': [scale, scale, scale]}],
        })

    atoms = [
        {
            'element': site.specie.symbol,
            'frac': [float(x) for x in site.frac_coords],
        }
        for site in chg.structure.sites
    ]
    quantiles = compute_quantile_table(grid)

    root.attrs.put({
        'multiscales': [{
            'version': '0.4',
            'name': 'density',
            'axes': [
                {'name': 'a', 'type': 'space'},
                {'name': 'b', 'type': 'space'},
                {'name': 'c', 'type': 'space'},
            ],
            'datasets': datasets_meta,
        }],
        'elvis': {
            'material_id': mat_id,
            'role': role,
            'lattice': lattice.tolist(),
            'atoms': atoms,
            'stats': {
                'min': float(grid.min()),
                'max': float(grid.max()),
                'mean': float(grid.mean()),
            },
            'quantiles': quantiles.tolist(),
        },
    })

    total_bytes = sum(p.stat().st_size for p in out_path.rglob('*') if p.is_file())
    err(f'[{mat_id}/{role}] wrote {out_path} ({total_bytes / 1024:.1f} KB total)')

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
