import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useCurrentSeason, useDrivers, useEvents, usePenalties } from '../lib/queries'
import { fmtDateLong } from '../lib/format'
import { Skeleton } from './ui'

/**
 * Penalty kinds, mirroring rulebook §27.3 so the screen and the rules cannot drift.
 * `unit` is null where the penalty has no magnitude — a warning is a warning, and
 * asking "how many" would be nonsense.
 */
const KINDS: { id: string; label: string; unit: string | null; hint: string }[] = [
  { id: 'warning',    label: 'Warning',              unit: null,       hint: 'On the record, no sporting effect.' },
  { id: 'time',       label: 'Time penalty',         unit: 'seconds',  hint: 'Added to their race time.' },
  { id: 'position',   label: 'Position penalty',     unit: 'positions',hint: 'Dropped this many places in the classification.' },
  { id: 'points',     label: 'Points penalty',       unit: 'points',   hint: 'Deducted from the standings — applied automatically.' },
  { id: 'grid',       label: 'Grid penalty',         unit: 'places',   hint: 'Served at the next round.' },
  { id: 'race_dsq',   label: 'Race disqualification',unit: null,       hint: 'Out of that race’s results.' },
  { id: 'suspension', label: 'Suspension',           unit: 'rounds',   hint: 'Cannot enter for this many rounds.' },
  { id: 'season_dsq', label: 'Season disqualification', unit: null,    hint: 'Out for the rest of the season.' },
]

const kindOf = (id: string) => KINDS.find((k) => k.id === id)

