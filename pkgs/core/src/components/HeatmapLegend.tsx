import { useMemo } from 'react'
import { turbo } from '../utils/colormap.ts'

interface HeatmapLegendProps {
  dataMin: number
  dataMax: number
  /** Diverging mode: bar centers at 0; alpha follows |val − 0.5| · 2 to mirror the shader. */
  signed?: boolean
  gamma: number
  lowCutoff: number
  units?: string
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

export function HeatmapLegend({ dataMin, dataMax, signed, gamma, lowCutoff, units }: HeatmapLegendProps) {
  const gradient = useMemo(() => {
    // CSS linear-gradient: bottom (0%, low) → top (100%, high). Alpha follows the
    // shader's `pow(v, gamma)` curve so the legend visually matches the rendering.
    // In signed mode the alpha gates on `|v − 0.5| · 2` so the near-zero band fades.
    const stops: string[] = []
    for (let i = 0; i <= N_STOPS; i++) {
      const v = i / N_STOPS
      const [r, g, b] = turbo(v)
      const effV = signed ? Math.abs(v - 0.5) * 2 : v
      const norm = Math.max(0, (effV - lowCutoff) / Math.max(1 - lowCutoff, 1e-4))
      const alpha = effV <= lowCutoff ? 0 : Math.pow(Math.min(1, norm), gamma)
      stops.push(`rgba(${r.toFixed(0)}, ${g.toFixed(0)}, ${b.toFixed(0)}, ${alpha.toFixed(3)}) ${(v * 100).toFixed(1)}%`)
    }
    return `linear-gradient(to top, ${stops.join(', ')})`
  }, [signed, gamma, lowCutoff])

  const ticks = useMemo(() => {
    const out: { fraction: number; value: number }[] = []
    for (let i = 0; i < N_TICKS; i++) {
      const fraction = i / (N_TICKS - 1)
      out.push({ fraction, value: dataMin + fraction * (dataMax - dataMin) })
    }
    return out
  }, [dataMin, dataMax])

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        pointerEvents: 'none',
        zIndex: 1,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        color: '#ccc',
        userSelect: 'none',
      }}
    >
      <div
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
        }}
      >
        {lowCutoff > 0 && (
          <div
            title={`Low cutoff: ${lowCutoff.toFixed(2)}`}
            style={{
              position: 'absolute',
              left: -2,
              right: -2,
              top: `${(1 - lowCutoff) * 100}%`,
              height: 1,
              background: '#fff',
              opacity: 0.7,
            }}
          />
        )}
      </div>
      <div
        style={{
          position: 'relative',
          height: BAR_HEIGHT,
          minWidth: 56,
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
