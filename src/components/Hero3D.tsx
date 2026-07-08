import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useReducedMotion } from 'framer-motion'
import type { Group } from 'three'

/** A slow, ambient looping form — evokes a circuit ribbon. Deliberately quiet. */
function Ribbon({ still }: { still: boolean }) {
  const group = useRef<Group>(null)

  useFrame((state, delta) => {
    if (!group.current) return
    if (!still) {
      group.current.rotation.y += delta * 0.18
      group.current.rotation.x += delta * 0.06
    }
    const t = state.clock.elapsedTime
    group.current.position.y = Math.sin(t * 0.5) * 0.12
  })

  return (
    <group ref={group} rotation={[0.5, 0.2, 0]}>
      <mesh>
        <torusKnotGeometry args={[1.05, 0.26, 180, 22, 2, 3]} />
        <meshStandardMaterial color="#cbd2dd" roughness={0.32} metalness={0.35} />
      </mesh>
    </group>
  )
}

export default function Hero3D() {
  const reduce = useReducedMotion() ?? false
  return (
    <Canvas
      dpr={[1, 1.6]}
      camera={{ position: [0, 0, 8.5], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
      style={{ background: 'transparent' }}
      frameloop={reduce ? 'demand' : 'always'}
    >
      <ambientLight intensity={0.85} />
      <directionalLight position={[4, 5, 5]} intensity={1.15} color="#ffffff" />
      <directionalLight position={[-5, -2, -1]} intensity={0.6} color="#f2e114" />
      <directionalLight position={[-3, 4, 2]} intensity={0.5} color="#2f6bff" />
      <Ribbon still={reduce} />
    </Canvas>
  )
}
