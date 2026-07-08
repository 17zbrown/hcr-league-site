import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

/**
 * Hero background video. Drop your own race clips into `public/hero/`
 * (e.g. hero-1.mp4) and list the filenames below — multiple clips cycle.
 * If none load (or reduced-motion is on) it silently falls back to the
 * static hero (gradient + 3D logo).
 */
const CLIPS: string[] = ['/hero/hero-1.mp4', '/hero/hero-2.mp4', '/hero/hero-3.mp4']

export default function HeroVideo({ onActive }: { onActive: (active: boolean) => void }) {
  const reduce = useReducedMotion() ?? false
  const [idx, setIdx] = useState(0)
  const [ready, setReady] = useState(false)
  const failed = useRef(0)

  useEffect(() => {
    if (reduce || CLIPS.length === 0) onActive(false)
  }, [reduce, onActive])

  if (reduce || CLIPS.length === 0) return null

  const next = () => {
    setReady(false)
    setIdx((i) => (i + 1) % CLIPS.length)
  }

  return (
    <video
      key={CLIPS[idx]}
      className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
      style={{ opacity: ready ? 1 : 0 }}
      src={CLIPS[idx]}
      autoPlay
      muted
      playsInline
      loop={CLIPS.length === 1}
      preload="auto"
      aria-hidden="true"
      onLoadedData={() => {
        failed.current = 0
        setReady(true)
        onActive(true)
      }}
      onEnded={CLIPS.length > 1 ? next : undefined}
      onError={() => {
        failed.current += 1
        if (failed.current >= CLIPS.length) {
          onActive(false)
          return
        }
        next()
      }}
    />
  )
}
