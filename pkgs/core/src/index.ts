// Types
export type {
  LatticeMatrix,
  AtomInfo,
  CrystalStructure,
  DensityGrid,
  VolumeData,
} from './types.ts'

// Storage
export type { StoredVolume, VolumeStore } from './storage/types.ts'
export {
  openZarrVolume,
  readZarrLevel,
  zarrToVolumeData,
  fetchZarrVolume,
} from './storage/zarr-volume.ts'
export type { OpenedZarrVolume, ZarrVolumeMetadata } from './storage/zarr-volume.ts'

// Parsers
export { parseCHGCAR, parseCHGCARHeader } from './parsers/chgcar.ts'
export type { CHGCARHeader } from './parsers/chgcar.ts'
export { parseNpy } from './parsers/npy.ts'
export { parsePymatgenChgcar } from './parsers/pymatgen-chgcar.ts'

// Utils
export { marchingCubes, extendPeriodicGrid } from './utils/marching-cubes.ts'
export { fracToCart, latticeToMatrix4, cellVolume, unitCellEdges, unitCellBoundingBox } from './utils/lattice.ts'
export { sampleRamp, densityToQuantile, quantileToDensity, DEFAULT_RAMP } from './utils/color-ramp.ts'
export type { ColorStop, SampledColor } from './utils/color-ramp.ts'
export { computeTiles, atomOpacity, distFromPrimaryCell } from './utils/tiling.ts'
export type { TileInfo } from './utils/tiling.ts'
export { getElement, ELEMENTS } from './utils/elements.ts'
export type { ElementData } from './utils/elements.ts'

// Components
export { FileDropZone } from './components/FileDropZone.tsx'
export { DensityViewer } from './components/DensityViewer.tsx'
export { IsosurfaceRenderer } from './components/IsosurfaceRenderer.tsx'
export { VolumeRenderer } from './components/VolumeRenderer.tsx'
export { HeatmapRenderer } from './components/HeatmapRenderer.tsx'
export { HeatmapLegend } from './components/HeatmapLegend.tsx'
export { GlbPreviewRenderer } from './components/GlbPreviewRenderer.tsx'
export { CrystalStructure as CrystalStructureView } from './components/CrystalStructure.tsx'
export { LatticeGizmo } from './components/LatticeGizmo.tsx'
export { CameraController } from './components/CameraController.tsx'
export type { CameraSnapTarget } from './components/CameraController.tsx'
export { SliceViewer } from './components/SliceViewer.tsx'
export { ComparisonView } from './components/ComparisonView.tsx'
export { Controls } from './components/Controls.tsx'
export { ErrorBoundary } from './components/ErrorBoundary.tsx'
export { VolumeGallery } from './components/VolumeGallery.tsx'
export { URLInput } from './components/URLInput.tsx'
export { AWSCredentialsModal } from './components/AWSCredentialsModal.tsx'
export type { AWSCredentials } from './components/aws-credentials-types.ts'
export { SizeConfirmModal } from './components/SizeConfirmModal.tsx'
export { Settings } from './components/Settings.tsx'

// Hooks
export { useSettings } from './hooks/useSettings.ts'
export type { ElvisSettings } from './hooks/useSettings.ts'
