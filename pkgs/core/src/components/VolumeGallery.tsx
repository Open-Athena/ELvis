import { useState, useEffect, useCallback } from 'react'
import type { VolumeStore, StoredVolume } from '../storage/types.ts'

interface VolumeGalleryProps {
  store: VolumeStore
  currentVolumeId: string | null
  onSelect: (id: string, blob: Blob) => void
  /** Increment to trigger a refresh of the file list */
  refreshKey?: number
  /** Notified with the current count whenever the volumes list refreshes —
      lets the parent show a count badge in the section heading. */
  onCountChange?: (count: number) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉'
function toSubscript(n: number): string {
  return String(n).replace(/\d/g, d => SUBSCRIPT_DIGITS[+d])
}

function compositionFormula(elements: string[], atomCount: number, counts?: number[]): string {
  if (elements.length === 0) return `${atomCount} atoms`
  if (!counts) return elements.join('-')
  return elements.map((el, i) => {
    const c = counts[i]
    return c > 1 ? `${el}${toSubscript(c)}` : el
  }).join('-')
}

/** Cached-files list. Wrap in `<DrawerSection id="gallery" title="Cached Files" …>`. */
export function VolumeGallery({ store, currentVolumeId, onSelect, refreshKey, onCountChange }: VolumeGalleryProps) {
  const [volumes, setVolumes] = useState<StoredVolume[]>([])

  const refresh = useCallback(async () => {
    const next = await store.list()
    setVolumes(next)
    onCountChange?.(next.length)
  }, [store, onCountChange])

  useEffect(() => { refresh() }, [refresh, refreshKey])

  const handleSelect = useCallback(async (vol: StoredVolume) => {
    const blob = await store.get(vol.id)
    if (blob) onSelect(vol.id, blob)
  }, [store, onSelect])

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await store.delete(id)
    refresh()
  }, [store, refresh])

  return (
    <div style={{ maxHeight: 240, overflowY: 'auto', margin: '0 -10px' }}>
      {volumes.length === 0 ? (
        <div style={{ padding: '8px 10px', color: '#666', fontSize: 12 }}>
          No cached files
        </div>
      ) : (
        volumes.map(vol => (
          <div
            key={vol.id}
            onClick={() => handleSelect(vol)}
            style={{
              padding: '6px 10px',
              cursor: 'pointer',
              background: vol.id === currentVolumeId ? 'rgba(74, 158, 255, 0.15)' : 'transparent',
              borderLeft: vol.id === currentVolumeId ? '2px solid #4a9eff' : '2px solid transparent',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontSize: 12,
                color: '#ccc',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {vol.filename}
              </div>
              <div style={{ fontSize: 11, color: '#888' }}>
                {compositionFormula(vol.elements, vol.atomCount, vol.counts)}
                {' · '}
                {vol.gridDims.join('×')}
                {' · '}
                {formatBytes(vol.fileSize)}
                {' · '}
                {relativeTime(vol.addedAt)}
              </div>
            </div>
            <button
              onClick={(e) => handleDelete(e, vol.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
                fontSize: 14,
                padding: '2px 4px',
                flexShrink: 0,
              }}
              title="Remove from cache"
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
  )
}
