import { Link } from 'react-router-dom'
import { useLeagueSettings } from '../lib/queries'
import logo from '../assets/hcr-logo.png'

export default function Footer() {
  const { data: settings } = useLeagueSettings()

  return (
    <footer className="on-navy mt-24 bg-[var(--color-deep)]">
      <div className="container-hcr grid gap-10 py-16 md:grid-cols-[1.6fr_1fr_1fr]">
        <div>
          <img src={logo} alt="HCR League" className="h-11 w-auto" />
          <p className="mt-5 max-w-xs text-sm text-white/55">
            {settings?.tagline ?? 'Realistic endurance sim racing.'} A three-class iRacing
            endurance championship — GTP, LMP2, and GTD on one grid.
          </p>
        </div>

        <div>
          <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-white/40">League</h4>
          <ul className="space-y-2.5 text-white/70">
            <li><Link className="hover:text-[var(--color-brand)]" to="/schedule">Schedule</Link></li>
            <li><Link className="hover:text-[var(--color-brand)]" to="/standings">Standings</Link></li>
            <li><Link className="hover:text-[var(--color-brand)]" to="/standings/fill-in">Fill-In Cup</Link></li>
            <li><Link className="hover:text-[var(--color-brand)]" to="/results">Results</Link></li>
            <li><Link className="hover:text-[var(--color-brand)]" to="/drivers">Drivers</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-white/40">Connect</h4>
          <ul className="space-y-2.5 text-white/70">
            {settings?.discord_url && (
              <li><a className="hover:text-[var(--color-brand)]" href={settings.discord_url} target="_blank" rel="noreferrer">Discord</a></li>
            )}
            {settings?.broadcast_url && (
              <li><a className="hover:text-[var(--color-brand)]" href={settings.broadcast_url} target="_blank" rel="noreferrer">Watch Live</a></li>
            )}
            {settings?.rulebook_url && (
              <li><a className="hover:text-[var(--color-brand)]" href={settings.rulebook_url} target="_blank" rel="noreferrer">Rulebook</a></li>
            )}
            <li><Link className="hover:text-[var(--color-brand)]" to="/signup">Season Sign-Up</Link></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="container-hcr flex flex-col items-center justify-between gap-2 py-5 text-xs text-white/40 sm:flex-row">
          <span className="tabular">© {new Date().getFullYear()} {settings?.name ?? 'HCR League'}</span>
          <span className="uppercase tracking-[0.16em]">Built for the grid</span>
        </div>
      </div>
    </footer>
  )
}
