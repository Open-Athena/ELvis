# Spec: Condensed Diff URLs (`?s3=` shorthand) + Factored Drawer Display

## Context

`?v0=`/`?v1=` lets users override diff operands with arbitrary URLs, but the explicit
form is verbose. The Si₂ example:

```
?src=diff&heat=1&zarr=1
&v0=s3://openathena/electrai/zarr/mp-2375705-label.zarr/
&v1=s3://openathena/electrai/zarr/mp-2375705-input.zarr/
```

The two URLs differ in one token (`label`/`input`); ~95% of the chars are duplicated.
`?m=mp-X` already covers the manifest case in 14 chars, but explicit overrides exist
precisely for **non**-manifest URLs (custom checkpoints, ad-hoc paths) — exactly where
URL length matters most for sharing.

In parallel, the drawer renders v0/v1 as two full-width inputs even when the strings
are 95% identical, wasting visual space and making it hard to spot the differing token.

## Goals

1. Add a shorthand URL form that factors common prefix/suffix between the two operands.
2. Mirror that factoring in the drawer when the operands share enough structure.
3. Keep the explicit `?v0=`/`?v1=` form working unchanged (it remains the source of
   truth when sources don't share structure).

Out of scope:
- Generalizing beyond 2 operands (no 3-way diff).
- Cross-bucket / cross-scheme expansion (assume both sides share scheme).

## 1. URL form: single `?s3=` param with two expansion modes

### 1a. Brace expansion `{a,b}` — pure string, no network

```
?s3=openathena/electrai/zarr/mp-2375705-{input,label}.zarr/
```

Expands to:
- v0 = `s3://openathena/electrai/zarr/mp-2375705-label.zarr/`
- v1 = `s3://openathena/electrai/zarr/mp-2375705-input.zarr/`

Rules:
- Param value implicitly has `s3://` prepended (the param name *is* `s3`, so the
  scheme is redundant in the value). Stored as-is in URL state, normalized at the
  expansion boundary.
- Exactly one `{...,...}` group with exactly 2 comma-separated parts. Any other shape
  (zero groups, multiple groups, ≠2 parts) is a user error → show in `fetchStatus`,
  fall back to no diff.
- v0 = first part, v1 = second part. Ordering is up to the user (they wrote it).
  Diff is `|v0 − v1|` so ordering doesn't affect math; it affects the title (`|v0 − v1|`
  vs `|Label − Input|`).

### 1b. Prefix / glob expansion — uses S3 LIST

Two related forms, same underlying mechanism:

**Trailing prefix (implicit `*`)** — shortest:
```
?s3=openathena/electrai/zarr/mp-2375705-
```

**Mid-string glob** — for varying a non-tail path component:
```
?s3=openathena/electrai/zarr/runs/*/mp-2375705-input.zarr/
```

Both expand by:
1. Splitting at `*` (or treating end-of-string as `*` for the prefix form):
   `prefix = ...mp-2375705-`, `suffix = ''` for the prefix form.
2. S3 `ListObjectsV2` with `Bucket=openathena`, `Prefix=<key portion of prefix>`,
   `Delimiter=/` — returns top-level "directories" (Zarr stores are prefixes).
3. Filter: keep `CommonPrefixes` whose tail ends with `suffix` (no-op when `suffix=''`).
4. Sort alphabetically. For exactly 2 matches: v0 = sort[0], v1 = sort[1].
   For ≠2 matches, surface count + matches in `fetchStatus`; don't load.

Implementation: extend the existing `S3Client` (already in `fetch-volume.ts`, signed
with creds from LS via `loadCredentials()`) with a `ListObjectsV2Command` call.
Anonymous-list path: try unsigned first (cheap; works when the bucket allows it);
on 403, fall back to creds-signed if available, else CTA → `AWSCredentialsModal`.

Future: a Cloudflare Worker BE could front the LIST calls with bucket-side IAM,
removing the need for end-user creds entirely. Out of scope here, but the
`expandS3Pattern` API surface is the same either way (replace direct S3 call with
worker fetch).

