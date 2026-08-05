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

function EventRow({ event, onChange }: { event: RaceEvent; onChange: () => void }) {
  const [name, setName] = useState(event.name ?? '')
  const [date, setDate] = useState((event.date ?? '').slice(0, 10))
  const [status, setStatus] = useState(event.status)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dirty = name !== (event.name ?? '') || date !== (event.date ?? '').slice(0, 10) || status !== event.status

  const save = async () => {
    if (!date) { setErr('Pick a date before saving.'); return }
    setBusy(true)
    setErr(null)
    const { error } = await supabase
      .from('events')
      .update({ name, date: `${date}T00:00:00Z`, status })
      .eq('id', event.id)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    onChange()
  }

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-3">
    <div className="grid items-center gap-2 md:grid-cols-[46px_1.7fr_150px_130px_auto]">
      <div className="text-center font-display text-2xl text-[var(--color-faint)]">{event.round}</div>
      <input className="hcr-input !py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder={event.track?.name} aria-label="Event name" />
      <input className="hcr-input !py-2 tabular" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      <select className="hcr-select !py-2" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
        {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <button onClick={save} disabled={!dirty || busy} className="hcr-btn hcr-btn-dark !py-2 !text-xs">{saved ? '✓' : 'Save'}</button>
    </div>
    {err && <p className="mt-2 text-xs text-[var(--color-red)]">{err}</p>}
    </div>
  )
}
