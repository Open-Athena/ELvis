import { useMemo, useRef, useState, useCallback } from 'react'
import { turbo } from '../utils/colormap.ts'

/** Diverging palette tuned for histogram bars: same red/green hue split as the
 *  shader's `diverging`, but the magnitude curve floors at 0.55 so bars near
 *  zero stay readable instead of fading into the black background. Pure 3D
 *  semantics want the fade-to-black at center; the histogram's job is to make
 *  the distribution legible. */
function divergingBar(t: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, t))
  const u = (v - 0.5) * 2
  const mag = 0.55 + 0.45 * Math.pow(Math.abs(u), 0.5)
  const pos: [number, number, number] = [0.10, 0.95, 0.30]
  const neg: [number, number, number] = [1.00, 0.20, 0.10]
  const c = u >= 0 ? pos : neg
  return [mag * c[0] * 255, mag * c[1] * 255, mag * c[2] * 255]
}

interface HeatmapHistogramProps {
  sortedSamples: Float32Array
  /** Symmetric absolute-max in signed mode, raw max in unsigned mode. The
   *  cutoff in normalized [0, 1] maps to `dataAbsMax * cutoff` in raw density. */
  dataAbsMax: number
  /** Normalized [0, 1] low-cutoff fraction (matches `heatmapLowCutoff` URL state). */
  lowCutoff: number
  /** Bipolar histogram in [-dataAbsMax, +dataAbsMax] with diverging bar fill. */
  signed?: boolean
  /** Total visible bins (for `signed`, split evenly between the two halves). */
  bins?: number
  /** Commit a new low-cutoff fraction (writes URL via debounced parent setter). */
  onCommit: (lowCutoffFrac: number) => void
  /** Transient preview while hovering — caller can re-render shader with the
   *  hovered cutoff and clear on hover-out. Pass `null` to clear. */
  onPreview?: (lowCutoffFrac: number | null) => void
}

/** Quantile above which the long tail is cropped off the x-axis, so the
 *  scrubber is not dominated by a handful of nuclear-core outliers. Applied
 *  to `|sample|` in signed mode. */
const X_AXIS_QUANTILE = 0.995
const HEIGHT = 56
const PAD_TOP = 4
const PAD_BOTTOM = 12

function rgbCss([r, g, b]: [number, number, number], a: number): string {
  return `rgba(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)},${a})`
}

