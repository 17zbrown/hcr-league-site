import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useClasses, useCurrentSeason, useEntries } from '../../lib/queries'
import { classColor } from '../../lib/format'
import type { ClassId, Entry, LeagueClass } from '../../lib/types'
import { Skeleton } from '../../components/ui'
import { ColumnFilterRow, ColumnFilterToggle, SearchBox, useColumnFilters, useSearch } from '../../components/SearchBox'

/**
 * The grid, editable — every car with its class, model and number.
 *
 * WHY A CAR PAGE AND NOT MORE COLUMNS ON DRIVERS. Class, car and number belong to the
 * ENTRY, not the person. A team runs one car that several drivers share, so editing
 * "Benji's class" is incoherent — there is no such thing, only the class of the car he
 * drives, and changing it changes it for his team-mates too. Putting the fields on the
 * thing they actually describe makes that obvious instead of surprising.
 *
 * It also closes a real hole: Race Control could already approve a class or car change
 * request and then had nowhere to apply it. The queue could accept work the site could
 * not finish.
 *
 * Every save goes through set_entry_details rather than a table update, because the
 * number carries a league-wide uniqueness rule and the class has to be a real class.
 * A second admin in another tab cannot race past a check that lives on the server.
 */

/** Cars we know are in the game, offered as suggestions per class rather than a fixed list. */
const CAR_SUGGESTIONS: Record<string, string[]> = {
  GTP: ['Acura ARX-06', 'Cadillac V-Series.R', 'Porsche 963', 'BMW M Hybrid V8', 'Ferrari 499P'],
  LMP2: ['Dallara P217'],
  GTD: [
    'Ferrari 296 GT3', 'Porsche 911 GT3 R (992)', 'Chevrolet Corvette Z06 GT3.R',
    'Lamborghini Huracan GT3 EVO', 'McLaren 720S GT3 EVO', 'Mercedes-AMG GT3 2020',
    'Audi R8 LMS GT3', 'BMW M4 GT3', 'Aston Martin Vantage GT3 EVO', 'Ford Mustang GT3',
  ],
}

export default function CarsAdmin() {
  const { data: season } = useCurrentSeason()
  const { data: entries, isLoading } = useEntries(season?.id)
  const { data: classes } = useClasses()
  const [err, setErr] = useState<string | null>(null)

  const withNames = (entries ?? []).map((e) => ({
    entry: e,
    who: (e.drivers ?? []).map((l) => l.driver?.name).filter(Boolean).join(', '),
  }))

  const { query, setQuery, filtered, count, total } = useSearch(
    withNames, (r) => [r.entry.number, r.entry.class_id, r.entry.car, r.entry.team?.name, r.who],
  )
  const cf = useColumnFilters<(typeof withNames)[number]>({
    number: (r) => r.entry.number,
    class: (r) => r.entry.class_id,
    car: (r) => r.entry.car,
    team: (r) => r.entry.team?.name ?? 'Free agent',
    drivers: (r) => r.who,
  })
  const shown = cf.apply(filtered)

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <h2 className="mb-2 text-3xl">Cars</h2>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-muted)]">
        Every car on this season’s grid. Class, model and number live on the car rather than
        the driver, because a team’s car is shared — changing its class changes it for
        everyone in it. Numbers are league-wide and the server refuses a duplicate.
      </p>

      {err && (
        <p role="alert" className="mb-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">{err}</p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBox
          value={query} onChange={setQuery} count={count} total={total}
          placeholder="Search by number, class, car, team or driver…"
          className="max-w-xl flex-1"
        />
        <ColumnFilterToggle ctl={cf} />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--color-line)]">
        <table className="w-full min-w-[860px] border-collapse bg-[var(--color-paper)] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] bg-[var(--color-mist)] text-left font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
              <th className="px-4 py-3">No.</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Car</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Drivers</th>
              <th className="px-4 py-3" />
            </tr>
            <ColumnFilterRow
              ctl={cf}
              cells={[
                { key: 'number', label: 'Number' },
                { key: 'class', label: 'Class' },
                { key: 'car', label: 'Car' },
                { key: 'team', label: 'Team' },
                { key: 'drivers', label: 'Drivers' },
                null,
              ]}
            />
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--color-muted)]">
                  No cars match the current filters.
                </td>
              </tr>
            )}
            {shown.map(({ entry, who }) => (
              <CarRow key={entry.id} entry={entry} who={who} classes={classes} onError={setErr} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CarRow({
  entry, who, classes, onError,
}: {
  entry: Entry
  who: string
  classes?: LeagueClass[]
  onError: (m: string | null) => void
}) {
  const qc = useQueryClient()
  const [number, setNumber] = useState(entry.number)
  const [classId, setClassId] = useState(entry.class_id)
  const [car, setCar] = useState(entry.car ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty = number !== entry.number || classId !== entry.class_id || car !== (entry.car ?? '')

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
      setNumber(entry.number); setClassId(entry.class_id); setCar(entry.car ?? '')
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    // Entries feed the roster, standings and the iRacing queue, so all of them are stale now.
    qc.invalidateQueries({ queryKey: ['entries'] })
    qc.invalidateQueries({ queryKey: ['drivers'] })
    qc.invalidateQueries({ queryKey: ['teams'] })
  }

  return (
    <tr className="border-b border-[var(--color-line)] last:border-0">
      <td className="px-4 py-2">
        <input
          className="hcr-input tabular !w-20 !py-1.5 text-center"
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          inputMode="numeric"
          aria-label={`Number for the car currently numbered ${entry.number}`}
        />
      </td>
      <td className="px-4 py-2">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: classColor(classId, classes) }} />
          <select
            className="hcr-select !py-1.5 !text-xs"
            value={classId}
            // The select only ever offers ids that came from the classes table, so a
            // value outside the union is not reachable; the guard is here so a future
            // stray <option> fails loudly rather than corrupting an entry's class.
            onChange={(e) => {
              const next = e.target.value as ClassId
              if ((classes ?? []).some((c) => c.id === next)) setClassId(next)
            }}
            aria-label={`Class for car #${entry.number}`}
          >
            {(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
          </select>
        </span>
      </td>
      <td className="px-4 py-2">
        <input
          className="hcr-input !py-1.5 !text-xs"
          value={car}
          onChange={(e) => setCar(e.target.value)}
          list={`cars-${entry.id}`}
          maxLength={80}
          placeholder="Car model"
          aria-label={`Car model for #${entry.number}`}
        />
        {/* Suggestions, not a fixed list: iRacing adds cars mid-season and a hard
            dropdown would make a legal car impossible to enter. */}
        <datalist id={`cars-${entry.id}`}>
          {(CAR_SUGGESTIONS[classId] ?? []).map((c) => <option key={c} value={c} />)}
        </datalist>
      </td>
      <td className="px-4 py-2 text-[var(--color-muted)]">{entry.team?.name ?? 'Free agent'}</td>
      <td className="px-4 py-2">{who || <span className="text-[var(--color-faint)]">nobody assigned</span>}</td>
      <td className="px-4 py-2 text-right">
        <button
          onClick={save}
          disabled={!dirty || busy}
          className="hcr-btn hcr-btn-dark !py-1.5 !text-xs"
        >
          {saved ? '✓' : busy ? '…' : 'Save'}
        </button>
      </td>
    </tr>
  )
}
