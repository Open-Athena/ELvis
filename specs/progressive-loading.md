# Spec: Progressive Loading via Zarr Pyramids + Pre-computed Mesh Previews

## Context

ELvis currently downloads entire CHGCAR or `.json.gz` files to render electron density:

- **electrai-205**: 10–20 MB per material (raw CHGCAR)
- **dataset_4**: 76 MB per material (128³ uniform grids, raw CHGCAR)
- **MP-parsed**: 25–160 MB per material (pymatgen JSON, gzipped)

This is too large for a responsive browse experience. Selecting a material from the Omnibar or browse table triggers a multi-second download before anything renders. The goal is **<1s to first meaningful frame** for any material.

## Prior art

- **[OME-NGFF]**: Bio-imaging community standard for multi-scale volumetric data on object stores. Uses Zarr v2/v3 with chunked pyramids. Viewers (napari, neuroglancer, Viv) fetch chunks on demand via HTTP range requests.
- **[neuroglancer]**: Google's volumetric data viewer. Fetches Zarr/Precomputed chunks progressively, renders at the coarsest available level while finer chunks load.
- **[carbonplan/maps]**: Climate data tiles served as Zarr on S3, rendered in the browser with WebGL.
- **[zarrita.js]**: Modern, maintained JS library for reading Zarr v2/v3 stores from HTTP/S3.

[OME-NGFF]: https://ngff.openmicroscopy.org/
[neuroglancer]: https://github.com/google/neuroglancer
[carbonplan/maps]: https://github.com/carbonplan/maps
[zarrita.js]: https://github.com/manzt/zarrita.js

## Design

### Two complementary layers

#### Layer 1: Pre-computed GLB mesh previews (quick win)

Run marching cubes offline for each material at 3–5 iso levels. Export each resulting mesh as a `.glb` (GL Binary / glTF binary) file. These are tiny (~50–200 KB per iso level) and render instantly via Three.js's built-in `GLTFLoader`.

**What it gives you**: instant isosurface preview on material selection. No voxel data needed.

**What it doesn't give you**: adjustable iso level (limited to pre-computed values), 2D slices, diff maps, or any operation that needs the raw voxel grid.

**When the user adjusts iso level or opens a slice**: fall through to Layer 2 (Zarr) for full voxel data.

#### Layer 2: Zarr pyramids on S3 (full fidelity)

Store each material's electron density as a multi-resolution Zarr dataset:

```
s3://openathena/electrai/zarr/<taskId>.zarr/
  .zattrs              # material metadata (formula, lattice, atoms, ...)
  0/                   # full resolution (e.g. 128×128×128)
    .zarray            # dtype=float32, chunks=[32,32,32], compressor=zstd
    0.0.0, 0.0.1, ...  # chunk files (~128 KB each, 64 total for 128³)
  1/                   # 2× downsampled (64×64×64)
    .zarray
    0.0.0, ...         # 8 chunks
  2/                   # 4× (32×32×32)
    .zarray
    0.0.0              # 1 chunk (~128 KB)
  3/                   # 8× (16×16×16)
    .zarray
    0.0.0              # 1 chunk (~16 KB)
```

**Loading strategy**:
1. Fetch level 3 (16³, ~16 KB) → render coarse isosurface + slice instantly.
2. Fetch level 2 (32³, ~128 KB) → replace with sharper render.
3. Fetch level 1 or 0 chunks **on demand**: only the chunks intersecting the current slice plane, or the region near the camera for isosurface detail. Spatial locality means we never need the full 128³ at once.

**What it gives you**: full interactive exploration (any iso level, any slice, diff maps, etc.) with progressive quality refinement and bounded download size per interaction.

### Chunk budget

Target: **< 1 MB for initial render**, **< 5 MB total for typical session**.

| Level | Grid | Chunks (32³) | Bytes (f32, zstd) | Cumulative |
|-------|------|-------------|-------------------|------------|
| 3     | 16³  | 1           | ~16 KB            | 16 KB      |
| 2     | 32³  | 1           | ~128 KB           | 144 KB     |
| 1     | 64³  | 8           | ~1 MB             | 1.1 MB     |
| 0     | 128³ | 64          | ~8 MB             | 9 MB       |

Loading levels 3+2 = 144 KB for instant preview. Loading one slice plane at level 0 = 4 chunks ≈ 500 KB. Full level 0 = 8 MB — still less than the current 76 MB CHGCAR, thanks to zstd compression.

## ETL pipeline

### GLB generation

```python
# For each material:
# 1. Load CHGCAR (or json.gz)
# 2. Run marching cubes at iso_levels = [0.1, 0.25, 0.5, 0.75, 0.9] (quantiles)
# 3. Export each mesh as GLB via trimesh or pygltflib
# 4. Upload to S3: s3://openathena/electrai/glb/<taskId>/<iso_quantile>.glb
```

