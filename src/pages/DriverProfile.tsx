import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useClasses, useCurrentSeason, useDrivers, useLicenseResults, useSeasonResultsFull } from '../lib/queries'
import { computeEntityStats } from '../lib/profileStats'
import { buildPaceIndex, computeLicense, resultsForDriver } from '../lib/license'
import { classColor } from '../lib/format'
import { Skeleton } from '../components/ui'
import { LicenseBadge, LicenseProgress } from '../components/LicenseBadge'
import { TeamLink } from '../components/links'
import { Reveal } from '../components/motion'
import type { RaceResult } from '../lib/types'

export default function DriverProfile() {
  const { id } = useParams()
  const { data: drivers, isLoading } = useDrivers()
  const { data: classes } = useClasses()
  const { data: season } = useCurrentSeason()
  const { data: results } = useSeasonResultsFull(season?.id)
  const { data: licenseResults } = useLicenseResults()

  const driver = drivers?.find((d) => d.id === id)

  const rows = useMemo(() => {
    if (!driver || !results) return []
    return resultsForDriver(results, driver.name).sort(
      (a, b) => (a.event?.round ?? 0) - (b.event?.round ?? 0),
    )
  }, [driver, results])

  const stats = useMemo(() => computeEntityStats(rows as RaceResult[]), [rows])

  const paceIndex = useMemo(() => buildPaceIndex(licenseResults ?? []), [licenseResults])

  const license = useMemo(() => {
    if (!driver) return null
    return computeLicense(resultsForDriver(licenseResults ?? [], driver.name), paceIndex, driver.license_override)
  }, [driver, licenseResults, paceIndex])

  if (isLoading) {
    return <div className="container-hcr py-16"><Skeleton className="h-96 w-full" /></div>
  }
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

  return (
    <div className="container-hcr py-12 md:py-16">
      <Link to="/drivers" className="mb-6 inline-block text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)]">
        ← Drivers
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-[var(--color-line)] pb-8">
        <div className="flex items-center gap-5">
          <div
            className="tabular flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl font-display text-4xl font-extrabold text-black"
            style={{ background: color }}
          >
            {driver.team?.number ?? driver.name.slice(0, 1)}
          </div>
          <div>
            <h1 className="text-5xl md:text-6xl">
              {driver.name} {driver.country && <span className="align-middle text-3xl">{driver.country}</span>}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[var(--color-muted)]">
              {driver.team && (
                <TeamLink teamId={driver.team.id} className="font-semibold text-[var(--color-ink-2)]">
                  {driver.team.name}
                </TeamLink>
              )}
              {cls && (
                <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                  {cls}
                </span>
              )}
              {license && <LicenseBadge tier={license.effective} title={license.isOverride ? 'Set by commissioner' : `${license.credits} license credits`} />}
              {driver.irating != null && <span className="tabular text-sm">iR {driver.irating}</span>}
            </div>
          </div>
        </div>
      </div>

      {driver.bio && <p className="mt-6 max-w-2xl text-[var(--color-muted)]">{driver.bio}</p>}

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

      {license && (
        <div className="mt-4 max-w-md">
          <LicenseProgress info={license} />
        </div>
      )}

      <ResultsTable rows={rows} classes={classes} emptyLabel={`No scored results yet for ${driver.name}.`} />
    </div>
  )
}

export function StatRow({ items }: { items: [string, string | number][] }) {
  return (
    <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, value], i) => (
        <Reveal key={label} delay={i * 0.04}>
          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
            <div className="tabular font-display text-4xl font-extrabold">{value}</div>
            <div className="mt-1 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</div>
          </div>
        </Reveal>
      ))}
    </div>
  )
}

type FullRow = RaceResult & {
  event?: { round: number; name: string | null; date: string; track?: { name: string } | null }
}

export function ResultsTable({
  rows,
  classes,
  emptyLabel,
}: {
  rows: FullRow[]
  classes?: import('../lib/types').LeagueClass[]
  emptyLabel: string
}) {
  if (!rows.length) {
    return <p className="mt-10 text-[var(--color-muted)]">{emptyLabel}</p>
  }
  return (
    <div className="mt-10">
      <h2 className="mb-4 text-3xl">Season Results</h2>
      <div className="shadow-card overflow-x-auto rounded-2xl border border-[var(--color-line)]">
        <table className="w-full min-w-[640px] border-collapse bg-[var(--color-paper)] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] bg-[var(--color-mist)] text-left font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
              <th className="px-4 py-3">Rnd</th>
              <th className="px-4 py-3">Race</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3 text-center">Finish</th>
              <th className="px-4 py-3 text-center">Grid</th>
              <th className="px-4 py-3">Best Lap</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const color = classColor(r.class_id, classes)
              return (
                <tr key={r.id} className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-mist)]">
                  <td className="tabular px-4 py-3 text-[var(--color-muted)]">{r.event?.round ?? '—'}</td>
                  <td className="px-4 py-3 font-medium">{r.event?.name ?? r.event?.track?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                      {r.class_id}
                    </span>
                  </td>
                  <td className="tabular px-4 py-3 text-center font-bold">{r.cls_pos ? `P${r.cls_pos}` : '—'}</td>
                  <td className="tabular px-4 py-3 text-center">{r.grid ?? '—'}</td>
                  <td className="tabular px-4 py-3">{r.best_lap ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={r.status === 'DNF' ? 'font-semibold text-[var(--color-red)]' : 'text-[var(--color-muted)]'}>
                      {r.status ?? '—'}
                    </span>
                  </td>
                  <td className="tabular px-4 py-3 text-right font-bold">{(r.points ?? 0) + (r.quali_points ?? 0)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
