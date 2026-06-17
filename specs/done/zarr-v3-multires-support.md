# Zarr v3 + Adaptive Multi-Res Support

**Status**: Layers 1 + 2 landed 2026-06-16. Layer 3 (sharding) deferred.

## Implementation notes

- **Layer 1a (autodetect):** landed in `6f4e0c2`.
- **Layer 1 (v3-only flip):** `zarr.open` → `zarr.open.v3` at all 3 sites in
  `pkgs/core/src/storage/zarr-volume.ts`. Coordinated with
  `convert_zarrs_modal.py::electrai`: tomat converted all 205 openathena
  electrai mats × {input, label} → R2 at `electrai/zarr-v3mr/`. ELvis's
  `resolveLoadUrl` now points at the tomat CFW alias
  `https://tomat-runs-api.openathena.workers.dev/api/files/raw/electrai/zarr-v3mr/...`.
- **Layer 2 (progressive level selection):** simpler than the spec's
  viewport-driven adaptive design — `pickProgressiveLevels(opened)`
  picks `coarseLevel` = coarsest level with ≥ 32K voxels and
  `fineLevel = max(0, coarseLevel - 1)`. Diff path and URL-input zarr
  path both fetch coarse → render → fetch fine → re-render. A
  `loadGenRef` counter aborts stale fine fetches when the user kicks off
  a new load mid-flight. Result on 192³+ mats: L0 (~14 MB) skipped
  entirely; on smaller mats the pyramid is shallow and `fineLevel` lands
  at L0 (which is already small — ~400–800K voxels). No viewport-driven
  refinement yet; that's the natural follow-up.
- e2e regression test asserts the progressive ordering invariant: all
  chunk reads at any coarser level finish requesting before any finer
  level starts.
- **Layer 3 (sharding):** not yet exercised; deferred until tomat
  commits to sharded outputs.

---

## Original spec follows

## Goal

Make ELVis's diff loader work against zarr **v3 multi-res pyramids** (NGFF
`multiscales` convention) and actually leverage the pyramid for perf —
load the coarsest level for instant preview, refine on viewport/zoom.
Currently the diff loader is hard-wired to zarr v2 and only ever reads
level 0 (full res), which is the wrong shape for tomat's prediction
zarrs and wastes the multi-res infrastructure when it does load
multi-res data.

## Context

### Today's behavior

- `pkgs/core/src/storage/zarr-volume.ts:48` calls `zarr.open.v2(store, { kind: 'group' })` — v2 only.
- `openZarrVolume` expects an NGFF-style `multiscales` attribute with a list of `datasets`, each at a numeric-named child path (`"0"`, `"1"`, …).
- `fetchZarrVolume(url, level = 0)` — only level 0 is ever requested by callers.
- `pkgs/static/src/App.tsx:1260-1261` (diff path) calls `fetchZarrVolume(toFetchUrl(v0Resolved))` with no level arg → full res both sides.
- ELVis's primary perf path is `.json.gz` (CHGCAR-pymatgen JSON). Zarr path is secondary and barely exercised.

### What's incoming (from `~/c/oa/tomat/specs/51-eval-pred-r2-elvis-drilldown.md`)

- tomat eval will write per-mat **zarr v3** prediction grids per (run, step, set, mode, mp_id) to GCS, then mirror to R2 via the tomat CFW.
- These will follow NGFF multiscales convention with pyramid levels (`0`, `1`, `2`, …) and `multiscales` attr at the group root.
- Existing tomat GT zarrs (`gs://marin-eu-west4/tomat/rho_gga_raw/<mp>.zarr`) are currently single-array zarr v3 (`charge_density_total` at root, no multiscales). tomat will run a one-time converter to rewrite all ~80k GT zarrs as v3 multi-res pyramids matching the same schema, then re-mirror.
- Diff URL pattern from tomat dashboard:
  ```
  https://elvis.oa.dev/?v0=<gt-r2-url>&v1=<pred-r2-url>&src=diff
  ```

### What ELVis needs to do

1. Read **zarr v3** stores (current code uses `.v2` opener).
2. Walk the NGFF `multiscales` attr to enumerate levels (already partly there in `openZarrVolume`).
3. Adaptive level selection on load: load the **lowest non-empty level** first for instant render, refine on viewport changes (zoom, slicing, diff threshold).

## Layer 1 — switch to zarr v3 reader

### Change

`pkgs/core/src/storage/zarr-volume.ts`:

```ts
import * as zarr from 'zarrita'

export async function openZarrVolume(url: string): Promise<OpenedZarrVolume> {
  const store = new zarr.FetchStore(url, { fetch: fetchWithS3MissingKeyShim })
  // v3 opener — tomat writes v3 pyramids, MP-rho legacy data will be converted to v3.
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

export async function readZarrLevel(...) {
  // ... change all `zarr.open.v2` calls to `zarr.open.v3`
}
```

zarrita's `zarr.open.v3` rejects v2 stores cleanly. After this change,
any legacy v2 data ELVis loaded before (if any) would fail. **Per the
tomat side: GT data will be converted to v3 in lockstep — no v2 zarrs
left in the wild.**

