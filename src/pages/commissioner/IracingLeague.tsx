import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useCurrentSeason, useEntries, useSeasonResultsFull } from '../../lib/queries'
import { resultsForDriver } from '../../lib/license'
import { classColor } from '../../lib/format'
import type { Driver, IracingLeagueState } from '../../lib/types'
import { Skeleton } from '../../components/ui'
import { SearchBox, useSearch } from '../../components/SearchBox'

/**
 * iRacing league queue — who on this season's grid still needs adding to the league
 * in iRacing.
 *
 * WHY THIS IS A LIST AND NOT AN AUTOMATION: iRacing's Data API is read-only (all
 * nine league endpoints are GETs — there is no add-member call), and as of the 2026
 * Season 1 release, OAuth client-ID creation is paused, so even read access is
 * currently unreachable. Adding a driver is a thing a human does in iRacing's own UI.
 *
 * So this screen does the part software can actually do: it remembers who still
 * needs doing, and hands over the customer IDs in one click.
 *
 * PROVENANCE IS THE WHOLE DESIGN. Every row says how sure we are and why:
 *
 *   Confirmed   a roster sync saw them in the league. Nothing can set this today —
 *               it stays empty on purpose rather than being faked by a button.
 *   Raced       they appear in a result row, which is proof they were in a session.
 *   Marked      you told the site you added them. Bookkeeping, not verification,
 *               and labelled that way so it never reads as certainty.
 *   To add      signed up, nothing done yet.
 *
 * When OAuth reopens, one sync fills the confirmed column and this screen gets
 * quietly more truthful without changing shape.
 */

const STATE_META: Record<IracingLeagueState, { label: string; note: string; tone: string }> = {
  confirmed: {
    label: 'Confirmed',
    note: 'Seen in the iRacing league roster by a sync.',
    tone: 'bg-[var(--color-green)]/12 text-[var(--color-green)]',
  },
  raced: {
    label: 'Raced',
    note: 'Appears in this season’s results, so they were in the session.',
    tone: 'bg-[var(--color-green)]/12 text-[var(--color-green)]',
  },
  marked: {
    label: 'Marked added',
    note: 'You told the site you added them. Not verified against iRacing.',
    tone: 'bg-[var(--color-blue)]/12 text-[var(--color-blue)]',
  },
  pending: {
    label: 'To add',
    note: 'Signed up and on the grid — still needs adding in iRacing.',
    // Brand yellow as a fill, ink as the text: the raw brand colour fails contrast
    // as text on white, which is what --color-brand-deep exists for elsewhere.
    tone: 'bg-[var(--color-brand)]/25 text-[var(--color-ink)]',
  },
  'no-custid': {
    label: 'No customer ID',
    note: 'Cannot be added until their iRacing customer ID is known.',
    tone: 'bg-[var(--color-red)]/12 text-[var(--color-red)]',
  },
}

interface Row {
  driver: Driver
  number: string
  classId: string
  state: IracingLeagueState
}

