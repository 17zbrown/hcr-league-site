import type { RaceResult } from './types'

export interface EntityStats {
  starts: number
  wins: number
  podiums: number
  poles: number
  bestFinish: number | null
  points: number
  bestLap: string | null
}

/** Parse an iRacing-style lap string ("1:35.433" or "58.900") to seconds. */
export function lapToSeconds(t?: string | null): number | null {
  if (!t) return null
  const m = t.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const min = m[1] ? parseInt(m[1], 10) : 0
  return min * 60 + parseFloat(m[2])
}

/** Aggregate a set of result rows into headline stats. */
export function computeEntityStats(rows: RaceResult[]): EntityStats {
  let wins = 0
  let podiums = 0
  let poles = 0
  let points = 0
  let bestFinish: number | null = null
  let bestLap: string | null = null
  let bestLapSec = Infinity

  for (const r of rows) {
    points += (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)
    const cp = r.cls_pos
    if (cp === 1) wins += 1
    if (cp !== null && cp <= 3) podiums += 1
    if (r.quali_pos === 1) poles += 1
    if (cp !== null) bestFinish = bestFinish === null ? cp : Math.min(bestFinish, cp)
    const s = lapToSeconds(r.best_lap)
    if (s !== null && s < bestLapSec) {
      bestLapSec = s
      bestLap = r.best_lap ?? null
    }
  }

  return { starts: rows.length, wins, podiums, poles, bestFinish, points, bestLap }
}
