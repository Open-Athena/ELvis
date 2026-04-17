import { useMemo } from 'react'
import { useOmnibarEndpoint } from 'use-kbd'
import { searchMaterials, resolveLoadUrl } from '@elvis/corpora'
import type { MaterialRecord, MaterialsManifest } from '@elvis/corpora'
import manifestJson from '@elvis/corpora/data/materials.json'

const manifest = manifestJson as MaterialsManifest

function formatBadges(record: { datasets: Record<string, unknown> }): string {
  return Object.keys(record.datasets).join(', ')
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
  /** Called with the resolved S3 URL for loading the selected material. */
  onSelect: (url: string) => void
}

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
          const url = resolveLoadUrl(r)
          return {
            id: r.id,
            label: `${r.id}  ${r.formula}`,
            description: formatDescription(r),
            keywords: [r.chemsys, ...r.elements],
            handler: url ? () => onSelect(url) : () => {},
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
