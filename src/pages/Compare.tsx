import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  useClasses,
  useCurrentSeason,
  useDrivers,
  useSeasonResultsFull,
} from '../lib/queries'
import { buildDriverReport, type DriverReport, type FullRow } from '../lib/driverReport'
import { resultsForDriver } from '../lib/attribution'
import { lapToSeconds } from '../lib/profileStats'
import { classColor } from '../lib/format'
import { AnimatedStat, FeaturePanel, SectionHead } from '../components/editorial'
import { Skeleton } from '../components/ui'
import type { Driver, LeagueClass } from '../lib/types'

/* ------------------------------------------------------------------ *
 * Head-to-head: two drivers, one ledger. Selection lives in the URL
 * (?a=&b=) so any match-up is a shareable link.
 * ------------------------------------------------------------------ */

interface LedgerLine {
  label: string
  hint?: string
  a: number | null
  b: number | null
  aText?: string | null
  bText?: string | null
  isText?: boolean
  decimals?: number
  prefix?: string
  /** Places-gained style: show a leading + on positive values. */
  signed?: boolean
  winner: 'a' | 'b' | null
}

function pick(
  a: number | null | undefined,
  b: number | null | undefined,
  lowerWins = false,
): 'a' | 'b' | null {
  if (a == null || b == null || a === b) return null
  return (lowerWins ? a < b : a > b) ? 'a' : 'b'
}

function buildLedger(ra: DriverReport, rb: DriverReport): LedgerLine[] {
  const num = (
    label: string,
    a: number | null,
    b: number | null,
    opts: { lower?: boolean; decimals?: number; prefix?: string; hint?: string; signed?: boolean } = {},
  ): LedgerLine => {
    // Null on either side voids the whole row — both show '—', nobody wins.
    const voided = a == null || b == null
    return {
      label,
      hint: opts.hint,
      a: voided ? null : a,
      b: voided ? null : b,
      decimals: opts.decimals,
      prefix: opts.prefix,
      signed: opts.signed,
      winner: voided ? null : pick(a, b, opts.lower),
    }
  }

  const aSec = lapToSeconds(ra.bestLap)
  const bSec = lapToSeconds(rb.bestLap)
  const lapVoid = aSec == null || bSec == null

  return [
    num('Championship Points', ra.points, rb.points),
    num('Wins', ra.wins, rb.wins),
    num('Podiums', ra.podiums, rb.podiums),
    num('Poles', ra.poles, rb.poles),
    num('Avg Finish', ra.avgFinish, rb.avgFinish, { lower: true, decimals: 1, prefix: 'P', hint: 'Lower is better' }),
    num('Avg Start', ra.avgStart, rb.avgStart, { lower: true, decimals: 1, prefix: 'P', hint: 'Lower is better' }),
    num('Places Gained', ra.placesGained, rb.placesGained, { signed: true, hint: 'Grid to flag' }),
    {
      label: 'Best Lap',
      hint: 'Lower is better',
      isText: true,
      a: null,
      b: null,
      aText: lapVoid ? null : ra.bestLap,
      bText: lapVoid ? null : rb.bestLap,
      winner: lapVoid ? null : pick(aSec, bSec, true),
    },
    num('Incidents / Race', ra.incPerRace, rb.incPerRace, { lower: true, decimals: 1, hint: 'Lower is better' }),
    num('Consistency', ra.consistency, rb.consistency, { hint: 'Score out of 100' }),
  ]
}

/* ---------------- presentational bits ---------------- */

