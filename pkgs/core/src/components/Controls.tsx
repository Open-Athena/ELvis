import { useEffect, useState, useMemo } from 'react'
import { Atom, Camera, Eye, Flame, Grid3x3, Layers } from 'lucide-react'
import { getElement, ELEMENT_INFO } from '../utils/elements.ts'
import { Tooltip } from './Tooltip.tsx'
import { densityToQuantile, quantileToDensity } from '../utils/color-ramp.ts'
import { DensityHistogram } from './DensityHistogram.tsx'
import { DrawerSection } from './DrawerSection.tsx'
import styles from './Controls.module.css'

const ICON_SIZE = 16
const ACCENT = {
  surface: '#5fb3d4',
  heatmap: '#ff8a3d',
  display: '#a78bfa',
  tiling: '#7dd3a1',
  camera: '#f5a3a3',
  slice: '#f0c674',
}

const ResetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M3.5 2.5v4h4" />
    <path d="M3.5 6.5A5.5 5.5 0 1 1 2.5 9.5" />
  </svg>
)

interface ControlsProps {
  isoLevel: number
  defaultIsoLevel: number
  maxDensity: number
  /** Sorted density quantiles: index i = quantile i/(length-1). Enables non-linear slider scaling. */
  densityQuantiles?: Float32Array | null
  /** Sorted raw-density samples (≈16k). When present, replaces the iso slider with a DensityHistogram. */
  sortedSamples?: Float32Array | null
  onIsoLevelChange: (v: number) => void
  /** Transient iso preview (hover) — does not write URL. Null = clear preview. */
  onIsoPreview?: (v: number | null) => void
  opacity: number
  onOpacityChange: (v: number) => void
  showAtoms: boolean
  onShowAtomsChange: (v: boolean) => void
  showAtomLabels: boolean
  onShowAtomLabelsChange: (v: boolean) => void
  showAbcCell: boolean
  onShowAbcCellChange: (v: boolean) => void
  showXyzBox: boolean
  onShowXyzBoxChange: (v: boolean) => void
  dashedLines: boolean
  onDashedLinesChange: (v: boolean) => void
  orbitDeg: number
  onOrbitDegChange: (v: number) => void
  zoomPct: number
  onZoomPctChange: (v: number) => void
  panStep: number
  onPanStepChange: (v: number) => void
  rollDeg: number
  onRollDegChange: (v: number) => void
  showSlice: boolean
  onShowSliceChange: (v: boolean) => void
  sliceAxis: 0 | 1 | 2
  onSliceAxisChange: (v: 0 | 1 | 2) => void
  sliceIndex: number
  maxSliceIndex: number
  onSliceIndexChange: (v: number) => void
  animDuration: number
  onAnimDurationChange: (v: number) => void
  sweepMode: 'd' | 'r'
  sweepDuration: number
  onSweepDurationChange: (v: number) => void
  onSweepModeToggle: () => void
  sliceSpeed: number
  onSliceSpeedChange: (v: number) => void
  cam: [number, number, number, number] | null
  filename: string
  elements?: string[]
  counts?: number[]
  tilePadding?: number
  onTilePaddingChange?: (v: number) => void
  tileFade?: number
  onTileFadeChange?: (v: number) => void
  /** Element symbol currently hovered in the legend (controlled by parent) */
  highlightElement?: string | null
  /** Called when the user hovers/unhovers an element pill in the legend */
  onHighlightElementChange?: (el: string | null) => void
  /** Whether the current view is a signed diff (`s=d`). Hides the Surface
   *  section since Iso/Opacity don't apply to the heatmap-only diff render. */
  isDiff?: boolean
  /** Heatmap-mode params (only meaningful when heatmap mode is on). */
  useHeatmap?: boolean
  onUseHeatmapChange?: (v: boolean) => void
  heatmapOpacity?: number
  onHeatmapOpacityChange?: (v: number) => void
  heatmapGamma?: number
  onHeatmapGammaChange?: (v: number) => void
  heatmapLowCutoff?: number
  onHeatmapLowCutoffChange?: (v: number) => void
  heatmapStepCount?: number
  onHeatmapStepCountChange?: (v: number) => void
  /** Zarr data-source toggle (prefer chunked multi-res zarr where available). */
  useZarr?: boolean
  onUseZarrChange?: (v: boolean) => void
  /** Rotation controller flavor. */
  rotMode?: 'orbit' | 'trackball' | 'free'
  onRotModeChange?: (v: 'orbit' | 'trackball' | 'free') => void
}