export function PenaltyPanel() {
  const qc = useQueryClient()
  const { data: season } = useCurrentSeason()
  const { data: drivers } = useDrivers()
  const { data: events } = useEvents(season?.id)
  const { data: penalties, isLoading } = usePenalties(season?.id)

  const [driverId, setDriverId] = useState('')
  const [kind, setKind] = useState('warning')
  const [eventId, setEventId] = useState('')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const meta = kindOf(kind)!
  const sortedDrivers = useMemo(
    () => [...(drivers ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [drivers],
  )

  const issue = async () => {
    if (!driverId) { setErr('Pick the driver this applies to.'); return }
    if (!reason.trim()) { setErr('Give a reason — it is published to the drivers.'); return }
    if (meta.unit && !(Number(value) > 0)) { setErr(`A ${meta.label.toLowerCase()} needs a ${meta.unit} amount.`); return }
    setBusy(true); setErr(null); setOk(null)
    const { data, error } = await supabase.rpc('issue_penalty', {
      p_driver_id: driverId,
      p_kind: kind,
      p_reason: reason.trim(),
      p_event_id: eventId || null,
      p_value: meta.unit ? Number(value) : null,
      p_notes: notes.trim() || null,
    })
    setBusy(false)
    if (error) { setErr(error.message.replace(/^.*?:\s*/, '')); return }
    // The RPC reports when a points deduction could not reach the standings. That is
    // the one outcome a steward must see rather than assume.
    setOk((data as { warning?: string | null })?.warning ?? 'Penalty issued and published to race control announcements.')
    setValue(''); setReason(''); setNotes('')
    qc.invalidateQueries({ queryKey: ['penalties'] })
    qc.invalidateQueries({ queryKey: ['results'] })
  }

  const rescind = async (id: string) => {
    const why = prompt('Why is this being rescinded? (shown on the record)')
    if (why === null) return
    const { error } = await supabase.rpc('rescind_penalty', { p_id: id, p_reason: why })
    if (error) { setErr(error.message.replace(/^.*?:\s*/, '')); return }
    qc.invalidateQueries({ queryKey: ['penalties'] })
    qc.invalidateQueries({ queryKey: ['results'] })
  }

  const rows = penalties ?? []
  const active = rows.filter((p) => p.status === 'active')

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--color-muted)]">Driver</span>
            <select className="hcr-select !py-2 !text-sm" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Pick a driver…</option>
              {sortedDrivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--color-muted)]">Penalty</span>
            <select className="hcr-select !py-2 !text-sm" value={kind} onChange={(e) => { setKind(e.target.value); setValue('') }}>
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--color-muted)]">
              Race {kind === 'points' && <span className="text-[var(--color-red)]">— required to deduct points</span>}
            </span>
            <select className="hcr-select !py-2 !text-sm" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">Not tied to a race</option>
              {(events ?? []).map((ev) => (
                <option key={ev.id} value={ev.id}>R{ev.round} · {ev.name ?? ev.track?.name}</option>
              ))}
            </select>
          </label>

          {meta.unit ? (
            <label className="block">
              <span className="mb-1.5 block text-xs text-[var(--color-muted)]">Amount ({meta.unit})</span>
              <input
                className="hcr-input tabular !py-2 !text-sm"
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder={meta.unit === 'seconds' ? 'e.g. 5' : 'e.g. 10'}
              />
            </label>
          ) : (
            <div className="flex items-end pb-2 text-xs text-[var(--color-faint)]">{meta.hint}</div>
          )}

          <label className="block md:col-span-2">
            <span className="mb-1.5 block text-xs text-[var(--color-muted)]">Reason (published)</span>
            <input
              className="hcr-input !py-2 !text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="e.g. Contact with the #16 at turn 4, lap 12 — avoidable"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1.5 block text-xs text-[var(--color-muted)]">Internal note (not published)</span>
            <input
              className="hcr-input !py-2 !text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={300}
              placeholder="Anything for the stewards' own record"
            />
          </label>
        </div>

        {meta.unit && <p className="mt-2 text-xs text-[var(--color-faint)]">{meta.hint}</p>}
        {err && <p className="mt-3 rounded-lg bg-[var(--color-red)]/10 px-3 py-2 text-sm text-[var(--color-red)]">{err}</p>}
        {ok && <p className="mt-3 rounded-lg bg-[var(--color-green)]/10 px-3 py-2 text-sm text-[var(--color-green)]">{ok}</p>}

        <button onClick={issue} disabled={busy} className="hcr-btn hcr-btn-dark mt-3 !py-2 !text-xs">
          {busy ? 'Issuing…' : 'Issue penalty'}
        </button>
      </div>

      <div>
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-xl">Issued this season</h3>
          <span className="tabular text-sm text-[var(--color-muted)]">{active.length} active</span>
        </div>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--color-line-2)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-muted)]">
            No penalties issued this season.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((p) => {
              const k = kindOf(p.kind)
              const dead = p.status === 'rescinded'
              return (
                <li
                  key={p.id}
                  className={`rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4 ${dead ? 'opacity-60' : ''}`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      dead ? 'bg-[var(--color-mist)] text-[var(--color-muted)]'
                        : p.kind === 'warning' ? 'bg-[var(--color-brand)]/25 text-[var(--color-ink)]'
                        : 'bg-[var(--color-red)]/12 text-[var(--color-red)]'
                    }`}>
                      {k?.label ?? p.kind}{p.value ? ` · ${p.value} ${k?.unit ?? ''}`.trimEnd() : ''}
                    </span>
                    <span className="font-semibold">{p.driver?.name ?? 'Unknown driver'}</span>
                    {p.event && <span className="font-mono text-xs text-[var(--color-muted)]">R{p.event.round}</span>}
                    <span className="ml-auto text-xs text-[var(--color-faint)]">{fmtDateLong(p.issued_at)}</span>
                  </div>
                  <p className="mt-1.5 text-sm">{p.reason}</p>
                  {dead && p.rescind_reason && (
                    <p className="mt-1 text-xs text-[var(--color-muted)]">Rescinded — {p.rescind_reason}</p>
                  )}
                  {!dead && (
                    <button onClick={() => rescind(p.id)} className="hcr-btn hcr-btn-ghost mt-2 !py-1.5 !text-xs">
                      Rescind
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
