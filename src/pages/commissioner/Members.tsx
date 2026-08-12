import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useMembers } from '../../lib/queries'
import type { Profile } from '../../lib/types'
import { Skeleton } from '../../components/ui'
import { SearchBox, useSearch } from '../../components/SearchBox'

/**
 * Site accounts, not drivers.
 *
 * Ten profiles against thirty-nine drivers, and only five drivers carry a user_id at
 * all — so this and the roster are two nearly-disjoint sets that happen to share some
 * names. Merging them would bury thirty-four drivers under empty account columns and
 * drop the accounts that never race, including any commissioner who does not.
 *
 * The Team Manager controls that used to sit here are gone with the Teams section:
 * HCR fields no teams, so the checkbox granted a role over nothing and the select had
 * nothing to choose. Portal access is the only thing this page decides now.
 */

export default function Members() {
  const qc = useQueryClient()
  const { data: members, isLoading } = useMembers()
  const { query, setQuery, filtered, count, total } = useSearch(
    (members ?? []) as { display_name?: string | null; email?: string | null; role?: string | null }[],
    (m) => [m.display_name, m.email, m.role],
  )

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <h2 className="mb-2 text-3xl">Members &amp; Roles</h2>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-muted)]">
        People with a site account, and how much of the portal each one can reach. Most drivers
        have no account, so this is a shorter list than the roster on <strong>Drivers</strong>.
        Commissioner status is set from the admin list, not here.
      </p>

      <SearchBox
        value={query} onChange={setQuery} count={count} total={total}
        placeholder="Search members by name, email or role…"
        className="mb-4 max-w-xl"
      />
      <div className="space-y-2">
        {filtered.map((m: any) => (
          <MemberRow key={m.id} member={m as Profile} onSaved={() => qc.invalidateQueries({ queryKey: ['members'] })} />
        ))}
        {(!members || members.length === 0) && (
          <p className="text-sm text-[var(--color-muted)]">No members yet.</p>
        )}
      </div>
    </div>
  )
}

function MemberRow({ member, onSaved }: { member: Profile; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [role, setRole] = useState<string>((member as { role?: string }).role ?? 'member')

  useEffect(() => {
    setRole((member as { role?: string }).role ?? 'member')
  }, [member])

  const dirty = role !== ((member as { role?: string }).role ?? 'member')

  const save = async () => {
    setBusy(true)
    setError(null)
    // Portal access only. set_member_role is not called any more: it writes nothing
    // but is_team_manager and managed_team_id, and passing false/null on every save
    // would be a silent revoke dressed up as a role change.
    const { error } = await supabase.from('profiles').update({ role }).eq('id', member.id)
    if (error) setError(error.message)
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 1600)
      onSaved()
    }
    setBusy(false)
  }

  return (
    <div className="grid items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4 md:grid-cols-[1.6fr_170px_auto]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{member.display_name ?? member.email}</span>
          {member.is_admin && <span className="rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[10px] font-bold uppercase text-black">Commish</span>}
        </div>
        <div className="truncate text-xs text-[var(--color-muted)]">{member.email}</div>
      </div>

      <select className="hcr-select !py-2" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Portal access">
        <option value="member">Member</option>
        <option value="race_control">Race Control</option>
        <option value="admin">Admin</option>
      </select>

      <button onClick={save} disabled={!dirty || busy} className="hcr-btn hcr-btn-dark !py-2 !text-xs">
        {busy ? '…' : saved ? 'Saved ✓' : 'Save'}
      </button>
      {error && <p className="text-xs text-[var(--color-red)] md:col-span-3">{error}</p>}
    </div>
  )
}
