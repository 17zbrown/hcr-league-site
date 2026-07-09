import type { ReactNode } from 'react'
import { useClasses } from '../lib/queries'
import { classColor } from '../lib/format'

/** Small class identity chip (GTP / LMP2 / GTD) — color driven by the DB. */
export function ClassChip({ classId, size = 'sm' }: { classId: string; size?: 'sm' | 'md' }) {
  const { data: classes } = useClasses()
  const color = classColor(classId, classes)
  const pad = size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-1 text-[11px]'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-mono font-medium uppercase tracking-wider ${pad}`}
      style={{ background: `${color}1f`, color: '#3a3f49' }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {classId}
    </span>
  )
}

/** A section wrapper with an eyebrow + heading. */
export function Section({
  eyebrow,
  title,
  titleTag: TitleTag = 'h2',
  action,
  children,
  className = '',
}: {
  eyebrow?: string
  title?: ReactNode
  titleTag?: 'h1' | 'h2'
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`container-hcr py-16 md:py-20 ${className}`}>
      {(eyebrow || title || action) && (
        <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div>
            {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
            {title && <TitleTag className="text-4xl md:text-5xl">{title}</TitleTag>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[var(--color-mist)] ${className}`} />
}

export function PositionBadge({ pos, color, lead = false }: { pos: number | null; color?: string; lead?: boolean }) {
  return (
    <span
      className="tabular inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold"
      style={{
        background: lead && color ? color : 'var(--color-mist)',
        color: lead && color ? '#000' : 'var(--color-ink)',
      }}
    >
      {pos ?? '—'}
    </span>
  )
}
