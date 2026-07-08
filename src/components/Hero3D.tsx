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

function LogoMark({ still }: { still: boolean }) {
  const data = useLoader(SVGLoader, logoUrl)
  const spin = useRef<THREE.Group>(null)

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

  useFrame((state) => {
    if (!spin.current) return
    const t = state.clock.elapsedTime
    if (!still) {
      spin.current.rotation.y = Math.sin(t * 0.35) * 0.5
      spin.current.rotation.x = Math.sin(t * 0.28) * 0.1
    }
    spin.current.position.y = Math.sin(t * 0.5) * 0.12
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
              <meshStandardMaterial color={p.color} metalness={0.3} roughness={0.44} />
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
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 5, 6]} intensity={0.9} color="#ffffff" />
      <directionalLight position={[-6, -1, 2]} intensity={0.5} color="#f2e114" />
      <directionalLight position={[-2, 5, 3]} intensity={0.4} color="#2f6bff" />
      <LogoMark still={reduce} />
    </Canvas>
  )
}
