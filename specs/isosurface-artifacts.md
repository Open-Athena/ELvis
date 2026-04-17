# Spec: Isosurface Rendering Quality & Artifacts

## Context

The current isosurface renderer (`IsosurfaceRenderer.tsx`) uses marching cubes to extract a mesh at the user-selected iso level from the raw voxel grid. The user reports:

1. **"Blue shading around atoms"** — unclear what the isosurface represents or why it only appears near atoms.
2. **Artifacts** — visual glitches, possibly at periodic boundaries or tile edges.

This spec documents the current rendering pipeline, identifies known issues, and proposes fixes.

## Current pipeline

```
CHGCAR voxels (Float32Array, dims=[Nx,Ny,Nz])
  → marchingCubes() at iso level
  → Three.js BufferGeometry (vertices + normals)
  → MeshPhongMaterial (blue-ish, semi-transparent)
  → Rendered in scene with ambient + directional lights
```

### Why "only around atoms"?

Electron density IS concentrated around atoms — that's physically correct. At typical iso levels (set by the slider), the density surface encloses the high-density atomic core regions. The density between atoms (bonding electrons) is much lower and only visible at low iso levels.

This is actually a feature, not a bug: the isosurface should look like atom-centered blobs at high iso levels, and merge into bonding regions as you lower the level. If this isn't clear to users, the fix is UX (labeling, onboarding), not rendering.

## Known / suspected issues to investigate

### 1. Tile boundary seams

When tiling is enabled (`tilePadding > 0`), the isosurface is computed over the extended grid. Marching cubes may produce visible seams at tile boundaries if:
- The tiled copies aren't perfectly continuous (off-by-one in periodic wrapping)
- The fade mask creates a hard cutoff in the mesh

**Investigation**: render with tiling on, zoom into a tile boundary, check for mesh gaps or doubled faces.

### 2. Periodic boundary discontinuity

Even without tiling, the primary unit cell's isosurface may have open faces at the cell boundary — marching cubes doesn't know the grid is periodic, so it treats the boundary as a hard edge (density → 0 outside).

**Fix**: pad the grid by 1 voxel in each direction using periodic wrapping before running marching cubes, then clip the resulting mesh to the cell bounds.

### 3. Iso level calibration

The "iso level" slider maps to raw density values. Users don't know what density value is "interesting." If the slider range doesn't match the data's actual value distribution, it's easy to set it too high (nothing visible) or too low (everything is a blob).

**Fix**: show the density histogram, default to a percentile-based iso level (e.g., 90th percentile of nonzero values), or auto-calibrate the slider range to [min, max] of the current dataset.

### 4. Mesh quality / normals

Marching cubes produces flat-shaded triangles by default. If vertex normals aren't properly computed or smoothed, the surface looks faceted. Current code may or may not be smoothing normals.

**Investigation**: check if `computeVertexNormals()` is called after mesh generation.

### 5. Z-fighting with slice plane

The slice plane and isosurface can z-fight where they intersect. Current code uses `polygonOffset` on the slice plane, but the offset may not be sufficient.

## Action items

- [ ] Investigate each issue above, confirm which are real
- [ ] Add 1-voxel periodic padding before marching cubes (fix boundary holes)
- [ ] Auto-calibrate iso level slider range to data [min, max]
- [ ] Consider density histogram widget or percentile-based default
- [ ] Ensure vertex normals are smoothed
- [ ] Add user-facing label: "Electron density isosurface at X e/ų" so users know what they're looking at
- [ ] Test tile boundary rendering at various padding values

## Relationship to progressive-loading spec

The GLB preview meshes (from `progressive-loading.md`) would be generated offline with proper periodic padding and smoothed normals, so they'd naturally avoid some of these runtime artifacts. The Zarr-backed live isosurface still needs the fixes above.
