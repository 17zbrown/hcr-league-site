import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardOverview from './DashboardOverview'
import Members from './Members'
import Registrations from './Registrations'
import TeamsAdmin from './TeamsAdmin'
import DriversAdmin from './DriversAdmin'
import ScheduleAdmin from './ScheduleAdmin'
import ResultsAdmin from './ResultsAdmin'
import NewsAdmin from './NewsAdmin'
import AutomationAdmin from './AutomationAdmin'
import LeagueInfo from './LeagueInfo'
import DiscordSettings from './DiscordSettings'
import IracingLeague from './IracingLeague'
import CarsAdmin from './CarsAdmin'

/**
 * Race Control Dashboard — the SaaS-console layout (sidebar of grouped
 * sections, content pane) in the site's paddock-catalog language: white
 * ground, near-black rail, mono micro-labels, yellow as the active accent.
 */
type TabId =
  | 'overview' | 'results' | 'schedule'
  | 'drivers' | 'teams' | 'cars' | 'members' | 'registrations'
  | 'news' | 'automation' | 'iracing'
  | 'info' | 'discord'

interface NavItem { id: TabId; label: string }
interface NavGroup { label: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  { label: 'Command', items: [{ id: 'overview', label: 'Dashboard' }] },
  {
    label: 'Race ops',
    items: [
      { id: 'results', label: 'Import Results' },
      { id: 'schedule', label: 'Schedule' },
    ],
  },
  {
    label: 'People',
    items: [
      { id: 'drivers', label: 'Drivers' },
      { id: 'teams', label: 'Teams' },
      { id: 'cars', label: 'Cars' },
      { id: 'members', label: 'Members & Roles' },
      { id: 'registrations', label: 'Season Entries' },
      { id: 'iracing', label: 'iRacing League' },
    ],
  },
  {
    label: 'Media',
    items: [
      { id: 'news', label: 'Newsroom' },
      { id: 'automation', label: 'Automation' },
    ],
  },
  {
    label: 'League',
    items: [
      { id: 'info', label: 'League Info' },
      { id: 'discord', label: 'Discord' },
    ],
  },
]

export default function CommissionerPortal() {
  const [tab, setTab] = useState<TabId>('overview')
  const navigate = useNavigate()

  const panel = (() => {
    switch (tab) {
      case 'overview': return (
        <DashboardOverview
          onNavigate={(t) => {
            if (t === 'protests') { navigate('/control'); return } // steward queue lives there
            const known = GROUPS.flatMap((g) => g.items.map((i) => i.id as string))
            setTab(known.includes(t) ? (t as TabId) : 'overview')
          }}
        />
      )
      case 'results': return <ResultsAdmin />
      case 'schedule': return <ScheduleAdmin />
      case 'drivers': return <DriversAdmin />
      case 'teams': return <TeamsAdmin />
      case 'members': return <Members />
      case 'registrations': return <Registrations />
      case 'cars': return <CarsAdmin />
      case 'iracing': return <IracingLeague />
      case 'news': return <NewsAdmin />
      case 'automation': return <AutomationAdmin />
      case 'info': return <LeagueInfo />
      case 'discord': return <DiscordSettings />
    }
  })()

  return (
    <div className="container-hcr py-8 md:py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-2">Race Control · Command Center</div>
          <h1 className="text-4xl md:text-5xl">Dashboard</h1>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
          Changes go live immediately
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[230px_1fr]">
        {/* The console rail — black panel, grouped sections */}
        <nav
          aria-label="Dashboard sections"
          className="on-navy self-start rounded-xl bg-[var(--color-deep)] p-3 lg:sticky lg:top-24"
        >
          <div className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {GROUPS.map((g) => (
              <div key={g.label} className="lg:mb-4">
                <div className="hidden px-3 pb-1.5 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-faint)] lg:block">
                  {g.label}
                </div>
                <div className="flex gap-1 lg:flex-col">
                  {g.items.map((t) => {
                    const active = t.id === tab
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        aria-current={active ? 'page' : undefined}
                        className={`min-h-11 whitespace-nowrap rounded-lg px-3.5 py-2.5 text-left font-alt text-[13px] font-bold transition-colors ${
                          active
                            ? 'bg-[var(--color-brand)] text-black'
                            : 'text-[var(--color-ink-2)] hover:bg-[var(--color-cloud)] hover:text-[var(--color-ink)]'
                        }`}
                      >
                        {t.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0">{panel}</div>
      </div>
    </div>
  )
}
