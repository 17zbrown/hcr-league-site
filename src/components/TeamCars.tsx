import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { classColor } from '../lib/format'
import type { Entry } from '../lib/types'

/**
 * A team's cars, as its manager sees them.
 *
 * The NUMBER is the one thing a manager changes outright — the team owns it, and
 * every driver in that car races under it. Everything else about a car (its model,
 * its class, and whether the team may run a second one at all) is a request to Race
 * Control, because those change what the published grid and the standings mean.
 *
 * Numbers are league-wide. The save is refused server-side if the number is held
 * anywhere in the league, in any class, and the message names who has it.
 */
export function TeamCars({
  teamId,
  entries,
  onChange,
}: {
  teamId: string
  entries: Entry[]
  onChange: () => void
}) {
  if (!entries.length) {
    return (
      <p className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-muted)]">
        No car registered yet. Ask race control to add your team’s first entry, then its number
        becomes yours to set.
      </p>
    )
  }
  return (
    <ul className="space-y-2">
      {entries.map((e) => (
        <CarRow key={e.id} entry={e} teamId={teamId} onChange={onChange} />
      ))}
    </ul>
  )
}

function CarRow({ entry, onChange }: { entry: Entry; teamId: string; onChange: () => void }) {
  const [number, setNumber] = useState(entry.number)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty = number.trim() !== entry.number

  const save = async () => {
    const v = number.trim()
    if (!v) { setErr('A car needs a number.'); return }
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('set_entry_number', { p_entry: entry.id, p_number: v })
    setBusy(false)
    if (error) {
      // "Number 27 is already taken by Kyle Myers" — the useful half of the message
      // sits after the Postgres prefix.
      setErr(error.message.replace(/^.*?:\s*/, ''))
      setNumber(entry.number)
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    onChange()
  }

  return (
    <li className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="h-4 w-4 shrink-0 rounded-sm" style={{ background: classColor(entry.class_id) }} />
        <label className="flex items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">No.</span>
          <input
            className="hcr-input tabular !w-24 !py-2 text-center"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            maxLength={4}
            inputMode="numeric"
            aria-label="Car number"
          />
        </label>
        <span className="text-sm">
          <strong>{entry.class_id}</strong>
          <span className="text-[var(--color-muted)]"> · {entry.car ?? 'car not set'}</span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          {entry.drivers?.length ? (
            <span className="text-xs text-[var(--color-muted)]">
              {entry.drivers.map((d) => d.driver?.name).filter(Boolean).join(', ')}
            </span>
          ) : (
            <span className="text-xs text-[var(--color-faint)]">no driver assigned</span>
          )}
          <button onClick={save} disabled={!dirty || busy} className="hcr-btn hcr-btn-dark !py-1.5 !text-xs">
            {saved ? '✓' : busy ? '…' : 'Save number'}
          </button>
        </span>
      </div>
      {err && <p className="mt-2 text-xs text-[var(--color-red)]">{err}</p>}
      <p className="mt-2 text-xs text-[var(--color-faint)]">
        Anyone racing this car runs No. {entry.number}. Changing the car model or class is a
        request to race control, below.
      </p>
    </li>
  )
}
