import { useRef, useEffect, useMemo } from 'react'
import type { VolumeData } from '../types.ts'
import { viridis } from '../utils/colormap.ts'

interface SliceViewerProps {
  volume: VolumeData
  axis: 0 | 1 | 2
  sliceIndex: number
  padding?: number
  fade?: number
  showAbcCell?: boolean
}

// Match CrystalStructure.tsx LATTICE_COLORS (a=yellow, b=orange, c=violet)
const LATTICE_COLORS = ['#ffcc00', '#ff8822', '#aa55ff'] as const

export function SliceViewer({ volume, axis, sliceIndex: rawSliceIndex, padding = 0, fade = 1, showAbcCell = true }: SliceViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { dims, data } = volume.grid
  const sliceIndex = Math.max(0, Math.min(rawSliceIndex, dims[axis] - 1))

  // Primary-cell 2D slice dimensions
  const [w0, h0] = useMemo(() => {
    if (axis === 0) return [dims[1], dims[2]] // y, z
    if (axis === 1) return [dims[0], dims[2]] // x, z
    return [dims[0], dims[1]] // x, y
  }, [axis, dims])

  // In-plane lattice axes (the two non-slice axes)
  const [axU, axV] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]

  // Canvas covers fractional in-plane coords [-padding, 1+padding]² (same extent as the 3D fade mask)
  const p = padding > 0 ? padding : 0
  const width = Math.max(1, Math.round(w0 * (1 + 2 * p)))
  const height = Math.max(1, Math.round(h0 * (1 + 2 * p)))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = width
    canvas.height = height

    // Min/max over the primary cell (stable colormap regardless of padding)
    let min = Infinity, max = -Infinity
    for (let j = 0; j < h0; j++) {
      for (let i = 0; i < w0; i++) {
        let ix: number, iy: number, iz: number
        if (axis === 0) { ix = sliceIndex; iy = i; iz = j }
        else if (axis === 1) { ix = i; iy = sliceIndex; iz = j }
        else { ix = i; iy = j; iz = sliceIndex }
        const val = data[ix + dims[0] * (iy + dims[1] * iz)]
        if (val < min) min = val
        if (val > max) max = val
      }
    }
    const range = max - min || 1
    const imageData = ctx.createImageData(width, height)

    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        // Fractional in-plane coords relative to primary cell [0,1]²
        const u = (i + 0.5) / w0 - p
        const v = (j + 0.5) / h0 - p
        // Chebyshev distance from primary cell
        const d = Math.max(0, -u, u - 1, -v, v - 1)
        const idx = (j * width + i) * 4
        if (p > 0 && d >= p) {
          imageData.data[idx + 3] = 0
          continue
        }
        // Periodic wrap into primary-cell grid
        const up = ((u % 1) + 1) % 1
        const vp = ((v % 1) + 1) % 1
        const pi = Math.min(w0 - 1, Math.floor(up * w0))
        const pj = Math.min(h0 - 1, Math.floor(vp * h0))
        let ix: number, iy: number, iz: number
        if (axis === 0) { ix = sliceIndex; iy = pi; iz = pj }
        else if (axis === 1) { ix = pi; iy = sliceIndex; iz = pj }
        else { ix = pi; iy = pj; iz = sliceIndex }
        const val = data[ix + dims[0] * (iy + dims[1] * iz)]
        const t = (val - min) / range
        const [r, g, b] = viridis(t)
        let alpha = 255
        if (p > 0 && d > 0 && fade > 0) {
          alpha = Math.round(255 * Math.pow(1 - d / p, fade))
        }
        imageData.data[idx] = r
        imageData.data[idx + 1] = g
        imageData.data[idx + 2] = b
        imageData.data[idx + 3] = alpha
      }
    }
    ctx.putImageData(imageData, 0, 0)
  }, [data, dims, axis, sliceIndex, w0, h0, width, height, p, fade])

  // Primary-cell corners in normalized panel coords [0,1]
  // u-frac=0 → x=p/(1+2p); u-frac=1 → x=(1+p)/(1+2p); same for v
  const lo = p / (1 + 2 * p)
  const hi = (1 + p) / (1 + 2 * p)
  const lo100 = (lo * 100).toFixed(4)
  const hi100 = (hi * 100).toFixed(4)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          imageRendering: 'pixelated',
          display: 'block',
        }}
      />
      {showAbcCell && (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          {/* Two u-axis edges (top & bottom of primary cell), colored by in-plane axis 0 */}
          <line x1={lo100} y1={lo100} x2={hi100} y2={lo100} stroke={LATTICE_COLORS[axU]} strokeWidth="1" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
          <line x1={lo100} y1={hi100} x2={hi100} y2={hi100} stroke={LATTICE_COLORS[axU]} strokeWidth="1" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
          {/* Two v-axis edges (left & right of primary cell), colored by in-plane axis 1 */}
          <line x1={lo100} y1={lo100} x2={lo100} y2={hi100} stroke={LATTICE_COLORS[axV]} strokeWidth="1" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
          <line x1={hi100} y1={lo100} x2={hi100} y2={hi100} stroke={LATTICE_COLORS[axV]} strokeWidth="1" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </div>
  )
}
