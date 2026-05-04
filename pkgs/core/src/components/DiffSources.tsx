import { useState, useEffect, useCallback, useMemo } from 'react'
import { factorPair } from '../utils/s3-pattern.ts'

interface DiffSourcesProps {
  /** Current explicit URL override for v0; empty means "use v0Default". */
  v0Url: string
  v1Url: string
  /** Auto-resolved default URLs (from `?s3=` brace expansion or manifest auto). */
  v0Default: string
  v1Default: string
  /** Current `?s3=` pattern value (empty if unset). */
  s3Pattern: string
  onV0Change: (url: string) => void
  onV1Change: (url: string) => void
  onS3PatternChange: (pattern: string) => void
}

const COMMIT_MS = 500
const MODE_KEY = 'elvis.diffSources.mode'
type Mode = 'auto' | 'factored' | 'explicit'

function basename(url: string): string {
  if (!url) return ''
  const u = url.replace(/\/$/, '')
  const i = u.lastIndexOf('/')
  return i >= 0 ? u.slice(i + 1) : u
}

function loadMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    if (v === 'factored' || v === 'explicit' || v === 'auto') return v
  } catch { /* localStorage unavailable */ }
  return 'auto'
}

function saveMode(m: Mode) {
  try { localStorage.setItem(MODE_KEY, m) } catch { /* localStorage unavailable */ }
}

/** Debounced text input that commits to a parent onChange after typing stops. */
function DebouncedInput({ value, onCommit, placeholder, monospace = true, style, title }: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  monospace?: boolean
  style?: React.CSSProperties
  title?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => {
    if (draft === value) return
    const t = setTimeout(() => onCommit(draft), COMMIT_MS)
    return () => clearTimeout(t)
  }, [draft, value, onCommit])
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      title={title}
      style={{
        padding: '4px 6px',
        background: '#2a2a3e',
        border: '1px solid #444',
        borderRadius: 3,
        color: '#eee',
        fontFamily: monospace ? 'ui-monospace, SFMono-Regular, monospace' : 'system-ui',
        fontSize: 11,
        outline: 'none',
        minWidth: 0,
        ...style,
      }}
    />
  )
}

/** Two-row explicit form: full URL inputs for v0 and v1. */
function ExplicitRows({ v0Url, v1Url, v0Default, v1Default, onV0Change, onV1Change }: {
  v0Url: string
  v1Url: string
  v0Default: string
  v1Default: string
  onV0Change: (v: string) => void
  onV1Change: (v: string) => void
}) {
  return (
    <>
      <ExplicitRow label="v0" value={v0Url} defaultValue={v0Default} onChange={onV0Change} />
      <ExplicitRow label="v1" value={v1Url} defaultValue={v1Default} onChange={onV1Change} />
    </>
  )
}

function ExplicitRow({ label, value, defaultValue, onChange }: {
  label: string
  value: string
  defaultValue: string
  onChange: (v: string) => void
}) {
  const isOverride = !!value
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
      <span style={{ width: 22, color: '#aaa', fontSize: 11, fontFamily: 'system-ui' }}>{label}</span>
      <DebouncedInput
        value={value}
        onCommit={onChange}
        placeholder={defaultValue}
        title={isOverride ? `Override: ${value}` : `Auto: ${defaultValue || '(unresolved)'}`}
        style={{ flex: 1 }}
      />
      <button
        type="button"
        onClick={() => onChange('')}
        disabled={!isOverride}
        title="Reset this row to auto-resolved URL"
        style={{
          padding: '2px 6px',
          background: 'transparent',
          border: '1px solid #444',
          borderRadius: 3,
          color: isOverride ? '#aaa' : '#555',
          fontSize: 10,
          cursor: isOverride ? 'pointer' : 'default',
        }}
      >↺</button>
    </div>
  )
}

/** Factored display: shared prefix/suffix shown once; only the differing tails are editable. */
function FactoredRows({
  v0Eff, v1Eff, prefix, suffix, tail0, tail1,
  onV0Change, onV1Change,
}: {
  v0Eff: string
  v1Eff: string
  prefix: string
  suffix: string
  tail0: string
  tail1: string
  onV0Change: (v: string) => void
  onV1Change: (v: string) => void
}) {
  const sharedStyle: React.CSSProperties = {
    color: '#777',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontSize: 11,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    direction: 'ltr',
  }
  return (
    <>
      <div title={prefix} style={{ ...sharedStyle, marginBottom: 2 }}>{prefix}</div>
      <FactoredRow
        label="v0"
        tail={tail0}
        onCommit={(t) => onV0Change(prefix + t + suffix)}
        title={v0Eff}
      />
      <FactoredRow
        label="v1"
        tail={tail1}
        onCommit={(t) => onV1Change(prefix + t + suffix)}
        title={v1Eff}
      />
      {suffix && (
        <div title={suffix} style={{ ...sharedStyle, direction: 'rtl', textAlign: 'left', marginTop: 2 }}>{suffix}</div>
      )}
    </>
  )
}

