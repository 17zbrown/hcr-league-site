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
 * Data respect: the desktop clip is ~42MB, which is far too much to push at a phone
 * on cellular. Phones used to be excluded outright for that reason and got the smoke
 * hero instead — correct about the data, wrong about the outcome, because it left the
 * site looking like two different products depending on the device.
 *
 * So there are two encodes. Phones get a 15-second 640-wide loop (~4.6MB, about two
 * photos' worth) and desktops get the full 70-second 960-wide clip. Looping hides the
 * shorter duration: it is a background, and nobody watches a hero to the end.
 *
 * Save-Data and 2G still get nothing at all — someone who has explicitly asked their
 * browser to conserve data means it, and 4.6MB is not an exception to that. They are
 * `unavailable` from the first frame, with no dark gap. Playback also pauses while
 * scrolled out of view.
 *
 * prefers-reduced-motion: renders nothing, reports unavailable — the smoke hero
 * paints a settled haze instead.
 */
export type VideoStatus = 'loading' | 'playing' | 'unavailable'

const SRC = '/hero/hero-1.mp4'
const MOBILE_SRC = '/hero/hero-1-mobile.mp4'
/** Below this CSS width the phone encode is served. Matches Tailwind's `sm`. */
const SMALL_MAX = 640
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
  // Which encode to fetch, decided once at mount. null means no video at all.
  //
  // A reported width of 0 is not a small screen, it is no measurement at all —
  // which is what a page mounted while hidden or prerendered reports. Since this is
  // evaluated once and never revisited, treating that as "phone" would pin the whole
  // session to the low-detail encode the moment the page became visible. Only an
  // actual, positive, small width selects the mobile file.
  const [src] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    if (!connectionAllowsVideo()) return null
    const w = window.innerWidth
    return w > 0 && w < SMALL_MAX ? MOBILE_SRC : SRC
  })
  const enabled = src !== null

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

  if (reduce || !src) return null

  return (
    <video
      ref={ref}
      className="absolute inset-0 h-full w-full object-cover"
      src={src}
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
