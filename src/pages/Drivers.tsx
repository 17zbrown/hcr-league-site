import { useDrivers } from '../lib/queries'
import { ClassChip, Section, Skeleton } from '../components/ui'

export default function Drivers() {
  const { data: drivers, isLoading } = useDrivers()

  return (
    <Section eyebrow={`${drivers?.length ?? 0} registered`} title="Drivers">
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(drivers ?? []).map((d) => (
            <div
              key={d.id}
              className="group flex items-center gap-4 border border-[var(--color-line)] bg-[var(--color-ink-2)] p-4 transition-colors hover:border-[var(--color-line-2)]"
            >
              <div className="tabular flex h-12 w-12 shrink-0 items-center justify-center bg-[var(--color-ink-3)] font-display text-2xl">
                {d.team?.number ?? d.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-display text-2xl leading-none">{d.name}</span>
                  {d.country && <span className="text-lg leading-none">{d.country}</span>}
                </div>
                <div className="mt-1 truncate text-sm text-[var(--color-muted)]">
                  {d.team?.name ?? 'Free agent'}
                </div>
              </div>
              {d.team?.class_id && <ClassChip classId={d.team.class_id} />}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