function SideValue({ line, side }: { line: LedgerLine; side: 'a' | 'b' }) {
  const v = side === 'a' ? line.a : line.b
  const t = side === 'a' ? line.aText : line.bText
  const win = line.winner === side
  const prefix = line.signed ? ((v ?? 0) > 0 ? '+' : '') : line.prefix
  return (
    <div className={`flex flex-col ${side === 'a' ? 'items-start' : 'items-end'}`}>
      {line.isText ? (
        <span className="tabular text-xl leading-none sm:text-2xl">{t ?? '—'}</span>
      ) : (
        <span className="font-display text-2xl leading-none sm:text-3xl md:text-4xl">
          <AnimatedStat value={v} decimals={line.decimals} prefix={prefix} />
        </span>
      )}
      {/* winner mark: 2px brand underline; kept as a spacer on the loser so rows don't jitter */}
      <span
        className={`mt-1.5 h-[2px] w-9 rounded-full ${win ? 'bg-[var(--color-brand)]' : 'bg-transparent'}`}
        aria-hidden="true"
      />
      {win && <span className="sr-only">ahead</span>}
    </div>
  )
}

function HeadName({
  driver,
  classes,
  side,
}: {
  driver: Driver
  classes?: LeagueClass[]
  side: 'a' | 'b'
}) {
  const cls = driver.team?.class_id
  const color = cls ? classColor(cls, classes) : 'var(--color-brand)'
  const align = side === 'a' ? 'md:items-start md:text-left' : 'md:items-end md:text-right'
  return (
    <div className={`flex min-w-0 flex-col items-center text-center ${align}`}>
      <Link to={`/drivers/${driver.id}`} className="underline-offset-4 hover:underline">
        <h2 className="text-3xl leading-[1.05] sm:text-4xl md:text-5xl">{driver.name}</h2>
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {cls && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" />}
        <span className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
          {driver.team ? `${driver.team.class_id} · ${driver.team.name}` : 'Free agent'}
        </span>
      </div>
    </div>
  )
}

/* ---------------- page ---------------- */

export default function Compare() {
  const [params, setParams] = useSearchParams()
  const aId = params.get('a') ?? ''
  const bId = params.get('b') ?? ''

  const { data: drivers, isLoading: driversLoading } = useDrivers()
  const { data: classes } = useClasses()
  const { data: season, isLoading: seasonLoading } = useCurrentSeason()
  const { data: results, isLoading: resultsLoading } = useSeasonResultsFull(season?.id)

  const driverA = drivers?.find((d) => d.id === aId)
  const driverB = drivers?.find((d) => d.id === bId)

  const setSide = (side: 'a' | 'b', id: string) => {
    const next = new URLSearchParams(params)
    if (id) next.set(side, id)
    else next.delete(side)
    setParams(next, { replace: true })
  }

  const rowsA = useMemo<FullRow[]>(() => {
    if (!driverA || !results) return []
    return (resultsForDriver(results, driverA.name) as FullRow[]).sort(
      (x, y) => (x.event?.round ?? 0) - (y.event?.round ?? 0),
    )
  }, [driverA, results])

  const rowsB = useMemo<FullRow[]>(() => {
    if (!driverB || !results) return []
    return (resultsForDriver(results, driverB.name) as FullRow[]).sort(
      (x, y) => (x.event?.round ?? 0) - (y.event?.round ?? 0),
    )
  }, [driverB, results])

  const reportA = useMemo(() => buildDriverReport(rowsA, (results ?? []) as FullRow[]), [rowsA, results])
  const reportB = useMemo(() => buildDriverReport(rowsB, (results ?? []) as FullRow[]), [rowsB, results])

  // Rounds where BOTH drivers hold a class finish — the season duel.
  const duel = useMemo(() => {
    const posByRound = (rows: FullRow[]) => {
      const m = new Map<number, number>()
      for (const r of rows) {
        const rd = r.event?.round
        if (rd == null || r.cls_pos == null || m.has(rd)) continue
        m.set(rd, r.cls_pos)
      }
      return m
    }
    const ma = posByRound(rowsA)
    const mb = posByRound(rowsB)
    const tiles = [...ma.keys()]
      .filter((rd) => mb.has(rd))
      .sort((x, y) => x - y)
      .map((rd) => ({ round: rd, a: ma.get(rd)!, b: mb.get(rd)! }))
    const aWins = tiles.filter((t) => t.a < t.b).length
    const bWins = tiles.filter((t) => t.b < t.a).length
    return { tiles, aWins, bWins }
  }, [rowsA, rowsB])

  const bothChosen = !!driverA && !!driverB
  const sameDriver = bothChosen && driverA!.id === driverB!.id
  const dataLoading = bothChosen && !sameDriver && (seasonLoading || resultsLoading)

  const colorA = driverA?.team?.class_id ? classColor(driverA.team.class_id, classes) : 'var(--color-brand)'
  const colorB = driverB?.team?.class_id ? classColor(driverB.team.class_id, classes) : 'var(--color-brand)'

  // First names for the duel tally; fall back to full names if they collide.
  const firstA = driverA?.name.split(' ')[0] ?? ''
  const firstB = driverB?.name.split(' ')[0] ?? ''
  const shortA = firstA && firstA !== firstB ? firstA : driverA?.name ?? ''
  const shortB = firstB && firstB !== firstA ? firstB : driverB?.name ?? ''

  const ledger = useMemo(() => buildLedger(reportA, reportB), [reportA, reportB])

  return (
    <div className="container-hcr py-10 md:py-14">
      <SectionHead as="h1" eyebrow="Head to Head" title="Compare drivers" />

      {/* ---------- pickers ---------- */}
      {driversLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="grid gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 sm:grid-cols-2 sm:gap-6">
          {(['a', 'b'] as const).map((side) => {
            const value = side === 'a' ? (driverA ? aId : '') : (driverB ? bId : '')
            const otherId = side === 'a' ? bId : aId
            return (
              <div key={side}>
                <label
                  htmlFor={`compare-${side}`}
                  className="mb-2 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]"
                >
                  Driver {side.toUpperCase()}
                </label>
                <select
                  id={`compare-${side}`}
                  className="hcr-select"
                  value={value}
                  onChange={(e) => setSide(side, e.target.value)}
                >
                  <option value="">Choose a driver…</option>
                  {(drivers ?? []).map((d) => (
                    <option key={d.id} value={d.id} disabled={d.id === otherId}>
                      {d.name}
                      {d.team ? ` — ${d.team.name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      )}

      {/* ---------- states ---------- */}
      {!bothChosen ? (
        <div className="mt-10 rounded-2xl bg-[var(--color-cloud)] px-8 py-16 text-center">
          <p className="font-display text-4xl md:text-5xl">Pick two drivers.</p>
          <p className="mx-auto mt-4 max-w-md font-body text-[var(--color-muted)]">
            Choose one for each side above and the ledger sets their seasons side by side —
            points, pace, race craft and the round-by-round duel.
          </p>
        </div>
      ) : sameDriver ? (
        <div className="mt-10 rounded-2xl bg-[var(--color-cloud)] px-8 py-16 text-center">
          <p className="font-display text-3xl md:text-4xl">Two different drivers, please.</p>
          <p className="mx-auto mt-4 max-w-md font-body text-[var(--color-muted)]">
            {driverA!.name} can't race their own shadow — pick a rival for the other side.
          </p>
        </div>
      ) : dataLoading ? (
        <div className="mt-8 space-y-6">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <>
          {/* ---------- feature header ---------- */}
          <FeaturePanel className="mt-8">
            <div className="grid items-center gap-6 p-7 md:grid-cols-[1fr_auto_1fr] md:gap-8 md:p-10">
              <HeadName driver={driverA!} classes={classes} side="a" />
              <div className="text-center font-display text-3xl italic leading-none text-[var(--color-muted)] md:text-4xl">
                vs
              </div>
              <HeadName driver={driverB!} classes={classes} side="b" />
            </div>
          </FeaturePanel>

          {reportA.starts === 0 || reportB.starts === 0 ? (
            <div className="mt-8 rounded-2xl bg-[var(--color-cloud)] px-8 py-14 text-center">
              <p className="font-display text-3xl md:text-4xl">The ledger needs laps.</p>
              <p className="mx-auto mt-4 max-w-md font-body text-[var(--color-muted)]">
                {reportA.starts === 0 && reportB.starts === 0
                  ? `Neither ${shortA} nor ${shortB} has taken a start this season yet.`
                  : `${reportA.starts === 0 ? driverA!.name : driverB!.name} hasn't taken a start this season yet.`}{' '}
                The comparison builds itself the moment both have raced.
              </p>
            </div>
          ) : (
            <>
              {/* ---------- comparison ledger ---------- */}
              <section className="mt-8">
                <div className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]">
                  <div className="grid grid-cols-[1fr_minmax(6.5rem,auto)_1fr] items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-mist)] px-5 py-3">
                    <div className="min-w-0 truncate font-alt text-xs font-bold uppercase tracking-wide">
                      {driverA!.name}
                    </div>
                    <div className="text-center font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                      Season Ledger
                    </div>
                    <div className="min-w-0 truncate text-right font-alt text-xs font-bold uppercase tracking-wide">
                      {driverB!.name}
                    </div>
                  </div>
                  <div className="divide-y divide-[var(--color-line)]">
                    {ledger.map((line) => (
                      <div
                        key={line.label}
                        className="grid grid-cols-[1fr_minmax(6.5rem,auto)_1fr] items-center gap-3 px-5 py-4"
                      >
                        <SideValue line={line} side="a" />
                        <div className="px-1 text-center">
                          <div className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                            {line.label}
                          </div>
                          {line.hint && (
                            <div className="mt-0.5 font-body text-[10px] text-[var(--color-faint)]">{line.hint}</div>
                          )}
                        </div>
                        <SideValue line={line} side="b" />
                      </div>
                    ))}
                  </div>
                </div>
                <p className="mt-3 font-body text-xs text-[var(--color-faint)]">
                  The yellow underline marks whoever holds the edge on each line. Ties and missing data go unmarked.
                </p>
              </section>

              {/* ---------- round-by-round duel ---------- */}
              <section className="mt-12">
                <h2 className="text-3xl">The season duel</h2>
                <p className="mt-2 max-w-prose font-body text-[var(--color-muted)]">
                  Every round both drivers took a class finish — {shortA} on the left of each score,{' '}
                  {shortB} on the right.
                </p>

                {duel.tiles.length === 0 ? (
                  <p className="mt-5 rounded-2xl bg-[var(--color-cloud)] px-6 py-10 text-center font-body text-[var(--color-muted)]">
                    No shared rounds yet — the duel begins the first time {shortA} and {shortB} take the
                    same green flag.
                  </p>
                ) : (
                  <>
                    <ol className="mt-5 flex flex-wrap gap-2.5">
                      {duel.tiles.map((t) => (
                        <li
                          key={t.round}
                          title={`Round ${t.round} — ${driverA!.name} P${t.a}, ${driverB!.name} P${t.b}`}
                          className="min-w-[104px] flex-1 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4 text-center sm:flex-none"
                        >
                          <div className="font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                            R{t.round}
                          </div>
                          <div className="mt-1.5 flex items-center justify-center gap-1.5 font-display text-2xl leading-none">
                            {t.a < t.b && (
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorA }} aria-hidden="true" />
                            )}
                            <span>P{t.a}</span>
                            <span className="text-[var(--color-faint)]">·</span>
                            <span>P{t.b}</span>
                            {t.b < t.a && (
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorB }} aria-hidden="true" />
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                    <p className="mt-6 font-display text-2xl md:text-3xl">
                      {duel.aWins === duel.bWins
                        ? `Level at ${duel.aWins}–${duel.bWins} in the season duel.`
                        : duel.aWins > duel.bWins
                          ? `${shortA} leads the season duel ${duel.aWins}–${duel.bWins}.`
                          : `${shortB} leads the season duel ${duel.bWins}–${duel.aWins}.`}
                    </p>
                  </>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
