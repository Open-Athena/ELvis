import { useEffect, useState, useMemo, useCallback } from 'react'
import { useUrlState, stringParam, intParam, optIntParam } from 'use-prms'
import type { Database } from 'sql.js'
import { fetchMpdb, queryMaterials, querySummary } from './mpdb/loader.ts'
import type { FilterState, MaterialRow, MpdbSummary } from './mpdb/loader.ts'
import { Scatter } from './mpdb/Scatter.tsx'

type Tab = 'table' | 'scatter'

interface MpPageProps {
  /** Called with an mp_id when the user clicks a row — parent flips `?view=` off
      and sets `?m=<mp_id>` to load the material in the main viewer. */
  onSelect: (mpId: string) => void
  /** Called when the user clicks "← back" or hits Escape. */
  onClose: () => void
}

const DEFAULT_URL = 'https://openathena.s3.amazonaws.com/mpdb/v2/mpdb.sqlite'

export function MpPage({ onSelect, onClose }: MpPageProps) {
  const [mpdbUrl] = useUrlState('mpdb', stringParam(DEFAULT_URL))
  const [tab, setTab] = useUrlState('mp_tab', stringParam('table')) as [Tab, (v: Tab) => void]
  const [search, setSearch] = useUrlState('mp_q', stringParam(''), { debounce: 300 })
  const [splitMask] = useUrlState('mp_s', intParam(0b1111))
  const [nAtomsMin, setNAtomsMin] = useUrlState('mp_aMin', optIntParam, { debounce: 300 })
  const [nAtomsMax, setNAtomsMax] = useUrlState('mp_aMax', optIntParam, { debounce: 300 })
  const [nElectronsMin, setNElectronsMin] = useUrlState('mp_eMin', optIntParam, { debounce: 300 })
  const [nElectronsMax, setNElectronsMax] = useUrlState('mp_eMax', optIntParam, { debounce: 300 })

  const [db, setDb] = useState<Database | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Decode splitMask bits → array. Bit 0=train, 1=val, 2=test, 3=unknown.
  const splits = useMemo<FilterState['splits']>(() => {
    const out: FilterState['splits'] = []
    if (splitMask & 1) out.push('train')
    if (splitMask & 2) out.push('val')
    if (splitMask & 4) out.push('test')
    if (splitMask & 8) out.push('unknown')
    return out
  }, [splitMask])

  const filter = useMemo<FilterState>(() => ({
    search: search ?? '',
    splits,
    nAtomsMin: nAtomsMin ?? null,
    nAtomsMax: nAtomsMax ?? null,
    nElectronsMin: nElectronsMin ?? null,
    nElectronsMax: nElectronsMax ?? null,
  }), [search, splits, nAtomsMin, nAtomsMax, nElectronsMin, nElectronsMax])

  // Load DB once.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchMpdb(mpdbUrl ?? DEFAULT_URL)
      .then(d => { if (!cancelled) { setDb(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [mpdbUrl])

  // Table caps at 5,000 rows (you scroll); scatter pulls all matching rows since
  // canvas can paint 80K dots cheaply and the value of the scatter is seeing the
  // whole distribution at once.
  const rowLimit = tab === 'scatter' ? 0 : 5000
  const rows = useMemo<MaterialRow[]>(() => db ? queryMaterials(db, filter, rowLimit) : [], [db, filter, rowLimit])
  const summary = useMemo<MpdbSummary | null>(() => db ? querySummary(db, filter) : null, [db, filter])

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0a0a14', color: '#ddd',
      display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif', zIndex: 100,
    }}>
      <Header
        loading={loading}
        error={error}
        summary={summary}
        search={search ?? ''}
        onSearchChange={setSearch}
        onClose={onClose}
        tab={tab}
        onTabChange={setTab}
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Filters
          nAtomsMin={nAtomsMin ?? null}
          nAtomsMax={nAtomsMax ?? null}
          onNAtomsMinChange={setNAtomsMin}
          onNAtomsMaxChange={setNAtomsMax}
          nElectronsMin={nElectronsMin ?? null}
          nElectronsMax={nElectronsMax ?? null}
          onNElectronsMinChange={setNElectronsMin}
          onNElectronsMaxChange={setNElectronsMax}
        />
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {error && <div style={{ padding: 16, color: '#ff8a8a' }}>
            Failed to load MPDB: {error}.
            {error.includes('403') && <>
              {' '}The mpdb.sqlite at <code>{mpdbUrl}</code> is currently private —
              ask in #ml or flip the bucket ACL on this key.
            </>}
          </div>}
          {!error && db && tab === 'table' && <Table rows={rows} onSelect={onSelect} />}
          {!error && db && tab === 'scatter' && (
            <Scatter rows={rows} onSelect={onSelect} xKey="n_atoms" yKey="n_electrons" />
          )}
          {!error && !db && loading && <div style={{ padding: 16, color: '#888' }}>Loading mpdb.sqlite…</div>}
        </div>
      </div>
    </div>
  )
}