const AXIS_LABELS = ['X', 'Y', 'Z'] as const

// Non-linear padding slider: 0-20 ticks → 0-1 (step 0.05), 20-30 ticks → 1-2 (step 0.1)
const PADDING_TICKS = 30
function paddingToTick(v: number): number {
  if (v <= 1) return Math.round(v / 0.05)
  return 20 + Math.round((v - 1) / 0.1)
}
function tickToPadding(t: number): number {
  if (t <= 20) return Math.round(t * 0.05 * 100) / 100
  return Math.round((1 + (t - 20) * 0.1) * 100) / 100
}

function fmtAngle(n: number): string {
  const s = n.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

export function Controls({
  isoLevel,
  defaultIsoLevel,
  maxDensity,
  densityQuantiles,
  sortedSamples,
  onIsoLevelChange,
  onIsoPreview,
  opacity,
  onOpacityChange,
  showAtoms,
  onShowAtomsChange,
  showAtomLabels,
  onShowAtomLabelsChange,
  showAbcCell,
  onShowAbcCellChange,
  showXyzBox,
  onShowXyzBoxChange,
  dashedLines,
  onDashedLinesChange,
  orbitDeg,
  onOrbitDegChange,
  zoomPct,
  onZoomPctChange,
  panStep,
  onPanStepChange,
  rollDeg,
  onRollDegChange,
  showSlice,
  onShowSliceChange,
  sliceAxis,
  onSliceAxisChange,
  sliceIndex,
  maxSliceIndex,
  onSliceIndexChange,
  animDuration,
  onAnimDurationChange,
  sweepMode,
  sweepDuration,
  onSweepDurationChange,
  onSweepModeToggle,
  sliceSpeed,
  onSliceSpeedChange,
  cam,
  filename,
  elements,
  counts,
  tilePadding,
  onTilePaddingChange,
  tileFade,
  onTileFadeChange,
  highlightElement: _highlightElement,
  onHighlightElementChange,
  isDiff,
  useHeatmap,
  onUseHeatmapChange,
  heatmapOpacity = 0.4,
  onHeatmapOpacityChange,
  heatmapGamma = 2.5,
  onHeatmapGammaChange,
  heatmapLowCutoff = 0,
  onHeatmapLowCutoffChange,
  heatmapStepCount = 256,
  onHeatmapStepCountChange,
  useZarr,
  onUseZarrChange,
  rotMode,
  onRotModeChange,
}: ControlsProps) {
  const tp = tilePadding ?? 0
  const hasTiling = tp > 0
  // Bump forceOpenGen when Tiling becomes active so the section auto-opens once.
  const tilingActiveGen = useMemo(() => hasTiling ? Date.now() : 0, [hasTiling])

  // Element legend brushing: pin via click (sticky), hover otherwise.
  const [pinned, setPinned] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const active = pinned ?? hovered
  useEffect(() => {
    onHighlightElementChange?.(active)
  }, [active, onHighlightElementChange])

  // Only "meaningless" clicks (empty space, no drag, not on an interactive control) unpin.
  useEffect(() => {
    if (!pinned) return
    const INTERACTIVE = [
      'input', 'button', 'select', 'textarea', 'label', 'a', 'summary',
      '[role="button"]', '[role="checkbox"]', '[role="slider"]', '[role="link"]',
      '[role="menuitem"]', '[role="tab"]', '[role="switch"]', '[role="combobox"]',
      '[contenteditable=""]', '[contenteditable="true"]',
      '[data-legend-item]',
    ].join(',')
    let downX = 0
    let downY = 0
    let downInteractive = false
    const onDown = (e: MouseEvent) => {
      downX = e.clientX
      downY = e.clientY
      downInteractive = !!(e.target as Element | null)?.closest(INTERACTIVE)
    }
    const onUp = (e: MouseEvent) => {
      // Drag (>5px movement) → preserve pin
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return
      if (downInteractive) return
      if ((e.target as Element | null)?.closest(INTERACTIVE)) return
      setPinned(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('mouseup', onUp)
    }
  }, [pinned])

  return (
    <div className={styles.controls}>
      <div className={styles.controlTitle}>{filename}</div>
      {elements && elements.length > 0 && (
        <div
          style={{ display: 'flex', gap: 8, padding: '2px 0 6px', flexWrap: 'wrap' }}
          onMouseLeave={() => setHovered(null)}
        >
          {elements.map((el, i) => {
            const { color } = getElement(el)
            const css = `#${color.toString(16).padStart(6, '0')}`
            const count = counts?.[i]
            const info = ELEMENT_INFO[el]
            const isActive = active === el
            const isDimmed = active != null && !isActive
            const isPinned = pinned === el
            const tooltip = info ? `${info.name} (Z = ${info.Z})` : el
            return (
              <Tooltip key={el} label={tooltip} placement="top">
              <span
                data-legend-item=""
                onMouseEnter={() => setHovered(el)}
                onClick={() => setPinned(p => p === el ? null : el)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  color: '#ccc',
                  cursor: 'pointer',
                  opacity: isDimmed ? 0.4 : 1,
                  fontWeight: isActive ? 600 : 400,
                  transition: 'opacity 120ms, font-weight 120ms',
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: isPinned ? `1px solid ${css}` : '1px solid transparent',
                  userSelect: 'none',
                }}
              >
                <span style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: css,
                  display: 'inline-block',
                  flexShrink: 0,
                }} />
                {el}{count != null && count > 1 && <sub>{count}</sub>}
              </span>
              </Tooltip>
            )
          })}
        </div>
      )}

      {!useHeatmap && !isDiff && (
      <DrawerSection id="surface" title="Surface" icon={<Atom size={ICON_SIZE} />} accent={ACCENT.surface} defaultOpen>
          <div className={styles.controlLabel}>
            <div className={styles.sliderHeader}>
              <span>
                Iso: {isoLevel.toFixed(1)}
                {densityQuantiles && (
                  <span style={{ opacity: 0.6, marginLeft: 6 }}>
                    ({(densityToQuantile(isoLevel, densityQuantiles) * 100).toFixed(1)}%)
                  </span>
                )}
              </span>
              <button
                className={styles.resetBtn}
                onClick={() => onIsoLevelChange(defaultIsoLevel)}
                title={`Reset to ${defaultIsoLevel.toFixed(1)}`}
                disabled={Math.abs(isoLevel - defaultIsoLevel) <= 0.1}
              >
                <ResetIcon />
              </button>
            </div>
            {sortedSamples ? (
              <DensityHistogram
                sortedSamples={sortedSamples}
                isoLevel={isoLevel}
                defaultIsoLevel={defaultIsoLevel}
                maxDensity={maxDensity}
                onCommit={onIsoLevelChange}
                onPreview={onIsoPreview}
              />
            ) : densityQuantiles ? (
              <input
                type="range"
                min={0}
                max={1000}
                step={1}
                value={Math.round(densityToQuantile(isoLevel, densityQuantiles) * 1000)}
                onChange={e => onIsoLevelChange(quantileToDensity(parseInt(e.target.value) / 1000, densityQuantiles))}
                className={styles.slider}
              />
            ) : (
              <input
                type="range"
                min={0}
                max={maxDensity}
                step={maxDensity / 500}
                value={isoLevel}
                onChange={e => onIsoLevelChange(parseFloat(e.target.value))}
                className={styles.slider}
              />
            )}
          </div>

          <div className={styles.controlLabel}>
            <div className={styles.sliderHeader}>
              <span>Opacity: {opacity.toFixed(2)}</span>
              <button
                className={styles.resetBtn}
                onClick={() => onOpacityChange(0.6)}
                title="Reset to 0.60"
                disabled={Math.abs(opacity - 0.6) <= 0.005}
              >
                <ResetIcon />
              </button>
            </div>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.01}
              value={opacity}
              onChange={e => onOpacityChange(parseFloat(e.target.value))}
              className={styles.slider}
            />
          </div>
        </DrawerSection>
      )}

      {onUseHeatmapChange && (
        <DrawerSection id="heatmap" title="Heatmap" icon={<Flame size={ICON_SIZE} />} accent={ACCENT.heatmap} defaultOpen={false}>
          <label className={styles.toggle}>
            <input type="checkbox" checked={!!useHeatmap} onChange={e => onUseHeatmapChange(e.target.checked)} />
            Volumetric heatmap
          </label>
          {useHeatmap && onHeatmapGammaChange && onHeatmapLowCutoffChange && onHeatmapStepCountChange && (<>
            {onHeatmapOpacityChange && (
              <div className={styles.controlLabel}>
                <div className={styles.sliderHeader}>
                  <span title="Per-sample opacity scalar — lower lets rays of sight see further into the volume">Opacity: {heatmapOpacity.toFixed(2)}</span>
                  <button
                    className={styles.resetBtn}
                    onClick={() => onHeatmapOpacityChange(0.4)}
                    title="Reset to 0.40"
                    disabled={Math.abs(heatmapOpacity - 0.4) <= 0.005}
                  >
                    <ResetIcon />
                  </button>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.01}
                  value={heatmapOpacity}
                  onChange={e => onHeatmapOpacityChange(parseFloat(e.target.value))}
                  className={styles.slider}
                />
              </div>
            )}
            <div className={styles.controlLabel}>
              <div className={styles.sliderHeader}>
                <span title="Power exponent on per-sample alpha (higher = high-density tail dominates)">Gamma: {heatmapGamma.toFixed(2)}</span>
                <button
                  className={styles.resetBtn}
                  onClick={() => onHeatmapGammaChange(2.5)}
                  title="Reset to 2.50"
                  disabled={Math.abs(heatmapGamma - 2.5) <= 0.01}
                >
                  <ResetIcon />
                </button>
              </div>
              <input
                type="range"
                min={0.5}
                max={5}
                step={0.05}
                value={heatmapGamma}
                onChange={e => onHeatmapGammaChange(parseFloat(e.target.value))}
                className={styles.slider}
              />
            </div>
            <div className={styles.controlLabel}>
              <div className={styles.sliderHeader}>
                <span title="Densities below this fraction contribute zero alpha (hard threshold)">Low cutoff: {heatmapLowCutoff.toFixed(2)}</span>
                <button
                  className={styles.resetBtn}
                  onClick={() => onHeatmapLowCutoffChange(0)}
                  title="Reset to 0"
                  disabled={heatmapLowCutoff === 0}
                >
                  <ResetIcon />
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={heatmapLowCutoff}
                onChange={e => onHeatmapLowCutoffChange(parseFloat(e.target.value))}
                className={styles.slider}
              />
            </div>
            <div className={styles.controlLabel}>
              <div className={styles.sliderHeader}>
                <span title="Ray-march sample count — higher is smoother but slower">Steps: {heatmapStepCount}</span>
                <button
                  className={styles.resetBtn}
                  onClick={() => onHeatmapStepCountChange(256)}
                  title="Reset to 256"
                  disabled={heatmapStepCount === 256}
                >
                  <ResetIcon />
                </button>
              </div>
              <input
                type="range"
                min={64}
                max={512}
                step={32}
                value={heatmapStepCount}
                onChange={e => onHeatmapStepCountChange(parseInt(e.target.value))}
                className={styles.slider}
              />
            </div>
          </>)}
        </DrawerSection>
      )}

      <DrawerSection id="display" title="Display" icon={<Eye size={ICON_SIZE} />} accent={ACCENT.display} defaultOpen>
          <label className={styles.toggle}>
            <input type="checkbox" checked={showAtoms} onChange={e => onShowAtomsChange(e.target.checked)} />
            Show atoms
          </label>

          <label className={styles.toggle}>
            <input type="checkbox" checked={showAtomLabels} onChange={e => onShowAtomLabelsChange(e.target.checked)} />
            Atom labels
          </label>

          <label className={styles.toggle}>
            <input type="checkbox" checked={showAbcCell} onChange={e => onShowAbcCellChange(e.target.checked)} />
            Show abc box
          </label>

          <label className={styles.toggle}>
            <input type="checkbox" checked={showXyzBox} onChange={e => onShowXyzBoxChange(e.target.checked)} />
            Show XYZ box
          </label>

          <label className={styles.toggle}>
            <input type="checkbox" checked={dashedLines} onChange={e => onDashedLinesChange(e.target.checked)} />
            Dashed outlines
          </label>

          {onUseZarrChange && (
            <label className={styles.toggle}>
              <input type="checkbox" checked={!!useZarr} onChange={e => onUseZarrChange(e.target.checked)} />
              Zarr (multi-res)
            </label>
          )}
        </DrawerSection>

      {onTilePaddingChange && (
        <DrawerSection id="tiling" title="Tiling" icon={<Grid3x3 size={ICON_SIZE} />} accent={ACCENT.tiling} defaultOpen={false} forceOpenGen={tilingActiveGen}>
            <label className={styles.controlLabel}>
              <div className={styles.sliderHeader}>
                <span>Padding: {tp.toFixed(2)}</span>
                <button
                  className={styles.resetBtn}
                  onClick={() => onTilePaddingChange(0)}
                  title="Reset to 0"
                  disabled={tp === 0}
                >
                  <ResetIcon />
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={PADDING_TICKS}
                step={1}
                value={paddingToTick(tp)}
                onChange={e => onTilePaddingChange(tickToPadding(parseInt(e.target.value)))}
                className={styles.slider}
              />
            </label>
            {hasTiling && onTileFadeChange && (
              <label className={styles.controlLabel}>
                Fade: {(tileFade ?? 1) === 0 ? 'off' : (tileFade ?? 1).toFixed(1)}
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.5}
                  value={tileFade ?? 1}
                  onChange={e => onTileFadeChange(parseFloat(e.target.value))}
                  className={styles.slider}
                />
              </label>
            )}
        </DrawerSection>
      )}

      <DrawerSection id="camera" title="Camera" icon={<Camera size={ICON_SIZE} />} accent={ACCENT.camera} defaultOpen>
          {onRotModeChange && (
            <label className={styles.controlLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span title="orbit: spherical, pole-clamped (default). trackball: drei TrackballControls (no up vector). free: custom quaternion rigid-body — drag rotates around current view, no poles">Rotate:</span>
              <select
                value={rotMode ?? 'orbit'}
                onChange={e => onRotModeChange(e.target.value as 'orbit' | 'trackball' | 'free')}
                style={{ background: '#2a2a3e', color: '#ccc', border: '1px solid #555', borderRadius: 3, fontSize: 12, padding: '2px 4px' }}
              >
                <option value="orbit">orbit (spherical)</option>
                <option value="trackball">trackball</option>
                <option value="free">free (quaternion)</option>
              </select>
            </label>
          )}
          <label className={styles.toggle}>
            <input type="checkbox" checked={orbitDeg > 0} onChange={e => onOrbitDegChange(e.target.checked ? 90 : 0)} />
            Orbit step{orbitDeg > 0 && <>:
              <input
                type="number"
                min={1}
                max={360}
                value={orbitDeg}
                onChange={e => { const v = parseInt(e.target.value); if (v > 0) onOrbitDegChange(v) }}
                onClick={e => e.stopPropagation()}
                style={{ width: 32, marginLeft: 4, padding: '0 2px', background: '#2a2a3e', color: '#ccc', border: '1px solid #555', borderRadius: 3, fontSize: 12, textAlign: 'right' }}
              /><span style={{ marginLeft: 1 }}>°</span>
            </>}
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={zoomPct > 0} onChange={e => onZoomPctChange(e.target.checked ? 20 : 0)} />
            Zoom step{zoomPct > 0 && <>:
              <input
                type="number"
                min={1}
                max={200}
                value={zoomPct}
                onChange={e => { const v = parseInt(e.target.value); if (v > 0) onZoomPctChange(v) }}
                onClick={e => e.stopPropagation()}
                style={{ width: 32, marginLeft: 4, padding: '0 2px', background: '#2a2a3e', color: '#ccc', border: '1px solid #555', borderRadius: 3, fontSize: 12, textAlign: 'right' }}
              /><span style={{ marginLeft: 1 }}>%</span>
            </>}
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={panStep > 0} onChange={e => onPanStepChange(e.target.checked ? 1 : 0)} />
            Pan step{panStep > 0 && <>:
              <input
                type="number"
                min={0.1}
                max={20}
                step={0.1}
                value={panStep}
                onChange={e => { const v = parseFloat(e.target.value); if (v > 0) onPanStepChange(v) }}
                onClick={e => e.stopPropagation()}
                style={{ width: 36, marginLeft: 4, padding: '0 2px', background: '#2a2a3e', color: '#ccc', border: '1px solid #555', borderRadius: 3, fontSize: 12, textAlign: 'right' }}
              />
            </>}
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={rollDeg > 0} onChange={e => onRollDegChange(e.target.checked ? 90 : 0)} />
            Roll step{rollDeg > 0 && <>:
              <input
                type="number"
                min={1}
                max={360}
                value={rollDeg}
                onChange={e => { const v = parseInt(e.target.value); if (v > 0) onRollDegChange(v) }}
                onClick={e => e.stopPropagation()}
                style={{ width: 32, marginLeft: 4, padding: '0 2px', background: '#2a2a3e', color: '#ccc', border: '1px solid #555', borderRadius: 3, fontSize: 12, textAlign: 'right' }}
              /><span style={{ marginLeft: 1 }}>°</span>
            </>}
          </label>
          <label className={styles.controlLabel}>
            Animation: {animDuration.toFixed(1)}s
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={animDuration}
              onChange={e => onAnimDurationChange(parseFloat(e.target.value))}
              className={styles.slider}
            />
          </label>
          {cam && (
            <div className={styles.camInfo}>
              <span title="Azimuth (theta)">θ {fmtAngle(cam[0])}°</span>
              <span title="Elevation (phi)">φ {fmtAngle(cam[1])}°</span>
              <span title="Distance">d {parseFloat(cam[2].toPrecision(3))}</span>
              {Math.abs(cam[3]) >= 0.05 && <span title="Roll">↻ {fmtAngle(cam[3])}°</span>}
            </div>
          )}
        </DrawerSection>

      <DrawerSection id="slice" title="Slice" icon={<Layers size={ICON_SIZE} />} accent={ACCENT.slice} defaultOpen={false}>
          <label className={styles.toggle}>
            <input type="checkbox" checked={showSlice} onChange={e => onShowSliceChange(e.target.checked)} />
            2D Slice
          </label>

          {showSlice && (
            <>
              <div className={styles.axisButtons}>
                {AXIS_LABELS.map((label, i) => (
                  <button
                    key={label}
                    className={`${styles.axisBtn} ${sliceAxis === i ? styles.axisBtnActive : ''}`}
                    onClick={() => onSliceAxisChange(i as 0 | 1 | 2)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className={styles.controlLabel}>
                Slice: {sliceIndex} / {maxSliceIndex}
                <input
                  type="range"
                  min={0}
                  max={maxSliceIndex}
                  step={1}
                  value={sliceIndex}
                  onChange={e => onSliceIndexChange(parseInt(e.target.value))}
                  className={styles.slider}
                />
              </label>
              <label className={styles.controlLabel}>
                <div className={styles.sliderHeader}>
                  <span>Sweep: {sweepMode === 'd' ? `${sweepDuration.toFixed(1)}s` : `${sliceSpeed} sl/s`}</span>
                  <button
                    className={styles.resetBtn}
                    onClick={e => { e.preventDefault(); onSweepModeToggle() }}
                    title={sweepMode === 'd' ? 'Switch to slices/sec' : 'Switch to duration'}
                  >
                    ↔
                  </button>
                </div>
                {sweepMode === 'd' ? (
                  <input
                    type="range"
                    min={0.5}
                    max={10}
                    step={0.5}
                    value={sweepDuration}
                    onChange={e => onSweepDurationChange(parseFloat(e.target.value))}
                    className={styles.slider}
                  />
                ) : (
                  <input
                    type="range"
                    min={5}
                    max={500}
                    step={5}
                    value={sliceSpeed}
                    onChange={e => onSliceSpeedChange(parseInt(e.target.value))}
                    className={styles.slider}
                  />
                )}
              </label>
            </>
          )}
      </DrawerSection>
    </div>
  )
}
