import { useMemo } from 'react'
import type { MutableRefObject, RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, TrackballControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { FreeRotateControls } from './FreeRotateControls.tsx'
import { Vector3 } from 'three'
import type { LatticeMatrix } from '../types.ts'
import type { VolumeData } from '../types.ts'
import { IsosurfaceRenderer } from './IsosurfaceRenderer.tsx'
import { VolumeRenderer } from './VolumeRenderer.tsx'
import { HeatmapRenderer } from './HeatmapRenderer.tsx'
import { GlbPreviewRenderer } from './GlbPreviewRenderer.tsx'
import { CrystalStructure } from './CrystalStructure.tsx'
import { LatticeGizmo } from './LatticeGizmo.tsx'
import { ScreenOffsetGroup } from './ScreenOffsetGroup.tsx'
import { CameraController } from './CameraController.tsx'
import type { CameraSnapTarget } from './CameraController.tsx'
import { SlicePlane3D } from './SlicePlane3D.tsx'
import { fracToCart } from '../utils/lattice.ts'
import { computeTiles } from '../utils/tiling.ts'
import { computeSortedSamples } from '../utils/density-quantile.ts'
import { volumeMinMax } from '../utils/volume-stats.ts'
import { HeatmapLegend } from './HeatmapLegend.tsx'

const _projA = new Vector3()
const _projB = new Vector3()

/** Projects face centers at slice idx 0 and N to screen; writes ±1 to signRef */
function SliceSignUpdater({ lattice, sliceAxis, signRef }: {
  lattice: LatticeMatrix
  sliceAxis: 0 | 1 | 2
  signRef: MutableRefObject<number>
}) {
  const { camera } = useThree()
  const points = useMemo(() => {
    const frac0: [number, number, number] = [0.5, 0.5, 0.5]
    frac0[sliceAxis] = 0
    const fracN: [number, number, number] = [0.5, 0.5, 0.5]
    fracN[sliceAxis] = 1
    return { p0: fracToCart(lattice, frac0), pN: fracToCart(lattice, fracN) }
  }, [lattice, sliceAxis])

  useFrame(() => {
    _projA.set(...points.p0).project(camera)
    _projB.set(...points.pN).project(camera)
    signRef.current = _projB.x > _projA.x ? 1 : -1
  })
  return null
}

interface DensityViewerProps {
  volume: VolumeData
  isoLevel: number
  opacity: number
  showAtoms: boolean
  showAtomLabels: boolean
  showAbcCell: boolean
  showXyzBox: boolean
  dashedLines: boolean
  lineWidth?: number
  activeMovements?: RefObject<Set<string>>
  cameraSnap?: MutableRefObject<CameraSnapTarget | null>
  animationDuration?: number
  onCameraChange?: (theta: number, phi: number, zoom: number, roll: number, targetOffset?: [number, number, number]) => void
  initialCamera?: MutableRefObject<[number, number, number, number] | null>
  initialTargetOffset?: MutableRefObject<[number, number, number] | null>
  showSlice?: boolean
  sliceAxis?: 0 | 1 | 2
  sliceIndex?: number
  label?: string
  tilePadding?: number
  tileFade?: number
  abcIsXyz?: boolean
  sliceStepSignRef?: MutableRefObject<number>
  useGpuVolume?: boolean
  /** Render full volumetric heatmap (turbo) instead of an iso-surface. */
  useHeatmap?: boolean
  /** Signed (diverging) heatmap centered at zero — used for diff volumes. Maps
      [-M, +M] symmetrically so 0 sits at turbo's green midpoint and alpha follows
      |value|/M (near-zero is transparent). */
  heatmapSigned?: boolean
  /** Heatmap density-emphasis exponent (>1 emphasizes high-density tail). */
  heatmapGamma?: number
  /** Densities below this fraction (0–1) contribute zero alpha. */
  heatmapLowCutoff?: number
  /** Ray-march sample count. */
  heatmapStepCount?: number
  /** Heatmap per-sample opacity scalar (independent of iso-surface `opacity`). */
  heatmapOpacity?: number
  /** Histogram-equalize density distribution before colormap. Default true. */
  heatmapEqualize?: boolean
  /** Units suffix for the heatmap legend (e.g. "e/Å³"). */
  heatmapUnits?: string
  /** If set, bypass live isosurface extraction and render a pre-computed GLB preview. */
  glbUrl?: string | null
  /** Override surface color/opacity (e.g. from density-quantile ramp). If null, renderers use defaults. */
  surfaceColor?: [number, number, number] | null
  surfaceOpacityOverride?: number | null
  /** When set, atoms of this element render normally; others fade aggressively. */
  highlightElement?: string | null
  /** Rotation controller flavor: 'orbit' (spherical, pole-clamped), 'trackball'
   *  (drei TrackballControls, no up-vector), 'free' (custom quaternion rigid-body). */
  rotMode?: 'orbit' | 'trackball' | 'free'
}

export function DensityViewer({
  volume,
  isoLevel,
  opacity,
  showAtoms,
  showAtomLabels,
  showAbcCell,
  showXyzBox,
  dashedLines,
  lineWidth = 1,
  activeMovements,
  cameraSnap,
  animationDuration,
  onCameraChange,
  initialCamera,
  initialTargetOffset,
  showSlice,
  sliceAxis,
  sliceIndex,
  label,
  tilePadding = 0,
  tileFade = 1,
  abcIsXyz,
  sliceStepSignRef,
  useGpuVolume,
  useHeatmap,
  heatmapSigned,
  heatmapGamma,
  heatmapLowCutoff,
  heatmapStepCount,
  heatmapOpacity,
  heatmapEqualize,
  heatmapUnits,
  glbUrl,
  surfaceColor,
  surfaceOpacityOverride,
  highlightElement,
  rotMode = 'orbit',
}: DensityViewerProps) {
  const tiles = useMemo(() => {
    if (tilePadding <= 0) return undefined
    return computeTiles(volume.lattice, tilePadding, tileFade)
  }, [volume.lattice, tilePadding, tileFade])

  // Sample-based sorted density distribution. Shared by HeatmapRenderer (CDF
  // LUT for histogram equalization) and HeatmapLegend (density-at-quantile
  // ticks) so the colorbar labels and shader colors stay in sync.
  const sortedSamples = useMemo(() => computeSortedSamples(volume.grid.data), [volume.grid.data])

  const center = useMemo(() => {
    const c = fracToCart(volume.lattice, [0.5, 0.5, 0.5])
    return new Vector3(...c)
  }, [volume.lattice])

  const cameraPosition = useMemo(() => {
    const c = fracToCart(volume.lattice, [0.5, 0.5, 0.5])
    return new Vector3(c[0] + 15, c[1] + 10, c[2] + 15)
  }, [volume.lattice])

  const dataRange = useMemo(() => {
    const r = volumeMinMax(volume.grid.data)
    if (heatmapSigned) {
      // Symmetrize around 0 so green sits at zero in the diverging colormap.
      const M = Math.max(Math.abs(r.min), Math.abs(r.max)) || 1
      return { min: -M, max: M }
    }
    return r
  }, [volume.grid.data, heatmapSigned])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {label && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: 12,
          color: '#ccc',
          fontSize: 14,
          fontWeight: 600,
          zIndex: 1,
          pointerEvents: 'none',
        }}>
          {label}
        </div>
      )}
      <Canvas
        camera={{ position: cameraPosition.toArray(), fov: 50, near: 0.1, far: 500 }}
        style={{ background: '#000' }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 10]} intensity={0.8} />
        <directionalLight position={[-5, -5, 5]} intensity={0.4} />

        {glbUrl
          ? <GlbPreviewRenderer url={glbUrl} opacity={surfaceOpacityOverride ?? opacity} color={surfaceColor ?? undefined} />
          : useHeatmap
            ? <HeatmapRenderer volume={volume} dataMin={dataRange.min} dataMax={dataRange.max} signed={heatmapSigned} opacity={surfaceOpacityOverride ?? heatmapOpacity ?? opacity} gamma={heatmapGamma} lowCutoff={heatmapLowCutoff} stepCount={heatmapStepCount} equalize={heatmapEqualize} sortedSamples={sortedSamples} clipAtoms={showAtoms} tiles={tiles} tilePadding={tilePadding} tileFade={tileFade} />
            : useGpuVolume
              ? <VolumeRenderer volume={volume} isoLevel={isoLevel} opacity={surfaceOpacityOverride ?? opacity} tiles={tiles} tilePadding={tilePadding} tileFade={tileFade} color={surfaceColor ?? undefined} />
              : <IsosurfaceRenderer volume={volume} isoLevel={isoLevel} opacity={surfaceOpacityOverride ?? opacity} tiles={tiles} tilePadding={tilePadding} tileFade={tileFade} color={surfaceColor ?? undefined} />
        }
        <CrystalStructure volume={volume} showAtoms={showAtoms} showAtomLabels={showAtomLabels} showAbcCell={showAbcCell} showXyzBox={showXyzBox} dashedLines={dashedLines} lineWidth={lineWidth} tiles={tiles} tilePadding={tilePadding} tileFade={tileFade} highlightElement={highlightElement} />
        {showSlice && sliceAxis !== undefined && sliceIndex !== undefined && (
          <SlicePlane3D lattice={volume.lattice} axis={sliceAxis} sliceIndex={sliceIndex} dims={volume.grid.dims} data={volume.grid.data} padding={tilePadding} fade={tileFade} />
        )}

        {activeMovements && <CameraController activeMovements={activeMovements} cameraSnap={cameraSnap} animationDuration={animationDuration} onCameraChange={onCameraChange} initialCamera={initialCamera} initialTargetOffset={initialTargetOffset} center={center} />}
        {sliceStepSignRef && sliceAxis !== undefined && (
          <SliceSignUpdater lattice={volume.lattice} sliceAxis={sliceAxis} signRef={sliceStepSignRef} />
        )}

        {rotMode === 'orbit' && <OrbitControls makeDefault target={center.toArray()} />}
        {rotMode === 'trackball' && <TrackballControls makeDefault target={center.toArray()} />}
        {rotMode === 'free' && <FreeRotateControls target={center.toArray()} />}
        <GizmoHelper alignment="bottom-right" margin={[80, 36]}>
          <GizmoViewport axisHeadScale={0.8} labelColor="white" />
          {!abcIsXyz && (
            <ScreenOffsetGroup offset={[-100, 0, 0]}>
              <group scale={40}>
                <LatticeGizmo lattice={volume.lattice} />
              </group>
            </ScreenOffsetGroup>
          )}
        </GizmoHelper>
      </Canvas>
      {useHeatmap && (
        <HeatmapLegend
          dataMin={dataRange.min}
          dataMax={dataRange.max}
          signed={heatmapSigned}
          gamma={heatmapGamma ?? 2.5}
          lowCutoff={heatmapLowCutoff ?? 0}
          units={heatmapUnits}
          equalize={heatmapEqualize}
          sortedSamples={sortedSamples}
        />
      )}
    </div>
  )
}
