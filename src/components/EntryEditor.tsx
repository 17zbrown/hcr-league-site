import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { CAR_SUGGESTIONS } from '../lib/cars'
import { classColor } from '../lib/format'
import type { ClassId, Entry, LeagueClass } from '../lib/types'

/**
 * Editing one car on the grid — its number, class and model.
 *
 * ONE implementation, used by the Grid tab and inline on the Signups tab. It used to
 * live only in the Grid's table row, which meant the tab a commissioner naturally
 * opens to change somebody's car — the one labelled Signups — could show the car but
 * not touch it. Two copies of this logic is how one of them ends up sending a stale
 * value the other one guards against.
 *
 * Every save goes through set_entry_details rather than a table update: the number
 * carries a league-wide uniqueness rule and the class has to be a real class, and a
 * second admin in another tab cannot race past a check that lives on the server.
 */
export function useEntryEdit(entry: Entry, onError: (m: string | null) => void) {
  const qc = useQueryClient()
  const [number, setNumber] = useState(entry.number)
  const [classId, setClassId] = useState<ClassId>(entry.class_id)
  const [car, setCar] = useState(entry.car ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty = number !== entry.number || classId !== entry.class_id || car !== (entry.car ?? '')

  const reset = () => { setNumber(entry.number); setClassId(entry.class_id); setCar(entry.car ?? '') }

  const save = async () => {
    setBusy(true)
    onError(null)
    // Only what actually changed is sent. Null means "leave alone", so an untouched
    // field cannot be overwritten by a stale value this row loaded minutes ago.
    const { error } = await supabase.rpc('set_entry_details', {
      p_entry: entry.id,
      p_class: classId !== entry.class_id ? classId : null,
      p_car: car !== (entry.car ?? '') ? car.trim() : null,
      p_number: number !== entry.number ? number.trim() : null,
    })
    setBusy(false)
    if (error) {
      // Postgres prefixes its own context; the sentence after it is the useful part.
      onError(error.message.replace(/^.*?:\s*/, ''))
      reset()
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    // Entries feed the roster, standings, the sign-up list and the iRacing queue.
    qc.invalidateQueries({ queryKey: ['entries'] })
    qc.invalidateQueries({ queryKey: ['drivers'] })
    qc.invalidateQueries({ queryKey: ['teams'] })
    qc.invalidateQueries({ queryKey: ['registrations'] })
  }

  return { number, setNumber, classId, setClassId, car, setCar, dirty, busy, saved, save, reset }
}

export type EntryEditCtl = ReturnType<typeof useEntryEdit>

export function NumberField({ ctl, label }: { ctl: EntryEditCtl; label: string }) {
  return (
    <input
      className="hcr-input tabular !w-20 !py-1.5 text-center"
      value={ctl.number}
      onChange={(e) => ctl.setNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
      inputMode="numeric"
      aria-label={label}
    />
  )
}

export function ClassField({ ctl, classes, label }: { ctl: EntryEditCtl; classes?: LeagueClass[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: classColor(ctl.classId, classes) }} />
      <select
        className="hcr-select !py-1.5 !text-xs"
        value={ctl.classId}
        // The select only ever offers ids that came from the classes table, so a value
        // outside the union is not reachable; the guard is here so a future stray
        // <option> fails loudly rather than corrupting an entry's class.
        onChange={(e) => {
          const next = e.target.value as ClassId
          if ((classes ?? []).some((c) => c.id === next)) ctl.setClassId(next)
        }}
        aria-label={label}
      >
        {(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
      </select>
    </span>
  )
}

export function CarField({ ctl, listId, label, className = '' }: { ctl: EntryEditCtl; listId: string; label: string; className?: string }) {
  return (
    <>
      <input
        className={`hcr-input !py-1.5 !text-xs ${className}`}
        value={ctl.car}
        onChange={(e) => ctl.setCar(e.target.value)}
        list={listId}
        maxLength={80}
        placeholder="Car model"
        aria-label={label}
      />
      {/* Suggestions, not a fixed list: iRacing adds cars mid-season and a hard
          dropdown would make a legal car impossible to enter. */}
      <datalist id={listId}>
        {(CAR_SUGGESTIONS[ctl.classId] ?? []).map((c) => <option key={c} value={c} />)}
      </datalist>
    </>
  )
}

export function SaveButton({ ctl }: { ctl: EntryEditCtl }) {
  return (
    <button
      onClick={ctl.save}
      disabled={!ctl.dirty || ctl.busy}
      className="hcr-btn hcr-btn-dark !py-1.5 !text-xs"
    >
      {ctl.saved ? '✓' : ctl.busy ? '…' : 'Save'}
    </button>
  )
}

/**
 * The compact version for a table cell, on two deliberate rows:
 *
 *     [#no] [class]
 *     [car model.............] [Save]
 *
 * Two rows by design rather than one that wraps whenever the column is narrow — a
 * flex-wrap version broke into four lines at ordinary widths, which read as a
 * broken form rather than a small one.
 */
export function EntryEditor({
  entry, classes, onError, listId,
}: {
  entry: Entry
  classes?: LeagueClass[]
  onError: (m: string | null) => void
  listId: string
}) {
  const ctl = useEntryEdit(entry, onError)
  return (
    <div className="flex min-w-[17rem] flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <NumberField ctl={ctl} label={`Number for car #${entry.number}`} />
        <ClassField ctl={ctl} classes={classes} label={`Class for car #${entry.number}`} />
      </div>
      <div className="flex items-center gap-2">
        <CarField ctl={ctl} listId={listId} label={`Car model for #${entry.number}`} className="min-w-0 flex-1" />
        <SaveButton ctl={ctl} />
      </div>
    </div>
  )
}
