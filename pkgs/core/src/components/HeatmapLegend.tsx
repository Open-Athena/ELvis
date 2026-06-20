import { useCallback, useMemo, useRef, useState } from 'react'
import { turbo, diverging } from '../utils/colormap.ts'
import { densityAtQuantile } from '../utils/density-quantile.ts'

interface HeatmapLegendProps {
  dataMin: number
  dataMax: number
  /** Diverging mode: bar centers at 0; alpha follows |val − 0.5| · 2 to mirror the shader. */
  signed?: boolean
  gamma: number
  lowCutoff: number
  units?: string
  /** When true (and `sortedSamples` provided), tick labels show density at the
   *  quantile position of the colorbar (so each color band spans equal voxel
   *  count). When false, ticks are linear interpolation of `[dataMin, dataMax]`. */
  equalize?: boolean
  sortedSamples?: Float32Array
  /** Commit a low-cutoff fraction on pointer release (URL write). When absent,
   *  the colorbar stays non-interactive (legacy display-only mode). */
  onLowCutoffChange?: (v: number) => void
  /** Transient cutoff preview during drag/hover. `null` clears. */
  onLowCutoffPreview?: (v: number | null) => void
  /** Cross-widget hover indicator: render a white preview marker at this
   *  cutoff value. Shared between the legend and the histogram so hovering
   *  one widget shows where the cursor would land in the other. `null`
   *  hides the marker. */
  previewCutoff?: number | null
}

const BAR_WIDTH = 22
const BAR_HEIGHT = 220
const N_STOPS = 32
const N_TICKS = 5

function formatValue(v: number): string {
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a < 0.01 || a >= 10000) return v.toExponential(2)
  if (a < 1) return v.toFixed(3)
  if (a < 100) return v.toFixed(2)
  return v.toFixed(1)
}

