import { useEffect, useRef, useState, useMemo } from 'react'
import type { MaterialRow } from './loader.ts'

interface ScatterProps {
  rows: MaterialRow[]
  onSelect: (mpId: string) => void
  xKey: 'n_atoms' | 'n_electrons' | 'n_voxels'
  yKey: 'n_atoms' | 'n_electrons' | 'n_voxels'
}

const SPLIT_COLOR: Record<string, string> = {
  train: '#7dd3a1',
  val: '#5fb3d4',
  test: '#f5a3a3',
  unknown: '#666',
}

const PADDING = { top: 16, right: 24, bottom: 36, left: 56 }
const POINT_RADIUS = 2
const HIT_RADIUS = 6

interface Tooltip {
  x: number
  y: number
  row: MaterialRow
}

export function Scatter({ rows, onSelect, xKey, yKey }: ScatterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  // Resize observer keeps canvas dimensions in sync with the container.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const stats = useMemo(() => {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
    for (const r of rows) {
      const x = r[xKey], y = r[yKey]
      if (x < xMin) xMin = x; if (x > xMax) xMax = x
      if (y < yMin) yMin = y; if (y > yMax) yMax = y
    }
    if (!isFinite(xMin)) return null
    // Pad ranges 5% each side so the corners aren't on the axis line.
    const xPad = (xMax - xMin) * 0.05 || 1
    const yPad = (yMax - yMin) * 0.05 || 1
    return { xMin: xMin - xPad, xMax: xMax + xPad, yMin: yMin - yPad, yMax: yMax + yPad }
  }, [rows, xKey, yKey])

  // Project data → screen coords, used by both render and hit-test.
  const project = useMemo(() => {
    if (!stats || size.w === 0 || size.h === 0) return null
    const plotW = size.w - PADDING.left - PADDING.right
    const plotH = size.h - PADDING.top - PADDING.bottom
    if (plotW <= 0 || plotH <= 0) return null
    const { xMin, xMax, yMin, yMax } = stats
    const xScale = plotW / (xMax - xMin || 1)
    const yScale = plotH / (yMax - yMin || 1)
    return {
      px: (x: number) => PADDING.left + (x - xMin) * xScale,
      py: (y: number) => PADDING.top + plotH - (y - yMin) * yScale,
      plotW, plotH, ...stats,
    }
  }, [stats, size])

  // Render points + axes on canvas.
  useEffect(() => {
    if (!canvasRef.current || !project) return
    const canvas = canvasRef.current
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.w * dpr
    canvas.height = size.h * dpr
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size.w, size.h)

    drawAxes(ctx, project, size.w, size.h, xKey, yKey)
    drawPoints(ctx, rows, project, xKey, yKey)
  }, [rows, project, size, xKey, yKey])

  // Hit-test on mouse move. We do a simple linear scan since rows ≤ 5,000;
  // for larger N a quadtree would be the move.
  const onMouseMove = (e: React.MouseEvent) => {
    if (!project) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    let best: { row: MaterialRow; d2: number } | null = null
    for (const r of rows) {
      const dx = project.px(r[xKey]) - mx
      const dy = project.py(r[yKey]) - my
      const d2 = dx * dx + dy * dy
      if (d2 < HIT_RADIUS * HIT_RADIUS && (!best || d2 < best.d2)) best = { row: r, d2 }
    }
    if (best) setTooltip({ x: project.px(best.row[xKey]), y: project.py(best.row[yKey]), row: best.row })
    else setTooltip(null)
  }

  const onMouseLeave = () => setTooltip(null)

  const onClick = () => {
    if (tooltip) onSelect(tooltip.row.mp_id)
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
          <div style={{ color: '#8ab' }}>{tooltip.row.mp_id}</div>
          <div style={{ color: SPLIT_COLOR[tooltip.row.split ?? 'unknown'] }}>{tooltip.row.split ?? 'unknown'}</div>
          <div style={{ color: '#aaa' }}>{xKey} = {tooltip.row[xKey].toLocaleString()}</div>
          <div style={{ color: '#aaa' }}>{yKey} = {tooltip.row[yKey].toLocaleString()}</div>
          <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>click to open</div>
        </div>
      )}
    </div>
  )
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  rows: MaterialRow[],
  project: NonNullable<ReturnType<typeof useMemo<unknown>>> & { px: (x: number) => number; py: (y: number) => number },
  xKey: ScatterProps['xKey'],
  yKey: ScatterProps['yKey'],
) {
  // Group fills so we set fillStyle once per split, not per-point.
  const buckets = new Map<string, MaterialRow[]>()
  for (const r of rows) {
    const k = r.split ?? 'unknown'
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)!.push(r)
  }
  // Render order: unknown → train → val → test (so test stands out in front)
  const order = ['unknown', 'train', 'val', 'test'] as const
  for (const split of order) {
    const list = buckets.get(split)
    if (!list) continue
    ctx.fillStyle = SPLIT_COLOR[split]
    ctx.globalAlpha = split === 'unknown' ? 0.5 : 0.85
    ctx.beginPath()
    for (const r of list) {
      const x = project.px(r[xKey])
      const y = project.py(r[yKey])
      ctx.moveTo(x + POINT_RADIUS, y)
      ctx.arc(x, y, POINT_RADIUS, 0, Math.PI * 2)
    }
    ctx.fill()
  }
  ctx.globalAlpha = 1
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

  // Plot frame
  ctx.beginPath()
  ctx.moveTo(PADDING.left, PADDING.top)
  ctx.lineTo(PADDING.left, height - PADDING.bottom)
  ctx.lineTo(width - PADDING.right, height - PADDING.bottom)
  ctx.stroke()

  // X ticks (5 evenly spaced)
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

  // Y ticks
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

  // Axis labels
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
