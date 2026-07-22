import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useReducedMotion } from 'framer-motion'

/* ------------------------------------------------------------------ *
 * The editorial kit: the reference's language as reusable parts —
 * hairline-divided stat bands with big serif numerals, navy feature
 * panels, and eyebrow + serif section heads.
 * ------------------------------------------------------------------ */

/** Fires once when the element scrolls into view. */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setSeen(true)),
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return { ref, seen }
}

/** Serif numeral that counts up the first time it's seen. */
export function AnimatedStat({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
  duration = 1000,
}: {
  value: number | null | undefined
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
  duration?: number
}) {
  const reduce = useReducedMotion() ?? false
  const { ref, seen } = useInView<HTMLSpanElement>()
  const [n, setN] = useState(0)

  useEffect(() => {
    if (value == null) return
    if (!seen || reduce) { setN(value); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = Math.min((now - t0) / duration, 1)
      const eased = 1 - Math.pow(1 - k, 3) // easeOutCubic
      setN(value * eased)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, seen, reduce, duration])

  if (value == null) return <span ref={ref} className={className}>—</span>
  return (
    <span ref={ref} className={className}>
      {prefix}
      {n.toFixed(decimals)}
      {suffix}
    </span>
  )
}

export interface Stat {
  label: string
  value: number | null | undefined
  decimals?: number
  prefix?: string
  suffix?: string
  /** Show a plain string instead of an animated numeral (e.g. a lap time). */
  text?: string | null
  hint?: string
}

/**
 * The reference's signature: a row of tiny letterspaced labels above large
 * light serif numerals, split by hairlines.
 */
export function StatBand({ stats, columns = 6 }: { stats: Stat[]; columns?: number }) {
  const cols =
    columns >= 6 ? 'sm:grid-cols-3 lg:grid-cols-6'
    : columns === 5 ? 'sm:grid-cols-3 lg:grid-cols-5'
    : columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4'
    : 'sm:grid-cols-3'
  return (
    <dl className={`grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--color-line)] ${cols}`}>
      {stats.map((s) => (
        <div key={s.label} className="bg-[var(--color-paper)] px-5 py-6">
          <dt className="font-body text-[10px] font-semibold uppercase leading-tight tracking-[0.14em] text-[var(--color-muted)]">
            {s.label}
          </dt>
          <dd className="mt-2 font-display text-4xl leading-none text-[var(--color-ink)] md:text-5xl">
            {s.text !== undefined ? (
              <span className={s.text ? 'tabular text-3xl md:text-4xl' : ''}>{s.text ?? '—'}</span>
            ) : (
              <AnimatedStat value={s.value} decimals={s.decimals} prefix={s.prefix} suffix={s.suffix} />
            )}
          </dd>
          {s.hint && <p className="mt-1.5 text-xs text-[var(--color-faint)]">{s.hint}</p>}
        </div>
      ))}
    </dl>
  )
}

/** A deep navy feature panel — the reference's hero/athlete surface. */
export function FeaturePanel({
  children,
  className = '',
  grid = true,
}: {
  children: ReactNode
  className?: string
  grid?: boolean
}) {
  return (
    <section className={`on-navy relative overflow-hidden rounded-3xl bg-[var(--color-deep)] ${className}`}>
      {grid && <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />}
      <div className="relative">{children}</div>
    </section>
  )
}

/** Eyebrow + serif title, the editorial section opener. */
export function SectionHead({
  eyebrow,
  title,
  action,
  as: Tag = 'h2',
  className = '',
}: {
  eyebrow?: string
  title: ReactNode
  action?: ReactNode
  as?: 'h1' | 'h2'
  className?: string
}) {
  return (
    <div className={`mb-8 flex flex-wrap items-end justify-between gap-4 ${className}`}>
      <div>
        {eyebrow && (
          <div className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
            {eyebrow}
          </div>
        )}
        <Tag className="mt-2 text-4xl md:text-5xl">{title}</Tag>
      </div>
      {action}
    </div>
  )
}

/** Horizontal bar used for rates (win %, finish %, consistency). */
export function MeterRow({
  label, value, suffix = '%', color = 'var(--color-brand)',
}: { label: string; value: number | null; suffix?: string; color?: string }) {
  const { ref, seen } = useInView<HTMLDivElement>()
  const reduce = useReducedMotion() ?? false
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div ref={ref} className="py-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-body text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
          {label}
        </span>
        <span className="font-display text-2xl leading-none">
          {value == null ? '—' : <AnimatedStat value={value} suffix={suffix} />}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-mist)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${seen || reduce ? pct : 0}%`,
            background: color,
            transition: reduce ? 'none' : 'width 900ms cubic-bezier(.2,.7,.2,1)',
          }}
        />
      </div>
    </div>
  )
}
