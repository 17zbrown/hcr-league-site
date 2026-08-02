import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import {
  useCurrentSeason,
  useDrivers,
  useEvents,
  useSeasonResults,
  useTeams,
} from '../../lib/queries'
import { computeStandings } from '../../lib/standings'
import { CLASS_ORDER, calendarDate, fmtDate } from '../../lib/format'
import type { NewsArticle, RaceEvent } from '../../lib/types'
import { ClassChip, Skeleton } from '../../components/ui'

// ---------------- local queries ----------------

interface OpenProtestLite {
  id: string
  status: string
  summary: string | null
  created_at: string
}

/**
 * Open + under-review protests. One fetch serves both the stat card (count)
 * and the activity feed (rows). RLS may deny non-race-control readers — the
 * card simply doesn't render when this errors.
 */
function useOpenProtests() {
  return useQuery({
    queryKey: ['protests', 'open-count'],
    retry: 1,
    queryFn: async (): Promise<OpenProtestLite[]> => {
      const { data, error } = await supabase
        .from('protests')
        .select('id, status, summary, created_at')
        .in('status', ['open', 'under_review'])
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as OpenProtestLite[]
    },
  })
}

type NewsLite = Pick<NewsArticle, 'id' | 'title' | 'is_published' | 'published_at' | 'created_at'>

/** Every story, drafts included (admin RLS grants full reads on `news`). */
function useNewsOverview() {
  return useQuery({
    queryKey: ['news', 'admin-overview'],
    queryFn: async (): Promise<NewsLite[]> => {
      const { data, error } = await supabase
        .from('news')
        .select('id, title, is_published, published_at, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as NewsLite[]
    },
  })
}

// ---------------- activity feed ----------------

interface ActivityItem {
  key: string
  ts: number
  dateIso: string
  text: string
  draft?: boolean
  source: 'Results' | 'Story' | 'Protest'
}

const truncate = (s: string, max = 72) =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s

function buildActivity(
  events: RaceEvent[] | undefined,
  news: NewsLite[] | undefined,
  protests: OpenProtestLite[] | undefined,
): ActivityItem[] {
  const items: ActivityItem[] = []

  for (const e of events ?? []) {
    if (e.status !== 'complete') continue
    const where = e.name ?? e.track?.name ?? null
    items.push({
      key: `event-${e.id}`,
      ts: calendarDate(e.date).getTime(),
      dateIso: e.date,
      text: `Results posted · R${e.round}${where ? ` · ${truncate(where, 40)}` : ''}`,
      source: 'Results',
    })
  }

  for (const n of news ?? []) {
    const iso = (n.is_published ? n.published_at : null) ?? n.created_at
    items.push({
      key: `news-${n.id}`,
      ts: new Date(iso).getTime(),
      dateIso: iso,
      text: `Story · ${truncate(n.title || 'Untitled')}`,
      draft: !n.is_published,
      source: 'Story',
    })
  }

  for (const p of protests ?? []) {
    items.push({
      key: `protest-${p.id}`,
      ts: new Date(p.created_at).getTime(),
      dateIso: p.created_at,
      text: `Protest · ${truncate(p.summary || 'No summary')}`,
      source: 'Protest',
    })
  }

  return items
    .filter((i) => Number.isFinite(i.ts))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 8)
}

// ---------------- small pieces ----------------

