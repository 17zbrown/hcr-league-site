import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  useChampions,
  useCurrentSeason,
  useEvents,
  useResults,
  useSeasonResults,
  useTeams,
} from '../lib/queries'
import { computeStandings } from '../lib/standings'
import { CLASS_ORDER, classColor, fmtDate, fmtDateLong } from '../lib/format'
import { useClasses } from '../lib/queries'
import type { RaceEvent } from '../lib/types'
import Countdown from '../components/Countdown'
import { ClassChip, Section, Skeleton } from '../components/ui'

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
    const last = complete[complete.length - 1]
    return { nextEvent: next, lastEvent: last, roundsDone: complete.length }
  }, [events])

  const standings = useMemo(
    () => computeStandings(seasonResults ?? [], teams ?? []),
    [seasonResults, teams],
  )

  return (
    <>
      {/* ---------- HERO: the next race ---------- */}
      <section className="relative overflow-hidden border-b border-[var(--color-line)]">
        <div className="hatch pointer-events-none absolute -right-24 top-0 h-full w-1/2 opacity-60" />
        <div className="container-hcr relative grid gap-10 py-16 md:grid-cols-[1.1fr_0.9fr] md:py-24">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <div className="eyebrow mb-4">
              {season?.name ?? '2026 Season'} · {season?.points_system ?? 'Endurance'}
            </div>
            <h1 className="text-6xl leading-[0.9] sm:text-7xl md:text-8xl">
              Race like it's
              <br />
              <span className="text-[var(--color-brand)]">real.</span>
            </h1>
            <p className="mt-6 max-w-md text-lg text-[var(--color-muted)]">
              A three-class iRacing endurance championship. GTP, LMP2, and GTD share the
              track and fight for three titles. Broadcast-grade timing, real race control,
              no arcade shortcuts.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/signup"
                className="bg-[var(--color-brand)] px-6 py-3 font-display text-xl uppercase tracking-wide text-black transition-transform hover:-translate-y-0.5"
              >
                Join the Grid
              </Link>
              <Link
                to="/standings"
                className="border border-[var(--color-line-2)] px-6 py-3 font-display text-xl uppercase tracking-wide transition-colors hover:border-[var(--color-brand)]"
              >
                Championship
              </Link>
            </div>
          </motion.div>

          {/* Next race feature card */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12, ease: 'easeOut' }}
          >
            {evLoading || !nextEvent ? (
              <Skeleton className="h-80 w-full" />
            ) : (
              <NextRaceCard event={nextEvent} />
            )}
          </motion.div>
        </div>
      </section>

      {/* ---------- LAST RACE PODIUMS ---------- */}
      {lastEvent && (
        <Section
          eyebrow={`Round ${lastEvent.round} · Latest result`}
          title={lastEvent.name ?? lastEvent.track?.name ?? 'Last race'}
          action={
            <Link to="/results" className="eyebrow hover:text-[var(--color-brand)]">
              Full results →
            </Link>
          }
        >
          <LastRacePodiums eventId={lastEvent.id} />
        </Section>
      )}

      {/* ---------- CHAMPIONSHIP SNAPSHOT ---------- */}
      <div className="border-y border-[var(--color-line)] bg-[var(--color-ink-2)]">
        <Section
          eyebrow="Championship · Top of the table"
          title="Standings"
          action={
            <Link to="/standings" className="eyebrow hover:text-[var(--color-brand)]">
              All standings →
            </Link>
          }
        >
          <div className="grid gap-6 lg:grid-cols-3">
            {CLASS_ORDER.map((cls) => {
              const rows = standings.drivers[cls]?.slice(0, 4) ?? []
              const color = classColor(cls, classes)
              return (
                <div key={cls} className="border border-[var(--color-line)] bg-[var(--color-ink)]">
                  <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
                    <span className="font-display text-2xl uppercase" style={{ color }}>
                      {cls}
                    </span>
                    <span className="h-2 w-16" style={{ background: color }} />
                  </div>
                  <ol className="divide-y divide-[var(--color-line)]">
                    {rows.length === 0 && (
                      <li className="px-4 py-6 text-sm text-[var(--color-muted)]">
                        No results scored yet.
                      </li>
                    )}
                    {rows.map((row, i) => (
                      <li key={row.key} className="flex items-center gap-3 px-4 py-3">
                        <span className="tabular w-6 text-lg font-bold" style={{ color: i === 0 ? color : undefined }}>
                          {i + 1}
                        </span>
                        <span className="flex-1 truncate font-medium">{row.name}</span>
                        {row.wins > 0 && (
                          <span className="tabular text-xs text-[var(--color-muted)]">{row.wins}W</span>
                        )}
                        <span className="tabular w-14 text-right text-lg font-bold">{row.points}</span>
                      </li>
                    ))}
                  </ol>
                </div>
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
          <Link to="/schedule" className="eyebrow hover:text-[var(--color-brand)]">
            Full schedule →
          </Link>
        }
      >
        <div className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-4">
          {(events ?? []).map((e) => {
            const done = e.status === 'complete'
            const isNext = e.id === nextEvent?.id
            return (
              <Link
                key={e.id}
                to="/schedule"
                className={`group relative min-w-[220px] snap-start border p-4 transition-colors ${
                  isNext ? 'border-[var(--color-brand)]' : 'border-[var(--color-line)] hover:border-[var(--color-line-2)]'
                } ${done ? 'opacity-55' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="tabular text-xs text-[var(--color-muted)]">R{e.round}</span>
                  {isNext && <span className="eyebrow text-[var(--color-brand)]">Next</span>}
                  {done && <span className="eyebrow">Final</span>}
                </div>
                <div className="mt-3 font-display text-2xl leading-tight">{e.track?.name ?? e.name}</div>
                <div className="mt-1 text-sm text-[var(--color-muted)]">{e.track?.location}</div>
                <div className="tabular mt-3 text-sm">{fmtDate(e.date)}</div>
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
  return (
    <div className="border border-[var(--color-line-2)] bg-[var(--color-ink-2)]">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-ink-3)] px-5 py-3">
        <span className="eyebrow text-[var(--color-brand)]">Next Race · Round {event.round}</span>
        <div className="flex gap-1.5">
          {CLASS_ORDER.map((c) => (
            <ClassChip key={c} classId={c} />
          ))}
        </div>
      </div>
      <div className="p-5">
        <h2 className="text-4xl md:text-5xl">{event.name ?? event.track?.name}</h2>
        <div className="mt-1 text-[var(--color-muted)]">
          {event.track?.name}
          {event.track?.location ? ` · ${event.track.location}` : ''}
        </div>

        <div className="tabular mt-5 flex items-center gap-4 text-sm">
          <span>{fmtDateLong(event.date)}</span>
          {event.duration_min && <span className="text-[var(--color-muted)]">{event.duration_min} min</span>}
        </div>

        <div className="mt-5">
          <Countdown target={event.date} />
        </div>
      </div>
    </div>
  )
}

function LastRacePodiums({ eventId }: { eventId: string }) {
  const { data: results, isLoading } = useResults(eventId)
  const { data: classes } = useClasses()

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        {CLASS_ORDER.map((c) => (
          <Skeleton key={c} className="h-52 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {CLASS_ORDER.map((cls) => {
        const color = classColor(cls, classes)
        const podium = (results ?? [])
          .filter((r) => r.class_id === cls && r.cls_pos !== null)
          .sort((a, b) => (a.cls_pos ?? 99) - (b.cls_pos ?? 99))
          .slice(0, 3)
        return (
          <div key={cls} className="border border-[var(--color-line)] bg-[var(--color-ink-2)]">
            <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
              <span className="h-3 w-3" style={{ background: color }} />
              <span className="font-display text-2xl uppercase">{cls}</span>
            </div>
            <ol>
              {podium.length === 0 && (
                <li className="px-4 py-6 text-sm text-[var(--color-muted)]">No classified cars.</li>
              )}
              {podium.map((r) => (
                <li key={r.id} className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-3 last:border-0">
                  <span
                    className="tabular flex h-8 w-8 items-center justify-center text-sm font-bold"
                    style={{ background: r.cls_pos === 1 ? color : 'var(--color-ink-3)', color: r.cls_pos === 1 ? '#000' : undefined }}
                  >
                    {r.cls_pos}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.drivers_text}</div>
                    <div className="tabular text-xs text-[var(--color-muted)]">
                      #{r.number} · {r.laps} laps
                    </div>
                  </div>
                  <span className="tabular text-lg font-bold">{(r.points ?? 0) + (r.quali_points ?? 0)}</span>
                </li>
              ))}
            </ol>
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
    <div className="border-t border-[var(--color-line)] bg-[var(--color-ink-2)]">
      <Section eyebrow="Heritage · Past champions" title="Hall of Champions">
        <div className="grid gap-4">
          {Object.entries(grouped).map(([label, champs]) => (
            <div key={label} className="grid items-center gap-4 border border-[var(--color-line)] p-5 md:grid-cols-[200px_1fr]">
              <div className="font-display text-3xl">{label}</div>
              <div className="flex flex-wrap gap-6">
                {champs.map((c) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <ClassChip classId={c.class_id} />
                    <span className="font-medium">{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
