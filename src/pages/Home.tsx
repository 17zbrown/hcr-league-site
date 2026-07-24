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
import { CLASS_ORDER, classColor, eventEnded, fmtDate } from '../lib/format'
import { crewNames } from '../lib/attribution'
import type { ClassId } from '../lib/types'
import { ClassChip, Section, Skeleton } from '../components/ui'
import { StatBand } from '../components/editorial'
import { CountUp, Reveal } from '../components/motion'
import Ticker from '../components/Ticker'
import HeroCarousel from '../components/HeroCarousel'
import { DriverName } from '../components/links'

export default function Home() {
  const { data: season } = useCurrentSeason()
  const { data: events } = useEvents(season?.id)
  const { data: classes } = useClasses()
  const { data: teams } = useTeams()
  const { data: seasonResults } = useSeasonResults(season?.id)

  const { nextEvent, lastEvent, roundsDone } = useMemo(() => {
    if (!events?.length) return { nextEvent: undefined, lastEvent: undefined, roundsDone: 0 }
    const sorted = [...events].sort((a, b) => a.round - b.round)
    const complete = sorted.filter((e) => e.status === 'complete')
    const next =
      sorted.find((e) => e.status === 'next') ??
      sorted.find((e) => !eventEnded(e.date)) ??
      sorted.find((e) => e.status !== 'complete')
    return { nextEvent: next, lastEvent: complete[complete.length - 1], roundsDone: complete.length }
  }, [events])

  const standings = useMemo(
    () => computeStandings(seasonResults ?? [], teams ?? []),
    [seasonResults, teams],
  )

  // League pulse — real season totals from the imported results.
  const { driversScored, totalStarts, totalLaps, cleanRaces } = useMemo(() => {
    const rows = seasonResults ?? []
    const names = new Set(rows.flatMap((r) => crewNames(r.drivers_text)))
    const scored = rows.filter((r) => r.inc != null)
    return {
      driversScored: names.size,
      totalStarts: rows.length,
      totalLaps: rows.reduce((s, r) => s + (r.laps ?? 0), 0),
      // share of entries that finished a race without a single incident point
      cleanRaces: scored.length ? Math.round((scored.filter((r) => (r.inc ?? 0) === 0).length / scored.length) * 100) : null,
    }
  }, [seasonResults])

  return (
    <>
      <HeroCarousel />
      <Ticker />

      {/* ---------- LATEST RESULT ---------- */}
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
          <LatestByClass eventId={lastEvent.id} />
        </Section>
      )}

      {/* ---------- LEAGUE PULSE ---------- */}
      <Section eyebrow="The season so far" title="League pulse">
        <StatBand
          stats={[
            { label: 'Rounds Complete', value: roundsDone },
            { label: 'Rounds To Go', value: (events?.length ?? 0) - roundsDone },
            { label: 'Drivers Scored', value: driversScored },
            { label: 'Race Starts', value: totalStarts },
            { label: 'Laps Recorded', value: totalLaps },
            ...(cleanRaces != null ? [{ label: 'Incident-Free Runs', value: cleanRaces, suffix: '%' }] : []),
          ]}
        />
      </Section>

      {/* ---------- CHAMPIONSHIP SNAPSHOT ---------- */}
      <div className="bg-[var(--color-mist)]/60">
        <Section
          eyebrow="Championship · Top of the table"
          title="Standings"
          action={
            <Link to="/standings" className="font-body text-sm font-semibold text-[var(--color-ink-2)] hover:text-[var(--color-blue)]">
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
                  <div className="on-navy overflow-hidden rounded-2xl bg-[var(--color-deep)] shadow-card">
                    <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: `${color}55` }}>
                      <span className="font-display text-3xl leading-none">{cls}</span>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                    </div>
                    <ol>
                      {rows.length === 0 && <li className="px-5 py-7 font-body text-sm text-[var(--color-muted)]">No results scored yet.</li>}
                      {rows.map((row, i) => (
                        <li key={row.key} className="flex items-center gap-3 border-b border-[var(--color-line)] px-5 py-3.5 last:border-0">
                          <span className={`font-display w-7 text-2xl leading-none ${i === 0 ? 'text-[var(--color-brand)]' : 'text-[var(--color-faint)]'}`}>{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate font-body font-semibold"><DriverName text={row.name} /></span>
                          {row.wins > 0 && <span className="tabular text-xs text-[var(--color-muted)]">{row.wins}W</span>}
                          <span className="w-16 text-right font-display text-2xl leading-none"><CountUp value={row.points} /></span>
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
                to={`/schedule/${e.id}`}
                className={`group relative w-max min-w-[230px] shrink-0 snap-start rounded-2xl border p-5 transition-all hover:-translate-y-1 ${
                  isNext ? 'border-[var(--color-brand)] bg-[var(--color-cloud)] shadow-card' : 'border-[var(--color-line)] bg-[var(--color-paper)] hover:shadow-card'
                } ${done ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="tabular text-xs font-semibold text-[var(--color-muted)]">ROUND {e.round}</span>
                  {isNext && <span className="rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[10px] font-bold uppercase text-black">Next</span>}
                  {done && <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-faint)]">Final</span>}
                </div>
                <div className="mt-3 whitespace-nowrap font-display text-2xl leading-tight">{e.track?.name ?? e.name}</div>
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

/** Convert a #rrggbb hex to an rgba() string at the given alpha. */
function tint(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function LatestByClass({ eventId }: { eventId: string }) {
  const { data: results, isLoading } = useResults(eventId)
  const { data: classes } = useClasses()

  if (isLoading) {
    return (
      <div className="grid gap-5 lg:grid-cols-3">
        {CLASS_ORDER.map((c) => (
          <Skeleton key={c} className="h-72 w-full" />
        ))}
      </div>
    )
  }

  const byClass = (cls: ClassId) =>
    (results ?? [])
      .filter((r) => r.class_id === cls && r.cls_pos !== null)
      .sort((a, b) => (a.cls_pos ?? 99) - (b.cls_pos ?? 99))
      .slice(0, 5)

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {CLASS_ORDER.map((cls, ci) => {
        const rows = byClass(cls)
        const color = classColor(cls, classes)
        return (
          <Reveal key={cls} delay={ci * 0.08}>
            <div className="shadow-card overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]">
              <div className="flex items-center justify-between px-5 py-4" style={{ background: color }}>
                <span className="font-display text-2xl text-black">{cls}</span>
                <span className="font-mono text-xs font-semibold uppercase tracking-widest text-black/70">Result</span>
              </div>
              <ol>
                {rows.length === 0 && (
                  <li className="px-5 py-7 text-sm text-[var(--color-muted)]">No result scored.</li>
                )}
                {rows.map((r, i) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 border-b border-[var(--color-line)] px-5 py-3.5 last:border-0"
                    style={i === 0 ? { background: `linear-gradient(90deg, ${tint(color, 0.16)}, transparent 60%)` } : undefined}
                  >
                    <span className={`tabular w-6 text-lg font-bold ${i === 0 ? 'text-[var(--color-ink)]' : 'text-[var(--color-faint)]'}`}>{r.cls_pos}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold"><DriverName text={r.drivers_text} /></div>
                      <div className="tabular text-xs text-[var(--color-muted)]">
                        #{r.number} · {r.laps} laps
                      </div>
                    </div>
                    <span className="tabular w-12 text-right text-lg font-bold">
                      <CountUp value={(r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)} />
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
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
              <div className="font-display text-3xl">{label}</div>
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
