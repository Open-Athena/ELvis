/**
 * Parse a condensed `?s3=` pattern into a brace-expanded operand pair
 * (sync) or a glob-needing-LIST descriptor (async; Phase B).
 *
 * Forms:
 *   `bucket/key/foo-{label,input}.zarr/`  → brace, sync expand
 *   `bucket/key/runs/star-here/foo-input.zarr/`  → glob, LIST required
 *   `bucket/key/foo-`                     → trailing prefix (= glob with suffix='')
 */

export type S3Expansion =
  | { kind: 'brace'; v0: string; v1: string }
  | { kind: 'glob'; prefix: string; suffix: string }
  | { kind: 'error'; reason: string }

const S3_SCHEME = 's3://'

function stripScheme(s: string): string {
  return s.startsWith(S3_SCHEME) ? s.slice(S3_SCHEME.length) : s
}

function withScheme(s: string): string {
  return s.startsWith(S3_SCHEME) ? s : S3_SCHEME + s
}

export function parseS3Pattern(value: string): S3Expansion | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const inner = stripScheme(trimmed)
  const hasBrace = /\{[^{}]*\}/.test(inner)
  const hasGlob = inner.includes('*')

  if (hasBrace && hasGlob) {
    return { kind: 'error', reason: 'Cannot mix `{a,b}` and `*` in `?s3=` pattern' }
  }

  if (hasBrace) {
    const groups = [...inner.matchAll(/\{([^{}]*)\}/g)]
    if (groups.length !== 1) {
      return { kind: 'error', reason: `Expected exactly 1 \`{...}\` group, got ${groups.length}` }
    }
    const parts = groups[0][1].split(',')
    if (parts.length !== 2) {
      return { kind: 'error', reason: `Expected 2 comma-separated parts in \`{...}\`, got ${parts.length}` }
    }
    const v0 = withScheme(inner.replace(/\{[^{}]*\}/, parts[0]))
    const v1 = withScheme(inner.replace(/\{[^{}]*\}/, parts[1]))
    return { kind: 'brace', v0, v1 }
  }

  if (hasGlob) {
    const idx = inner.indexOf('*')
    if (inner.indexOf('*', idx + 1) !== -1) {
      return { kind: 'error', reason: 'Multiple `*` not supported (Cartesian product)' }
    }
    return {
      kind: 'glob',
      prefix: withScheme(inner.slice(0, idx)),
      suffix: inner.slice(idx + 1),
    }
  }

  // No brace, no `*` → treat as trailing-prefix LIST (suffix = '').
  // Phase A: caller surfaces "needs LIST" since this branch isn't resolved sync.
  return { kind: 'glob', prefix: withScheme(inner), suffix: '' }
}

/** Longest common prefix length of two strings. */
export function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

/** Longest common suffix length of two strings. */
export function commonSuffixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++
  return i
}

export interface FactorResult {
  prefix: string
  suffix: string
  tail0: string
  tail1: string
  /** true when the factor saves enough chars to be worth rendering condensed. */
  worthFactoring: boolean
}

/** Factor two URLs into shared prefix/suffix and per-side tails. */
export function factorPair(v0: string, v1: string, minSavedChars = 30): FactorResult {
  const pre = commonPrefixLen(v0, v1)
  // Suffix can't overlap with prefix.
  const sufMax = Math.min(v0.length - pre, v1.length - pre)
  let suf = 0
  while (suf < sufMax && v0.charCodeAt(v0.length - 1 - suf) === v1.charCodeAt(v1.length - 1 - suf)) suf++
  const prefix = v0.slice(0, pre)
  const suffix = suf > 0 ? v0.slice(v0.length - suf) : ''
  const tail0 = v0.slice(pre, v0.length - suf)
  const tail1 = v1.slice(pre, v1.length - suf)
  const shared = pre + suf
  const minLen = Math.min(v0.length, v1.length) || 1
  const worthFactoring = !!v0 && !!v1 && shared >= minSavedChars && shared / minLen >= 0.5
  return { prefix, suffix, tail0, tail1, worthFactoring }
}
