import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useProtest, useProtestThread } from '../../lib/queries'
import { fmtDateLong } from '../../lib/format'
import { Skeleton } from '../../components/ui'
import { ProtestThread, StatusPill } from '../../components/ProtestThread'
import { parseClipUrl } from '../../lib/evidence'
import type { ProtestStatus } from '../../lib/types'

const STATUSES: ProtestStatus[] = ['open', 'under_review', 'resolved', 'dismissed']

/** Single protest — members see their own, race control sees any (plus ruling controls). */
export default function ProtestDetail() {
  const { id } = useParams()
  const { isRaceControl } = useAuth()
  const { data: protest, isLoading } = useProtest(id)
  const { data: thread } = useProtestThread(id)

  if (isLoading) return <div className="container-hcr py-16"><Skeleton className="h-96 w-full" /></div>
  if (!protest) {
    return (
      <div className="container-hcr flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="text-4xl">Protest not found</h1>
        <Link to={isRaceControl ? '/control' : '/portal'} className="mt-6 text-[var(--color-blue)]">← Back</Link>
      </div>
    )
  }

  // evidence filed with the protest itself (no message_id)
  const opening = (thread?.attachments ?? []).filter((a) => !a.message_id)

  return (
    <div className="container-hcr py-12 md:py-16">
      <Link
        to={isRaceControl ? '/control' : '/portal'}
        className="mb-6 inline-block text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        ← {isRaceControl ? 'Race control queue' : 'My portal'}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-line)] pb-6">
        <div className="min-w-0">
          <div className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
            {protest.event ? `Round ${protest.event.round} · ${protest.event.name ?? protest.event.track?.name}` : 'Protest'}
          </div>
          <h1 className="mt-2 text-4xl md:text-5xl">{protest.category ?? 'Protest'}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-muted)]">
            {protest.against_text && <span>Against <strong className="text-[var(--color-ink-2)]">{protest.against_text}</strong></span>}
            {protest.incident_lap && <span className="tabular">{protest.incident_lap}</span>}
            <span className="tabular">Filed {fmtDateLong(protest.created_at)}</span>
            {isRaceControl && protest.filer?.display_name && <span>by {protest.filer.display_name}</span>}
          </div>
        </div>
        <StatusPill status={protest.status} />
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <div>
          {/* opening statement */}
          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
            <h2 className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">The incident</h2>
            <p className="mt-2 whitespace-pre-line leading-relaxed text-[var(--color-ink-2)]">{protest.summary}</p>
            {opening.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {opening.map((a) => {
                  if (a.kind === 'image') {
                    return (
                      <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-[var(--color-line)]">
                        <img src={a.url} alt={a.title ?? 'Evidence'} className="h-auto w-full object-cover" />
                      </a>
                    )
                  }
                  const info = parseClipUrl(a.url)
                  return (
                    <div key={a.id} className="overflow-hidden rounded-xl border border-[var(--color-line)]">
                      {info.embedUrl ? (
                        <div className="aspect-video w-full bg-black">
                          <iframe src={info.embedUrl} title={info.label} allowFullScreen className="h-full w-full" referrerPolicy="strict-origin-when-cross-origin" />
                        </div>
                      ) : (
                        <a href={a.url} target="_blank" rel="noreferrer" className="block p-4 text-sm font-semibold text-[var(--color-blue)] underline">{a.title ?? a.url}</a>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* verdict, once issued */}
          {protest.verdict && (
            <div className="mt-6 rounded-2xl border-2 border-[var(--color-brand)] bg-[var(--color-cloud)] p-5">
              <h2 className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-2)]">Race control ruling</h2>
              <p className="mt-2 whitespace-pre-line leading-relaxed text-[var(--color-ink)]">{protest.verdict}</p>
              {protest.penalty && (
                <p className="mt-3 font-alt text-sm font-bold uppercase tracking-wide">Penalty: {protest.penalty}</p>
              )}
            </div>
          )}

          <div className="mt-8">
            <ProtestThread protestId={protest.id} />
          </div>
        </div>

        {isRaceControl && <RulingPanel protestId={protest.id} status={protest.status} verdict={protest.verdict} penalty={protest.penalty} />}
      </div>
    </div>
  )
}

function RulingPanel({
  protestId, status, verdict, penalty,
}: { protestId: string; status: ProtestStatus; verdict: string | null; penalty: string | null }) {
  const qc = useQueryClient()
  const { session } = useAuth()
  const [s, setS] = useState<ProtestStatus>(status)
  const [v, setV] = useState(verdict ?? '')
  const [p, setP] = useState(penalty ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setBusy(true); setErr(null)
    const decided = s === 'resolved' || s === 'dismissed'
    const { error } = await supabase
      .from('protests')
      .update({
        status: s,
        verdict: v.trim() || null,
        penalty: p.trim() || null,
        decided_by: decided ? session?.user?.id ?? null : null,
        decided_at: decided ? new Date().toISOString() : null,
      })
      .eq('id', protestId)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setSaved(true); setTimeout(() => setSaved(false), 1600)
    qc.invalidateQueries({ queryKey: ['protest', protestId] })
    qc.invalidateQueries({ queryKey: ['protests'] })
  }

  return (
    <aside className="h-fit rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 lg:sticky lg:top-24">
      <h2 className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Issue a ruling</h2>
      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Status</span>
          <select className="hcr-select" value={s} onChange={(e) => setS(e.target.value as ProtestStatus)}>
            {STATUSES.map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Ruling</span>
          <textarea className="hcr-textarea" value={v} onChange={(e) => setV(e.target.value)} placeholder="Explain the decision — this is shown to the filer." />
        </label>
        <label className="block">
          <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Penalty</span>
          <input className="hcr-input" value={p} onChange={(e) => setP(e.target.value)} placeholder="e.g. 5s time penalty · No further action" />
        </label>
        {err && <p className="text-sm text-[var(--color-red)]">{err}</p>}
        <button onClick={save} disabled={busy} className="hcr-btn hcr-btn-primary w-full">
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Publish ruling'}
        </button>
        <p className="text-xs text-[var(--color-faint)]">The filer is notified as soon as you publish.</p>
      </div>
    </aside>
  )
}
