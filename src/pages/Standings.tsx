import { useMemo, useState } from 'react'
import { useClasses, useCurrentSeason, useSeasonResults, useTeams } from '../lib/queries'
import { computeStandings } from '../lib/standings'
import { CLASS_ORDER, classColor } from '../lib/format'
import type { ClassId, LeagueClass, StandingRow } from '../lib/types'
import { Section, Skeleton } from '../components/ui'
import { CountUp } from '../components/motion'

type Tab = ClassId | 'TEAMS'

export default function Standings() {
  const { data: season } = useCurrentSeason()
  const { data: results, isLoading } = useSeasonResults(season?.id)
  const { data: teams } = useTeams()
  const { data: classes } = useClasses()
  const [tab, setTab] = useState<Tab>('GTP')

  const standings = useMemo(() => computeStandings(results ?? [], teams ?? []), [results, teams])

  const tabs: { id: Tab; label: string }[] = [
    ...CLASS_ORDER.map((c) => ({ id: c as Tab, label: c })),
    { id: 'TEAMS', label: 'Teams' },
  ]

  return (
    <Section eyebrow={`${season?.name ?? 'Season'} · Championship`} title="Standings">
      <div className="mb-8 flex flex-wrap gap-1 border-b border-[var(--color-line)]">
        {tabs.map((t) => {
          const active = tab === t.id
          const color = t.id === 'TEAMS' ? 'var(--color-brand)' : classColor(t.id, classes)
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-5 py-3 font-display text-2xl font-extrabold uppercase transition-colors ${
                active ? 'text-[var(--color-ink)]' : 'text-[var(--color-faint)] hover:text-[var(--color-ink)]'
              }`}
            >
              {t.label}
              {active && <span className="absolute inset-x-0 -bottom-px h-[3px]" style={{ background: color }} />}
            </button>
          )
        })}
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <StandingsTable
          rows={tab === 'TEAMS' ? [] : standings.drivers[tab]}
          teamRows={tab === 'TEAMS' ? CLASS_ORDER.flatMap((c) => standings.teams[c]).sort((a, b) => b.points - a.points) : undefined}
          color={tab === 'TEAMS' ? undefined : classColor(tab, classes)}
          classes={classes}
        />
      )}
    </Section>
  )
}

function StandingsTable({
  rows,
  teamRows,
  color,
  classes,
}: {
  rows: StandingRow[]
  teamRows?: StandingRow[]
  color?: string
  classes?: LeagueClass[]
}) {
  const data = teamRows ?? rows
  if (!data.length) {
    return <p className="text-[var(--color-muted)]">No results scored yet this season.</p>
  }

  return (
    <div className="shadow-card overflow-x-auto rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-line)] bg-[var(--color-mist)] text-left font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
            <th className="w-16 px-5 py-3.5">Pos</th>
            <th className="px-5 py-3.5">{teamRows ? 'Team' : 'Driver'}</th>
            {teamRows && <th className="px-5 py-3.5">Class</th>}
            <th className="px-5 py-3.5 text-center">Starts</th>
            <th className="px-5 py-3.5 text-center">Wins</th>
            <th className="px-5 py-3.5 text-center">Pod</th>
            <th className="px-5 py-3.5 text-right">Pts</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => {
            const rowColor = color ?? classColor(r.classId, classes)
            return (
              <tr key={r.key} className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-mist)]">
                <td className="px-5 py-3.5">
                  <span
                    className="tabular flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold"
                    style={{ background: i === 0 ? rowColor : 'var(--color-mist)', color: i === 0 ? '#000' : 'var(--color-ink)' }}
                  >
                    {i + 1}
                  </span>
                </td>
                <td className="px-5 py-3.5 font-semibold">{r.name}</td>
                {teamRows && (
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-2 font-mono text-xs uppercase text-[var(--color-ink-2)]">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: classColor(r.classId, classes) }} />
                      {r.classId}
                    </span>
                  </td>
                )}
                <td className="tabular px-5 py-3.5 text-center text-[var(--color-muted)]">{r.starts}</td>
                <td className="tabular px-5 py-3.5 text-center">{r.wins || '—'}</td>
                <td className="tabular px-5 py-3.5 text-center">{r.podiums || '—'}</td>
                <td className="tabular px-5 py-3.5 text-right text-lg font-bold">
                  <CountUp value={r.points} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
