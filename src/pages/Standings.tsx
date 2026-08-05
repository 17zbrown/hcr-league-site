import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useClasses, useCurrentSeason, useSeasonResultsFull, useTeams } from '../lib/queries'
import { computeProgression, computeStandings, type Progression } from '../lib/standings'
import { CLASS_ORDER, classColor, classLineColor } from '../lib/format'
import { useAuth } from '../lib/auth'
import { resultListsDriver } from '../lib/attribution'
import type { ClassId, LeagueClass, StandingRow } from '../lib/types'
import { LoadError, Section, Skeleton } from '../components/ui'
import { CountUp } from '../components/motion'
import { DriverName, TeamLink } from '../components/links'
import { ProgressionChart } from '../components/ProgressionChart'
import { ColumnFilterRow, ColumnFilterToggle, useColumnFilters } from '../components/SearchBox'

type Tab = ClassId | 'TEAMS'

export default function Standings() {
  const { data: season } = useCurrentSeason()
  // One fetch: the "full" variant is a superset of the plain rows, so deriving
  // standings from it avoids downloading the whole season twice.
  const { data: fullResults, isLoading, isError, refetch } = useSeasonResultsFull(season?.id)
  const results = fullResults
  const { data: teams } = useTeams()
  const { data: classes } = useClasses()
  const [tab, setTab] = useState<Tab>('GTP')

  const standings = useMemo(() => computeStandings(results ?? [], teams ?? []), [results, teams])

  const progression = useMemo(() => {
    if (!fullResults) return null
    if (tab === 'TEAMS') {
      // Merge all classes' team series onto ONE union round axis — classes can
      // run different calendars, so indexing by any single class's rounds
      // misaligns every other class's line.
      const merged = CLASS_ORDER.map((c) => computeProgression(fullResults, c, teams ?? [], 'teams'))
      const roundMap = new Map<number, Progression['rounds'][number]>()
      for (const m of merged) for (const r of m.rounds) if (!roundMap.has(r.round)) roundMap.set(r.round, r)
      const rounds = [...roundMap.values()].sort((a, b) => a.round - b.round)
      const series = merged
        .flatMap((m) => {
          const idxByRound = new Map(m.rounds.map((r, i) => [r.round, i]))
          return m.series.map((sr) => {
            let run = 0
            const cumulative = rounds.map((r) => {
              const i = idxByRound.get(r.round)
              if (i != null) run = sr.cumulative[i]
              return run
            })
            return { ...sr, cumulative }
          })
        })
        .sort((a, b) => b.total - a.total)
      return { rounds, series }
    }
    return computeProgression(fullResults, tab, teams ?? [], 'drivers')
  }, [fullResults, tab, teams])

  const tabs: { id: Tab; label: string }[] = [
    ...CLASS_ORDER.map((c) => ({ id: c as Tab, label: c })),
    { id: 'TEAMS', label: 'Teams' },
  ]

  return (
    <Section eyebrow={`${season?.name ?? 'Season'} · Championship`} title="Standings" titleTag="h1">
      <div className="mb-8 flex flex-wrap items-center gap-2">
        {tabs.map((t) => {
          const active = tab === t.id
          const color = t.id === 'TEAMS' ? 'var(--color-brand)' : classColor(t.id, classes)
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={`hcr-chip ${active ? 'hcr-chip-active' : ''}`}
            >
              {/* class-color dot; inset ring keeps the pale GTP yellow visible on white */}
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: color, boxShadow: 'inset 0 0 0 1px rgba(20,24,28,0.28)' }}
              />
              {t.label}
            </button>
          )
        })}
        <Link to="/standings/fill-in" className="hcr-chip ml-auto bg-transparent!">
          Fill-In Cup →
        </Link>
      </div>

      {isError ? (
        <LoadError what="the standings" onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-8">
        {progression && progression.rounds.length > 0 && progression.series.length > 0 && (
          <ProgressionChart
            data={progression}
            color={tab === 'TEAMS' ? 'var(--color-brand-deep)' : classLineColor(tab)}
          />
        )}
        <StandingsTable
          rows={tab === 'TEAMS' ? [] : standings.drivers[tab]}
          teamRows={tab === 'TEAMS' ? CLASS_ORDER.flatMap((c) => standings.teams[c]).sort((a, b) => b.points - a.points) : undefined}
          color={tab === 'TEAMS' ? undefined : classColor(tab, classes)}
          classes={classes}
        />
        </div>
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
  const { profile } = useAuth()
  const meName = profile?.display_name ?? null
  const data = teamRows ?? rows
  const leaderPts = data[0]?.points ?? 0

  // Position and gap are settled before any filtering, so a filtered table still
  // says where someone stands in the championship rather than renumbering them 1st.
  const ranked = data.map((r, i) => ({ r, pos: i + 1, gap: i === 0 ? '—' : `−${leaderPts - r.points}` }))

  const cf = useColumnFilters<(typeof ranked)[number]>({
    pos: (x) => x.pos,
    name: (x) => x.r.name,
    class: (x) => x.r.classId,
    starts: (x) => x.r.starts,
    wins: (x) => x.r.wins,
    pod: (x) => x.r.podiums,
    pts: (x) => x.r.points,
    gap: (x) => x.gap,
  })
  const shown = cf.apply(ranked)

  if (!data.length) {
    return <p className="text-[var(--color-muted)]">No results scored yet this season.</p>
  }

  return (
    <div className="shadow-card relative overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-2.5">
        <span className="tabular font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
          {cf.active > 0 ? `${shown.length} of ${ranked.length}` : `${ranked.length} ${teamRows ? 'teams' : 'drivers'}`}
        </span>
        <ColumnFilterToggle ctl={cf} className="!py-1 !text-[11px]" />
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[var(--color-paper)] sm:hidden" aria-hidden />
      <div className="overflow-x-auto">
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
            <th className="hidden px-5 py-3.5 text-right sm:table-cell">Gap</th>
          </tr>
          <ColumnFilterRow
            ctl={cf}
            className="px-5 pb-3 pt-0"
            cells={[
              { key: 'pos', label: 'Pos' },
              { key: 'name', label: teamRows ? 'Team' : 'Driver' },
              ...(teamRows ? [{ key: 'class', label: 'Class' }] : []),
              { key: 'starts', label: 'Starts' },
              { key: 'wins', label: 'Wins' },
              { key: 'pod', label: 'Podiums' },
              { key: 'pts', label: 'Points' },
              { key: 'gap', label: 'Gap' },
            ]}
          />
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td colSpan={teamRows ? 8 : 7} className="px-5 py-8 text-center text-sm text-[var(--color-muted)]">
                No {teamRows ? 'teams' : 'drivers'} match these column filters.
              </td>
            </tr>
          )}
          {shown.map(({ r, pos, gap }) => {
            const i = pos - 1
            const rowColor = color ?? classColor(r.classId, classes)
            const isMe = !teamRows && !!meName && resultListsDriver(r.name, meName)
            return (
              <tr key={r.key} className={`border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-mist)] ${isMe ? 'bg-[var(--color-brand)]/[0.09]' : ''}`}>
                <td className="px-5 py-3.5">
                  <span
                    className="tabular flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold"
                    style={{ background: i === 0 ? rowColor : 'var(--color-mist)', color: i === 0 ? '#000' : 'var(--color-ink)' }}
                  >
                    {i + 1}
                  </span>
                </td>
                <td className="px-5 py-3.5 font-semibold">
                  {teamRows ? (
                    <TeamLink teamId={r.key.startsWith('num-') ? null : r.key}>{r.name}</TeamLink>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <DriverName text={r.name} />
                      {isMe && <span className="rounded bg-[var(--color-brand)] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-black">You</span>}
                    </span>
                  )}
                </td>
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
                <td className="px-5 py-3.5 text-right font-display text-2xl leading-none">
                  <CountUp value={r.points} />
                </td>
                <td className="tabular hidden px-5 py-3.5 text-right text-[var(--color-faint)] sm:table-cell">
                  {gap}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}
