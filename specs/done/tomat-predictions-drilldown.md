# Spec — tomat predictions drill-down

**Status**: Option B landed (commit `aeff80b`). Companion to tomat's
`specs/51-eval-pred-r2-elvis-drilldown.md`.

## Implementation notes (what shipped)

- `pkgs/static/src/utils/fetch-volume.ts` exports `toFetchUrl(uri)`:
  `s3://...` → anonymous HTTPS rewrite; `http(s)://...` →
  pass-through; else throw. The original `s3UriToHttps` is kept
  for callers that know the URI is `s3://`.
- `pkgs/static/src/App.tsx` uses `toFetchUrl` at the diff
  zarr-fetch (lines 1226-1227) and the single-volume zarr loader
  (line 1294). The non-zarr CHGCAR paths still take `s3://`
  explicitly (credentialed `fetchVolumeFromS3` / `fetchVolumeJsonGz`).
- Verified locally: `?v0=https://example.invalid/gt.zarr/&v1=https://example.invalid/pred.zarr/&src=diff`
  fires real network requests at the literal HTTPS URLs (fails with
  "Failed to fetch", not "Invalid S3 URI").

**Diff convention drift to confirm with tomat side.** Spec below
phrases the diff as `|GT − pred|` (abs). Current elvis code is
*signed* `v1 − v0` (per `App.tsx:1236-1239`, since `1650d37`/`a141f17`).
With the spec's prescribed `v0=GT, v1=pred` mapping, the actual
rendered diff is `pred − GT` → green where pred overpredicts,
red where pred underpredicts. Tomat side should pick the v0/v1
ordering deliberately based on which colour story it wants.

## Goal

Render tomat's predicted charge densities as v0/v1 operands in
elvis's existing diff mode, fetched from Cloudflare R2 over plain
HTTPS.

## Background

Tomat persists per-mat per-checkpoint predicted ρ as zarrs at
`s3://openathena/tomat/eval/<run>/predictions/<set><mode>/<step>/<mp_id>.zarr/`
(R2). Schema mirrors `gs://.../rho_gga_raw/<mp_id>.zarr/` so
elvis's existing CHGCAR renderer handles them transparently.

The tomat run-detail page renders per-mat rows with two elvis
link-outs:

- `?m=<mp_id>` → existing per-mat view (renders GT only)
- `?v0=<gt-url>&v1=<pred-url>&src=diff` → renders `|GT - pred|`

The diff path is what this spec is about — confirm or enable it
end-to-end.

## What's already in place

(SA-confirmed; see tomat spec for source-line refs.)

- `pkgs/static/src/App.tsx:251-287` — `?src=diff` URL param, plus
  `?v0=`/`?v1=` operand overrides, plus condensed `?s3=…{a,b}…`
  brace pattern.
- `pkgs/core/src/components/DiffSources.tsx` — drawer-side selector
  for v0/v1.
- `pkgs/core/src/components/ComparisonView.tsx` — present.
- `pkgs/static/src/utils/fetch-volume.ts` — `s3UriToHttps()` maps
  `s3://<bucket>/<key>` → `https://<bucket>.s3.amazonaws.com/<key>`.
  AWS-SDK is used for signed access.

## What's missing

`s3UriToHttps` only knows AWS endpoints. R2's S3-compat lives at
`https://<account>.r2.cloudflarestorage.com/<bucket>/<key>` or
behind a custom domain (e.g. `data.tomat.oa.dev`). Three options:

### Option A — explicit `r2://` scheme

Add `r2://<bucket>/<key>` to fetch-volume.ts:

```ts
function r2UriToHttps(uri: string): string {
  const m = uri.match(/^r2:\/\/([^/]+)\/(.+)$/)
  if (!m) throw new Error(`bad r2:// URI: ${uri}`)
  const [, bucket, key] = m
  return `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${key}`
}
```

Pros: explicit, mirrors `s3UriToHttps` pattern.
Cons: hardcodes R2_ACCOUNT_ID in elvis (small leak; account ID
already public-knowable from R2 URLs).

### Option B — raw HTTPS pass-through

`fetch-volume.ts` already calls `fetch()`. If a URL starts with
`https://`, skip the URI rewrite entirely. Tomat then provides
fully-qualified R2 URLs in its `v0`/`v1` query params.

Pros: zero elvis-side knowledge of R2; just "URL".
Cons: misses the symmetry with the `s3://` shortener; long URLs
in query params.

### Option C — CNAME + raw HTTPS

Same as B, but tomat puts R2 behind `data.tomat.oa.dev` (CF custom
domain). URLs become short and project-branded.
`v1=https://data.tomat.oa.dev/eval/<run>/predictions/...`.

Recommend **C** if the CF custom-domain is cheap to set up
(it is — single DNS record + CF binding), else **B**. Avoid A; it
puts R2-account specifics into elvis.

## Implementation

For (B) or (C):

1. In `pkgs/static/src/utils/fetch-volume.ts`, branch in the URI →
   URL resolver:
   - `s3://…` → existing `s3UriToHttps`
   - `https://…` → pass through unchanged
2. In `pkgs/static/src/App.tsx` `?v0=`/`?v1=` parsing, accept
   `https://…` values (or be a no-op if the URL is already
   plain HTTPS).
3. CORS: zarr group fetches load multiple small `.zarray` /
   `.zattrs` / chunk files concurrently. Confirm R2 / custom-domain
   replies with `Access-Control-Allow-Origin: *` (or the elvis
   origin). Worth a CFW config check; default R2 CORS is
   permissive on public buckets.

## Acceptance test

1. Manually publish a single mp_id's predicted ρ to R2 at the
   spec'd path.
2. Open `https://elvis.oa.dev/?v0=<gt-url>&v1=<pred-url>&src=diff`.
3. See diff rendered (orange-red where prediction is off).
4. Drawer's "v0" and "v1" labels populate from the URLs.

## Open questions

- Custom-domain naming: `data.tomat.oa.dev` vs `r2.tomat.oa.dev` vs
  put everything under `tomat.oa.dev/data/...` via a CFW route.
  Tomat side picks; elvis just needs to accept whatever URL.
- Long-term: should elvis grow a native `tomat://<run>/<set>/<step>/<mp_id>`
  scheme that resolves to GT + pred URLs internally? Defer until a
  second consumer needs the abstraction.

## Out of scope

- Side-by-side 3-pane viewer (GT | pred | diff). Phase B.
- Diff-mode color-mapping tweaks for charge-density-specific ranges.
  Today's `|v0 − v1|` rendering is fine for first cut.
