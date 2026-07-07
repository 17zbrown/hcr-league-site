import { useMemo } from 'react'
import { useClasses, useTeams } from '../lib/queries'
import { CLASS_ORDER, classColor } from '../lib/format'
import { Section, Skeleton } from '../components/ui'

export default function Teams() {
  const { data: teams, isLoading } = useTeams()
  const { data: classes } = useClasses()

  const byClass = useMemo(() => {
    const g: Record<string, typeof teams> = {}
    for (const t of teams ?? []) (g[t.class_id] ??= []).push(t)
    return g
  }, [teams])

  return (
    <Section eyebrow={`${teams?.length ?? 0} entries`} title="Teams">
      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-12">
          {CLASS_ORDER.map((cls) => {
            const list = byClass[cls] ?? []
            if (!list.length) return null
            const color = classColor(cls, classes)
            return (
              <div key={cls}>
                <div className="mb-4 flex items-center gap-2">
                  <span className="h-4 w-4" style={{ background: color }} />
                  <h3 className="text-3xl uppercase">{cls}</h3>
                  <span className="tabular text-sm text-[var(--color-muted)]">{list.length}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-4 border border-[var(--color-line)] bg-[var(--color-ink-2)] p-4"
                    >
                      <div
                        className="tabular flex h-14 w-14 shrink-0 items-center justify-center font-display text-3xl"
                        style={{ background: 'var(--color-ink-3)', borderLeft: `3px solid ${color}` }}
                      >
                        {t.number}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-display text-2xl leading-tight">{t.name}</div>
                        <div className="truncate text-sm text-[var(--color-muted)]">{t.car}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}