Constraint: exactly one `*` (or implicit trailing). Multiple `*`s → Cartesian product
not supported; reject.

### 1c. Auto-detection precedence

Single param `?s3=<value>`, three cases:

| Case | Detection | Action |
|---|---|---|
| Contains `{...,...}` | brace match | string-expand (1a) |
| Contains `*`, *or* doesn't end in a specific object key | glob / prefix LIST | S3 list (1b) |
| Else | literal full key | error in diff mode (single URL can't diff) |

"Doesn't end in a specific object key" heuristic: ends with `/` or with a path
segment that doesn't look like a final filename (e.g. no `.zarr/` / `.json` / etc.
suffix). Concretely: if the value is a plain prefix that doesn't already match a
known full-object shape, treat as prefix LIST. The detection can be loose because
"unintended LIST" is non-destructive — worst case is a clear "expected 2 matches,
got N" error.

`{` and `*` are mutually exclusive — reject if both are present.

### 1d. Interaction with `?v0=` / `?v1=`

Precedence (highest first):
1. `?v0=` and/or `?v1=` (explicit overrides — current behavior)
2. `?s3=<pattern>` (this spec)
3. `?m=<id>` auto-resolve from manifest

If `?s3=` and `?v0=`/`?v1=` are both present: explicit operands win, `?s3=` is ignored.
This keeps the URL deterministic (explicit ≻ shorthand) and makes the drawer's
"flatten to explicit" toggle (see §2) trivially correct — it just clears `?s3=` and
sets `?v0=`/`?v1=` from the expansion.

### 1e. URL-encoding caveat (worth measuring)

`{`, `}`, `,`, `*` get percent-encoded in many contexts. The "short" form
`?s3=...{a,b}.zarr/` may render as `?s3=...%7Ba%2Cb%7D.zarr%2F` after copy/paste
through Slack/Notion/etc.

The trailing-prefix form (§1b) sidesteps this entirely — only `/` and ASCII letters,
all RFC-3986-unreserved or `pchar`-allowed; should round-trip cleanly. So the prefix
form gets us the URL-shortening win even if braces and `*` don't survive paste.
Action: confirm with one Slack paste before merging; if braces survive, ship them
for the "vary a non-tail component" niche; if not, lean exclusively on prefix +
glob `*` (which is `sub-delim`-permitted and tends to survive).

## 2. Drawer condensed display

Currently `DiffSources` renders v0 and v1 as two unconditional full-width text inputs.
When the strings are 95% identical, this is wasteful and obscures the actual difference.

### 2a. Auto-factor on render

When `v0` and `v1` are both non-empty, compute the longest common prefix and longest
common suffix between them. If the *factored* representation is meaningfully shorter
than the explicit one (heuristic: combined prefix+suffix length ≥ 50% of either URL,
or ≥ 30 chars), render in **factored mode**:

```
┌─ Diff sources ────────────────────────┐
│ s3://openathena/electrai/zarr/mp-…    │   ← shared prefix (truncated middle on overflow)
│   ├── label.zarr/                     │   ← v0 tail, editable inline
│   └── input.zarr/                     │   ← v1 tail, editable inline
│   …-2375705-                          │   ← shared suffix (if present, shown above tails)
│ [⇄ swap] [↺ reset] [✏ edit full]      │
└───────────────────────────────────────┘
```

Editing a tail inline updates the corresponding `v0` / `v1` URL state. When the user's
edit causes the prefix/suffix to no longer match (e.g. they paste a different domain
into one tail), auto-fall-back to explicit two-input mode on the next render.

### 2b. Explicit mode (current UX)

When the URLs don't factor (`commonPrefix` + `commonSuffix` too short) or the user
clicked "✏ edit full", render the existing two-row form:

```
v0  [s3://openathena/electrai/zarr/mp-2375705-label.zarr/  ] ↺
v1  [s3://openathena/electrai/zarr/mp-2375705-input.zarr/  ] ↺
                                              [⇄ swap]
```

A persistent toggle in the section header (or just an icon) lets users force one
mode or the other. Default is auto.

