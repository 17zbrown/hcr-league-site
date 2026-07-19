import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useClasses, useCurrentSeason, useDrivers, useSeasonResultsFull, useTeams } from '../lib/queries'
import { computeEntityStats } from '../lib/profileStats'
import { resultListsDriver } from '../lib/attribution'
import { classColor } from '../lib/format'
import { Skeleton } from '../components/ui'
import { Reveal } from '../components/motion'
import { StatRow, ResultsTable } from './DriverProfile'
import type { Driver, RaceResult } from '../lib/types'

export default function TeamProfile() {
  const { id } = useParams()
  const { data: teams, isLoading } = useTeams()
  const { data: drivers } = useDrivers()
  const { data: classes } = useClasses()
  const { data: season } = useCurrentSeason()
  const { data: results } = useSeasonResultsFull(season?.id)

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
      const match = (drivers ?? []).find((d) => resultListsDriver(nm, d.name))
      if (match) {
        if (!seen.has(match.id)) {
          out.push({ key: match.id, driver: match, name: match.name })
          seen.add(match.id)
        }
      } else {
        const k = 'name:' + nm.toLowerCase()
        if (!seen.has(k)) {
          out.push({ key: k, name: nm })
          seen.add(k)
        }
      }
    }
    return out
  }, [drivers, results, id])
  const rows = useMemo(() => {
    if (!results) return []
    return results
      .filter((r) => r.team_id === id)
      .sort((a, b) => (a.event?.round ?? 0) - (b.event?.round ?? 0))
  }, [results, id])

  const stats = useMemo(() => computeEntityStats(rows as RaceResult[]), [rows])

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

  return (
    <div className="container-hcr py-12 md:py-16">
      <Link to="/teams" className="mb-6 inline-block text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)]">
        ← Teams
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-[var(--color-line)] pb-8">
        <div className="flex items-center gap-5">
          <div
            className="tabular flex h-20 w-24 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-ink)] font-display text-4xl font-extrabold text-white"
            style={{ borderBottom: `5px solid ${color}` }}
          >
            {team.number}
          </div>
          <div>
            <h1 className="text-5xl md:text-6xl">{team.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[var(--color-muted)]">
              <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                {team.class_id}
              </span>
              {team.car && <span>{team.car}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Roster */}
      <div className="mt-8">
        <h2 className="mb-4 text-2xl">Roster</h2>
        {roster.length === 0 ? (
          <p className="text-[var(--color-muted)]">No drivers signed to this team yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roster.map((m, i) => (
              <Reveal key={m.key} delay={i * 0.04}>
                {m.driver ? (
                  <Link
                    to={`/drivers/${m.driver.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4 transition-all hover:-translate-y-1 hover:shadow-card"
                  >
                    <span className="font-display text-xl font-extrabold uppercase">{m.driver.name}</span>
                    {m.driver.country && <span>{m.driver.country}</span>}
                    <span className="ml-auto text-[var(--color-faint)]" aria-hidden>→</span>
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
                    <span className="font-display text-xl font-extrabold uppercase">{m.name}</span>
                  </div>
                )}
              </Reveal>
            ))}
          </div>
        )}
      </div>

      <StatRow
        items={[
          ['Starts', stats.starts],
          ['Wins', stats.wins],
          ['Podiums', stats.podiums],
          ['Poles', stats.poles],
          ['Best', stats.bestFinish ? `P${stats.bestFinish}` : '—'],
          ['Points', stats.points],
        ]}
      />

      <ResultsTable rows={rows} classes={classes} emptyLabel={`No scored results yet for ${team.name}.`} />
    </div>
  )
}
