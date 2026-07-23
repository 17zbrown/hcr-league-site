import { useEffect, useRef } from 'react'

/**
 * The launch: a car streaks out of frame along the ground line, dumping tire
 * smoke from the contact patch — dense, lumpy, occluding smoke that billows and
 * shears backward, plus skid marks that slowly fade. After the car is gone the
 * cloud roils, thins and drifts; sparse wisps keep the panel breathing.
 *
 * Deliberately NOT a glow: puffs composite with source-over (smoke blocks
 * light, it doesn't emit it) and the sprite is an irregular multi-blob cloud,
 * so overlaps read as billow, never as a sun.
 *
 * prefers-reduced-motion: paints one settled haze band along the ground.
 */
export default function SmokeCanvas({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // ---- irregular smoke sprite: several offset soft blobs -> lumpy cloud ----
    const SPRITE = 160
    const sprite = document.createElement('canvas')
    sprite.width = sprite.height = SPRITE
    const sctx = sprite.getContext('2d')!
    const C = SPRITE / 2
    // deterministic lump layout (no Math.random at module scope keeps HMR stable)
    const lumps = [
      [0, 0, 0.46, 0.16], [-0.2, -0.1, 0.3, 0.13], [0.22, -0.06, 0.28, 0.12],
      [-0.08, 0.18, 0.3, 0.12], [0.12, 0.16, 0.24, 0.1], [-0.26, 0.08, 0.2, 0.09],
      [0.05, -0.24, 0.22, 0.1],
    ] as const
    for (const [ox, oy, rr, a] of lumps) {
      const cx = C + ox * SPRITE
      const cy = C + oy * SPRITE
      const r = rr * SPRITE
      const g = sctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      g.addColorStop(0, `rgba(220,227,234,${a * 1.5})`)
      g.addColorStop(0.55, `rgba(200,210,220,${a * 0.85})`)
      g.addColorStop(1, 'rgba(200,210,220,0)')
      sctx.fillStyle = g
      sctx.beginPath()
      sctx.arc(cx, cy, r, 0, Math.PI * 2)
      sctx.fill()
    }

    interface P {
      x: number; y: number; vx: number; vy: number
      life: number; max: number
      size: number; grow: number
      rot: number; vr: number
      /** birth squash: >1 = horizontally streaked, eases to 1 as it billows */
      squash: number
      /** turbulence phase + amplitude */
      ph: number; amp: number
      alpha: number
    }

    let parts: P[] = []
    let w = 0, h = 0, dpr = 1
    let raf = 0
    let t0 = performance.now()
    let elapsed = 0
    let running = false

    // skid marks laid down during the launch: [x0, x1, y, born]
    let skids: [number, number, number, number][] = []

    const groundY = () => h * 0.84

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = rect.width
      h = rect.height
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // ---- the car: accelerates across the ground line and exits right ----
    const LAUNCH_T = 1.15 // seconds the car is on screen
    const LAUNCH_PERIOD = 9 // seconds between launches (drama, then it breathes)
    let launchStart = 0 // elapsed time the current launch began
    // local time within the current launch cycle
    const carX = (lt: number) => {
      const k = Math.min(lt / LAUNCH_T, 1)
      return w * (-0.06 + 1.3 * k * k) // quadratic accel, exits at 1.24w
    }
    const carOn = (lt: number) => lt >= 0 && lt < LAUNCH_T

    const spawnBurnout = (x: number, dense: boolean) => {
      const n = dense ? 6 : 1
      for (let i = 0; i < n; i++) {
        const back = -(60 + Math.random() * 200) // thrown backward off the tire
        parts.push({
          x: x - 14 + (Math.random() - 0.5) * 26,
          y: groundY() + (Math.random() - 0.5) * 10,
          vx: back * 0.45 + (Math.random() - 0.5) * 30,
          vy: -(14 + Math.random() * 55),
          life: 0,
          max: 3.8 + Math.random() * 3.4,
          size: 60 + Math.random() * 90,
          grow: 34 + Math.random() * 34,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.5,
          squash: 1.7 + Math.random() * 0.7, // streaked at birth
          ph: Math.random() * Math.PI * 2,
          amp: 14 + Math.random() * 22,
          alpha: 0.62 + Math.random() * 0.32,
        })
      }
    }

    // seed a plume so the very first rendered frame already shows smoke,
    // not an empty box building up over the launch
    const seedPlume = (originX: number) => {
      for (let i = 0; i < 26; i++) {
        spawnBurnout(originX + Math.random() * w * 0.14, false)
        const p = parts[parts.length - 1]
        p.life = Math.random() * 1.6 // spread across the plume's lifespan
      }
    }

    const spawnWisp = () => {
      parts.push({
        x: w * (0.04 + Math.random() * 0.55),
        y: groundY() - Math.random() * h * 0.08,
        vx: 8 + Math.random() * 18,
        vy: -(6 + Math.random() * 14),
        life: 0,
        max: 6 + Math.random() * 5,
        size: 120 + Math.random() * 160,
        grow: 16 + Math.random() * 14,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.2,
        squash: 1.15,
        ph: Math.random() * Math.PI * 2,
        amp: 10 + Math.random() * 14,
        alpha: 0.16 + Math.random() * 0.12,
      })
    }

    const draw = (dt: number, t: number) => {
      ctx.clearRect(0, 0, w, h)

      // skid marks: two dark rubber lines fading over ~7s
      for (const [x0, x1, y, born] of skids) {
        const age = t - born
        const a = Math.max(0, 0.30 - age * 0.045)
        if (a <= 0) continue
        ctx.strokeStyle = `rgba(5,8,10,${a})`
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        for (const off of [-4, 4]) {
          ctx.beginPath()
          ctx.moveTo(x0, y + off)
          // slight wobble so it reads as laid rubber, not a rule
          ctx.quadraticCurveTo((x0 + x1) / 2, y + off + 2, x1, y + off)
          ctx.stroke()
        }
      }

      // smoke — NORMAL compositing: occludes, never glows
      for (const p of parts) {
        p.life += dt
        const k = p.life / p.max
        if (k >= 1) continue

        // shear + rise + turbulence
        p.x += p.vx * dt + Math.sin(p.life * 1.9 + p.ph) * p.amp * dt
        p.y += p.vy * dt
        p.vx *= 1 - 0.75 * dt
        p.vy = p.vy * (1 - 0.5 * dt) - 9 * dt // buoyancy: cooling smoke climbs
        p.rot += p.vr * dt
        p.squash = 1 + (p.squash - 1) * (1 - 1.6 * dt) // streak relaxes to billow

        const size = p.size + p.grow * p.life * 6
        const fade = k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9
        const a = fade * p.alpha
        if (a <= 0.004) continue

        ctx.save()
        ctx.globalAlpha = a
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.scale(p.squash, 1)
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size)
        ctx.restore()
      }
      parts = parts.filter((p) => p.life < p.max)

      // the car: a low dark streak with a motion tail, gone in ~1.2s
      const lt = t - launchStart
      if (carOn(lt)) {
        const x = carX(lt)
        const y = groundY() - 7
        const tail = 90 + 240 * Math.min(lt / LAUNCH_T, 1)
        const g = ctx.createLinearGradient(x - tail, y, x, y)
        g.addColorStop(0, 'rgba(6,9,12,0)')
        g.addColorStop(0.75, 'rgba(6,9,12,0.55)')
        g.addColorStop(1, 'rgba(10,14,18,0.9)')
        ctx.fillStyle = g
        ctx.beginPath()
        // low, cab-forward silhouette streak — abstract, not clip-art
        ctx.roundRect(x - tail, y - 7, tail, 14, 7)
        ctx.fill()
        // brand tail-light smear
        const tl = ctx.createLinearGradient(x - 70, y, x, y)
        tl.addColorStop(0, 'rgba(242,225,20,0)')
        tl.addColorStop(1, 'rgba(242,225,20,0.8)')
        ctx.fillStyle = tl
        ctx.fillRect(x - 70, y - 2.5, 68, 2.2)
      }
    }

    resize()

    if (reduced) {
      // settled haze band along the ground — no motion at all
      for (let i = 0; i < 70; i++) {
        spawnWisp()
        const p = parts[parts.length - 1]
        p.life = p.max * 0.45
        p.x += p.vx * 2.5
        p.y += p.vy * 2.5
      }
      draw(0, 99)
      return () => void 0
    }

    // lay fresh skid marks where the launch begins
    const armLaunch = (at: number) => {
      launchStart = at
      skids = [[w * 0.02, w * 0.3, groundY() + 6, at]]
    }
    armLaunch(0)
    seedPlume(w * 0.04) // opening plume, visible from frame one

    let wispClock = 0
    const loop = (now: number) => {
      if (!running) return
      const dt = Math.min((now - t0) / 1000, 0.05)
      t0 = now
      elapsed += dt

      // re-arm the launch on a cycle so the drama recurs, not just on load
      if (elapsed - launchStart >= LAUNCH_PERIOD) armLaunch(elapsed)

      const lt = elapsed - launchStart
      // burnout emission tracks the car's contact patch while it's on screen
      if (carOn(lt)) {
        spawnBurnout(carX(lt), true)
      } else {
        wispClock += dt
        if (wispClock > 0.5 && parts.length < 90) {
          wispClock = 0
          spawnWisp()
        }
      }

      draw(dt, elapsed)
      raf = requestAnimationFrame(loop)
    }

    const start = () => {
      if (running) return
      running = true
      t0 = performance.now()
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    start()

    const onResize = () => resize()
    const onVis = () => (document.hidden ? stop() : start())
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVis)

    return () => {
      stop()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
