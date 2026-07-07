import { useEffect, useState } from 'react'
import { countdownParts, pad2 } from '../lib/format'

export default function Countdown({ target, dark = false }: { target: string; dark?: boolean }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const parts = countdownParts(target, now)

  if (!parts) {
    return <div className="font-display text-2xl font-extrabold uppercase text-[var(--color-brand-deep)]">Lights out</div>
  }

  const cells = [
    { v: parts.days, l: 'Days' },
    { v: parts.hours, l: 'Hrs' },
    { v: parts.mins, l: 'Min' },
    { v: parts.secs, l: 'Sec' },
  ]

  const cellBg = dark ? 'bg-white/10' : 'bg-[var(--color-mist)]'
  const labelColor = dark ? 'text-white/50' : 'text-[var(--color-muted)]'

  return (
    <div className="flex gap-2 sm:gap-2.5" role="timer" aria-label="Time until next race">
      {cells.map((c) => (
        <div key={c.l} className={`flex flex-1 flex-col items-center rounded-xl px-2 py-3 ${cellBg}`}>
          <span className="tabular text-2xl font-semibold sm:text-3xl">{pad2(c.v)}</span>
          <span className={`mt-1.5 font-mono text-[10px] uppercase tracking-widest ${labelColor}`}>{c.l}</span>
        </div>
      ))}
    </div>
  )
}
