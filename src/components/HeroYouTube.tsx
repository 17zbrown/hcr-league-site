import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'

/**
 * Cinematic hero background from an official iRacing trailer, embedded via
 * YouTube's IFrame Player API (the sanctioned, legal way to show someone
 * else's video — it streams from YouTube, credited, and the rights-holder can
 * revoke embedding at any time).
 *
 * Muted, looping, controls-off, non-interactive, cover-cropped (with overscan
 * so YouTube's own title/watermark chrome sits off-screen). It only reports
 * `active` once the player is genuinely PLAYING, so if autoplay is blocked, the
 * API can't load, or the clip errors, the hero silently keeps the tire-smoke
 * fallback instead of showing a dead frame.
 *
 * The player mounts into an imperatively-created node (not a React-rendered
 * element): the IFrame API REPLACES its target node with an <iframe>, which
 * would corrupt React's DOM reconciliation if that node were part of the tree.
 *
 * Swap VIDEO_ID for any other official iRacing (or your own) YouTube clip.
 */
// iRacing — The Ultimate Motorsports Simulator (channel: @iRacingOfficial)
const VIDEO_ID = 'xmRC1_R3Dac'

// Single, shared loader for the IFrame API script (idempotent across mounts).
let apiPromise: Promise<void> | null = null
function loadYouTubeApi(): Promise<void> {
  const w = window as unknown as {
    YT?: { Player: unknown }
    onYouTubeIframeAPIReady?: () => void
  }
  if (w.YT?.Player) return Promise.resolve()
  if (apiPromise) return apiPromise
  apiPromise = new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const succeed = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      apiPromise = null // let a later mount retry after a transient failure
      reject(err)
    }
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      prev?.()
      succeed()
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    tag.async = true
    tag.onerror = () => fail(new Error('YouTube IFrame API failed to load'))
    document.head.appendChild(tag)
    // Ad/privacy blockers can serve an empty 200 (fires onload, not onerror);
    // this timeout catches that silent-block case so the promise always settles
    // (and resets apiPromise) instead of latching pending + leaking closures.
    timer = setTimeout(() => {
      if (!w.YT?.Player) fail(new Error('YouTube IFrame API timed out'))
    }, 6000)
  })
  return apiPromise
}

export default function HeroYouTube({
  videoId = VIDEO_ID,
  onActive,
}: {
  videoId?: string
  onActive: (active: boolean) => void
}) {
  const reduce = useReducedMotion() ?? false
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (reduce || !wrapRef.current) {
      onActive(false)
      return
    }

    const wrap = wrapRef.current
    let cancelled = false
    // Don't fetch YouTube's API + player during the landing page's critical
    // path — the smoke hero is already showing. Wait for an idle moment.
    let startTimer: ReturnType<typeof setTimeout> | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let player: any = null
    let ro: ResizeObserver | undefined
    let poll: ReturnType<typeof setInterval> | undefined

    // The API replaces this node with the <iframe>; keep it OUT of React's tree.
    const mount = document.createElement('div')
    mount.style.position = 'absolute'
    wrap.appendChild(mount)

    // Overscan past a pure cover so YouTube's title bar (top) and any watermark
    // (bottom) are pushed off-screen, leaving just the footage.
    const OVERSCAN = 1.35
    const cover = () => {
      const iframe: HTMLIFrameElement | undefined = player?.getIframe?.()
      if (!iframe) return
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (!w || !h) return
      const scale = Math.max(w / 16, h / 9) * OVERSCAN
      const vw = Math.ceil(scale * 16)
      const vh = Math.ceil(scale * 9)
      Object.assign(iframe.style, {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: `${vw}px`,
        height: `${vh}px`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        border: '0',
      })
      // Keep the decorative player out of the tab order + a11y tree.
      iframe.setAttribute('aria-hidden', 'true')
      iframe.setAttribute('tabindex', '-1')
    }

    const begin = () => {
      if (cancelled) return
      loadYouTubeApi()
      .then(() => {
        if (cancelled) return
        const w = window as unknown as { YT: any } // eslint-disable-line @typescript-eslint/no-explicit-any
        player = new w.YT.Player(mount, {
          videoId,
          // nocookie host narrows YouTube's cookie/tracking scope. Note autoplay
          // starts playback (and any on-play storage) immediately, so this is a
          // reduced footprint, not a pre-consent gate.
          host: 'https://www.youtube-nocookie.com',
          playerVars: {
            autoplay: 1,
            mute: 1,
            controls: 0,
            loop: 1,
            playlist: videoId, // required for loop to work on a single video
            playsinline: 1,
            modestbranding: 1,
            rel: 0,
            fs: 0,
            disablekb: 1,
            iv_load_policy: 3,
          },
          events: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onReady: (e: { target: any }) => {
              e.target.mute()
              e.target.playVideo()
              cover()
              // Reveal only once GENUINELY playing. onStateChange(PLAYING) is the
              // primary signal; this bounded poll is a backup for environments
              // that drop YouTube's state-change postMessage (some ad/privacy
              // blockers). It checks real state, so an autoplay-blocked/paused
              // player stays hidden and the smoke fallback shows instead.
              let tries = 0
              poll = setInterval(() => {
                tries += 1
                if (e.target.getPlayerState?.() === 1) {
                  onActive(true)
                  cover()
                  clearInterval(poll)
                } else if (tries >= 15) {
                  clearInterval(poll) // ~6s: give up, keep the smoke hero
                }
              }, 400)
            },
            onStateChange: (e: { data: number }) => {
              const YT = (window as unknown as { YT: { PlayerState: { PLAYING: number } } }).YT
              if (e.data === YT.PlayerState.PLAYING) {
                onActive(true)
                cover()
                clearInterval(poll)
              }
            },
            onError: () => onActive(false),
          },
        })

        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(cover)
          ro.observe(wrap)
        }
        window.addEventListener('resize', cover)
      })
      .catch(() => onActive(false))
    }

    // requestIdleCallback where supported, else a short timeout — either way the
    // landing page paints (and the smoke hero runs) before YouTube loads.
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    if (ric) ric(begin, { timeout: 2500 })
    else startTimer = setTimeout(begin, 1200)

    return () => {
      cancelled = true
      if (startTimer) clearTimeout(startTimer)
      clearInterval(poll)
      ro?.disconnect()
      window.removeEventListener('resize', cover)
      try {
        player?.destroy?.()
      } catch {
        /* player may already be gone */
      }
      // Remove any node the API left behind (React never knew about it).
      try {
        mount.remove()
        wrap.replaceChildren()
      } catch {
        /* noop */
      }
    }
  }, [reduce, videoId, onActive])

  if (reduce) return null

  return <div ref={wrapRef} className="absolute inset-0 overflow-hidden" aria-hidden="true" />
}
