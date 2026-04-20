#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pymatgen>=2025.1",
#     "scikit-image>=0.24",
#     "trimesh>=4.5",
#     "numpy>=2.0",
#     "click>=8.1",
#     "boto3>=1.35",
# ]
# ///
"""Pre-compute GLB-encoded isosurface meshes for a CHGCAR at several quantile
iso-levels. Output meshes are tiny (~50-200 KB each) and load instantly in the
browser via Three.js GLTFLoader, bypassing the download-and-march-cubes step.

Usage:
  generate-glb.py path/to/mp-XXX.CHGCAR [--s3 s3://bucket/prefix/]

  Writes:
    <out_dir>/<material_id>/<quantile>.glb
  e.g.
    out/mp-1000020/0.50.glb  (512 KB)
    out/mp-1000020/0.75.glb  (300 KB)
    out/mp-1000020/0.90.glb  (190 KB)
    out/mp-1000020/0.95.glb  (140 KB)
    out/mp-1000020/0.99.glb  (80 KB)

Iso-level quantiles default to [.50, .75, .90, .95, .99] — same range the
ELvis iso-slider covers, matching the client-side quantile mapping.
"""
from __future__ import annotations

import re
import sys
from functools import partial
from pathlib import Path

import click
import numpy as np
import trimesh
from pymatgen.io.vasp import Chgcar
from skimage import measure

err = partial(print, file=sys.stderr)


def iso_from_quantile(data: np.ndarray, q: float) -> float:
    flat = data.ravel()
    return float(np.quantile(flat, q))


def extract_mesh(grid: np.ndarray, iso: float, lattice: np.ndarray) -> trimesh.Trimesh | None:
    """Run marching cubes and convert fractional → Cartesian coordinates."""
    try:
        verts, faces, normals, _ = measure.marching_cubes(grid, level=iso, allow_degenerate=False)
    except (ValueError, RuntimeError) as e:
        err(f'  marching_cubes failed at iso={iso:.3f}: {e}')
        return None
    if len(verts) == 0:
        return None
    # `verts` is in voxel index space; normalize to fractional [0, 1]
    dims = np.array(grid.shape, dtype=np.float64)
    frac = verts / (dims - 1)
    # Fractional → Cartesian
    cart = frac @ lattice
    return trimesh.Trimesh(vertices=cart, faces=faces, vertex_normals=normals, process=False)


@click.command()
@click.option('-o', '--out-dir', type=click.Path(path_type=Path), default='out/glb', show_default=True)
@click.option('-q', '--quantiles', default='0.50,0.75,0.90,0.95,0.99', help='Comma-separated iso quantiles')
@click.option('-s', '--s3-prefix', default=None, help='Upload under this s3://bucket/prefix/ after generating')
@click.option('-f', '--force', is_flag=True, help='Overwrite existing files')
@click.argument('chgcar_path', type=click.Path(exists=True, path_type=Path))
def main(chgcar_path: Path, out_dir: Path, quantiles: str, s3_prefix: str | None, force: bool):
    mat_match = re.search(r'(mp-\d+)', chgcar_path.name)
    if not mat_match:
        raise click.ClickException(f'No mp-XXX ID in filename {chgcar_path.name!r}')
    mat_id = mat_match.group(1)

    qs = [float(x) for x in quantiles.split(',')]
    err(f'[{mat_id}] loading {chgcar_path}')
    chg = Chgcar.from_file(str(chgcar_path))
    grid = chg.data['total']
    lattice = chg.structure.lattice.matrix  # 3x3, rows = a/b/c vectors
    err(f'[{mat_id}] grid {grid.shape}, min={grid.min():.3f}, max={grid.max():.3f}, lattice volume={chg.structure.lattice.volume:.2f} A^3')

    out_mat_dir = out_dir / mat_id
    out_mat_dir.mkdir(parents=True, exist_ok=True)

    uploaded = []
    for q in qs:
        out_path = out_mat_dir / f'{q:.2f}.glb'
        if out_path.exists() and not force:
            err(f'  q={q:.2f}: exists, skipping ({out_path})')
            continue
        iso = iso_from_quantile(grid, q)
        err(f'  q={q:.2f} → iso={iso:.3f}, extracting mesh...')
        mesh = extract_mesh(grid, iso, lattice)
        if mesh is None:
            err(f'  q={q:.2f}: empty mesh, skipping')
            continue
        mesh.export(str(out_path), file_type='glb')
        size_kb = out_path.stat().st_size / 1024
        err(f'  q={q:.2f}: wrote {out_path} ({size_kb:.1f} KB, {len(mesh.faces)} triangles)')
        uploaded.append(out_path)

    if s3_prefix and uploaded:
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
        for p in uploaded:
            key = f'{key_prefix}{mat_id}/{p.name}'
            s3.upload_file(str(p), bucket, key, ExtraArgs={'ContentType': 'model/gltf-binary'})
            err(f'  uploaded s3://{bucket}/{key}')


if __name__ == '__main__':
    main()
