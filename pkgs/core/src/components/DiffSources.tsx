import { useState, useEffect, useCallback } from 'react'

interface DiffSourcesProps {
  /** Current explicit URL override for v0; empty means "use v0Default". */
  v0Url: string
  v1Url: string
  /** Auto-resolved default URLs (label/input) used when v0Url/v1Url are empty. */
  v0Default: string
  v1Default: string
  onV0Change: (url: string) => void
  onV1Change: (url: string) => void
}

const COMMIT_MS = 500

function basename(url: string): string {
  if (!url) return ''
  const u = url.replace(/\/$/, '')
  const i = u.lastIndexOf('/')
  return i >= 0 ? u.slice(i + 1) : u
}

function Row({ label, value, defaultValue, onChange }: {
  label: string
  value: string
  defaultValue: string
  onChange: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  // Debounced commit: writes to URL state COMMIT_MS after typing stops.
  useEffect(() => {
    if (draft === value) return
    const t = setTimeout(() => onChange(draft), COMMIT_MS)
    return () => clearTimeout(t)
  }, [draft, value, onChange])

  const isOverride = !!value
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
      <span style={{ width: 22, color: '#aaa', fontSize: 11, fontFamily: 'system-ui' }}>{label}</span>
      <input
        type="text"
        value={draft}
        placeholder={defaultValue}
        onChange={e => setDraft(e.target.value)}
        style={{
          flex: 1,
          padding: '4px 6px',
          background: '#2a2a3e',
          border: '1px solid #444',
          borderRadius: 3,
          color: '#eee',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontSize: 11,
          outline: 'none',
          minWidth: 0,
        }}
        title={isOverride ? `Override: ${value}` : `Auto: ${defaultValue || '(unresolved)'}`}
      />
      <button
        type="button"
        onClick={() => { setDraft(''); onChange('') }}
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

export function DiffSources({
  v0Url, v1Url, v0Default, v1Default,
  onV0Change, onV1Change,
}: DiffSourcesProps) {
  const swap = useCallback(() => {
    const eff0 = v0Url || v0Default
    const eff1 = v1Url || v1Default
    onV0Change(eff1)
    onV1Change(eff0)
  }, [v0Url, v1Url, v0Default, v1Default, onV0Change, onV1Change])

  const resetAll = useCallback(() => {
    onV0Change('')
    onV1Change('')
  }, [onV0Change, onV1Change])

  const anyOverride = !!(v0Url || v1Url)

  return (
    <div style={{ borderBottom: '1px solid #333', padding: '6px 16px 8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: '#aaa', fontSize: 12, fontWeight: 600 }}>
          Diff sources <span style={{ color: '#666', fontWeight: 400 }}>|v0 − v1|</span>
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={swap}
            title={`Swap v0 ↔ v1 (current: |${basename(v0Url || v0Default)} − ${basename(v1Url || v1Default)}|)`}
            style={{
              padding: '2px 6px', fontSize: 11, background: 'transparent',
              border: '1px solid #444', borderRadius: 3, color: '#aaa', cursor: 'pointer',
            }}
          >⇄</button>
          <button
            type="button"
            onClick={resetAll}
            disabled={!anyOverride}
            title="Reset both rows to auto-resolved (label / input)"
            style={{
              padding: '2px 6px', fontSize: 10, background: 'transparent',
              border: '1px solid #444', borderRadius: 3,
              color: anyOverride ? '#aaa' : '#555',
              cursor: anyOverride ? 'pointer' : 'default',
            }}
          >Reset</button>
        </div>
      </div>
      <Row label="v0" value={v0Url} defaultValue={v0Default} onChange={onV0Change} />
      <Row label="v1" value={v1Url} defaultValue={v1Default} onChange={onV1Change} />
    </div>
  )
}
