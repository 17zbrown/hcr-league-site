import type { ClassId, RaceResult, StandingRow, Team } from './types'
import { CLASS_ORDER } from './format'

interface Accum {
  key: string
  name: string
  number?: string
  car?: string | null
  classId: ClassId
  points: number
  starts: number
  wins: number
  podiums: number
  poles: number
  bestFinish: number | null
}

function finalize(map: Map<string, Accum>): StandingRow[] {
  return Array.from(map.values())
    .map((a) => ({ ...a }))
    .sort((a, b) => b.points - a.points || (a.bestFinish ?? 99) - (b.bestFinish ?? 99))
}

/**
 * Compute per-class driver + team standings from raw results rows.
 * Points = sum of (points + quali_points + adjust). Class position drives
 * wins/podiums. Mirrors the league's IMSA-style class scoring.
 */
export function computeStandings(
  results: RaceResult[],
  teams: Team[] = [],
): {
  drivers: Record<ClassId, StandingRow[]>
  teams: Record<ClassId, StandingRow[]>
} {
  const teamById = new Map(teams.map((t) => [t.id, t]))
  const driverMap: Record<ClassId, Map<string, Accum>> = { GTP: new Map(), LMP2: new Map(), GTD: new Map() }
  const teamMap: Record<ClassId, Map<string, Accum>> = { GTP: new Map(), LMP2: new Map(), GTD: new Map() }

  for (const r of results) {
    const cls = r.class_id as ClassId
    if (!CLASS_ORDER.includes(cls)) continue
    const pts = (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)
    const clsPos = r.cls_pos ?? null

    // Driver standings — keyed by driver name text (crew).
    const dName = (r.drivers_text || '').trim() || `#${r.number}`
    const dKey = dName.toLowerCase()
    const d =
      driverMap[cls].get(dKey) ??
      { key: dKey, name: dName, number: r.number, classId: cls, points: 0, starts: 0, wins: 0, podiums: 0, poles: 0, bestFinish: null }
    d.points += pts
    d.starts += 1
    if (clsPos === 1) d.wins += 1
    if (clsPos !== null && clsPos <= 3) d.podiums += 1
    if (r.quali_pos === 1) d.poles += 1
    d.bestFinish = d.bestFinish === null ? clsPos : Math.min(d.bestFinish, clsPos ?? 99)
    driverMap[cls].set(dKey, d)

    // Team standings — keyed by team_id (fallback to number).
    const tKey = r.team_id ?? `num-${r.number}`
    const team = r.team_id ? teamById.get(r.team_id) : undefined
    const tName = team?.name ?? `#${r.number}`
    const t =
      teamMap[cls].get(tKey) ??
      { key: tKey, name: tName, number: r.number, car: team?.car ?? r.car, classId: cls, points: 0, starts: 0, wins: 0, podiums: 0, poles: 0, bestFinish: null }
    t.points += pts
    t.starts += 1
    if (clsPos === 1) t.wins += 1
    if (clsPos !== null && clsPos <= 3) t.podiums += 1
    if (r.quali_pos === 1) t.poles += 1
    t.bestFinish = t.bestFinish === null ? clsPos : Math.min(t.bestFinish, clsPos ?? 99)
    teamMap[cls].set(tKey, t)
  }

  return {
    drivers: { GTP: finalize(driverMap.GTP), LMP2: finalize(driverMap.LMP2), GTD: finalize(driverMap.GTD) },
    teams: { GTP: finalize(teamMap.GTP), LMP2: finalize(teamMap.LMP2), GTD: finalize(teamMap.GTD) },
  }
}

/** Fetch results across many events is done in the page; this helper just needs rows. */
export function emptyStandings() {
  return { GTP: [], LMP2: [], GTD: [] } as Record<ClassId, StandingRow[]>
}
