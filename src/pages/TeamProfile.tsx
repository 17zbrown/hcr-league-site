import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useClasses, useCurrentSeason, useDrivers, useSeasonResultsFull, useTeams } from '../lib/queries'
import { buildDriverReport, type FullRow } from '../lib/driverReport'
import { normalizeName, resultListsDriver, splitCrew } from '../lib/attribution'
import { classColor } from '../lib/format'
import { Skeleton } from '../components/ui'
import { AnimatedStat, MeterRow, StatBand } from '../components/editorial'
import { Reveal } from '../components/motion'
import { ResultsTable } from '../components/DriverReport'
import type { Driver } from '../lib/types'

export default function TeamProfile() {
  const { id } = useParams()
  const { data: teams, isLoading } = useTeams()
  const { data: drivers } = useDrivers()
  const { data: classes } = useClasses()
  const { data: season, isLoading: seasonLoading } = useCurrentSeason()
  const { data: results, isLoading: resultsLoading } = useSeasonResultsFull(season?.id)

  const team = teams?.find((t) => t.id === id)

  // Roster = drivers registered to this team, PLUS anyone who actually raced for
  // it (from results), matched to their profile so they stay clickable. Names
  // without a profile still show, just not as a link.
  const roster = useMemo(() => {
    const out: { key: string; driver?: Driver; name: string }[] = []
    const seen = new Set<string>()
    for (const d of drivers ?? []) {
      if (d.team_id === id) {
        out.push({ key: d.id, driver: d, name: d.name })
        seen.add(d.id)
      }
    }
    const racedNames = Array.from(
      new Set((results ?? []).filter((r) => r.team_id === id).map((r) => (r.drivers_text ?? '').trim()).filter(Boolean)),
    )
    for (const nm of racedNames) {
      // Endurance entries list a whole crew ("A. Smith / B. Jones") — split it and
      // credit each individual, matched to their profile where one exists.
      for (const segment of splitCrew(nm)) {
        const match = (drivers ?? []).find((d) => resultListsDriver(segment, d.name))
        if (match) {
          if (!seen.has(match.id)) {
            out.push({ key: match.id, driver: match, name: match.name })
            seen.add(match.id)
          }
        } else {
          const k = 'name:' + normalizeName(segment)
          if (!seen.has(k)) {
            out.push({ key: k, name: segment })
            seen.add(k)
          }
        }
      }
    }
    return out
  }, [drivers, results, id])

  const rows = useMemo<FullRow[]>(() => {
    if (!results) return []
    return (results as FullRow[])
      .filter((r) => r.team_id === id)
      .sort((a, b) => (a.event?.round ?? 0) - (b.event?.round ?? 0))
  }, [results, id])

  const report = useMemo(() => buildDriverReport(rows, (results ?? []) as FullRow[]), [rows, results])

  if (isLoading) {
    return <div className="container-hcr py-16"><Skeleton className="h-96 w-full" /></div>
  }
  if (!team) {
    return (
      <div className="container-hcr flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="text-5xl">Team not found</h1>
        <Link to="/teams" className="mt-6 text-[var(--color-blue)]">← All teams</Link>
      </div>
    )
  }

  const color = classColor(team.class_id, classes)
  const raced = report.starts > 0
  const resultsPending = seasonLoading || resultsLoading

  return (
    <div className="container-hcr py-10 md:py-14">
      <Link to="/teams" className="mb-6 inline-block font-body text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)]">
        ← Teams
      </Link>

      {/* ---------- Feature header: black feature panel (on-navy inverts tokens) ---------- */}
      <section className="on-navy relative overflow-hidden rounded-3xl bg-[var(--color-deep)]">
        <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(58% 70% at 88% 0%, ${color}22, transparent 62%)` }}
        />
        <div className="relative grid gap-8 p-7 md:grid-cols-[auto_1fr] md:items-center md:p-10">
          <div
            className="tabular flex h-24 w-28 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-deep-2)] font-display text-5xl text-[var(--color-ink)]"
            style={{ borderBottom: `4px solid ${color}` }}
          >
            {team.number}
          </div>

          <div className="min-w-0">
            <h1 className="text-5xl leading-[1.02] md:text-7xl">{team.name}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="inline-flex items-center gap-2 font-body text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                {team.class_id}
              </span>
              {team.car && (
                <span className="font-body font-semibold text-[var(--color-ink)]">{team.car}</span>
              )}
              <span className="font-body text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                {roster.length === 1 ? '1 driver' : `${roster.length} drivers`}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Roster ---------- */}
      <section className="mt-10">
        <h2 className="text-3xl">Roster</h2>
        <p className="mt-2 max-w-prose font-body text-[var(--color-muted)]">
          Everyone registered to the No. {team.number} entry, plus any driver who has taken a start for it this season.
        </p>
        {roster.length === 0 ? (
          <div className="mt-5 rounded-2xl bg-[var(--color-cloud)] p-10 text-center">
            <p className="font-display text-2xl">No drivers signed yet</p>
            <p className="mx-auto mt-2 max-w-md font-body text-sm text-[var(--color-muted)]">
              When a driver registers with {team.name} — or a result is imported for the No. {team.number} car —
              they take their place here automatically.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roster.map((m, i) => (
              <Reveal key={m.key} delay={i * 0.04}>
                {m.driver ? (
                  <Link
                    to={`/drivers/${m.driver.id}`}
                    className="group flex min-h-[68px] items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4 transition-all hover:-translate-y-0.5 hover:shadow-card"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-display text-2xl leading-tight">{m.driver.name}</div>
                      <div className="mt-0.5 font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                        {m.driver.country ? `${m.driver.country} · Driver profile` : 'Driver profile'}
                      </div>
                    </div>
                    <span
                      className="ml-auto shrink-0 text-[var(--color-faint)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--color-ink)]"
                      aria-hidden
                    >
                      →
                    </span>
                  </Link>
                ) : (
                  <div className="flex min-h-[68px] items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
                    <div className="min-w-0">
                      <div className="truncate font-display text-2xl leading-tight">{m.name}</div>
                      <div className="mt-0.5 font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                        Raced for the team
                      </div>
                    </div>
                  </div>
                )}
              </Reveal>
            ))}
          </div>
        )}
      </section>

      {resultsPending ? (
        <div className="mt-10 space-y-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : !raced ? (
        <div className="mt-10 rounded-2xl bg-[var(--color-cloud)] p-10 text-center">
          <p className="font-display text-2xl">No scored results yet</p>
          <p className="mx-auto mt-2 max-w-md font-body text-sm text-[var(--color-muted)]">
            The {team.name} team report — points, strike rates and round-by-round form — builds itself
            the moment their first result is imported.
          </p>
        </div>
      ) : (
        <>
          {/* ---------- Headline stats ---------- */}
          <div className="mt-10">
            <StatBand
              stats={[
                { label: 'Championship Points', value: report.points },
                { label: 'Starts', value: report.starts },
                { label: 'Wins', value: report.wins },
                { label: 'Podiums', value: report.podiums },
                { label: 'Poles', value: report.poles },
                { label: 'Best Finish', value: report.bestFinish, prefix: 'P' },
              ]}
            />
          </div>

          {/* ---------- Report body ---------- */}
          <div className="mt-10 grid gap-10 lg:grid-cols-[1.55fr_1fr]">
            <div className="space-y-10">
              {/* Season form */}
              <section>
                <h2 className="text-3xl">Season form</h2>
                <p className="mt-2 max-w-prose font-body text-[var(--color-muted)]">
                  Every round the No. {team.number} car has started this season, in order — class finish,
                  places made up on the road, and points banked.
                </p>
                <ol className="mt-5 flex flex-wrap gap-2.5">
                  {report.form.map((f, i) => {
                    const win = f.clsPos === 1
                    const pod = f.clsPos != null && f.clsPos <= 3
                    return (
                      <li
                        key={`${f.round}-${i}`}
                        title={`${f.label} — ${f.dnf ? 'DNF' : f.clsPos != null ? `P${f.clsPos}` : '—'} · ${f.points} pts`}
                        className="group relative min-w-[92px] flex-1 rounded-2xl border p-4 transition-transform hover:-translate-y-0.5"
                        style={{
                          borderColor: win ? color : 'var(--color-line)',
                          background: win ? `${color}1a` : 'var(--color-paper)',
                        }}
                      >
                        <div className="font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                          R{f.round}
                        </div>
                        <div className="mt-1 font-display text-3xl leading-none">
                          {f.dnf ? <span className="text-[var(--color-red)]">DNF</span> : f.clsPos != null ? `P${f.clsPos}` : '—'}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px]">
                          {f.gained != null && f.gained !== 0 && (
                            <span className={f.gained > 0 ? 'text-[var(--color-green)]' : 'text-[var(--color-red)]'}>
                              {f.gained > 0 ? `▲${f.gained}` : `▼${-f.gained}`}
                            </span>
                          )}
                          <span className="text-[var(--color-faint)]">{f.points}</span>
                        </div>
                        {pod && !win && <span className="absolute right-3 top-3 h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
                      </li>
                    )
                  })}
                </ol>
              </section>

              {/* Race craft */}
              <section>
                <h2 className="text-3xl">Race craft</h2>
                <div className="mt-5">
                  <StatBand
                    columns={4}
                    stats={[
                      { label: 'Avg Finish', value: report.avgFinish, decimals: 1, prefix: 'P' },
                      {
                        label: 'Places Gained',
                        value: report.placesGained,
                        prefix: (report.placesGained ?? 0) > 0 ? '+' : '',
                        hint: 'Grid to flag, all season',
                      },
                      { label: 'Laps Completed', value: report.totalLaps },
                      { label: 'Retirements', value: report.dnfs },
                    ]}
                  />
                </div>
              </section>

              {/* Results table */}
              <ResultsTable rows={rows} classes={classes} emptyLabel={`No scored results yet for ${team.name}.`} />
            </div>

            {/* ---------- Sidebar ---------- */}
            <aside className="space-y-6">
              <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
                <h3 className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                  Strike rate
                </h3>
                <div className="mt-3 divide-y divide-[var(--color-line)]">
                  <MeterRow label="Wins" value={report.winRate} color={color} />
                  <MeterRow label="Podiums" value={report.podiumRate} color={color} />
                  <MeterRow label="Races finished" value={report.finishRate} color="var(--color-green)" />
                  <MeterRow label="Consistency" value={report.consistency} color="var(--color-blue)" />
                </div>
                <p className="mt-4 font-body text-xs leading-relaxed text-[var(--color-faint)]">
                  Consistency scores how tightly the team&rsquo;s finishing positions cluster — an entry that
                  always lands in the same window scores higher than one that mixes wins with retirements.
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-6">
                <h3 className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                  At a glance
                </h3>
                <ul className="mt-3 space-y-2 font-body text-sm text-[var(--color-ink-2)]">
                  <li>
                    Best result <strong className="font-display text-xl">
                      <AnimatedStat value={report.bestFinish} prefix="P" />
                    </strong>
                    {report.worstFinish != null && report.worstFinish !== report.bestFinish && (
                      <>, worst <strong className="font-display text-xl">P{report.worstFinish}</strong></>
                    )}
                  </li>
                  <li>
                    Top fives <strong className="font-display text-xl"><AnimatedStat value={report.top5} /></strong> from{' '}
                    <strong className="font-display text-xl"><AnimatedStat value={report.starts} /></strong> starts
                  </li>
                  {report.incidents != null && (
                    <li>
                      <strong className="font-display text-xl"><AnimatedStat value={report.incidents} /></strong> incident
                      points across the season
                    </li>
                  )}
                </ul>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  )
}
