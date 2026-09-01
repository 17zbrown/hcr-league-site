import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useClasses, useCurrentSeason, useSeasonResults } from '../lib/queries'
import { computeFillInStandings, fillInRows } from '../lib/standings'
import { classColor } from '../lib/format'
import { useAuth } from '../lib/auth'
import { resultListsDriver } from '../lib/attribution'
import { LoadError, Section, Skeleton } from '../components/ui'
import { CountUp } from '../components/motion'
import { DriverName } from '../components/links'
import { ColumnFilterRow, ColumnFilterToggle, useColumnFilters } from '../components/SearchBox'

/**
 * The Fill-In Cup — a side championship, completely separate from the main
 * points. Not every round runs every class; drivers whose class sits a round
 * out can still race as fill-in entries, and this is where those drives score.
 */
export default function FillInStandings() {
  const { data: season } = useCurrentSeason()
  const { data: results, isLoading, isError, refetch } = useSeasonResults(season?.id)
  const { data: classes } = useClasses()
  const { profile } = useAuth()
  const meName = profile?.display_name ?? null

  const rows = useMemo(() => computeFillInStandings(results ?? []), [results])
  // a driver who fills in across two classes appears once per class in the
  // table — the headline stat counts PEOPLE, so dedupe on the crew part
  const cupDrivers = useMemo(() => new Set(rows.map((r) => r.key.split('::')[0])).size, [rows])
  const driveCount = useMemo(() => fillInRows(results ?? []).length, [results])

  // Cup position is fixed before filtering, so narrowing the table never implies
  // someone is leading a cup they are fourth in.
  const ranked = useMemo(() => rows.map((r, i) => ({ r, pos: i + 1 })), [rows])
  const cf = useColumnFilters<(typeof ranked)[number]>({
    pos: (x) => x.pos,
    name: (x) => x.r.name,
    class: (x) => x.r.classId,
    starts: (x) => x.r.starts,
    wins: (x) => x.r.wins,
    pod: (x) => x.r.podiums,
    pts: (x) => x.r.points,
  })
  const shown = cf.apply(ranked)

  return (
    <Section eyebrow={`${season?.name ?? 'Season'} · Side championship`} title="Fill-In Cup" titleTag="h1">
      <div className="mb-10 grid gap-8 md:grid-cols-[1.4fr_1fr] md:items-start">
        <div className="max-w-xl space-y-4 text-lg leading-relaxed text-[var(--color-ink-2)]">
          <p>
            Not every round runs every class. When a race leaves a class off the grid, its
            drivers don't have to sit at home — they can jump into a fill-in seat and race
            anyway. Those drives score here, in the Fill-In Cup.
          </p>
          <p className="text-base text-[var(--color-muted)]">
            Fill-in points never touch the main championship — this is its own pool, its own
            table, its own bragging rights. Same points scale, separate title.
          </p>
        </div>
        <div className="on-navy shadow-card relative overflow-hidden rounded-xl bg-[var(--color-deep)] p-6 md:p-7">
          <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative">
            <div className="font-mono text-xs uppercase tracking-widest text-[var(--color-muted)]">This season</div>
            <div className="mt-4 flex items-end gap-10">
              <div>
                <div className="font-display text-5xl leading-none md:text-6xl"><CountUp value={driveCount} /></div>
                <div className="mt-2 text-sm text-[var(--color-muted)]">fill-in drives</div>
              </div>
              <div>
                <div className="font-display text-5xl leading-none md:text-6xl"><CountUp value={cupDrivers} /></div>
                <div className="mt-2 text-sm text-[var(--color-muted)]">drivers in the cup</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isError ? (
        <LoadError what="the Fill-In Cup" onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-line-2)] bg-[var(--color-paper)] p-10 text-center">
          <p className="font-display text-3xl">No fill-in drives yet.</p>
          <p className="mx-auto mt-3 max-w-md text-[var(--color-muted)]">
            The first time a driver races a round their class isn't part of, they'll show up
            here. Race control flags fill-in entries when results are imported.
          </p>
          <Link to="/standings" className="hcr-btn hcr-btn-dark mt-6 inline-flex">Main Championship</Link>
        </div>
      ) : (
        <div className="shadow-card relative overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-2.5">
            <span className="tabular font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
              {cf.active > 0 ? `${shown.length} of ${ranked.length}` : `${ranked.length} drivers`}
            </span>
            <ColumnFilterToggle ctl={cf} className="!py-1 !text-[11px]" />
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[var(--color-paper)] sm:hidden" aria-hidden />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-line)] bg-[var(--color-mist)] text-left font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                  <th className="w-16 px-4 py-3.5">Pos</th>
                  <th className="px-4 py-3.5">Driver</th>
                  <th className="px-4 py-3.5">Raced In</th>
                  <th className="px-4 py-3.5 text-center">Drives</th>
                  <th className="px-4 py-3.5 text-center">Wins</th>
                  <th className="px-4 py-3.5 text-center">Pod</th>
                  <th className="px-4 py-3.5 text-right">Pts</th>
                </tr>
                <ColumnFilterRow
                  ctl={cf}
                  className="px-4 pb-3 pt-0"
                  cells={[
                    { key: 'pos', label: 'Pos' },
                    { key: 'name', label: 'Driver' },
                    { key: 'class', label: 'Raced in' },
                    { key: 'starts', label: 'Drives' },
                    { key: 'wins', label: 'Wins' },
                    { key: 'pod', label: 'Podiums' },
                    { key: 'pts', label: 'Points' },
                  ]}
                />
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-sm text-[var(--color-muted)]">
                      No drivers match these column filters.
                    </td>
                  </tr>
                )}
                {shown.map(({ r, pos }) => {
                  const i = pos - 1
                  const rowColor = classColor(r.classId, classes)
                  const isMe = !!meName && resultListsDriver(r.name, meName)
                  return (
                    <tr key={r.key} className={`border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-cloud)] ${isMe ? 'bg-[var(--color-brand)]/[0.09]' : ''}`}>
                      <td className="px-4 py-3.5">
                        <span
                          className="tabular flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold"
                          style={{ background: i === 0 ? rowColor : 'var(--color-mist)', color: i === 0 ? '#000' : 'var(--color-ink)' }}
                        >
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-semibold">
                        <span className="inline-flex items-center gap-2">
                          <DriverName text={r.name} />
                          {isMe && <span className="rounded bg-[var(--color-brand)] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-black">You</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center gap-2 font-mono text-xs uppercase text-[var(--color-ink-2)]">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: rowColor }} />
                          {r.classId}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3.5 text-center text-[var(--color-muted)]">{r.starts}</td>
                      <td className="tabular px-4 py-3.5 text-center">{r.wins || '—'}</td>
                      <td className="tabular px-4 py-3.5 text-center">{r.podiums || '—'}</td>
                      <td className="px-4 py-3.5 text-right font-display text-2xl leading-none">
                        <CountUp value={r.points} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-8">
        <Link to="/standings" className="inline-flex min-h-11 items-center font-mono text-xs uppercase tracking-[0.14em] text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]">
          ← Main championship standings
        </Link>
      </div>
    </Section>
  )
}
