import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { DoubleSide, MeshStandardMaterial, Mesh } from 'three'

interface GlbPreviewRendererProps {
  /** URL of the .glb mesh file (pre-computed isosurface at a specific iso level). */
  url: string
  opacity?: number
  color?: [number, number, number]
}

function rgbToHex(c: [number, number, number]): string {
  const to = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, '0')
  return `#${to(c[0])}${to(c[1])}${to(c[2])}`
}

/**
 * Renders a pre-computed isosurface mesh loaded from a .glb file. Intended as
 * an instant-render preview layer on top of (or in place of) the live CPU /
 * GPU isosurface pipelines. The file is typically ~100 KB-5 MB depending on
 * iso-level quantile.
 *
 * Usage:
 *   <GlbPreviewRenderer url="/glb/mp-1000020/0.95.glb" />
 */
export function GlbPreviewRenderer({ url, opacity = 0.6, color }: GlbPreviewRendererProps) {
  const { scene } = useGLTF(url)

  // Walk the loaded scene and apply our shared styling (translucent blue,
  // double-sided) to every mesh. GLB meshes arrive with their own materials,
  // which we replace so iso-surface tuning stays consistent.
  const styled = useMemo(() => {
    const cloned = scene.clone(true)
    cloned.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.material = new MeshStandardMaterial({
          color: color ? rgbToHex(color) : '#44aaff',
          transparent: true,
          opacity,
          side: DoubleSide,
          depthWrite: false,
        })
      }
    })
    return cloned
  }, [scene, opacity, color])

  return <primitive object={styled} />
}
