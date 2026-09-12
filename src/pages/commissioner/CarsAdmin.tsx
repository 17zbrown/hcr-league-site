import { useState } from 'react'
import { useClasses, useCurrentSeason, useEntries } from '../../lib/queries'
import { CLASS_ORDER } from '../../lib/format'
import type { Entry, LeagueClass } from '../../lib/types'
import { Skeleton } from '../../components/ui'
import { CarField, ClassField, NumberField, SaveButton, useEntryEdit } from '../../components/EntryEditor'
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
 * entry_drivers has a composite key and no unique constraint on entry_id, so a second
 * driver on a car is legal even though today every car has exactly one. Folding this
 * into Drivers would pass every test on the current data and then, the first time a
 * co-driver appeared, show one car on two rows with two Save buttons fighting over the
 * same number. That is why this stays entry-grain no matter how similar it looks.
 *
 * It also closes a real hole: Race Control could already approve a class or car change
 * request and then had nowhere to apply it. The queue could accept work the site could
 * not finish.
 *
 * Every save goes through set_entry_details rather than a table update, because the
 * number carries a league-wide uniqueness rule and the class has to be a real class.
 * A second admin in another tab cannot race past a check that lives on the server.
 */


export default function CarsAdmin() {
  const { data: season } = useCurrentSeason()
  const { data: entries, isLoading } = useEntries(season?.id)
  const { data: classes } = useClasses()
  const [err, setErr] = useState<string | null>(null)

  const withNames = [...(entries ?? [])]
    .sort((a, b) =>
      CLASS_ORDER.indexOf(a.class_id) - CLASS_ORDER.indexOf(b.class_id)
      || (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0))
    .map((e) => ({
      entry: e,
      who: (e.drivers ?? []).map((l) => l.driver?.name).filter(Boolean).join(', '),
    }))

  const { query, setQuery, filtered, count, total } = useSearch(
    withNames, (r) => [r.entry.number, r.entry.class_id, r.entry.car, r.who],
  )
  const cf = useColumnFilters<(typeof withNames)[number]>({
    number: (r) => r.entry.number,
    class: (r) => r.entry.class_id,
    car: (r) => r.entry.car,
    drivers: (r) => r.who,
  })
  const shown = cf.apply(filtered)

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <h2 className="mb-2 text-3xl">Grid</h2>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-muted)]">
        Every car actually running this season — this is the grid, not the sign-up list.
        Class, model and number live on the car rather than the driver, because a car can be
        shared; changing its class changes it for everyone in it. Numbers are league-wide and
        the server refuses a duplicate.
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
              <th className="px-4 py-3">Drivers</th>
              <th className="px-4 py-3" />
            </tr>
            <ColumnFilterRow
              ctl={cf}
              cells={[
                { key: 'number', label: 'Number' },
                { key: 'class', label: 'Class' },
                { key: 'car', label: 'Car' },
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
  const ctl = useEntryEdit(entry, onError)
  return (
    <tr className="border-b border-[var(--color-line)] last:border-0">
      <td className="px-4 py-2">
        <NumberField ctl={ctl} label={`Number for the car currently numbered ${entry.number}`} />
      </td>
      <td className="px-4 py-2">
        <ClassField ctl={ctl} classes={classes} label={`Class for car #${entry.number}`} />
      </td>
      <td className="px-4 py-2">
        {/* Wide enough for 'Lamborghini Huracan GT3 EVO' — the old width clipped it. */}
        <CarField ctl={ctl} listId={`cars-${entry.id}`} label={`Car model for #${entry.number}`} className="!w-64" />
      </td>
      <td className="px-4 py-2">{who || <span className="text-[var(--color-faint)]">nobody assigned</span>}</td>
      <td className="px-4 py-2 text-right">
        <SaveButton ctl={ctl} />
      </td>
    </tr>
  )
}
