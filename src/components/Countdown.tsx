import { useEffect, useState } from 'react'
import { countdownParts, pad2 } from '../lib/format'

export default function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const parts = countdownParts(target, now)

  if (!parts) {
    return <div className="font-display text-2xl uppercase text-[var(--color-brand)]">Lights out</div>
  }

  const cells = [
    { v: parts.days, l: 'Days' },
    { v: parts.hours, l: 'Hrs' },
    { v: parts.mins, l: 'Min' },
    { v: parts.secs, l: 'Sec' },
  ]

  return (
    <div className="flex gap-2 sm:gap-3" role="timer" aria-label="Time until next race">
      {cells.map((c) => (
        <div
          key={c.l}
          className="flex min-w-[3.5rem] flex-col items-center border border-[var(--color-line)] bg-[var(--color-ink-2)] px-2 py-2 sm:min-w-[4.25rem]"
        >
          <span className="tabular text-2xl font-bold sm:text-3xl">{pad2(c.v)}</span>
          <span className="mt-1 font-mono text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
            {c.l}
          </span>
        </div>
      ))}
    </div>
  )
}
