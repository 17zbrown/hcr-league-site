import { useMemo, useState } from 'react'
import { useClasses, useCurrentSeason, useSeasonResults, useTeams } from '../lib/queries'
import { computeStandings } from '../lib/standings'
import { CLASS_ORDER, classColor } from '../lib/format'
import type { ClassId } from '../lib/types'
import { Section, Skeleton } from '../components/ui'

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
              className={`relative px-5 py-3 font-display text-2xl uppercase transition-colors ${
                active ? 'text-[var(--color-paper)]' : 'text-[var(--color-muted)] hover:text-[var(--color-paper)]'
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
          teamRows={
            tab === 'TEAMS'
              ? CLASS_ORDER.flatMap((c) => standings.teams[c])
              : undefined
          }
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
}: {
  rows: import('../lib/types').StandingRow[]
  teamRows?: import('../lib/types').StandingRow[]
  color?: string
  classes?: import('../lib/types').LeagueClass[]
}) {
  const data = teamRows ?? rows
  if (!data.length) {
    return <p className="text-[var(--color-muted)]">No results scored yet this season.</p>
  }

  return (
    <div className="overflow-x-auto border border-[var(--color-line)]">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-line)] bg-[var(--color-ink-2)] text-left">
            <th className="w-14 px-4 py-3 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">Pos</th>
            <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
              {teamRows ? 'Team' : 'Driver'}
            </th>
            {teamRows && <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">Class</th>}
            <th className="px-4 py-3 text-center font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">Starts</th>
            <th className="px-4 py-3 text-center font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">Wins</th>
            <th className="px-4 py-3 text-center font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">Pod</th>
            <th className="px-4 py-3 text-right font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">Pts</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => {
            const rowColor = color ?? classColor(r.classId)
            return (
              <tr key={r.key} className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-ink-2)]">
                <td className="px-4 py-3">
                  <span
                    className="tabular flex h-8 w-8 items-center justify-center text-sm font-bold"
                    style={{ background: i === 0 ? rowColor : 'var(--color-ink-3)', color: i === 0 ? '#000' : undefined }}
                  >
                    {i + 1}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium">{r.name}</td>
                {teamRows && (
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs uppercase" style={{ color: classColor(r.classId) }}>
                      {r.classId}
                    </span>
                  </td>
                )}
                <td className="tabular px-4 py-3 text-center text-[var(--color-muted)]">{r.starts}</td>
                <td className="tabular px-4 py-3 text-center">{r.wins || '—'}</td>
                <td className="tabular px-4 py-3 text-center">{r.podiums || '—'}</td>
                <td className="tabular px-4 py-3 text-right text-lg font-bold">{r.points}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
