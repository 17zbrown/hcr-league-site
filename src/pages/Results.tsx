import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useClasses, useCurrentSeason, useEvents, useResults } from '../lib/queries'
import { CLASS_ORDER, classColor, fmtDateLong } from '../lib/format'
import { lapToSeconds } from '../lib/license'
import { useAuth } from '../lib/auth'
import { resultListsDriver } from '../lib/attribution'
import { LoadError, Section, Skeleton } from '../components/ui'
import { DriverName } from '../components/links'
import { ColumnFilterRow, ColumnFilterToggle, useColumnFilters } from '../components/SearchBox'
import type { ClassId, RaceResult } from '../lib/types'

/** The editorial micro-label: tiny, letterspaced, muted. */
const MICRO = 'font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]'

export default function Results() {
  const { data: season } = useCurrentSeason()
  const { data: events, isError: eventsError, refetch: refetchEvents } = useEvents(season?.id)
  const completed = useMemo(
    () => (events ?? []).filter((e) => e.status === 'complete').sort((a, b) => b.round - a.round),
    [events],
  )
  // The selected round rides in ?event= so a result can be LINKED — the home
  // cards, race pages and Discord posts all point at a specific round, and state
  // that lives only in memory made every one of them land on the newest instead.
  const [params, setParams] = useSearchParams()
  const eventId = params.get('event') ?? undefined
  const setEventId = (id: string) => setParams({ event: id }, { replace: false })
  useEffect(() => {
    if (!eventId && completed.length) setParams({ event: completed[0].id }, { replace: true })
  }, [completed, eventId, setParams])

  const active = completed.find((e) => e.id === eventId)

  return (
    <Section eyebrow={`${season?.name ?? 'Season'} · Race results`} title="Results" titleTag="h1">
      {eventsError ? (
        <LoadError what="the race calendar" onRetry={() => refetchEvents()} />
      ) : completed.length === 0 ? (
        <p className="text-[var(--color-muted)]">No races have been run yet this season.</p>
      ) : (
        <>
          <div className="mb-8 flex flex-wrap gap-2">
            {completed.map((e) => {
              const isActive = e.id === eventId
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setEventId(e.id)}
                  aria-pressed={isActive}
                  className={`hcr-chip ${isActive ? 'hcr-chip-active' : ''}`}
                >
                  <span className="tabular">R{e.round}</span>
                  {e.track?.name}
                </button>
              )
            })}
          </div>

          {active && (
            <div className="mb-6">
              <h2 className="text-3xl">{active.name ?? active.track?.name ?? `Round ${active.round}`}</h2>
              <div className="tabular mt-1 text-[var(--color-muted)]">
                {active.track?.name} · {fmtDateLong(active.date)}
              </div>
            </div>
          )}

          {eventId && <ResultsTable eventId={eventId} report={active?.report ?? null} />}
        </>
      )}
    </Section>
  )
}

function ResultsTable({ eventId, report }: { eventId: string; report: string | null }) {
  const { data: results, isLoading, isError: resultsError, refetch: refetchResults } = useResults(eventId)
  const { data: classes } = useClasses()
  const { profile } = useAuth()
  const meName = profile?.display_name ?? null

  if (isLoading) return <Skeleton className="h-96 w-full" />
  if (resultsError) return <LoadError what="this round's results" onRetry={() => refetchResults()} />

  return (
    <div className="space-y-10">
      {CLASS_ORDER.map((cls) => (
        <ClassTable
          key={cls}
          cls={cls}
          color={classColor(cls, classes)}
          rows={(results ?? [])
            .filter((r) => r.class_id === cls)
            .sort((a, b) => (a.cls_pos ?? 99) - (b.cls_pos ?? 99))}
          meName={meName}
        />
      ))}

      {report && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-6 md:p-8">
          <div className={`${MICRO} mb-3`}>Race Report</div>
          <div className="font-body max-w-prose whitespace-pre-line leading-relaxed text-[var(--color-ink-2)]">{report}</div>
        </div>
      )}
    </div>
  )
}

/**
 * One class's classification. Its own component so each table can hold its own
 * column filters — three tables share this page, and a hook cannot live in a map.
 */
