"""Core CHGCAR → multi-resolution Zarr conversion logic, shared between
`convert-to-zarr.py` (single-file CLI) and `modal_zarr.py` (parallel batch).
"""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import zarr
from numcodecs import Zstd
from pymatgen.io.vasp import Chgcar


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


def convert_chgcar(
    chgcar_path: str | Path,
    out_path: str | Path,
    material_id: str,
    role: str,
    chunk: int = 32,
    levels: int = 4,
    overwrite: bool = False,
) -> dict:
    """Convert a CHGCAR file to a multi-resolution Zarr store.

    Returns a dict with `shape`, `lattice_volume`, `min`, `max`, `mean`,
    `pyramid_shapes`, `total_bytes` for caller logging.
    """
    out_path = Path(out_path)
    if out_path.exists():
        if not overwrite:
            raise FileExistsError(f'{out_path} exists; pass overwrite=True')
        shutil.rmtree(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    chg = Chgcar.from_file(str(chgcar_path))
    grid = np.asarray(chg.data['total'], dtype=np.float32)
    lattice = np.asarray(chg.structure.lattice.matrix, dtype=np.float64)
    pyramid = build_pyramid(grid, levels)

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
            'material_id': material_id,
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
    return {
        'shape': list(grid.shape),
        'lattice_volume': float(chg.structure.lattice.volume),
        'min': float(grid.min()),
        'max': float(grid.max()),
        'mean': float(grid.mean()),
        'pyramid_shapes': [list(lvl.shape) for lvl in pyramid],
        'total_bytes': total_bytes,
    }
