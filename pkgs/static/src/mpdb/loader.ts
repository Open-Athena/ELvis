/**
 * MPDB v2 SQLite loader. Fetches the published `mpdb.sqlite`, opens it via sql.js,
 * and exposes a typed query helper. Lazy-loaded by `MpPage` to keep the
 * sql.js WASM bundle out of the main app chunk.
 */
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'

export interface MaterialRow {
  mp_id: string
  split: string | null
  nx: number
  ny: number
  nz: number
  n_atoms: number
  n_electrons: number
  n_voxels: number
}

export interface FilterState {
  search: string
  splits: Array<'train' | 'val' | 'test' | 'unknown'>
  nAtomsMin: number | null
  nAtomsMax: number | null
  nElectronsMin: number | null
  nElectronsMax: number | null
}

const DEFAULT_URL = 'https://openathena.s3.amazonaws.com/mpdb/v2/mpdb.sqlite'

let sqlPromise: Promise<SqlJsStatic> | null = null

function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    // The WASM is staged to `pkgs/static/public/sql-wasm.wasm` (committed).
    // Vite copies `public/*` to `dist/` verbatim, so `/sql-wasm.wasm` resolves
    // both in dev and in the deployed build.
    sqlPromise = initSqlJs({ locateFile: () => '/sql-wasm.wasm' })
  }
  return sqlPromise
}

export async function fetchMpdb(url: string = DEFAULT_URL): Promise<Database> {
  const SQL = await getSql()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status} ${res.statusText}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return new SQL.Database(bytes)
}

/** Run the filtered query and return matching rows. Pure SQL — no in-JS filtering. */
export function queryMaterials(db: Database, f: FilterState): MaterialRow[] {
  const where: string[] = []
  const params: Record<string, string | number> = {}
  if (f.search.trim()) {
    where.push('mp_id LIKE :search')
    params[':search'] = `${f.search.trim()}%`
  }
  if (f.splits.length > 0 && f.splits.length < 4) {
    const known = f.splits.filter(s => s !== 'unknown')
    const wantUnknown = f.splits.includes('unknown')
    const clauses: string[] = []
    if (known.length > 0) {
      clauses.push(`split IN (${known.map((_, i) => `:s${i}`).join(',')})`)
      known.forEach((s, i) => { params[`:s${i}`] = s })
    }
    if (wantUnknown) clauses.push('split IS NULL')
    if (clauses.length) where.push(`(${clauses.join(' OR ')})`)
  }
  if (f.nAtomsMin !== null) { where.push('n_atoms >= :naMin'); params[':naMin'] = f.nAtomsMin }
  if (f.nAtomsMax !== null) { where.push('n_atoms <= :naMax'); params[':naMax'] = f.nAtomsMax }
  if (f.nElectronsMin !== null) { where.push('n_electrons >= :neMin'); params[':neMin'] = f.nElectronsMin }
  if (f.nElectronsMax !== null) { where.push('n_electrons <= :neMax'); params[':neMax'] = f.nElectronsMax }

  const sql = `
    SELECT mp_id, split, nx, ny, nz, n_atoms, n_electrons, n_voxels
    FROM mats
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY mp_id
    LIMIT 5000
  `
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows: MaterialRow[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as unknown as MaterialRow)
  stmt.free()
  return rows
}

/** Compact summary stats for the current filter set — drives the header line. */
export interface MpdbSummary {
  total: number
  train: number
  val: number
  test: number
  unknown: number
  matched: number
}

export function querySummary(db: Database, f: FilterState): MpdbSummary {
  const totals = db.exec(`
    SELECT
      COUNT(*) total,
      SUM(CASE WHEN split = 'train' THEN 1 ELSE 0 END) train,
      SUM(CASE WHEN split = 'val' THEN 1 ELSE 0 END) val,
      SUM(CASE WHEN split = 'test' THEN 1 ELSE 0 END) test,
      SUM(CASE WHEN split IS NULL THEN 1 ELSE 0 END) unknown
    FROM mats
  `)[0].values[0]
  const matched = queryMaterials(db, f).length
  return {
    total: Number(totals[0]) || 0,
    train: Number(totals[1]) || 0,
    val: Number(totals[2]) || 0,
    test: Number(totals[3]) || 0,
    unknown: Number(totals[4]) || 0,
    matched,
  }
}