export function HeatmapHistogram({
  sortedSamples, dataAbsMax, lowCutoff, signed = false, bins = 64, onCommit, onPreview,
}: HeatmapHistogramProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverFrac, setHoverFrac] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  // Log-y bars (heavy-tailed density distribution). In signed mode the x-axis
  // spans [-hi, +hi] symmetrically; in unsigned mode it spans [0, hi].
  const { bars, maxLogC, hi } = useMemo(() => {
    const n = sortedSamples.length
    if (n === 0) return { bars: new Uint32Array(bins), maxLogC: 0, hi: 1 }

    // The x-axis cap respects both the data tail (99.5% quantile of |x|) and
    // dataAbsMax (so the cutoff handle never sits past the visible range).
    let absCap: number
    if (signed) {
      // `sortedSamples` may include negatives; build |x| 99.5% quantile via a
      // small probe. We can sample a few entries: smallest/largest both matter
      // since the array is sorted ascending. Take max of |first|, |last|, and
      // the 99.5% / 0.5% absolute-quantile candidates.
      const lo = Math.abs(sortedSamples[Math.floor(0.005 * (n - 1))])
      const hi = Math.abs(sortedSamples[Math.floor(0.995 * (n - 1))])
      absCap = Math.max(lo, hi)
    } else {
      absCap = sortedSamples[Math.floor(X_AXIS_QUANTILE * (n - 1))]
    }
    // Pin `hi` to the data tail (99.5% quantile of |x|) so bar widths stay
    // stable as the user scrubs cutoff. Floor at `0.05 * dataAbsMax` so the
    // handle is visible when the histogram is unusually narrow.
    const hi = Math.max(absCap, dataAbsMax * 0.05)
    const counts = new Uint32Array(bins)

    if (signed) {
      // Bins span [-hi, +hi]; bin index i → density `−hi + (i+0.5) * 2hi/bins`.
      const half = hi
      const binW = (2 * half) / bins
      for (let k = 0; k < n; k++) {
        const v = sortedSamples[k]
        if (v < -half || v > half) continue
        let b = Math.floor((v + half) / binW)
        if (b < 0) b = 0
        else if (b >= bins) b = bins - 1
        counts[b]++
      }
    } else {
      const binW = hi / bins
      // sortedSamples ascending — walk linearly.
      let j = 0
      for (let b = 0; b < bins; b++) {
        const edge = (b + 1) * binW
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
    return { bars: counts, maxLogC: Math.max(0.1, maxLogC), hi }
  }, [sortedSamples, bins, signed, dataAbsMax])

  // x ∈ [0, 1] is svg-space. In signed mode 0.5 is density=0; in unsigned 0 is density=0.
  const fracToCutoff = useCallback((f: number): number => {
    const cf = Math.max(0, Math.min(1, f))
    if (signed) {
      // |2f − 1| ∈ [0, 1] = distance from center → maps directly to lowCutoff fraction.
      // Scale by hi / dataAbsMax so a handle at the visible edge means the cutoff
      // matches the data's absolute max (i.e. 1.0).
      const distFromCenter = Math.abs(2 * cf - 1)
      return Math.min(1, distFromCenter * (hi / dataAbsMax))
    }
    // Unsigned: x-fraction directly maps to density fraction; scale by hi/dataAbsMax.
    return Math.min(1, cf * (hi / dataAbsMax))
  }, [signed, hi, dataAbsMax])

  const cutoffToFrac = useCallback((c: number): number => {
    const cc = Math.max(0, Math.min(1, c))
    // Inverse of fracToCutoff: density at cutoff = cc * dataAbsMax. Convert to svg-x.
    const densityAtCutoff = cc * dataAbsMax
    if (signed) {
      // density / hi = distFromCenter; svg-x = 0.5 ± distFromCenter/2.
      const distFromCenter = Math.min(1, densityAtCutoff / hi)
      return distFromCenter / 2  // returns the *positive-side* offset from center
    }
    return Math.min(1, densityAtCutoff / hi)
  }, [signed, hi, dataAbsMax])

  const fracFromEvent = useCallback((clientX: number): number => {
    const svg = svgRef.current
    if (!svg) return 0
    const r = svg.getBoundingClientRect()
    return r.width > 0 ? (clientX - r.left) / r.width : 0
  }, [])

  // Drag-time writes go to the preview state (instant) instead of the
  // debounced URL setter; URL commit fires once on release. Eliminates the
  // 100 ms scrub lag without losing the per-frame "what will it look like" feel.
  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const f = fracFromEvent(e.clientX)
    setHoverFrac(f)
    onPreview?.(fracToCutoff(f))
  }

  const handleLeave = () => {
    setHoverFrac(null)
    if (!dragging) onPreview?.(null)
  }

  const handleDown = (e: React.PointerEvent<SVGSVGElement>) => {
    setDragging(true)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    onPreview?.(fracToCutoff(fracFromEvent(e.clientX)))
  }

  const handleUp = (e: React.PointerEvent<SVGSVGElement>) => {
    setDragging(false)
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    onCommit(fracToCutoff(fracFromEvent(e.clientX)))
    onPreview?.(null)
  }

  const barW = 1 / bins
  const usableH = HEIGHT - PAD_TOP - PAD_BOTTOM

  // Cutoff lines: unsigned = single line at cutoff; signed = pair at 0.5 ± offset.
  const cutoffOffset = cutoffToFrac(lowCutoff)
  const cutoffLines = signed
    ? [0.5 - cutoffOffset, 0.5 + cutoffOffset]
    : [cutoffOffset]

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
      {/* Bars, colored by colormap at the bin's normalized position. */}
      {Array.from(bars).map((c, i) => {
        const h = (Math.log10(c + 1) / maxLogC) * usableH
        // Bar fill = colormap at its center position in the *shader's* normalized
        // space (signed = [-1, +1] → [0, 1] via (v+1)/2 mirroring shader; unsigned = [0, 1]).
        const t = (i + 0.5) / bins
        const rgb = signed ? divergingBar(t) : turbo(t)
        return (
          <rect
            key={i}
            x={i * barW}
            y={PAD_TOP + (usableH - h)}
            width={barW * 0.92}
            height={h}
            fill={rgbCss(rgb, 0.85)}
          />
        )
      })}
      {/* Shaded region: where the shader gates alpha to 0. */}
      {signed ? (
        <rect
          x={0.5 - cutoffOffset} y={0}
          width={cutoffOffset * 2} height={HEIGHT}
          fill="rgba(0,0,0,0.75)"
        />
      ) : cutoffOffset > 0 && (
        <rect
          x={0} y={0}
          width={cutoffOffset} height={HEIGHT}
          fill="rgba(0,0,0,0.75)"
        />
      )}
      {/* Center marker in signed mode (density = 0). */}
      {signed && (
        <line
          x1={0.5} x2={0.5}
          y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM}
          stroke="#888" strokeWidth={0.004} strokeDasharray="0.006 0.004"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {cutoffLines.map((x, i) => (
        <line
          key={i}
          x1={x} x2={x}
          y1={0} y2={HEIGHT}
          stroke="#ffcc66" strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
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
