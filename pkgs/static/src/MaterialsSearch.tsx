import { useMemo } from 'react'
import { useOmnibarEndpoint } from 'use-kbd'
import { searchMaterials } from '@elvis/corpora'
import type { CorpusId, MaterialRecord, MaterialsManifest } from '@elvis/corpora'
import manifestJson from '@elvis/corpora/data/materials.json'

const manifest = manifestJson as MaterialsManifest

// Corpus preference for URL selection: paired/input-label data is most useful.
const CORPUS_PRIORITY: CorpusId[] = ['electrai-205', 'dataset_4', 'mp-public', 'omol', 'qm9']

function pickTaskId(record: MaterialRecord): string | undefined {
  for (const corpus of CORPUS_PRIORITY) {
    const m = record.datasets[corpus]
    if (m && m.task_ids.length) return m.task_ids[0]
  }
  return undefined
}

function formatBadges(record: MaterialRecord): string {
  const labels = Object.keys(record.datasets) as CorpusId[]
  return labels.join(', ')
}

function formatDescription(record: MaterialRecord): string {
  const parts: string[] = []
  if (record.crystal_system) parts.push(record.crystal_system)
  if (record.spacegroup_symbol) parts.push(record.spacegroup_symbol)
  if (record.band_gap !== null) parts.push(`gap ${record.band_gap.toFixed(2)} eV`)
  const badges = formatBadges(record)
  if (badges) parts.push(`[${badges}]`)
  return parts.join(' · ')
}

interface MaterialsSearchProps {
  onSelect: (taskId: string) => void
}

/**
 * Registers a "Materials" endpoint with the use-kbd Omnibar, providing type-ahead
 * search across our corpora (MP IDs, formulas, chemsys, elements, task IDs).
 *
 * Selecting an entry invokes `onSelect(taskId)` — the caller wires that to
 * whatever URL state / load routine it uses (typically `setMaterialId`).
 */
export function MaterialsSearch({ onSelect }: MaterialsSearchProps) {
  const config = useMemo(() => ({
    group: 'Materials',
    minQueryLength: 1,
    pageSize: 20,
    pagination: 'scroll' as const,
    filter: (query: string, pagination: { offset: number; limit: number }) => {
      const hits = searchMaterials(manifest, { q: query })
      const page = hits.slice(pagination.offset, pagination.offset + pagination.limit)
      return {
        entries: page.map(r => {
          const taskId = pickTaskId(r)
          return {
            id: r.id,
            label: `${r.id}  ${r.formula}`,
            description: formatDescription(r),
            keywords: [r.chemsys, ...r.elements],
            handler: taskId ? () => onSelect(taskId) : () => { /* no task ID available */ },
          }
        }),
        total: hits.length,
        hasMore: pagination.offset + pagination.limit < hits.length,
      }
    },
  }), [onSelect])

  useOmnibarEndpoint('materials', config)

  return null
}

export const MATERIALS_COUNT = manifest.records.length
export { manifest as MATERIALS_MANIFEST }
