import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'

/** Fade + rise reveal. Fires once when scrolled into view (or immediately on load). */
export function Reveal({
  children,
  delay = 0,
  y = 20,
  className = '',
  as = 'div',
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
  as?: 'div' | 'section' | 'li' | 'span'
}) {
  const reduce = useReducedMotion()
  const MotionTag = motion[as] as typeof motion.div
  return (
    <MotionTag
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1, margin: '0px 0px -60px 0px' }}
      transition={{ duration: 0.6, delay, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </MotionTag>
  )
}

/** Count a number up from 0 → value when it scrolls into view. */
export function CountUp({
  value,
  className = '',
  duration = 1100,
}: {
  value: number
  className?: string
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const reduce = useReducedMotion()
  const [display, setDisplay] = useState(reduce ? value : 0)

  useEffect(() => {
    if (!inView || reduce) {
      setDisplay(value)
      return
    }
    let raf = 0
    let start: number | null = null
    const step = (ts: number) => {
      if (start === null) start = ts
      const p = Math.min((ts - start) / duration, 1)
      setDisplay(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [inView, value, duration, reduce])

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  )
}

/** Infinite horizontal marquee. Children are duplicated for a seamless loop. */
export function Marquee({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden ${className}`} aria-hidden="true">
      <div className="marquee-track">
        <div className="flex shrink-0">{children}</div>
        <div className="flex shrink-0">{children}</div>
      </div>
    </div>
  )
}
