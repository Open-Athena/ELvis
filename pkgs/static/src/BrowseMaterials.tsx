import { useMemo, useState } from 'react'
import { searchMaterials, resolveLoadUrl } from '@elvis/corpora'
import type { CorpusId, MaterialRecord, MaterialsManifest } from '@elvis/corpora'
import manifestJson from '@elvis/corpora/data/materials.json'

const manifest = manifestJson as MaterialsManifest

const CRYSTAL_SYSTEMS = [
  'Triclinic',
  'Monoclinic',
  'Orthorhombic',
  'Tetragonal',
  'Trigonal',
  'Hexagonal',
  'Cubic',
] as const

const CORPORA: { id: CorpusId; label: string }[] = (
  Object.keys(manifest.corpora) as CorpusId[]
).map(id => ({ id, label: `${id} (${manifest.corpora[id].count})` }))

const PAGE_SIZE = 50

interface BrowseMaterialsProps {
  open: boolean
  onClose: () => void
  onSelect: (url: string) => void
}

export function BrowseMaterials({ open, onClose, onSelect }: BrowseMaterialsProps) {
  const [query, setQuery] = useState('')
  const [crystalSystem, setCrystalSystem] = useState<string>('')
  const [requireElements, setRequireElements] = useState('')
  const [gapMin, setGapMin] = useState('')
  const [gapMax, setGapMax] = useState('')
  const [activeCorpora, setActiveCorpora] = useState<Set<CorpusId>>(new Set())
  const [page, setPage] = useState(0)

  const hits = useMemo(() => {
    if (!open) return []
    const elems = requireElements.split(/[\s,]+/).filter(Boolean)
    const lo = gapMin ? parseFloat(gapMin) : null
    const hi = gapMax ? parseFloat(gapMax) : null
    return searchMaterials(manifest, {
      q: query || undefined,
      crystalSystems: crystalSystem ? [crystalSystem] : undefined,
      requireElements: elems.length ? elems : undefined,
      bandGapRange: lo !== null || hi !== null ? [lo, hi] : undefined,
      corpora: activeCorpora.size ? Array.from(activeCorpora) : undefined,
    })
  }, [open, query, crystalSystem, requireElements, gapMin, gapMax, activeCorpora])

  if (!open) return null

  const totalPages = Math.max(1, Math.ceil(hits.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const start = safePage * PAGE_SIZE
  const pageRecords = hits.slice(start, start + PAGE_SIZE)

  const toggleCorpus = (id: CorpusId) => {
    setActiveCorpora(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setPage(0)
  }

  const handleRowClick = (r: MaterialRecord) => {
    const url = resolveLoadUrl(r)
    if (!url) return
    onSelect(url)
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1e1e30',
          borderRadius: 8,
          padding: 16,
          width: 'min(1100px, 95vw)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#eee' }}>
            Browse materials
            <span style={{ color: '#888', fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
              {hits.length} / {manifest.records.length}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid #555',
              borderRadius: 4,
              color: '#aaa',
              padding: '2px 10px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Esc
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
          <input
            placeholder="Search id / formula / chemsys / elements..."
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(0) }}
            style={inputStyle}
          />
          <input
            placeholder="Elements (e.g. Li O)"
            value={requireElements}
            onChange={e => { setRequireElements(e.target.value); setPage(0) }}
            style={inputStyle}
          />
          <select
            value={crystalSystem}
            onChange={e => { setCrystalSystem(e.target.value); setPage(0) }}
            style={inputStyle}
          >
            <option value="">Any crystal system</option>
            {CRYSTAL_SYSTEMS.map(cs => <option key={cs} value={cs}>{cs}</option>)}
          </select>
          <input
            placeholder="Gap min (eV)"
            type="number"
            step="0.1"
            value={gapMin}
            onChange={e => { setGapMin(e.target.value); setPage(0) }}
            style={inputStyle}
          />
          <input
            placeholder="Gap max (eV)"
            type="number"
            step="0.1"
            value={gapMax}
            onChange={e => { setGapMax(e.target.value); setPage(0) }}
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', fontSize: 12, color: '#bbb' }}>
          <span>Dataset:</span>
          {CORPORA.map(({ id, label }) => (
            <label key={id} style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={activeCorpora.has(id)}
                onChange={() => toggleCorpus(id)}
              />
              {label}
            </label>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', border: '1px solid #333', borderRadius: 4 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#ddd' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#2a2a3f', zIndex: 1 }}>
              <tr>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Formula</th>
                <th style={thStyle}>Elements</th>
                <th style={thStyle}>Crystal</th>
                <th style={thStyle}>Spacegroup</th>
                <th style={thStyleRight}>Gap (eV)</th>
                <th style={thStyle}>Datasets</th>
              </tr>
            </thead>
            <tbody>
              {pageRecords.map(r => (
                <tr
                  key={r.id}
                  onClick={() => handleRowClick(r)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#2a2a3f')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td style={tdMono}>{r.id}</td>
                  <td style={td}>{r.formula}</td>
                  <td style={td}>{r.elements.join(' ')}</td>
                  <td style={td}>{r.crystal_system ?? '—'}</td>
                  <td style={td}>{r.spacegroup_symbol ?? '—'}</td>
                  <td style={tdRight}>{r.band_gap !== null ? r.band_gap.toFixed(2) : '—'}</td>
                  <td style={tdSmall}>{Object.keys(r.datasets).join(', ')}</td>
                </tr>
              ))}
              {pageRecords.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#888' }}>No matches.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 12, color: '#aaa' }}>
          <div>Page {safePage + 1} / {totalPages} · {start + 1}–{Math.min(start + PAGE_SIZE, hits.length)} of {hits.length}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              disabled={safePage === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              style={pageBtn(safePage === 0)}
            >Prev</button>
            <button
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              style={pageBtn(safePage >= totalPages - 1)}
            >Next</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#0f0f1a',
  border: '1px solid #444',
  borderRadius: 4,
  color: '#eee',
  padding: '6px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
}

const thBase: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid #444',
  color: '#bbb',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}
const thStyle: React.CSSProperties = thBase
const thStyleRight: React.CSSProperties = { ...thBase, textAlign: 'right' }

const td: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid #2a2a3f',
}
const tdMono: React.CSSProperties = { ...td, fontFamily: 'ui-monospace, monospace' }
const tdRight: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const tdSmall: React.CSSProperties = { ...td, fontSize: 11, color: '#aaa' }

const pageBtn = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? '#1a1a2a' : '#2a2a3f',
  border: '1px solid #444',
  color: disabled ? '#555' : '#ddd',
  padding: '4px 10px',
  borderRadius: 4,
  fontSize: 12,
  cursor: disabled ? 'default' : 'pointer',
})
