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
      style={{ background: `${color}26`, color: 'var(--color-ink-2)' }}
    >
      {/* inset ring keeps pale hues (GTP yellow) visible on light grounds */}
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: color, boxShadow: 'inset 0 0 0 1px rgba(20,24,28,0.28)' }}
      />
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
            {eyebrow && (
              <div className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                {eyebrow}
              </div>
            )}
            {title && <TitleTag className="mt-2 text-5xl md:text-6xl">{title}</TitleTag>}
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

/**
 * A failed fetch is not an empty season. Without this, a dropped connection
 * rendered "No results scored yet" — telling members the league has no data
 * when really the request just failed.
 */
export function LoadError({
  what = 'this data',
  onRetry,
}: {
  what?: string
  onRetry?: () => void
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--color-line-2)] bg-[var(--color-paper)] p-8 text-center">
      <p className="font-display text-2xl">Couldn't load {what}.</p>
      <p className="mx-auto mt-2 max-w-sm font-body text-sm text-[var(--color-muted)]">
        The connection dropped or the server didn't answer. Your data is fine — this is just
        this page failing to fetch it.
      </p>
      {onRetry && (
        <button onClick={onRetry} className="hcr-btn hcr-btn-dark mt-5">
          Try again
        </button>
      )}
    </div>
  )
}

