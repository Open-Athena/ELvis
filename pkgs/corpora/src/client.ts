import type { CorpusId, MaterialRecord, MaterialsManifest } from './types.ts'

export async function loadManifest(url: string): Promise<MaterialsManifest> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load manifest: ${res.status} ${res.statusText}`)
  return await res.json()
}

export interface SearchQuery {
  /** Free-text query: matches id, formula, chemsys, elements, task IDs (case-insensitive substring). */
  q?: string
  /** Restrict to records that belong to at least one of these corpora. */
  corpora?: CorpusId[]
  /** All listed elements must be present in `record.elements` (case-sensitive). */
  requireElements?: string[]
  /** At least one of these crystal systems. */
  crystalSystems?: string[]
  /** `[min, max]`; null for open-ended. */
  bandGapRange?: [number | null, number | null]
  /** Only materials that have at least one `task_id` matching — used for `?m=mp-TASKID` lookup. */
  taskId?: string
  limit?: number
}

export function searchMaterials(manifest: MaterialsManifest, query: SearchQuery): MaterialRecord[] {
  const { q, corpora, requireElements, crystalSystems, bandGapRange, taskId, limit } = query
  const needle = q?.trim().toLowerCase()

  const out: MaterialRecord[] = []
  for (const r of manifest.records) {
    if (taskId) {
      let has = false
      for (const m of Object.values(r.datasets)) {
        if (m && m.task_ids.includes(taskId)) { has = true; break }
      }
      if (!has) continue
    }
    if (corpora?.length) {
      const any = corpora.some(c => r.datasets[c] !== undefined)
      if (!any) continue
    }
    if (requireElements?.length) {
      const set = new Set(r.elements)
      if (!requireElements.every(e => set.has(e))) continue
    }
    if (crystalSystems?.length && (!r.crystal_system || !crystalSystems.includes(r.crystal_system))) continue
    if (bandGapRange) {
      const [lo, hi] = bandGapRange
      if (r.band_gap === null) continue
      if (lo !== null && r.band_gap < lo) continue
      if (hi !== null && r.band_gap > hi) continue
    }
    if (needle) {
      const hay = [
        r.id,
        r.formula,
        r.chemsys,
        ...r.elements,
        ...Object.values(r.datasets).flatMap(m => (m ? m.task_ids : [])),
      ].join(' ').toLowerCase()
      if (!hay.includes(needle)) continue
    }
    out.push(r)
    if (limit && out.length >= limit) break
  }
  return out
}
