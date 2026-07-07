import { useEffect, useMemo, useState } from 'react'
import { useClasses, useCurrentSeason, useEvents, useResults } from '../lib/queries'
import { CLASS_ORDER, classColor, fmtDateLong } from '../lib/format'
import { Section, Skeleton } from '../components/ui'

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
    <Section eyebrow={`${season?.name ?? 'Season'} · Race results`} title="Results">
      {completed.length === 0 ? (
        <p className="text-[var(--color-muted)]">No races have been run yet this season.</p>
      ) : (
        <>
          <div className="mb-8 flex flex-wrap gap-2">
            {completed.map((e) => (
              <button
                key={e.id}
                onClick={() => setEventId(e.id)}
                className={`rounded-xl border px-4 py-2.5 text-left transition-all ${
                  e.id === eventId
                    ? 'border-[var(--color-brand)] bg-[var(--color-cloud)] shadow-card'
                    : 'border-[var(--color-line)] bg-[var(--color-paper)] hover:border-[var(--color-line-2)]'
                }`}
              >
                <div className="tabular text-xs font-semibold text-[var(--color-muted)]">ROUND {e.round}</div>
                <div className="font-display text-xl font-extrabold uppercase">{e.track?.name}</div>
              </button>
            ))}
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

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div className="space-y-10">
      {CLASS_ORDER.map((cls) => {
        const color = classColor(cls, classes)
        const rows = (results ?? [])
          .filter((r) => r.class_id === cls)
          .sort((a, b) => (a.cls_pos ?? 99) - (b.cls_pos ?? 99))
        if (!rows.length) return null
        return (
          <div key={cls}>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="h-4 w-4 rounded-sm" style={{ background: color }} />
              <h3 className="text-2xl uppercase">{cls}</h3>
              <span className="tabular text-sm text-[var(--color-muted)]">{rows.length} cars</span>
            </div>
            <div className="shadow-card overflow-x-auto rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]">
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
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-mist)]">
                      <td className="px-4 py-3">
                        <span
                          className="tabular inline-flex h-7 w-7 items-center justify-center rounded-md font-bold"
                          style={{ background: r.cls_pos === 1 ? color : 'var(--color-mist)', color: r.cls_pos === 1 ? '#000' : 'var(--color-ink)' }}
                        >
                          {r.cls_pos}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3 text-[var(--color-muted)]">#{r.number}</td>
                      <td className="px-4 py-3 font-semibold">{r.drivers_text}</td>
                      <td className="tabular px-4 py-3 text-center">{r.grid ?? '—'}</td>
                      <td className="tabular px-4 py-3 text-center">{r.laps ?? '—'}</td>
                      <td className="tabular px-4 py-3">{r.best_lap ?? '—'}</td>
                      <td className="tabular px-4 py-3 text-center">{r.inc ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={r.status === 'DNF' ? 'font-semibold text-[var(--color-red)]' : 'text-[var(--color-muted)]'}>
                          {r.status ?? '—'}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3 text-right font-bold">{(r.points ?? 0) + (r.quali_points ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {report && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-6 md:p-8">
          <h3 className="eyebrow mb-3">Race Report</h3>
          <div className="max-w-3xl whitespace-pre-line leading-relaxed text-[var(--color-ink-2)]">{report}</div>
        </div>
      )}
    </div>
  )
}
