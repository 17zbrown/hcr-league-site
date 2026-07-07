import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'

function Loading() {
  return (
    <div className="container-hcr flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-brand)]" />
    </div>
  )
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <>{children}</>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { session, isAdmin, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!isAdmin) return <Denied title="Commissioners only" />
  return <>{children}</>
}

export function RequireManager({ children }: { children: ReactNode }) {
  const { session, isAdmin, isManager, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!isManager && !isAdmin) return <Denied title="Team managers only" />
  return <>{children}</>
}

function Denied({ title }: { title: string }) {
  return (
    <div className="container-hcr flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="font-display text-6xl font-extrabold uppercase text-[var(--color-ink)]">Black flag</div>
      <p className="mt-3 text-lg text-[var(--color-muted)]">
        {title}. Ask the commissioner for access if you think this is a mistake.
      </p>
    </div>
  )
}
