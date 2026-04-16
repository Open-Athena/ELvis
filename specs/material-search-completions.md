# Spec: Material Search Completions & `pkgs/corpora`

## Goal

Make ELvis a one-stop shop for **browsing, searching, and direct-loading** materials from several public and internal data corpora (Materials Project, ElectrAI pairs, OMOL, QM9, ...) via:

1. **Omnibar autocomplete** (`use-kbd`) — type-ahead search over MP ID, formula, chemsys, element sets; dataset badges; Enter loads the material.
2. **Paginated browse/filter table** — element chips, crystal-system filter, band-gap range, dataset-membership filter, sort. Rows load into the viewer.

Backed by a unified materials index stored in a new `pkgs/corpora/` workspace package.

## Key discovery — IDs in our S3 bucket are *task IDs*, not material IDs

`s3://openathena/electrai/{input,label,mp/chg_datasets/dataset_4/{data,label}}/mp-XXXXXXX.CHGCAR` — the `mp-XXXXXXX` on these filenames are **VASP task IDs**, not current-MP `material_id`s.

- Of our 3069 unique task IDs across all ElectrAI datasets, **zero** are in the current MP API.
- But all 3069 map 1-to-1 to **2771 unique current material IDs** via `task_id_to_material_id.json.gz` (on della at `/scratch/gpfs/ROSENGROUP/common/globus_share_OA/mp/metadata/`).
- Those 2771 material IDs return full metadata (formula, spacegroup, band_gap, elements, …) from the MP API.

Multiple task IDs collapsing to one material is expected — different DFT calculations (relaxations, static runs, etc.) of the same crystal.

### Implication for ELvis URLs

Current: `?m=mp-1775579` loads a CHGCAR named after a task ID. That's fine as-is for paired ElectrAI data (the S3 keys are task-ID-based), but search/display labels should show the **material ID + formula** as the human-facing identity.

Schema below tracks both so we can map either direction.

## `pkgs/corpora/` layout

```
pkgs/corpora/
  package.json              # @elvis/corpora workspace pkg
  tsconfig.json
  data/                     # Generated, committed JSON manifests
    materials.json          # Primary unified index (see schema below)
    datasets.json           # Per-corpus metadata (counts, licenses, source URIs)
  scripts/                  # Python ETL (uv run shebangs)
    fetch-della-metadata.py        # Pulls task_id↔material_id mappings from della
    fetch-mp-metadata.py           # Fetches MP API metadata for material IDs
    fetch-electrai-filelists.py    # Lists S3 prefixes; enumerates ElectrAI task IDs
    build-manifest.py              # Joins all sources → materials.json
  src/
    types.ts                # Shared TS types (MaterialRecord, CorpusId, ...)
    client.ts               # Zero-dep query helpers used by pkgs/static
  cf/                       # (Future) CF Worker + D1 sources; defer until needed
```

ETL scripts are run locally with `uv run` and check generated JSON into the repo. No build-time network dependencies.

## Unified `materials.json` schema

One record per **current material ID**. Each record tracks which corpora/datasets it belongs to, along with dataset-specific task-ID aliases (so ELvis can map `?m=mp-TASKID` → material record).

```jsonc
{
  "generated": "2026-04-16T...",
  "schema_version": 1,
  "corpora": { /* see datasets.json */ },
  "records": [
    {
      "id": "mp-11625",                         // current MP material_id
      "formula": "KCa(PO3)3",
      "elements": ["K", "Ca", "P", "O"],
      "chemsys": "Ca-K-O-P",
      "nelements": 4,
      "nsites": 48,
      "crystal_system": "Hexagonal",
      "spacegroup_symbol": "P6_3/m",
      "spacegroup_number": 176,
      "density": 2.845,
      "volume": 512.3,
      "band_gap": 5.047,
      "is_metal": false,
      "is_magnetic": false,
      "ordering": "NM",
      "theoretical": false,
      "datasets": {
        "electrai-205": { "task_ids": ["mp-1817843"], "has_input": true, "has_label": true },
        "dataset_4":    { "task_ids": ["mp-2477964", "mp-..."], "has_input": true, "has_label": true }
      }
    },
    // ...
  ]
}
```

### `datasets.json` (corpus definitions)

