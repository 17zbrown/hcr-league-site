import type { ClassId, RaceResult, StandingRow, Team } from './types'
import { CLASS_ORDER } from './format'
import { crewNames } from './attribution'

/**
 * Stable identity for a crew, independent of how race control typed it.
 * "A. Smith / B. Jones" and "B. Jones, A. Smith" are the same entry — keying on
 * the raw text split one team's championship into two half-scoring rows.
 */
function crewKey(driversText?: string | null, fallback = ''): string {
  const names = crewNames(driversText)
  return names.length ? names.sort().join('|') : fallback.toLowerCase()
}

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
    .sort((a, b) => b.points - a.points || (a.bestFinish ?? 99) - (b.bestFinish ?? 99) || a.key.localeCompare(b.key))
}

/** Row points: race + quali + steward adjustment. The single scoring formula. */
export const rowPoints = (r: RaceResult) =>
  (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)

/** Rows that score the Fill-In Cup. */
export function fillInRows<T extends RaceResult>(rows: T[]): T[] {
  return rows.filter((r) => r.fill_in)
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
    if (r.fill_in) continue // fill-in entries score the Fill-In Cup, not the title
    const cls = r.class_id as ClassId
    if (!CLASS_ORDER.includes(cls)) continue
    const pts = rowPoints(r)
    const clsPos = r.cls_pos ?? null

    // Driver standings — keyed by driver name text (crew).
    const dName = (r.drivers_text || '').trim() || `#${r.number}`
    const dKey = crewKey(r.drivers_text, dName)
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

export type FullResult = RaceResult & {
  event?: { id: string; round: number; name: string | null; date: string; track?: { name: string } | null }
}

export interface ProgressionRound {
  round: number
  label: string
  short: string
}

export interface ProgressionSeries {
  key: string
  name: string
  /** Cumulative points after each round in `rounds` (same length/order). */
  cumulative: number[]
  total: number
}

export interface Progression {
  rounds: ProgressionRound[]
  series: ProgressionSeries[]
}

/** Short track label for a round tick (e.g. "Daytona Road Course" -> "DAYTONA"). */
function shortTrack(name?: string | null, fallback = ''): string {
  const base = (name || fallback || '').trim()
  if (!base) return fallback
  const first = base.split(/[\s/·-]/).find((w) => w.length > 1) ?? base
  return first.slice(0, 3).toUpperCase()
}

/**
 * Cumulative championship points per driver (or team) across completed rounds,
 * for one class. Every series starts at 0 (season open) so a single completed
 * round already draws a proper line. Sorted by final total; drivers who miss a
 * round carry their previous total forward.
 */
export function computeProgression(
  full: FullResult[],
  classId: ClassId,
  teams: Team[] = [],
  mode: 'drivers' | 'teams' = 'drivers',
): Progression {
  const teamById = new Map(teams.map((t) => [t.id, t]))
  const rows = full.filter((r) => r.class_id === classId && r.event && !r.fill_in)

  // Distinct rounds, ordered.
  const roundMap = new Map<number, ProgressionRound>()
  for (const r of rows) {
    const rd = r.event!.round
    if (!roundMap.has(rd)) {
      roundMap.set(rd, {
        round: rd,
        label: `Round ${rd}`,
        short: shortTrack(r.event!.track?.name, `R${rd}`),
      })
    }
  }
  const rounds = Array.from(roundMap.values()).sort((a, b) => a.round - b.round)
  if (!rounds.length) return { rounds: [], series: [] }
  const roundIndex = new Map(rounds.map((r, i) => [r.round, i]))

  // per-series per-round point totals
  const seriesMap = new Map<string, { name: string; perRound: number[] }>()
  for (const r of rows) {
    const pts = rowPoints(r)
    let key: string
    let name: string
    if (mode === 'teams') {
      key = r.team_id ?? `num-${r.number}`
      name = (r.team_id ? teamById.get(r.team_id)?.name : undefined) ?? `#${r.number}`
    } else {
      name = (r.drivers_text || '').trim() || `#${r.number}`
      key = crewKey(r.drivers_text, name)
    }
    const s = seriesMap.get(key) ?? { name, perRound: new Array(rounds.length).fill(0) }
    s.perRound[roundIndex.get(r.event!.round)!] += pts
    seriesMap.set(key, s)
  }

  const series: ProgressionSeries[] = Array.from(seriesMap.entries()).map(([key, s]) => {
    const cumulative: number[] = []
    let run = 0
    for (let i = 0; i < rounds.length; i++) {
      run += s.perRound[i]
      cumulative.push(run)
    }
    return { key, name: s.name, cumulative, total: run }
  })
  series.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))

  return { rounds, series }
}

/**
 * Fill-In Cup: the side standings for guest/fill-in drives. One combined table
 * across classes (a driver who fills in for two different classes appears once
 * per class raced — that's honest, they're different machinery). Completely
 * separate pool from the main championship points.
 */
export function computeFillInStandings(results: RaceResult[]): StandingRow[] {
  const map = new Map<string, Accum>()
  for (const r of results) {
    if (!r.fill_in) continue
    const cls = r.class_id as ClassId
    if (!CLASS_ORDER.includes(cls)) continue
    const clsPos = r.cls_pos ?? null
    const dName = (r.drivers_text || '').trim() || `#${r.number}`
    const key = `${crewKey(r.drivers_text, dName)}::${cls}`
    const a =
      map.get(key) ??
      { key, name: dName, number: r.number, classId: cls, points: 0, starts: 0, wins: 0, podiums: 0, poles: 0, bestFinish: null }
    a.points += rowPoints(r)
    a.starts += 1
    if (clsPos === 1) a.wins += 1
    if (clsPos !== null && clsPos <= 3) a.podiums += 1
    if (r.quali_pos === 1) a.poles += 1
    a.bestFinish = a.bestFinish === null ? clsPos : Math.min(a.bestFinish, clsPos ?? 99)
    map.set(key, a)
  }
  return finalize(map)
}
