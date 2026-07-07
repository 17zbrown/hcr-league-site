import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import logo from '../assets/hcr-logo.png'

const NAV = [
  { to: '/schedule', label: 'Schedule' },
  { to: '/standings', label: 'Standings' },
  { to: '/results', label: 'Results' },
  { to: '/drivers', label: 'Drivers' },
  { to: '/teams', label: 'Teams' },
  { to: '/news', label: 'News' },
]

export default function Header() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors duration-300 ${
        scrolled ? 'border-[var(--color-line)] bg-[var(--color-ink)]/95 backdrop-blur' : 'border-transparent bg-[var(--color-ink)]/80'
      }`}
    >
      <div className="container-hcr flex h-16 items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-3" aria-label="HCR League home">
          <img src={logo} alt="HCR League" className="h-8 w-auto" />
          <span className="hidden font-display text-xl tracking-tight sm:block">
            HCR<span className="text-[var(--color-brand)]"> League</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `relative px-3 py-2 font-display text-lg uppercase tracking-wide transition-colors ${
                  isActive ? 'text-[var(--color-paper)]' : 'text-[var(--color-muted)] hover:text-[var(--color-paper)]'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {item.label}
                  {isActive && (
                    <span className="absolute inset-x-3 -bottom-px h-[3px] bg-[var(--color-brand)]" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            to="/signup"
            className="hidden bg-[var(--color-brand)] px-4 py-2 font-display text-lg uppercase tracking-wide text-black transition-transform hover:-translate-y-0.5 sm:block"
          >
            Sign Up
          </Link>

          {/* Mobile toggle */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="flex h-11 w-11 items-center justify-center border border-[var(--color-line)] lg:hidden"
          >
            <div className="relative h-4 w-5">
              <span
                className={`absolute left-0 h-0.5 w-5 bg-current transition-all ${open ? 'top-1.5 rotate-45' : 'top-0'}`}
              />
              <span
                className={`absolute left-0 top-1.5 h-0.5 w-5 bg-current transition-all ${open ? 'opacity-0' : 'opacity-100'}`}
              />
              <span
                className={`absolute left-0 h-0.5 w-5 bg-current transition-all ${open ? 'top-1.5 -rotate-45' : 'top-3'}`}
              />
            </div>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-[var(--color-line)] bg-[var(--color-ink)] lg:hidden">
          <nav className="container-hcr flex flex-col py-4" aria-label="Mobile">
            <NavLink to="/" className="border-b border-[var(--color-line)] py-4 font-display text-2xl uppercase">
              Home
            </NavLink>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `border-b border-[var(--color-line)] py-4 font-display text-2xl uppercase ${
                    isActive ? 'text-[var(--color-brand)]' : ''
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <Link
              to="/signup"
              className="mt-6 bg-[var(--color-brand)] py-4 text-center font-display text-2xl uppercase text-black"
            >
              Sign Up for the Season
            </Link>
          </nav>
        </div>
      )}
    </header>
  )
}
