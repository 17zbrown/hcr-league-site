import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { CAR_SUGGESTIONS } from '../lib/cars'
import { CLASS_ORDER, fmtTime } from '../lib/format'
import { useMyTeamApplications } from '../lib/queries'
import type { TeamApplication } from '../lib/types'

/**
 * The acknowledgement, and its version.
 *
 * Versioned because the tick is a record rather than a checkbox: if a manager's
 * drivers later misbehave and the league leans on this, it has to be able to show
 * the exact wording that was accepted. Change the words, change the version — never
 * edit v1 in place.
 */
export const TERMS_VERSION = 'v1-2026-09'

export const TERMS_TEXT = [
  'Approving this application makes me the manager of this team.',
  "I accept responsibility for my drivers' conduct — keeping them fair and respectful towards other competitors and league staff.",
  'I accept that I may be held accountable for their actions, including penalties applied to me or to my team.',
]

/**
 * A driver asks to found a team.
 *
 * Four fields and a tick. The tick is enforced server-side too (apply_for_team
 * refuses without it), so this is a clear presentation of the bargain rather than
 * the only thing standing between somebody and a team.
 *
 * Race Control decides. The name, the number and the class all land in the
 * published grid and the standings, so none of them can be self-granted.
 */
export function TeamApplicationForm({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [classId, setClassId] = useState<string>(CLASS_ORDER[0])
  const [car, setCar] = useState('')
  const [number, setNumber] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const submit = async () => {
    setErr(null)
    if (!name.trim()) { setErr('Give the team a name.'); return }
    if (!car.trim()) { setErr('Say which car the team will run.'); return }
    if (!number.trim()) { setErr('Pick a car number.'); return }
    if (!accepted) { setErr('You have to accept the team manager responsibilities before applying.'); return }

    setBusy(true)
    const { error } = await supabase.rpc('apply_for_team', {
      p_team_name: name.trim(),
      p_class_id: classId,
      p_car: car.trim(),
      p_number: number.trim(),
      p_terms_accepted: accepted,
      p_terms_version: TERMS_VERSION,
    })
    setBusy(false)
    if (error) {
      setErr(error.message.replace(/^.*?:\s*/, ''))
      return
    }
    setSent(true)
    setName(''); setCar(''); setNumber(''); setAccepted(false)
    qc.invalidateQueries({ queryKey: ['team-applications'] })
    onDone?.()
    setTimeout(() => setSent(false), 5000)
  }

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
      <div className="mb-3 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
        Apply to found a team
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs text-[var(--color-muted)]">Team name</span>
          <input
            className="hcr-input !py-2 !text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Brown Motorsport"
            maxLength={60}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs text-[var(--color-muted)]">Class</span>
          <select
            className="hcr-select !py-2 !text-sm"
            value={classId}
            onChange={(e) => { setClassId(e.target.value); setCar('') }}
          >
            {CLASS_ORDER.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs text-[var(--color-muted)]">Car number</span>
          <input
            className="hcr-input tabular !py-2 !text-sm"
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
            inputMode="numeric"
            placeholder="e.g. 17"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs text-[var(--color-muted)]">Car</span>
          <input
            className="hcr-input !py-2 !text-sm"
            value={car}
            onChange={(e) => setCar(e.target.value)}
            placeholder="Named as it appears in iRacing"
            list="hcr-team-car-suggestions"
            maxLength={80}
          />
          <datalist id="hcr-team-car-suggestions">
            {CAR_SUGGESTIONS[classId]?.map((c) => <option key={c} value={c} />)}
          </datalist>
        </label>
      </div>

      {/* The bargain, stated before the tick rather than behind a link. */}
      <div className="mt-4 rounded-lg border border-[var(--color-line-2)] bg-[var(--color-cloud)] p-4">
        <div className="eyebrow mb-2">What you are taking on</div>
        <ul className="ml-4 list-disc space-y-1.5 text-sm text-[var(--color-ink-2)]">
          {TERMS_TEXT.map((t) => <li key={t}>{t}</li>)}
        </ul>
        <label className="mt-3 flex cursor-pointer items-start gap-3 border-t border-[var(--color-line)] pt-3">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => { setAccepted(e.target.checked); setErr(null) }}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand)]"
          />
          <span className="text-sm font-semibold">
            I have read the above and accept these responsibilities.
          </span>
        </label>
      </div>

      {err && (
        <p role="alert" className="mt-3 rounded-lg bg-[var(--color-red)]/10 px-3 py-2 text-sm text-[var(--color-red)]">
          {err}
        </p>
      )}
      {sent && (
        <p role="status" className="mt-3 rounded-lg bg-[var(--color-green)]/10 px-3 py-2 text-sm text-[var(--color-green)]">
          Application sent — race control vote on these as a group.
        </p>
      )}

      <button
        onClick={submit}
        disabled={busy || !accepted}
        className="hcr-btn hcr-btn-primary mt-4 !py-2 !text-sm disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Apply to found a team'}
      </button>
    </div>
  )
}

/** A driver's own applications and where each one got to. */
export function TeamApplicationList({ rows }: { rows: TeamApplication[] }) {
  if (!rows.length) return null
  return (
    <ul className="space-y-2">
      {rows.map((a) => (
        <li key={a.id} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{a.team_name}</span>
            <StatusTag status={a.status} />
          </div>
          <div className="tabular mt-1 text-xs text-[var(--color-muted)]">
            {a.class_id} · #{a.number} · {a.car}
          </div>
          <div className="mt-1 text-xs text-[var(--color-faint)]">
            Applied {fmtTime(a.created_at)}
          </div>
          {a.decision_note && (
            <p className="mt-2 border-t border-[var(--color-line)] pt-2 text-xs text-[var(--color-ink-2)]">
              Race control: {a.decision_note}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

function StatusTag({ status }: { status: string }) {
  const tone =
    status === 'approved' ? 'text-[var(--color-green)]'
    : status === 'declined' ? 'text-[var(--color-red)]'
    : 'text-[var(--color-muted)]'
  return (
    <span className={`font-mono text-[11px] font-bold uppercase tracking-wider ${tone}`}>
      {status}
    </span>
  )
}

/**
 * The whole Action-center block: the form, or the reason there is nothing to fill in,
 * plus whatever the driver has already sent.
 *
 * A driver who already manages a team is shown that rather than a second form —
 * founding two teams is not a thing the league does, and the server would refuse it
 * anyway once they are on a roster.
 */
export function TeamApplicationCard({ managesTeam, hasDriver }: { managesTeam: boolean; hasDriver: boolean }) {
  const { data: apps } = useMyTeamApplications()
  const rows = apps ?? []
  const pending = rows.find((a) => a.status === 'pending')

  if (managesTeam) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-line-2)] bg-[var(--color-paper)] p-5 text-sm text-[var(--color-muted)]">
        You already manage a team. Your roster and its cars live in the Team tab.
      </p>
    )
  }

  if (!hasDriver) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-line-2)] bg-[var(--color-paper)] p-5 text-sm text-[var(--color-muted)]">
        You need a driver profile before you can found a team — enter the season from
        the My car tab first.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {pending && (
        <p className="rounded-lg bg-[var(--color-brand)]/10 px-4 py-3 text-sm">
          Your application for <strong>{pending.team_name}</strong> is with race control,
          who vote on it as a group. Sending again replaces it rather than adding a second.
        </p>
      )}
      <TeamApplicationForm />
      {rows.length > 0 && (
        <div>
          <div className="eyebrow mb-2 mt-4">Your applications</div>
          <TeamApplicationList rows={rows} />
        </div>
      )}
    </div>
  )
}
