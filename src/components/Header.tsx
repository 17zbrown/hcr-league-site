import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import logo from '../assets/hcr-logo.png'
import { useAuth } from '../lib/auth'
import { useLeagueSettings } from '../lib/queries'
import NotificationBell from './NotificationBell'
import { GlobalSearch } from './GlobalSearch'

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/schedule', label: 'Schedule' },
  { to: '/standings', label: 'Standings' },
  { to: '/results', label: 'Results' },
  { to: '/drivers', label: 'Drivers' },
  // "News", at /news — the same name and path the #news channel, its topic and every
  // Discord embed already use. /reports redirects here for links already in the wild.
  { to: '/news', label: 'News' },
  // The rulebook is 45 sections, every driver is told they are treated as having
  // read it, and published stewards' rulings in Discord cite its section numbers
  // by name (§27.3). It was reachable only from the footer.
  { to: '/rulebook', label: 'Rulebook' },
]
// NO TEAMS LINK, deliberately. The league has never had a team: every entry is one
// driver in one car, and `teams` has zero rows. The page it led to was an empty
// state, and the standings tab beside it silently keyed on CAR NUMBER instead —
// ranking "#49" and "#29" as if they were constructors. A nav item that promises a
// championship the league does not run is worse than no nav item.
//
// The /teams route and the commissioner's Teams admin are both still there, so the
// day an entry gets a second driver this is one line to put back.

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
  const { session, isAdmin, isRaceControl } = useAuth()
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

          {/*
            THE NAV, ON SCREEN. For a long time this list existed only inside the
            full-screen menu, so moving between four tables — the whole point of the
            site — cost opening and dismissing a modal every time. Same NAV array,
            one extra render site.

            Hidden below lg because seven items plus the wordmark, search and a CTA
            will not fit; the menu button remains the way in on small screens, which
            is what it is good at.
          */}
          <nav aria-label="Main" className="hidden flex-1 items-center justify-center gap-1 lg:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 font-alt text-[13px] font-bold uppercase tracking-wide transition-colors ${
                    isActive
                      ? 'text-[var(--color-ink)]'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <GlobalSearch />
            {session && <NotificationBell />}
            {session ? (
              <Link to="/portal" className="hidden rounded-lg bg-[var(--color-deep)] px-4 py-2.5 text-[13px] font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-0.5 sm:block">
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

      {/* Rendered plainly rather than through AnimatePresence: the exit
          animation finished but the node was left mounted at opacity 0, so a
          dismissed menu stayed as an invisible full-screen overlay (still
          pointer-events:auto and aria-modal) swallowing clicks on the page
          behind it. Unmounting immediately is worth losing the fade-out. */}
      {open && (
        <FullMenu
          onClose={() => setOpen(false)}
          session={!!session}
          isAdmin={isAdmin}
          isRaceControl={isRaceControl}
          discord={settings?.discord_url ?? null}
        />
      )}
    </>
  )
}

function FullMenu({
  onClose,
  session,
  isAdmin,
  isRaceControl,
  discord,
}: {
  onClose: () => void
  session: boolean
  isAdmin: boolean
  isRaceControl: boolean
  discord: string | null
}) {
  // Sign-in is deliberately not surfaced (members don't log in for now —
  // /login stays reachable by URL for staff). Portal links appear only for
  // already-authenticated staff sessions.
  const accountLinks = [
    ...(session ? [{ to: '/portal', label: 'My Portal' }] : []),
    { to: '/signup', label: 'Enter the Season' },
    ...(isRaceControl ? [{ to: '/control', label: 'Race Control Portal' }] : []),
    ...(isAdmin ? [{ to: '/admin', label: 'Admin Portal' }] : []),
    // No Team Manager Portal: /manager and the page behind it are gone with the rest
    // of the teams feature.
  ]

  const reduceMotion = useReducedMotion() ?? false
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Keep the latest onClose in a ref: Header passes a fresh arrow every render,
  // so depending on it directly re-ran this effect constantly — tearing the key
  // listener down and fighting Header's own scroll lock.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // A full-screen overlay has to behave like a dialog: Escape closes it, and
  // focus moves in and is trapped. (Header owns the body scroll lock.)
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>('button, a[href]')?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!nodes?.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prevFocus?.focus?.()
    }
    // attach once for the life of the overlay
  }, [])

  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Site menu"
      // overflow-y-auto: the panel was a fixed, unscrollable viewport, so on
      // phones the Account links sat below the fold with no way to reach them.
      className="on-navy fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-[var(--color-deep)] text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.25 }}
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
          <div className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-white/65">Explore</div>
          <ul>
            {NAV.map((item, i) => (
              <motion.li
                key={item.to}
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reduceMotion ? { duration: 0 } : { delay: 0.05 + i * 0.04, duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
              >
                <NavLink
                  to={item.to}
                  onClick={onClose}
                  className="group flex items-baseline gap-4 border-b border-white/10 py-4"
                >
                  <span className="font-mono text-xs text-white/65">{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-display text-4xl leading-none transition-colors group-hover:text-[var(--color-brand)] md:text-5xl">
                    {item.label}
                  </span>
                </NavLink>
              </motion.li>
            ))}
          </ul>
        </nav>

        <div>
          <div className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-white/65">Account</div>
          <ul className="space-y-2">
            {accountLinks.map((l) => (
              <li key={l.to + l.label}>
                <Link
                  to={l.to}
                  onClick={onClose}
                  className="block rounded-xl border border-white/12 px-5 py-4 font-display text-xl transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
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
                  className="block rounded-xl bg-white/5 px-5 py-4 font-display text-xl text-white/80 transition-colors hover:text-white"
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