Dependencies: `scikit-image` (marching_cubes), `trimesh`, `numpy`.

### Zarr conversion

```python
# For each material:
# 1. Load CHGCAR → 3D numpy array (N×M×P float32)
# 2. Create Zarr store with resolution pyramid (OME-NGFF multiscales metadata)
# 3. Write each level with chunk_size=(32,32,32), compressor=zstd
# 4. Sync to S3: s3://openathena/electrai/zarr/<taskId>.zarr/
```

Dependencies: `zarr`, `numcodecs`, `s3fs` (or `aws s3 sync`).

Downsampling: simple block averaging (2×2×2 mean) or scipy `zoom(order=1)`.

### Batch job

~3069 materials × ~10s each ≈ 8.5 hours single-threaded. Parallelizable across EC2 spot instances via `ec2-gha` (we already have this infra).

For electrai-205 only (56 unique materials): ~10 min single-threaded. Good for a first test.

## Client changes

### Phase 1: GLB previews

- Add `GLBPreviewRenderer` component alongside `IsosurfaceRenderer`.
- On material select: fetch `<taskId>/<nearest_iso>.glb` (~200 KB), render immediately.
- Show "Loading full data..." indicator.
- Once Zarr/full voxels load, swap to live isosurface and enable slice/iso controls.

### Phase 2: Zarr progressive loader

- Add `zarrita.js` dependency.
- New `ZarrVolumeStore` class:
  - `open(url)`: reads `.zattrs` + `.zarray` metadata for all levels.
  - `getLevel(n)`: fetches all chunks for resolution level n, returns typed array.
  - `getSlice(axis, index, level?)`: fetches only the chunks intersecting the slice plane.
  - `getRegion(bbox, level?)`: fetches chunks in a bounding box (for partial isosurface).
- Replace current `fetchVolumeJsonGz` / `fetchVolumeFromUrl` with `ZarrVolumeStore` for Zarr-backed materials.
- Keep existing loaders as fallback for raw CHGCAR / json.gz URLs.

### Progressive rendering flow

```
1. User selects material
2. Fetch GLB preview → render instantly (if available)
3. Fetch Zarr level 3 (16³) → coarse isosurface + slice
4. Fetch Zarr level 2 (32³) → replace
5. User adjusts iso/slice → fetch level 0 chunks on demand
6. Cache fetched chunks in OPFS for revisits
```

## Phasing

**Phase 1 — GLB previews** (unblocks fast browsing)
- [ ] Write GLB generation script (`pkgs/corpora/scripts/generate-glb.py`)
- [ ] Run on electrai-205 (56 materials × 5 iso levels = 280 GLB files)
- [ ] Upload to S3
- [ ] Add `GLBPreviewRenderer` to ELvis
- [ ] Wire material selection: GLB first, then full voxels on demand

**Phase 2 — Zarr pyramids** (full progressive loading)
- [ ] Write Zarr conversion script (`pkgs/corpora/scripts/convert-to-zarr.py`)
- [ ] Run on electrai-205 first, then dataset_4
- [ ] Add `zarrita.js` to `@elvis/core`
- [ ] Implement `ZarrVolumeStore` with level-of-detail loading
- [ ] Progressive isosurface: render coarse, refine as chunks arrive
- [ ] Progressive slice: fetch only intersecting chunks at full resolution
- [ ] OPFS chunk cache (reuse across sessions)

**Phase 3 — Optimizations**
- [ ] Predictive prefetch: when user hovers a material in browse table, start fetching GLB
- [ ] Adaptive LOD: choose resolution level based on viewport size / distance
- [ ] Diff maps: fetch Zarr for both input and label, compute diff client-side at matching resolution levels
- [ ] Batch ETL via `ec2-gha` for full dataset_4 (2885 materials)

## Open questions

- **Zarr v2 vs v3**: zarrita.js supports both. v3 is newer with better spec but v2 has broader tool support. Lean v2 for now.
- **Chunk size**: 32³ is a reasonable default (128 KB per chunk at float32). Could experiment with 16³ (smaller granularity, more requests) or 64³ (fewer requests, coarser spatial locality).
- **Compression**: zstd vs blosc vs gzip. zstd has the best ratio:speed tradeoff and browser-side decompression is fast via WASM. gzip is natively supported by HTTP but worse ratio.
- **OME-NGFF compliance**: worth following the multiscales metadata spec so other tools (napari, neuroglancer) can open our Zarr stores directly.
- **GLB iso level selection**: fixed quantiles (10th/25th/50th/75th/90th percentile of density values) or material-specific "interesting" levels? Quantiles are simpler and more robust.
- **S3 bucket**: use `s3://openathena/electrai/zarr/` (alongside existing data) or a new prefix? Keep it co-located for now.
