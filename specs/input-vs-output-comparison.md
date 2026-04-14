# Spec: Input vs Output Comparison for ElectrAI Training Data

## Context

ElectrAI trains a neural network that takes a **coarse initial guess** of electron density (SAD — Superposition of Atomic Densities) and refines it to match the **converged DFT ground truth**. For each material in the training set, there's a paired `(input, label)` CHGCAR:

- **Input**: SAD guess. Computed by summing spherical atomic densities centered on each atom. Cheap (milliseconds), inaccurate. Looks like smooth spherical blobs.
- **Label**: DFT ground truth. Computed by running a full self-consistent field (SCF) cycle. Expensive (hours), accurate. Shows bonding features, charge redistribution, lone pairs, etc.

The goal of the model is to learn the mapping `input → label` in one forward pass, skipping the expensive SCF iterations. The differences between input and label are what the model needs to learn — and they should be visually striking (bonding regions, charge accumulation in covalent bonds, charge transfer in ionic bonds).

**Relevant references:**
- [Li et al. (2024)][li2024] — Primary paper this project replicates
- `data/MP/chgcars/{input,label}/` in the electrai repo has paired samples
- S3: `s3://openathena/electrai/input/` and `s3://openathena/electrai/label/` have 205 paired samples (~12 GB total, <25 MB per file)
- S3: `s3://openathena/electrai/mp/chg_datasets/dataset_4/{data,label}/` has 2,885 paired samples, all 128³ uniform grids (~205 GB total, 76 MB per file)

[li2024]: https://arxiv.org/abs/2402.12335

## Goal

Add a "Compare" mode to ELvis that lets the user load a matched pair (SAD input + DFT label) for a given material and toggle/compare between them in the viewer.

## Proposed UX

### Option A: Toggle (simplest)

- A new `[I]`/`[L]` keyboard shortcut (or button) toggles the active density between "input" and "label" for the currently loaded material
- The rest of the viewer state (isosurface level, camera, slice position, etc.) stays the same
- Makes it easy to flicker back and forth and see what the NN has to learn
- URL param: add `?src=input|label` (default: `label`)

### Option B: Side-by-side

- Split viewport into left/right
- Left: input, right: label
- Synced camera and iso level
- Useful for presentations / comparisons
- More complex to implement, may require refactoring the single-view assumptions

### Option C: Difference map

- Compute `density_diff = label - input` and render it as its own volume
- Positive regions (where DFT has more density than SAD) in one color, negative in another
- Shows bond locations directly as "charge accumulation"
- Requires loading both, doing voxel-level arithmetic
- Could also show `|label - input|` to highlight magnitude of refinement

Start with **Option A** (toggle). Options B and C can be phase 2.

## Data source

Two dataset options to query:

1. **S3 original (205 samples)** — `s3://openathena/electrai/{input,label}/mp-XXXXXXX.CHGCAR`
   - Smaller (~10-20 MB per file), fast to load
   - Variable grid sizes (from ~560K to ~920K voxels)

2. **dataset_4 (2,885 samples)** — `s3://openathena/electrai/mp/chg_datasets/dataset_4/{data,label}/mp-XXXXXXX.CHGCAR`
   - Larger (all 76 MB, 128³ uniform grids)
   - Includes more diverse materials

Start with (1). Add (2) via a UI toggle (or just let users paste URLs).

## Implementation sketch

1. **URL params**: Add `src=input|label` (where `src` indicates SAD guess vs DFT label). Existing `?m=mp-XXXXX` stays, gains `?m=mp-XXXXX&src=label`.
2. **Keyboard shortcut**: Bind `[I]` = swap between input/label (via `use-kbd`).
3. **Loading**: When a material is selected, optimistically fetch both CHGCARs (or just the selected one; fetch the other on toggle). Cache via OPFS (already implemented).
4. **Indicator**: Small badge in the UI showing "Input (SAD)" or "Label (DFT)" for the currently displayed density.

## Follow-ups / Phase 2

- **Diff map** (Option C) for showing "what the NN has to learn"
- **NN prediction** as a third mode once we have trained model outputs stored somewhere
- **Animated transition** (cross-fade or slider) between input and label
- **Comparison view** (Option B) with synced camera

## Open questions

- Should the toggle also sync between paired materials if the user navigates? (E.g., "show me this material's input" + arrow key to next material should preserve the input/label selection)
- Do we want a "next material where input differs a lot from label" navigation mode? Could highlight interesting cases.
