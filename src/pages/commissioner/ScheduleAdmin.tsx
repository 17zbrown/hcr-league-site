import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useCurrentSeason, useEvents } from '../../lib/queries'
import type { RaceEvent } from '../../lib/types'
import { Skeleton } from '../../components/ui'
import { SearchBox, useSearch } from '../../components/SearchBox'

const STATUS = ['upcoming', 'next', 'complete']

export default function ScheduleAdmin() {
  const qc = useQueryClient()
  const { data: season } = useCurrentSeason()
  const { data: events, isLoading } = useEvents(season?.id)
  const { query, setQuery, filtered, count, total } = useSearch(
    events ?? [], (e) => [e.name, e.track?.name, e.track?.location, e.round, e.status],
  )
  const invalidate = () => qc.invalidateQueries({ queryKey: ['events'] })

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <h2 className="mb-2 text-3xl">Schedule</h2>
      <p className="mb-6 text-sm text-[var(--color-muted)]">
        Edit round names, dates, and status. Set a round to <b>next</b> to feature it on the
        home page; <b>complete</b> once results are in.
      </p>
      <SearchBox
        value={query} onChange={setQuery} count={count} total={total}
        placeholder="Search rounds by name, track, location or status…"
        className="mb-4 max-w-xl"
      />
      <div className="space-y-2">
        {filtered.map((e) => (
          <EventRow key={e.id} event={e} onChange={invalidate} />
        ))}
      </div>
    </div>
  )
}

// events.date is the green-flag INSTANT, not a calendar day. Edit it as local
// wall-clock time and convert back through Date so the same instant round-trips —
// slicing to a date and re-appending T00:00:00Z moved every standard-time race an
// hour and forgot the 8pm green flag entirely.
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function EventRow({ event, onChange }: { event: RaceEvent; onChange: () => void }) {
  const [name, setName] = useState(event.name ?? '')
  const [date, setDate] = useState(toLocalInput(event.date))
  const [status, setStatus] = useState(event.status)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dirty = name !== (event.name ?? '') || date !== toLocalInput(event.date) || status !== event.status

  const save = async () => {
    if (!date || Number.isNaN(new Date(date).getTime())) { setErr('Pick a date and time before saving.'); return }
    setBusy(true)
    setErr(null)
    const { error } = await supabase
      .from('events')
      .update({ name, date: new Date(date).toISOString(), status })
      .eq('id', event.id)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    onChange()
  }

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-3">
    <div className="grid items-center gap-2 md:grid-cols-[46px_1.5fr_210px_130px_auto]">
      <div className="text-center font-display text-2xl text-[var(--color-faint)]">{event.round}</div>
      <input className="hcr-input !py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder={event.track?.name} aria-label="Event name" />
      <input className="hcr-input !py-2 tabular" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Green flag (your local time)" />
      <select className="hcr-select !py-2" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
        {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <button onClick={save} disabled={!dirty || busy} className="hcr-btn hcr-btn-dark !py-2 !text-xs">{saved ? '✓' : 'Save'}</button>
    </div>
    {err && <p className="mt-2 text-xs text-[var(--color-red)]">{err}</p>}
    </div>
  )
}
