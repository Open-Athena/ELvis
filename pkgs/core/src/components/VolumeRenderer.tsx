import { useMemo, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import {
  Data3DTexture, RedFormat, FloatType, LinearFilter, ClampToEdgeWrapping,
  ShaderMaterial, Matrix4, Vector2, Vector3, DoubleSide, BufferGeometry,
  Float32BufferAttribute,
} from 'three'
import type { VolumeData } from '../types.ts'
import { fracToCart } from '../utils/lattice.ts'
import type { TileInfo } from '../utils/tiling.ts'

interface VolumeRendererProps {
  volume: VolumeData
  isoLevel: number
  opacity: number
  tiles?: TileInfo[]
  tilePadding?: number
  tileFade?: number
}

/** Build a BufferGeometry for the unit cell parallelepiped (6 faces, 12 triangles). */
function buildCellGeometry(lattice: VolumeData['lattice'], padding: number): BufferGeometry {
  const lo = -padding
  const hi = 1 + padding
  // 8 corners in fractional coords
  const fracCorners: [number, number, number][] = []
  for (const z of [lo, hi]) {
    for (const y of [lo, hi]) {
      for (const x of [lo, hi]) {
        fracCorners.push([x, y, z])
      }
    }
  }
  const cart = fracCorners.map(f => fracToCart(lattice, f))

  // 6 faces, 2 triangles each. Indices into the 8 corners:
  // Corners: 0=000 1=100 2=010 3=110 4=001 5=101 6=011 7=111
  const faces = [
    [0, 2, 3, 0, 3, 1], // z=lo face
    [4, 5, 7, 4, 7, 6], // z=hi face
    [0, 1, 5, 0, 5, 4], // y=lo face
    [2, 6, 7, 2, 7, 3], // y=hi face
    [0, 4, 6, 0, 6, 2], // x=lo face
    [1, 3, 7, 1, 7, 5], // x=hi face
  ]

  const positions: number[] = []
  for (const face of faces) {
    for (const idx of face) {
      positions.push(...cart[idx])
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

// ────────────────── Shader code ──────────────────

const vertexShader = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

uniform sampler3D uVolume;
uniform float uIsoLevel;
uniform float uOpacity;
uniform float uDensityMin;
uniform float uDensityRange;
uniform mat4 uCartToFrac;     // inverse lattice: world → fractional
uniform vec3 uCameraPos;
uniform vec2 uResolution;
uniform float uPadding;
uniform float uFade;

varying vec3 vWorldPos;

// Ray-box intersection in fractional space [lo, hi]³
vec2 boxIntersect(vec3 ro, vec3 rd, float lo, float hi) {
  vec3 invRd = 1.0 / rd;
  vec3 t0 = (lo - ro) * invRd;
  vec3 t1 = (hi - ro) * invRd;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tNear = max(tmin.x, max(tmin.y, tmin.z));
  float tFar = min(tmax.x, min(tmax.y, tmax.z));
  return vec2(tNear, tFar);
}

// Compute outward-facing normal via central differences. Density decreases
// away from high-density regions (atoms), so the gradient points inward;
// we negate to get the outward isosurface normal.
vec3 computeNormal(vec3 p, float texelSize) {
  vec2 e = vec2(texelSize, 0.0);
  float dx = texture(uVolume, fract(p + e.xyy)).r - texture(uVolume, fract(p - e.xyy)).r;
  float dy = texture(uVolume, fract(p + e.yxy)).r - texture(uVolume, fract(p - e.yxy)).r;
  float dz = texture(uVolume, fract(p + e.yyx)).r - texture(uVolume, fract(p - e.yyx)).r;
  return normalize(-vec3(dx, dy, dz));
}

// Chebyshev distance from primary cell [0,1]³
float chebyshevDist(vec3 p) {
  return max(max(max(0.0, -p.x), max(p.x - 1.0, 0.0)),
         max(max(max(0.0, -p.y), max(p.y - 1.0, 0.0)),
             max(max(0.0, -p.z), max(p.z - 1.0, 0.0))));
}

void main() {
  // Ray in world space
  vec3 rayDir = normalize(vWorldPos - uCameraPos);

  // Transform to fractional space
  vec3 fracOrigin = (uCartToFrac * vec4(uCameraPos, 1.0)).xyz;
  vec3 fracDir = normalize((uCartToFrac * vec4(rayDir, 0.0)).xyz);

  float lo = -uPadding;
  float hi = 1.0 + uPadding;
  vec2 tHit = boxIntersect(fracOrigin, fracDir, lo, hi);

  if (tHit.x > tHit.y) discard;
  tHit.x = max(tHit.x, 0.0); // clip to camera

  // Normalize iso level to [0,1] range matching the texture
  float isoNorm = (uIsoLevel - uDensityMin) / uDensityRange;

  // Step size: ~1 texel in fractional space
  float steps = 400.0;
  float dt = (tHit.y - tHit.x) / steps;
  float t = tHit.x;

  float prevVal = 0.0;
  bool hit = false;
  vec3 hitPos = vec3(0.0);

  for (int i = 0; i < 512; i++) {
    if (t > tHit.y) break;
    vec3 p = fracOrigin + fracDir * t;
    // Periodic wrapping for texture lookup
    vec3 texCoord = fract(p);
    float val = texture(uVolume, texCoord).r;

    if (i > 0 && val >= isoNorm && prevVal < isoNorm) {
      // Bisect for precise hit
      float tA = t - dt;
      float tB = t;
      for (int j = 0; j < 6; j++) {
        float tM = (tA + tB) * 0.5;
        vec3 pM = fracOrigin + fracDir * tM;
        float vM = texture(uVolume, fract(pM)).r;
        if (vM >= isoNorm) tB = tM;
        else tA = tM;
      }
      hitPos = fracOrigin + fracDir * (tA + tB) * 0.5;
      hit = true;
      break;
    }
    prevVal = val;
    t += dt;
  }

  if (!hit) discard;

  // Normal in fractional space, transform to world
  vec3 fracNormal = computeNormal(hitPos, 0.01);
  // Transform normal: inverse-transpose of cartToFrac = transpose of fracToCart = lattice matrix
  // But simpler: just use the fracNormal direction in world space via the inverse transform
  vec3 worldNormal = normalize((inverse(uCartToFrac) * vec4(fracNormal, 0.0)).xyz);

  // Lighting (Blinn-Phong)
  vec3 lightDir = normalize(vec3(0.5, 1.0, 0.8));
  float diffuse = max(dot(worldNormal, lightDir), 0.0);
  float ambient = 0.3;
  vec3 viewDir = -rayDir;
  vec3 halfDir = normalize(lightDir + viewDir);
  float specular = pow(max(dot(worldNormal, halfDir), 0.0), 40.0);

  vec3 color = vec3(0.27, 0.67, 1.0); // #44aaff-ish
  vec3 lit = color * (ambient + 0.6 * diffuse) + vec3(0.3) * specular;

  // Fade for tiling
  float alpha = uOpacity;
  if (uPadding > 0.0) {
    float d = chebyshevDist(hitPos);
    if (d > 0.0 && uFade > 0.0) {
      alpha *= pow(1.0 - clamp(d / uPadding, 0.0, 1.0), uFade);
    }
  }

  gl_FragColor = vec4(lit, alpha);
}
`

export function VolumeRenderer({
  volume, isoLevel, opacity, tiles: _tiles, tilePadding = 0, tileFade = 1,
}: VolumeRendererProps) {
  const { camera, size } = useThree()
  const matRef = useRef<ShaderMaterial>(null)
  const { dims, data } = volume.grid

  // Create 3D texture from density data
  const { texture, densityMin, densityRange } = useMemo(() => {
    let dMin = Infinity, dMax = -Infinity
    for (let i = 0; i < data.length; i++) {
      if (data[i] < dMin) dMin = data[i]
      if (data[i] > dMax) dMax = data[i]
    }
    const range = dMax - dMin || 1
    // Normalize to [0,1] for texture
    const norm = new Float32Array(data.length)
    for (let i = 0; i < data.length; i++) {
      norm[i] = (data[i] - dMin) / range
    }

    const tex = new Data3DTexture(norm, dims[0], dims[1], dims[2])
    tex.format = RedFormat
    tex.type = FloatType
    tex.minFilter = LinearFilter
    tex.magFilter = LinearFilter
    tex.wrapS = ClampToEdgeWrapping
    tex.wrapT = ClampToEdgeWrapping
    tex.wrapR = ClampToEdgeWrapping
    tex.needsUpdate = true
    return { texture: tex, densityMin: dMin, densityRange: range }
  }, [data, dims])

  // Inverse lattice matrix (Cartesian → fractional)
  const cartToFrac = useMemo(() => {
    const L = volume.lattice
    const m = new Matrix4()
    m.set(
      L[0], L[3], L[6], 0,
      L[1], L[4], L[7], 0,
      L[2], L[5], L[8], 0,
      0,    0,    0,    1,
    )
    return m.invert()
  }, [volume.lattice])

  // Bounding box geometry
  const geometry = useMemo(
    () => buildCellGeometry(volume.lattice, tilePadding),
    [volume.lattice, tilePadding],
  )

  // Create uniforms ONCE. We mutate `.value` in useFrame so the material
  // doesn't get a new object each render (which would break the binding).
  const uniforms = useMemo(() => ({
    uVolume: { value: texture },
    uIsoLevel: { value: isoLevel },
    uOpacity: { value: opacity },
    uDensityMin: { value: densityMin },
    uDensityRange: { value: densityRange },
    uCartToFrac: { value: cartToFrac.clone() },
    uCameraPos: { value: new Vector3() },
    uResolution: { value: new Vector2(size.width, size.height) },
    uPadding: { value: tilePadding },
    uFade: { value: tileFade },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [texture])  // only rebuild when texture (volume) changes

  useFrame(() => {
    const mat = matRef.current
    if (!mat) return
    mat.uniforms.uIsoLevel.value = isoLevel
    mat.uniforms.uOpacity.value = opacity
    mat.uniforms.uPadding.value = tilePadding
    mat.uniforms.uFade.value = tileFade
    mat.uniforms.uDensityMin.value = densityMin
    mat.uniforms.uDensityRange.value = densityRange
    mat.uniforms.uCameraPos.value.copy(camera.position)
    mat.uniforms.uResolution.value.set(size.width, size.height)
    mat.uniforms.uCartToFrac.value.copy(cartToFrac)
    mat.uniforms.uVolume.value = texture
  })

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  )
}
