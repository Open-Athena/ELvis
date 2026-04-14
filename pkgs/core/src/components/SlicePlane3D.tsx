import { useMemo } from 'react'
import { CanvasTexture, DoubleSide, NearestFilter, RepeatWrapping } from 'three'
import type { LatticeMatrix } from '../types.ts'
import { fracToCart } from '../utils/lattice.ts'
import { viridis } from '../utils/colormap.ts'
import { tileFadeCompile } from '../utils/tile-fade.ts'

interface SlicePlane3DProps {
  lattice: LatticeMatrix
  axis: 0 | 1 | 2
  sliceIndex: number
  dims: [number, number, number]
  data: Float32Array
  padding?: number
  fade?: number
}

export function SlicePlane3D({ lattice, axis, sliceIndex, dims, data, padding = 0, fade = 1 }: SlicePlane3DProps) {
  const { vertices, uvs, texture } = useMemo(() => {
    const t = (sliceIndex + 0.5) / dims[axis]
    const axes = [0, 1, 2].filter(a => a !== axis)
    const lo = -padding
    const hi = 1 + padding
    // 4 corners of the slice quad in fractional coords, extended by padding in-plane
    const corners: [number, number, number][] = []
    for (const u of [lo, hi]) {
      for (const v of [lo, hi]) {
        const frac: [number, number, number] = [0, 0, 0]
        frac[axis] = t
        frac[axes[0]] = u
        frac[axes[1]] = v
        corners.push(frac)
      }
    }
    // Convert to Cartesian: corners are [lo_lo, lo_hi, hi_lo, hi_hi]
    // Triangles: (lo_lo, hi_lo, lo_hi), (hi_lo, hi_hi, lo_hi)
    const c = corners.map(f => fracToCart(lattice, f))
    const verts = new Float32Array([
      ...c[0], ...c[2], ...c[1],
      ...c[2], ...c[3], ...c[1],
    ])
    // UVs match fractional in-plane position; RepeatWrapping tiles the one-period texture
    const uv = new Float32Array([
      lo, lo,  hi, lo,  lo, hi,
      hi, lo,  hi, hi,  lo, hi,
    ])

    // Generate density texture for one period of this slice
    const w = dims[axes[0]]
    const h = dims[axes[1]]
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    const imageData = ctx.createImageData(w, h)
    let min = Infinity, max = -Infinity
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let ix: number, iy: number, iz: number
        if (axis === 0) { ix = sliceIndex; iy = i; iz = j }
        else if (axis === 1) { ix = i; iy = sliceIndex; iz = j }
        else { ix = i; iy = j; iz = sliceIndex }
        const val = data[ix + dims[0] * (iy + dims[1] * iz)]
        if (val < min) min = val
        if (val > max) max = val
      }
    }
    const range = max - min || 1
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let ix: number, iy: number, iz: number
        if (axis === 0) { ix = sliceIndex; iy = i; iz = j }
        else if (axis === 1) { ix = i; iy = sliceIndex; iz = j }
        else { ix = i; iy = j; iz = sliceIndex }
        const val = data[ix + dims[0] * (iy + dims[1] * iz)]
        const nt = (val - min) / range
        const [r, g, b] = viridis(nt)
        const idx = (j * w + i) * 4
        imageData.data[idx] = r
        imageData.data[idx + 1] = g
        imageData.data[idx + 2] = b
        imageData.data[idx + 3] = 255
      }
    }
    ctx.putImageData(imageData, 0, 0)

    const tex = new CanvasTexture(canvas)
    tex.flipY = false  // Canvas row j maps directly to UV v = j/h; default true would flip the density
    tex.minFilter = NearestFilter
    tex.magFilter = NearestFilter
    tex.wrapS = RepeatWrapping
    tex.wrapT = RepeatWrapping
    tex.needsUpdate = true

    return { vertices: verts, uvs: uv, texture: tex }
  }, [lattice, axis, sliceIndex, dims, data, padding])

  const fadeCompile = useMemo(() => {
    if (padding <= 0) return undefined
    return tileFadeCompile(lattice, padding, fade)
  }, [lattice, padding, fade])

  return (
    <mesh>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[vertices, 3]}
        />
        <bufferAttribute
          attach="attributes-uv"
          args={[uvs, 2]}
        />
      </bufferGeometry>
      <meshBasicMaterial
        key={`slice-${padding}-${fade}`}
        map={texture}
        transparent
        opacity={0.85}
        side={DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
        onBeforeCompile={fadeCompile}
      />
    </mesh>
  )
}
