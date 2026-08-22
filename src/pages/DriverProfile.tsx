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
import { DriverReportBody } from '../components/DriverReport'
import { computeAchievements } from '../lib/achievements'
import { buildPaceIndex, computeLicense, resultsForDriver } from '../lib/license'
import { classColor } from '../lib/format'
import { Skeleton } from '../components/ui'
import { LicenseBadge } from '../components/LicenseBadge'
import { TeamLink } from '../components/links'
import { Reveal } from '../components/motion'

export default function DriverProfile() {
  const { id } = useParams()
  const { data: drivers, isLoading } = useDrivers()
  const { data: classes } = useClasses()
  const { data: season, isLoading: seasonLoading } = useCurrentSeason()
  const { data: results, isLoading: resultsLoading } = useSeasonResultsFull(season?.id)
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
  const resultsPending = seasonLoading || resultsLoading

  return (
    <div className="container-hcr py-10 md:py-14">
      <Link to="/drivers" className="mb-6 inline-block font-body text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)]">
        ← Drivers
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
            {driver.team?.number ?? driver.name.slice(0, 1)}
          </div>

          <div className="min-w-0">
            <h1 className="text-5xl leading-[1.02] md:text-7xl">{driver.name}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              {driver.country && (
                <span className="text-xl leading-none">{driver.country}</span>
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

      {resultsPending ? (
        <div className="mt-8 space-y-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : !raced ? (
        <p className="mt-10 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-10 text-center text-[var(--color-muted)]">
          No scored results yet for {driver.name}. Their report builds automatically once they take a start.
        </p>
      ) : (
        <>
          <div className="mt-8">
            <DriverReportBody
              driver={driver}
              rows={rows}
              report={report}
              achievements={achievements}
              license={license}
              classes={classes}
              color={color}
            />
          </div>
        </>
      )}
    </div>
  )
}

export { Reveal }
