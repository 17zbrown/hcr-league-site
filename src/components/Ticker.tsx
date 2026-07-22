import { useMemo } from 'react'
import { useCurrentSeason, useEvents, useSeasonResults, useTeams } from '../lib/queries'
import { computeStandings } from '../lib/standings'
import { CLASS_ORDER, fmtDate } from '../lib/format'
import { Marquee } from './motion'

interface Item {
  label: string
  value: string
}

/** Broadcast-style scrolling ticker fed by live league data. */
export default function Ticker() {
  const { data: season } = useCurrentSeason()
  const { data: events } = useEvents(season?.id)
  const { data: results } = useSeasonResults(season?.id)
  const { data: teams } = useTeams()

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    const sorted = [...(events ?? [])].sort((a, b) => a.round - b.round)
    const complete = sorted.filter((e) => e.status === 'complete')
    const next =
      sorted.find((e) => e.status === 'next') ??
      sorted.find((e) => new Date(e.date).getTime() > Date.now())
    const last = complete[complete.length - 1]

    if (season) out.push({ label: 'Season', value: season.name })
    out.push({ label: 'Format', value: '3 Classes · 3 Titles' })
    if (events?.length) out.push({ label: 'Calendar', value: `${complete.length}/${events.length} Rounds` })

    if (next) {
      out.push({ label: `Next · R${next.round}`, value: `${next.track?.name ?? next.name} · ${fmtDate(next.date)}` })
    }

    const standings = computeStandings(results ?? [], teams ?? [])
    for (const cls of CLASS_ORDER) {
      const leader = standings.drivers[cls]?.[0]
      if (leader) out.push({ label: `${cls} Leader`, value: `${leader.name} · ${leader.points}` })
    }

    if (last) out.push({ label: `R${last.round} Result`, value: last.name ?? last.track?.name ?? '' })

    // Ensure the track is always long enough to fill wide screens.
    if (out.length < 8) out.push({ label: 'Sim', value: 'iRacing Endurance' })
    return out
  }, [season, events, results, teams])

  if (!items.length) return null

  return (
    <Marquee className="on-navy border-y border-white/10 bg-[var(--color-deep)]">
      {items.map((it, i) => (
        <span key={i} className="flex items-center whitespace-nowrap py-3.5 pl-6 pr-1">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
            {it.label}
          </span>
          <span className="ml-3 font-display text-lg text-white">
            {it.value}
          </span>
          <span className="ml-6 text-[var(--color-brand)]">◆</span>
        </span>
      ))}
    </Marquee>
  )
}
