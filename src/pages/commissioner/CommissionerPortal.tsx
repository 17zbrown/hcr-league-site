import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardOverview from './DashboardOverview'
import Members from './Members'
import Registrations from './Registrations'
import DriversAdmin from './DriversAdmin'
import ScheduleAdmin from './ScheduleAdmin'
import ResultsAdmin from './ResultsAdmin'
import NewsAdmin from './NewsAdmin'
import AutomationAdmin from './AutomationAdmin'
import LeagueInfo from './LeagueInfo'
import DiscordSettings from './DiscordSettings'
import CarsAdmin from './CarsAdmin'

/**
 * Race Control Dashboard — the SaaS-console layout (sidebar of grouped
 * sections, content pane) in the site's paddock-catalog language: white
 * ground, near-black rail, mono micro-labels, yellow as the active accent.
 *
 * The People group is four sections and each one answers a different question, which
 * is the test a new tab has to pass. Drivers is a PERSON, Grid is a CAR, Signups is a
 * SUBMISSION to the web form, Members is a SITE ACCOUNT. They looked interchangeable
 * only because two of them were misnamed: "Cars" was really the grid, and "Season
 * Entries" showed the seven people who used the form rather than the thirty-nine on
 * the grid, which is the one that actually misled.
 */
type TabId =
  | 'overview' | 'results' | 'schedule'
  | 'drivers' | 'cars' | 'members' | 'registrations'
  | 'news' | 'automation'
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
      { id: 'cars', label: 'Grid' },
      { id: 'registrations', label: 'Signups' },
      { id: 'members', label: 'Members & Roles' },
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

const KNOWN = new Set<string>(GROUPS.flatMap((g) => g.items.map((i) => i.id as string)))

/**
 * Sections that no longer exist, and where their work went.
 *
 * A stale link that silently lands on the dashboard is indistinguishable from a
 * broken portal, so a retired id resolves to the section that absorbed it and says
 * so out loud rather than being swallowed.
 */
const RETIRED: Record<string, { to: TabId; note: string }> = {
  teams: {
    to: 'cars',
    note: 'Teams is gone — HCR fields no teams, and a car’s number, class and model live on the Grid.',
  },
  iracing: {
    to: 'drivers',
    note: 'The iRacing league queue now lives inside Drivers, on the same rows it was asking about.',
  },
}

/** Where a fresh load should land, honouring ?tab= and any retired id in it. */
function landing(): { tab: TabId; notice: string | null } {
  const asked = new URLSearchParams(window.location.search).get('tab')
  if (!asked) return { tab: 'overview', notice: null }
  const retired = RETIRED[asked]
  if (retired) return { tab: retired.to, notice: retired.note }
  return KNOWN.has(asked) ? { tab: asked as TabId, notice: null } : { tab: 'overview', notice: null }
}

export default function CommissionerPortal() {
  const [start] = useState(landing)
  const [tab, setTab] = useState<TabId>(start.tab)
  const [notice, setNotice] = useState<string | null>(start.notice)
  const navigate = useNavigate()

  const go = (t: string) => {
    if (t === 'protests') { navigate('/control'); return } // steward queue lives there
    const retired = RETIRED[t]
    if (retired) { setTab(retired.to); setNotice(retired.note); return }
    setTab(KNOWN.has(t) ? (t as TabId) : 'overview')
    setNotice(KNOWN.has(t) ? null : `There is no “${t}” section any more, so this is the dashboard.`)
  }

  const panel = (() => {
    switch (tab) {
      case 'overview': return <DashboardOverview onNavigate={go} />
      case 'results': return <ResultsAdmin />
      case 'schedule': return <ScheduleAdmin />
      case 'drivers': return <DriversAdmin />
      case 'members': return <Members />
      case 'registrations': return <Registrations />
      case 'cars': return <CarsAdmin />
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
                        onClick={() => { setTab(t.id); setNotice(null) }}
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

        <div className="min-w-0">
          {notice && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-lg bg-[var(--color-brand)]/15 px-4 py-3 text-sm">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label="Dismiss"
                className="shrink-0 rounded px-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                ✕
              </button>
            </div>
          )}
          {panel}
        </div>
      </div>
    </div>
  )
}
