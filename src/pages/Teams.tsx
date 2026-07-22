import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useClasses, useCurrentSeason, useSeasonResultsFull, useTeams } from '../lib/queries'
import { CLASS_ORDER, classColor } from '../lib/format'
import { Section, Skeleton } from '../components/ui'
import { Reveal } from '../components/motion'

export default function Teams() {
  const { data: teams, isLoading } = useTeams()
  const { data: classes } = useClasses()
  const { data: season } = useCurrentSeason()
  const { data: seasonRows } = useSeasonResultsFull(season?.id)

  const byClass = useMemo(() => {
    const g: Record<string, typeof teams> = {}
    for (const t of teams ?? []) (g[t.class_id] ??= []).push(t)
    return g
  }, [teams])

  /** Season points teaser per team: race + quali + adjust, summed over its result rows. */
  const ptsByTeam = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of seasonRows ?? []) {
      if (!r.team_id) continue
      m[r.team_id] = (m[r.team_id] ?? 0) + (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)
    }
    return m
  }, [seasonRows])

  return (
    <Section eyebrow={`${teams?.length ?? 0} entries`} title="Teams" titleTag="h1">
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
                <div className="mb-4 flex items-center gap-2.5">
                  <span className="h-4 w-4 rounded-sm" style={{ background: color }} />
                  <h3 className="text-3xl">{cls}</h3>
                  <span className="tabular text-sm text-[var(--color-muted)]">{list.length}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((t, i) => {
                    const pts = ptsByTeam[t.id] ?? 0
                    return (
                      <Reveal key={t.id} delay={Math.min(i * 0.03, 0.25)}>
                        <Link
                          to={`/teams/${t.id}`}
                          className="flex items-center gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4 transition-all hover:-translate-y-1 hover:shadow-card"
                        >
                          <div
                            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--color-mist)] font-display text-3xl text-[var(--color-ink)]"
                            style={{ borderLeft: `4px solid ${color}` }}
                          >
                            {t.number}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-display text-2xl leading-tight">{t.name}</div>
                            <div className="mt-1.5 flex min-w-0 items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ background: color, boxShadow: 'inset 0 0 0 1px rgba(20,24,28,0.28)' }}
                              />
                              <span className="truncate font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                                {t.car ?? cls}
                              </span>
                            </div>
                          </div>
                          {pts > 0 && (
                            <div className="tabular shrink-0 text-right text-sm font-medium text-[var(--color-ink-2)]">
                              {pts} pts
                            </div>
                          )}
                        </Link>
                      </Reveal>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}