function Header({ loading, error, summary, search, onSearchChange, onClose, tab, onTabChange }: {
  loading: boolean
  error: string | null
  summary: MpdbSummary | null
  search: string
  onSearchChange: (v: string) => void
  onClose: () => void
  tab: Tab
  onTabChange: (t: Tab) => void
}) {
  const [draft, setDraft] = useState(search)
  useEffect(() => { setDraft(search) }, [search])
  useEffect(() => {
    if (draft === search) return
    const t = setTimeout(() => onSearchChange(draft), 0)
    return () => clearTimeout(t)
  }, [draft, search, onSearchChange])
  return (
    <div style={{
      padding: '10px 16px', borderBottom: '1px solid #2a2a40',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <button onClick={onClose} title="Back to viewer (Esc)" style={btn()}>← back</button>
      <strong style={{ fontSize: 14 }}>MPDB v2</strong>
      <div style={{ display: 'flex', gap: 0, border: '1px solid #2a2a40', borderRadius: 3, overflow: 'hidden' }}>
        <button onClick={() => onTabChange('table')} style={tabBtn(tab === 'table')}>table</button>
        <button onClick={() => onTabChange('scatter')} style={tabBtn(tab === 'scatter')}>scatter</button>
      </div>
      <input
        type="text"
        placeholder="Search mp_id…"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        style={{
          padding: '4px 8px', background: '#1a1a28', border: '1px solid #2a2a40',
          borderRadius: 3, color: '#eee', fontSize: 13, minWidth: 200,
        }}
      />
      <span style={{ color: '#888', fontSize: 13 }}>
        {error
          ? <span style={{ color: '#ff8a8a' }}>(error)</span>
          : loading
            ? '(loading…)'
            : summary
              ? `${summary.matched.toLocaleString()} / ${summary.total.toLocaleString()} · ${summary.train.toLocaleString()} train · ${summary.val.toLocaleString()} val${summary.test ? ` · ${summary.test.toLocaleString()} test` : ''}${summary.unknown ? ` · ${summary.unknown.toLocaleString()} ?` : ''}`
              : ''}
      </span>
    </div>
  )
}

function Filters({
  nAtomsMin, nAtomsMax, onNAtomsMinChange, onNAtomsMaxChange,
  nElectronsMin, nElectronsMax, onNElectronsMinChange, onNElectronsMaxChange,
}: {
  nAtomsMin: number | null
  nAtomsMax: number | null
  onNAtomsMinChange: (v: number | null) => void
  onNAtomsMaxChange: (v: number | null) => void
  nElectronsMin: number | null
  nElectronsMax: number | null
  onNElectronsMinChange: (v: number | null) => void
  onNElectronsMaxChange: (v: number | null) => void
}) {
  return (
    <div style={{
      width: 220, padding: '10px 14px', borderRight: '1px solid #2a2a40',
      display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12,
    }}>
      <RangeInput label="n_atoms" min={nAtomsMin} max={nAtomsMax} onMinChange={onNAtomsMinChange} onMaxChange={onNAtomsMaxChange} />
      <RangeInput label="n_electrons" min={nElectronsMin} max={nElectronsMax} onMinChange={onNElectronsMinChange} onMaxChange={onNElectronsMaxChange} />
    </div>
  )
}

function RangeInput({ label, min, max, onMinChange, onMaxChange }: {
  label: string
  min: number | null
  max: number | null
  onMinChange: (v: number | null) => void
  onMaxChange: (v: number | null) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        <NumInput value={min} placeholder="min" onCommit={onMinChange} />
        <NumInput value={max} placeholder="max" onCommit={onMaxChange} />
      </div>
    </div>
  )
}

function NumInput({ value, placeholder, onCommit }: {
  value: number | null
  placeholder?: string
  onCommit: (v: number | null) => void
}) {
  const [draft, setDraft] = useState(value?.toString() ?? '')
  useEffect(() => { setDraft(value?.toString() ?? '') }, [value])
  return (
    <input
      type="number"
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const n = draft.trim() === '' ? null : parseInt(draft, 10)
        if (Number.isNaN(n as number)) return
        if (n !== value) onCommit(n)
      }}
      style={{
        flex: 1, padding: '3px 4px', background: '#1a1a28', border: '1px solid #2a2a40',
        borderRadius: 3, color: '#eee', fontSize: 12, minWidth: 0,
      }}
    />
  )
}

