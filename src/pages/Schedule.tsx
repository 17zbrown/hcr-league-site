import { useCurrentSeason, useEvents } from '../lib/queries'
import { CLASS_ORDER, fmtDateLong } from '../lib/format'
import { ClassChip, Section, Skeleton } from '../components/ui'
import { Reveal } from '../components/motion'

export default function Schedule() {
  const { data: season } = useCurrentSeason()
  const { data: events, isLoading } = useEvents(season?.id)

  return (
    <Section eyebrow={`${season?.name ?? 'Season'} · ${events?.length ?? 0} rounds`} title="Schedule" titleTag="h1">
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <ol className="space-y-3">
          {(events ?? []).map((e, i) => {
            const done = e.status === 'complete'
            const isNext = e.status === 'next'
            return (
              <Reveal as="li" key={e.id} delay={Math.min(i * 0.04, 0.3)}>
                <div
                  className={`grid items-center gap-4 rounded-2xl border p-5 transition-all hover:shadow-card md:grid-cols-[72px_1fr_auto] ${
                    isNext ? 'border-[var(--color-brand)] bg-[var(--color-cloud)]' : 'border-[var(--color-line)] bg-[var(--color-paper)]'
                  } ${done ? 'opacity-60' : ''}`}
                >
                  <div className="font-display text-4xl font-extrabold text-[var(--color-faint)]">
                    {String(e.round).padStart(2, '0')}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-2xl md:text-3xl">{e.name ?? e.track?.name}</h3>
                      {isNext && <span className="rounded-full bg-[var(--color-brand)] px-2.5 py-0.5 text-[11px] font-bold uppercase text-black">Next</span>}
                      {done && <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-faint)]">Final</span>}
                    </div>
                    <div className="mt-1 text-[var(--color-muted)]">
                      {e.track?.name}
                      {e.track?.location ? ` · ${e.track.location}` : ''}
                    </div>
                  </div>
                  <div className="text-left md:text-right">
                    <div className="tabular font-semibold">{fmtDateLong(e.date)}</div>
                    <div className="mt-2 flex gap-1.5 md:justify-end">
                      {CLASS_ORDER.map((c) => (
                        <ClassChip key={c} classId={c} />
                      ))}
                    </div>
                  </div>
                </div>
              </Reveal>
            )
          })}
        </ol>
      )}
    </Section>
  )
}
