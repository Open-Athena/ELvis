# Spec: Editable Diff Sources + Heatmap Color Legend

## Context

Two related gaps surfaced while testing the new `?src=diff` + `?heat=1` view on the worst-case representative materials:

1. **Diff sources are implicit and inflexible.** `?src=diff` hardcodes the comparison as `|label − input|`, both auto-derived from the current `mp_id`. There's no way to inspect *which* URIs are being diffed, and no way to override them. This blocks the natural next use case: comparing **predicted ρ** (from a model checkpoint) against the **DFT label** for the same material.
2. **The heatmap has no legend.** Turbo colors are perceptually striking but quantitatively opaque — the user can't tell whether red means "0.01 e/Å³" or "0.5 e/Å³" of residual density. Currently the user has to mentally combine the Gamma + Low-cutoff sliders with a colormap they can't see to interpret the picture.

## Goals

- **Phase 1 (this spec):** make diff sources first-class and configurable; add a quantitative legend to the heatmap.
- **Phase 2 (shipped 2026-05-04):** signed (diverging) diff colormap landed via the
  green/red `diverging()` map in `colormap.ts` + matching GLSL in `HeatmapRenderer`.
  Convention: `diff = v1 − v0` (after − before); positive (DFT *added* density) →
  green, negative (DFT *removed*) → red, literal black at zero so ray-march
  accumulation can't leak hue into the near-zero band. Multi-colormap choice and a
  full color-scale editor remain deferred — punt until we have a 2nd consumer.

Out of scope: `?src=predicted` itself (separate spec), drawer reorg / icon rail (separate item per `#4` discussion).

## 1. Editable two-URI diff sources

### URL state

New URL params (both optional):
- `?v0=<url>` — first volume operand of the diff
- `?v1=<url>` — second volume operand

(Naming rationale: `v0`/`v1` implies "volume 0, volume 1" with no before/after ambiguity that `a`/`b` carries.)

When `src=diff`:
- If both `v0` and `v1` are present, use them as the diff operands directly. `m=` is irrelevant for loading (but still affects the structure metadata used for atoms/lattice — see "structure source" below).
- If only `v0` xor `v1` is present, fill the other from the auto-resolved label/input for `m=`. (Convenience: lets you pin one side and let the material change.)
- If neither is present, fall back to current behavior: `v0 = resolveLoadUrl(record, 'label', 'zarr')`, `v1 = resolveLoadUrl(record, 'input', 'zarr')`.

The diff is `|v0 − v1|` regardless of ordering. (Phase 2 will add signed diff with a swap-affecting sign.)

### `loadDiff` API change

```ts
const loadDiff = useCallback(async (
  record: MaterialRecord | null,  // null when fully URL-driven (?a=&?b=)
  v0UrlOverride?: string,
  v1UrlOverride?: string,
) => { … })
```

Resolution order inside `loadDiff`:
1. If `v0UrlOverride`/`v1UrlOverride` set → use those.
2. Else if `record` set → use `resolveLoadUrl(record, 'label', 'zarr')` / `('input', 'zarr')`.
3. If still missing → set `fetchStatus` error and return.

### Structure source

The heatmap/iso renderer needs an `atoms + lattice + dims` triple. Currently `loadDiff` borrows `lbl` for that. With user-overridden URLs, we keep the same convention: structure is taken from the **`v0` operand**'s Zarr (the "before" / "expected" side). If the user wants atoms from `v1`, they can swap.

### Drawer UI

When `srcRole === 'diff'`, expose a new collapsible "Diff sources" section in the right drawer (below `Load from URL`, above `Examples`):

```
▼ DIFF SOURCES
  v0: [s3://openathena/electrai/zarr/mp-X-label.zarr/        ] [↺]
  v1: [s3://openathena/electrai/zarr/mp-X-input.zarr/        ] [↺]
  [⇄ Swap]   [Reset to auto (label / input)]
```

- Two text inputs (full-width, monospace, same style as `Load from URL`).
- `↺` per-row reverts that row to its auto-resolved value.
- `⇄ Swap` swaps v0 ↔ v1 (purely cosmetic for `|v0−v1|`; matters when Phase 2 lands signed diff).
- `Reset to auto` clears both `?v0=` and `?v1=` from the URL.
- Editing a field triggers a load (debounced 500 ms, like `Load from URL` already is).

