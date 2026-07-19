import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useProtests } from '../../lib/queries'
import { fmtDateLong } from '../../lib/format'
import { Section, Skeleton } from '../../components/ui'
import { StatusPill } from '../../components/ProtestThread'
import type { ProtestStatus } from '../../lib/types'

const FILTERS: { id: ProtestStatus | 'all' | 'queue'; label: string }[] = [
  { id: 'queue', label: 'Needs action' },
  { id: 'open', label: 'Open' },
  { id: 'under_review', label: 'Under review' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'all', label: 'All' },
]

export default function RaceControlPortal() {
  const { isAdmin } = useAuth()
  const { data: protests, isLoading } = useProtests()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('queue')

  const counts = useMemo(() => {
    const c = { open: 0, under_review: 0, resolved: 0, dismissed: 0 }
    for (const p of protests ?? []) c[p.status] = (c[p.status] ?? 0) + 1
    return c
  }, [protests])

  const rows = useMemo(() => {
    const list = protests ?? []
    if (filter === 'all') return list
    if (filter === 'queue') return list.filter((p) => p.status === 'open' || p.status === 'under_review')
    return list.filter((p) => p.status === filter)
  }, [protests, filter])

  return (
    <Section eyebrow="Stewarding · Protests &amp; incidents" title="Race Control" titleTag="h1">
      <div className="mb-6 flex flex-wrap gap-2">
        <Link to="/portal" className="hcr-btn hcr-btn-ghost !text-xs">My Portal →</Link>
        {isAdmin && <Link to="/admin" className="hcr-btn hcr-btn-ghost !text-xs">Admin Portal →</Link>}
      </div>

      {/* queue summary — real counts, not decoration */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ['Open', counts.open],
          ['Under review', counts.under_review],
          ['Resolved', counts.resolved],
          ['Dismissed', counts.dismissed],
        ] as const).map(([label, n]) => (
          <div key={label} className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
            <div className="tabular font-display text-3xl font-extrabold">{n}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{label}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-[var(--color-line)]">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`relative px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider transition-colors ${
              filter === f.id ? 'text-[var(--color-ink)]' : 'text-[var(--color-faint)] hover:text-[var(--color-ink)]'
            }`}
          >
            {f.label}
            {filter === f.id && <span className="absolute inset-x-0 -bottom-px h-[3px] bg-[var(--color-brand)]" />}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-8 text-center text-[var(--color-muted)]">
          Nothing here. {filter === 'queue' ? 'The queue is clear.' : 'No protests with this status.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                to={`/control/protests/${p.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 transition-all hover:-translate-y-0.5 hover:shadow-card"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-xl font-extrabold uppercase">{p.category ?? 'Protest'}</span>
                    {p.against_text && <span className="text-sm text-[var(--color-muted)]">vs {p.against_text}</span>}
                  </div>
                  <div className="tabular mt-1 text-xs text-[var(--color-faint)]">
                    {p.event ? `Round ${p.event.round} · ${p.event.name ?? p.event.track?.name} · ` : ''}
                    {p.filer?.display_name ? `${p.filer.display_name} · ` : ''}
                    {fmtDateLong(p.created_at)}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-[var(--color-ink-2)]">{p.summary}</p>
                </div>
                <StatusPill status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
