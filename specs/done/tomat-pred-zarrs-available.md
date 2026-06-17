# tomat pred zarrs are now landing on R2

## Implementation status (ELvis side, 2026-06-16)

§6 (`boolTrueParam` gotcha) and §7 (single-letter param renames, no BC)
both landed:

- `zarr` → `Z` with `optBoolParam` semantics (`?Z=1` force-on, `?Z=0`
  force-off, absent = default-on). The `?zarr=1` gotcha is fixed.
- `heat`/`ha`/`hc`/`al`/`he` → `H`/`A`/`C`/`L`/`E` (still
  `boolTrueParam`: present = non-default).
- `src=label|input|diff` → `s=l|i|d` enum.
- `H A C L E` further collapsed under one key via `use-prms`'
  `flagPackParam`: `?_=HA` = heatmap off + atoms hidden.
- `m` / `mp` aliasing via `use-prms`' `useUrlAlias`:
  `?mp=2375705` normalizes to `?m=mp-2375705` on mount.

The §7 (e) deprecation window was skipped per "no one is using this site
yet" — old keys silently become unrecognized.

Adjacent work landed in the same change: ELvis flipped `zarr.open` to
v3-only, switched electrai zarr URLs from openathena S3 v2 to R2 v3mr
via tomat CFW (all 205 mats × {input, label} converted via
`tomat/scripts/convert_zarrs_modal.py::electrai`), and adopted
progressive L2→L1 chunk loading (skips L0 on grids large enough that the
pyramid has 3+ levels above 32K voxels).

---

**Status:** writer fix landed in tomat session 2026-06-15 (UTC ~02:50);
verified 4-level NGFF v0.5 multiscales + `elvis` attrs block + non-empty
chunks (mp-1797712.zarr = 779 KiB, 4 levels, 8 atoms, 201 quantiles).
A 14-fire bin5 sweep is currently writing predictions across the whole
ckpt trajectory (step-30000, 40000, 49999, 60000, 70000, 80000, 89999 ×
{val_200, train_200} × maskgit-K=12), starting from mat #21.

## URL format (R2 via CFW)

```
https://tomat-runs-api.openathena.workers.dev/api/files/raw/tomat/eval/predictions/<run>/<setmode>/step-<N>/<mp>.zarr/
```

Where:
- `<run>` = `train-mg-kl-bin5-fs-tpu` (others later)
- `<setmode>` = `val_200-maskgit` or `train_200-maskgit`
- `<N>` ∈ {30000, 40000, 49999, 60000, 70000, 80000, 89999}
- `<mp>` = e.g. `mp-1797712`

The GT zarr for the same mat is already at:
```
https://tomat-runs-api.openathena.workers.dev/api/files/raw/tomat/rho_gga_v3mr/<split>/<mp>.zarr/
```
(`<split>` = `validation` for val_200 mats, `train` for train_200 mats.)

## Schema reminders

- Root `zarr.json/attributes.multiscales` carries the NGFF v0.5
  pyramid descriptor (4 levels, 2× downsample each).
- Root `zarr.json/attributes.elvis` block — same shape as your GT
  zarrs:
  - `material_id` (string)
  - `role` (`"label"` for predictions, `"input"` for GT)
  - `lattice` (3×3 row-major Å)
  - `atoms` (list of `{element, frac}`)
  - `stats` (`{min, max, mean}` of `f16` density)
  - `quantiles` (201-element f16 array; min, p0.5, p1, …, max)
- Density dtype is `f16` for size; the values are in the same physical
  units as GT (electrons / Å³ × 1000, per the codec).

## Use cases

- Per-mat pred-vs-GT diff at a single ckpt step.
- Pred trajectory across training: same `<mp>` rendered at all 7 ckpt
  steps to visualize how the model's predictions evolve with training.

## Current coverage

Update 2026-06-16 — correction to earlier "10-13 mats per (step, set)"
report. That count included pre-fix 66-byte STUB zarrs from an older
broken n=20 fire (the import error described in §1 left empty
placeholder dirs that were blindly mirrored to R2 by the first pass).
**Real coverage** as of UTC ~12:00 is ~4-17 real mats per (val_200,
step) tuple; the 13 stub zarrs at step-30000 (and similar at other
steps) are not viewable in ELVis and should not be considered part of
the working set.

20 mats have real preds at all 7 ckpt steps + GT (verified by
`elvis.stats.mean` presence). The val_200 step-89999 job has
succeeded; train_200 step-89999 is still running. A second R2 mirror
pass overwrote step-89999 stubs with real data.

ELVis-side: §6 and §7 below are still the active asks. The §5 number
update doesn't change anything for the ELVis renderer or URL story.

## Cross-reference: tomat is building its own hosted viewer

Heads up: tomat is writing a separate spec (`tomat/specs/58-mp-page-
hosted-elvis-viewer.md`) to host its own per-material landing page at
`tomat.oa.dev/mp/<mp_id>` — listing every density-grid version for a
material and offering a built-in diff view. The plan factors the ELVis
renderer into a publishable `@elvis/viewer-core` package that tomat
consumes; the ELVis static site becomes a thin shell on that core.

This **does not** retire any of the asks here. The boolTrueParam fix
(§6) and the URL-shortening (§7) are valuable for ELVis-native sharing
independently of whatever tomat hosts. Two separate share contexts;
the spec-58 work doesn't block this one.

## URL param gotcha — `boolTrueParam` is inverted

In tomat session 2026-06-15 I tried `?zarr=1` to force Zarr mode on, and
the page hung on `"Diff view requires Zarr mode (Shift+Z)"`. The cause
is in `App.tsx:100-103`:

