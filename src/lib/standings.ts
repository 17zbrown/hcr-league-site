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
  /** finishCounts[p] = classified race finishes at class position p (count-back). */
  finishCounts: number[]
  /** round -> class finish, for the most-recent-round tiebreak. */
  roundFinish: Map<number, number>
}

/** Record one classified race finish into the count-back tallies. */
function tallyFinish(a: Accum, clsPos: number | null, round: number | undefined) {
  if (clsPos === null) return
  a.finishCounts[clsPos] = (a.finishCounts[clsPos] ?? 0) + 1
  if (round !== undefined) {
    const prev = a.roundFinish.get(round)
    a.roundFinish.set(round, prev === undefined ? clsPos : Math.min(prev, clsPos))
  }
}

/**
 * Count-back, the way real series break points ties (rulebook §32.5):
 * most class wins, then most seconds, then thirds, and so on down the order —
 * the procedure F1, IMSA and MotoGP share (F1 SR Art. 7.2, IMSA SR Art. 53,
 * FIM GP Art. 1.28.7). If two crews' full finish records are identical, IMSA's
 * final step decides — the tie goes to whoever achieved the shared best
 * finishing position EARLIEST in the season. (MotoGP takes the latest; this
 * league scores IMSA-style, so it takes IMSA's side.) Only race
 * classifications count; qualifying never enters count-back.
 */
function countBack(a: Accum, b: Accum): number {
  const maxP = Math.max(a.finishCounts.length, b.finishCounts.length)
  for (let p = 1; p < maxP; p++) {
    const diff = (b.finishCounts[p] ?? 0) - (a.finishCounts[p] ?? 0)
    if (diff) return diff
  }
  // Records identical — both hold the same best position; earliest date wins.
  // Two crews cannot share a class position in the same round, so when both
  // have any finish at all this terminates.
  for (let p = 1; p < maxP; p++) {
    if ((a.finishCounts[p] ?? 0) > 0) {
      let ra = Infinity
      let rb = Infinity
      for (const [rd, pos] of a.roundFinish) if (pos === p && rd < ra) ra = rd
      for (const [rd, pos] of b.roundFinish) if (pos === p && rd < rb) rb = rd
      if (ra !== rb) return ra < rb ? -1 : 1
      break
    }
  }
  return 0
}

function finalize(map: Map<string, Accum>): StandingRow[] {
  return Array.from(map.values())
    .map((a) => ({ ...a }))
    .sort((a, b) => b.points - a.points || countBack(a, b) || a.key.localeCompare(b.key))
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
      { key: dKey, name: dName, number: r.number, classId: cls, points: 0, starts: 0, wins: 0, podiums: 0, poles: 0, bestFinish: null, finishCounts: [], roundFinish: new Map() }
    d.points += pts
    d.starts += 1
    if (clsPos === 1) d.wins += 1
    if (clsPos !== null && clsPos <= 3) d.podiums += 1
    if (r.quali_pos === 1) d.poles += 1
    d.bestFinish = d.bestFinish === null ? clsPos : Math.min(d.bestFinish, clsPos ?? 99)
    tallyFinish(d, clsPos, r.event?.round)
    driverMap[cls].set(dKey, d)

    // Team standings — keyed by team_id (fallback to number).
    const tKey = r.team_id ?? `num-${r.number}`
    const team = r.team_id ? teamById.get(r.team_id) : undefined
    const tName = team?.name ?? `#${r.number}`
    const t =
      teamMap[cls].get(tKey) ??
      { key: tKey, name: tName, number: r.number, car: team?.car ?? r.car, classId: cls, points: 0, starts: 0, wins: 0, podiums: 0, poles: 0, bestFinish: null, finishCounts: [], roundFinish: new Map() }
    t.points += pts
    t.starts += 1
    if (clsPos === 1) t.wins += 1
    if (clsPos !== null && clsPos <= 3) t.podiums += 1
    if (r.quali_pos === 1) t.poles += 1
    t.bestFinish = t.bestFinish === null ? clsPos : Math.min(t.bestFinish, clsPos ?? 99)
    tallyFinish(t, clsPos, r.event?.round)
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
      { key, name: dName, number: r.number, classId: cls, points: 0, starts: 0, wins: 0, podiums: 0, poles: 0, bestFinish: null, finishCounts: [], roundFinish: new Map() }
    a.points += rowPoints(r)
    a.starts += 1
    if (clsPos === 1) a.wins += 1
    if (clsPos !== null && clsPos <= 3) a.podiums += 1
    if (r.quali_pos === 1) a.poles += 1
    a.bestFinish = a.bestFinish === null ? clsPos : Math.min(a.bestFinish, clsPos ?? 99)
    tallyFinish(a, clsPos, r.event?.round)
    map.set(key, a)
  }
  return finalize(map)
}
