import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useDrivers } from '../lib/queries'

/**
 * Render a crew/driver string with any recognized driver names turned into
 * links to their profile. Handles single names and crews ("A / B").
 */
export function DriverName({ text, className = '' }: { text?: string | null; className?: string }) {
  const { data: drivers } = useDrivers()
  if (!text) return null

  const index = new Map((drivers ?? []).map((d) => [d.name.trim().toLowerCase(), d.id]))
  // Split on common crew separators while keeping the separators.
  const parts = text.split(/(\s*(?:\/|&|,| and )\s*)/i)

  return (
    <span className={className}>
      {parts.map((part, i) => {
        const id = index.get(part.trim().toLowerCase())
        if (id) {
          return (
            <Link key={i} to={`/drivers/${id}`} className="underline-offset-2 hover:text-[var(--color-blue)] hover:underline">
              {part}
            </Link>
          )
        }
        return <Fragment key={i}>{part}</Fragment>
      })}
    </span>
  )
}

export function TeamLink({
  teamId,
  className = '',
  children,
}: {
  teamId?: string | null
  className?: string
  children: ReactNode
}) {
  if (!teamId) return <span className={className}>{children}</span>
  return (
    <Link to={`/teams/${teamId}`} className={`${className} underline-offset-2 hover:text-[var(--color-blue)] hover:underline`}>
      {children}
    </Link>
  )
}
