import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  useChampions,
  useClasses,
  useCurrentSeason,
  useEvents,
  useNews,
  useResults,
  useSeasonResults,
  useTeams, useLeagueSettings } from '../lib/queries'
import { computeStandings } from '../lib/standings'
import { CLASS_ORDER, classColor, eventEnded, eventStart, fmtDate, fmtDateLong, fmtTime } from '../lib/format'
import { crewNames } from '../lib/attribution'
import type { ClassId } from '../lib/types'
import { ClassChip, Section, Skeleton } from '../components/ui'
import { StatBand } from '../components/editorial'
import { CountUp, Reveal } from '../components/motion'
import Ticker from '../components/Ticker'
import HeroCarousel from '../components/HeroCarousel'
import { DriverName } from '../components/links'

/** The catalog card's full-width bottom action bar (the "Add To Cart" move). */
const ACTION_BAR =
  'flex min-h-11 items-center justify-center gap-2 border-t border-[var(--color-line)] font-body text-[11px] font-bold uppercase tracking-[0.12em] transition-colors'

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
      sorted.find((e) => e.status !== 'complete' && !eventEnded(e.date)) ??
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

      {/* ---------- PADDOCK NEWS — first thing under the hero ---------- */}
      <LeagueNews />
      {/* Join band renders near the foot of the page — see JoinTheGrid. */}

      {/* ---------- LEAGUE PULSE ---------- */}
      <Section eyebrow="The season so far" title="League pulse">
        <StatBand
          stats={[
            { label: 'Rounds Complete', value: roundsDone, to: '/results' },
            { label: 'Rounds To Go', value: (events?.length ?? 0) - roundsDone, to: '/schedule' },
            { label: 'Drivers Scored', value: driversScored, to: '/drivers' },
            { label: 'Race Starts', value: totalStarts, to: '/results' },
            { label: 'Laps Recorded', value: totalLaps, to: '/results' },
            ...(cleanRaces != null ? [{ label: 'Incident-Free Runs', value: cleanRaces, suffix: '%', to: '/standings' }] : []),
          ]}
        />
      </Section>

      {/* ---------- LATEST RESULT ---------- */}
      {lastEvent && (
        <Section
          eyebrow={`Round ${lastEvent.round} · ${lastEvent.name ?? lastEvent.track?.name}`}
          title="Latest Result"
          action={
            <Link to="/results" className="font-body text-sm font-semibold text-[var(--color-ink-2)] hover:text-[var(--color-blue)]">
              All results →
            </Link>
          }
        >
          <LatestByClass eventId={lastEvent.id} />
        </Section>
      )}

      {/* ---------- CHAMPIONSHIP SNAPSHOT — black feature panels ---------- */}
      <div className="bg-[var(--color-cloud)]">
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
                <Reveal key={cls} delay={ci * 0.08} className="h-full">
                  <div className="on-navy flex h-full flex-col overflow-hidden rounded-xl bg-[var(--color-deep)] shadow-card transition-transform hover:-translate-y-0.5">
                    <Link to="/standings" className="flex min-h-11 items-center justify-between border-b border-[var(--color-line)] px-5 py-4 transition-colors hover:bg-[var(--color-deep-2)]">
                      <span className="font-display text-3xl leading-none">{cls}</span>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
                    </Link>
                    <ol className="flex-1">
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
                    <Link
                      to="/standings"
                      className={`${ACTION_BAR} bg-[var(--color-cloud)] text-[var(--color-ink)] hover:bg-[var(--color-brand)] hover:text-black`}
                    >
                      Full standings <span aria-hidden>→</span>
                    </Link>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </Section>
      </div>

      {/* ---------- SCHEDULE STRIP — round cards with action bars ---------- */}
      <Section
        eyebrow={`${roundsDone} of ${events?.length ?? 0} rounds complete`}
        title="Season Calendar"
        action={
          <Link to="/schedule" className="font-body text-sm font-semibold text-[var(--color-ink-2)] hover:text-[var(--color-blue)]">
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
                className={`group flex w-max min-w-[240px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border transition-all hover:-translate-y-0.5 hover:shadow-card ${
                  isNext
                    ? 'border-[var(--color-brand)] bg-[var(--color-paper)] shadow-card'
                    : done
                      ? 'border-[var(--color-line)] bg-[var(--color-cloud)]'
                      : 'border-[var(--color-line)] bg-[var(--color-paper)]'
                }`}
              >
                <div className="flex-1 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Round {e.round}</span>
                    {isNext && <span className="rounded-full bg-[var(--color-brand)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-black">Next</span>}
                    {done && <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">Final</span>}
                  </div>
                  <div className="mt-3 whitespace-nowrap font-display text-2xl leading-tight">{e.track?.name ?? e.name}</div>
                  <div className="mt-1 font-body text-sm text-[var(--color-muted)]">{e.track?.location}</div>
                  <div className="tabular mt-4 text-sm font-medium">{fmtDate(eventStart(e))}</div>
                  <div className="tabular mt-0.5 text-xs text-[var(--color-muted)]">{fmtTime(eventStart(e))}</div>
                </div>
                <div
                  className={`${ACTION_BAR} ${
                    isNext
                      ? 'bg-[var(--color-brand)] text-black'
                      : 'bg-[var(--color-mist)] text-[var(--color-ink)] group-hover:bg-[var(--color-deep)] group-hover:text-white'
                  }`}
                >
                  Race details <span aria-hidden>→</span>
                </div>
              </Link>
            )
          })}
        </div>
      </Section>

      <Champions />
      <JoinTheGrid />

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
          <Reveal key={cls} delay={ci * 0.08} className="h-full">
            <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] transition-transform hover:-translate-y-0.5">
              {/* Black class-header bar — the catalog's product-tile label */}
              <Link to="/results" className="on-navy flex min-h-11 items-center justify-between bg-[var(--color-deep)] px-5 py-4 transition-colors hover:bg-[var(--color-deep-2)]">
                <span className="font-display text-2xl leading-none text-[var(--color-ink)]">{cls}</span>
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Result</span>
                </span>
              </Link>
              <ol className="flex-1">
                {rows.length === 0 && (
                  <li className="px-5 py-7 font-body text-sm text-[var(--color-muted)]">No result scored.</li>
                )}
                {rows.map((r, i) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 border-b border-[var(--color-line)] px-5 py-3.5 last:border-0"
                    style={i === 0 ? { background: tint(color, 0.14) } : undefined}
                  >
                    <span className={`tabular w-6 text-lg font-bold ${i === 0 ? 'text-[var(--color-ink)]' : 'text-[var(--color-faint)]'}`}>{r.cls_pos}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-body font-semibold"><DriverName text={r.drivers_text} /></div>
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
              <Link
                to="/results"
                className={`${ACTION_BAR} bg-[var(--color-mist)] text-[var(--color-ink)] hover:bg-[var(--color-deep)] hover:text-white`}
              >
                Full classification <span aria-hidden>→</span>
              </Link>
            </div>
          </Reveal>
        )
      })}
    </div>
  )
}