function ClassTable({
  cls,
  color,
  rows,
  meName,
}: {
  cls: ClassId
  color: string
  rows: RaceResult[]
  meName: string | null
}) {
  const cf = useColumnFilters<RaceResult>({
    pos: (r) => r.cls_pos,
    number: (r) => r.number,
    driver: (r) => r.drivers_text,
    grid: (r) => r.grid,
    laps: (r) => r.laps,
    best: (r) => r.best_lap,
    inc: (r) => r.inc,
    status: (r) => r.status,
    pts: (r) => (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0),
  })

  if (!rows.length) return null

  // Fastest lap in class (F1-style highlight) — found across the whole class, so
  // filtering the table never moves the FL badge onto a slower car.
  let flId: string | null = null
  let flSec = Infinity
  for (const r of rows) {
    const s = lapToSeconds(r.best_lap)
    if (s != null && s < flSec) { flSec = s; flId = r.id }
  }

  const shown = cf.apply(rows)

  return (
          <div className="shadow-card overflow-hidden rounded-xl border border-[var(--color-line)]">
            {/* Class header — black bar, inverted via on-navy tokens */}
            <div className="on-navy flex items-center gap-3 bg-[var(--color-deep)] px-4 py-3 sm:px-5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: color, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.3)' }}
                aria-hidden
              />
              <h3 className="text-xl leading-none">{cls}</h3>
              <span className="ml-auto font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                {cf.active > 0
                  ? `${shown.length} of ${rows.length} cars`
                  : `${rows.length} ${rows.length === 1 ? 'car' : 'cars'}`}
              </span>
              <ColumnFilterToggle ctl={cf} className="!py-1 !text-[10px]" />
            </div>
            <div className="relative bg-[var(--color-paper)]">
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[var(--color-paper)] sm:hidden" aria-hidden />
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${cls} classification`}>
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="font-body border-b border-[var(--color-line)] bg-[var(--color-mist)] text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                    <th className="px-4 py-3">Pos</th>
                    <th className="px-4 py-3">No.</th>
                    <th className="px-4 py-3">Driver</th>
                    <th className="px-4 py-3 text-center">Grid</th>
                    <th className="px-4 py-3 text-center">Laps</th>
                    <th className="px-4 py-3">Best Lap</th>
                    <th className="px-4 py-3 text-center">Inc</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Pts</th>
                  </tr>
                  <ColumnFilterRow
                    ctl={cf}
                    cells={[
                      { key: 'pos', label: 'Position' },
                      { key: 'number', label: 'Car number' },
                      { key: 'driver', label: 'Driver' },
                      { key: 'grid', label: 'Grid' },
                      { key: 'laps', label: 'Laps' },
                      { key: 'best', label: 'Best lap' },
                      { key: 'inc', label: 'Incidents' },
                      { key: 'status', label: 'Status' },
                      { key: 'pts', label: 'Points' },
                    ]}
                  />
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-[var(--color-muted)]">
                        No cars in {cls} match these column filters.
                      </td>
                    </tr>
                  )}
                  {shown.map((r) => {
                    const isMe = !!meName && resultListsDriver(r.drivers_text, meName)
                    const delta = r.grid != null && r.pos != null ? r.grid - r.pos : null
                    const podium = r.cls_pos != null && r.cls_pos <= 3
                    return (
                    <tr
                      key={r.id}
                      className={`border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-mist)] ${isMe ? 'bg-[var(--color-brand)]/[0.09]' : ''}`}
                      style={!isMe && r.cls_pos === 1 ? { background: `${color}14` } : undefined}
                    >
                      <td className="px-4 py-3">
                        {podium ? (
                          <span className="font-display text-2xl leading-none">P{r.cls_pos}</span>
                        ) : (
                          <span
                            className="tabular inline-flex h-7 w-7 items-center justify-center rounded-md font-bold"
                            style={{ background: 'var(--color-mist)', color: 'var(--color-ink)' }}
                          >
                            {r.cls_pos ?? '—'}
                          </span>
                        )}
                      </td>
                      <td className="tabular px-4 py-3 text-[var(--color-muted)]">#{r.number}</td>
                      <td className="px-4 py-3 font-semibold">
                        <span className="inline-flex items-center gap-2">
                          <DriverName text={r.drivers_text} />
                          {isMe && <span className="rounded bg-[var(--color-brand)] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-black">You</span>}
                          {r.fill_in && (
                            <span className="rounded border border-[var(--color-line-2)] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-[var(--color-muted)]" title="Fill-in entry — scores the Fill-In Cup, not the championship">
                              Fill-In
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1.5">
                          {r.grid ?? '—'}
                          {delta != null && delta !== 0 && (
                            <span className={`text-[11px] font-bold ${delta > 0 ? 'text-[var(--color-green)]' : 'text-[var(--color-red)]'}`}>
                              {delta > 0 ? `▲${delta}` : `▼${-delta}`}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3 text-center">{r.laps ?? '—'}</td>
                      <td className="tabular px-4 py-3">
                        {r.best_lap ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className={r.id === flId ? 'font-bold text-[var(--color-brand-deep)]' : ''}>{r.best_lap}</span>
                            {r.id === flId && (
                              <span className="rounded bg-[var(--color-brand)] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-black" title="Fastest lap in class">FL</span>
                            )}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="tabular px-4 py-3 text-center">{r.inc != null ? `${r.inc}x` : '—'}</td>
                      <td className="px-4 py-3">
                        <span className={r.status === 'DNF' ? 'font-semibold text-[var(--color-red)]' : 'text-[var(--color-muted)]'}>
                          {r.status ?? '—'}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3 text-right font-bold">{(r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)}</td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </div>
          </div>
  )
}