function Table({ rows, onSelect }: { rows: MaterialRow[]; onSelect: (mpId: string) => void }) {
  const cellStyle: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid #1a1a28', fontVariantNumeric: 'tabular-nums' }
  const headStyle: React.CSSProperties = { ...cellStyle, fontWeight: 600, color: '#aaa', position: 'sticky', top: 0, background: '#0a0a14', zIndex: 1 }
  const onRowClick = useCallback((id: string) => onSelect(id), [onSelect])
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          <th style={{ ...headStyle, textAlign: 'left' }}>mp_id</th>
          <th style={{ ...headStyle, textAlign: 'left' }}>split</th>
          <th style={{ ...headStyle, textAlign: 'right' }}>n_atoms</th>
          <th style={{ ...headStyle, textAlign: 'right' }}>n_electrons</th>
          <th style={{ ...headStyle, textAlign: 'right' }}>grid</th>
          <th style={{ ...headStyle, textAlign: 'right' }}>n_voxels</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr
            key={r.mp_id}
            onClick={() => onRowClick(r.mp_id)}
            style={{ cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(74, 158, 255, 0.08)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <td style={{ ...cellStyle, fontFamily: 'ui-monospace, monospace', color: '#8ab' }}>{r.mp_id}</td>
            <td style={{ ...cellStyle, color: splitColor(r.split) }}>{r.split ?? '—'}</td>
            <td style={{ ...cellStyle, textAlign: 'right' }}>{r.n_atoms.toLocaleString()}</td>
            <td style={{ ...cellStyle, textAlign: 'right' }}>{r.n_electrons.toLocaleString()}</td>
            <td style={{ ...cellStyle, textAlign: 'right', color: '#888' }}>{r.nx}×{r.ny}×{r.nz}</td>
            <td style={{ ...cellStyle, textAlign: 'right', color: '#888' }}>{r.n_voxels.toLocaleString()}</td>
          </tr>
        ))}
        {rows.length === 5000 && (
          <tr><td colSpan={6} style={{ ...cellStyle, color: '#666', fontStyle: 'italic' }}>(showing first 5,000 — narrow filters to see more)</td></tr>
        )}
      </tbody>
    </table>
  )
}

function splitColor(split: string | null): string {
  if (split === 'train') return '#7dd3a1'
  if (split === 'val') return '#5fb3d4'
  if (split === 'test') return '#f5a3a3'
  return '#666'
}

function btn(): React.CSSProperties {
  return {
    padding: '4px 10px', background: 'transparent', border: '1px solid #2a2a40',
    borderRadius: 3, color: '#aaa', fontSize: 13, cursor: 'pointer',
  }
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px',
    background: active ? '#2a2a40' : 'transparent',
    border: 'none',
    color: active ? '#eee' : '#888',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  }
}
