/**
 * Iso-surface color/opacity ramp keyed by density quantile ∈ [0, 1].
 *
 * Usage: sweep the iso slider, look up the current iso's quantile in the
 * volume's quantile table, interpolate this ramp to get a color + opacity
 * that signals how much of the density range is enclosed. Low-quantile iso
 * surfaces (large, diffuse, bond-rich) get one color; high-quantile surfaces
 * (tight atomic cores) get another.
 */
export interface ColorStop {
  q: number
  color: [number, number, number]
  opacity: number
}

/**
 * Default ramp: a viridis-like perceptual sequence. Low-quantile (diffuse)
 * iso surfaces appear purple/blue with low opacity; high-quantile (tight
 * atomic-core) surfaces appear yellow-green with higher opacity. Viridis is
 * perceptually uniform and colorblind-friendly.
 */
export const DEFAULT_RAMP: ColorStop[] = [
  { q: 0.0, color: [0.267, 0.004, 0.329], opacity: 0.22 }, // dark purple
  { q: 0.25, color: [0.229, 0.322, 0.546], opacity: 0.38 }, // blue
  { q: 0.5, color: [0.128, 0.567, 0.551], opacity: 0.55 }, // teal
  { q: 0.75, color: [0.369, 0.788, 0.383], opacity: 0.72 }, // green
  { q: 1.0, color: [0.993, 0.906, 0.144], opacity: 0.88 }, // yellow
]

export interface SampledColor {
  color: [number, number, number]
  opacity: number
}

/** Linearly interpolate a ramp at quantile `q`. Stops are assumed sorted by `q`. */
export function sampleRamp(stops: ColorStop[], q: number): SampledColor {
  if (q <= stops[0].q) return { color: stops[0].color, opacity: stops[0].opacity }
  const last = stops[stops.length - 1]
  if (q >= last.q) return { color: last.color, opacity: last.opacity }
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (q <= b.q) {
      const t = (q - a.q) / (b.q - a.q)
      return {
        color: [
          a.color[0] + (b.color[0] - a.color[0]) * t,
          a.color[1] + (b.color[1] - a.color[1]) * t,
          a.color[2] + (b.color[2] - a.color[2]) * t,
        ],
        opacity: a.opacity + (b.opacity - a.opacity) * t,
      }
    }
  }
  return { color: last.color, opacity: last.opacity }
}

/** Linear interpolation in a sorted quantile array, q ∈ [0, 1] → density. */
export function quantileToDensity(q: number, qs: Float32Array): number {
  const n = qs.length
  if (q <= 0) return qs[0]
  if (q >= 1) return qs[n - 1]
  const pos = q * (n - 1)
  const i = Math.floor(pos)
  const frac = pos - i
  return qs[i] * (1 - frac) + qs[Math.min(n - 1, i + 1)] * frac
}

/**
 * Binary-search a density value `v` in a sorted quantile array (qs[i] = i/(n-1) quantile),
 * returning a quantile position in [0, 1] with linear refinement between adjacent bins.
 */
export function densityToQuantile(v: number, qs: Float32Array): number {
  let lo = 0, hi = qs.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (qs[mid] < v) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && qs[lo] > v) {
    const span = qs[lo] - qs[lo - 1]
    const frac = span > 0 ? (v - qs[lo - 1]) / span : 0
    return (lo - 1 + frac) / (qs.length - 1)
  }
  return lo / (qs.length - 1)
}
