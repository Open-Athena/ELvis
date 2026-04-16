export type CorpusId = 'electrai-205' | 'dataset_4' | 'mp-public' | 'omol' | 'qm9'

export type CrystalSystem =
  | 'Triclinic'
  | 'Monoclinic'
  | 'Orthorhombic'
  | 'Tetragonal'
  | 'Trigonal'
  | 'Hexagonal'
  | 'Cubic'

export interface DatasetMembership {
  task_ids: string[]
  has_input?: boolean
  has_label?: boolean
}

export interface MaterialRecord {
  id: string
  formula: string
  elements: string[]
  chemsys: string
  nelements: number
  nsites: number
  crystal_system: CrystalSystem | null
  spacegroup_symbol: string | null
  spacegroup_number: number | null
  density: number | null
  volume: number | null
  band_gap: number | null
  is_metal: boolean | null
  is_magnetic: boolean | null
  ordering: string | null
  theoretical: boolean | null
  datasets: Partial<Record<CorpusId, DatasetMembership>>
}

export interface CorpusInfo {
  source: string
  format: string
  paired: boolean
  count: number
  description: string
  grid?: [number, number, number]
  license?: string
}

export interface MaterialsManifest {
  generated: string
  schema_version: number
  corpora: Record<CorpusId, CorpusInfo>
  records: MaterialRecord[]
}