/**
 * THE ONE THING THE HOME PAGE WAS NOT ASKING FOR.
 *
 * The Discord invite existed only in the footer and the burger menu — findable if you
 * already knew to look, invisible if you did not. Every other route into this league
 * runs through the server: the attendance buttons, race control, the suggestion box.
 * A visitor who reads the standings and leaves is a visitor the league never hears
 * from again.
 *
 * Placed after the season content rather than above it, deliberately: somebody who
 * has just read the championship tables is a warmer ask than somebody who has just
 * arrived, and a join banner at the top of a results site reads as an ad.
 *
 * Renders nothing at all when no invite is configured, rather than a dead button.
 */
function JoinTheGrid() {
  const { data: settings } = useLeagueSettings()
  const invite = settings?.discord_url?.trim()
  if (!invite) return null

  return (
    <div className="on-navy bg-[var(--color-deep)]">
      <Section eyebrow="Get on the grid" title="Race with us">
        <div className="grid items-center gap-7 md:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="max-w-prose text-lg text-[var(--color-muted)]">
              Three classes, one grid, Saturday nights. Practice opens at 7pm ET and you are done
              by nine. Everything happens in the Discord — race control, attendance, and the people
              you will be racing.
            </p>
            <p className="mt-3 max-w-prose font-body text-sm text-[var(--color-faint)]">
              Already signed up? Sign in with the same Discord account and your results, licence
              and entry all live on one profile.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <a
              href={invite}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center justify-center gap-2.5 rounded-xl bg-[#5865f2] px-7 py-3.5 font-alt text-sm font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-0.5"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19.3 5.4A17.6 17.6 0 0015 4l-.2.5c1.6.4 2.9 1 4.1 1.9A13.9 13.9 0 003 6.4 16 16 0 019.2 4.5L9 4a17.6 17.6 0 00-4.3 1.4C2 9.5 1.3 13.5 1.6 17.4a17.7 17.7 0 005.4 2.7l1.1-1.7c-.6-.2-1.2-.5-1.7-.9l.4-.3a12.6 12.6 0 0010.4 0l.4.3c-.5.4-1.1.7-1.7.9l1.1 1.7a17.7 17.7 0 005.4-2.7c.4-4.5-.6-8.5-2.9-12zM8.6 15c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1S9.6 15 8.6 15zm6.8 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1z" />
              </svg>
              Join the Discord
            </a>
            <Link to="/signup" className="hcr-btn hcr-btn-ghost w-full justify-center">
              How it works →
            </Link>
          </div>
        </div>
      </Section>
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
            <div className="grid items-center gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-6 md:grid-cols-[220px_1fr]">
              <div className="font-display text-3xl">{label}</div>
              <div className="flex flex-wrap gap-6">
                {champs.map((c) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <ClassChip classId={c.class_id} />
                    <DriverName text={c.label} className="font-body font-semibold" />
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

/** News strip — up to three published articles. Hidden entirely until it has
 * something real to show (no skeletons on the homepage for optional content). */
function LeagueNews() {
  const { data: news, isLoading, isError } = useNews(3)
  if (isLoading || isError || !news?.length) return null

  return (
    <div className="bg-[var(--color-cloud)]">
      <Section
        eyebrow="From the pit wall"
        title="News"
        action={
          <Link to="/news" className="font-body text-sm font-semibold text-[var(--color-ink-2)] hover:text-[var(--color-blue)]">
            All news →
          </Link>
        }
      >
        <div className="grid gap-5 md:grid-cols-3">
          {news.slice(0, 3).map((a, i) => (
            <Reveal key={a.id} delay={i * 0.06} className="h-full">
              <Link
                to="/news"
                className="group flex h-full flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] transition-transform hover:-translate-y-0.5 hover:shadow-card"
              >
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-center justify-between gap-3">
                    {a.category && (
                      <span className="inline-flex items-center rounded-full border border-[var(--color-line-2)] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-2)]">
                        {a.category}
                      </span>
                    )}
                    {a.pinned && (
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand-deep)]">
                        Pinned
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 text-2xl leading-tight">{a.title}</h3>
                  {a.dek && <p className="mt-2 line-clamp-3 font-body text-sm text-[var(--color-muted)]">{a.dek}</p>}
                  <div className="tabular mt-auto pt-4 text-xs text-[var(--color-faint)]">{fmtDateLong(a.published_at)}</div>
                </div>
                <div
                  className={`${ACTION_BAR} bg-[var(--color-mist)] text-[var(--color-ink)] group-hover:bg-[var(--color-deep)] group-hover:text-white group-focus-visible:bg-[var(--color-deep)] group-focus-visible:text-white`}
                >
                  Read the story <span aria-hidden>→</span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </Section>
    </div>
  )
}
