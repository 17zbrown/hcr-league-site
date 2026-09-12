import { Link } from 'react-router-dom'
import { useCurrentSeason, useEntries, useRegistrations } from '../lib/queries'
import { fmtDateTime } from '../lib/format'
import { Skeleton } from './ui'
import type { SeasonRegistration } from '../lib/types'

/**
 * Sign-ups that are waiting for a seat, for the Race Control hub.
 *
 * This exists because "I sent a car change request and nothing showed up" turned
 * out to mean this: a driver with no seat yet has no change-request form — the
 * only form they can reach is the season entry form, whose button reads "Update
 * Registration" and which quietly rewrites their sign-up. That update landed on
 * the Admin → Signups page and nowhere a steward looks. Now it lands here, newest
 * change first, with the ask spelled out. Seating still happens on the Signups tab;
 * this is the list, not the lever.
 */
/** The statuses that mean "has entered" — the same three the Discord bot reads. */
const LIVE = new Set(['pending', 'approved', 'rostered'])

export function SignupQueue() {
  const { data: season } = useCurrentSeason()
  const { data: regs, isLoading, error } = useRegistrations(season?.id)
  const { data: entries } = useEntries(season?.id)

  if (!season || isLoading) return <Skeleton className="h-24 w-full" />
  if (error) {
    return (
      <p className="rounded-xl border border-[var(--color-brand)]/40 bg-[var(--color-paper)] p-6 text-sm text-[var(--color-brand)]">
        The sign-up list could not be read — {error.message}.
      </p>
    )
  }

  // A driver is waiting when their registration is live and no current entry
  // carries them. Entries are read from the same hook the grid uses, so this
  // agrees with the Signups tab rather than re-deriving "seated" a second way.
  const seated = new Set<string>()
  for (const e of entries ?? []) {
    if (e.status === 'withdrawn') continue
    for (const d of e.drivers ?? []) if (!d.withdrawn_at && d.driver?.id) seated.add(d.driver.id)
  }
  const waiting = ((regs ?? []) as SeasonRegistration[])
    .filter((r) => LIVE.has(r.status) && !(r.driver_id && seated.has(r.driver_id)))
    .sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at))

  if (!waiting.length) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-line-2)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-muted)]">
        Nobody is waiting for a seat. Every live sign-up is on the grid.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-[var(--color-cloud)] text-left font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
          <tr>
            <th className="px-4 py-2.5">Driver</th>
            <th className="px-4 py-2.5">Asked for</th>
            <th className="px-4 py-2.5">Note</th>
            <th className="px-4 py-2.5">Last changed</th>
          </tr>
        </thead>
        <tbody>
          {waiting.map((r) => {
            const changed = r.updated_at && r.updated_at !== r.created_at
            return (
              <tr key={r.id} className="border-t border-[var(--color-line)] align-top">
                <td className="whitespace-nowrap px-4 py-3 font-semibold text-[var(--color-ink)]">
                  {r.iracing_name || r.display_name || '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="font-semibold">{r.preferred_class ?? '—'}</span>
                  {r.preferred_car ? ` · ${r.preferred_car}` : ''}
                  {r.preferred_number ? ` · #${r.preferred_number}` : ''}
                  {r.preferred_number_alt ? <span className="text-[var(--color-muted)]"> (or #{r.preferred_number_alt})</span> : null}
                </td>
                <td className="max-w-[28ch] px-4 py-3 text-[var(--color-ink-2)]">{r.notes || ''}</td>
                <td className="whitespace-nowrap px-4 py-3 text-[var(--color-muted)]">
                  {fmtDateTime(r.updated_at ?? r.created_at)}
                  {changed && <span className="ml-2 rounded-full bg-[var(--color-brand)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--color-brand)]">updated</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="border-t border-[var(--color-line)] px-4 py-3 text-xs text-[var(--color-muted)]">
        Their Discord class role already follows this ask. Seating happens on{' '}
        <Link to="/admin?tab=registrations" className="underline">Admin → Signups</Link>.
      </p>
    </div>
  )
}
