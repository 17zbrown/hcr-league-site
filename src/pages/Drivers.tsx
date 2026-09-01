import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCurrentSeason, useDrivers, useEntries, useLicenseResults, useSeasonResultsFull, useClasses } from '../lib/queries'
import { buildPaceIndex, computeLicense, resultsForDriver, type LicenseInfo } from '../lib/license'
import { CLASS_ORDER, classColor } from '../lib/format'
import type { ClassId } from '../lib/types'
import { LoadError, Section, Skeleton } from '../components/ui'
import { LicenseBadge } from '../components/LicenseBadge'
import { SearchBox } from '../components/SearchBox'
import { filterBy } from '../lib/search'
import { flagFor } from '../lib/countries'
import { Reveal } from '../components/motion'

type SortKey = 'name' | 'points'
type ClassFilter = 'All' | ClassId

export default function Drivers() {
  const { data: drivers, isLoading, isError, refetch } = useDrivers()
  const { data: licenseResults } = useLicenseResults()
  const { data: season } = useCurrentSeason()
  const { data: seasonRows } = useSeasonResultsFull(season?.id)
  const { data: entries } = useEntries(season?.id)
  const { data: classes } = useClasses()

  /**
   * The car each driver runs this season, keyed by driver id.
   *
   * This used to be read off the driver's team, which meant anyone without a team —
   * guests, fill-ins, and the several drivers who answered the sign-up form's team
   * question with "none" — showed as a numberless "Free agent" despite being on the
   * grid every round.
   */
  const entryByDriver = useMemo(() => {
    const map: Record<string, { number: string; class_id: ClassId; car: string | null }> = {}
    for (const e of entries ?? []) {
      for (const link of e.drivers ?? []) {
        if (link.driver?.id) map[link.driver.id] = { number: e.number, class_id: e.class_id, car: e.car }
      }
    }
    return map
  }, [entries])
  const [sort, setSort] = useState<SortKey>('name')
  const [classFilter, setClassFilter] = useState<ClassFilter>('All')
  const [query, setQuery] = useState('')

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

  /** Classes a driver belongs to: their entry, their team, and anything they raced. */
  const classesByDriver = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    for (const d of drivers ?? []) {
      const set = new Set<string>()
      // The entry comes first: it is the only source that survives a mid-season class
      // switch. Two drivers moved classes after signing up, and their team record still
      // names the class they left.
      const entryClass = entryByDriver[d.id]?.class_id
      if (entryClass) set.add(entryClass)
      if (d.team?.class_id) set.add(d.team.class_id)
      for (const r of resultsForDriver(seasonRows ?? [], d.name)) {
        if (r.class_id) set.add(r.class_id)
      }
      map[d.id] = set
    }
    return map
  }, [drivers, seasonRows, entryByDriver])

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

  const filtered = useMemo(() => {
    const byClass = classFilter === 'All'
      ? sorted
      : sorted.filter((d) => classesByDriver[d.id]?.has(classFilter))
    // Text search runs AFTER the class chips so the two narrow together rather
    // than one silently overriding the other.
    return filterBy(byClass, query, (d) => [
      d.name, d.country, d.team?.name,
      entryByDriver[d.id]?.number, entryByDriver[d.id]?.car, entryByDriver[d.id]?.class_id,
    ])
  }, [sorted, classFilter, classesByDriver, query, entryByDriver])

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
      <div className="mb-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by class">
          {(['All', ...CLASS_ORDER] as ClassFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setClassFilter(key)}
              aria-pressed={classFilter === key}
              className={`hcr-chip ${classFilter === key ? 'hcr-chip-active' : ''}`}
            >
              {key !== 'All' && (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ background: classColor(key, classes), boxShadow: 'inset 0 0 0 1px rgba(20,24,28,0.28)' }}
                />
              )}
              {key}
            </button>
          ))}
        </div>

        <SearchBox
          value={query}
          onChange={setQuery}
          count={filtered.length}
          total={drivers?.length ?? 0}
          placeholder="Search name, country, car or number…"
          className="w-full max-w-sm sm:w-auto sm:flex-1"
        />

        <div className="flex items-center gap-3">
          <span className="eyebrow">Sort</span>
          <div className="flex gap-2" role="group" aria-label="Sort drivers">
            {(['name', 'points'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSort(key)}
                aria-pressed={sort === key}
                className={`hcr-chip ${sort === key ? 'hcr-chip-active' : ''}`}
              >
                {key === 'name' ? 'Name' : 'Points'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isError ? (
        <LoadError what="the roster" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : drivers && filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-line-2)] bg-[var(--color-paper)] p-10 text-center">
          <p className="font-display text-2xl">
            {query.trim() ? 'No drivers match.' : classFilter === 'All' ? 'No drivers yet.' : `No ${classFilter} drivers.`}
          </p>
          <p className="mx-auto mt-2 max-w-sm font-body text-sm text-[var(--color-muted)]">
            {query.trim()
              ? `Nothing matches “${query.trim()}”${classFilter === 'All' ? '' : ` in ${classFilter}`}.`
              : classFilter === 'All'
                ? 'The roster is empty right now.'
                : `No one on the roster is entered or has raced in ${classFilter} this season.`}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d, i) => {
            const teaser = teaserByDriver[d.id]
            const entry = entryByDriver[d.id]
            // Prefer the entry over the team on every field it covers. A team can only
            // speak for a driver who has one, and the entry survives a class switch.
            const shownClass = entry?.class_id ?? d.team?.class_id ?? null
            const dotColor = shownClass ? classColor(shownClass, classes) : null
            const meta = [
              // "Free agent" only when they genuinely have no team — not merely because
              // their car happens to be entered without one.
              d.team?.name ?? (entry ? null : 'Free agent'),
              shownClass, // class in text, not color alone
              entry?.number ? `#${entry.number}` : d.team?.number ? `#${d.team.number}` : null,
              entry?.car ?? null,
              d.irating ? `${d.irating} iR` : null,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <Reveal key={d.id} delay={Math.min(i * 0.03, 0.3)} className="h-full">
                <Link
                  to={`/drivers/${d.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] transition hover:-translate-y-0.5 hover:shadow-card"
                >
                  <div className="flex items-center justify-between gap-3 px-5 pt-5">
                    {licenseByDriver[d.id] ? (
                      <LicenseBadge tier={licenseByDriver[d.id].effective} size="xs" />
                    ) : (
                      <span />
                    )}
                    {dotColor && (
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        title={d.team?.class_id}
                        style={{ background: dotColor, boxShadow: 'inset 0 0 0 1px rgba(20,24,28,0.28)' }}
                      />
                    )}
                  </div>

                  <div className="px-5 pt-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate font-display text-2xl leading-none">{d.name}</span>
                      {/* flagFor turns a stored country NAME into its flag, and passes
                          through an emoji already in the column — the roster holds both
                          since the picker landed, and neither should render as bare text. */}
                      {d.country && (
                        <span className="shrink-0 text-base leading-none" title={d.country}>
                          {flagFor(d.country) || d.country}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 truncate font-mono text-[11px] text-[var(--color-muted)]">{meta}</div>
                  </div>

                  {/* Season teaser — the card's "price" row */}
                  <div className="mt-auto flex items-baseline justify-between gap-2 px-5 pb-4 pt-6">
                    {teaser && teaser.pts > 0 ? (
                      <>
                        <span className="font-display text-2xl leading-none">
                          {teaser.pts}
                          <span className="ml-1.5 font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                            pts
                          </span>
                        </span>
                        {teaser.wins > 0 && (
                          <span className="tabular text-xs text-[var(--color-muted)]">
                            {teaser.wins}W
                          </span>
                        )}
                      </>
                    ) : (
                      <span aria-hidden="true" className="font-mono text-[11px] text-[var(--color-faint)]">
                        &mdash;
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-[var(--color-line)] px-5 py-3.5 font-alt text-[11px] font-bold uppercase tracking-[0.08em] transition-colors group-hover:bg-[var(--color-deep)] group-hover:text-white group-focus-visible:bg-[var(--color-deep)] group-focus-visible:text-white">
                    View profile
                    <span aria-hidden="true">&rarr;</span>
                  </div>
                </Link>
              </Reveal>
            )
          })}
        </div>
      )}
    </Section>
  )
}