function FactoredRow({ label, tail, onCommit, title }: {
  label: string
  tail: string
  onCommit: (v: string) => void
  title?: string
}) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, paddingLeft: 16 }}>
      <span style={{ width: 18, color: '#aaa', fontSize: 11, fontFamily: 'system-ui' }}>{label}</span>
      <DebouncedInput
        value={tail}
        onCommit={onCommit}
        title={title}
        style={{ flex: 1, width: 'auto' }}
      />
    </div>
  )
}

export function DiffSources({
  v0Url, v1Url, v0Default, v1Default, s3Pattern,
  onV0Change, onV1Change, onS3PatternChange,
}: DiffSourcesProps) {
  const [mode, setMode] = useState<Mode>(() => loadMode())
  const cycleMode = useCallback(() => {
    const next: Mode = mode === 'auto' ? 'factored' : mode === 'factored' ? 'explicit' : 'auto'
    setMode(next)
    saveMode(next)
  }, [mode])

  const v0Eff = v0Url || v0Default
  const v1Eff = v1Url || v1Default
  const factor = useMemo(() => factorPair(v0Eff, v1Eff), [v0Eff, v1Eff])

  // 'auto' lets factor.worthFactoring decide; 'factored'/'explicit' force the mode.
  // If user forces 'factored' but no factoring is possible, fall back to explicit silently.
  const effectiveMode: 'factored' | 'explicit' =
    mode === 'explicit' ? 'explicit'
    : mode === 'factored' ? (factor.worthFactoring ? 'factored' : 'explicit')
    : (factor.worthFactoring ? 'factored' : 'explicit')

  const swap = useCallback(() => {
    onV0Change(v1Eff)
    onV1Change(v0Eff)
  }, [v0Eff, v1Eff, onV0Change, onV1Change])

  const resetAll = useCallback(() => {
    onV0Change('')
    onV1Change('')
  }, [onV0Change, onV1Change])

  const anyOverride = !!(v0Url || v1Url)
  const modeLabel = mode === 'auto' ? 'auto' : mode === 'factored' ? 'factor' : 'full'

  return (
    <div style={{ borderBottom: '1px solid #333', padding: '6px 16px 8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: '#aaa', fontSize: 12, fontWeight: 600 }}>
          Diff sources <span style={{ color: '#666', fontWeight: 400 }}>v1 − v0</span>
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={cycleMode}
            title={`Display: ${mode}. Click to cycle (auto → factor → full)`}
            style={{
              padding: '2px 6px', fontSize: 10, background: 'transparent',
              border: '1px solid #444', borderRadius: 3, color: '#aaa', cursor: 'pointer',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            }}
          >{modeLabel}</button>
          <button
            type="button"
            onClick={swap}
            title={`Swap v0 ↔ v1 (current: |${basename(v0Eff)} − ${basename(v1Eff)}|)`}
            style={{
              padding: '2px 6px', fontSize: 11, background: 'transparent',
              border: '1px solid #444', borderRadius: 3, color: '#aaa', cursor: 'pointer',
            }}
          >⇄</button>
          <button
            type="button"
            onClick={resetAll}
            disabled={!anyOverride}
            title="Reset both rows to auto-resolved (input / label)"
            style={{
              padding: '2px 6px', fontSize: 10, background: 'transparent',
              border: '1px solid #444', borderRadius: 3,
              color: anyOverride ? '#aaa' : '#555',
              cursor: anyOverride ? 'pointer' : 'default',
            }}
          >Reset</button>
        </div>
      </div>

      {/* Pattern row: shorthand `?s3=` input. Always visible when in diff mode, since
          edits here flow through to the v0/v1 defaults via brace expansion. */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <span style={{ width: 22, color: '#aaa', fontSize: 11, fontFamily: 'system-ui' }} title="?s3= shorthand: brace `{a,b}` expands client-side; `*`/prefix LIST coming in Phase B">s3</span>
        <DebouncedInput
          value={s3Pattern}
          onCommit={onS3PatternChange}
          placeholder="bucket/key/foo-{input,label}.zarr/"
          title={s3Pattern ? `Pattern: ${s3Pattern}` : 'Optional shorthand pattern. e.g. openathena/electrai/zarr/mp-X-{input,label}.zarr/'}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={() => onS3PatternChange('')}
          disabled={!s3Pattern}
          title="Clear pattern"
          style={{
            padding: '2px 6px',
            background: 'transparent',
            border: '1px solid #444',
            borderRadius: 3,
            color: s3Pattern ? '#aaa' : '#555',
            fontSize: 10,
            cursor: s3Pattern ? 'pointer' : 'default',
          }}
        >↺</button>
      </div>

      {effectiveMode === 'factored' ? (
        <FactoredRows
          v0Eff={v0Eff}
          v1Eff={v1Eff}
          prefix={factor.prefix}
          suffix={factor.suffix}
          tail0={factor.tail0}
          tail1={factor.tail1}
          onV0Change={onV0Change}
          onV1Change={onV1Change}
        />
      ) : (
        <ExplicitRows
          v0Url={v0Url}
          v1Url={v1Url}
          v0Default={v0Default}
          v1Default={v1Default}
          onV0Change={onV0Change}
          onV1Change={onV1Change}
        />
      )}
    </div>
  )
}