```jsonc
{
  "electrai-205": {
    "source": "s3://openathena/electrai/{input,label}/",
    "format": "CHGCAR",
    "paired": true,
    "count": 205,
    "description": "ElectrAI paired SAD input + DFT label (original 205-sample set)"
  },
  "dataset_4": {
    "source": "s3://openathena/electrai/mp/chg_datasets/dataset_4/{data,label}/",
    "format": "CHGCAR",
    "paired": true,
    "grid": [128, 128, 128],
    "count": 2885,
    "description": "ElectrAI 2885-sample uniform-grid set from MP dataset_4"
  },
  "mp-public": {
    "source": "s3://materialsproject-parsed/chgcars/",
    "format": "CHGCAR-json.gz",
    "paired": false,
    "count": 403917,
    "description": "Materials Project parsed CHGCAR bucket (all MP IDs with charge density)",
    "license": "CC BY 4.0"
  }
  // Future: "omol", "qm9", etc.
}
```

## Omnibar UX

- `/` (or chosen key) opens Omnibar with "Materials" source.
- Matches against `id`, `formula`, `chemsys`, `elements`, dataset task-IDs.
- Input shortcuts:
  - `mp-123` — prefix match on material ID
  - `Fe2O3` — formula match
  - `Fe O` or `Fe-O` — chemsys match
  - `e:...` — restrict to ElectrAI (has paired input/label)
  - `d4:...` — restrict to dataset_4
- Results show: `mp-11625  KCa(PO3)3  Hexagonal  [electrai-205]`
- Enter → existing `?m=` state updates + CHGCAR loads.

## Table browse view (`?view=browse` or modal)

- Columns: id, formula, crystal system, spacegroup, elements, band gap, datasets
- Multi-select element chips (Periodic-table picker or comma-separated text input)
- Crystal-system dropdown
- Band-gap range slider
- Dataset filter checkboxes (single-source: metal/theoretical etc. follow-ups)
- Click row → navigate to `/?m=<task_id>` (picks the first available task-ID from datasets priority order).
- URL-encode filter state (`?q=...&elems=Fe,O&cs=cubic&gap=0:2`).

## Phasing

**Phase 1 — `pkgs/corpora` data + Omnibar hook**
- [ ] Scaffold `pkgs/corpora/` package (package.json, tsconfig, dirs)
- [ ] `fetch-della-metadata.py`: copy needed mappings from della → `data/della-meta/`
- [ ] `fetch-electrai-filelists.py`: list S3 prefixes → `data/filelists/*.txt`
- [ ] `fetch-mp-metadata.py`: fetch MP summary for mapped material IDs
- [ ] `build-manifest.py`: join everything → `data/materials.json` + `data/datasets.json`
- [ ] `src/types.ts`, `src/client.ts` — lightweight query helpers
- [ ] Wire Omnibar in `pkgs/static` to call the client; Enter sets `?m=`

**Phase 2 — Table browse view**
- [ ] New `BrowseTable` component (virtualized row list, 2771+ entries)
- [ ] Filter UI (element chips, crystal-system, band-gap, dataset)
- [ ] URL state via `use-prms`

**Phase 3 — Additional corpora**
- [ ] `mp-public` — full MP index (~400K materials) from `s3://materialsproject-parsed` via parquet metadata ETL (only metadata, not CHGCAR blobs)
- [ ] `omol` — [Open Molecules 2025](https://huggingface.co/datasets/facebook/OMol25) — separate pipeline, molecular not crystalline; likely a new viewer mode
- [ ] `qm9` — small-molecule dataset, HuggingFace/other
- [ ] Per-corpus licensing badges (MP CC BY 4.0; GNoME CC BY-NC excluded by default)

**Phase 4 (optional) — CF Worker + D1 API**
- When `materials.json` crosses the "too big to bundle" threshold (~5–10 MB compressed?), or when we want other OA tools to query the same index.
- `pkgs/corpora/cf/` Worker exposes `GET /materials?filter=...` backed by D1.
- ETL scripts are repurposed to populate D1 (via `wrangler d1 execute`).

## Licensing / attribution

- **MP**: CC BY 4.0 — permitted to cache/redistribute with attribution. UI adds "Materials Project data under CC BY 4.0" credit (link).
- **GNoME subset**: CC BY-NC — filter out unless we have explicit commercial-exclusion handling.
- **OMOL**: Check HF dataset card (Meta/FAIR, Apache 2 or similar likely).

## Open questions

- Should we treat task-IDs as first-class in URLs, or rewrite `?m=mp-TASKID` → `?m=mp-MATID&task=...`? Status-quo (task-ID URLs) is simplest for paired ElectrAI data, where the task-ID *is* the S3 filename.
- Prefer embedding full materials.json (2771 records ≈ 500 KB JSON, <150 KB gzipped) vs. a split (metadata-only vs. dataset-membership) vs. a tiny bootstrap + lazy chunks?
- Omnibar vs. dedicated modal: use `LookupModal` from `use-kbd` or build a custom component that can also show per-result badges?
