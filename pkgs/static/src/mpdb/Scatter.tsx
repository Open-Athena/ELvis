import { useEffect, useRef, useState, useMemo } from 'react'
import type { ScatterData } from './loader.ts'

interface ScatterProps {
  data: ScatterData
  onSelect: (mpId: string) => void
  xKey: 'nAtoms' | 'nElectrons' | 'nVoxels'
  yKey: 'nAtoms' | 'nElectrons' | 'nVoxels'
}

const SPLIT_COLOR: Record<string, string> = {
  train: '#7dd3a1',
  val: '#5fb3d4',
  test: '#f5a3a3',
  unknown: '#666',
}

const PADDING = { top: 16, right: 24, bottom: 36, left: 56 }

const LABELS: Record<ScatterProps['xKey'], string> = {
  nAtoms: 'n_atoms',
  nElectrons: 'n_electrons',
  nVoxels: 'n_voxels',
}
const POINT_RADIUS = 2
const HIT_RADIUS = 6
const HIT_RADIUS_SQ = HIT_RADIUS * HIT_RADIUS

interface Tooltip {
  x: number
  y: number
  idx: number
}

export function Scatter({ data, onSelect, xKey, yKey }: ScatterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const xs = data[xKey]
  const ys = data[yKey]

  // Axis range from typed-array min/max (no allocation per row).
  const ranges = useMemo(() => {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i], y = ys[i]
      if (x < xMin) xMin = x; if (x > xMax) xMax = x
      if (y < yMin) yMin = y; if (y > yMax) yMax = y
    }
    if (!isFinite(xMin)) return null
    const xPad = (xMax - xMin) * 0.05 || 1
    const yPad = (yMax - yMin) * 0.05 || 1
    return { xMin: xMin - xPad, xMax: xMax + xPad, yMin: yMin - yPad, yMax: yMax + yPad }
  }, [xs, ys])

  const project = useMemo(() => {
    if (!ranges || size.w === 0 || size.h === 0) return null
    const plotW = size.w - PADDING.left - PADDING.right
    const plotH = size.h - PADDING.top - PADDING.bottom
    if (plotW <= 0 || plotH <= 0) return null
    const { xMin, xMax, yMin, yMax } = ranges
    const xScale = plotW / (xMax - xMin || 1)
    const yScale = plotH / (yMax - yMin || 1)
    return {
      px: (x: number) => PADDING.left + (x - xMin) * xScale,
      py: (y: number) => PADDING.top + plotH - (y - yMin) * yScale,
      plotW, plotH, ...ranges,
    }
  }, [ranges, size])

  // Precompute screen-space x/y for every point, in two Float32Arrays. The hit-test
  // uses these to skip recomputing per mousemove.
  const screenCoords = useMemo(() => {
    if (!project) return null
    const n = xs.length
    const sx = new Float32Array(n)
    const sy = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      sx[i] = project.px(xs[i])
      sy[i] = project.py(ys[i])
    }
    return { sx, sy, n }
  }, [project, xs, ys])

  // Render points + axes.
  useEffect(() => {
    if (!canvasRef.current || !project || !screenCoords) return
    const canvas = canvasRef.current
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.w * dpr
    canvas.height = size.h * dpr
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size.w, size.h)

    drawAxes(ctx, project, size.w, size.h, LABELS[xKey], LABELS[yKey])

    // Group draws by split colour: one beginPath/fill per split, all dots inside.
    const order = ['unknown', 'train', 'val', 'test'] as const
    for (const split of order) {
      ctx.fillStyle = SPLIT_COLOR[split]
      ctx.globalAlpha = split === 'unknown' ? 0.5 : 0.85
      ctx.beginPath()
      const matchKey = split === 'unknown' ? null : split
      for (let i = 0; i < screenCoords.n; i++) {
        if (data.splits[i] !== matchKey) continue
        const x = screenCoords.sx[i]
        const y = screenCoords.sy[i]
        ctx.moveTo(x + POINT_RADIUS, y)
        ctx.arc(x, y, POINT_RADIUS, 0, Math.PI * 2)
      }
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }, [data, project, screenCoords, size, xKey, yKey])

  const onMouseMove = (e: React.MouseEvent) => {
    if (!screenCoords) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    let bestIdx = -1
    let bestD2 = HIT_RADIUS_SQ
    const { sx, sy, n } = screenCoords
    for (let i = 0; i < n; i++) {
      const dx = sx[i] - mx
      if (dx < -HIT_RADIUS || dx > HIT_RADIUS) continue
      const dy = sy[i] - my
      if (dy < -HIT_RADIUS || dy > HIT_RADIUS) continue
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i }
    }
    if (bestIdx >= 0) setTooltip({ x: sx[bestIdx], y: sy[bestIdx], idx: bestIdx })
    else setTooltip(null)
  }

  const onMouseLeave = () => setTooltip(null)
  const onClick = () => {
    if (tooltip) onSelect(data.mpIds[tooltip.idx])
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        style={{ display: 'block', cursor: tooltip ? 'pointer' : 'default' }}
      />
      <Legend />
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            background: '#1a1a28',
            border: '1px solid #2a2a40',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12,
            fontFamily: 'ui-monospace, monospace',
            color: '#eee',
            pointerEvents: 'none',
            zIndex: 10,
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ color: '#8ab' }}>{data.mpIds[tooltip.idx]}</div>
          <div style={{ color: SPLIT_COLOR[data.splits[tooltip.idx] ?? 'unknown'] }}>{data.splits[tooltip.idx] ?? 'unknown'}</div>
          <div style={{ color: '#aaa' }}>{LABELS[xKey]} = {xs[tooltip.idx].toLocaleString()}</div>
          <div style={{ color: '#aaa' }}>{LABELS[yKey]} = {ys[tooltip.idx].toLocaleString()}</div>
          <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>click to open</div>
        </div>
      )}
    </div>
  )
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  project: { xMin: number; xMax: number; yMin: number; yMax: number; plotW: number; plotH: number; px: (x: number) => number; py: (y: number) => number },
  width: number,
  height: number,
  xKey: string,
  yKey: string,
) {
  ctx.strokeStyle = '#2a2a40'
  ctx.fillStyle = '#888'
  ctx.font = '11px system-ui, sans-serif'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PADDING.left, PADDING.top)
  ctx.lineTo(PADDING.left, height - PADDING.bottom)
  ctx.lineTo(width - PADDING.right, height - PADDING.bottom)
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let i = 0; i <= 5; i++) {
    const v = project.xMin + (project.xMax - project.xMin) * i / 5
    const x = project.px(v)
    ctx.beginPath()
    ctx.moveTo(x, height - PADDING.bottom)
    ctx.lineTo(x, height - PADDING.bottom + 4)
    ctx.stroke()
    ctx.fillText(formatTick(v), x, height - PADDING.bottom + 6)
  }

  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 5; i++) {
    const v = project.yMin + (project.yMax - project.yMin) * i / 5
    const y = project.py(v)
    ctx.beginPath()
    ctx.moveTo(PADDING.left - 4, y)
    ctx.lineTo(PADDING.left, y)
    ctx.stroke()
    ctx.fillText(formatTick(v), PADDING.left - 6, y)
  }

  ctx.fillStyle = '#aaa'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(xKey, width / 2, height - 4)
  ctx.save()
  ctx.translate(14, height / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillText(yKey, 0, 0)
  ctx.restore()
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`
  return v.toFixed(0)
}

function Legend() {
  const splits = ['train', 'val', 'test', 'unknown'] as const
  return (
    <div style={{
      position: 'absolute', top: 8, right: 12,
      display: 'flex', gap: 12, fontSize: 11, color: '#aaa',
      fontFamily: 'system-ui, sans-serif',
      pointerEvents: 'none',
    }}>
      {splits.map(s => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: SPLIT_COLOR[s], display: 'inline-block' }} />
          {s}
        </div>
      ))}
    </div>
  )
}
