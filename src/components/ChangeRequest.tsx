import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { CLASS_ORDER } from '../lib/format'

export type ChangeKind = 'number' | 'car' | 'class' | 'extra_car'

const LABEL: Record<ChangeKind, string> = {
  number: 'Car number',
  car: 'Car model',
  class: 'Class',
  extra_car: 'An additional car',
}

/**
 * Ask Race Control for a change.
 *
 * Number, car and class are all requests rather than edits — the grid is published,
 * the standings are keyed to it, and letting a driver silently change their own class
 * mid-season would rewrite what the results mean. Approval APPLIES the change server
 * side, so a decision can never be made and then forgotten.
 *
 * A team manager is the exception for their own car's NUMBER: they own it outright
 * and edit it directly (see set_entry_number). This form is for everything else.
 */
export function ChangeRequestForm({
  kinds,
  entryId,
  driverId,
  teamId,
  current,
  onDone,
}: {
  kinds: ChangeKind[]
  entryId?: string | null
  driverId?: string | null
  teamId?: string | null
  /** What it is now, per kind — shown so the ask reads as a diff. */
  current?: Partial<Record<ChangeKind, string | null>>
  onDone?: () => void
}) {
  const [kind, setKind] = useState<ChangeKind>(kinds[0])
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const submit = async () => {
    const v = value.trim()
    if (!v) { setErr('Say what you would like it changed to.'); return }
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('submit_change_request', {
      p_kind: kind,
      p_requested_value: v,
      p_entry_id: entryId ?? null,
      p_driver_id: driverId ?? null,
      p_team_id: teamId ?? null,
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) {
      // The number check speaks in plain language already; anything else is a
      // permission or connection problem and reads better verbatim.
      setErr(error.message.replace(/^.*?:\s*/, ''))
      return
    }
    setSent(true)
    setValue('')
    setNote('')
    onDone?.()
    setTimeout(() => setSent(false), 4000)
  }

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
      <div className="mb-3 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
        Request a change
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs text-[var(--color-muted)]">What</span>
          <select className="hcr-select !py-2 !text-sm" value={kind} onChange={(e) => { setKind(e.target.value as ChangeKind); setValue('') }}>
            {kinds.map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs text-[var(--color-muted)]">
            Change to{current?.[kind] ? ` (now ${current[kind]})` : ''}
          </span>
          {kind === 'class' ? (
            <select className="hcr-select !py-2 !text-sm" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Pick a class…</option>
              {CLASS_ORDER.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <input
              className="hcr-input !py-2 !text-sm"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode={kind === 'number' || kind === 'extra_car' ? 'numeric' : 'text'}
              maxLength={kind === 'number' || kind === 'extra_car' ? 4 : 80}
              placeholder={
                kind === 'number' ? 'e.g. 27'
                  : kind === 'extra_car' ? 'Number for the new car'
                  : 'e.g. Ferrari 296 GT3'
              }
            />
          )}
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs text-[var(--color-muted)]">Why (optional)</span>
          <input
            className="hcr-input !py-2 !text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Anything race control should know"
          />
        </label>
      </div>

      {err && <p className="mt-3 rounded-lg bg-[var(--color-red)]/10 px-3 py-2 text-xs text-[var(--color-red)]">{err}</p>}
      {sent && (
        <p className="mt-3 rounded-lg bg-[var(--color-green)]/10 px-3 py-2 text-xs text-[var(--color-green)]">
          Sent to race control. You’ll see it here until they decide.
        </p>
      )}

      <button onClick={submit} disabled={busy || !value.trim()} className="hcr-btn hcr-btn-dark mt-3 !py-2 !text-xs">
        {busy ? 'Sending…' : 'Send request'}
      </button>
      <p className="mt-2 text-xs text-[var(--color-faint)]">
        Numbers are league-wide — one car per number across every class. A number
        already taken is refused here rather than wasting a steward’s time.
      </p>
    </div>
  )
}

/** A member's or team's own requests, with what race control said. */
export function ChangeRequestList({ rows }: { rows: ChangeRequestRow[] }) {
  if (!rows.length) return null
  return (
    <ul className="mt-3 space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm">
          <span className="font-semibold">{LABEL[r.kind as ChangeKind] ?? r.kind}</span>
          <span className="text-[var(--color-muted)]">
            {r.current_value ? `${r.current_value} → ` : ''}<strong className="text-[var(--color-ink)]">{r.requested_value}</strong>
          </span>
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              r.status === 'approved' ? 'bg-[var(--color-green)]/12 text-[var(--color-green)]'
                : r.status === 'declined' ? 'bg-[var(--color-red)]/12 text-[var(--color-red)]'
                : 'bg-[var(--color-brand)]/25 text-[var(--color-ink)]'
            }`}
          >
            {r.status === 'pending' ? 'Waiting on race control' : r.status}
          </span>
          {r.decision_note && (
            <span className="w-full text-xs text-[var(--color-muted)]">Race control: {r.decision_note}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

export interface ChangeRequestRow {
  id: string
  kind: string
  current_value: string | null
  requested_value: string
  note: string | null
  status: 'pending' | 'approved' | 'declined'
  decision_note: string | null
  created_at: string
}
