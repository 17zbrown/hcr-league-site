import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { SVGLoader } from 'three-stdlib'
import { useReducedMotion } from 'framer-motion'
import * as THREE from 'three'
import logoUrl from '../assets/hcr-logo-3d.svg'

// SVG author-space size (from the traced file's viewBox) — used to center.
const SVG_W = 957
const SVG_H = 207
const DEPTH = 46

/** A directional light that orbits the logo, sending a sheen sweeping across the metal. */
function SweepLight({ still }: { still: boolean }) {
  const ref = useRef<THREE.DirectionalLight>(null)
  useFrame((state) => {
    if (!ref.current || still) return
    const t = state.clock.elapsedTime
    ref.current.position.set(Math.cos(t * 0.9) * 6, 3.5, Math.sin(t * 0.9) * 5 + 4)
  })
  return <directionalLight ref={ref} intensity={0.95} color="#fff2b0" />
}

function LogoMark({ still }: { still: boolean }) {
  const data = useLoader(SVGLoader, logoUrl)
  const spin = useRef<THREE.Group>(null)
  const prog = useRef(0)

  const parts = useMemo(() => {
    // Path order in the traced SVG: 0 = "HC", 1 = "R".
    return data.paths.map((path, i) => {
      const shapes = SVGLoader.createShapes(path)
      const geometry = new THREE.ExtrudeGeometry(shapes, {
        depth: DEPTH,
        bevelEnabled: true,
        bevelThickness: 7,
        bevelSize: 4,
        bevelSegments: 3,
        steps: 1,
      })
      geometry.computeVertexNormals()
      // HC → visible mid-grey on white; R → brand yellow.
      const color = i === 0 ? '#aeb6c4' : '#f2e114'
      return { geometry, color }
    })
  }, [data])

  useFrame((state, delta) => {
    const g = spin.current
    if (!g) return
    const t = state.clock.elapsedTime

    if (still) {
      g.rotation.set(0, 0, 0)
      g.scale.setScalar(1)
      return
    }

    // Entrance: pop in with a little overshoot + a spin that decays.
    prog.current = Math.min(1, prog.current + delta / 1.1)
    const p = prog.current
    const c = 2.2
    const back = 1 + c * Math.pow(p - 1, 3) + (c - 0.4) * Math.pow(p - 1, 2) // easeOutBack
    const ease = 1 - Math.pow(1 - p, 3)
    g.scale.setScalar(0.55 + 0.45 * back)
    const intro = (1 - ease) * 1.6 // extra yaw at start, damps out

    // Living motion — wider tilt to show the extruded sides, plus roll + float.
    g.rotation.y = Math.sin(t * 0.5) * 0.62 + Math.sin(t * 0.17) * 0.12 + intro
    g.rotation.x = Math.sin(t * 0.4) * 0.15
    g.rotation.z = Math.sin(t * 0.33) * 0.06
    g.position.y = Math.sin(t * 0.65) * 0.16
    g.position.x = Math.sin(t * 0.23) * 0.1
  })

  const scale = 4.6 / SVG_W

  return (
    <group ref={spin}>
      {/* flip Y (SVG is y-down) + scale down */}
      <group scale={[scale, -scale, scale]}>
        {/* center the artwork about the origin */}
        <group position={[-SVG_W / 2, -SVG_H / 2, -DEPTH / 2]}>
          {parts.map((p, i) => (
            <mesh key={i} geometry={p.geometry}>
              <meshStandardMaterial color={p.color} metalness={0.62} roughness={0.26} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  )
}

export default function Hero3D() {
  const reduce = useReducedMotion() ?? false
  return (
    <Canvas
      dpr={[1, 1.6]}
      camera={{ position: [0, 0, 5.4], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
      style={{ background: 'transparent' }}
      frameloop={reduce ? 'demand' : 'always'}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 5, 6]} intensity={0.85} color="#ffffff" />
      <directionalLight position={[-6, -1, 2]} intensity={0.45} color="#f2e114" />
      <directionalLight position={[-2, 5, 3]} intensity={0.4} color="#2f6bff" />
      <SweepLight still={reduce} />
      <LogoMark still={reduce} />
    </Canvas>
  )
}