When `srcRole !== 'diff'`, the section is hidden (don't surface useless inputs).

### Compatibility

- Existing URLs `?m=mp-X&src=diff` continue to work (auto-resolves both sides).
- `?src=predicted` (when it lands later) will be orthogonal: predicted is a single-source mode, not a diff. To compare predicted vs label, the user uses `?src=diff&v0=<label-url>&v1=<predicted-url>` (no `m=` needed, or `m=` only for atoms metadata).

### Title bar

Currently: `|Label − Input|` for `src=diff`. Update to one of:
- `|Label − Input|` (auto-derived, both sides from the same material) — unchanged.
- `|v0 − v1|` (user-overridden) with the URL basenames as a hover tooltip.

## 2. Heatmap color legend

### What it should show

A small **vertical or horizontal turbo color bar** with:
- Tick labels at numeric values in the volume's actual units (e/Å³ for density, same units for diff).
- The currently effective `lowCutoff` line marked on the bar (semi-transparent black overlay below the cutoff, to signal "this range is invisible").
- Tick spacing is **gamma-corrected** so the bar visually represents what's rendered: where the user sees a particular shade, the corresponding density value can be read off the same vertical position.

### Where it lives

Bottom-right of the canvas (above the existing axis gizmo) when `useHeatmap` is true. ~24 px wide × ~240 px tall. Floats over the canvas like the slice-viewer thumbnail does today.

Hidden when `useHeatmap` is false.

### Numeric range

Today the renderer normalizes the volume to `[0, 1]` based on per-volume `dMin`/`dMax`. Lift that calculation up so it's available to both the renderer AND the legend:

```ts
// Move into a utility (or a useMemo at the App level):
function volumeRange(data: Float32Array): { min: number; max: number } { … }
```

Pass `dMin`/`dMax` as props into `HeatmapRenderer` (avoids recomputing) and use the same values for the legend.

For the diff view specifically: `dMin = 0` always (since `|a-b|`), `dMax` = max |Δρ|. That's a meaningful number for the user — the legend should display it.

### Tick choices

- 5 ticks: 0%, 25%, 50%, 75%, 100% in **gamma-corrected position** (so visually evenly spaced, but mapped through `pow(p, 1/gamma)` to recover the data value).
- Labels: 3 sig figs in scientific notation if `|max| < 0.01` or `|max| > 1000`, else fixed-point.
- Units suffix: configurable prop (default `'e/Å³'`).

### Interaction (Phase 1: read-only)

No drag-to-set yet. Just visual.

(Phase 2 candidate: drag the cutoff line, click ticks to snap iso level.)

## 3. Color-scale lib (`$js/`) — investigation note

`~/c/jc-taxes/www/src/GradientEditor.tsx` (372 lines) is interesting but built for **editable color stops + scale type (linear/sqrt/log)** — overkill for elvis Phase 1, where the colormap is a fixed analytic turbo function.

**Decision for Phase 1:** build a small `HeatmapLegend` component locally in `pkgs/core/src/components/`. Don't copy GradientEditor.

**Future (deferred, separate-session work in `~/c/js/`):** if elvis grows multi-colormap support (turbo + viridis + plasma + diverging) AND/OR jc-taxes wants reuse, factor a `$js/use-color-scale` lib. That work belongs in a `~/c/js/use-color-scale/specs/v1.md` written from a session in `~/c/js/`. A stub note here:

```
TODO (separate session, ~/c/js/use-color-scale):
  Extract from jc-taxes/GradientEditor.tsx + elvis/HeatmapLegend:
    - ColorStop type
    - ScaleType (linear/sqrt/log)
    - encodeStops/decodeStops for URL state
    - interpolateColor
    - Optional editor UI (with elvis using read-only mode)
```

## 4. Drawer visual cues (deferred)

Per discussion: drawer is getting busy. Light-touch ideas (for a follow-up spec, not this one):

- Section heading icons (Surface, Heatmap, Display, Tiling, Camera, Slice each get a 16 px icon).
- A subtle accent color per section (matches the icon).
- Hotkey to collapse all sections except the most recently interacted with one.
- Persist collapsed/expanded state in localStorage.

Not in scope for this spec.

## Implementation order

1. **Lift `dMin`/`dMax` calc** out of `HeatmapRenderer` into a util + `useMemo` at App level. Pass as props back into renderer (no rendering change).
2. **`HeatmapLegend` component** in `pkgs/core/src/components/`, consuming `dMin/dMax/gamma/lowCutoff/units`. Wire into `DensityViewer` (canvas overlay, only when heatmap mode is on). Visual-only verification in browser.
3. **`?a=` / `?b=` URL params** + override-aware `loadDiff`. Verify with `?m=mp-2458647&src=diff` (no override) → unchanged behavior, then with explicit `?a=...&b=...` overrides → same render.
4. **Diff sources drawer section** in `Controls.tsx` (visible only when `srcRole === 'diff'`). Two inputs, swap, reset-to-auto. Wire up to URL state.
5. **Title update** for user-overridden case.

Each step is independently committable.

## Open questions

- Legend orientation: vertical (next to gizmo) vs horizontal (above the gizmo, full canvas width)? My instinct: vertical, ~28 px wide × 240 px tall, bottom-right inset. Verify in browser before committing.
- Should the legend show a tick at the **iso level** too (so it's clear how the heatmap relates to the surface threshold)? Probably yes; small overlay marker.
- Diff dim mismatch: with editable URLs, the user might paste two arbitrarily-shaped Zarrs. Current `loadDiff` already errors cleanly on dim mismatch — keep that.
