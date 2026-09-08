import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { usePendingTeamApplications, useTeamApplicationVotes } from '../lib/queries'
import { fmtTime } from '../lib/format'
import { Skeleton } from './ui'

/**
 * Race Control's queue for applications to found a team.
 *
 * A team application CARRIES ON A VOTE, not on one steward's click. Approving hands
 * somebody authority over other drivers, so it takes 50% + 1 of the stewarding body
 * — and the database settles the application the moment either side reaches that,
 * so nobody has to remember to come back and close it.
 *
 * The Commissioner keeps an override, shown only to them. Somebody has to be able to
 * move when the rest of the staff are asleep and a season is starting.
 */
export function TeamApplicationQueue() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const { data: rows, isLoading } = usePendingTeamApplications()
  const { data: allVotes } = useTeamApplicationVotes()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  // The Commissioner is the is_admin BOOLEAN, not the 'admin' role — every senior
  // steward has the role, one account has the boolean. Matches is_commissioner().
  const isCommissioner = !!profile?.is_admin
  const me = profile?.id

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['team-applications'] })
    qc.invalidateQueries({ queryKey: ['teams'] })
    qc.invalidateQueries({ queryKey: ['drivers'] })
  }

  const vote = async (id: string, approve: boolean) => {
    setBusy(id); setErr(null); setMsg(null)
    const { data, error } = await supabase.rpc('vote_team_application', {
      p_id: id, p_approve: approve, p_note: notes[id]?.trim() || null,
    })
    setBusy(null)
    if (error) { setErr(error.message.replace(/^.*?:\s*/, '')); return }
    const r = data as { approvals: number; declines: number; needed: number; settled: boolean; status: string } | null
    if (r) {
      setMsg(r.settled
        ? `Vote carried — the application is ${r.status}.`
        : `Vote recorded: ${r.approvals} for, ${r.declines} against. ${r.needed} needed to carry.`)
    }
    refresh()
  }

  const override = async (id: string, approve: boolean) => {
    setBusy(id); setErr(null); setMsg(null)
    const { error } = await supabase.rpc('decide_team_application', {
      p_id: id, p_approve: approve, p_note: notes[id]?.trim() || null,
    })
    setBusy(null)
    if (error) { setErr(error.message.replace(/^.*?:\s*/, '')); return }
    setMsg(approve ? 'Approved by the Commissioner.' : 'Declined by the Commissioner.')
    refresh()
  }

  if (isLoading) return <Skeleton className="h-32 w-full" />

  const list = rows ?? []
  if (!list.length) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-line-2)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-muted)]">
        No team applications waiting. Drivers file these from the Action center in their portal.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {err && <p role="alert" className="rounded-lg bg-[var(--color-red)]/10 px-3 py-2 text-sm text-[var(--color-red)]">{err}</p>}
      {msg && <p role="status" className="rounded-lg bg-[var(--color-green)]/10 px-3 py-2 text-sm text-[var(--color-green)]">{msg}</p>}

      {list.map((a) => {
        const yes = a.approvals
        const no = a.declines
        const need = a.needed
        const mine = (allVotes ?? []).find((v) => v.application_id === a.id && v.voter_id === me)
        // A steward's own application is decided without them — including the
        // Commissioner's, whose override is refused on it server-side too.
        const isMine = a.applied_by === me

        return (
          <div key={a.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="rounded-full bg-[var(--color-brand)]/25 px-2.5 py-1 text-[11px] font-semibold text-[var(--color-ink)]">
                New team
              </span>
              <span className="text-lg font-semibold">{a.team_name}</span>
              <span className="text-sm text-[var(--color-muted)]">
                founded by {a.driver_name ?? 'unknown driver'}
              </span>
            </div>

            <div className="tabular mt-2 text-sm">{a.class_id} · #{a.number} · {a.car}</div>

            <p className="mt-2 text-xs text-[var(--color-faint)]">
              Applied {fmtTime(a.created_at)} · accepted the manager terms ({a.terms_version}) {fmtTime(a.terms_accepted_at)}
            </p>

            {/* The tally, as a bar rather than a sentence — a steward should see how
                close this is at a glance. */}
            <div className="mt-3 rounded-lg bg-[var(--color-cloud)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                  Race control vote
                </span>
                <span className="tabular text-sm font-semibold">
                  {yes} for · {no} against — {need} needed
                </span>
              </div>
              <div className="mt-2 flex gap-1" aria-hidden>
                {Array.from({ length: Math.max(need, yes + no) }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${i < yes ? 'bg-[var(--color-green)]' : i < yes + no ? 'bg-[var(--color-red)]' : 'bg-[var(--color-line-2)]'}`}
                  />
                ))}
              </div>
              {mine && (
                <p className="mt-2 text-xs text-[var(--color-muted)]">
                  You voted <strong>{mine.approve ? 'for' : 'against'}</strong>. Voting again replaces it.
                </p>
              )}
            </div>

            <p className="mt-3 rounded-lg bg-[var(--color-cloud)] px-3 py-2 text-xs text-[var(--color-ink-2)]">
              Carrying creates the team, moves {a.driver_name ?? 'the applicant'} onto it,
              and makes them its manager.
            </p>

            <input
              className="hcr-input mt-3 !py-2 !text-sm"
              placeholder="Note back to them (optional)"
              value={notes[a.id] ?? ''}
              onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
            />

            {isMine ? (
              <p className="mt-3 rounded-lg border border-dashed border-[var(--color-line-2)] px-3 py-2 text-sm text-[var(--color-muted)]">
                This is your own application. The rest of race control decide it without you.
              </p>
            ) : (
            <>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => vote(a.id, true)}
                disabled={busy === a.id}
                className="hcr-btn hcr-btn-primary !py-2 !text-sm disabled:opacity-50"
              >
                {busy === a.id ? 'Working…' : mine?.approve ? 'Voted for' : 'Vote to approve'}
              </button>
              <button
                onClick={() => vote(a.id, false)}
                disabled={busy === a.id}
                className="hcr-btn hcr-btn-ghost !py-2 !text-sm disabled:opacity-50"
              >
                {mine && !mine.approve ? 'Voted against' : 'Vote to decline'}
              </button>
            </div>

            {isCommissioner && (
              <div className="mt-3 border-t border-dashed border-[var(--color-line-2)] pt-3">
                <div className="eyebrow mb-2">Commissioner override</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => override(a.id, true)}
                    disabled={busy === a.id}
                    className="hcr-btn hcr-btn-dark !py-2 !text-sm disabled:opacity-50"
                  >
                    Approve now
                  </button>
                  <button
                    onClick={() => override(a.id, false)}
                    disabled={busy === a.id}
                    className="hcr-btn hcr-btn-ghost !py-2 !text-sm disabled:opacity-50"
                  >
                    Decline now
                  </button>
                </div>
                <p className="mt-2 text-xs text-[var(--color-faint)]">
                  Settles it immediately, whatever the tally.
                </p>
              </div>
            )}
            </>
            )}
          </div>
        )
      })}
    </div>
  )
}
