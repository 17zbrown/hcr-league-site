import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useClasses, useCurrentSeason, useSeasonResultsFull, useTeams } from '../lib/queries'
import { CLASS_ORDER, classColor } from '../lib/format'
import { ClassChip, LoadError, Section, Skeleton } from '../components/ui'
import { Reveal } from '../components/motion'

export default function Teams() {
  const { data: teams, isLoading, isError, refetch } = useTeams()
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
      if (!r.team_id || r.fill_in) continue // fill-in drives don't bank team points
      m[r.team_id] = (m[r.team_id] ?? 0) + (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)
    }
    return m
  }, [seasonRows])

  return (
    <Section eyebrow={`${teams?.length ?? 0} entries`} title="Teams" titleTag="h1">
      {isError ? (
        <LoadError what="the team list" onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (teams ?? []).length === 0 ? (
        <p className="text-[var(--color-muted)]">No teams have entered yet.</p>
      ) : (
        <div className="space-y-14">
          {CLASS_ORDER.map((cls) => {
            const list = byClass[cls] ?? []
            if (!list.length) return null
            const color = classColor(cls, classes)
            return (
              <div key={cls}>
                <div className="mb-5 flex items-baseline gap-2.5">
                  <span
                    className="h-4 w-4 shrink-0 self-center rounded-sm"
                    style={{ background: color, boxShadow: 'inset 0 0 0 1px rgba(20,24,28,0.22)' }}
                  />
                  <h2 className="text-3xl">{cls}</h2>
                  <span className="tabular text-sm text-[var(--color-muted)]">{list.length}</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((t, i) => {
                    const pts = ptsByTeam[t.id] ?? 0
                    return (
                      <Reveal key={t.id} delay={Math.min(i * 0.03, 0.25)} className="h-full">
                        <Link
                          to={`/teams/${t.id}`}
                          className="group flex h-full flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] transition hover:-translate-y-0.5 hover:shadow-card"
                        >
                          <div className="flex items-center justify-between gap-3 px-5 pt-5">
                            <span className="font-mono text-[11px] text-[var(--color-muted)]">#{t.number}</span>
                            <ClassChip classId={t.class_id} />
                          </div>

                          <div className="px-5 pt-3">
                            <div className="truncate font-display text-2xl leading-tight">{t.name}</div>
                            <div className="mt-2 truncate font-mono text-[11px] text-[var(--color-muted)]">
                              {t.car ?? cls}
                            </div>
                          </div>

                          {/* Season points — the card's "price" row */}
                          <div className="mt-auto flex items-baseline justify-between gap-2 px-5 pb-4 pt-6">
                            {pts > 0 ? (
                              <span className="font-display text-2xl leading-none">
                                {pts}
                                <span className="ml-1.5 font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                                  pts
                                </span>
                              </span>
                            ) : (
                              <span aria-hidden="true" className="font-mono text-[11px] text-[var(--color-faint)]">
                                &mdash;
                              </span>
                            )}
                          </div>

                          <div className="flex items-center justify-between border-t border-[var(--color-line)] px-5 py-3.5 font-alt text-[11px] font-bold uppercase tracking-[0.08em] transition-colors group-hover:bg-[var(--color-deep)] group-hover:text-white group-focus-visible:bg-[var(--color-deep)] group-focus-visible:text-white">
                            Team page
                            <span aria-hidden="true">&rarr;</span>
                          </div>
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
