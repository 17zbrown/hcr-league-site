import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useReducedMotion } from 'framer-motion'
import { useClasses, useCurrentSeason, useEvents, useSeasonResults, useTeams } from '../lib/queries'
import { computeStandings } from '../lib/standings'
import { CLASS_ORDER, classColor, fmtDateLong } from '../lib/format'
import Countdown from './Countdown'
import { ClassChip } from './ui'
import { SafeBoundary } from './SafeBoundary'

const Hero3D = lazy(() => import('./Hero3D'))

interface Slide {
  key: string
  eyebrow: string
  render: () => ReactNode
}

const AUTO_MS = 5000

export default function HeroCarousel() {
  const { data: season } = useCurrentSeason()
  const { data: events } = useEvents(season?.id)
  const { data: results } = useSeasonResults(season?.id)
  const { data: teams } = useTeams()
  const { data: classes } = useClasses()
  const reduce = useReducedMotion() ?? false

  const slides = useMemo<Slide[]>(() => {
    const list: Slide[] = []
    const sorted = [...(events ?? [])].sort((a, b) => a.round - b.round)
    const complete = sorted.filter((e) => e.status === 'complete')
    const next =
      sorted.find((e) => e.status === 'next') ??
      sorted.find((e) => new Date(e.date).getTime() > Date.now())
    const last = complete[complete.length - 1]
    const standings = computeStandings(results ?? [], teams ?? [])
    const leaders = CLASS_ORDER.map((c) => ({ cls: c, row: standings.drivers[c]?.[0] })).filter((x) => x.row)

    if (next) {
      list.push({
        key: 'next',
        eyebrow: `Next Round · R${next.round}`,
        render: () => (
          <div className="grid gap-10 md:grid-cols-[1.1fr_0.9fr] md:items-center">
            <div>
              <h1 className="text-6xl leading-[0.9] sm:text-7xl md:text-8xl">{next.name ?? next.track?.name}</h1>
              <p className="mt-5 text-lg text-[var(--color-muted)]">
                {next.track?.name}
                {next.track?.location ? ` · ${next.track.location}` : ''} · {fmtDateLong(next.date)}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/signup" className="shadow-glow rounded-xl bg-[var(--color-brand)] px-7 py-3.5 font-display text-lg font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-1">Enter the Season</Link>
                <Link to="/schedule" className="rounded-xl bg-[var(--color-ink)] px-7 py-3.5 font-display text-lg font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-1">Schedule</Link>
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]/90 p-6 shadow-card backdrop-blur-sm">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono text-xs font-bold uppercase tracking-widest text-[var(--color-blue)]">Green flag in</span>
                <div className="flex gap-2">
                  {CLASS_ORDER.map((c) => (
                    <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: classColor(c, classes) }} />
                  ))}
                </div>
              </div>
              <Countdown target={next.date} />
            </div>
          </div>
        ),
      })
    }

    if (leaders.length) {
      list.push({
        key: 'roll',
        eyebrow: 'Championship · Drivers on a roll',
        render: () => (
          <div>
            <h1 className="text-5xl leading-[0.9] sm:text-6xl md:text-7xl">Drivers<br />on a roll</h1>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {leaders.map(({ cls, row }) => (
                <div key={cls} className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]/90 p-5 backdrop-blur-sm">
                  <ClassChip classId={cls} />
                  <div className="mt-3 font-display text-2xl font-extrabold uppercase leading-tight">{row!.name}</div>
                  <div className="tabular mt-1 text-sm text-[var(--color-muted)]">
                    {row!.points} pts{row!.wins ? ` · ${row!.wins}W` : ''}
                  </div>
                </div>
              ))}
            </div>
            <Link to="/standings" className="mt-7 inline-block rounded-xl bg-[var(--color-ink)] px-6 py-3 font-display text-lg font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-1">Full Standings</Link>
          </div>
        ),
      })
    }

    const lastResults = (results ?? []).filter((r) => r.event_id === last?.id)
    const winner = lastResults.find((r) => r.pos === 1)
    if (last && winner) {
      list.push({
        key: 'winner',
        eyebrow: `Round ${last.round} · Race winner`,
        render: () => (
          <div className="grid gap-10 md:grid-cols-[1.1fr_0.9fr] md:items-center">
            <div>
              <div className="text-lg font-semibold text-[var(--color-muted)]">Winner — {last.name ?? last.track?.name}</div>
              <h1 className="mt-2 text-6xl leading-[0.9] sm:text-7xl md:text-8xl">{winner.drivers_text}</h1>
              <div className="mt-5 flex items-center gap-3">
                <ClassChip classId={winner.class_id} size="md" />
                <span className="tabular text-[var(--color-muted)]">#{winner.number} · {winner.laps} laps · {winner.best_lap}</span>
              </div>
              <Link to="/results" className="mt-8 inline-block rounded-xl bg-[var(--color-brand)] px-7 py-3.5 font-display text-lg font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-1 shadow-glow">Race Results</Link>
            </div>
            <div className="hidden md:block">
              <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]/90 p-8 text-center shadow-card backdrop-blur-sm">
                <div className="font-display text-[9rem] font-extrabold leading-none text-[var(--color-brand)]">1</div>
                <div className="font-mono text-xs uppercase tracking-widest text-[var(--color-muted)]">Overall Victory</div>
              </div>
            </div>
          </div>
        ),
      })
    }

    list.push({
      key: 'brand',
      eyebrow: `${season?.name ?? '2026 Season'} · IMSA-style endurance`,
      render: () => (
        <div>
          <h1 className="text-6xl leading-[0.9] sm:text-7xl md:text-8xl">
            Race like{' '}
            <span className="relative inline-block">
              <span className="relative z-10">it's real.</span>
              <span className="absolute inset-x-0 bottom-1.5 z-0 h-4 bg-[var(--color-brand)] md:h-5" />
            </span>
          </h1>
          <p className="mt-6 max-w-md text-lg text-[var(--color-muted)]">
            A three-class iRacing endurance championship. GTP, LMP2, and GTD share one grid and
            fight for three titles — broadcast timing, real race control, no arcade shortcuts.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/signup" className="shadow-glow rounded-xl bg-[var(--color-brand)] px-7 py-3.5 font-display text-lg font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-1">Enter the Season</Link>
            <Link to="/standings" className="rounded-xl bg-[var(--color-ink)] px-7 py-3.5 font-display text-lg font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-1">Championship</Link>
          </div>
        </div>
      ),
    })

    return list
  }, [events, results, teams, classes, season])

  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const count = slides.length
  const active = Math.min(idx, count - 1)

  // Measure the active slide to animate the container height smoothly.
  const slideRefs = useRef<(HTMLDivElement | null)[]>([])
  const [height, setHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const measure = () => {
      const el = slideRefs.current[active]
      if (el) setHeight(el.offsetHeight)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active, slides])

  useEffect(() => {
    if (paused || reduce || count <= 1) return
    const id = setInterval(() => setIdx((i) => (i + 1) % count), AUTO_MS)
    return () => clearInterval(id)
  }, [paused, reduce, count])

  if (!count) return null

  return (
    <section
      className="relative overflow-hidden border-b border-[var(--color-line)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(58% 55% at 86% -8%, rgba(242,225,20,0.16), transparent 62%), radial-gradient(48% 50% at 4% 6%, rgba(47,107,255,0.08), transparent 60%)',
        }}
      />
      {/* Subtle 3D moment, tucked into the top-right corner (desktop only) */}
      <div className="pointer-events-none absolute -right-8 -top-10 hidden h-[440px] w-[440px] opacity-[0.55] md:block lg:h-[500px] lg:w-[520px]">
        <SafeBoundary>
          <Suspense fallback={null}>
            <Hero3D />
          </Suspense>
        </SafeBoundary>
      </div>

      <div className="container-hcr relative py-14 md:py-20">
        <div
          className="relative transition-[height] duration-500 ease-out"
          style={{ height }}
        >
          {slides.map((s, i) => {
            const on = i === active
            return (
              <div
                key={s.key}
                ref={(el) => { slideRefs.current[i] = el }}
                aria-hidden={!on}
                className="absolute inset-x-0 top-0 transition-all duration-700 ease-out"
                style={{
                  opacity: on ? 1 : 0,
                  transform: on ? 'translateY(0)' : 'translateY(16px)',
                  pointerEvents: on ? 'auto' : 'none',
                }}
              >
                <div className="mb-6 flex items-center gap-3">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-red)] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-red)]" />
                  </span>
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-2)]">{s.eyebrow}</span>
                </div>
                {s.render()}
              </div>
            )
          })}
        </div>

        {count > 1 && (
          <div className="mt-8 flex items-center gap-3">
            {slides.map((s, i) => (
              <button
                key={s.key}
                onClick={() => setIdx(i)}
                aria-label={`Go to slide ${i + 1}`}
                className="h-2.5 rounded-full transition-all duration-300"
                style={{ width: i === active ? 34 : 10, background: i === active ? 'var(--color-ink)' : 'var(--color-line-2)' }}
              />
            ))}
            <span className="tabular ml-2 font-mono text-xs text-[var(--color-faint)]">
              {String(active + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
