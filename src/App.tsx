import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import Home from './pages/Home'
import { RequireAdmin, RequireAuth, RequireRaceControl } from './components/guards'

// Home loads eagerly (the landing page); everything else is code-split so the
// admin portals, results importer (pdf.js) and other pages don't weigh down the
// initial bundle for public visitors.
const Schedule = lazy(() => import('./pages/Schedule'))
const RaceDetail = lazy(() => import('./pages/RaceDetail'))
const Standings = lazy(() => import('./pages/Standings'))
const FillInStandings = lazy(() => import('./pages/FillInStandings'))
const Results = lazy(() => import('./pages/Results'))
const Drivers = lazy(() => import('./pages/Drivers'))
const DriverProfile = lazy(() => import('./pages/DriverProfile'))
const Teams = lazy(() => import('./pages/Teams'))
const Compare = lazy(() => import('./pages/Compare'))
const TeamProfile = lazy(() => import('./pages/TeamProfile'))
const News = lazy(() => import('./pages/News'))
const Rulebook = lazy(() => import('./pages/Rulebook'))
const SignUp = lazy(() => import('./pages/SignUp'))
const Login = lazy(() => import('./pages/Login'))
const CommissionerPortal = lazy(() => import('./pages/commissioner/CommissionerPortal'))
const MemberPortal = lazy(() => import('./pages/portal/MemberPortal'))
const ProtestDetail = lazy(() => import('./pages/portal/ProtestDetail'))
const RaceControlPortal = lazy(() => import('./pages/control/RaceControlPortal'))
const NotFound = lazy(() => import('./pages/NotFound'))

/**
 * Start each page at the top — UNLESS the URL names an anchor.
 *
 * Every news ping in Discord links to /news#<slug>, and News.tsx renders those ids,
 * but an unconditional scrollTo(0,0) on arrival threw the reader straight back to
 * the head of the feed. So the deep link resolved, and then undid itself.
 *
 * The anchor scroll is deferred a frame because the target is inside a lazily
 * loaded route: at the moment this effect runs the element usually does not exist
 * yet, and getElementById would return null.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }
    // POLL, don't guess at a delay. The target sits inside a lazily loaded route
    // whose content then arrives from Supabase, so on a cold load the element does
    // not exist for well over a second — a single fixed timeout lands on an empty
    // page and gives up. Measured: a fresh /news#<slug> had the article 12851px
    // down the page and still unrendered 250ms in.
    const id = decodeURIComponent(hash.slice(1))
    let timer = 0
    const deadline = performance.now() + 4000
    const tryJump = () => {
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ block: 'start' })
        return
      }
      // Give up quietly rather than hunt forever: a hash naming nothing (an old
      // link, a deleted story) should leave the reader at the top of the feed,
      // not spin.
      if (performance.now() < deadline) timer = window.setTimeout(tryJump, 100)
    }
    tryJump()
    return () => window.clearTimeout(timer)
  }, [pathname, hash])
  return null
}

function RouteFallback() {
  return (
    <div className="container-hcr flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-ink)]" aria-label="Loading" role="status" />
    </div>
  )
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <Header />
      <main className="flex-1">
        <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/schedule/:id" element={<RaceDetail />} />
            <Route path="/standings" element={<Standings />} />
            <Route path="/standings/fill-in" element={<FillInStandings />} />
            <Route path="/results" element={<Results />} />
            <Route path="/drivers" element={<Drivers />} />
            <Route path="/drivers/:id" element={<DriverProfile />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/teams/:id" element={<TeamProfile />} />
            {/*
              /news is the canonical path — it is what the #news channel topic
              promises, what every Discord news embed links to, and now what the nav
              points at. /reports was the app-only name for the same feed; it stays
              registered as a redirect because links to it are already out there.
            */}
            <Route path="/news" element={<News />} />
            <Route path="/reports" element={<Navigate to="/news" replace />} />
            <Route path="/rulebook" element={<Rulebook />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/login" element={<Login />} />
            {/*
              /account was the second member page: it held the season entry form and
              nothing linked to it. The form now lives in the portal's My car tab, but
              the path stays registered because the Discord welcome guide and every
              message that ever pointed somebody at "My Account" still use it — a 404
              there lands on the step people are most likely to be mid-way through.
            */}
            <Route path="/account" element={<Navigate to="/portal" replace />} />
            {/* Member portal — profile, season entry, car, protests */}
            <Route path="/portal" element={<RequireAuth><MemberPortal /></RequireAuth>} />
            <Route path="/portal/protests/:id" element={<RequireAuth><ProtestDetail /></RequireAuth>} />

            {/* Race control — protest queue + rulings */}
            <Route path="/control" element={<RequireRaceControl><RaceControlPortal /></RequireRaceControl>} />
            <Route path="/control/protests/:id" element={<RequireRaceControl><ProtestDetail /></RequireRaceControl>} />

            {/* Admin (formerly /commissioner, which still resolves) */}
            <Route path="/admin" element={<RequireAdmin><CommissionerPortal /></RequireAdmin>} />
            <Route path="/commissioner" element={<RequireAdmin><CommissionerPortal /></RequireAdmin>} />
            {/*
              No /manager. The team manager portal signed drivers to teams and ran a
              free-agent market for a league that has never had a team — `teams` is
              empty — and the one control that could grant profiles.is_team_manager
              went with the Teams admin, so the guard could no longer pass for anyone.
              A live route onto a page nobody can reach is worse than no route.
            */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
    </div>
  )
}
