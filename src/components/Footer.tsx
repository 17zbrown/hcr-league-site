import { Link } from 'react-router-dom'
import { useLeagueSettings } from '../lib/queries'
import logo from '../assets/hcr-logo.png'

export default function Footer() {
  const { data: settings } = useLeagueSettings()

  return (
    <footer className="mt-24 border-t border-[var(--color-line)] bg-[var(--color-ink-2)]">
      <div className="container-hcr grid gap-10 py-14 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <img src={logo} alt="HCR League" className="h-10 w-auto" />
          <p className="mt-4 max-w-xs text-sm text-[var(--color-muted)]">
            {settings?.tagline ?? 'Realistic endurance sim racing.'} A three-class iRacing
            endurance championship — GTP, LMP2, and GTD on one track.
          </p>
        </div>

        <div>
          <h4 className="eyebrow mb-4">League</h4>
          <ul className="space-y-2 text-[var(--color-muted)]">
            <li><Link className="hover:text-[var(--color-paper)]" to="/schedule">Schedule</Link></li>
            <li><Link className="hover:text-[var(--color-paper)]" to="/standings">Standings</Link></li>
            <li><Link className="hover:text-[var(--color-paper)]" to="/results">Results</Link></li>
            <li><Link className="hover:text-[var(--color-paper)]" to="/drivers">Drivers</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="eyebrow mb-4">Connect</h4>
          <ul className="space-y-2 text-[var(--color-muted)]">
            {settings?.discord_url && (
              <li><a className="hover:text-[var(--color-paper)]" href={settings.discord_url} target="_blank" rel="noreferrer">Discord</a></li>
            )}
            {settings?.broadcast_url && (
              <li><a className="hover:text-[var(--color-paper)]" href={settings.broadcast_url} target="_blank" rel="noreferrer">Watch Live</a></li>
            )}
            {settings?.rulebook_url && (
              <li><a className="hover:text-[var(--color-paper)]" href={settings.rulebook_url} target="_blank" rel="noreferrer">Rulebook</a></li>
            )}
            <li><Link className="hover:text-[var(--color-paper)]" to="/signup">Season Sign-Up</Link></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-[var(--color-line)]">
        <div className="container-hcr flex flex-col items-center justify-between gap-2 py-5 text-xs text-[var(--color-muted-2)] sm:flex-row">
          <span className="tabular">© {new Date().getFullYear()} {settings?.name ?? 'HCR League'}</span>
          <span className="eyebrow">Built for the grid</span>
        </div>
      </div>
    </footer>
  )
}
