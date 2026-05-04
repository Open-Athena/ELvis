export function volumeMinMax(data: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity, max = -Infinity
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!isFinite(min)) return { min: 0, max: 1 }
  return { min, max }
}
