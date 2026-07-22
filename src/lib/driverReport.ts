import type { RaceResult } from './types'
import { lapToSeconds } from './profileStats'

/**
 * Everything the driver report shows, derived purely from imported race-control
 * rows — no hand-entered numbers. Anything that can't be computed from the data
 * present comes back null so the UI can hide it rather than print a fake zero.
 */

export type FullRow = RaceResult & {
  event?: { id: string; round: number; name: string | null; date?: string; track?: { name: string } | null } | null
}

export interface RoundForm {
  round: number
  label: string
  clsPos: number | null
  gained: number | null
  points: number
  dnf: boolean
}

export interface DriverReport {
  starts: number
  wins: number
  podiums: number
  poles: number
  top5: number
  points: number
  bestFinish: number | null
  worstFinish: number | null
  avgFinish: number | null
  avgStart: number | null
  /** Net places made up across the season (grid → overall finish). */
  placesGained: number | null
  bestLap: string | null
  totalLaps: number
  incidents: number | null
  incPerRace: number | null
  dnfs: number
  finishRate: number | null
  winRate: number | null
  podiumRate: number | null
  /** 0–100: how repeatable the finishing positions are (low spread = high). */
  consistency: number | null
  /** Best lap as a % off the fastest in class that race, averaged. */
  avgPaceGap: number | null
  form: RoundForm[]
}

const isDnf = (r: RaceResult) => {
  const s = (r.status ?? '').toUpperCase()
  return s === 'DNF' || s === 'DNS' || s === 'DSQ' || s === 'DISCO'
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/**
 * @param rows      this driver's result rows (season or career)
 * @param allRows   every result row, used to work out class-fastest laps
 */
export function buildDriverReport(rows: FullRow[], allRows: FullRow[] = []): DriverReport {
  const sorted = [...rows].sort((a, b) => (a.event?.round ?? 0) - (b.event?.round ?? 0))

  let wins = 0, podiums = 0, poles = 0, top5 = 0, points = 0, totalLaps = 0, dnfs = 0
  let bestFinish: number | null = null
  let worstFinish: number | null = null
  let bestLap: string | null = null
  let bestLapSec = Infinity
  const finishes: number[] = []
  const starts: number[] = []
  const incidentsArr: number[] = []
  let gained = 0
  let gainedSeen = false

  // fastest best-lap per event+class, for the pace-gap metric
  const fastest = new Map<string, number>()
  for (const r of allRows) {
    const s = lapToSeconds(r.best_lap)
    if (s == null) continue
    const k = `${r.event_id ?? ''}|${r.class_id ?? ''}`
    const cur = fastest.get(k)
    if (cur == null || s < cur) fastest.set(k, s)
  }
  const paceGaps: number[] = []

  for (const r of sorted) {
    points += (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)
    totalLaps += r.laps ?? 0
    if (isDnf(r)) dnfs += 1

    const cp = r.cls_pos
    if (cp != null) {
      finishes.push(cp)
      if (cp === 1) wins += 1
      if (cp <= 3) podiums += 1
      if (cp <= 5) top5 += 1
      bestFinish = bestFinish == null ? cp : Math.min(bestFinish, cp)
      worstFinish = worstFinish == null ? cp : Math.max(worstFinish, cp)
    }
    if (r.quali_pos === 1) poles += 1
    if (r.quali_pos != null) starts.push(r.quali_pos)
    if (r.inc != null) incidentsArr.push(r.inc)

    if (r.grid != null && r.pos != null) {
      gained += r.grid - r.pos
      gainedSeen = true
    }

    const s = lapToSeconds(r.best_lap)
    if (s != null) {
      if (s < bestLapSec) { bestLapSec = s; bestLap = r.best_lap ?? null }
      const f = fastest.get(`${r.event_id ?? ''}|${r.class_id ?? ''}`)
      if (f && f > 0) paceGaps.push((s / f - 1) * 100)
    }
  }

  // consistency: tighter spread of finishes = higher score
  let consistency: number | null = null
  if (finishes.length >= 2) {
    const m = avg(finishes)!
    const sd = Math.sqrt(avg(finishes.map((f) => (f - m) ** 2))!)
    consistency = Math.max(0, Math.min(100, Math.round(100 - sd * 14)))
  } else if (finishes.length === 1) {
    consistency = 100
  }

  const form: RoundForm[] = sorted.map((r) => ({
    round: r.event?.round ?? 0,
    label: r.event?.name ?? r.event?.track?.name ?? `Round ${r.event?.round ?? '?'}`,
    clsPos: r.cls_pos ?? null,
    gained: r.grid != null && r.pos != null ? r.grid - r.pos : null,
    points: (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0),
    dnf: isDnf(r),
  }))

  const n = sorted.length
  return {
    starts: n,
    wins, podiums, poles, top5, points,
    bestFinish, worstFinish,
    avgFinish: avg(finishes),
    avgStart: avg(starts),
    placesGained: gainedSeen ? gained : null,
    bestLap,
    totalLaps,
    incidents: incidentsArr.length ? incidentsArr.reduce((a, b) => a + b, 0) : null,
    incPerRace: incidentsArr.length ? avg(incidentsArr) : null,
    dnfs,
    finishRate: n ? Math.round(((n - dnfs) / n) * 100) : null,
    winRate: n ? Math.round((wins / n) * 100) : null,
    podiumRate: n ? Math.round((podiums / n) * 100) : null,
    consistency,
    avgPaceGap: paceGaps.length ? avg(paceGaps) : null,
    form,
  }
}