### 2c. Sync with `?s3=`

If the URL was loaded with `?s3=<pattern>` and the user hasn't manually edited:
- Drawer stays in factored mode by default.
- Editing a tail flushes `?s3=` → sets explicit `?v0=`/`?v1=`. (Pattern-edit UX is
  out of scope; we don't try to preserve the brace/glob form on edit.)

If the URL was loaded with explicit `?v0=`/`?v1=` that *happen* to factor:
- Drawer offers factored mode but stays in explicit mode by default. Click the toggle
  to factor; click again to go back. (Conservative: don't surprise users by
  re-rendering their explicit URLs in a form they didn't ask for.)

## 3. Implementation sketch

### 3a. URL state additions (`App.tsx`)

```ts
const [s3Pattern, setS3Pattern] = useUrlState('s3', stringParam(''))
```

`expandS3Pattern(pattern)` → returns `{ v0?: string; v1?: string; error?: string }`:
- Detect mode (brace / glob / literal / invalid).
- For brace: pure synchronous string split.
- For glob: async, calls `listS3Prefix(bucket, prefix)`.

In the existing diff effect, before falling back to manifest auto-resolve:
```ts
if (!v0Url && !v1Url && s3Pattern) {
  const expanded = await expandS3Pattern(s3Pattern)
  if (expanded.error) { setFetchStatus(expanded.error); return }
  // use expanded.v0/v1 in place of v0Url/v1Url
}
```

### 3b. New utility: `pkgs/core/src/utils/s3-pattern.ts`

```ts
export type S3Expansion =
  | { kind: 'brace'; v0: string; v1: string }       // fully resolved sync
  | { kind: 'glob'; prefix: string; suffix: string } // async LIST required
  | { kind: 'error'; reason: string }

export function parseS3Pattern(value: string): S3Expansion
```

Brace fully resolves synchronously. Glob (and trailing-prefix, which produces
`{prefix, suffix: ''}`) returns the prefix/suffix pair for async resolution by
the caller.

### 3c. New utility: `listS3Prefix(bucket, prefix)`

Lives in `pkgs/static/src/utils/s3-list.ts` (alongside `s3UriToHttps`). Uses the
existing `S3Client` from `@aws-sdk/client-s3` with `ListObjectsV2Command`,
`Delimiter=/`, returning `CommonPrefixes`. Try unsigned first; on 403 retry with
`AWSCredentials` from `loadCredentials()` if available; else surface 403 with
CTA to open `AWSCredentialsModal`.

### 3d. Drawer changes (`DiffSources.tsx`)

- Compute `factor(v0, v1) → { prefix, tail0, tail1, suffix }`.
- Render factored or explicit based on the rule in §2.
- Persist mode preference in `localStorage` (key `elvis.diffSources.mode`:
  `'auto' | 'factored' | 'explicit'`).

## 4. Decisions to make during impl

- **Anonymous LIST on `openathena` bucket:** curl-test before shipping. If it
  works → trailing-prefix Just Works for everyone. If it doesn't → users without
  creds entered get a clear "creds required" CTA via `AWSCredentialsModal`. (The
  CFW-BE future further down the road removes that friction entirely.)
- **`{` / `}` survival through Slack and GitHub:** one paste-and-check. Prefix
  form (§1b) sidesteps this anyway, so brace support is opportunistic.
- **Factored-mode threshold:** the 50%-or-30-char rule is a guess. After
  implementing, eyeball a handful of real diff URLs and tune.

## 5. Phasing

- **Phase A (this PR):** brace expansion (`?s3=...{a,b}...`) + drawer factored
  display. Zero network deps; ships the URL-shortening win for the most common case.
- **Phase B (follow-up, likely same PR if anon LIST works):** prefix + glob
  expansion via S3 LIST. Reuses the existing S3Client + creds-from-LS plumbing.
- **Phase C (later):** Cloudflare Worker BE fronting LIST (and probably GET too,
  for cache-control), removes end-user creds-in-LS friction. Out of scope here.
