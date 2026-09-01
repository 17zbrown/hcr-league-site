import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useReducedMotion } from 'framer-motion'
import { useClasses, useCurrentSeason, useEvents, useSeasonResults, useTeams } from '../lib/queries'
import { computeStandings } from '../lib/standings'
import { CLASS_ORDER, classColor, eventEnded, eventStart, fmtDate, fmtTime } from '../lib/format'
import Countdown from './Countdown'
import { ClassChip } from './ui'
import HeroVideo, { type VideoStatus } from './HeroVideo'
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
      sorted.find((e) => e.status !== 'complete' && !eventEnded(e.date))
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
                {next.track?.location ? ` · ${next.track.location}` : ''} · {fmtDate(eventStart(next))} · {fmtTime(eventStart(next))}
              </p>
              {/*
                The primary button goes to the round this slide is about, not to
                /signup. The season is underway and the grid is full: to the forty
                people who already entered, the brightest button on the site was an
                invitation to do the thing they have done. What they want from a
                slide headlined "Next Round" is the round.

                The brand/intro slide keeps its Enter the Season CTA — that one is
                addressed to a stranger, and there the ask is the right one.
              */}
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to={`/schedule/${next.id}`} className="shadow-glow rounded-xl bg-[var(--color-brand)] px-7 py-3.5 font-alt text-lg font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-1">Race Details</Link>
                <Link to="/schedule" className="rounded-xl border border-[var(--color-line-2)] px-7 py-3.5 font-alt text-lg font-bold uppercase tracking-wide text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink)]">Full Schedule</Link>
              </div>
            </div>
            <Link to={`/schedule/${next.id}`} className="block rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 shadow-card transition-transform hover:-translate-y-0.5">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono text-xs font-bold uppercase tracking-widest text-[var(--color-blue)]">Green flag in</span>
                <div className="flex gap-2">
                  {CLASS_ORDER.map((c) => (
                    <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: classColor(c, classes) }} />
                  ))}
                </div>
              </div>
              <Countdown target={eventStart(next)} expiredLabel="Track is open" />
            </Link>
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
              <Link to="/results" className="block rounded-2xl bg-[var(--color-deep-2)] p-8 text-center transition-transform hover:-translate-y-0.5">
                <div className="font-display text-[7rem] leading-none text-[var(--color-brand)]">P1</div>
                <div className="mt-2 font-mono text-xs uppercase tracking-widest text-white/60">Overall Victory</div>
              </Link>
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
  const [userPaused, setUserPaused] = useState(false)
  // Three states, because "still loading" and "will never play" want different
  // heroes. Treating them as one boolean is what made the smoke fallback flash up
  // for a second on every visit before the video took over.
  const [videoStatus, setVideoStatus] = useState<VideoStatus>('loading')
  const videoActive = videoStatus === 'playing'
  // Only a video that is definitively not coming falls back to the smoke hero.
  // While it is merely loading, the plain dark curtain covers everything.
  const showSmokeHero = videoStatus === 'unavailable'
  const count = slides.length
  const active = Math.min(idx, count - 1)

  useEffect(() => {
    if (paused || userPaused || reduce || count <= 1) return
    const id = setInterval(() => setIdx((i) => (i + 1) % count), AUTO_MS)
    return () => clearInterval(id)
  }, [paused, userPaused, reduce, count])

  if (!count) return null

  return (
    <section
      className="on-navy relative overflow-hidden bg-[var(--color-deep)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="Featured league highlights"
    >
      {/* League race footage (falls back to the tire-smoke hero if the video
          can't autoplay / load). */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[var(--color-deep)]">
        <HeroVideo onStatus={setVideoStatus} />
      </div>

      {/* Opaque curtain over the video until it is genuinely playing, so a
          blocked-autoplay / loading / error frame never shows. While the video is
          still loading this is ALL that shows — a flat dark panel in the site's
          own base colour, which reads as the hero settling rather than as a
          different hero being replaced. */}
      <div
        className={`pointer-events-none absolute inset-0 bg-[var(--color-deep)] transition-opacity duration-700 ${
          videoActive ? 'opacity-0' : 'opacity-100'
        }`}
        aria-hidden="true"
      />

      {/* Legibility scrim — only when a clip is playing. Strong on the left
          (text) fading right (cars stay visible). */}
      {videoActive && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(100deg, rgba(11,11,13,0.94) 0%, rgba(11,11,13,0.86) 38%, rgba(11,11,13,0.48) 72%, rgba(11,11,13,0.18) 100%)',
          }}
        />
      )}

      {/* Telemetry grid, then tire smoke launching out of the box. This is the
          fallback hero for phones, Save-Data, reduced motion and any failure to
          play — never a loading state, which is why it keys off `unavailable`
          rather than "not yet playing". */}
      {showSmokeHero && <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />}
      {showSmokeHero && <SmokeCanvas className="pointer-events-none absolute inset-0 h-full w-full" />}

      {/* Neutral legibility scrim only — no colored glow (a warm radial in the
          corner reads as a rising sun, not exhaust). The smoke carries the mood. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, rgba(11,11,13,0.55) 0%, rgba(11,11,13,0.28) 46%, rgba(11,11,13,0.05) 78%, rgba(11,11,13,0.28) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
        style={{ background: 'linear-gradient(to top, var(--color-deep), transparent)' }}
      />


      <div className="container-hcr relative py-14 md:py-20">
        <div className="relative min-h-[600px] sm:min-h-[540px] md:min-h-[460px]">
          {slides.map((s, i) => {
            const on = i === active
            return (
              <div
                key={s.key}
                aria-hidden={!on}
                // inert (absent from this React version's types) removes the
                // off-slide's links from tab order AND the a11y tree;
                // pointer-events/opacity alone leave them focusable.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                {...(!on && ({ inert: '' } as any))}
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
          <div className="mt-6 flex items-center gap-1">
            {slides.map((s, i) => (
              <button
                key={s.key}
                onClick={() => setIdx(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === active ? 'true' : undefined}
                className="flex h-11 min-w-11 items-center justify-center px-1"
              >
                <span
                  aria-hidden
                  className="h-2.5 rounded-full transition-all duration-300"
                  style={{ width: i === active ? 34 : 10, background: i === active ? 'var(--color-ink)' : 'var(--color-muted)' }}
                />
              </button>
            ))}
            <button
              onClick={() => setUserPaused((v) => !v)}
              aria-pressed={userPaused}
              aria-label={userPaused ? 'Resume slide rotation' : 'Pause slide rotation'}
              className="ml-1 flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--color-line-2)] font-mono text-xs text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-ink)]"
            >
              {userPaused ? '►' : 'II'}
            </button>
            <span className="tabular ml-2 font-mono text-xs text-[var(--color-faint)]">
              {String(active + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