export function HeatmapLegend({
  dataMin, dataMax, signed, gamma, lowCutoff, units, equalize, sortedSamples,
  onLowCutoffChange, onLowCutoffPreview, previewCutoff,
}: HeatmapLegendProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hoverY, setHoverY] = useState<number | null>(null)
  const interactive = !!onLowCutoffChange

  // y ∈ [0, 1] from top of bar → cutoff fraction. Unsigned: top=high, bottom=0,
  // so cutoff = 1 − y (the shader gates v < cutoff). Signed: cutoff measures
  // distance from the bar's center, so cutoff = |2y − 1|.
  const yFracToCutoff = useCallback((yf: number): number => {
    const y = Math.max(0, Math.min(1, yf))
    return signed ? Math.abs(2 * y - 1) : 1 - y
  }, [signed])

  const yFracFromEvent = useCallback((clientY: number): number => {
    const r = barRef.current?.getBoundingClientRect()
    if (!r || r.height <= 0) return 0
    return (clientY - r.top) / r.height
  }, [])

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return
    const yf = yFracFromEvent(e.clientY)
    setHoverY(yf)
    onLowCutoffPreview?.(yFracToCutoff(yf))
  }

  const handleLeave = () => {
    setHoverY(null)
    if (!dragging) onLowCutoffPreview?.(null)
  }

  const handleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return
    setDragging(true)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    onLowCutoffPreview?.(yFracToCutoff(yFracFromEvent(e.clientY)))
  }

  const handleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return
    setDragging(false)
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    onLowCutoffChange?.(yFracToCutoff(yFracFromEvent(e.clientY)))
    onLowCutoffPreview?.(null)
  }
  const gradient = useMemo(() => {
    // CSS linear-gradient: bottom (0%, low) → top (100%, high). Alpha follows the
    // shader's `pow(v, gamma)` curve so the legend visually matches the rendering.
    // In signed mode the alpha gates on `|v − 0.5| · 2` so the near-zero band fades.
    const stops: string[] = []
    for (let i = 0; i <= N_STOPS; i++) {
      const v = i / N_STOPS
      const [r, g, b] = signed ? diverging(v) : turbo(v)
      const effV = signed ? Math.abs(v - 0.5) * 2 : v
      const norm = Math.max(0, (effV - lowCutoff) / Math.max(1 - lowCutoff, 1e-4))
      const alpha = effV <= lowCutoff ? 0 : Math.pow(Math.min(1, norm), gamma)
      stops.push(`rgba(${r.toFixed(0)}, ${g.toFixed(0)}, ${b.toFixed(0)}, ${alpha.toFixed(3)}) ${(v * 100).toFixed(1)}%`)
    }
    return `linear-gradient(to top, ${stops.join(', ')})`
  }, [signed, gamma, lowCutoff])

  const ticks = useMemo(() => {
    const out: { fraction: number; value: number }[] = []
    // In equalize mode, each visual fraction `f` corresponds to "voxel at
    // quantile f" — so tick labels are the raw density at that quantile.
    // In linear mode, labels are the linear interpolation across [min, max].
    const useQuantile = equalize && sortedSamples && !signed
    for (let i = 0; i < N_TICKS; i++) {
      const fraction = i / (N_TICKS - 1)
      const value = useQuantile
        ? densityAtQuantile(sortedSamples, fraction)
        : dataMin + fraction * (dataMax - dataMin)
      out.push({ fraction, value })
    }
    return out
  }, [dataMin, dataMax, equalize, sortedSamples, signed])

  return (
    <div
      data-testid="heatmap-legend"
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        // Container can pass pointer events through; only the interactive bar
        // claims them (`pointerEvents: 'auto'`). Setting `none` here would
        // block hit-testing of children in some browsers (Chrome on macOS).
        zIndex: 1,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        color: '#ccc',
        userSelect: 'none',
      }}
    >
      <div
        ref={barRef}
        style={{
          position: 'relative',
          width: BAR_WIDTH,
          height: BAR_HEIGHT,
          background: gradient,
          // Subtle checker behind to make low-alpha (gamma-faded) regions visible.
          backgroundColor: '#222',
          backgroundImage: `${gradient}, repeating-conic-gradient(#1a1a1a 0% 25%, #252525 0% 50%)`,
          backgroundSize: `100% 100%, 8px 8px`,
          border: '1px solid #444',
          pointerEvents: interactive ? 'auto' : 'none',
          cursor: interactive ? 'crosshair' : 'default',
          touchAction: interactive ? 'none' : 'auto',
        }}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        onPointerDown={handleDown}
        onPointerUp={handleUp}
      >
        {/* During drag, drive the marker from local hoverY directly so it
            tracks the cursor without waiting on the App-level re-render. */}
        {(() => {
          const liveCutoff = dragging && hoverY != null ? yFracToCutoff(hoverY) : lowCutoff
          if (liveCutoff <= 0) return null
          if (signed) {
            return (
              <>
                <div
                  title={`Low cutoff: ${liveCutoff.toFixed(2)}`}
                  style={{
                    position: 'absolute', left: -2, right: -2,
                    top: `${(0.5 - liveCutoff / 2) * 100}%`,
                    height: 1, background: '#ffcc66', opacity: 0.85,
                  }}
                />
                <div
                  style={{
                    position: 'absolute', left: -2, right: -2,
                    top: `${(0.5 + liveCutoff / 2) * 100}%`,
                    height: 1, background: '#ffcc66', opacity: 0.85,
                  }}
                />
              </>
            )
          }
          return (
            <div
              title={`Low cutoff: ${liveCutoff.toFixed(2)}`}
              style={{
                position: 'absolute', left: -2, right: -2,
                top: `${(1 - liveCutoff) * 100}%`,
                height: 1, background: '#ffcc66', opacity: 0.85,
              }}
            />
          )
        })()}
        {/* Cross-widget hover indicator. Driven by App-level preview state so
            hovering the heatmap histogram in the drawer also shows where the
            cursor would land on the colorbar (and vice versa). Hidden during
            local drag — the yellow live-cutoff marker is already there. */}
        {previewCutoff != null && !dragging && (() => {
          const c = Math.max(0, Math.min(1, previewCutoff))
          const lineStyle = {
            position: 'absolute' as const, left: -2, right: -2,
            height: 1, background: '#fff', opacity: 0.6, pointerEvents: 'none' as const,
          }
          if (signed) {
            // Symmetric pair at 0.5 ± c/2 mirrors the yellow committed marker.
            return (
              <>
                <div style={{ ...lineStyle, top: `${(0.5 - c / 2) * 100}%` }} />
                <div style={{ ...lineStyle, top: `${(0.5 + c / 2) * 100}%` }} />
              </>
            )
          }
          return <div style={{ ...lineStyle, top: `${(1 - c) * 100}%` }} />
        })()}
      </div>
      <div
        style={{
          position: 'relative',
          height: BAR_HEIGHT,
          minWidth: 56,
          pointerEvents: 'none',
        }}
      >
        {ticks.map(({ fraction, value }) => (
          <div
            key={fraction}
            style={{
              position: 'absolute',
              top: `${(1 - fraction) * 100}%`,
              left: 0,
              transform: 'translateY(-50%)',
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span style={{ display: 'inline-block', width: 6, height: 1, background: '#666', marginRight: 4, verticalAlign: 'middle' }} />
            {formatValue(value)}
          </div>
        ))}
        {units && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              fontSize: 10,
              color: '#888',
            }}
          >
            {units}
          </div>
        )}
      </div>
    </div>
  )
}
