import { useEffect, useMemo, useState } from 'react'
import { useClasses, useCurrentSeason, useEvents, useResults } from '../lib/queries'
import { CLASS_ORDER, classColor, fmtDateLong } from '../lib/format'
import { lapToSeconds } from '../lib/license'
import { useAuth } from '../lib/auth'
import { resultListsDriver } from '../lib/attribution'
import { Section, Skeleton } from '../components/ui'
import { DriverName } from '../components/links'

/** The editorial micro-label: tiny, letterspaced, muted. */
const MICRO = 'font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]'

export default function Results() {
  const { data: season } = useCurrentSeason()
  const { data: events } = useEvents(season?.id)
  const completed = useMemo(
    () => (events ?? []).filter((e) => e.status === 'complete').sort((a, b) => b.round - a.round),
    [events],
  )
  const [eventId, setEventId] = useState<string | undefined>()
  useEffect(() => {
    if (!eventId && completed.length) setEventId(completed[0].id)
  }, [completed, eventId])

  const active = completed.find((e) => e.id === eventId)

  return (
    <Section eyebrow={`${season?.name ?? 'Season'} · Race results`} title="Results" titleTag="h1">
      {completed.length === 0 ? (
        <p className="text-[var(--color-muted)]">No races have been run yet this season.</p>
      ) : (
        <>
          <div className="mb-8 flex flex-wrap gap-2">
            {completed.map((e) => {
              const isActive = e.id === eventId
              return (
                <button
                  key={e.id}
                  onClick={() => setEventId(e.id)}
                  className={`rounded-xl border px-4 py-2.5 text-left transition-all ${
                    isActive
                      ? 'on-navy shadow-card border-transparent bg-[var(--color-deep)]'
                      : 'border-[var(--color-line)] bg-[var(--color-paper)] hover:border-[var(--color-line-2)]'
                  }`}
                >
                  <div className={MICRO}>Round {e.round}</div>
                  <div className="font-display text-xl">
                    <span className={isActive ? 'border-b-2 border-[var(--color-brand)] pb-px' : ''}>
                      {e.track?.name}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {active && (
            <div className="mb-6">
              <h3 className="text-3xl">{active.name}</h3>
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
  const { data: results, isLoading } = useResults(eventId)
  const { data: classes } = useClasses()
  const { profile } = useAuth()
  const meName = profile?.display_name ?? null

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div className="space-y-10">
      {CLASS_ORDER.map((cls) => {
        const color = classColor(cls, classes)
        const rows = (results ?? [])
          .filter((r) => r.class_id === cls)
          .sort((a, b) => (a.cls_pos ?? 99) - (b.cls_pos ?? 99))
        if (!rows.length) return null
        // fastest lap in class (F1-style highlight)
        let flId: string | null = null
        let flSec = Infinity
        for (const r of rows) {
          const s = lapToSeconds(r.best_lap)
          if (s != null && s < flSec) { flSec = s; flId = r.id }
        }
        return (
          <div key={cls}>
            <div className="mb-3 flex items-baseline gap-3">
              <span
                className="h-2.5 w-2.5 shrink-0 self-center rounded-full"
                style={{ background: color, boxShadow: 'inset 0 0 0 1px rgba(20,24,28,0.28)' }}
                aria-hidden
              />
              <h3 className="text-2xl leading-none">{cls}</h3>
              <span className={MICRO}>{rows.length} {rows.length === 1 ? 'car' : 'cars'}</span>
              <span className="h-px flex-1 self-center bg-[var(--color-line)]" aria-hidden />
            </div>
            <div className="shadow-card relative overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]">
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[var(--color-paper)] sm:hidden" aria-hidden />
              <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-line)] bg-[var(--color-mist)] text-left font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
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
                </thead>
                <tbody>
                  {rows.map((r) => {
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
                            {r.cls_pos}
                          </span>
                        )}
                      </td>
                      <td className="tabular px-4 py-3 text-[var(--color-muted)]">#{r.number}</td>
                      <td className="px-4 py-3 font-semibold">
                        <span className="inline-flex items-center gap-2">
                          <DriverName text={r.drivers_text} />
                          {isMe && <span className="rounded bg-[var(--color-brand)] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-black">You</span>}
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
                      <td className="tabular px-4 py-3 text-center">{r.inc ?? '—'}</td>
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
      })}

      {report && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-6 md:p-8">
          <div className={`${MICRO} mb-3`}>Race Report</div>
          <div className="font-body max-w-prose whitespace-pre-line leading-relaxed text-[var(--color-ink-2)]">{report}</div>
        </div>
      )}
    </div>
  )
}
