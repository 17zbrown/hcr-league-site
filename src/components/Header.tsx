import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import logo from '../assets/hcr-logo.png'
import { useAuth } from '../lib/auth'
import { useLeagueSettings } from '../lib/queries'
import NotificationBell from './NotificationBell'

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/schedule', label: 'Schedule' },
  { to: '/standings', label: 'Standings' },
  { to: '/results', label: 'Results' },
  { to: '/drivers', label: 'Drivers' },
  { to: '/teams', label: 'Teams' },
  { to: '/reports', label: 'Reports' },
]

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="HCR League home">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-mist)]">
        <img src={logo} alt="" className="h-6 w-6 object-contain" />
      </span>
      <span className="font-alt text-xl font-extrabold uppercase tracking-tight">
        HCR<span className="text-[var(--color-brand-deep)]">/</span>League
      </span>
    </Link>
  )
}

export default function Header() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const { session, isAdmin, isManager, isRaceControl } = useAuth()
  const { data: settings } = useLeagueSettings()

  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-[var(--color-line)] bg-[var(--color-paper)]">
        <div className="container-hcr flex h-[72px] items-center justify-between gap-4">
          <Wordmark />

          <div className="flex items-center gap-2">
            {session && <NotificationBell />}
            {session ? (
              <Link to="/portal" className="hidden rounded-lg bg-[var(--color-ink)] px-4 py-2.5 text-[13px] font-bold uppercase tracking-wide text-[var(--color-deep)] transition-transform hover:-translate-y-0.5 sm:block">
                My Portal
              </Link>
            ) : (
              <Link to="/signup" className="hidden rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-[13px] font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-0.5 sm:block">
                Enter Season
              </Link>
            )}

            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
              className="flex h-11 items-center gap-2.5 rounded-lg border border-[var(--color-line-2)] px-3.5 transition-colors hover:border-[var(--color-ink)]"
            >
              <span className="hidden font-mono text-xs font-semibold uppercase tracking-widest sm:inline">Menu</span>
              <span className="flex flex-col gap-[5px]">
                <span className="h-0.5 w-5 bg-current" />
                <span className="h-0.5 w-5 bg-current" />
                <span className="h-0.5 w-5 bg-current" />
              </span>
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <FullMenu
            key="menu"
            onClose={() => setOpen(false)}
            session={!!session}
            isAdmin={isAdmin}
            isManager={isManager}
            isRaceControl={isRaceControl}
            discord={settings?.discord_url ?? null}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function FullMenu({
  onClose,
  session,
  isAdmin,
  isManager,
  isRaceControl,
  discord,
}: {
  onClose: () => void
  session: boolean
  isAdmin: boolean
  isManager: boolean
  isRaceControl: boolean
  discord: string | null
}) {
  const accountLinks = [
    session ? { to: '/portal', label: 'My Portal' } : { to: '/login', label: 'Sign In' },
    ...(session ? [{ to: '/portal', label: 'File a Protest' }] : []),
    { to: '/signup', label: session ? 'Enter the Season' : 'Create Account' },
    ...(isRaceControl ? [{ to: '/control', label: 'Race Control Portal' }] : []),
    ...(isAdmin ? [{ to: '/admin', label: 'Admin Portal' }] : []),
    ...(isManager ? [{ to: '/manager', label: 'Team Manager Portal' }] : []),
  ]

  return (
    <motion.div
      className="on-navy fixed inset-0 z-[60] bg-[var(--color-deep)] text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="container-hcr flex h-[72px] items-center justify-between">
        <span className="font-alt text-xl font-extrabold uppercase tracking-tight">
          HCR<span className="text-[var(--color-brand)]">/</span>League
        </span>
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="flex h-11 items-center gap-2.5 rounded-lg border border-white/20 px-3.5 font-mono text-xs font-semibold uppercase tracking-widest hover:border-white"
        >
          Close
          <span className="relative block h-4 w-4">
            <span className="absolute left-0 top-1.5 h-0.5 w-4 rotate-45 bg-current" />
            <span className="absolute left-0 top-1.5 h-0.5 w-4 -rotate-45 bg-current" />
          </span>
        </button>
      </div>

      <div className="container-hcr grid gap-12 py-10 md:grid-cols-[1.4fr_1fr] md:py-16">
        <nav aria-label="All pages">
          <div className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-white/40">Explore</div>
          <ul>
            {NAV.map((item, i) => (
              <motion.li
                key={item.to}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.04, duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
              >
                <NavLink
                  to={item.to}
                  onClick={onClose}
                  className="group flex items-baseline gap-4 border-b border-white/10 py-4"
                >
                  <span className="font-mono text-xs text-white/30">{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-display text-4xl font-extrabold uppercase leading-none transition-colors group-hover:text-[var(--color-brand)] md:text-5xl">
                    {item.label}
                  </span>
                </NavLink>
              </motion.li>
            ))}
          </ul>
        </nav>

        <div>
          <div className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-white/40">Account</div>
          <ul className="space-y-2">
            {accountLinks.map((l) => (
              <li key={l.to + l.label}>
                <Link
                  to={l.to}
                  onClick={onClose}
                  className="block rounded-xl border border-white/12 px-5 py-4 font-display text-xl font-bold uppercase tracking-wide transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            {discord && (
              <li>
                <a
                  href={discord}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl bg-white/5 px-5 py-4 font-display text-xl font-bold uppercase tracking-wide text-white/80 transition-colors hover:text-white"
                >
                  Join the Discord ↗
                </a>
              </li>
            )}
          </ul>
        </div>
      </div>
    </motion.div>
  )
}
