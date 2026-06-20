import { useMemo, useRef, useState, useCallback } from 'react'
import { densityToQuantile } from '../utils/color-ramp.ts'

interface DensityHistogramProps {
  sortedSamples: Float32Array
  isoLevel: number
  defaultIsoLevel: number
  /** Hard cap on x-axis; clamped further down to a quantile-based bound so the
   *  nuclear-core long tail (max raw density) does not collapse the meaningful
   *  iso range into the leftmost pixels. */
  maxDensity: number
  /** Quantile-mapped axis = each bin spans equal voxel count. False = density-linear. */
  equalize?: boolean
  /** Number of histogram bins. */
  bins?: number
  /** Committed iso change — writes to URL via parent's debounced setter. */
  onCommit: (v: number) => void
  /** Transient hover preview — does not write URL; clears when arg is null. */
  onPreview?: (v: number | null) => void
}

/** Quantile beyond which the long tail (atomic-core peaks) is cropped off the
 *  x-axis. Keeps ~99.5% of voxels visible while preventing the scrubber from
 *  being dominated by a handful of outlier voxels. */
const X_AXIS_QUANTILE = 0.995

const HEIGHT = 56
const PAD_TOP = 4
const PAD_BOTTOM = 12

export function DensityHistogram({
  sortedSamples, isoLevel, defaultIsoLevel, maxDensity,
  equalize = false, bins = 64, onCommit, onPreview,
}: DensityHistogramProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverFrac, setHoverFrac] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  // Density-linear x-axis, log-y bars. CHGCAR distributions are heavily right-
  // skewed (vacuum-density mass near 0, atomic-core peaks far out), so log-y is
  // the only way to see both regimes in one view. `equalize` flips x to
  // quantile-space, which is useful for scrubbing but flattens the bars.
  const { bars, maxLogC, lo, hi } = useMemo(() => {
    const n = sortedSamples.length
    if (n === 0) return { bars: new Uint32Array(bins), maxLogC: 0, lo: 0, hi: 1 }
    const lo = 0
    const xCap = sortedSamples[Math.floor(X_AXIS_QUANTILE * (n - 1))]
    // Always include the current iso (and default iso) in the visible range so
    // the marker lines never clip off-screen when the user dials past the cap.
    const hi = equalize ? 1 : Math.min(maxDensity, Math.max(xCap, isoLevel * 1.05, defaultIsoLevel * 1.05))
    const counts = new Uint32Array(bins)
    if (equalize) {
      const per = n / bins
      for (let b = 0; b < bins; b++) counts[b] = Math.floor(per)
    } else {
      const range = hi - lo || 1
      let j = 0
      for (let b = 0; b < bins; b++) {
        const edge = lo + ((b + 1) / bins) * range
        let count = 0
        while (j < n && sortedSamples[j] <= edge) { count++; j++ }
        counts[b] = count
      }
    }
    let maxLogC = 0
    for (let i = 0; i < bins; i++) {
      const l = Math.log10(counts[i] + 1)
      if (l > maxLogC) maxLogC = l
    }
    return { bars: counts, maxLogC: Math.max(0.1, maxLogC), lo, hi }
  }, [sortedSamples, bins, equalize, maxDensity, isoLevel, defaultIsoLevel])

  const densityToFrac = useCallback((v: number): number => {
    if (equalize) return densityToQuantile(v, sortedSamples)
    return Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)))
  }, [equalize, sortedSamples, lo, hi])

  const fracToDensity = useCallback((f: number): number => {
    const cf = Math.max(0, Math.min(1, f))
    if (equalize) {
      const n = sortedSamples.length
      if (n === 0) return 0
      const idx = cf * (n - 1)
      const i = Math.floor(idx)
      const t = idx - i
      const j = Math.min(n - 1, i + 1)
      return sortedSamples[i] * (1 - t) + sortedSamples[j] * t
    }
    return lo + cf * (hi - lo)
  }, [equalize, sortedSamples, lo, hi])

  const isoFrac = densityToFrac(isoLevel)
  const defaultFrac = densityToFrac(defaultIsoLevel)

  const fracFromEvent = useCallback((clientX: number): number => {
    const svg = svgRef.current
    if (!svg) return 0
    const r = svg.getBoundingClientRect()
    return r.width > 0 ? (clientX - r.left) / r.width : 0
  }, [])

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const f = fracFromEvent(e.clientX)
    setHoverFrac(f)
    const d = fracToDensity(f)
    if (dragging) onCommit(d)
    else onPreview?.(d)
  }

  const handleLeave = () => {
    setHoverFrac(null)
    if (!dragging) onPreview?.(null)
  }

  const handleDown = (e: React.PointerEvent<SVGSVGElement>) => {
    setDragging(true)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    onCommit(fracToDensity(fracFromEvent(e.clientX)))
    onPreview?.(null)
  }

  const handleUp = (e: React.PointerEvent<SVGSVGElement>) => {
    setDragging(false)
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    onPreview?.(null)
  }

  const barW = 1 / bins
  const usableH = HEIGHT - PAD_TOP - PAD_BOTTOM

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 1 ${HEIGHT}`}
      preserveAspectRatio="none"
      style={{
        width: '100%',
        height: HEIGHT,
        display: 'block',
        cursor: 'crosshair',
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: 3,
        touchAction: 'none',
      }}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
    >
      {Array.from(bars).map((c, i) => {
        const h = (Math.log10(c + 1) / maxLogC) * usableH
        return (
          <rect
            key={i}
            x={i * barW}
            y={PAD_TOP + (usableH - h)}
            width={barW * 0.92}
            height={h}
            fill="#5fb3d4"
            opacity={0.55}
          />
        )
      })}
      <line
        x1={defaultFrac} x2={defaultFrac}
        y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM}
        stroke="#888" strokeWidth={1} strokeDasharray="3 2"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={isoFrac} x2={isoFrac}
        y1={0} y2={HEIGHT}
        stroke="#ffcc66" strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      {hoverFrac != null && (
        <line
          x1={hoverFrac} x2={hoverFrac}
          y1={0} y2={HEIGHT}
          stroke="#fff" strokeWidth={1} opacity={0.6}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}
