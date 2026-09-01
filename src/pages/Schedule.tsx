import { useCurrentSeason, useEvents } from '../lib/queries'
import { CLASS_ORDER, fmtDate, fmtTime } from '../lib/format'
import { Link } from 'react-router-dom'
import { ClassChip, Section, LoadError, Skeleton } from '../components/ui'
import { Reveal } from '../components/motion'

export default function Schedule() {
  const { data: season } = useCurrentSeason()
  const { data: events, isLoading, isError, refetch } = useEvents(season?.id)

  return (
    <Section eyebrow={`${season?.name ?? 'Season'} · ${events?.length ?? 0} rounds`} title="Schedule" titleTag="h1">
      {isError ? (
        <LoadError what="the schedule" onRetry={() => refetch()} />
      ) : !isLoading && (events ?? []).length === 0 ? (
        <p className="text-[var(--color-muted)]">The calendar hasn't been published yet.</p>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : (
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(events ?? []).map((e, i) => {
            const done = e.status === 'complete'
            const isNext = e.status === 'next'
            return (
              <Reveal as="li" key={e.id} delay={Math.min(i * 0.04, 0.3)} className="h-full">
                <Link
                  to={`/schedule/${e.id}`}
                  className={`group flex h-full flex-col overflow-hidden rounded-xl border bg-[var(--color-paper)] transition-all hover:-translate-y-0.5 hover:shadow-card ${
                    isNext ? 'border-[var(--color-brand)]' : 'border-[var(--color-line)]'
                  } ${done ? 'opacity-70' : ''}`}
                >
                  <div className="flex-1 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={`font-display text-5xl leading-none ${
                          isNext ? 'text-[var(--color-ink)]' : 'text-[var(--color-line-2)]'
                        }`}
                      >
                        {String(e.round).padStart(2, '0')}
                      </span>
                      {isNext && (
                        <span className="rounded-full bg-[var(--color-brand)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-black">
                          Next
                        </span>
                      )}
                      {done && (
                        <span className="rounded-full border border-[var(--color-line-2)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-muted)]">
                          Final
                        </span>
                      )}
                    </div>
                    <h3 className="mt-4 text-2xl leading-tight">{e.name ?? e.track?.name}</h3>
                    <div className="mt-1 text-sm text-[var(--color-muted)]">
                      {e.track?.name}
                      {e.track?.location ? ` · ${e.track.location}` : ''}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] pt-3">
                      <span className="tabular text-xs font-semibold text-[var(--color-ink-2)]">
                        {fmtDate(e.date)} · {fmtTime(e.date)}
                      </span>
                      <span className="flex gap-1.5">
                        {CLASS_ORDER.map((c) => (
                          <ClassChip key={c} classId={c} />
                        ))}
                      </span>
                    </div>
                  </div>
                  {/* Full-width action bar — the catalog card's "Add to cart" */}
                  <div
                    className={`flex min-h-11 items-center justify-between px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] ${
                      isNext
                        ? 'bg-[var(--color-deep)] text-white'
                        : 'border-t border-[var(--color-line)] bg-[var(--color-mist)] text-[var(--color-ink)]'
                    }`}
                  >
                    Race details
                    <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
                  </div>
                </Link>
              </Reveal>
            )
          })}
        </ol>
      )}
    </Section>
  )
}
