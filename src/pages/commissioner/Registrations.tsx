import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useCurrentSeason, useRegistrations } from '../../lib/queries'
import { classColor } from '../../lib/format'
import { Skeleton } from '../../components/ui'
import { ColumnFilterRow, ColumnFilterToggle, SearchBox, useColumnFilters, useSearch } from '../../components/SearchBox'

const STATUS = ['pending', 'approved', 'rostered', 'declined']

/** The statuses that mean "we have accepted this sign-up". Declining needs no data. */
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

export default function Registrations() {
  const qc = useQueryClient()
  const { data: season } = useCurrentSeason()
  const { data: regs, isLoading } = useRegistrations(season?.id)

  const [err, setErr] = useState<string | null>(null)
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
        <strong>Grid</strong>, and plenty of them never came through this form.
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
    </div>
  )
}