function SourceChip({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-full border border-[var(--color-line-2)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
      {children}
    </span>
  )
}

function StatCard({
  label,
  value,
  hint,
  onClick,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  onClick?: () => void
}) {
  const inner = (
    <>
      <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        {label}
      </div>
      <div className="mt-2 font-display text-5xl leading-none">{value}</div>
      {hint && <div className="mt-2 text-xs text-[var(--color-muted)]">{hint}</div>}
    </>
  )
  const base = 'rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5'
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} w-full cursor-pointer text-left transition-colors hover:border-[var(--color-line-2)]`}
      >
        {inner}
      </button>
    )
  }
  return <div className={base}>{inner}</div>
}

// ---------------- panel ----------------

export default function DashboardOverview({
  onNavigate,
}: {
  /** Jump to a sibling dashboard tab (e.g. 'results', 'news', 'protests'). */
  onNavigate?: (tab: string) => void
}) {
  const { data: season, isLoading: seasonLoading } = useCurrentSeason()
  const { data: events, isLoading: eventsLoading } = useEvents(season?.id)
  const { data: drivers, isLoading: driversLoading } = useDrivers()
  const { data: teams } = useTeams()
  const { data: seasonResults, isLoading: resultsLoading } = useSeasonResults(season?.id)
  const protestsQ = useOpenProtests()
  const newsQ = useNewsOverview()

  const go = (tab: string) => (onNavigate ? () => onNavigate(tab) : undefined)

  const completedCount = (events ?? []).filter((e) => e.status === 'complete').length
  const totalRounds = events?.length ?? 0
  const nextEvent = (events ?? []).find((e) => e.status !== 'complete')
  const progressPct = totalRounds > 0 ? Math.round((completedCount / totalRounds) * 100) : 0

  const driverCount = drivers?.length ?? 0
  const freeAgents = (drivers ?? []).filter((d) => !d.team_id).length
  const openProtests = protestsQ.data?.length ?? 0
  const publishedCount = (newsQ.data ?? []).filter((n) => n.is_published).length
  const draftCount = (newsQ.data ?? []).length - publishedCount

  const standings = useMemo(
    () => computeStandings(seasonResults ?? [], teams ?? []),
    [seasonResults, teams],
  )

  const activity = useMemo(
    () => buildActivity(events, newsQ.data, protestsQ.data),
    [events, newsQ.data, protestsQ.data],
  )
  const feedLoading = newsQ.isLoading || protestsQ.isLoading

  if (seasonLoading || eventsLoading || driversLoading) {
    return (
      <div>
        <h2 className="mb-6 text-3xl">Overview</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
        <Skeleton className="mt-4 h-24 w-full" />
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-2 text-3xl">Overview</h2>
      <p className="mb-6 text-sm text-[var(--color-muted)]">
        {season?.name ?? 'The season'} at a glance — rounds, standings, stories, and protests.
      </p>

      {/* Row 1 — stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Rounds complete"
          value={
            <>
              {completedCount}
              <span className="text-2xl text-[var(--color-muted)]"> / {totalRounds}</span>
            </>
          }
          hint={
            totalRounds === 0
              ? 'No events on the calendar yet'
              : nextEvent
                ? `Next: R${nextEvent.round}${nextEvent.track?.name ? ` · ${nextEvent.track.name}` : ''}`
                : 'Season complete'
          }
          onClick={go('results')}
        />
        <StatCard
          label="Drivers on roster"
          value={driverCount}
          hint={`${teams?.length ?? 0} teams · ${freeAgents} free agent${freeAgents === 1 ? '' : 's'}`}
          onClick={go('drivers')}
        />
        {!protestsQ.isError && (
          <StatCard
            label="Open protests"
            value={protestsQ.isLoading ? '—' : openProtests}
            hint={
              protestsQ.isLoading
                ? 'Checking the stewards’ inbox…'
                : openProtests > 0
                  ? 'Awaiting a steward call'
                  : 'All clear'
            }
            onClick={go('protests')}
          />
        )}
        <StatCard
          label="Published stories"
          value={newsQ.isLoading || newsQ.isError ? '—' : publishedCount}
          hint={
            newsQ.isError
              ? 'Could not load stories'
              : draftCount > 0
                ? `${draftCount} draft${draftCount === 1 ? '' : 's'} waiting`
                : 'No drafts in progress'
          }
          onClick={go('news')}
        />
      </div>

      {/* Row 2 — season progress + recent activity */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="on-navy rounded-xl border border-[var(--color-line)] bg-[var(--color-deep)] p-6">
          <h3 className="text-xl">Season progress</h3>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-2)]">
            {season?.name ?? 'No current season'}
          </div>

          <div className="mt-5">
            <div className="flex items-baseline justify-between font-mono text-xs text-[var(--color-ink-2)]">
              <span className="uppercase tracking-wider">Rounds</span>
              <span className="tabular-nums">
                {completedCount} / {totalRounds}
              </span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-mist)]"
              role="progressbar"
              aria-label="Rounds complete"
              aria-valuemin={0}
              aria-valuemax={totalRounds}
              aria-valuenow={completedCount}
            >
              <div
                className="h-full rounded-full bg-[var(--color-brand)]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="mt-6 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-2)]">
            Championship leaders
          </div>
          {resultsLoading ? (
            <div className="mt-3 space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {CLASS_ORDER.map((cls) => {
                const leader = standings.drivers[cls][0]
                return (
                  <div
                    key={cls}
                    className="flex items-center justify-between gap-3 rounded-lg bg-[var(--color-cloud)] px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ClassChip classId={cls} />
                      <span className="truncate text-sm font-semibold">
                        {leader ? leader.name : 'No results yet'}
                      </span>
                    </div>
                    {leader && (
                      <span className="shrink-0 font-mono text-sm tabular-nums">
                        {leader.points} pts
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
          <h3 className="text-xl">Recent activity</h3>
          {feedLoading ? (
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-muted)]">
              Nothing yet — import a round&rsquo;s results or write a story and it shows up here.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-line)]">
              {activity.map((a) => (
                <li key={a.key} className="flex items-center gap-3 py-2.5">
                  <span className="w-24 shrink-0 font-mono text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                    {fmtDate(a.dateIso)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {a.text}
                    {a.draft && (
                      <span className="ml-2 inline-block rounded-full border border-[var(--color-line-2)] px-1.5 py-0.5 align-middle font-mono text-[9px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                        Draft
                      </span>
                    )}
                  </span>
                  <SourceChip>{a.source}</SourceChip>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Row 3 — quick actions */}
      <div className="mt-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-5">
        <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
          Quick actions
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="hcr-btn hcr-btn-primary" onClick={go('results')}>
            Import results
          </button>
          <button type="button" className="hcr-btn hcr-btn-dark" onClick={go('news')}>
            Write a story
          </button>
          <button type="button" className="hcr-btn hcr-btn-ghost" onClick={go('automation')}>
            Automation
          </button>
          <button type="button" className="hcr-btn hcr-btn-ghost" onClick={go('schedule')}>
            Schedule
          </button>
        </div>
      </div>
    </div>
  )
}
