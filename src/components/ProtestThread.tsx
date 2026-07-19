import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useProtestThread } from '../lib/queries'
import { parseClipUrl } from '../lib/evidence'
import { EvidenceBox, type PendingEvidence } from './EvidenceBox'
import { Skeleton } from './ui'
import type { ProtestAttachment, ProtestStatus } from '../lib/types'

const STATUS_STYLE: Record<ProtestStatus, { label: string; bg: string; fg: string }> = {
  open: { label: 'Open', bg: 'var(--color-mist)', fg: 'var(--color-ink-2)' },
  under_review: { label: 'Under review', bg: 'rgba(47,107,255,0.12)', fg: '#2f6bff' },
  resolved: { label: 'Resolved', bg: 'rgba(18,157,111,0.14)', fg: '#0f8f66' },
  dismissed: { label: 'Dismissed', bg: 'rgba(207,33,48,0.10)', fg: 'var(--color-red)' },
}

export function StatusPill({ status }: { status: ProtestStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.open
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  )
}

function Evidence({ items }: { items: ProtestAttachment[] }) {
  if (!items.length) return null
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {items.map((a) => {
        if (a.kind === 'image') {
          return (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-[var(--color-line)]">
              <img src={a.url} alt={a.title ?? 'Evidence screenshot'} className="h-auto w-full object-cover" />
            </a>
          )
        }
        const info = parseClipUrl(a.url)
        return (
          <div key={a.id} className="overflow-hidden rounded-xl border border-[var(--color-line)]">
            {info.embedUrl ? (
              <div className="aspect-video w-full bg-black">
                <iframe
                  src={info.embedUrl}
                  title={info.label}
                  allowFullScreen
                  className="h-full w-full"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : (
              <a href={a.url} target="_blank" rel="noreferrer" className="block p-4 text-sm font-semibold text-[var(--color-blue)] underline">
                {a.title ?? a.url}
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Threaded protest conversation + reply box. Used by the member and race-control views. */
export function ProtestThread({ protestId, canReply = true }: { protestId: string; canReply?: boolean }) {
  const qc = useQueryClient()
  const { session, isRaceControl } = useAuth()
  const { data, isLoading } = useProtestThread(protestId)
  const [body, setBody] = useState('')
  const [evidence, setEvidence] = useState<PendingEvidence[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (isLoading) return <Skeleton className="h-48 w-full" />
  const messages = data?.messages ?? []
  const attachments = data?.attachments ?? []

  const send = async () => {
    if (!body.trim() || !session?.user) return
    setBusy(true)
    setErr(null)
    const { data: msg, error } = await supabase
      .from('protest_messages')
      .insert({ protest_id: protestId, author_id: session.user.id, body: body.trim(), is_staff: isRaceControl })
      .select('id')
      .single()
    if (error) {
      setErr(error.message)
      setBusy(false)
      return
    }
    if (evidence.length) {
      const rows = evidence.map((e) => ({
        protest_id: protestId,
        message_id: msg.id,
        kind: e.kind,
        url: e.url,
        storage_path: e.storage_path ?? null,
        title: e.title ?? null,
      }))
      const att = await supabase.from('protest_attachments').insert(rows)
      if (att.error) setErr(att.error.message)
    }
    setBody('')
    setEvidence([])
    setBusy(false)
    qc.invalidateQueries({ queryKey: ['protest-thread', protestId] })
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  return (
    <div>
      <h3 className="mb-4 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
        Conversation ({messages.length})
      </h3>

      <ol className="space-y-4">
        {messages.map((m) => {
          const mine = m.author_id === session?.user?.id
          return (
            <li
              key={m.id}
              className={`rounded-2xl border p-4 ${
                m.is_staff
                  ? 'border-[var(--color-brand)] bg-[var(--color-cloud)]'
                  : 'border-[var(--color-line)] bg-[var(--color-paper)]'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{m.author?.display_name ?? (mine ? 'You' : 'Member')}</span>
                {m.is_staff && (
                  <span className="rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[10px] font-bold uppercase text-black">
                    Race control
                  </span>
                )}
                <span className="tabular ml-auto font-mono text-xs text-[var(--color-faint)]">
                  {new Date(m.created_at).toLocaleString()}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-line leading-relaxed text-[var(--color-ink-2)]">{m.body}</p>
              <Evidence items={attachments.filter((a) => a.message_id === m.id)} />
            </li>
          )
        })}
        {messages.length === 0 && (
          <li className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-5 text-sm text-[var(--color-muted)]">
            No replies yet.
          </li>
        )}
      </ol>

      {canReply && (
        <div className="mt-6 space-y-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <label className="block">
            <span className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
              {isRaceControl ? 'Respond as race control' : 'Add a reply'}
            </span>
            <textarea
              className="hcr-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={isRaceControl ? 'Explain the ruling or ask for more detail…' : 'Add detail or answer race control…'}
            />
          </label>
          <EvidenceBox items={evidence} onChange={setEvidence} disabled={busy} />
          {err && <p className="text-sm text-[var(--color-red)]">{err}</p>}
          <button onClick={send} disabled={busy || !body.trim()} className="hcr-btn hcr-btn-primary">
            {busy ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      )}
    </div>
  )
}
