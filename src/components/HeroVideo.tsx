import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

/**
 * Hero background video — the league's own footage, self-hosted from
 * public/hero/ (muted, looping, cover-cropped).
 *
 * Reports `active` only once genuinely playing, so the hero keeps the
 * tire-smoke fallback (behind the curtain in HeroCarousel) if autoplay is
 * blocked, the file is missing, or the codec can't decode. A sustained
 * rebuffer drops back to the smoke rather than freezing on a stale frame.
 *
 * Data respect: the clip is ~42MB, so phones and Save-Data / 2G connections
 * never load it — they get the animated smoke hero instead. It also pauses
 * while scrolled out of view.
 *
 * prefers-reduced-motion: renders nothing — the smoke hero paints a settled
 * haze instead.
 */
const SRC = '/hero/hero-1.mp4'
const REBUFFER_GRACE_MS = 3000

function connectionAllowsVideo(): boolean {
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (conn?.saveData) return false
  if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) return false
  return true
}

export default function HeroVideo({ onActive }: { onActive: (active: boolean) => void }) {
  const reduce = useReducedMotion() ?? false
  const ref = useRef<HTMLVideoElement | null>(null)
  // Decided once at mount: small screens and constrained connections skip the
  // download entirely (the smoke hero is the mobile experience).
  const [enabled] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 640 && connectionAllowsVideo(),
  )

  useEffect(() => {
    if (reduce || !enabled) {
      onActive(false)
      return
    }
    const v = ref.current
    if (!v) return

    let rebufferTimer: ReturnType<typeof setTimeout> | undefined

    const tryPlay = () => v.play().catch(() => onActive(false))
    const onPlaying = () => {
      clearTimeout(rebufferTimer)
      onActive(true)
    }
    const onWaiting = () => {
      // Brief hiccups keep the video up; a sustained stall restores the
      // curtain + smoke instead of showing a frozen frame.
      clearTimeout(rebufferTimer)
      rebufferTimer = setTimeout(() => onActive(false), REBUFFER_GRACE_MS)
    }
    const onError = () => onActive(false)

    v.addEventListener('playing', onPlaying)
    v.addEventListener('waiting', onWaiting)
    v.addEventListener('stalled', onWaiting)
    v.addEventListener('error', onError)
    if (v.readyState >= 2) tryPlay()
    else v.addEventListener('canplay', tryPlay, { once: true })

    // Pause decode work while the hero is scrolled out of view.
    let io: IntersectionObserver | undefined
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) tryPlay()
          else v.pause()
        },
        { rootMargin: '80px' },
      )
      io.observe(v)
    }

    return () => {
      clearTimeout(rebufferTimer)
      io?.disconnect()
      v.removeEventListener('playing', onPlaying)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('stalled', onWaiting)
      v.removeEventListener('error', onError)
      v.removeEventListener('canplay', tryPlay)
    }
  }, [reduce, enabled, onActive])

  if (reduce || !enabled) return null

  return (
    <video
      ref={ref}
      className="absolute inset-0 h-full w-full object-cover"
      src={SRC}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
    />
  )
}
