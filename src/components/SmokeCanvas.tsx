import { useEffect, useRef } from 'react'

/**
 * Tire smoke launching out of a pit box.
 *
 * One orchestrated moment: a dense burst on mount (the car leaving the box),
 * decaying into a slow ambient drift so the hero keeps breathing without
 * demanding attention. Canvas + a pre-rendered radial sprite keeps it cheap —
 * no per-particle gradient allocation.
 *
 * Honours prefers-reduced-motion by painting a single settled frame.
 */
export default function SmokeCanvas({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // ---- soft puff sprite (drawn once, reused for every particle) ----
    const SPRITE = 128
    const sprite = document.createElement('canvas')
    sprite.width = sprite.height = SPRITE
    const sctx = sprite.getContext('2d')!
    const g = sctx.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2)
    // Very low-contrast stops: smoke should read as haze catching light, never
    // as a defined blob. Density comes from overlapping many puffs, not opacity.
    g.addColorStop(0, 'rgba(233,240,246,0.20)')
    g.addColorStop(0.35, 'rgba(214,226,236,0.10)')
    g.addColorStop(0.7, 'rgba(176,196,212,0.035)')
    g.addColorStop(1, 'rgba(176,196,212,0)')
    sctx.fillStyle = g
    sctx.fillRect(0, 0, SPRITE, SPRITE)

    interface P {
      x: number; y: number; vx: number; vy: number
      life: number; max: number; size: number; grow: number
      rot: number; vr: number; warm: number
    }
    let parts: P[] = []
    let w = 0, h = 0, dpr = 1
    let raf = 0
    let t0 = performance.now()
    let running = false

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = rect.width
      h = rect.height
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // Emit from a low-left "pit box", pushing right and up.
    const spawn = (burst: boolean) => {
      const originX = w * 0.06
      const originY = h * 0.80
      const n = burst ? 3 : 1
      for (let i = 0; i < n; i++) {
        const spread = burst ? 0.55 : 0.35
        const speed = burst ? 90 + Math.random() * 170 : 26 + Math.random() * 46
        const ang = -0.18 - Math.random() * spread // up-and-right
        parts.push({
          x: originX + (Math.random() - 0.5) * 40,
          y: originY + (Math.random() - 0.5) * 26,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed * 0.65,
          life: 0,
          max: burst ? 2.6 + Math.random() * 2.4 : 4.5 + Math.random() * 4,
          size: burst ? 130 + Math.random() * 170 : 190 + Math.random() * 240,
          grow: burst ? 46 + Math.random() * 46 : 24 + Math.random() * 30,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.45,
          warm: Math.random(), // a few puffs catch the brand light near the box
        })
      }
    }

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'

      for (const p of parts) {
        p.life += dt
        const k = p.life / p.max
        if (k >= 1) continue
        // ease-out drift + slight rise as it cools
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vx *= 1 - 0.62 * dt // low drag so the plume carries across the frame
        p.vy = p.vy * (1 - 0.62 * dt) - 7 * dt // and lifts as it cools
        p.rot += p.vr * dt

        const size = p.size + p.grow * p.life * 8
        // fade in fast, out slow
        const alpha = (k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88) * 0.5
        if (alpha <= 0) continue

        ctx.save()
        ctx.globalAlpha = alpha
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        // brand-lit puffs only right at the box, so the yellow reads as light spill
        if (p.warm > 0.86 && p.x < w * 0.3) {
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = alpha * 0.5
          ctx.drawImage(sprite, -size / 2, -size / 2, size, size)
        }
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size)
        ctx.restore()
      }
      parts = parts.filter((p) => p.life < p.max)
      ctx.globalCompositeOperation = 'source-over'
    }

    resize()

    if (reduced) {
      // settled, motionless haze
      for (let i = 0; i < 120; i++) spawn(false)
      for (const p of parts) {
        p.life = p.max * 0.5
        p.x += p.vx * 1.6
        p.y += p.vy * 1.6
      }
      draw(0)
    }

    let acc = 0
    const loop = (now: number) => {
      if (!running) return
      const dt = Math.min((now - t0) / 1000, 0.05)
      t0 = now
      acc += dt
      // heavy emission for the first beat (the launch), then ambient drift
      if (acc < 1.1) { spawn(true); spawn(true) }
      else if (parts.length < 150 && Math.random() < 0.92) spawn(false)
      draw(dt)
      raf = requestAnimationFrame(loop)
    }

    const start = () => {
      if (reduced || running) return
      running = true
      t0 = performance.now()
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    if (!reduced) {
      for (let i = 0; i < 26; i++) spawn(true) // the launch
      start()
    }

    const onResize = () => resize()
    const onVis = () => (document.hidden ? stop() : start())
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVis)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