export default function IracingLeague() {
  const qc = useQueryClient()
  const { data: season } = useCurrentSeason()
  const { data: entries, isLoading } = useEntries(season?.id)
  const { data: seasonRows } = useSeasonResultsFull(season?.id)

  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const e of entries ?? []) {
      for (const link of e.drivers ?? []) {
        const d = link.driver
        if (!d?.id) continue
        // Precedence is deliberate: proof beats bookkeeping. Somebody who has raced
        // is in the league whether or not anyone remembered to tick the box, and
        // whether or not we know their customer ID.
        const raced = resultsForDriver(seasonRows ?? [], d.name).length > 0
        const state: IracingLeagueState =
          d.iracing_league_confirmed_at ? 'confirmed'
            : raced ? 'raced'
            : d.iracing_league_marked_at ? 'marked'
            : !String(d.iracing_custid ?? '').trim() ? 'no-custid'
            : 'pending'
        out.push({ driver: d, number: e.number, classId: e.class_id, state })
      }
    }
    return out.sort((a, b) => {
      // The work first, then the unactionable, then everything already settled.
      const rank: Record<IracingLeagueState, number> = {
        pending: 0, 'no-custid': 1, marked: 2, raced: 3, confirmed: 4,
      }
      return rank[a.state] - rank[b.state] || a.driver.name.localeCompare(b.driver.name)
    })
  }, [entries, seasonRows])

  const { query, setQuery, filtered, count, total } = useSearch(
    rows, (r) => [r.driver.name, r.driver.iracing_custid, r.number, r.classId, r.state],
  )
  const pending = rows.filter((r) => r.state === 'pending')
  const missingId = rows.filter((r) => r.state === 'no-custid')

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    } catch {
      setErr('Your browser blocked the clipboard. Select the ID and copy it by hand.')
    }
  }

  const setMarked = async (driverId: string, marked: boolean) => {
    setBusy(driverId)
    setErr(null)
    // An RPC rather than a table update: the function cannot touch the confirmed
    // column, so a bug here can never promote a guess into a verified fact.
    const { error } = await supabase.rpc('set_iracing_league_marked', {
      p_driver_id: driverId,
      p_marked: marked,
    })
    setBusy(null)
    if (error) { setErr(error.message); return }
    qc.invalidateQueries({ queryKey: ['entries'] })
    qc.invalidateQueries({ queryKey: ['drivers'] })
  }

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <h2 className="mb-2 text-3xl">iRacing League</h2>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-muted)]">
        Everyone on this season’s grid, and whether they still need adding to the league in
        iRacing. Adding is manual — iRacing’s API can’t do it — so this keeps the list of
        who’s outstanding instead of you keeping it in your head.
      </p>

      {err && (
        <p className="mb-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">{err}</p>
      )}

      {/* The batch action: paste straight into iRacing's add-member field. */}
      <div className="mb-6 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-display text-2xl leading-none">
              {pending.length}
              <span className="ml-2 font-body text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                still to add
              </span>
            </div>
            <p className="mt-1.5 text-xs text-[var(--color-muted)]">
              {pending.length === 0
                ? 'Nothing outstanding — every entered driver is accounted for.'
                : 'Copy the customer IDs, add them in iRacing, then mark them here.'}
            </p>
          </div>
          {pending.length > 0 && (
            <button
              onClick={() => copy(pending.map((r) => r.driver.iracing_custid).join(', '), 'all')}
              className="hcr-btn hcr-btn-primary !py-2 !text-xs"
            >
              {copied === 'all' ? '✓ Copied' : `Copy all ${pending.length} customer IDs`}
            </button>
          )}
        </div>
      </div>

      {missingId.length > 0 && (
        <p className="mb-6 rounded-lg bg-[var(--color-red)]/8 px-4 py-3 text-sm text-[var(--color-red)]">
          <strong>{missingId.length}</strong> entered {missingId.length === 1 ? 'driver has' : 'drivers have'} no
          iRacing customer ID, so they cannot be added at all: {missingId.map((r) => r.driver.name).join(', ')}.
          Add the ID under <strong>Drivers</strong> first.
        </p>
      )}

      <SearchBox
        value={query} onChange={setQuery} count={count} total={total}
        placeholder="Search by driver, customer ID, number, class or status…"
        className="mb-4 max-w-xl"
      />
      <div className="overflow-x-auto rounded-2xl border border-[var(--color-line)]">
        <table className="w-full min-w-[760px] border-collapse bg-[var(--color-paper)] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] bg-[var(--color-mist)] text-left font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Entry</th>
              <th className="px-4 py-3">Cust ID#</th>
              <th className="px-4 py-3">In the league?</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const meta = STATE_META[r.state]
              const custid = String(r.driver.iracing_custid ?? '').trim()
              return (
                <tr key={r.driver.id} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="px-4 py-3 font-semibold">{r.driver.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: classColor(r.classId) }} />
                      <span className="tabular">#{r.number}</span>
                      <span className="text-[var(--color-muted)]">{r.classId}</span>
                    </span>
                  </td>
                  <td className="tabular px-4 py-3">
                    {custid ? (
                      <button
                        onClick={() => copy(custid, r.driver.id)}
                        title="Copy this customer ID"
                        className="rounded px-1.5 py-0.5 font-mono hover:bg-[var(--color-mist)]"
                      >
                        {copied === r.driver.id ? '✓ copied' : custid}
                      </button>
                    ) : (
                      <span className="text-[var(--color-red)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      title={meta.note}
                      className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.tone}`}
                    >
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {/* Only the self-reported flag is ever editable here. A driver
                        who has raced needs no button — the results already said so. */}
                    {(r.state === 'pending' || r.state === 'marked') && (
                      <button
                        onClick={() => setMarked(r.driver.id, r.state !== 'marked')}
                        disabled={busy === r.driver.id}
                        className={`hcr-btn !py-1.5 !text-xs ${r.state === 'marked' ? 'hcr-btn-ghost' : 'hcr-btn-dark'}`}
                      >
                        {r.state === 'marked' ? 'Undo' : 'Mark added'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-2xl text-xs text-[var(--color-faint)]">
        <strong>Marked added</strong> is your own note, not a check against iRacing — the site has
        no way to read your league roster today. <strong>Confirmed</strong> is reserved for a real
        roster sync and stays unused until iRacing reopens API access, at which point it fills in
        by itself and any mistakes in the marked column surface on their own.
      </p>
    </div>
  )
}
