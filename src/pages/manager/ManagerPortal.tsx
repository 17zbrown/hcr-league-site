import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { useCurrentSeason, useDrivers, useEntries, useMyChangeRequests, useRegistrations, useTeams } from '../../lib/queries'
import { classColor } from '../../lib/format'
import { flagFor } from '../../lib/countries'
import { Section, Skeleton } from '../../components/ui'
import { ChangeRequestForm, ChangeRequestList } from '../../components/ChangeRequest'
import { TeamCars } from '../../components/TeamCars'

export default function ManagerPortal() {
  const { profile, isAdmin } = useAuth()
  const qc = useQueryClient()
  const { data: season } = useCurrentSeason()
  const { data: teams } = useTeams()
  const { data: drivers, isLoading: driversLoading } = useDrivers()
  const { data: registrations, isLoading: regLoading } = useRegistrations(season?.id)
  const { data: entries } = useEntries(season?.id)
  const { data: myRequests } = useMyChangeRequests()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const myTeam = teams?.find((t) => t.id === profile?.managed_team_id)

  const roster = useMemo(
    () => (drivers ?? []).filter((d) => d.team_id === profile?.managed_team_id),
    [drivers, profile?.managed_team_id],
  )

  // Free-agent market: approved this season, not yet on a team.
  const market = useMemo(
    () =>
      (registrations ?? []).filter(
        (r: any) => r.driver && r.driver.team_id == null && ['approved', 'rostered'].includes(r.status),
      ),
    [registrations],
  )

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['drivers'] })
    qc.invalidateQueries({ queryKey: ['free-agents'] })
    qc.invalidateQueries({ queryKey: ['registrations'] })
    qc.invalidateQueries({ queryKey: ['teams'] })
    qc.invalidateQueries({ queryKey: ['entries'] })
    qc.invalidateQueries({ queryKey: ['change-requests'] })
  }

  const sign = async (driverId: string) => {
    if (!profile?.managed_team_id) {
      setError('You are not assigned to a team. Ask the commissioner to assign one.')
      return
    }
    setBusyId(driverId)
    setError(null)
    const { error } = await supabase.rpc('sign_driver', { p_driver_id: driverId, p_team_id: profile.managed_team_id })
    if (error) setError(error.message)
    else refresh()
    setBusyId(null)
  }

  const release = async (driverId: string) => {
    if (!confirm('Release this driver from your team?')) return
    setBusyId(driverId)
    setError(null)
    const { error } = await supabase.rpc('release_driver', { p_driver_id: driverId })
    if (error) setError(error.message)
    else refresh()
    setBusyId(null)
  }

  return (
    <Section
      eyebrow="Team Manager Portal"
      title={myTeam ? myTeam.name : 'Team Manager'}
    >
      {!profile?.managed_team_id && !isAdmin && (
        <p className="mb-8 rounded-xl bg-[var(--color-brand)]/15 px-4 py-3 text-sm text-[var(--color-ink-2)]">
          You have manager access but haven't been assigned a team yet. Ask the commissioner to
          set your team.
        </p>
      )}
      {error && <p role="alert" className="mb-6 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">{error}</p>}

      {myTeam && (
        <div className="mb-8">
          <div className="mb-4 flex items-center gap-2.5">
            <h3 className="text-2xl">Our Cars</h3>
            <span className="tabular text-sm text-[var(--color-muted)]">
              {(entries ?? []).filter((e) => e.team_id === myTeam.id).length}
            </span>
          </div>
          <TeamCars
            teamId={myTeam.id}
            entries={(entries ?? []).filter((e) => e.team_id === myTeam.id)}
            onChange={refresh}
          />
          {(myRequests ?? []).length > 0 && (
            <div className="mt-4">
              <div className="font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
                Requests to race control
              </div>
              <ChangeRequestList rows={myRequests ?? []} />
            </div>
          )}
          <div className="mt-4">
            <ChangeRequestForm
              kinds={['extra_car', 'car', 'class']}
              teamId={myTeam.id}
              onDone={refresh}
            />
          </div>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Roster */}
        <div>
          <div className="mb-4 flex items-center gap-2.5">
            {myTeam && <span className="h-4 w-4 rounded-sm" style={{ background: classColor(myTeam.class_id) }} />}
            <h3 className="text-2xl">My Roster</h3>
            <span className="tabular text-sm text-[var(--color-muted)]">{roster.length}</span>
          </div>
          {driversLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : roster.length === 0 ? (
            <p className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-muted)]">
              No drivers signed yet. Sign free agents from the market on the right.
            </p>
          ) : (
            <ul className="space-y-2">
              {roster.map((d) => (
                <li key={d.id} className="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
                  <span className="flex-1 font-semibold">
                    {d.name} {d.country && <span title={d.country}>{flagFor(d.country) || d.country}</span>}
                  </span>
                  <button
                    onClick={() => release(d.id)}
                    disabled={busyId === d.id}
                    className="hcr-btn hcr-btn-ghost !py-2 !text-xs"
                  >
                    Release
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Free-agent market */}
        <div>
          <div className="mb-4 flex items-center gap-2.5">
            <h3 className="text-2xl">Free Agents</h3>
            <span className="tabular text-sm text-[var(--color-muted)]">{market.length}</span>
          </div>
          {regLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : market.length === 0 ? (
            <p className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-muted)]">
              No free agents in the pool right now. Drivers appear here once they enter the season.
            </p>
          ) : (
            <ul className="space-y-2">
              {market.map((r: any) => (
                <li key={r.id} className="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{r.driver?.name ?? r.display_name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs">
                      {r.fia_category && (
                        <span className="rounded-full bg-[var(--color-mist)] px-2 py-0.5 font-body text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-2)]">{r.fia_category}</span>
                      )}
                      {r.preferred_class && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ background: `${classColor(r.preferred_class)}22`, color: 'var(--color-ink-2)' }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: classColor(r.preferred_class) }} />
                          {r.preferred_class}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => sign(r.driver.id)}
                    disabled={busyId === r.driver?.id || !profile?.managed_team_id}
                    className="hcr-btn hcr-btn-primary !py-2 !text-xs"
                  >
                    {busyId === r.driver?.id ? '…' : 'Sign'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  )
}
