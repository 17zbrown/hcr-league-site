import { Link } from 'react-router-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useReducedMotion } from 'framer-motion'

/* ------------------------------------------------------------------ *
 * The editorial kit: the reference's language as reusable parts —
 * hairline-divided stat bands with big display numerals, navy feature
 * panels, and eyebrow + display section heads.
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
  /** Optional destination — the tile becomes a link. */
  to?: string
  label: string
  value: number | null | undefined
  decimals?: number
  prefix?: string
  suffix?: string
  /** Show a plain string instead of an animated numeral (e.g. a lap time). */
  text?: string | null
  hint?: string
}

/** The type sizes the design asks for, and the floor below which it stops shrinking. */
const NUM_MAX_REM = 3      // text-5xl, the proportional numerals
const MONO_MAX_REM = 2.25  // text-4xl, lap times in the mono face
// The floor is a legibility limit, and it is the one thing that can still clip: once
// the size stops shrinking, a long enough value in a narrow enough tile has nowhere
// left to go. 1rem holds a nine-character lap time down to a ~120px tile, which is
// narrower than a two-up band on the smallest phone — below that the floor wins, and
// a 16px numeral is the right thing to keep.
const MIN_REM = 1
/**
 * Widest glyph advance we plan for, in em. Measured against what actually renders
 * here: JetBrains Mono averages ~0.58em and Archivo's digits ~0.60em, and the widest
 * real string on the page ("1.35%", where '%' pulls the average up) came to 0.615em
 * per character.
 *
 * 0.68 leaves about 10% over that worst observed case. The margin matters because
 * the count is characters, not glyphs: a value made entirely of wide ones — say
 * "100.00%" — averages higher than anything currently in the data, and the failure
 * mode is a clipped number rather than a slightly small one.
 *
 * Only values long enough to miss the cap are affected at all; short ones stay at
 * full size regardless.
 */
const GLYPH_EM = 0.68

/**
 * A font size that makes `chars` glyphs fit the tile, never exceeding `maxRem`.
 *
 * WHY THIS IS COMPUTED RATHER THAN A CLASS. The same band renders four-up in the
 * narrow column of a driver profile — about 130px of usable width — and six-up across
 * a full-width page. At the narrow end a lap time set at 36px measured 165px and was
 * simply cut off by the next hairline: clipped, not shrunk.
 *
 * A flat container-query ratio fixes the clipping but overcorrects, pulling a short
 * value like "600" down from 48px to 39px in a tile that had room to spare. Feeding
 * the actual character count in means the size only drops when the string genuinely
 * cannot fit, so short values keep the size the design asked for.
 *
 * 100cqi is the tile's content width, so this reads as: give each glyph an equal
 * share of the row, up to the cap.
 */
function fitSize(chars: number, maxRem: number): string {
  const budget = (Math.max(1, chars) * GLYPH_EM).toFixed(2)
  return `clamp(${MIN_REM}rem, calc(100cqi / ${budget}), ${maxRem}rem)`
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
  // Tiles may link (Stat.to) — a plain grid, since <a> isn't valid inside <dl>.
  const tile = (s: Stat) => {
    // What will actually be on screen, so the size below is chosen against the real
    // string rather than a guess. AnimatedStat counts UP to its value, so the final
    // frame is the widest one and the only one worth sizing for.
    const shown = s.text !== undefined
      ? (s.text ?? '—')
      : s.value == null
        ? '—'
        : `${s.prefix ?? ''}${s.value.toFixed(s.decimals ?? 0)}${s.suffix ?? ''}`
    return (
      <>
        <div className="font-body text-[10px] font-semibold uppercase leading-tight tracking-[0.14em] text-[var(--color-muted)]">
          {s.label}
        </div>
        <div
          className="mt-2 font-display leading-none text-[var(--color-ink)]"
          style={{ fontSize: fitSize(shown.length, s.text !== undefined && s.text ? MONO_MAX_REM : NUM_MAX_REM) }}
        >
          {s.text !== undefined ? (
            <span className={s.text ? 'tabular' : ''}>{s.text ?? '—'}</span>
          ) : (
            <AnimatedStat value={s.value} decimals={s.decimals} prefix={s.prefix} suffix={s.suffix} />
          )}
        </div>
        {s.hint && <p className="mt-1.5 text-xs text-[var(--color-faint)]">{s.hint}</p>}
      </>
    )
  }
  return (
    <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--color-line)] ${cols}`}>
      {stats.map((s) =>
        s.to ? (
          <Link
            key={s.label}
            to={s.to}
            className="group @container bg-[var(--color-paper)] px-5 py-6 transition-colors hover:bg-[var(--color-cloud)]"
          >
            {tile(s)}
          </Link>
        ) : (
          <div key={s.label} className="@container bg-[var(--color-paper)] px-5 py-6">{tile(s)}</div>
        ),
      )}
    </div>
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
