import type { ReactNode } from 'react'
import { useClasses } from '../lib/queries'
import { classColor } from '../lib/format'

/** Small class identity chip (GTP / LMP2 / GTD) — color driven by the DB. */
export function ClassChip({ classId, size = 'sm' }: { classId: string; size?: 'sm' | 'md' }) {
  const { data: classes } = useClasses()
  const color = classColor(classId, classes)
  const pad = size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'
  return (
    <span
      className={`inline-flex items-center gap-1.5 border font-mono font-medium uppercase tracking-wider ${pad}`}
      style={{ borderColor: color, color }}
    >
      <span className="h-1.5 w-1.5" style={{ background: color }} />
      {classId}
    </span>
  )
}

/** A section wrapper with an eyebrow + heading. */
export function Section({
  eyebrow,
  title,
  action,
  children,
  className = '',
}: {
  eyebrow?: string
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`container-hcr py-14 md:py-20 ${className}`}>
      {(eyebrow || title || action) && (
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
            {title && <h2 className="text-4xl md:text-5xl">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** Loading shimmer block. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-[var(--color-ink-3)] ${className}`} />
}

export function PositionBadge({ pos, color }: { pos: number | null; color?: string }) {
  return (
    <span
      className="tabular inline-flex h-8 w-8 items-center justify-center text-sm font-bold"
      style={{ background: color ?? 'var(--color-ink-3)', color: color ? '#000' : 'var(--color-paper)' }}
    >
      {pos ?? '—'}
    </span>
  )
}