```ts
// Bool param defaulting to true (present in URL = disabled)
const boolTrueParam: Param<boolean> = {
  encode: (v) => v ? undefined : '',
  decode: (e) => e === undefined,  // TRUE when absent, FALSE when present
}
```

`?zarr=1` is interpreted as "useZarr=false" because the param is
present. Same goes for `heat`, `ha`, `hc`, `al`, `he` — all use this
inverted encoding.

This makes shareable URLs hard to author:

- For *defaults*, the param must be absent.
- For *opt-out*, the param must be present (any value, even `?zarr=` works).
- There's no way to write a "force this on" URL that's robust if the
  default ever flips.

Two paths forward:

1. **Rename** the params to their negative form: `nozarr`, `noheat`,
   `noha`, `nohc`. Same encoding, but the URL now reads correctly.
2. **Switch to `optBoolParam`** (already exists in the codebase): `1` =
   on, `0` = off, absent = use default. Lets `zarr=1` mean "force on"
   instead of "force off". The downside is the URL grows for the common
   case (default-on params now need `zarr=1` in every share link).

Recommend #2 for `zarr` specifically (since it's the most common
"share-friendly" param right now); leave the others alone unless
they're commonly shared.

## URL param shortening (use-prms idiom)

Builds on the previous section. The `boolTrueParam` gotcha (`?zarr=1` reads
like "enable" but means "disable") is really two problems stacked: the
**name** says the wrong thing, and the **value** is ignored. `use-prms`
already nudges toward terse, defaults-omitted URLs (`?z` for "on", absent
for "off"); ELVis should lean further into that for params Ryan actually
shares.

### (a) Naming convention sketch

- **Single uppercase letter = inverted default-on toggle.** Present in URL
  means *off*. Mnemonic: capital letter = "the loud one", i.e. you only
  see it when you're overriding the default.
- **Single lowercase letter = `optBoolParam` / standard toggle.**
  `?x=1` / `?x=0` / absent.
- **Single-letter enum values** when the enum has 3+ options
  (`?s=l|i|d`). Two-option enums collapse to a `boolParam`.
- Reserve descriptive multi-letter keys for params that are rare in
  shared URLs (debug-only, per-session, dev knobs).
- Pick letters that don't collide with each other or with existing
  numeric/short keys (`a`, `c`, `m`, `s`, `v0`, `v1`, …).

### (b) Rename proposal

| current | proposed | semantics | commonly shared? |
|---------|----------|-----------|------------------|
| `zarr`  | `Z`      | default-on; `&Z` disables Zarr mode | **yes** (the gotcha) |
| `heat`  | `H`      | default-on; `&H` disables heatmap | **yes** |
| `ha`    | `A`      | default-on; `&A` hides atoms | **yes** |
| `hc`    | `C`      | default-on; `&C` hides abc cell | sometimes |
| `al`    | `L`      | default-on; `&L` hides atom labels | sometimes |
| `he`    | `E`      | default-on; `&E` disables histogram-equalize | rarely (keep as-is is fine) |
| `src=label\|input\|diff` | `s=l\|i\|d` | label default; `?s=d` = diff, `?s=i` = input | **yes** (diff mode) |
| `iso`, `op`, `gpu`, `glb`, `cd`, `xb`, `dl`, `sl`, `sa`, `si`, … | unchanged | already short / per-session | — |

Notes:
- `Z`, `H`, `A`, `C`, `L` are all currently free in the param table.
- `s` is currently free; `src` becomes the alias.
- `E` collides with nothing; `he` was already short, so this is a
  consistency rename, not a length win — fine to defer.

### (c) v0/v1 prefix dedup (optional polish)

When both `v0=` and `v1=` share a long common prefix (typical for sibling
`s3://…/{step-A,step-B}/…` URLs), the `?s3=` brace-expand pattern
already exists for that case. Pushing further (an automatic shared-prefix
encoder for raw v0/v1 pairs) is **not worth the complexity** — `s3=` already
covers the ergonomic path. Flagging here only so it's not re-considered
next time. Leave v0/v1 as-is.

### (d) Implementation note

The `boolTrueParam` and `optBoolParam` decoders in `App.tsx:100-110`
don't need to change — this is purely a key/value rename:

1. Swap each `useUrlState('heat', boolTrueParam)` for the new
   single-letter key, e.g. `useUrlState('H', boolTrueParam)`.
2. For `src`, define an `enumParam<SrcRole>('l', ['l','i','d'])`
   (or hand-roll a `Param<SrcRole>` that maps `l|i|d ↔ label|input|diff`
   if the rest of the code keeps the long names internally — recommended,
   since `srcRole === 'diff'` reads better than `srcRole === 'd'` in
   conditional branches).
3. Consider extracting a tiny helper for the pattern:
   ```ts
   const flag = (key: string) => useUrlState(key, boolTrueParam)
   ```
   so the call sites become `flag('Z')`, `flag('H')`, etc. Optional;
   purely cosmetic.

### (e) Open question — backwards compatibility window?

Existing share links (Slack threads, GitHub comments, the
`tomat-pred-zarrs-available` spec itself) use `zarr`, `heat`, `src=diff`.
Proposal: accept **both** old and new keys for ~1 month, using
`use-prms`' `cleanUrl({...}, { deprecated: { zarr: …, heat: …, src: … } })`
migration form (see use-prms README "Deprecating a param") to rewrite
the URL in place on first load and emit a `console.warn`. After the
deprecation window, drop the old keys entirely. Default answer: **yes,
keep BC**, since the cost is ~10 lines of `cleanUrl` config and the
benefit is no broken links in any of Ryan's existing spec docs.
