import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

/**
 * Hero background video — the league's own footage, self-hosted from
 * public/hero/ (muted, looping, cover-cropped).
 *
 * Reports THREE states, not two, and the distinction is the whole point:
 *
 *   loading      — nothing is known yet. The hero shows its plain dark curtain.
 *   playing      — genuinely running; the curtain fades off it.
 *   unavailable  — this video is not going to play here. Only now does the
 *                  tire-smoke hero appear.
 *
 * It used to report a single boolean, which conflated "still loading" with
 * "never going to play". Both read as false, so every visit began with roughly a
 * second of smoke animation that was then yanked away the instant the video
 * started — the fallback flashing up as a loading state it was never meant to be.
 *
 * Data respect: the clip is ~42MB, so phones and Save-Data / 2G connections never
 * load it — they are `unavailable` from the first frame and get the smoke hero
 * immediately, with no dark gap. It also pauses while scrolled out of view.
 *
 * prefers-reduced-motion: renders nothing, reports unavailable — the smoke hero
 * paints a settled haze instead.
 */
export type VideoStatus = 'loading' | 'playing' | 'unavailable'

const SRC = '/hero/hero-1.mp4'
const REBUFFER_GRACE_MS = 3000
// If it has not started by now it is not arriving in a useful timeframe, and a
// dead black hero is worse than the smoke. Deliberately long: a normal connection
// starts in well under a second, so this should almost never fire.
const LOAD_GRACE_MS = 8000

function connectionAllowsVideo(): boolean {
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (conn?.saveData) return false
  if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) return false
  return true
}

export default function HeroVideo({ onStatus }: { onStatus: (status: VideoStatus) => void }) {
  const reduce = useReducedMotion() ?? false
  const ref = useRef<HTMLVideoElement | null>(null)
  // Decided once at mount: small screens and constrained connections skip the
  // download entirely (the smoke hero is the mobile experience).
  //
  // A reported width of 0 is not a small screen, it is no measurement at all —
  // which is what a page mounted while hidden or prerendered reports. Since this
  // is evaluated once and never revisited, treating that as "phone" would silently
  // cost the video for the whole session once the page became visible. Only an
  // actual, positive, small width counts against it.
  const [enabled] = useState(() => {
    if (typeof window === 'undefined') return false
    const w = window.innerWidth
    const bigEnough = w === 0 || w >= 640
    return bigEnough && connectionAllowsVideo()
  })

  useEffect(() => {
    // Known up front that no video is coming, so say so immediately rather than
    // making a phone sit through a dark hero waiting for a file it will never
    // request.
    if (reduce || !enabled) {
      onStatus('unavailable')
      return
    }
    const v = ref.current
    if (!v) return

    let rebufferTimer: ReturnType<typeof setTimeout> | undefined

    // Nothing is known yet. The curtain covers this, and no fallback shows.
    onStatus('loading')
    const loadTimer = setTimeout(() => onStatus('unavailable'), LOAD_GRACE_MS)

    const tryPlay = () => v.play().catch(() => onStatus('unavailable'))
    const onPlaying = () => {
      clearTimeout(rebufferTimer)
      clearTimeout(loadTimer)
      onStatus('playing')
    }
    const onWaiting = () => {
      // Brief hiccups keep the video up; a sustained stall restores the
      // curtain + smoke instead of showing a frozen frame.
      clearTimeout(rebufferTimer)
      rebufferTimer = setTimeout(() => onStatus('unavailable'), REBUFFER_GRACE_MS)
    }
    const onError = () => { clearTimeout(loadTimer); onStatus('unavailable') }

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
      clearTimeout(loadTimer)
      io?.disconnect()
      v.removeEventListener('playing', onPlaying)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('stalled', onWaiting)
      v.removeEventListener('error', onError)
      v.removeEventListener('canplay', tryPlay)
    }
  }, [reduce, enabled, onStatus])

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
