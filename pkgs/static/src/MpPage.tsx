import { useEffect, useState, useMemo, useCallback } from 'react'
import { useUrlState, stringParam, intParam, optIntParam } from 'use-prms'
import type { Database } from 'sql.js'
import { List } from 'react-window'
import { fetchMpdb, queryMaterials, querySummary, queryScatterData } from './mpdb/loader.ts'
import type { FilterState, MaterialRow, MpdbSummary, ScatterData } from './mpdb/loader.ts'
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
  const [tab, setTab] = useUrlState('mp_tab', stringParam('table')) as unknown as [Tab, (v: Tab) => void]
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

  // Two query shapes:
  //  - table → row-of-objects, LIMIT 5,000 (the windowed list only renders ~30 at a time).
  //  - scatter → column-major typed arrays for the full filtered set, fast to iterate.
  const rows = useMemo<MaterialRow[]>(
    () => db && tab === 'table' ? queryMaterials(db, filter, 5000) : [],
    [db, filter, tab],
  )
  const scatterData = useMemo<ScatterData | null>(
    () => db && tab === 'scatter' ? queryScatterData(db, filter) : null,
    [db, filter, tab],
  )
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
          {!error && db && tab === 'scatter' && scatterData && (
            <Scatter data={scatterData} onSelect={onSelect} xKey="nAtoms" yKey="nElectrons" />
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

const ROW_HEIGHT = 24
const HEADER_HEIGHT = 28
// Grid template applied to header + every row so columns line up across the
// virtualised list (which can't use a real <table>).
const GRID_TEMPLATE = 'minmax(110px, 1fr) 70px 80px 100px 110px 110px'

function Table({ rows, onSelect }: { rows: MaterialRow[]; onSelect: (mpId: string) => void }) {
  const onRowClick = useCallback((id: string) => onSelect(id), [onSelect])
  const showFooter = rows.length === 5000
  const itemCount = rows.length + (showFooter ? 1 : 0)

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: GRID_TEMPLATE, alignItems: 'center',
        height: HEADER_HEIGHT, padding: '0 8px', borderBottom: '1px solid #2a2a40',
        background: '#0a0a14', fontWeight: 600, color: '#aaa', fontSize: 12, flexShrink: 0,
      }}>
        <span style={{ textAlign: 'left' }}>mp_id</span>
        <span style={{ textAlign: 'left' }}>split</span>
        <span style={{ textAlign: 'right' }}>n_atoms</span>
        <span style={{ textAlign: 'right' }}>n_electrons</span>
        <span style={{ textAlign: 'right' }}>grid</span>
        <span style={{ textAlign: 'right' }}>n_voxels</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <List
          rowCount={itemCount}
          rowHeight={ROW_HEIGHT}
          overscanCount={8}
          rowComponent={Row}
          rowProps={{ rows, onRowClick, showFooter }}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  )
}

interface RowProps {
  rows: MaterialRow[]
  onRowClick: (id: string) => void
  showFooter: boolean
}

function Row({ index, style, rows, onRowClick, showFooter, ariaAttributes }: {
  index: number
  style: React.CSSProperties
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' }
} & RowProps) {
  if (showFooter && index === rows.length) {
    return (
      <div style={{ ...style, padding: '4px 8px', color: '#666', fontStyle: 'italic', fontSize: 12 }} {...ariaAttributes}>
        (showing first 5,000 — narrow filters to see more)
      </div>
    )
  }
  const r = rows[index]
  return (
    <div
      {...ariaAttributes}
      style={{
        ...style,
        display: 'grid', gridTemplateColumns: GRID_TEMPLATE, alignItems: 'center',
        padding: '0 8px', borderBottom: '1px solid #1a1a28',
        fontSize: 12, fontVariantNumeric: 'tabular-nums', cursor: 'pointer',
      }}
      onClick={() => onRowClick(r.mp_id)}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'rgba(74, 158, 255, 0.08)'}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
    >
      <span style={{ fontFamily: 'ui-monospace, monospace', color: '#8ab', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.mp_id}</span>
      <span style={{ color: splitColor(r.split) }}>{r.split ?? '—'}</span>
      <span style={{ textAlign: 'right' }}>{r.n_atoms.toLocaleString()}</span>
      <span style={{ textAlign: 'right' }}>{r.n_electrons.toLocaleString()}</span>
      <span style={{ textAlign: 'right', color: '#888' }}>{r.nx}×{r.ny}×{r.nz}</span>
      <span style={{ textAlign: 'right', color: '#888' }}>{r.n_voxels.toLocaleString()}</span>
    </div>
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
