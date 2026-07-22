import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useReducedMotion } from 'framer-motion'
import { useClasses, useCurrentSeason, useEvents, useSeasonResults, useTeams } from '../lib/queries'
import { computeStandings } from '../lib/standings'
import { CLASS_ORDER, classColor, fmtDateLong } from '../lib/format'
import Countdown from './Countdown'
import { ClassChip } from './ui'
import HeroVideo from './HeroVideo'
import SmokeCanvas from './SmokeCanvas'
import { DriverName } from './links'

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
                <Link to="/signup" className="shadow-glow rounded-xl bg-[var(--color-brand)] px-7 py-3.5 font-alt text-lg font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-1">Enter the Season</Link>
                <Link to="/schedule" className="rounded-xl border border-[var(--color-line-2)] px-7 py-3.5 font-alt text-lg font-bold uppercase tracking-wide text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink)]">Schedule</Link>
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 shadow-card">
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
                <div key={cls} className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 shadow-card">
                  <ClassChip classId={cls} />
                  <div className="mt-3 font-display text-2xl leading-tight">
                    <DriverName text={row!.name} />
                  </div>
                  <div className="tabular mt-1 text-sm text-[var(--color-muted)]">
                    {row!.points} pts{row!.wins ? ` · ${row!.wins}W` : ''}
                  </div>
                </div>
              ))}
            </div>
            <Link to="/standings" className="mt-7 inline-block rounded-xl border border-[var(--color-line-2)] px-6 py-3 font-alt text-lg font-bold uppercase tracking-wide text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink)]">Full Standings</Link>
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
              <Link to="/results" className="mt-8 inline-block rounded-xl bg-[var(--color-brand)] px-7 py-3.5 font-alt text-lg font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-1 shadow-glow">Race Results</Link>
            </div>
            <div className="hidden md:block">
              <div className="rounded-2xl bg-[var(--color-deep-2)] p-8 text-center">
                <div className="font-display text-[7rem] leading-none text-[var(--color-brand)]">P1</div>
                <div className="mt-2 font-mono text-xs uppercase tracking-widest text-white/60">Overall Victory</div>
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
              {/* the reference's signature: a single hairline accent, not a fill */}
              <span className="absolute inset-x-0 -bottom-1 z-0 h-[3px] bg-[var(--color-brand)]" />
            </span>
          </h1>
          <p className="mt-6 max-w-md text-lg text-[var(--color-muted)]">
            A three-class iRacing endurance championship. GTP, LMP2, and GTD share one grid and
            fight for three titles — broadcast timing, real race control, no arcade shortcuts.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/signup" className="shadow-glow rounded-xl bg-[var(--color-brand)] px-7 py-3.5 font-alt text-lg font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-1">Enter the Season</Link>
            <Link to="/standings" className="rounded-xl border border-[var(--color-line-2)] px-7 py-3.5 font-alt text-lg font-bold uppercase tracking-wide text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink)]">Championship</Link>
          </div>
        </div>
      ),
    })

    return list
  }, [events, results, teams, classes, season])

  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [videoActive, setVideoActive] = useState(false)
  const count = slides.length
  const active = Math.min(idx, count - 1)

  useEffect(() => {
    if (paused || reduce || count <= 1) return
    const id = setInterval(() => setIdx((i) => (i + 1) % count), AUTO_MS)
    return () => clearInterval(id)
  }, [paused, reduce, count])

  if (!count) return null

  return (
    <section
      className="on-navy relative overflow-hidden bg-[var(--color-deep)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
    >
      {/* Background race footage (falls back to the static hero if no clips) */}
      <div className={`pointer-events-none absolute inset-0 overflow-hidden ${videoActive ? 'bg-[var(--color-deep)]' : ''}`}>
        <HeroVideo onActive={setVideoActive} />
      </div>

      {/* Legibility scrim — only when a clip is playing. Strong on the left
          (text) fading right (cars stay visible). */}
      {videoActive && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(100deg, rgba(22,48,61,0.94) 0%, rgba(22,48,61,0.86) 38%, rgba(22,48,61,0.48) 72%, rgba(22,48,61,0.18) 100%)',
          }}
        />
      )}

      {/* Telemetry grid, then tire smoke launching out of the box. */}
      {!videoActive && <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />}
      {!videoActive && <SmokeCanvas className="pointer-events-none absolute inset-0 h-full w-full" />}

      {/* Warm light spill from the box + cinematic vignette so type always wins */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(42% 60% at 6% 88%, rgba(242,225,20,0.16), transparent 64%),' +
            'radial-gradient(60% 55% at 88% -6%, rgba(91,141,239,0.10), transparent 62%),' +
            'linear-gradient(90deg, rgba(22,48,61,0.55) 0%, rgba(22,48,61,0.28) 46%, rgba(22,48,61,0.05) 78%, rgba(22,48,61,0.28) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
        style={{ background: 'linear-gradient(to top, #16303d, transparent)' }}
      />

      <div className="container-hcr relative py-14 md:py-20">
        <div className="relative min-h-[600px] sm:min-h-[540px] md:min-h-[460px]">
          {slides.map((s, i) => {
            const on = i === active
            return (
              <div
                key={s.key}
                aria-hidden={!on}
                className="absolute inset-0 flex items-center transition-all duration-700 ease-out"
                style={{
                  opacity: on ? 1 : 0,
                  transform: on ? 'translateY(0)' : 'translateY(16px)',
                  pointerEvents: on ? 'auto' : 'none',
                }}
              >
                <div className="w-full">
                  <div className="mb-6 flex items-center gap-3">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-red)] opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-red)]" />
                    </span>
                    <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-2)]">{s.eyebrow}</span>
                  </div>
                  {s.render()}
                </div>
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
