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

function buildWhere(f: FilterState): { sql: string; params: Record<string, string | number> } {
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
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params }
}

/** Run the filtered query and return matching rows. Pure SQL — no in-JS filtering.
 *  `limit` defaults to 5,000 for the table view; the scatter view passes 0 (no limit)
 *  since canvas can paint the full 80K cheaply.
 *
 *  Uses `db.exec` (returns column-major array-of-arrays) instead of
 *  `stmt.getAsObject()` per row — ~10× faster on the 81K rowset because we skip
 *  building a per-row property bag for every row. */
export function queryMaterials(db: Database, f: FilterState, limit = 5000): MaterialRow[] {
  const { sql: whereSql, params } = buildWhere(f)
  const sql = `
    SELECT mp_id, split, nx, ny, nz, n_atoms, n_electrons, n_voxels
    FROM mats
    ${whereSql}
    ORDER BY mp_id
    ${limit > 0 ? `LIMIT ${limit}` : ''}
  `
  // db.exec doesn't support `:name` params; use the prepare/bind path but read
  // via stmt.get() (array) instead of stmt.getAsObject() (object) — the latter
  // walks columns and builds a fresh object per row, which dominates the runtime.
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows: MaterialRow[] = []
  while (stmt.step()) {
    const v = stmt.get() as [string, string | null, number, number, number, number, number, number]
    rows.push({
      mp_id: v[0], split: v[1],
      nx: v[2], ny: v[3], nz: v[4],
      n_atoms: v[5], n_electrons: v[6], n_voxels: v[7],
    })
  }
  stmt.free()
  return rows
}

/** Column-major scatter data — much faster to iterate than [{mp_id, ...}, ...]
 *  for hit-testing and canvas drawing. Only includes the columns the scatter needs. */
export interface ScatterData {
  mpIds: string[]
  splits: (string | null)[]
  nAtoms: Int32Array
  nElectrons: Int32Array
  nVoxels: Int32Array
}

export function queryScatterData(db: Database, f: FilterState): ScatterData {
  const { sql: whereSql, params } = buildWhere(f)
  const sql = `
    SELECT mp_id, split, n_atoms, n_electrons, n_voxels
    FROM mats
    ${whereSql}
    ORDER BY mp_id
  `
  // Two-pass: COUNT first to size the typed arrays exactly, then SELECT.
  const cntStmt = db.prepare(`SELECT COUNT(*) FROM mats ${whereSql}`)
  cntStmt.bind(params)
  cntStmt.step()
  const n = Number(cntStmt.get()[0])
  cntStmt.free()

  const mpIds = new Array<string>(n)
  const splits = new Array<string | null>(n)
  const nAtoms = new Int32Array(n)
  const nElectrons = new Int32Array(n)
  const nVoxels = new Int32Array(n)
  const stmt = db.prepare(sql)
  stmt.bind(params)
  let i = 0
  while (stmt.step()) {
    const v = stmt.get() as [string, string | null, number, number, number]
    mpIds[i] = v[0]
    splits[i] = v[1]
    nAtoms[i] = v[2]
    nElectrons[i] = v[3]
    nVoxels[i] = v[4]
    i++
  }
  stmt.free()
  return { mpIds, splits, nAtoms, nElectrons, nVoxels }
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
  const { sql: whereSql, params } = buildWhere(f)
  const stmt = db.prepare(`SELECT COUNT(*) FROM mats ${whereSql}`)
  stmt.bind(params)
  stmt.step()
  const matched = Number(stmt.get()[0])
  stmt.free()
  return {
    total: Number(totals[0]) || 0,
    train: Number(totals[1]) || 0,
    val: Number(totals[2]) || 0,
    test: Number(totals[3]) || 0,
    unknown: Number(totals[4]) || 0,
    matched,
  }
}
