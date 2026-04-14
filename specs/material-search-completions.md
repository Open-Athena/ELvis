# Spec: Material Search Completions in ELvis

## Context

ELvis uses [`use-kbd`][use-kbd] for keyboard shortcuts and modals, including an `Omnibar` and `LookupModal`. Currently, loading a specific material requires either:

- Knowing the exact MP ID (`mp-1000020`) and typing it into the URL (`?m=mp-1000020`)
- Drag-and-dropping a CHGCAR file
- Picking from the Materials Project public S3 bucket (`s3://materialsproject-parsed`)

We know several datasets of interest for the ElectrAI project:

1. **ElectrAI S3 original (205 samples)** — `s3://openathena/electrai/{input,label}/`
2. **ElectrAI dataset_4 (2,885 samples)** — `s3://openathena/electrai/mp/chg_datasets/dataset_4/`
3. **Materials Project public bucket** — many more materials, but no paired SAD guesses

[use-kbd]: https://github.com/runsascoded/use-kbd

## Goal

Make it easy to search for and load specific materials from any of our known datasets via keyboard-driven autocomplete, powered by `use-kbd`'s `Omnibar` or `LookupModal`.

## Proposed UX

### Autocomplete search

- Press `/` (or similar) → Omnibar opens
- Typing `mp-1` shows autocomplete of MP IDs matching the prefix
- Autocomplete results are annotated with which dataset(s) contain the material (`[electrai-205]`, `[dataset_4]`, `[MP public]`)
- Enter selects the material, loads it via the existing `?m=` URL param

### Dataset filtering

- Prefix modifiers:
  - `mp-1234567` — searches all known datasets
  - `e:mp-1234567` — restrict to ElectrAI (paired input/label available)
  - `d4:mp-1234567` — restrict to dataset_4
  - `mp:mp-1234567` — MP public only
- Or: a "dataset" picker button/dropdown in the Omnibar

### Structure name search (stretch)

- Some materials have known formulas/names: `Fe2Cu2O4`, `TiO2 rutile`, etc.
- Would need metadata with formulas for each MP ID
- MP API provides this, but we'd need to cache it

## Data sources

### ElectrAI filelists

The repo (and various S3 locations) have `mp_filelist.txt` files listing the MP IDs for each dataset:

- `s3://openathena/electrai/mp/chg_datasets/dataset_4/mp_filelist.txt` — 2,885 IDs
- ElectrAI S3 original — get via `aws s3 ls s3://openathena/electrai/input/`

These are static lists of IDs. Could be bundled at build time or fetched lazily.

### Materials Project

MP has ~150K+ materials. Can't bundle the full list. Options:
- **Bundle a curated subset** (e.g., the 2,885 dataset_4 materials, plus any others Betsy/Hananeh have flagged)
- **Fetch on-demand** from MP API (has rate limits, requires API key)
- **Pre-compute a trie/search index** from the full MP list and host it as a static asset

Start with bundled lists. Expand later if needed.

## Future: OMOL (and other molecule datasets)

OMOL is [Open Molecules 2025](https://huggingface.co/datasets/facebook/OMol25) — a molecular (not crystalline) dataset from Meta FAIR. Different file format, different structure (no periodic boundary conditions).

ELvis currently assumes periodic CHGCAR format. Supporting OMOL would require:

- Handling non-periodic structures (molecules in vacuum, no lattice)
- Different file format parsing (OMOL uses `.xyz` + `.npy` or similar, not CHGCAR)
- Deciding what to display: electron density isn't really the same concept for isolated molecules, but orbitals/wavefunctions are
- May warrant a separate ELvis "mode" for molecules vs crystals

This is a larger undertaking — consider as a phase 2 after crystal search is working.

## Implementation sketch

1. **Bundle dataset manifests** at build time:
   - `pkgs/static/src/data/electrai-manifest.json` — list of MP IDs with `{ id, source: 'electrai-205' | 'dataset_4', has_input: bool, has_label: bool }`
   - Generate via a script that runs `aws s3 ls` on the relevant prefixes

2. **Update Omnibar / Lookup UI**:
   - Add a "Materials" autocomplete source
   - Filter by prefix as user types
   - Show dataset badge per result

3. **URL params**:
   - Existing `?m=mp-XXXXXXX` stays
   - Add `?src=input|label` (from the other spec) for paired ElectrAI data

4. **Performance**:
   - 2,885 + 205 ≈ 3K IDs is tiny, all can live in-memory
   - Even MP public (150K) could be loaded as a compressed static asset (~1-2 MB gzipped)

## Follow-ups

- Once NN predictions are stored somewhere (e.g., S3 bucket), add them as a third "source" dimension (`src=prediction`)
- Link to WandB/experiment tracking for materials where we have training results
- Show per-material metadata (formula, space group, NMAE if available)

## Open questions

- Should search match against MP numeric IDs (`mp-1234567`) only, or also formulas/names? Latter needs metadata fetching.
- Is there a natural UI place for the "which dataset" filter, or should it default to "all" with dataset badges?
- Should we prioritize the ElectrAI datasets over MP public, since they're our main use case?
