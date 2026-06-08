/** Sample-based density-distribution analysis for histogram equalization
 *  (shader CDF LUT) and the colorbar legend (density-at-quantile ticks). Both
 *  consume the same sorted-samples array so the legend's tick labels exactly
 *  correspond to the colors the shader paints. */

/** Stride-sample the volume and return raw density values sorted ascending.
 *  Cheap to call (~16k samples by default, one sort, no normalization). */
export function computeSortedSamples(data: Float32Array, sampleTarget = 16384): Float32Array {
  const stride = Math.max(1, Math.floor(data.length / sampleTarget))
  const n = Math.max(1, Math.floor(data.length / stride))
  const samples = new Float32Array(n)
  for (let i = 0, j = 0; i < n && j < data.length; i++, j += stride) {
    samples[i] = data[j]
  }
  samples.sort()
  return samples
}

/** Build a 256-entry CDF LUT from sorted raw-density samples. Maps
 *  normalized val (in `[0, 1]` over the `[dataMin, dataMax]` window) to its
 *  quantile position in the empirical distribution. */
export function buildCDFLUT(
  sortedSamples: Float32Array,
  dataMin: number,
  dataMax: number,
  lutSize = 256,
): Float32Array {
  const range = dataMax - dataMin || 1
  const lut = new Float32Array(lutSize)
  const n = sortedSamples.length
  for (let i = 0; i < lutSize; i++) {
    const v = i / (lutSize - 1)
    const rawV = v * range + dataMin
    let lo = 0, hi = n
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (sortedSamples[mid] < rawV) lo = mid + 1
      else hi = mid
    }
    lut[i] = lo / Math.max(n - 1, 1)
  }
  return lut
}

/** Identity LUT — used when histogram equalization is disabled. */
export function identityLUT(lutSize = 256): Float32Array {
  const lut = new Float32Array(lutSize)
  for (let i = 0; i < lutSize; i++) lut[i] = i / (lutSize - 1)
  return lut
}

/** Density value at the given quantile position `q ∈ [0, 1]` in the
 *  sorted-samples distribution. Linear interpolation between adjacent samples. */
export function densityAtQuantile(sortedSamples: Float32Array, q: number): number {
  const n = sortedSamples.length
  if (n === 0) return 0
  if (q <= 0) return sortedSamples[0]
  if (q >= 1) return sortedSamples[n - 1]
  const idx = q * (n - 1)
  const lo = Math.floor(idx)
  const hi = Math.min(lo + 1, n - 1)
  const t = idx - lo
  return sortedSamples[lo] * (1 - t) + sortedSamples[hi] * t
}
