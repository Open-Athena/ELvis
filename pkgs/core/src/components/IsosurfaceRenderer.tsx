import { useMemo } from 'react'
import type { VolumeData } from '../types.ts'
import { marchingCubes, extendPeriodicGrid } from '../utils/marching-cubes.ts'
import type { TileInfo } from '../utils/tiling.ts'
import { tileFadeCompile } from '../utils/tile-fade.ts'

interface IsosurfaceRendererProps {
  volume: VolumeData
  isoLevel: number
  opacity: number
  tiles?: TileInfo[]
  tilePadding?: number
  tileFade?: number
  /** Surface color as RGB in [0, 1]. Defaults to `#44aaff` if omitted. */
  color?: [number, number, number]
  /** Signed/diff volumes: render `|isoLevel|` as a green positive shell AND
   *  `-|isoLevel|` as a red negative shell, instead of just the positive one.
   *  Matches the diverging colormap convention used by `HeatmapRenderer`. */
  signed?: boolean
}

// Diverging-colormap anchors for signed shells. Mirror `HeatmapRenderer`.
const DIFF_POS_COLOR: [number, number, number] = [0.10, 0.95, 0.30]  // green
const DIFF_NEG_COLOR: [number, number, number] = [1.00, 0.20, 0.10]  // red

function rgbToHex(c: [number, number, number]): string {
  const to = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, '0')
  return `#${to(c[0])}${to(c[1])}${to(c[2])}`
}

export function IsosurfaceRenderer({ volume, isoLevel, opacity, tiles, tilePadding = 0, tileFade = 1, color, signed = false }: IsosurfaceRendererProps) {
  const extended = useMemo(
    () => extendPeriodicGrid(volume.grid.data, volume.grid.dims),
    [volume],
  )

  const isoAbs = Math.abs(isoLevel)

  // Positive shell — always rendered (in unsigned mode this is the only shell).
  const geometryPos = useMemo(() => {
    return marchingCubes(
      extended.data,
      extended.dims,
      isoAbs,
      volume.lattice,
      volume.grid.dims,
    )
  }, [extended, isoAbs, volume.lattice])

  // Negative shell — only rendered for signed/diff data. Voxels where the
  // volume crosses `-isoAbs` form a shell mirroring the positive one.
  const geometryNeg = useMemo(() => {
    if (!signed) return null
    return marchingCubes(
      extended.data,
      extended.dims,
      -isoAbs,
      volume.lattice,
      volume.grid.dims,
    )
  }, [signed, extended, isoAbs, volume.lattice])

  const fadeCompile = useMemo(() => {
    if (tilePadding <= 0) return undefined
    return tileFadeCompile(volume.lattice, tilePadding, tileFade)
  }, [volume.lattice, tilePadding, tileFade])

  // Early-return AFTER all hooks — React's hook-order rule. Scrubbing iso to
  // near-zero (vacuum density) produces an empty mesh; returning before the
  // hooks above crashed the viewer with "Rendered fewer hooks than expected".
  const posEmpty = geometryPos.getAttribute('position')?.count === 0
  const negEmpty = !geometryNeg || geometryNeg.getAttribute('position')?.count === 0
  if (posEmpty && negEmpty) return null

  const tileList = tiles ?? [{ fracOffset: [0, 0, 0] as [number, number, number], cartOffset: [0, 0, 0] as [number, number, number], opacity: 1, isPrimary: true }]
  const posHex = signed ? rgbToHex(DIFF_POS_COLOR) : (color ? rgbToHex(color) : '#44aaff')
  const negHex = rgbToHex(DIFF_NEG_COLOR)

  return (
    <>
      {tileList.map((tile, i) => {
        if (tile.opacity <= 0) return null
        return (
          <group key={i} position={tile.cartOffset}>
            {!posEmpty && (
              <mesh geometry={geometryPos}>
                <meshStandardMaterial
                  key={`iso-pos-${tilePadding}-${tileFade}`}
                  color={posHex}
                  transparent
                  opacity={opacity}
                  side={2 /* DoubleSide */}
                  depthWrite={false}
                  onBeforeCompile={fadeCompile}
                />
              </mesh>
            )}
            {signed && !negEmpty && geometryNeg && (
              <mesh geometry={geometryNeg}>
                <meshStandardMaterial
                  key={`iso-neg-${tilePadding}-${tileFade}`}
                  color={negHex}
                  transparent
                  opacity={opacity}
                  side={2 /* DoubleSide */}
                  depthWrite={false}
                  onBeforeCompile={fadeCompile}
                />
              </mesh>
            )}
          </group>
        )
      })}
    </>
  )
}
