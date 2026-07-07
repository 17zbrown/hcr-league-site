import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  useChampions,
  useClasses,
  useCurrentSeason,
  useEvents,
  useResults,
  useSeasonResults,
  useTeams,
} from '../lib/queries'
import { computeStandings } from '../lib/standings'
import { CLASS_ORDER, classColor, fmtDate, fmtDateLong } from '../lib/format'
import type { RaceEvent } from '../lib/types'
import Countdown from '../components/Countdown'
import { ClassChip, Section, Skeleton } from '../components/ui'
import { CountUp, Reveal } from '../components/motion'
import Ticker from '../components/Ticker'

export default function Home() {
  const { data: season } = useCurrentSeason()
  const { data: events, isLoading: evLoading } = useEvents(season?.id)
  const { data: classes } = useClasses()
  const { data: teams } = useTeams()
  const { data: seasonResults } = useSeasonResults(season?.id)

  const { nextEvent, lastEvent, roundsDone } = useMemo(() => {
    if (!events?.length) return { nextEvent: undefined, lastEvent: undefined, roundsDone: 0 }
    const sorted = [...events].sort((a, b) => a.round - b.round)
    const complete = sorted.filter((e) => e.status === 'complete')
    const next =
      sorted.find((e) => e.status === 'next') ??
      sorted.find((e) => new Date(e.date).getTime() > Date.now()) ??
      sorted.find((e) => e.status !== 'complete')
    return { nextEvent: next, lastEvent: complete[complete.length - 1], roundsDone: complete.length }
  }, [events])

  const standings = useMemo(
    () => computeStandings(seasonResults ?? [], teams ?? []),
    [seasonResults, teams],
  )

  return (
    <>
      {/* ---------- HERO ---------- */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(58% 55% at 86% -8%, rgba(242,225,20,0.18), transparent 62%), radial-gradient(48% 50% at 4% 6%, rgba(47,107,255,0.09), transparent 60%)',
          }}
        />
        <div className="container-hcr relative grid gap-12 py-16 md:grid-cols-[1.12fr_0.88fr] md:py-24">
          <div>
            <Reveal>
              <div className="mb-6 inline-flex items-center gap-2.5 rounded-full bg-[var(--color-mist)] px-3.5 py-1.5 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-2)]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-red)] opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-red)]" />
                </span>
                {season?.name ?? '2026 Season'} · Round {nextEvent?.round ?? 2} up next
              </div>
            </Reveal>
            <Reveal delay={0.06}>
              <h1 className="text-6xl leading-[0.9] sm:text-7xl md:text-8xl">
                Race like{' '}
                <span className="relative inline-block">
                  <span className="relative z-10">it's real.</span>
                  <span className="absolute inset-x-0 bottom-1.5 z-0 h-4 bg-[var(--color-brand)] md:h-5" />
                </span>
              </h1>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-7 max-w-md text-lg text-[var(--color-muted)]">
                A three-class iRacing endurance championship. GTP, LMP2, and GTD share one grid
                and fight for three titles — broadcast timing, real race control, no arcade
                shortcuts.
              </p>
            </Reveal>
            <Reveal delay={0.18}>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  to="/signup"
                  className="shadow-glow rounded-xl bg-[var(--color-brand)] px-7 py-3.5 font-display text-lg font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-1"
                >
                  Enter the 2026 Season
                </Link>
                <Link
                  to="/standings"
                  className="rounded-xl bg-[var(--color-ink)] px-7 py-3.5 font-display text-lg font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-1"
                >
                  View Standings
                </Link>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.14} y={28}>
            {evLoading || !nextEvent ? <Skeleton className="h-80 w-full" /> : <NextRaceCard event={nextEvent} />}
          </Reveal>
        </div>
      </section>

      {/* ---------- TICKER ---------- */}
      <Ticker />

      {/* ---------- LATEST RESULT — OVERALL ---------- */}
      {lastEvent && (
        <Section
          eyebrow={`Round ${lastEvent.round} · ${lastEvent.name ?? lastEvent.track?.name}`}
          title="Latest Result"
          action={
            <Link to="/results" className="text-sm font-semibold text-[var(--color-ink-2)] hover:text-[var(--color-blue)]">
              Full classification →
            </Link>
          }
        >
          <Reveal>
            <LatestOverall eventId={lastEvent.id} />
          </Reveal>
        </Section>
      )}

      {/* ---------- CHAMPIONSHIP SNAPSHOT ---------- */}
      <div className="bg-[var(--color-mist)]">
        <Section
          eyebrow="Championship · Top of the table"
          title="Standings"
          action={
            <Link to="/standings" className="text-sm font-semibold text-[var(--color-ink-2)] hover:text-[var(--color-blue)]">
              All standings →
            </Link>
          }
        >
          <div className="grid gap-5 lg:grid-cols-3">
            {CLASS_ORDER.map((cls, ci) => {
              const rows = standings.drivers[cls]?.slice(0, 4) ?? []
              const color = classColor(cls, classes)
              return (
                <Reveal key={cls} delay={ci * 0.08}>
                  <div className="shadow-card overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]">
                    <div className="flex items-center justify-between px-5 py-4" style={{ background: color }}>
                      <span className="font-display text-2xl font-extrabold uppercase text-black">{cls}</span>
                      <span className="font-mono text-xs font-semibold uppercase tracking-widest text-black/70">
                        Drivers
                      </span>
                    </div>
                    <ol>
                      {rows.length === 0 && (
                        <li className="px-5 py-7 text-sm text-[var(--color-muted)]">No results scored yet.</li>
                      )}
                      {rows.map((row, i) => (
                        <li key={row.key} className="flex items-center gap-3 border-b border-[var(--color-line)] px-5 py-3.5 last:border-0">
                          <span className={`tabular w-6 text-lg font-bold ${i === 0 ? 'text-[var(--color-ink)]' : 'text-[var(--color-faint)]'}`}>
                            {i + 1}
                          </span>
                          <span className="flex-1 truncate font-semibold">{row.name}</span>
                          {row.wins > 0 && <span className="tabular text-xs text-[var(--color-muted)]">{row.wins}W</span>}
                          <span className="tabular w-14 text-right text-lg font-bold">
                            <CountUp value={row.points} />
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </Section>
      </div>

      {/* ---------- SCHEDULE STRIP ---------- */}
      <Section
        eyebrow={`${roundsDone} of ${events?.length ?? 0} rounds complete`}
        title="Season Calendar"
        action={
          <Link to="/schedule" className="text-sm font-semibold text-[var(--color-ink-2)] hover:text-[var(--color-blue)]">
            Full schedule →
          </Link>
        }
      >
        <div className="-mx-6 flex snap-x gap-4 overflow-x-auto px-6 pb-4">
          {(events ?? []).map((e) => {
            const done = e.status === 'complete'
            const isNext = e.id === nextEvent?.id
            return (
              <Link
                key={e.id}
                to="/schedule"
                className={`group relative min-w-[230px] snap-start rounded-2xl border p-5 transition-all hover:-translate-y-1 ${
                  isNext
                    ? 'border-[var(--color-brand)] bg-[var(--color-cloud)] shadow-card'
                    : 'border-[var(--color-line)] bg-[var(--color-paper)] hover:shadow-card'
                } ${done ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="tabular text-xs font-semibold text-[var(--color-muted)]">ROUND {e.round}</span>
                  {isNext && <span className="rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[10px] font-bold uppercase text-black">Next</span>}
                  {done && <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-faint)]">Final</span>}
                </div>
                <div className="mt-3 font-display text-2xl font-extrabold uppercase leading-tight">{e.track?.name ?? e.name}</div>
                <div className="mt-1 text-sm text-[var(--color-muted)]">{e.track?.location}</div>
                <div className="tabular mt-4 text-sm font-medium">{fmtDate(e.date)}</div>
              </Link>
            )
          })}
        </div>
      </Section>

      <Champions />
    </>
  )
}

function NextRaceCard({ event }: { event: RaceEvent }) {
  const { data: classes } = useClasses()
  return (
    <div className="shadow-card overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <div className="flex items-center justify-between bg-[var(--color-ink)] px-5 py-3.5">
        <span className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-brand)]">
          Next Round · R{event.round}
        </span>
        <div className="flex items-center gap-3">
          {CLASS_ORDER.map((c) => (
            <span key={c} className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wider text-white/70">
              <span className="h-2 w-2 rounded-full" style={{ background: classColor(c, classes) }} />
              {c}
            </span>
          ))}
        </div>
      </div>
      <div className="p-6">
        <div className="font-mono text-xs uppercase tracking-wide text-[var(--color-muted)]">{event.track?.name}</div>
        <h2 className="mt-2 text-3xl md:text-4xl">{event.name ?? event.track?.name}</h2>
        <div className="tabular mt-2 text-sm text-[var(--color-muted)]">
          {fmtDateLong(event.date)}
          {event.duration_min ? ` · ${event.duration_min} min` : ''}
        </div>
        <div className="mt-6">
          <Countdown target={event.date} />
        </div>
      </div>
    </div>
  )
}

function LatestOverall({ eventId }: { eventId: string }) {
  const { data: results, isLoading } = useResults(eventId)
  const { data: classes } = useClasses()

  if (isLoading) return <Skeleton className="h-96 w-full" />

  const overall = (results ?? [])
    .filter((r) => r.pos !== null)
    .sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99))
    .slice(0, 6)

  return (
    <div className="shadow-card overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      {overall.map((r, i) => {
        const color = classColor(r.class_id, classes)
        return (
          <div
            key={r.id}
            className="grid grid-cols-[52px_1fr_auto_92px] items-center gap-4 border-b border-[var(--color-line)] px-5 py-4 transition-colors last:border-0 hover:bg-[var(--color-mist)]"
            style={i === 0 ? { background: 'linear-gradient(90deg, rgba(242,225,20,0.16), transparent 55%)' } : undefined}
          >
            <span className="font-display text-2xl font-extrabold text-[var(--color-ink)]">{r.pos}</span>
            <div className="min-w-0">
              <div className="truncate font-semibold">{r.drivers_text}</div>
              <div className="tabular text-xs text-[var(--color-muted)]">
                #{r.number} · {r.laps} laps
                {r.best_lap ? ` · ${r.best_lap}` : ''}
              </div>
            </div>
            <span className="hidden items-center gap-2 font-mono text-xs uppercase tracking-wider text-[var(--color-ink-2)] sm:inline-flex">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
              {r.class_id} P{r.cls_pos}
            </span>
            <span className="tabular text-right text-xl font-bold">
              <CountUp value={(r.points ?? 0) + (r.quali_points ?? 0)} />
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Champions() {
  const { data: champions } = useChampions()
  if (!champions?.length) return null

  const grouped = champions.reduce<Record<string, typeof champions>>((acc, c) => {
    const k = `${c.season_name} ${c.year}`
    ;(acc[k] ??= []).push(c)
    return acc
  }, {})

  return (
    <Section eyebrow="Heritage · Past champions" title="Hall of Champions">
      <div className="grid gap-4">
        {Object.entries(grouped).map(([label, champs], gi) => (
          <Reveal key={label} delay={gi * 0.06}>
            <div className="grid items-center gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-6 md:grid-cols-[220px_1fr]">
              <div className="font-display text-3xl font-extrabold uppercase">{label}</div>
              <div className="flex flex-wrap gap-6">
                {champs.map((c) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <ClassChip classId={c.class_id} />
                    <span className="font-semibold">{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}
