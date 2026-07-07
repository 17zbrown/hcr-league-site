import { useCurrentSeason, useEvents } from '../lib/queries'
import { fmtDateLong } from '../lib/format'
import { ClassChip, Section, Skeleton } from '../components/ui'
import { CLASS_ORDER } from '../lib/format'

export default function Schedule() {
  const { data: season } = useCurrentSeason()
  const { data: events, isLoading } = useEvents(season?.id)

  return (
    <Section eyebrow={`${season?.name ?? 'Season'} · ${events?.length ?? 0} rounds`} title="Schedule">
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <ol className="space-y-3">
          {(events ?? []).map((e) => {
            const done = e.status === 'complete'
            const isNext = e.status === 'next'
            return (
              <li
                key={e.id}
                className={`grid items-center gap-4 border bg-[var(--color-ink-2)] p-5 md:grid-cols-[70px_1fr_auto] ${
                  isNext ? 'border-[var(--color-brand)]' : 'border-[var(--color-line)]'
                } ${done ? 'opacity-60' : ''}`}
              >
                <div className="tabular text-4xl font-bold text-[var(--color-muted)]">
                  {String(e.round).padStart(2, '0')}
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-2xl md:text-3xl">{e.name ?? e.track?.name}</h3>
                    {isNext && <span className="eyebrow text-[var(--color-brand)]">Next</span>}
                    {done && <span className="eyebrow">Final</span>}
                  </div>
                  <div className="mt-1 text-[var(--color-muted)]">
                    {e.track?.name}
                    {e.track?.location ? ` · ${e.track.location}` : ''}
                  </div>
                </div>
                <div className="text-left md:text-right">
                  <div className="tabular font-medium">{fmtDateLong(e.date)}</div>
                  <div className="mt-2 flex gap-1.5 md:justify-end">
                    {CLASS_ORDER.map((c) => (
                      <ClassChip key={c} classId={c} />
                    ))}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Section>
  )
}
