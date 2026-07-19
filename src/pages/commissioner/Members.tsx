import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useMembers, useTeams } from '../../lib/queries'
import type { Profile } from '../../lib/types'
import { Skeleton } from '../../components/ui'

export default function Members() {
  const qc = useQueryClient()
  const { data: members, isLoading } = useMembers()
  const { data: teams } = useTeams()

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <h2 className="mb-2 text-3xl">Members &amp; Roles</h2>
      <p className="mb-6 text-sm text-[var(--color-muted)]">
        Grant a member Team Manager access and assign the team they run. Commissioner status is
        set from the admin list.
      </p>

      <div className="space-y-2">
        {(members ?? []).map((m) => (
          <MemberRow key={m.id} member={m as Profile} teams={teams ?? []} onSaved={() => qc.invalidateQueries({ queryKey: ['members'] })} />
        ))}
        {(!members || members.length === 0) && (
          <p className="text-sm text-[var(--color-muted)]">No members yet.</p>
        )}
      </div>
    </div>
  )
}

function MemberRow({ member, teams, onSaved }: { member: Profile; teams: any[]; onSaved: () => void }) {
  const [isManager, setIsManager] = useState(member.is_team_manager)
  const [teamId, setTeamId] = useState<string>(member.managed_team_id ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [role, setRole] = useState<string>((member as { role?: string }).role ?? 'member')

  useEffect(() => {
    setIsManager(member.is_team_manager)
    setTeamId(member.managed_team_id ?? '')
    setRole((member as { role?: string }).role ?? 'member')
  }, [member.is_team_manager, member.managed_team_id, member])

  const dirty =
    isManager !== member.is_team_manager ||
    (teamId || null) !== (member.managed_team_id ?? null) ||
    role !== ((member as { role?: string }).role ?? 'member')

  const save = async () => {
    setBusy(true)
    setError(null)
    // portal access role (member / race_control / admin)
    const roleRes = await supabase.from('profiles').update({ role }).eq('id', member.id)
    if (roleRes.error) {
      setError(roleRes.error.message)
      setBusy(false)
      return
    }
    const { error } = await supabase.rpc('set_member_role', {
      p_user_id: member.id,
      p_is_team_manager: isManager,
      p_managed_team_id: isManager && teamId ? teamId : null,
    })
    if (error) setError(error.message)
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 1600)
      onSaved()
    }
    setBusy(false)
  }

  return (
    <div className="grid items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4 md:grid-cols-[1.4fr_150px_auto_1.2fr_auto]">
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

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isManager} onChange={(e) => setIsManager(e.target.checked)} className="h-5 w-5 accent-[var(--color-blue)]" />
        Team Manager
      </label>

      <select className="hcr-select !py-2" value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={!isManager}>
        <option value="">— No team —</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>#{t.number} {t.name}</option>
        ))}
      </select>

      <button onClick={save} disabled={!dirty || busy} className="hcr-btn hcr-btn-dark !py-2 !text-xs">
        {busy ? '…' : saved ? 'Saved ✓' : 'Save'}
      </button>
      {error && <p className="text-xs text-[var(--color-red)] md:col-span-4">{error}</p>}
    </div>
  )
}
