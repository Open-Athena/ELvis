import * as zarr from 'zarrita'
import type { LatticeMatrix, VolumeData } from '../types.ts'

/** OME-NGFF + ELvis-custom metadata captured by `convert-to-zarr.py`. */
export interface ZarrVolumeMetadata {
  multiscales: {
    name: string
    version: string
    axes: { name: string; type: string }[]
    datasets: { path: string; coordinateTransformations: { type: string; scale: number[] }[] }[]
  }[]
  elvis: {
    material_id: string
    role: 'input' | 'label'
    /** 3x3 lattice matrix, rows = a/b/c vectors */
    lattice: number[][]
    atoms: { element: string; frac: [number, number, number] }[]
    stats: { min: number; max: number; mean: number }
    /** 201 equally-spaced quantiles, sampled from the full grid; matches client convention. */
    quantiles: number[]
  }
}

export interface OpenedZarrVolume {
  url: string
  meta: ZarrVolumeMetadata
  /** Number of pyramid levels; level 0 is full resolution. */
  levels: number
  /** Per-level shape from each level's .zarray, ordered [level0, level1, ...]. */
  levelShapes: [number, number, number][]
}

/**
 * S3 returns 403 (not 404) for missing keys when the IAM lacks `s3:ListBucket`.
 * zarrita's FetchStore expects 404 to signal "missing key" — so we wrap fetch
 * to remap 403 responses to a synthetic 404. Harmless: real auth failures on
 * private objects still surface as 404 ("not found"), which zarrita interprets
 * correctly, and the response body for the original 403 isn't useful anyway.
 */
function fetchWithS3MissingKeyShim(request: Request): Promise<Response> {
  return fetch(request).then(r => r.status === 403 ? new Response(null, { status: 404 }) : r)
}

/** Open a multi-resolution Zarr store and read its metadata + per-level shapes.
 *  v3-only: tomat-produced GT + pred zarrs and the electrai-205 R2 mirror are v3. */
export async function openZarrVolume(url: string): Promise<OpenedZarrVolume> {
  const store = new zarr.FetchStore(url, { fetch: fetchWithS3MissingKeyShim })
  const root = await zarr.open.v3(store, { kind: 'group' })
  const meta = root.attrs as unknown as ZarrVolumeMetadata
  const levels = meta.multiscales[0].datasets.length
  const levelShapes: [number, number, number][] = []
  for (let i = 0; i < levels; i++) {
    const arr = await zarr.open.v3(root.resolve(String(i)), { kind: 'array' })
    levelShapes.push(arr.shape as [number, number, number])
  }
  return { url, meta, levels, levelShapes }
}

/** Read one pyramid level into a flat Float32Array. */
export async function readZarrLevel(
  opened: OpenedZarrVolume,
  level: number,
): Promise<{ data: Float32Array; dims: [number, number, number] }> {
  const store = new zarr.FetchStore(opened.url, { fetch: fetchWithS3MissingKeyShim })
  const root = await zarr.open.v3(store, { kind: 'group' })
  const arr = await zarr.open.v3(root.resolve(String(level)), { kind: 'array' })
  const result = await zarr.get(arr)
  // zarrita returns C-ordered raw bytes; pymatgen->Zarr writes in C-order too.
  // VASP/marching-cubes expects F-order (flat[i + j*Nx + k*Nx*Ny] = data[i,j,k]).
  const dims = arr.shape as [number, number, number]
  const data = transposeToFortran(result.data as Float32Array, dims)
  return { data, dims }
}

/** Convert a C-ordered (Nx,Ny,Nz) flat array to F-ordered: flat[i + j*Nx + k*Nx*Ny] = a[i,j,k]. */
function transposeToFortran(c: Float32Array, dims: [number, number, number]): Float32Array {
  const [nx, ny, nz] = dims
  const f = new Float32Array(c.length)
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const cBase = (i * ny + j) * nz
      for (let k = 0; k < nz; k++) {
        f[i + j * nx + k * nx * ny] = c[cBase + k]
      }
    }
  }
  return f
}

/** Convert ELvis Zarr metadata + level data into the existing VolumeData shape. */
export function zarrToVolumeData(
  opened: OpenedZarrVolume,
  level: { data: Float32Array; dims: [number, number, number] },
): VolumeData {
  const { meta } = opened
  const m = meta.elvis.lattice
  const lattice: LatticeMatrix = [
    m[0][0], m[0][1], m[0][2],
    m[1][0], m[1][1], m[1][2],
    m[2][0], m[2][1], m[2][2],
  ]
  const counts = new Map<string, number>()
  for (const a of meta.elvis.atoms) counts.set(a.element, (counts.get(a.element) ?? 0) + 1)
  const elements = Array.from(counts.keys())
  return {
    title: `${meta.elvis.material_id}/${meta.elvis.role}`,
    scaleFactor: 1.0,
    lattice,
    structure: {
      elements,
      counts: elements.map((e) => counts.get(e)!),
      atoms: meta.elvis.atoms.map((a) => ({ element: a.element, fracCoords: a.frac })),
    },
    grid: { dims: level.dims, data: level.data },
  }
}

/** Convenience: open + read level 0 + assemble VolumeData in one call. */
export async function fetchZarrVolume(url: string, level = 0): Promise<VolumeData> {
  const opened = await openZarrVolume(url)
  const lvl = await readZarrLevel(opened, level)
  return zarrToVolumeData(opened, lvl)
}

/** Pick a coarse + fine level for progressive loading.
 *
 *  Coarse = the coarsest level whose voxel count is >= `coarseMinVoxels`
 *  (so 220 KB-ish initial paint on a typical 192³ grid, picking L2).
 *  Fine = coarse - 1 (clamped at 0). For pyramids where every level is
 *  already small, coarse and fine collapse to the same level — caller
 *  should detect equality and skip the refine pass.
 *
 *  L0 (full res) is intentionally not picked unless every coarser level
 *  is below `coarseMinVoxels`. To force-load L0, call `readZarrLevel`
 *  directly with `level=0` instead of going through this helper.
 */
export function pickProgressiveLevels(
  opened: OpenedZarrVolume,
  coarseMinVoxels = 32 * 32 * 32,
): { coarseLevel: number; fineLevel: number } {
  let coarseLevel = 0
  for (let i = opened.levels - 1; i >= 0; i--) {
    const [nx, ny, nz] = opened.levelShapes[i]
    if (nx * ny * nz >= coarseMinVoxels) {
      coarseLevel = i
      break
    }
  }
  const fineLevel = Math.max(0, coarseLevel - 1)
  return { coarseLevel, fineLevel }
}
