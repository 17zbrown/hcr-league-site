import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useDrivers, usePendingChangeRequests } from '../lib/queries'
import { Skeleton } from './ui'

const LABEL: Record<string, string> = {
  number: 'Car number',
  car: 'Car model',
  class: 'Class',
  extra_car: 'Additional car',
  team: 'Form a team',
}

interface QueueRow {
  id: string
  kind: string
  current_value: string | null
  requested_value: string
  note: string | null
  created_at: string
  driver?: { name: string } | null
  team?: { name: string } | null
  entry?: { number: string; class_id: string; car: string | null } | null
  /** kind='team' only: the other drivers named. Ids, resolved to names for display. */
  teammate_ids?: string[] | null
}

/**
 * Race Control's decision queue for number / car / class changes and applications
 * for an additional team car.
 *
 * Approving APPLIES the change server-side in the same call that records the
 * decision. That is deliberate: a queue that only marks something "approved" and
 * relies on a steward to then go and edit the entry is a queue that silently
 * produces half-done decisions.
 */
export function ChangeRequestQueue() {
  const qc = useQueryClient()
  const { data: rows, isLoading } = usePendingChangeRequests()
  const { data: drivers } = useDrivers()
  // Resolved once rather than per row: a queue of twenty team requests would otherwise
  // scan the roster twenty times over.
  const driversById = new Map((drivers ?? []).map((d) => [d.id, d]))
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const decide = async (id: string, approve: boolean) => {
    setBusy(id)
    setErr(null)
    const { error } = await supabase.rpc('decide_change_request', {
      p_id: id,
      p_approve: approve,
      p_note: notes[id]?.trim() || null,
    })
    setBusy(null)
    if (error) {
      // A number taken between the ask and the decision is the common case, and the
      // message names who holds it.
      setErr(error.message.replace(/^.*?:\s*/, ''))
      return
    }
    qc.invalidateQueries({ queryKey: ['change-requests'] })
    qc.invalidateQueries({ queryKey: ['entries'] })
    qc.invalidateQueries({ queryKey: ['teams'] })
  }

  if (isLoading) return <Skeleton className="h-40 w-full" />

  const list = (rows ?? []) as QueueRow[]
  if (!list.length) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-line-2)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-muted)]">
        No change requests waiting. Drivers and team managers file these from their own portals.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {err && <p className="rounded-lg bg-[var(--color-red)]/10 px-3 py-2 text-sm text-[var(--color-red)]">{err}</p>}
      {list.map((r) => (
        <div key={r.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="rounded-full bg-[var(--color-brand)]/25 px-2.5 py-1 text-[11px] font-semibold text-[var(--color-ink)]">
              {LABEL[r.kind] ?? r.kind}
            </span>
            <span className="font-semibold">{r.driver?.name ?? r.team?.name ?? 'Unknown'}</span>
            {r.entry && (
              <span className="font-mono text-xs text-[var(--color-muted)]">
                {r.entry.class_id} #{r.entry.number}
                {r.entry.car ? ` · ${r.entry.car}` : ''}
              </span>
            )}
          </div>

          <p className="mt-2 text-sm">
            {r.current_value ? (
              <>
                <span className="text-[var(--color-muted)]">{r.current_value}</span>
                <span aria-hidden> → </span>
              </>
            ) : r.kind === 'extra_car' ? (
              <span className="text-[var(--color-muted)]">Applying to run an additional car as </span>
            ) : null}
            <strong>{r.requested_value}</strong>
          </p>
          {/* A team request is the only kind whose substance is not in requested_value.
              Approving one without seeing the line-up would be deciding blind, so the
              names are resolved and shown rather than left as ids in the database. */}
          {r.kind === 'team' && (
            <p className="mt-2 text-sm">
              <span className="text-[var(--color-muted)]">With: </span>
              {(r.teammate_ids ?? []).length === 0 ? (
                <span className="text-[var(--color-red)]">nobody named — decline this</span>
              ) : (
                <strong>
                  {(r.teammate_ids ?? [])
                    .map((id) => driversById.get(id)?.name ?? 'a driver no longer on the roster')
                    .join(', ')}
                </strong>
              )}
            </p>
          )}
          {r.note && <p className="mt-1 text-sm text-[var(--color-muted)]">“{r.note}”</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="hcr-input !py-2 !text-xs flex-1 min-w-48"
              value={notes[r.id] ?? ''}
              onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
              placeholder="Reason (shown to them — worth filling in on a decline)"
              maxLength={300}
            />
            <button
              onClick={() => decide(r.id, true)}
              disabled={busy === r.id}
              className="hcr-btn hcr-btn-dark !py-2 !text-xs"
            >
              Approve &amp; apply
            </button>
            <button
              onClick={() => decide(r.id, false)}
              disabled={busy === r.id}
              className="hcr-btn hcr-btn-ghost !py-2 !text-xs"
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
