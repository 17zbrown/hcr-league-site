import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useClasses, useCurrentSeason, useRegistrations, useTakenNumbers } from '../../lib/queries'
import { classColor } from '../../lib/format'
import { Skeleton } from '../../components/ui'
import { ColumnFilterRow, ColumnFilterToggle, SearchBox, useColumnFilters, useSearch } from '../../components/SearchBox'

// 'withdrawn' is written by withdraw_from_season — either the driver pressing
// withdraw in their portal, or the membership run noticing they left the Discord. It
// is listed here so the row renders its real status instead of a blank select, which
// would have overwritten it on the next change.
//
// PUTTING SOMEBODY BACK NEEDS A DIFFERENT NUMBER, for now. Their withdrawn entry keeps
// its row so their finished races stay linked, and number_holder() does not filter on
// status — so the old car still holds the old number and re-seating on it fails with
// 'Number N is already taken'. Seat them on another number, or free the old one by
// clearing it on the withdrawn entry first.
const STATUS = ['pending', 'approved', 'rostered', 'declined', 'withdrawn']

/**
 * The statuses that mean "we have accepted this sign-up". Declining needs no data.
 *
 * 'rostered' no longer reaches setStatus — it goes through roster_registration,
 * which checks the same thing itself — but it stays listed so that the rule does
 * not quietly disappear if anything ever routes here again.
 */
const ACCEPTING = ['approved', 'rostered']

/**
 * Sign-ups from the web form — NOT the grid.
 *
 * This was labelled "Season Entries", which is the one piece of copy in the portal
 * that actively lied: it reads season_registrations, so it showed the handful of
 * people who used the form while the grid on the Grid tab held thirty-nine cars.
 * Anyone checking "is everyone entered?" here got the wrong answer. Signing up and
 * being placed on the grid are two different facts with a human-length gap between
 * them, and this page is only ever about the first one.
 */

/**
 * Why a sign-up cannot be accepted yet, or null if it can.
 *
 * Mirrors the CHECK constraint on season_registrations: a full iRacing name
 * (first and last) and a numeric customer ID. Staff cannot supply either — only
 * the driver knows them.
 */
function missingIracingIdentity(r: any): string | null {
  const name = String(r?.iracing_name ?? '').trim()
  const custid = String(r?.iracing_custid ?? '').trim()
  const gaps: string[] = []
  if (!name) gaps.push('no iRacing name')
  else if (!/\S\s+\S/.test(name)) gaps.push(`the iRacing name “${name}” is not a full name`)
  if (!custid) gaps.push('no iRacing customer ID')
  else if (!/^\d+$/.test(custid)) gaps.push(`the customer ID “${custid}” is not a number`)
  return gaps.length ? `${gaps.join(' and ')}.` : null
}

/** What we are about to give somebody: the three things an entry cannot exist without. */
type Seating = { reg: any; number: string; klass: string; car: string }

