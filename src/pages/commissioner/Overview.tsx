import {
  useCurrentSeason,
  useDrivers,
  useEvents,
  useMembers,
  useRegistrations,
  useTeams,
} from '../../lib/queries'

export default function Overview() {
  const { data: season } = useCurrentSeason()
  const { data: drivers } = useDrivers()
  const { data: teams } = useTeams()
  const { data: events } = useEvents(season?.id)
  const { data: members } = useMembers()
  const { data: regs } = useRegistrations(season?.id)

  const stats = [
    { label: 'Members', value: members?.length ?? '—' },
    { label: 'Season Entries', value: regs?.length ?? '—' },
    { label: 'Drivers', value: drivers?.length ?? '—' },
    { label: 'Teams', value: teams?.length ?? '—' },
    { label: 'Rounds', value: events?.length ?? '—' },
    { label: 'Free Agents', value: drivers?.filter((d) => !d.team_id).length ?? '—' },
  ]

  return (
    <div>
      <h2 className="mb-6 text-3xl">{season?.name ?? 'Season'} Overview</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
            <div className="font-display text-4xl font-extrabold">{s.value}</div>
            <div className="mt-1 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-6">
        <h3 className="text-xl">Quick guide</h3>
        <ul className="mt-3 space-y-2 text-sm text-[var(--color-muted)]">
          <li><b className="text-[var(--color-ink)]">Members &amp; Roles</b> — grant a member Team Manager access and assign their team.</li>
          <li><b className="text-[var(--color-ink)]">Season Entries</b> — review who has entered and confirm their grid slot.</li>
          <li><b className="text-[var(--color-ink)]">Teams / Drivers / Schedule</b> — edit the roster and calendar directly.</li>
          <li><b className="text-[var(--color-ink)]">League Info</b> — update the league name, links, and season settings.</li>
        </ul>
      </div>
    </div>
  )
}
