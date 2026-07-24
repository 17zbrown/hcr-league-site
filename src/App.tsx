import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import Home from './pages/Home'
import { RequireAdmin, RequireAuth, RequireManager, RequireRaceControl } from './components/guards'

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
const Reports = lazy(() => import('./pages/Reports'))
const SignUp = lazy(() => import('./pages/SignUp'))
const Login = lazy(() => import('./pages/Login'))
const Account = lazy(() => import('./pages/Account'))
const CommissionerPortal = lazy(() => import('./pages/commissioner/CommissionerPortal'))
const ManagerPortal = lazy(() => import('./pages/manager/ManagerPortal'))
const MemberPortal = lazy(() => import('./pages/portal/MemberPortal'))
const ProtestDetail = lazy(() => import('./pages/portal/ProtestDetail'))
const RaceControlPortal = lazy(() => import('./pages/control/RaceControlPortal'))
const NotFound = lazy(() => import('./pages/NotFound'))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
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
            <Route path="/reports" element={<Reports />} />
          <Route path="/news" element={<Reports />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/login" element={<Login />} />
            <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
            {/* Member portal — profile, protests */}
            <Route path="/portal" element={<RequireAuth><MemberPortal /></RequireAuth>} />
            <Route path="/portal/protests/:id" element={<RequireAuth><ProtestDetail /></RequireAuth>} />

            {/* Race control — protest queue + rulings */}
            <Route path="/control" element={<RequireRaceControl><RaceControlPortal /></RequireRaceControl>} />
            <Route path="/control/protests/:id" element={<RequireRaceControl><ProtestDetail /></RequireRaceControl>} />

            {/* Admin (formerly /commissioner, which still resolves) */}
            <Route path="/admin" element={<RequireAdmin><CommissionerPortal /></RequireAdmin>} />
            <Route path="/commissioner" element={<RequireAdmin><CommissionerPortal /></RequireAdmin>} />
            <Route path="/manager" element={<RequireManager><ManagerPortal /></RequireManager>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
    </div>
  )
}
