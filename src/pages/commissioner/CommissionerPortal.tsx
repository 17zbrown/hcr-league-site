import { useState } from 'react'
import Overview from './Overview'
import Members from './Members'
import Registrations from './Registrations'
import TeamsAdmin from './TeamsAdmin'
import DriversAdmin from './DriversAdmin'
import ScheduleAdmin from './ScheduleAdmin'
import ResultsAdmin from './ResultsAdmin'
import LeagueInfo from './LeagueInfo'
import DiscordSettings from './DiscordSettings'

const TABS = [
  { id: 'overview', label: 'Overview', el: <Overview /> },
  { id: 'members', label: 'Members & Roles', el: <Members /> },
  { id: 'registrations', label: 'Season Entries', el: <Registrations /> },
  { id: 'teams', label: 'Teams', el: <TeamsAdmin /> },
  { id: 'drivers', label: 'Drivers', el: <DriversAdmin /> },
  { id: 'schedule', label: 'Schedule', el: <ScheduleAdmin /> },
  { id: 'results', label: 'Import Results', el: <ResultsAdmin /> },
  { id: 'info', label: 'League Info', el: <LeagueInfo /> },
  { id: 'discord', label: 'Discord', el: <DiscordSettings /> },
]

export default function CommissionerPortal() {
  const [tab, setTab] = useState('overview')
  const active = TABS.find((t) => t.id === tab) ?? TABS[0]

  return (
    <div className="container-hcr py-10 md:py-14">
      <div className="mb-8">
        <div className="eyebrow mb-2">Commissioner Portal</div>
        <h1 className="text-4xl md:text-5xl">Control Room</h1>
      </div>

      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`min-h-11 whitespace-nowrap rounded-lg px-4 py-2.5 text-left font-alt text-sm font-semibold transition-colors ${
                t.id === tab
                  ? 'bg-[var(--color-deep)] text-white'
                  : 'text-[var(--color-ink-2)] hover:bg-[var(--color-mist)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0">{active.el}</div>
      </div>
    </div>
  )
}
