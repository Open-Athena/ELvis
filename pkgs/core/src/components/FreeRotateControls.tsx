import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'

/**
 * Quaternion-based rigid-body trackball. The camera rotates around the target
 * by composing pitch (around the camera's local right axis) and yaw (around
 * the camera's local up axis), so dragging is always relative to the *current*
 * view — no spherical-coord pole, no flips, infinite drag in any direction.
 *
 * Handles:
 * - left-drag (no modifier): rotate
 * - shift+drag: pan (move camera + target along screen plane)
 * - wheel: dolly zoom toward/away from target
 *
 * Roll (Ctrl-drag), modifier-wheel pan, and keyboard nav stay in
 * `CameraController`. Exposes the same `{ target, update }` interface as drei's
 * `<OrbitControls>` (via `state.set({ controls })`) so the snap logic in
 * `CameraController` keeps working.
 */
interface FreeRotateControlsProps {
  target: [number, number, number]
  rotSpeed?: number
}

const _right = new Vector3()
const _up = new Vector3()
const _offset = new Vector3()
const _yawQ = new Quaternion()
const _pitchQ = new Quaternion()
const _dragQ = new Quaternion()
const _targetVec = new Vector3()
const _panVec = new Vector3()

type DragMode = 'rotate' | 'pan'

export function FreeRotateControls({ target, rotSpeed = 0.005 }: FreeRotateControlsProps) {
  const camera = useThree(s => s.camera)
  const gl = useThree(s => s.gl)
  const set = useThree(s => s.set)

  const targetRef = useRef(new Vector3(...target))
  targetRef.current.set(...target)
  const drag = useRef<{ x: number; y: number; pointerId: number; mode: DragMode } | null>(null)

  // Expose drei-OrbitControls-shaped object so `CameraController` (which reads
  // `useThree(s => s.controls)`) can keep doing its snap math.
  useEffect(() => {
    const controls = {
      target: targetRef.current,
      update: () => { /* no-op: state is camera+target, applied immediately */ },
    }
    set({ controls: controls as never })
    return () => { set({ controls: null as never }) }
  }, [set])

  useEffect(() => {
    const canvas = gl.domElement

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      // Ctrl/Cmd/Alt-drag stays with CameraController (roll, etc.).
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const mode: DragMode = e.shiftKey ? 'pan' : 'rotate'
      drag.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, mode }
      canvas.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      d.x = e.clientX
      d.y = e.clientY

      // Camera's current right/up in world space (apply camera quat to local axes).
      _right.set(1, 0, 0).applyQuaternion(camera.quaternion)
      _up.set(0, 1, 0).applyQuaternion(camera.quaternion)

      if (d.mode === 'pan') {
        // Convert pixel delta to world units at the focal plane (distance to target).
        const distance = camera.position.distanceTo(targetRef.current)
        const fov = (camera as PerspectiveCamera).fov * (Math.PI / 180)
        const worldPerPxY = (2 * distance * Math.tan(fov / 2)) / canvas.clientHeight
        const worldPerPxX = worldPerPxY * ((camera as PerspectiveCamera).aspect || 1)
        _panVec.copy(_right).multiplyScalar(-dx * worldPerPxX)
          .addScaledVector(_up, dy * worldPerPxY)
        camera.position.add(_panVec)
        targetRef.current.add(_panVec)
        return
      }

      // Rotate. Yaw (horizontal drag) around local up; pitch (vertical) around local right.
      _yawQ.setFromAxisAngle(_up, -dx * rotSpeed)
      _pitchQ.setFromAxisAngle(_right, -dy * rotSpeed)
      _dragQ.multiplyQuaternions(_yawQ, _pitchQ)

      _offset.copy(camera.position).sub(targetRef.current).applyQuaternion(_dragQ)
      camera.position.copy(targetRef.current).add(_offset)
      camera.quaternion.premultiply(_dragQ)
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!drag.current || e.pointerId !== drag.current.pointerId) return
      canvas.releasePointerCapture(e.pointerId)
      drag.current = null
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
    }
  }, [camera, gl, rotSpeed])

  // Wheel zoom: dolly camera toward/away from target.
  useEffect(() => {
    const canvas = gl.domElement
    const onWheel = (e: WheelEvent) => {
      // Skip modifier-wheel (owned by CameraController for pan/roll).
      if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
      e.preventDefault()
      const factor = Math.pow(0.95, -e.deltaY * 0.01)
      _offset.copy(camera.position).sub(targetRef.current).multiplyScalar(factor)
      camera.position.copy(targetRef.current).add(_offset)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [camera, gl])

  // Apply target updates each frame the parent passes in.
  useEffect(() => {
    _targetVec.set(...target)
    if (!targetRef.current.equals(_targetVec)) targetRef.current.copy(_targetVec)
  }, [target])

  return null
}
