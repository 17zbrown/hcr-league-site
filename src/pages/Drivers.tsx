import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCurrentSeason, useDrivers, useLicenseResults, useSeasonResultsFull, useClasses } from '../lib/queries'
import { buildPaceIndex, computeLicense, resultsForDriver, type LicenseInfo } from '../lib/license'
import { classColor } from '../lib/format'
import { Section, Skeleton } from '../components/ui'
import { LicenseBadge } from '../components/LicenseBadge'
import { Reveal } from '../components/motion'

type SortKey = 'name' | 'points'

export default function Drivers() {
  const { data: drivers, isLoading } = useDrivers()
  const { data: licenseResults } = useLicenseResults()
  const { data: season } = useCurrentSeason()
  const { data: seasonRows } = useSeasonResultsFull(season?.id)
  const { data: classes } = useClasses()
  const [sort, setSort] = useState<SortKey>('name')

  const licenseByDriver = useMemo(() => {
    const paceIndex = buildPaceIndex(licenseResults ?? [])
    const map: Record<string, LicenseInfo> = {}
    for (const d of drivers ?? []) {
      map[d.id] = computeLicense(resultsForDriver(licenseResults ?? [], d.name), paceIndex, d.license_override)
    }
    return map
  }, [drivers, licenseResults])

  /** Season teaser per driver: points (race + quali + adjust) and class wins. */
  const teaserByDriver = useMemo(() => {
    const map: Record<string, { pts: number; wins: number }> = {}
    if (!seasonRows?.length) return map
    for (const d of drivers ?? []) {
      let pts = 0
      let wins = 0
      for (const r of resultsForDriver(seasonRows, d.name)) {
        if (r.fill_in) continue // Fill-In Cup points stay out of the roster teaser
        pts += (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)
        if (r.cls_pos === 1) wins += 1
      }
      map[d.id] = { pts, wins }
    }
    return map
  }, [drivers, seasonRows])

  const sorted = useMemo(() => {
    const list = [...(drivers ?? [])]
    if (sort === 'points') {
      list.sort(
        (a, b) =>
          (teaserByDriver[b.id]?.pts ?? 0) - (teaserByDriver[a.id]?.pts ?? 0) || a.name.localeCompare(b.name),
      )
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name))
    }
    return list
  }, [drivers, sort, teaserByDriver])

  return (
    <Section
      eyebrow={`${drivers?.length ?? 0} registered`}
      title="Drivers"
      titleTag="h1"
      action={
        <Link to="/compare" className="font-body text-sm font-semibold text-[var(--color-blue)]">
          Head to head &rarr;
        </Link>
      }
    >
      <div className="mb-6 flex items-center gap-3">
        <div className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
          Sort
        </div>
        <div className="flex gap-2">
          {(['name', 'points'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              aria-pressed={sort === key}
              className={`inline-flex min-h-11 items-center rounded-full px-5 font-alt text-xs font-bold uppercase tracking-wider transition-colors ${
                sort === key
                  ? 'bg-[var(--color-deep)] text-white'
                  : 'bg-[var(--color-cloud)] text-[var(--color-ink-2)] hover:bg-[var(--color-mist)]'
              }`}
            >
              {key === 'name' ? 'Name' : 'Points'}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((d, i) => {
            const teaser = teaserByDriver[d.id]
            const dotColor = d.team?.class_id ? classColor(d.team.class_id, classes) : null
            return (
              <Reveal key={d.id} delay={Math.min(i * 0.03, 0.3)}>
                <Link
                  to={`/drivers/${d.id}`}
                  className="flex items-center gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4 transition-all hover:-translate-y-1 hover:shadow-card"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-mist)] font-display text-2xl text-[var(--color-ink)]">
                    {d.team?.number ?? d.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-display text-2xl leading-none">{d.name}</span>
                      {d.country && <span className="text-base leading-none">{d.country}</span>}
                    </div>
                    <div className="mt-1.5 flex min-w-0 items-center gap-2">
                      <span className="truncate font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                        {d.team?.name ?? 'Free agent'}
                      </span>
                      {licenseByDriver[d.id] && <LicenseBadge tier={licenseByDriver[d.id].effective} size="xs" />}
                    </div>
                  </div>
                  {teaser && teaser.pts > 0 && (
                    <div className="tabular shrink-0 text-right text-sm font-medium text-[var(--color-ink-2)]">
                      {teaser.pts} pts
                      {teaser.wins > 0 && <span className="text-[var(--color-muted)]"> &middot; {teaser.wins}W</span>}
                    </div>
                  )}
                  {dotColor && (
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      title={d.team?.class_id}
                      style={{ background: dotColor, boxShadow: 'inset 0 0 0 1px rgba(20,24,28,0.28)' }}
                    />
                  )}
                </Link>
              </Reveal>
            )
          })}
        </div>
      )}
    </Section>
  )
}
