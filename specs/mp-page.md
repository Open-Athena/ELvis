# Spec: `/mp` — MP materials browse page

## Goal

A filterable browse page at `/mp` (and/or `?view=mp`) for visualizing
the Materials Project subset that **tomat** trains and evaluates on.
Distinct from the existing material-search-completions spec
(omnibar-driven, all corpora), this page is dedicated to MPDB v2 — the
~80K-materials slice tomat actually has tokenized data for.

Reads MPDB directly from R2:

    s3://openathena/mpdb/v2/mpdb.sqlite

(Public read; no auth required for fetch.)

## Why this is its own page

The omnibar (per material-search-completions.md) is designed for
search-and-load workflows across all corpora. `/mp` is the
exploration / inspection counterpart for the tomat training set:
"what's in our train/val split, how does the distribution of
n_atoms / n_electrons / grid-size look, where do specific mats sit
in that distribution?"

Useful as a debugging tool, a stakeholder demo, and as background
context when reviewing tomat training/eval results.

## Data source: MPDB v2

Schema (per scripts/build_mpdb.py in tomat):

```
mats(
  mp_id        TEXT PRIMARY KEY,
  split        TEXT,        -- "train" | "val" | "test" | NULL
  nx, ny, nz   INTEGER,     -- charge-density grid dims
  n_atoms      INTEGER,     -- atoms in unit cell
  n_electrons  INTEGER,     -- sum of Z across atoms (added v2)
  n_voxels     INTEGER GENERATED, -- nx*ny*nz
  cube_seq_pN  INTEGER GENERATED, -- predicted seq length at patch P (N=14..20)
  ball_seq_rN  INTEGER GENERATED  -- ditto for ball patches
)
```

Total: 77,427 train + 4,285 val materials in v2. (Test deferred —
re-cut the publish when ready.)

Versioned key — bump on schema changes. Past versions retained for
reproducibility (so old elvis builds keep working).

## Load strategy

Two reasonable options:

1. **Fetch SQLite directly + read with sql.js (or similar WASM build).**
   - One ~7 MB download (gzipped → ~3 MB?), client-side queries.
   - Same engine as the source; no JSON-export step.
   - Can do arbitrary SQL — flexibility for future filters.
2. **Tomat-side JSON export sibling at publish time.**
   - `s3://openathena/mpdb/v2/mpdb.json` (or `.json.gz`).
   - Simpler for browser; smaller if columns are dropped.
   - Loses ad-hoc query power.

Recommend **(1)** — the SQLite is tiny enough that the WASM overhead
is fine, and we don't have to keep a JSON export schema in sync.
sql.js / sqlite-wasm both work. Wrap in a small `pkgs/mpdb/` (or
inline in `pkgs/corpora/`) helper.

If the WASM bundle adds too much app weight, fall back to (2) and
have tomat publish a sibling JSON.

## UX

### Top-level layout

```
┌─────────────────────────────────────────────────────────┐
│ [search]   split:[train|val|both]   ...filters...       │
├─────────────────────────────────────────────────────────┤
│ ← 81,712 materials  · 77,427 train · 4,285 val          │
├──────────────┬──────────────────────────────────────────┤
│ filters      │  scatter plot: n_atoms × n_electrons     │
│  - split     │   (colored by split)                     │
│  - n_atoms   │                                          │
│  - n_electrons                                          │
│  - grid dims │                                          │
│  - search    │                                          │
├──────────────┴──────────────────────────────────────────┤
│ table: mp_id | split | n_atoms | n_electrons | grid | …│
│        ...   (virtualized; click row → load in viewer) │
└─────────────────────────────────────────────────────────┘
```

### Filters

- **Split**: train / val / both / unknown
- **n_atoms** range slider (1..154 for current data)
- **n_electrons** range slider (1..4328)
- **Grid dims**: filter by min/max axis
- **Search box**: prefix match on `mp_id`

URL-encode filter state via `use-prms` (per existing elvis
conventions). E.g. `/mp?split=train&min_e=100&max_e=500`.

### Visualizations

1. **Scatter** (n_atoms × n_electrons), default. Color by split.
   Hover shows mp_id; click loads the material in the existing
   viewer (`?m=<mp_id>`).
2. **Histograms** of n_electrons, n_atoms, grid_size — toggleable
   alternative views. Side panel or tab.
3. **3D grid scatter** (nx × ny × nz) — optional, if it surfaces
   anything interesting.

### Row interaction

Clicking a table row or scatter point sets `?m=<mp_id>` (or task-id
via the existing material-search-completions mapping). The current
viewer takes over. Page state preserved on back-navigate.

## Phasing

**Phase A — minimum viable**
- [ ] Fetch + load `s3://openathena/mpdb/v2/mpdb.sqlite` via sql.js
- [ ] Virtualized table (mp_id, split, n_atoms, n_electrons, grid, n_voxels)
- [ ] Search + n_atoms / n_electrons range filters, URL-encoded
- [ ] Click row → load via existing `?m=` flow

**Phase B — visualization**
- [ ] Scatter (n_atoms × n_electrons), colored by split
- [ ] Hover tooltip + click-to-load
- [ ] Histogram tab(s)

**Phase C — polish**
- [ ] Grid-dim filtering
- [ ] Stratified stats by split (means, percentiles)
- [ ] Optional 3D nx×ny×nz scatter

## Coordination with existing specs

- `material-search-completions.md`: omnibar uses unified
  `materials.json` across corpora. `/mp` reads MPDB *directly*
  (specific to tomat's training subset) — orthogonal data sources.
  Cross-link: `/mp` page can link to omnibar for cross-corpus
  search; omnibar can link to `/mp?search=<id>` for tomat-context
  inspection.

## Open questions

- sql.js bundle size — confirm it fits within elvis's existing app
  weight budget. If not, switch to tomat-published JSON sibling
  (cheap to add: ~2 MB JSON + on-the-fly filtering in JS).
- Test split: the current MPDB v2 has none. Either (a) wait for
  tomat to backfill test n_atoms/n_electrons + bump to v3, or (b)
  ship `/mp` with train+val only and add test on next bump. Lean
  (b) — train+val is plenty to demo, and the bump cost is ~5 lines
  of UI.
- Whether `/mp` should also pull tokenization metadata
  (cube_seq_pN per-mat at training P) for explaining context-length
  decisions. Probably yes for Phase C (debug usefulness), defer.
