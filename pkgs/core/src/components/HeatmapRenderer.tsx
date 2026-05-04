import { useMemo, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import {
  Data3DTexture, RedFormat, FloatType, LinearFilter, ClampToEdgeWrapping,
  ShaderMaterial, Matrix4, Vector3, Vector4, DoubleSide, BufferGeometry,
  Float32BufferAttribute,
} from 'three'
import type { VolumeData } from '../types.ts'
import { fracToCart } from '../utils/lattice.ts'
import { getElement } from '../utils/elements.ts'
import type { TileInfo } from '../utils/tiling.ts'

interface HeatmapRendererProps {
  volume: VolumeData
  /** Overall opacity multiplier (≈ how dense the cloud looks). */
  opacity: number
  /** Gamma applied to density before alpha mapping; >1 emphasizes high-density regions. */
  gamma?: number
  /** Density values below this fraction (0–1, normalized) contribute zero alpha. */
  lowCutoff?: number
  /** Number of ray-march samples per pixel. Higher = smoother but slower. */
  stepCount?: number
  tiles?: TileInfo[]
  tilePadding?: number
  tileFade?: number
}

// Atom radius rendered in CrystalStructure is `radius * RADIUS_SCALE`.
// Match that here so the heatmap ray-clip aligns with the visible atom sphere.
const RADIUS_SCALE = 0.4
const MAX_ATOMS = 128

function buildCellGeometry(lattice: VolumeData['lattice'], padding: number): BufferGeometry {
  const lo = -padding
  const hi = 1 + padding
  const fracCorners: [number, number, number][] = []
  for (const z of [lo, hi]) {
    for (const y of [lo, hi]) {
      for (const x of [lo, hi]) {
        fracCorners.push([x, y, z])
      }
    }
  }
  const cart = fracCorners.map(f => fracToCart(lattice, f))
  const faces = [
    [0, 2, 3, 0, 3, 1],
    [4, 5, 7, 4, 7, 6],
    [0, 1, 5, 0, 5, 4],
    [2, 6, 7, 2, 7, 3],
    [0, 4, 6, 0, 6, 2],
    [1, 3, 7, 1, 7, 5],
  ]
  const positions: number[] = []
  for (const face of faces) {
    for (const idx of face) positions.push(...cart[idx])
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

const vertexShader = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

// Turbo colormap polynomial approximation (Mikhail Bessmeltsev).
// Maps x ∈ [0,1] → RGB; full hue sweep, perceptually monotonic in luminance.
const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

#define MAX_ATOMS 128

uniform sampler3D uVolume;
uniform mat4 uCartToFrac;
uniform mat4 uFracToCart;
uniform vec3 uCameraPos;
uniform float uPadding;
uniform float uFade;
uniform float uOpacity;
uniform float uGamma;
uniform float uStepCount;
uniform float uLowCutoff;
uniform int uAtomCount;
// xyz = fractional position, w = cart-space radius
uniform vec4 uAtoms[MAX_ATOMS];

varying vec3 vWorldPos;

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

float chebyshevDist(vec3 p) {
  return max(max(max(0.0, -p.x), max(p.x - 1.0, 0.0)),
         max(max(max(0.0, -p.y), max(p.y - 1.0, 0.0)),
             max(max(0.0, -p.z), max(p.z - 1.0, 0.0))));
}

vec3 turbo(float x) {
  const vec4 kRedVec4 = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  const vec4 kGreenVec4 = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  const vec4 kBlueVec4 = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  const vec2 kRedVec2 = vec2(-152.94239396, 59.28637943);
  const vec2 kGreenVec2 = vec2(4.27729857, 2.82956604);
  const vec2 kBlueVec2 = vec2(-89.90310912, 27.34824973);
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x*x, x*x*x);
  vec2 v2 = v4.zw * v4.z;
  return clamp(vec3(
    dot(v4, kRedVec4)   + dot(v2, kRedVec2),
    dot(v4, kGreenVec4) + dot(v2, kGreenVec2),
    dot(v4, kBlueVec4)  + dot(v2, kBlueVec2)
  ), 0.0, 1.0);
}

// True distance (cart units) between fracP and an atom, accounting for periodic
// tile copies — the ray may sample any tile copy of the cell, and atom-equivalent
// positions repeat with period 1 in fractional coords.
float atomCartDist(vec3 fracP, vec3 fracAtom) {
  vec3 fracDelta = fract(fracP - fracAtom + 0.5) - 0.5;
  vec3 cartDelta = (uFracToCart * vec4(fracDelta, 0.0)).xyz;
  return length(cartDelta);
}

void main() {
  vec3 rayDir = normalize(vWorldPos - uCameraPos);
  vec3 fracOrigin = (uCartToFrac * vec4(uCameraPos, 1.0)).xyz;
  vec3 fracDir = normalize((uCartToFrac * vec4(rayDir, 0.0)).xyz);

  float lo = -uPadding;
  float hi = 1.0 + uPadding;
  vec2 tHit = boxIntersect(fracOrigin, fracDir, lo, hi);
  if (tHit.x > tHit.y) discard;
  tHit.x = max(tHit.x, 0.0);

  float steps = uStepCount;
  float dt = (tHit.y - tHit.x) / steps;
  float dtRef = 1.0 / 256.0;
  float t = tHit.x;

  vec4 acc = vec4(0.0);

  for (int i = 0; i < 512; i++) {
    if (t > tHit.y) break;
    if (acc.a > 0.99) break;

    vec3 fracP = fracOrigin + fracDir * t;

    // Atom-sphere clip: stop the ray when it enters any atom sphere. Atoms are
    // opaque and rendered separately; without this the heatmap accumulates glow
    // *past* the camera-facing surface of an atom, which then bleeds in front
    // of the atom because the heatmap fragment lives on the bounding-box face.
    bool inAtom = false;
    for (int a = 0; a < MAX_ATOMS; a++) {
      if (a >= uAtomCount) break;
      vec4 atom = uAtoms[a];
      if (atomCartDist(fracP, atom.xyz) < atom.w) {
        inAtom = true;
        break;
      }
    }
    if (inAtom) break;

    vec3 texCoord = fract(fracP);
    float val = clamp(texture(uVolume, texCoord).r, 0.0, 1.0);

    if (val > uLowCutoff) {
      vec3 col = turbo(val);
      // Renormalize after subtracting low cutoff so val=1 still maps to alpha=1.
      float v = clamp((val - uLowCutoff) / max(1.0 - uLowCutoff, 1e-4), 0.0, 1.0);
      float baseA = pow(v, uGamma) * uOpacity;
      float a = 1.0 - pow(max(1.0 - baseA, 0.0), dt / dtRef);

      if (uPadding > 0.0 && uFade > 0.0) {
        float d = chebyshevDist(fracP);
        if (d > 0.0) a *= pow(1.0 - clamp(d / uPadding, 0.0, 1.0), uFade);
      }

      acc.rgb += (1.0 - acc.a) * col * a;
      acc.a   += (1.0 - acc.a) * a;
    }

    t += dt;
  }

  if (acc.a < 0.001) discard;
  gl_FragColor = acc;
}
`

export function HeatmapRenderer({
  volume, opacity, gamma = 2.5, lowCutoff = 0, stepCount = 256,
  tiles: _tiles, tilePadding = 0, tileFade = 1,
}: HeatmapRendererProps) {
  const { camera } = useThree()
  const matRef = useRef<ShaderMaterial>(null)
  const { dims, data } = volume.grid

  const texture = useMemo(() => {
    let dMin = Infinity, dMax = -Infinity
    for (let i = 0; i < data.length; i++) {
      if (data[i] < dMin) dMin = data[i]
      if (data[i] > dMax) dMax = data[i]
    }
    const range = dMax - dMin || 1
    const norm = new Float32Array(data.length)
    for (let i = 0; i < data.length; i++) norm[i] = (data[i] - dMin) / range

    const tex = new Data3DTexture(norm, dims[0], dims[1], dims[2])
    tex.format = RedFormat
    tex.type = FloatType
    tex.minFilter = LinearFilter
    tex.magFilter = LinearFilter
    tex.wrapS = ClampToEdgeWrapping
    tex.wrapT = ClampToEdgeWrapping
    tex.wrapR = ClampToEdgeWrapping
    tex.needsUpdate = true
    return tex
  }, [data, dims])

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

  const fracToCartM = useMemo(() => cartToFrac.clone().invert(), [cartToFrac])

  const geometry = useMemo(
    () => buildCellGeometry(volume.lattice, tilePadding),
    [volume.lattice, tilePadding],
  )

  // Pack atoms into a fixed-size vec4[MAX_ATOMS] uniform: (fracX, fracY, fracZ, radius_cart).
  // Excess atoms beyond MAX_ATOMS are silently dropped — most unit cells have far fewer.
  const { atomsArray, atomCount } = useMemo(() => {
    const arr: Vector4[] = []
    for (let i = 0; i < MAX_ATOMS; i++) arr.push(new Vector4(0, 0, 0, 0))
    const atoms = volume.structure.atoms
    const n = Math.min(atoms.length, MAX_ATOMS)
    for (let i = 0; i < n; i++) {
      const a = atoms[i]
      const r = getElement(a.element).radius * RADIUS_SCALE
      arr[i].set(a.fracCoords[0], a.fracCoords[1], a.fracCoords[2], r)
    }
    return { atomsArray: arr, atomCount: n }
  }, [volume.structure])

  const uniforms = useMemo(() => ({
    uVolume: { value: texture },
    uCartToFrac: { value: cartToFrac.clone() },
    uFracToCart: { value: fracToCartM.clone() },
    uCameraPos: { value: new Vector3() },
    uPadding: { value: tilePadding },
    uFade: { value: tileFade },
    uOpacity: { value: opacity },
    uGamma: { value: gamma },
    uStepCount: { value: stepCount },
    uLowCutoff: { value: lowCutoff },
    uAtomCount: { value: atomCount },
    uAtoms: { value: atomsArray },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [texture])

  useFrame(() => {
    const mat = matRef.current
    if (!mat) return
    mat.uniforms.uCameraPos.value.copy(camera.position)
    mat.uniforms.uPadding.value = tilePadding
    mat.uniforms.uFade.value = tileFade
    mat.uniforms.uOpacity.value = opacity
    mat.uniforms.uGamma.value = gamma
    mat.uniforms.uStepCount.value = stepCount
    mat.uniforms.uLowCutoff.value = lowCutoff
    mat.uniforms.uCartToFrac.value.copy(cartToFrac)
    mat.uniforms.uFracToCart.value.copy(fracToCartM)
    mat.uniforms.uVolume.value = texture
    mat.uniforms.uAtomCount.value = atomCount
    mat.uniforms.uAtoms.value = atomsArray
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
