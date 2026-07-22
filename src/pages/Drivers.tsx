import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useDrivers, useLicenseResults } from '../lib/queries'
import { buildPaceIndex, computeLicense, resultsForDriver, type LicenseInfo } from '../lib/license'
import { ClassChip, Section, Skeleton } from '../components/ui'
import { LicenseBadge } from '../components/LicenseBadge'
import { Reveal } from '../components/motion'

export default function Drivers() {
  const { data: drivers, isLoading } = useDrivers()
  const { data: licenseResults } = useLicenseResults()

  const licenseByDriver = useMemo(() => {
    const paceIndex = buildPaceIndex(licenseResults ?? [])
    const map: Record<string, LicenseInfo> = {}
    for (const d of drivers ?? []) {
      map[d.id] = computeLicense(resultsForDriver(licenseResults ?? [], d.name), paceIndex, d.license_override)
    }
    return map
  }, [drivers, licenseResults])

  return (
    <Section eyebrow={`${drivers?.length ?? 0} registered`} title="Drivers" titleTag="h1">
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(drivers ?? []).map((d, i) => (
            <Reveal key={d.id} delay={Math.min(i * 0.03, 0.3)}>
              <Link to={`/drivers/${d.id}`} className="flex items-center gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4 transition-all hover:-translate-y-1 hover:shadow-card">
                <div className="tabular flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-mist)] font-display text-2xl font-extrabold text-[var(--color-ink)]">
                  {d.team?.number ?? d.name.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-display text-2xl leading-none">{d.name}</span>
                    {d.country && <span className="text-lg leading-none">{d.country}</span>}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 truncate text-sm text-[var(--color-muted)]">
                    <span className="truncate">{d.team?.name ?? 'Free agent'}</span>
                    {licenseByDriver[d.id] && <LicenseBadge tier={licenseByDriver[d.id].effective} size="xs" />}
                  </div>
                </div>
                {d.team?.class_id && <ClassChip classId={d.team.class_id} />}
              </Link>
            </Reveal>
          ))}
        </div>
      )}
    </Section>
  )
}
