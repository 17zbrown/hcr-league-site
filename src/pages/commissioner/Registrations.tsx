import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useCurrentSeason, useRegistrations } from '../../lib/queries'
import { classColor } from '../../lib/format'
import { Skeleton } from '../../components/ui'
import { ColumnFilterRow, ColumnFilterToggle, SearchBox, useColumnFilters, useSearch } from '../../components/SearchBox'

const STATUS = ['pending', 'approved', 'rostered', 'declined']

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
    team: (r) => (r.driver?.team_id ? 'Yes' : 'Free agent'),
    status: (r) => r.status,
  })
  const shown = cf.apply(filtered)

  const setStatus = async (id: string, status: string) => {
    setErr(null)
    const { error } = await supabase.from('season_registrations').update({ status }).eq('id', id)
    if (error) setErr(error.message)
    else qc.invalidateQueries({ queryKey: ['registrations'] })
  }

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <h2 className="mb-2 text-3xl">Season Entries</h2>
      <p className="mb-6 text-sm text-[var(--color-muted)]">
        Everyone who has entered {season?.name ?? 'the season'}. Confirm entries and track who's
        been placed on the grid.
      </p>

      {err && <p className="mb-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">{err}</p>}

      {(!regs || regs.length === 0) ? (
        <p className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-muted)]">
          No entries yet. Members enter from their account page.
        </p>
      ) : (
        <>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchBox
            value={query} onChange={setQuery} count={count} total={total}
            placeholder="Search entries by driver, iRacing name, ID, class, car or status…"
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
                <th className="px-4 py-3">On team?</th>
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
                  { key: 'team', label: 'On a team' },
                  { key: 'status', label: 'Status' },
                ]}
              />
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-[var(--color-muted)]">
                    No entries match {cf.active > 0 && query.trim() ? 'the search and column filters' : cf.active > 0 ? 'these column filters' : 'that search'}.
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
                  <td className="px-4 py-3 text-[var(--color-muted)]">{r.driver?.team_id ? 'Yes' : 'Free agent'}</td>
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
