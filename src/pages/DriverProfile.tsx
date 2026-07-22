import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useClasses,
  useCurrentSeason,
  useDrivers,
  useLicenseResults,
  useSeasonResultsFull,
} from '../lib/queries'
import { buildDriverReport, type FullRow } from '../lib/driverReport'
import { computeAchievements } from '../lib/achievements'
import { buildPaceIndex, computeLicense, resultsForDriver } from '../lib/license'
import { classColor } from '../lib/format'
import { Skeleton } from '../components/ui'
import { AnimatedStat, MeterRow, StatBand } from '../components/editorial'
import { AchievementGallery } from '../components/AchievementGallery'
import { LicenseBadge, LicenseProgress } from '../components/LicenseBadge'
import { TeamLink } from '../components/links'
import { Reveal } from '../components/motion'
import type { LeagueClass, RaceResult } from '../lib/types'

export default function DriverProfile() {
  const { id } = useParams()
  const { data: drivers, isLoading } = useDrivers()
  const { data: classes } = useClasses()
  const { data: season } = useCurrentSeason()
  const { data: results } = useSeasonResultsFull(season?.id)
  const { data: licenseResults } = useLicenseResults()

  const driver = drivers?.find((d) => d.id === id)

  const rows = useMemo<FullRow[]>(() => {
    if (!driver || !results) return []
    return resultsForDriver(results, driver.name).sort(
      (a, b) => (a.event?.round ?? 0) - (b.event?.round ?? 0),
    ) as FullRow[]
  }, [driver, results])

  const report = useMemo(() => buildDriverReport(rows, (results ?? []) as FullRow[]), [rows, results])

  const achievements = useMemo(
    () => computeAchievements(rows, (results ?? []) as FullRow[]),
    [rows, results],
  )

  const license = useMemo(() => {
    if (!driver) return null
    const idx = buildPaceIndex(licenseResults ?? [])
    return computeLicense(resultsForDriver(licenseResults ?? [], driver.name), idx, driver.license_override)
  }, [driver, licenseResults])

  if (isLoading) return <div className="container-hcr py-16"><Skeleton className="h-96 w-full" /></div>
  if (!driver) {
    return (
      <div className="container-hcr flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="text-5xl">Driver not found</h1>
        <Link to="/drivers" className="mt-6 text-[var(--color-blue)]">← All drivers</Link>
      </div>
    )
  }

  const cls = driver.team?.class_id
  const color = cls ? classColor(cls, classes) : 'var(--color-brand)'
  const raced = report.starts > 0

  return (
    <div className="container-hcr py-10 md:py-14">
      <Link to="/drivers" className="mb-6 inline-block font-body text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)]">
        ← Drivers
      </Link>

      {/* ---------- Feature header: navy panel, name in serif ---------- */}
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
            {driver.team?.number ?? driver.name.slice(0, 1)}
          </div>

          <div className="min-w-0">
            <h1 className="text-5xl leading-[1.02] md:text-7xl">{driver.name}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              {driver.country && (
                <span className="text-xl leading-none" role="img" aria-label="Nationality">{driver.country}</span>
              )}
              {driver.team && (
                <TeamLink teamId={driver.team.id} className="font-body font-semibold text-[var(--color-ink)] underline-offset-4 hover:underline">
                  {driver.team.name}
                </TeamLink>
              )}
              {cls && (
                <span className="inline-flex items-center gap-2 font-body text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                  {cls}
                </span>
              )}
              {license && <LicenseBadge tier={license.effective} />}
              {driver.irating != null && (
                <span className="tabular text-sm text-[var(--color-muted)]">iR {driver.irating}</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {!raced ? (
        <p className="mt-10 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-10 text-center text-[var(--color-muted)]">
          No scored results yet for {driver.name}. Their report builds automatically once they take a start.
        </p>
      ) : (
        <>
          {/* ---------- Headline stats ---------- */}
          <div className="mt-8">
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
                  Every round {driver.name.split(' ')[0]} has started this season, in order — class finish,
                  places made up on the road, and points banked.
                </p>
                <ol className="mt-5 flex flex-wrap gap-2.5">
                  {report.form.map((f) => {
                    const win = f.clsPos === 1
                    const pod = f.clsPos != null && f.clsPos <= 3
                    return (
                      <li
                        key={f.round}
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
                      { label: 'Avg Start', value: report.avgStart, decimals: 1, prefix: 'P' },
                      {
                        label: 'Places Gained',
                        value: report.placesGained,
                        prefix: (report.placesGained ?? 0) > 0 ? '+' : '',
                        hint: 'Grid to flag, all season',
                      },
                      { label: 'Laps Completed', value: report.totalLaps },
                    ]}
                  />
                </div>
              </section>

              {/* Pace & discipline */}
              <section>
                <h2 className="text-3xl">Pace &amp; discipline</h2>
                <div className="mt-5">
                  <StatBand
                    columns={4}
                    stats={[
                      { label: 'Best Lap', text: report.bestLap, value: null },
                      {
                        label: 'Off Class Best',
                        value: report.avgPaceGap,
                        decimals: 2,
                        suffix: '%',
                        hint: 'Average gap to the quickest in class',
                      },
                      { label: 'Incidents / Race', value: report.incPerRace, decimals: 1 },
                      { label: 'Retirements', value: report.dnfs },
                    ]}
                  />
                </div>
              </section>

              {/* Trophy cabinet */}
              <section>
                <h2 className="text-3xl">Trophy cabinet</h2>
                <div className="mt-5">
                  <AchievementGallery achievements={achievements} />
                </div>
              </section>

              {/* Results table */}
              <ResultsTable rows={rows} classes={classes} emptyLabel={`No scored results yet for ${driver.name}.`} />
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
                  Consistency scores how tightly the finishing positions cluster — a driver who always lands
                  in the same window scores higher than one who mixes wins with retirements.
                </p>
              </div>

              {license && <LicenseProgress info={license} />}

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

              <Link
                to={'/compare?a=' + driver.id}
                className="inline-block font-body text-sm font-semibold text-[var(--color-blue)] underline-offset-4 hover:underline"
              >
                Compare with another driver →
              </Link>
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

/* ---------------- shared results table (also used by TeamProfile) ---------------- */

export function StatRow({ items }: { items: [string, string | number][] }) {
  return (
    <StatBand
      stats={items.map(([label, value]) => (
        typeof value === 'number'
          ? { label, value }
          : { label, value: null, text: String(value) }
      ))}
    />
  )
}

type Row = RaceResult & {
  event?: { round: number; name: string | null; date?: string; track?: { name: string } | null } | null
}

export function ResultsTable({
  rows, classes, emptyLabel,
}: { rows: Row[]; classes?: LeagueClass[]; emptyLabel: string }) {
  if (!rows.length) return <p className="text-[var(--color-muted)]">{emptyLabel}</p>
  return (
    <section>
      <h2 className="mb-5 text-3xl">Round by round</h2>
      <div className="relative overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[var(--color-paper)] sm:hidden" aria-hidden />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] bg-[var(--color-mist)] text-left font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                <th className="px-4 py-3">Rnd</th>
                <th className="px-4 py-3">Race</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3 text-center">Finish</th>
                <th className="px-4 py-3 text-center">Grid</th>
                <th className="px-4 py-3">Best lap</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const color = classColor(r.class_id, classes)
                return (
                  <tr key={r.id} className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-cloud)]">
                    <td className="tabular px-4 py-3.5 text-[var(--color-muted)]">{r.event?.round ?? '—'}</td>
                    <td className="px-4 py-3.5 font-body font-medium">{r.event?.name ?? r.event?.track?.name ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1.5 font-body text-[10px] font-semibold uppercase tracking-[0.12em]">
                        <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: 'inset 0 0 0 1px rgba(20,24,28,0.28)' }} />
                        {r.class_id}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center font-display text-2xl leading-none">
                      {r.cls_pos ? `P${r.cls_pos}` : '—'}
                    </td>
                    <td className="tabular px-4 py-3.5 text-center">{r.grid ?? '—'}</td>
                    <td className="tabular px-4 py-3.5">{r.best_lap ?? '—'}</td>
                    <td className="px-4 py-3.5 font-body">
                      <span className={r.status === 'DNF' ? 'font-semibold text-[var(--color-red)]' : 'text-[var(--color-muted)]'}>
                        {r.status ?? '—'}
                      </span>
                    </td>
                    <td className="tabular px-4 py-3.5 text-right font-semibold">
                      {(r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export { Reveal }
