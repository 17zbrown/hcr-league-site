import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import Home from './pages/Home'
import Schedule from './pages/Schedule'
import Standings from './pages/Standings'
import Results from './pages/Results'
import Drivers from './pages/Drivers'
import DriverProfile from './pages/DriverProfile'
import Teams from './pages/Teams'
import TeamProfile from './pages/TeamProfile'
import News from './pages/News'
import SignUp from './pages/SignUp'
import Login from './pages/Login'
import Account from './pages/Account'
import CommissionerPortal from './pages/commissioner/CommissionerPortal'
import ManagerPortal from './pages/manager/ManagerPortal'
import { RequireAdmin, RequireAuth, RequireManager } from './components/guards'
import NotFound from './pages/NotFound'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/standings" element={<Standings />} />
          <Route path="/results" element={<Results />} />
          <Route path="/drivers" element={<Drivers />} />
          <Route path="/drivers/:id" element={<DriverProfile />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/teams/:id" element={<TeamProfile />} />
          <Route path="/news" element={<News />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/login" element={<Login />} />
          <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="/commissioner" element={<RequireAdmin><CommissionerPortal /></RequireAdmin>} />
          <Route path="/manager" element={<RequireManager><ManagerPortal /></RequireManager>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