export default function Registrations() {
  const qc = useQueryClient()
  const { data: season } = useCurrentSeason()
  const { data: regs, isLoading } = useRegistrations(season?.id)
  const { data: classes } = useClasses()
  // The same set the sign-up form checks against, from the same hook, so a number
  // is judged free or taken by one rule in both places. The server has the final
  // say either way — roster_registration lets entries_number_unique_trg fire.
  const { data: takenNumbers } = useTakenNumbers(season?.id)

  const [err, setErr] = useState<string | null>(null)
  const [seating, setSeating] = useState<Seating | null>(null)
  const [busy, setBusy] = useState(false)
  const { query, setQuery, filtered, count, total } = useSearch(
    (regs ?? []) as any[],
    (r) => [r.driver?.name, r.display_name, r.iracing_name, r.iracing_custid,
            r.fia_category, r.preferred_class, r.preferred_car, r.preferred_number, r.status],
  )
  // Column filters narrow whatever the search box has already left, so the two
  // compose instead of one quietly overriding the other.
  const cf = useColumnFilters<any>({
    driver: (r) => r.driver?.name ?? r.display_name,
    iracing: (r) => r.iracing_name,
    custid: (r) => r.iracing_custid,
    category: (r) => r.fia_category,
    class: (r) => r.preferred_class,
    car: (r) => r.preferred_car,
    number: (r) => [r.preferred_number, r.preferred_number_alt].filter(Boolean).join(' '),
    status: (r) => r.status,
  })
  const shown = cf.apply(filtered)

  /**
   * Who already holds a number, or null if it is free — the same live check the
   * season entry form does, from the same `useTakenNumbers` map, answered on the
   * keystroke rather than after a round-trip.
   *
   * A number held by this sign-up's OWN driver is not a clash: somebody already
   * on the grid keeping their number should not be told it is taken by them.
   */
  const numberTaken = useMemo(() => {
    return (n: string, driverId?: string | null): string | null => {
      const key = n.trim().toLowerCase()
      if (!key || !takenNumbers) return null
      const hit = takenNumbers.get(key)
      if (!hit) return null
      if (driverId && hit.driverIds.includes(driverId)) return null
      return hit.holder
    }
  }, [takenNumbers])

  const nameOf = (r: any) => r?.driver?.name ?? r?.display_name ?? 'this driver'

  /**
   * Open the seating panel with the driver's own answers already filled in.
   *
   * The first-choice number is used unless it has gone, in which case the second
   * choice is — that is the decision a commissioner makes by hand every time, and
   * the whole point of asking for two.
   */
  const openSeating = (r: any) => {
    const first = String(r.preferred_number ?? '').trim()
    const alt = String(r.preferred_number_alt ?? '').trim()
    const number = first && !numberTaken(first, r.driver_id) ? first
      : alt && !numberTaken(alt, r.driver_id) ? alt
      : first || alt
    setErr(null)
    setSeating({
      reg: r,
      number,
      klass: String(r.preferred_class ?? '') || classes?.[0]?.id || '',
      car: String(r.preferred_car ?? ''),
    })
  }

  /**
   * The one call that actually puts a car on the grid.
   *
   * Everything it does — resolving or creating the driver, the entry, the
   * entry_drivers link, the status — happens in a single transaction inside the
   * RPC, so a sign-up marked rostered always has a car behind it. This page used
   * to change the word alone, which is how a driver sat off the grid for weeks
   * while the portal said he was on it.
   */
  const roster = async () => {
    if (!seating) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('roster_registration', {
      p_registration: seating.reg.id,
      p_number: seating.number.trim(),
      p_class: seating.klass,
      p_car: seating.car.trim(),
    })
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    setSeating(null)
    // The grid, the number set and the roster all just changed, not only this list.
    qc.invalidateQueries({ queryKey: ['registrations'] })
    qc.invalidateQueries({ queryKey: ['taken-numbers'] })
    qc.invalidateQueries({ queryKey: ['entries'] })
    qc.invalidateQueries({ queryKey: ['drivers'] })
  }

  const setStatus = async (id: string, status: string) => {
    setErr(null)
    // A sign-up cannot be accepted without the two fields that identify the driver
    // in iRacing. The CHECK constraint on season_registrations means no such row
    // should exist, so this is a backstop rather than the enforcement — it keeps
    // the rule visible at the point where accepting actually happens, and refuses
    // rather than passing the problem along should a legacy row ever surface.
    if (ACCEPTING.includes(status)) {
      const r = (regs ?? []).find((x: any) => x.id === id)
      const missing = missingIracingIdentity(r)
      if (missing) {
        setErr(`Cannot mark this sign-up ${status}: ${missing} Ask the driver to complete their sign-up first.`)
        return
      }
    }
    const { error } = await supabase.from('season_registrations').update({ status }).eq('id', id)
    if (error) setErr(error.message)
    else qc.invalidateQueries({ queryKey: ['registrations'] })
  }

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <h2 className="mb-2 text-3xl">Signups</h2>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-muted)]">
        Submissions to the {season?.name ?? 'season'} sign-up form — what each driver asked for,
        and how far along it is. This is not the grid: the cars actually running are on{' '}
        <strong>Grid</strong>, and plenty of them never came through this form. Setting a
        sign-up to <strong>rostered</strong> is what crosses the gap — it asks for a number,
        a class and a car, and builds the entry.
      </p>

      {err && <p className="mb-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">{err}</p>}

      {(!regs || regs.length === 0) ? (
        <p className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-muted)]">
          Nobody has used the sign-up form yet. Members sign up from their account page.
        </p>
      ) : (
        <>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchBox
            value={query} onChange={setQuery} count={count} total={total}
            placeholder="Search sign-ups by driver, iRacing name, ID, class, car or status…"
            className="max-w-xl flex-1"
          />
          <ColumnFilterToggle ctl={cf} />
        </div>
        <div className="overflow-x-auto rounded-2xl border border-[var(--color-line)]">
          <table className="w-full min-w-[680px] border-collapse bg-[var(--color-paper)] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] bg-[var(--color-mist)] text-left font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">iRacing name</th>
                <th className="px-4 py-3">Cust ID#</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Car</th>
                <th className="px-4 py-3">No. wanted</th>
                <th className="px-4 py-3">Status</th>
              </tr>
              <ColumnFilterRow
                ctl={cf}
                cells={[
                  { key: 'driver', label: 'Driver' },
                  { key: 'iracing', label: 'iRacing name' },
                  { key: 'custid', label: 'Customer ID' },
                  { key: 'category', label: 'Category' },
                  { key: 'class', label: 'Class' },
                  { key: 'car', label: 'Car' },
                  { key: 'number', label: 'Number wanted' },
                  { key: 'status', label: 'Status' },
                ]}
              />
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[var(--color-muted)]">
                    No sign-ups match {cf.active > 0 && query.trim() ? 'the search and column filters' : cf.active > 0 ? 'these column filters' : 'that search'}.
                  </td>
                </tr>
              )}
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="px-4 py-3 font-semibold">{r.driver?.name ?? r.display_name}</td>
                  <td className="px-4 py-3">{r.iracing_name ?? '—'}</td>
                  <td className="tabular px-4 py-3">{r.iracing_custid ?? '—'}</td>
                  <td className="px-4 py-3">{r.fia_category ?? '—'}</td>
                  <td className="px-4 py-3">
                    {r.preferred_class ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: classColor(r.preferred_class) }} />
                        {r.preferred_class}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">{r.preferred_car ?? '—'}</td>
                  {/* Both choices, because the first is often gone by the time an
                      entry is processed and the fallback is the actual decision. */}
                  <td className="tabular px-4 py-3">
                    {r.preferred_number
                      ? `#${r.preferred_number}${r.preferred_number_alt ? ` / #${r.preferred_number_alt}` : ''}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="hcr-select !py-1.5 !text-xs"
                      value={r.status}
                      onChange={(e) => {
                        const next = e.target.value
                        // Rostering is not a status change, it is a car being built.
                        // It needs a number, a class and a model, so it asks for
                        // them instead of silently writing a word and nothing else.
                        if (next === 'rostered') {
                          const missing = missingIracingIdentity(r)
                          if (missing) {
                            setErr(`Cannot put ${nameOf(r)} on the grid: ${missing} Ask the driver to complete their sign-up first.`)
                            return
                          }
                          openSeating(r)
                          return
                        }
                        if (next === 'declined' && !confirm(`Decline ${r.driver?.name ?? r.display_name ?? 'this entry'}?`)) return
                        setStatus(r.id, next)
                      }}
                    >
                      {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {seating && (
        <SeatingPanel
          seating={seating}
          setSeating={setSeating}
          classes={classes}
          numberTaken={numberTaken}
          busy={busy}
          onConfirm={roster}
          seasonName={season?.name}
        />
      )}
    </div>
  )
}

