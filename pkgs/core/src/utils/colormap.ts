/** Viridis-like color map (16 stops) */
const VIRIDIS: [number, number, number][] = [
  [68, 1, 84], [72, 26, 108], [71, 47, 126], [65, 68, 135],
  [57, 86, 140], [49, 104, 142], [42, 120, 142], [35, 137, 142],
  [31, 154, 138], [34, 170, 127], [53, 186, 109], [86, 199, 83],
  [128, 209, 54], [177, 214, 24], [225, 213, 13], [253, 231, 37],
]

/** Interpolate the viridis colormap at t ∈ [0, 1] → [r, g, b] in 0–255. */
export function viridis(t: number): [number, number, number] {
  if (!isFinite(t)) return [0, 0, 0]
  const idx = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.min(lo + 1, VIRIDIS.length - 1)
  const f = idx - lo
  return [
    VIRIDIS[lo][0] + f * (VIRIDIS[hi][0] - VIRIDIS[lo][0]),
    VIRIDIS[lo][1] + f * (VIRIDIS[hi][1] - VIRIDIS[lo][1]),
    VIRIDIS[lo][2] + f * (VIRIDIS[hi][2] - VIRIDIS[lo][2]),
  ]
}

/**
 * Turbo colormap at t ∈ [0, 1] → [r, g, b] in 0–255.
 * Polynomial fit by Anton Mikhailov; matches the GLSL `turbo` in HeatmapRenderer.
 */
export function turbo(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, isFinite(t) ? t : 0))
  const x2 = x * x, x3 = x2 * x, x4 = x2 * x2, x5 = x3 * x2
  const r = 0.13572138 + 4.61539260 * x + -42.66032258 * x2 + 132.13108234 * x3 + -152.94239396 * x4 + 59.28637943 * x5
  const g = 0.09140261 + 2.19418839 * x +   4.84296658 * x2 + -14.18503333 * x3 +    4.27729857 * x4 +  2.82956604 * x5
  const b = 0.10667330 + 12.64194608 * x + -60.58204836 * x2 + 110.36276771 * x3 +  -89.90310912 * x4 + 27.34824973 * x5
  return [
    Math.max(0, Math.min(255, r * 255)),
    Math.max(0, Math.min(255, g * 255)),
    Math.max(0, Math.min(255, b * 255)),
  ]
}
