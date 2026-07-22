import { lapToSeconds } from './profileStats'
import type { FullRow } from './driverReport'

/**
 * Achievement engine — everything is derived purely from imported race-control
 * rows, null-safe throughout. Locked achievements are returned too (earned:
 * false) so the gallery can show them as hints.
 */

export interface Achievement {
  id: string
  name: string
  blurb: string
  earned: boolean
  detail?: string
}

const isDnf = (r: FullRow) => {
  const s = (r.status ?? '').toUpperCase()
  return s === 'DNF' || s === 'DNS' || s === 'DSQ' || s === 'DISCO'
}

const raceLabel = (r: FullRow) =>
  r.event?.name ?? r.event?.track?.name ?? (r.event?.round != null ? `Round ${r.event.round}` : 'a race')

const roundLabel = (r: FullRow) =>
  r.event?.round != null ? `R${r.event.round} · ${raceLabel(r)}` : raceLabel(r)

/**
 * @param rows     this driver's result rows for the season, any order
 * @param allRows  every result row for the season (class-fastest laps, round count)
 */
export function computeAchievements(rows: FullRow[], allRows: FullRow[]): Achievement[] {
  const sorted = [...rows].sort((a, b) => (a.event?.round ?? 0) - (b.event?.round ?? 0))

  // Class-fastest best lap per event+class, from the whole field.
  const fastest = new Map<string, number>()
  for (const r of allRows) {
    const s = lapToSeconds(r.best_lap)
    if (s == null) continue
    const k = `${r.event_id ?? ''}|${r.class_id ?? ''}`
    const cur = fastest.get(k)
    if (cur == null || s < cur) fastest.set(k, s)
  }

  // -- first-blood: first race win ------------------------------------------
  const firstWin = sorted.find((r) => r.cls_pos === 1)

  // -- pole-sitter: first pole ----------------------------------------------
  const firstPole = sorted.find((r) => r.quali_pos === 1)

  // -- hat-trick: pole + win + class-fastest lap in the same race ------------
  let hatTrick: FullRow | undefined
  for (const r of sorted) {
    if (r.cls_pos !== 1 || r.quali_pos !== 1) continue
    const s = lapToSeconds(r.best_lap)
    if (s == null) continue
    const f = fastest.get(`${r.event_id ?? ''}|${r.class_id ?? ''}`)
    if (f != null && s <= f) {
      hatTrick = r
      break
    }
  }

  // -- podium-run: 3+ consecutive rounds started, all P3 or better -----------
  let bestRun = 0
  let bestRunEnd = -1
  let run = 0
  sorted.forEach((r, i) => {
    if (r.cls_pos != null && r.cls_pos <= 3) {
      run += 1
      if (run > bestRun) {
        bestRun = run
        bestRunEnd = i
      }
    } else {
      run = 0
    }
  })
  const podiumRun = bestRun >= 3
  const runStart = podiumRun ? sorted[bestRunEnd - bestRun + 1] : undefined
  const runEnd = podiumRun ? sorted[bestRunEnd] : undefined

  // -- spotless: completed a race with zero incident points ------------------
  const spotless = sorted.find((r) => r.inc === 0 && !isDnf(r))

  // -- charger: gained 5+ places grid → flag in one race ---------------------
  let charger: FullRow | undefined
  let chargerGain = 0
  for (const r of sorted) {
    if (r.grid == null || r.pos == null) continue
    const g = r.grid - r.pos
    if (g >= 5 && g > chargerGain) {
      charger = r
      chargerGain = g
    }
  }

  // -- ever-present: started every completed round this season ---------------
  const allEvents = new Set<string>()
  for (const r of allRows) if (r.event_id) allEvents.add(r.event_id)
  const myEvents = new Set<string>()
  for (const r of sorted) if (r.event_id) myEvents.add(r.event_id)
  const everPresent = allEvents.size > 0 && [...allEvents].every((e) => myEvents.has(e))

  // -- centurion: 100+ laps -----------------------------------------------
  const totalLaps = sorted.reduce((a, r) => a + (r.laps ?? 0), 0)

  // -- metronome: consistency >= 80 with >= 3 starts --------------------------
  // Spread logic mirrors the driver report: tighter finish spread = higher.
  const finishes = sorted.map((r) => r.cls_pos).filter((p): p is number => p != null)
  let consistency: number | null = null
  if (finishes.length >= 2) {
    const m = finishes.reduce((a, b) => a + b, 0) / finishes.length
    const sd = Math.sqrt(finishes.reduce((a, f) => a + (f - m) ** 2, 0) / finishes.length)
    consistency = Math.max(0, Math.min(100, Math.round(100 - sd * 14)))
  } else if (finishes.length === 1) {
    consistency = 100
  }
  const metronome = sorted.length >= 3 && consistency != null && consistency >= 80

  // -- points-hoarder: 500+ season points -------------------------------------
  const points = sorted.reduce(
    (a, r) => a + (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0),
    0,
  )

  return [
    {
      id: 'first-blood',
      name: 'First Blood',
      blurb: 'Win a race.',
      earned: firstWin != null,
      detail: firstWin ? roundLabel(firstWin) : undefined,
    },
    {
      id: 'pole-sitter',
      name: 'Pole Sitter',
      blurb: 'Take pole position in qualifying.',
      earned: firstPole != null,
      detail: firstPole ? roundLabel(firstPole) : undefined,
    },
    {
      id: 'hat-trick',
      name: 'Hat-Trick',
      blurb: 'Pole, the win and the class-fastest race lap — all in one meeting.',
      earned: hatTrick != null,
      detail: hatTrick ? roundLabel(hatTrick) : undefined,
    },
    {
      id: 'podium-run',
      name: 'Podium Run',
      blurb: 'Finish on the podium three rounds in a row.',
      earned: podiumRun,
      detail:
        podiumRun && runStart && runEnd
          ? `${bestRun} straight, R${runStart.event?.round ?? '?'}–R${runEnd.event?.round ?? '?'}`
          : undefined,
    },
    {
      id: 'spotless',
      name: 'Spotless',
      blurb: 'Complete a race without a single incident point.',
      earned: spotless != null,
      detail: spotless ? roundLabel(spotless) : undefined,
    },
    {
      id: 'charger',
      name: 'Charger',
      blurb: 'Make up five or more places from grid to flag in one race.',
      earned: charger != null,
      detail: charger ? `+${chargerGain} places, ${roundLabel(charger)}` : undefined,
    },
    {
      id: 'ever-present',
      name: 'Ever-Present',
      blurb: 'Start every completed round of the season.',
      earned: everPresent,
      detail: everPresent ? `All ${allEvents.size} round${allEvents.size === 1 ? '' : 's'} started` : undefined,
    },
    {
      id: 'centurion',
      name: 'Centurion',
      blurb: 'Complete 100 laps across the season.',
      earned: totalLaps >= 100,
      detail: totalLaps >= 100 ? `${totalLaps} laps and counting` : undefined,
    },
    {
      id: 'metronome',
      name: 'Metronome',
      blurb: 'Hold a consistency score of 80+ across three or more starts.',
      earned: metronome,
      detail: metronome && consistency != null ? `Consistency ${consistency}` : undefined,
    },
    {
      id: 'points-hoarder',
      name: 'Points Hoarder',
      blurb: 'Bank 500 championship points in a season.',
      earned: points >= 500,
      detail: points >= 500 ? `${points} points banked` : undefined,
    },
  ]
}
