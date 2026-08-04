import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useCurrentSeason, useRegistrations } from '../../lib/queries'
import { classColor } from '../../lib/format'
import { Skeleton } from '../../components/ui'

const STATUS = ['pending', 'approved', 'rostered', 'declined']

export default function Registrations() {
  const qc = useQueryClient()
  const { data: season } = useCurrentSeason()
  const { data: regs, isLoading } = useRegistrations(season?.id)

  const [err, setErr] = useState<string | null>(null)
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
                <th className="px-4 py-3">On team?</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {(regs as any[]).map((r) => (
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
      )}
    </div>
  )
}
