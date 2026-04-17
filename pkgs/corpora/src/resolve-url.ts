import type { CorpusId, MaterialRecord } from './types.ts'

/** S3 URI patterns per corpus+role. `{task}` is replaced with the task ID. */
const CORPUS_URLS: Record<string, { label: string; input?: string }> = {
  'electrai-205': {
    label: 's3://openathena/electrai/label/{task}.CHGCAR',
    input: 's3://openathena/electrai/input/{task}.CHGCAR',
  },
  'dataset_4': {
    label: 's3://openathena/electrai/mp/chg_datasets/dataset_4/label/{task}.CHGCAR',
    input: 's3://openathena/electrai/mp/chg_datasets/dataset_4/data/{task}.CHGCAR',
  },
}

const MP_PARSED_URL = 's3://materialsproject-parsed/chgcars/{task}.json.gz'

/** Corpus preference for URL resolution: prefer smaller/paired datasets. */
const CORPUS_PRIORITY: CorpusId[] = ['electrai-205', 'dataset_4', 'mp-public', 'omol', 'qm9']

/**
 * Resolve the best S3 URL for loading a material's electron density.
 * Prefers ElectrAI copies (smaller, paired) over MP-parsed (larger).
 * Falls back to materialsproject-parsed for materials only in mp-public.
 *
 * @param role - 'label' (DFT ground truth, default) or 'input' (SAD guess)
 */
export function resolveLoadUrl(record: MaterialRecord, role: 'label' | 'input' = 'label'): string | undefined {
  for (const corpus of CORPUS_PRIORITY) {
    const m = record.datasets[corpus]
    if (!m || !m.task_ids.length) continue
    const taskId = m.task_ids[0]
    const urls = CORPUS_URLS[corpus]
    if (urls) {
      const template = role === 'input' && urls.input ? urls.input : urls.label
      return template.replace('{task}', taskId)
    }
    // mp-public fallback
    return MP_PARSED_URL.replace('{task}', taskId)
  }
  return undefined
}