Alternative: use `zarr.open(...)` (autodetect) instead of `.v3` so the
loader works against both v2 and v3 stores during the transition.
Slightly slower per-load (one extra metadata probe) but smoother
migration. **Pick autodetect for safety.**

### Acceptance

- Open this URL (after tomat has the pyramid + R2 mirror in place) and read level 0 successfully:
  ```
  https://tomat-runs-api.openathena.workers.dev/api/files/get?path=tomat/rho_gga_raw/validation/mp-1921473.zarr
  ```
- Diff render works against two tomat zarrs at full res (no level adaptation yet).

## Layer 2 — adaptive level selection

The whole point of multi-res is rendering responsiveness. Without it,
loading a 192³ float32 volume = 28 MB over the wire per side per diff,
and there's no preview while it streams.

### Design

A new `useAdaptiveZarrLevel(opened, viewport, target)` hook (or wrapper) in `pkgs/core/`:

- On initial mount: pick the **coarsest level** (`levels - 1`) and load it. Render immediately.
- On viewport changes (zoom, camera position, slice plane move), compute the "screen pixels per voxel" at the current view. If voxels-per-screen-pixel is > some threshold (e.g. 2), upgrade to a finer level.
- Cancel in-flight reads if a finer level is requested while an older read is still pending.
- Reuse already-fetched chunks across levels (zarrita already has a chunk cache; the loader just needs to not re-issue the same key).

### Diff-specific consideration

For diff: load level $L$ for **both** sides, compute diff at that level, render. When upgrading $L → L+1$, re-fetch both, recompute diff. The per-level diff cost is $O(N_L)$ — small at coarse levels, dominated by full-res only when the user really wants detail.

### Acceptance

- Open a tomat diff URL. Verify a coarse render appears within ~200 ms (single small chunk per side), then refines on zoom-in over ~1-2 s.
- Loading time-to-first-pixel for a 192³ grid drops from ~current-baseline to under 500 ms.

## Layer 3 — sharding awareness (out of scope for Phase A)

Zarr v3 sharding (1 storage object = many chunks) is a meaningful R2
cost win on the **producer** side (tomat's writes + GT mirror).
**Reader-side: zarrita's `FetchStore` already transparently handles
sharded reads** — no ELVis change needed.

Confirm zarrita handles sharded chunks before tomat commits to writing
sharded outputs.

## Schema (lockstep with tomat)

```
<root>.zarr/
  zarr.json                 (group meta, contains `multiscales` attr)
  0/
    zarr.json               (array meta, finest resolution)
    c/0/0/0                 (chunk; or shards if v3-sharded)
    c/0/0/1
    ...
  1/                        (2× downsampled)
    zarr.json
    c/0/0/0
    ...
  2/                        (4× downsampled)
    ...
```

`multiscales` attribute (NGFF / OME-Zarr 0.4 convention):

```json
{
  "multiscales": [
    {
      "version": "0.5",
      "name": "charge_density_total",
      "axes": [
        {"name": "z", "type": "space", "unit": "voxel"},
        {"name": "y", "type": "space", "unit": "voxel"},
        {"name": "x", "type": "space", "unit": "voxel"}
      ],
      "datasets": [
        {"path": "0", "coordinateTransformations": [{"type": "scale", "scale": [1, 1, 1]}]},
        {"path": "1", "coordinateTransformations": [{"type": "scale", "scale": [2, 2, 2]}]},
        {"path": "2", "coordinateTransformations": [{"type": "scale", "scale": [4, 4, 4]}]}
      ]
    }
  ],
  "structure": "<pymatgen Structure JSON>",
  "metadata": "<task_id, pymatgen_version, ...>"
}
```

Each `<level>/zarr.json` carries its array meta (shape, dtype, chunks).

## Sequencing

1. **tomat side** lands the writer + converter + GT mirror (see `~/c/oa/tomat/specs/52-eval-pred-r2-elvis-drilldown.md` Phase A).
2. **ELVis Layer 1** lands: `.v2` → autodetect (or `.v3`); verify open + level-0 read against tomat v3 pyramid.
3. **ELVis Layer 2** lands: adaptive level selection; ship the perf win.
4. **ELVis Layer 3** confirms sharded read works against tomat outputs.

## Open questions

- The diff loader currently does `b.grid.data[i] - a.grid.data[i]` over the full flat array at level 0. For adaptive level, diff would happen at $L$ and re-trigger on level change. Does the renderer accept a fresh `VolumeData` at a coarser shape mid-session, or does it expect the same `dims` across loads?
- For the structure overlay (atoms, lattice box), do we read structure JSON from the group attrs (preferred) or from a sibling array? Tomat will put it in attrs.
- Caching layer: should ELVis also cache fetched levels in IndexedDB (like the existing `.json.gz` cache) so repeated visits skip the network entirely?

## Non-goals (Phase B+)

- Backwards compat with v2 stores once tomat finishes the conversion. The simplest model is "v3 only, autodetect retired."
- OME-Zarr 0.5 spec compliance beyond what NGFF multiscales requires. Tomat's pyramid is a strict subset.
- Authentication / private-bucket access. tomat zarrs are served public via the runs CFW; no auth needed.