/**
 * The three questions a car cannot exist without, asked once.
 *
 * A grid entry needs a number, a class and a model. Nothing on this page ever
 * asked for them, so "rostered" meant a word in a column and forty cars typed
 * into the SQL editor by hand. Answering here is what makes the status true.
 *
 * Deliberately prefilled from what the driver asked for: the commissioner's job
 * is to confirm or override a choice, not to retype one that is already on the
 * screen two columns to the left.
 */
function SeatingPanel({
  seating, setSeating, classes, numberTaken, busy, onConfirm, seasonName,
}: {
  seating: Seating
  setSeating: (s: Seating | null) => void
  classes?: { id: string; name: string }[]
  numberTaken: (n: string, driverId?: string | null) => string | null
  busy: boolean
  onConfirm: () => void
  seasonName?: string
}) {
  const r = seating.reg
  const who = r.driver?.name ?? r.display_name ?? 'this driver'
  const takenBy = numberTaken(seating.number, r.driver_id)
  const blank = !seating.number.trim() || !seating.klass
  const asked = [r.preferred_number, r.preferred_number_alt].filter(Boolean).map((n: string) => `#${n}`)

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setSeating(null) }}
      role="dialog"
      aria-modal="true"
      aria-label={`Put ${who} on the grid`}
    >
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 shadow-card">
        <h3 className="text-2xl">Put {who} on the grid</h3>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          This builds a real car in the {seasonName ?? 'season'} entry list and puts {who} in it —
          not just a word in the status column. It is the same thing as adding a row on the{' '}
          <strong>Grid</strong> tab.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
              Car number
            </span>
            <input
              className={`hcr-input tabular ${takenBy ? '!border-[var(--color-red)]' : ''}`}
              value={seating.number}
              onChange={(e) => setSeating({ ...seating, number: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) })}
              inputMode="numeric"
              autoFocus
              aria-invalid={!!takenBy}
              aria-describedby={takenBy ? 'seat-number-taken' : undefined}
            />
            {/* aria-live so the clash is heard as it is typed, not only on submit.
                The server checks again — entries_number_unique_trg has the last
                word — so this is a courtesy, not the enforcement. */}
            {takenBy && (
              <p id="seat-number-taken" role="status" aria-live="polite"
                 className="mt-1 text-xs font-semibold text-[var(--color-red)]">
                #{seating.number.trim()} is already taken — {takenBy}
              </p>
            )}
            {/* Warned, not blocked. This list cannot tell a real clash from the
                same driver under a driver row this sign-up was never linked to,
                and the server can — it resolves the driver by customer ID first,
                then lets entries_number_unique_trg decide. Disabling here is what
                would strand a driver seated by hand before this button existed. */}
            {asked.length > 0 && (
              <span className="mt-1 block text-xs text-[var(--color-faint)]">
                {who} asked for {asked.join(', then ')}.
              </span>
            )}
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                Class
              </span>
              <select
                className="hcr-select"
                value={seating.klass}
                onChange={(e) => setSeating({ ...seating, klass: e.target.value })}
              >
                {/* A preferred class that is no longer a real class would otherwise
                    vanish from this list without anyone noticing it had changed. */}
                {seating.klass && !(classes ?? []).some((c) => c.id === seating.klass) && (
                  <option value={seating.klass}>{seating.klass}</option>
                )}
                {(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                Car
              </span>
              <input
                className="hcr-input"
                value={seating.car}
                onChange={(e) => setSeating({ ...seating, car: e.target.value })}
                placeholder="e.g. Ferrari 296 GT3"
                maxLength={80}
              />
            </label>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" className="hcr-btn hcr-btn-ghost" disabled={busy} onClick={() => setSeating(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="hcr-btn hcr-btn-primary"
            disabled={busy || blank}
            onClick={onConfirm}
          >
            {busy ? 'Adding to the grid…' : 'Add to the grid'}
          </button>
        </div>
      </div>
    </div>
  )
}
