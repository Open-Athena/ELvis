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
  /** Cross-widget hover indicator (shared with `HeatmapLegend`). Render a white
   *  marker at this cutoff so hovering the legend also shows here. */
  previewCutoff?: number | null
}

const HEIGHT = 56
const PAD_TOP = 4
const PAD_BOTTOM = 12

function rgbCss([r, g, b]: [number, number, number], a: number): string {
  return `rgba(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)},${a})`
}

export function HeatmapHistogram({
  sortedSamples, dataAbsMax, lowCutoff, signed = false, bins = 64, onCommit, onPreview, previewCutoff,
}: HeatmapHistogramProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverFrac, setHoverFrac] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  // Log-x bins, log-y bars. The x-axis spans [0, dataAbsMax] in log10 space
  // (signed: bipolar around center, each half log-scaled to ±dataAbsMax). This
  // gives the cursor full reach (cutoff=1 at the edges) without squishing the
  // bulk of the distribution into the leftmost pixels — bars stay readable for
  // both the low-density bulk AND the high-density tail.
  const L = useMemo(() => Math.max(1e-6, Math.log10(dataAbsMax + 1)), [dataAbsMax])

  // x-frac → signed density. For unsigned, equivalent to f→ density (f≥0).
  // For signed, f=0.5 → 0 (center), f∈[0,0.5) → negative, f∈(0.5,1] → positive.
  const fracToDensity = useCallback((f: number): number => {
    const cf = Math.max(0, Math.min(1, f))
    if (signed) {
      const distFromCenter = 2 * cf - 1  // [-1, 1]
      const sign = distFromCenter >= 0 ? 1 : -1
      return sign * (Math.pow(10, Math.abs(distFromCenter) * L) - 1)
    }
    return Math.pow(10, cf * L) - 1
  }, [signed, L])

  const { bars, maxLogC } = useMemo(() => {
    const n = sortedSamples.length
    if (n === 0) return { bars: new Uint32Array(bins), maxLogC: 0 }
    // Precompute log-spaced bin edges in density space. sortedSamples is
    // ascending, so we can walk once and bucket as edges are crossed.
    const edges = new Float64Array(bins + 1)
    for (let i = 0; i <= bins; i++) edges[i] = fracToDensity(i / bins)
    const counts = new Uint32Array(bins)
    let j = 0
    for (let b = 0; b < bins; b++) {
      const edgeHi = edges[b + 1]
      let count = 0
      while (j < n && sortedSamples[j] <= edgeHi) { count++; j++ }
      counts[b] = count
    }
    let maxLogC = 0
    for (let i = 0; i < bins; i++) {
      const l = Math.log10(counts[i] + 1)
      if (l > maxLogC) maxLogC = l
    }
    return { bars: counts, maxLogC: Math.max(0.1, maxLogC) }
  }, [sortedSamples, bins, fracToDensity])

  // Cutoff is always linear in density: c = density / dataAbsMax. We map cursor
  // position through the log x-axis to a density first, then to a cutoff. For
  // signed mode the cutoff is the *magnitude* threshold (symmetric ±), so the
  // returned offset is the half-width (renderer draws 0.5 ± offset).
  const fracToCutoff = useCallback((f: number): number => {
    const cf = Math.max(0, Math.min(1, f))
    if (signed) {
      const distFromCenter = Math.abs(2 * cf - 1)
      return Math.min(1, (Math.pow(10, distFromCenter * L) - 1) / dataAbsMax)
    }
    return Math.min(1, (Math.pow(10, cf * L) - 1) / dataAbsMax)
  }, [signed, L, dataAbsMax])

  const cutoffToFrac = useCallback((c: number): number => {
    const cc = Math.max(0, Math.min(1, c))
    const densityAtCutoff = cc * dataAbsMax
    const mag = Math.min(1, Math.log10(densityAtCutoff + 1) / L)
    return signed ? mag / 2 : mag  // signed: half-width offset; unsigned: x-position
  }, [signed, L, dataAbsMax])

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

  // While dragging, drive the cutoff overlay from local hoverFrac so the
  // marker tracks the cursor immediately — the same value is in flight to the
  // App-level preview state but a parent re-render round-trip would otherwise
  // visibly lag the marker behind the cursor for a frame or two.
  const liveCutoffOffset = dragging && hoverFrac != null
    ? (signed ? Math.abs(hoverFrac - 0.5) : Math.min(1, hoverFrac))
    : cutoffToFrac(lowCutoff)
  const cutoffLines = signed
    ? [0.5 - liveCutoffOffset, 0.5 + liveCutoffOffset]
    : [liveCutoffOffset]

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
          x={0.5 - liveCutoffOffset} y={0}
          width={liveCutoffOffset * 2} height={HEIGHT}
          fill="rgba(0,0,0,0.75)"
        />
      ) : liveCutoffOffset > 0 && (
        <rect
          x={0} y={0}
          width={liveCutoffOffset} height={HEIGHT}
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
      {/* Cross-widget hover indicator — shared with HeatmapLegend so hovering
          the colorbar shows where the cursor would land in the histogram. */}
      {previewCutoff != null && !dragging && (() => {
        const off = cutoffToFrac(previewCutoff)
        const xs = signed ? [0.5 - off, 0.5 + off] : [off]
        return xs.map((x, i) => (
          <line
            key={i}
            x1={x} x2={x}
            y1={0} y2={HEIGHT}
            stroke="#fff" strokeWidth={1} opacity={0.6}
            vectorEffect="non-scaling-stroke"
          />
        ))
      })()}
    </svg>
  )
}
