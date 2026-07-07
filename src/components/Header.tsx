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

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="HCR League home">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-ink)]">
        <img src={logo} alt="" className="h-6 w-6 object-contain" />
      </span>
      <span className="font-display text-xl font-extrabold uppercase tracking-tight">
        HCR<span className="text-[var(--color-brand-deep)]">/</span>League
      </span>
    </Link>
  )
}

export default function Header() {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-line)] bg-[var(--color-paper)]/85 backdrop-blur-md">
      <div className="container-hcr flex h-[72px] items-center justify-between gap-4">
        <Wordmark />

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `relative text-[15px] font-medium transition-colors ${
                  isActive ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {item.label}
                  {isActive && (
                    <span className="absolute -bottom-[26px] left-0 right-0 h-[3px] bg-[var(--color-brand)]" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            to="/signup"
            className="hidden rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-[13px] font-bold uppercase tracking-wide text-black transition-transform hover:-translate-y-0.5 sm:block"
          >
            Enter Season
          </Link>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--color-line-2)] lg:hidden"
          >
            <div className="relative h-4 w-5">
              <span className={`absolute left-0 h-0.5 w-5 bg-current transition-all ${open ? 'top-1.5 rotate-45' : 'top-0'}`} />
              <span className={`absolute left-0 top-1.5 h-0.5 w-5 bg-current transition-all ${open ? 'opacity-0' : 'opacity-100'}`} />
              <span className={`absolute left-0 h-0.5 w-5 bg-current transition-all ${open ? 'top-1.5 -rotate-45' : 'top-3'}`} />
            </div>
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-x-0 top-[72px] bottom-0 z-40 overflow-y-auto bg-[var(--color-paper)] lg:hidden">
          <nav className="container-hcr flex flex-col py-2" aria-label="Mobile">
            <NavLink to="/" className="border-b border-[var(--color-line)] py-4 font-display text-2xl font-extrabold uppercase">
              Home
            </NavLink>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `border-b border-[var(--color-line)] py-4 font-display text-2xl font-extrabold uppercase ${
                    isActive ? 'text-[var(--color-brand-deep)]' : ''
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <Link
              to="/signup"
              className="mt-6 rounded-lg bg-[var(--color-brand)] py-4 text-center font-display text-2xl font-extrabold uppercase text-black"
            >
              Enter the Season
            </Link>
          </nav>
        </div>
      )}
    </header>
  )
}
