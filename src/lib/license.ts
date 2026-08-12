// Driver license progression — Bronze → Silver → Gold → Platinum.
//
// Licenses are EARNED from race results, never self-selected, and are purely a
// "level" show-piece for now (they don't gate car/class eligibility). Each
// completed race awards "license credits" from four components drawn straight
// from the race-control results:
//
//   • Finish   — finishing position in class            (max 5)
//   • Pace     — best lap vs the FASTEST in your class   (max 5)  ← comparative
//                that race (a true, field-relative pace metric)
//   • Qualy    — qualifying position in class            (max 3)
//   • Safety   — incident points                         (−2 … 4)
//
// A driver's career credit total maps to a tier. The commissioner can override
// the computed tier per driver (drivers.license_override) for special cases.
//
// Calibration target: a very safe AND quick front-runner earns ~14 credits per
// race, reaching GOLD in about one full season (~11 rounds) and PLATINUM after a
// second full season (~22 rounds). Slower or messier drivers climb more slowly.
// Tune the weights and thresholds below to adjust that pace.
//
// ── CHECK THE ARITHMETIC BEFORE CHANGING A THRESHOLD ────────────────────────────
//
// The ceiling is 17 credits in a single race (finish 5 + pace 5 + qualifying 3 +
// safety 4), and only for a pole-to-win with the class's fastest lap and zero
// incidents. Over an eleven-round season that is 187 credits TOTAL, for a driver
// who wins every round perfectly.
//
// The first version of this ladder asked 320 for Platinum, which no season could
// produce, and 155 for Gold — 14.1 every single round, above what the actual
// championship leader averages (12.4). Four Discord roles, a promotions channel
// and an hourly job all existed to announce promotions that were arithmetically
// impossible. A threshold nobody can reach is not "aspirational", it is a ladder
// with no rungs, and the whole feature reads as broken.
//
// These numbers are set against real season-five output: Silver lands mid-first-
// season for anyone racing regularly, Gold is a strong full season, Platinum is a
// strong season and a bit. Recompute against `credits` on /drivers before moving
// them again.

export type License = 'Bronze' | 'Silver' | 'Gold' | 'Platinum'

export const LICENSE_ORDER: License[] = ['Bronze', 'Silver', 'Gold', 'Platinum']

/**
 * Career credits required to hold each tier.
 *
 * Measured, not guessed. Across the five rounds scored so far the fastest driver
 * in the league averages 12.4 credits a race, the median scorer 9.0, and the best
 * single race anyone has produced is 13.3 — against a theoretical per-race ceiling
 * of 17. Over an eleven-round season that puts a front-runner near 136 and a
 * steady regular near 99.
 *
 *   Silver    a regular reaches it around the middle of their first season
 *   Gold      a strong full season
 *   Platinum  a front-runner's season and a bit — the intended two-season climb,
 *             and just inside the 187 a flawless single season could produce
 */
export const LICENSE_THRESHOLDS: Record<License, number> = {
  Bronze: 0,
  Silver: 40,
  Gold: 100,
  Platinum: 170,
}

/** Classes each license makes a driver eligible for (informational ladder). */
export const LICENSE_CLASSES: Record<License, string> = {
  Bronze: 'GTD',
  Silver: 'GTD · LMP2',
  Gold: 'LMP2 · GTP',
  Platinum: 'GTP',
}

/** Legible-on-white accent per tier. */
export const LICENSE_COLOR: Record<License, string> = {
  Bronze: '#a86a35',
  Silver: '#8a94a6',
  Gold: '#c2971f',
  Platinum: '#3f74d6',
}

export interface LicenseRow {
  drivers_text?: string | null
  event_id?: string | null
  class_id?: string | null
  cls_pos?: number | null
  quali_pos?: number | null
  grid?: number | null
  inc?: number | null
  laps?: number | null
  best_lap?: string | null
  status?: string | null
}

/** Fastest best-lap (seconds) per event+class, for comparative pace. */
export type PaceIndex = Map<string, number>

/** Parse a lap time ("1:35.433", "95.4", "1:02:03.1") to seconds. */
export function lapToSeconds(v?: string | null): number | null {
  if (!v) return null
  const parts = String(v).trim().split(':')
  if (!parts.length || parts.some((p) => p === '' || isNaN(Number(p)))) return null
  let sec = 0
  for (const p of parts) sec = sec * 60 + Number(p)
  return sec > 0 ? sec : null
}

const paceKey = (r: LicenseRow) => `${r.event_id ?? ''}|${r.class_id ?? ''}`

/** Build the fastest-lap-per-class index from the full result set. */
export function buildPaceIndex(rows: LicenseRow[]): PaceIndex {
  const idx: PaceIndex = new Map()
  for (const r of rows) {
    const sec = lapToSeconds(r.best_lap)
    if (sec == null) continue
    const k = paceKey(r)
    const cur = idx.get(k)
    if (cur == null || sec < cur) idx.set(k, sec)
  }
  return idx
}

/** Credits earned in a single race (max ≈ 17 for a pole-to-win, fastest-lap, clean run). */
export function raceCredits(r: LicenseRow, paceIndex?: PaceIndex): number {
  const participated = r.cls_pos != null || (r.laps ?? 0) > 0
  if (!participated) return 0

  const status = (r.status ?? '').toUpperCase()
  const dnf = status === 'DNF' || status === 'DNS' || status === 'DSQ'

  // Finish — position in class (max 5).
  const cls = r.cls_pos
  let finish = 0
  if (cls != null) {
    finish = cls === 1 ? 5 : cls === 2 ? 4 : cls === 3 ? 3.5 : cls === 4 ? 3 : cls === 5 ? 2.5 : cls <= 8 ? 2 : cls <= 12 ? 1 : 0.5
  }
  if (dnf) finish = Math.min(finish, 0.5)

  const q = r.quali_pos ?? r.grid ?? null

  // Pace — comparative best lap vs the fastest in class that race (max 5).
  // Falls back to a qualifying-derived estimate when no lap time is available.
  let pace = 0
  const sec = lapToSeconds(r.best_lap)
  const fastest = paceIndex?.get(paceKey(r))
  if (sec != null && fastest != null && fastest > 0) {
    const ratio = sec / fastest
    pace = ratio <= 1.001 ? 5 : ratio <= 1.005 ? 4 : ratio <= 1.01 ? 3 : ratio <= 1.02 ? 2 : ratio <= 1.035 ? 1 : 0.5
  } else if (q != null) {
    pace = q === 1 ? 3 : q === 2 ? 2 : q === 3 ? 1.5 : q <= 5 ? 1 : 0.5
  }

  // Qualifying — grid pace in class (max 3).
  let qualy = 0
  if (q != null) qualy = q === 1 ? 3 : q === 2 ? 2.5 : q === 3 ? 2 : q <= 5 ? 1.5 : q <= 8 ? 1 : 0.5

  // Safety — incident points; clean races rewarded, messy ones penalised (−2..4).
  const inc = r.inc
  let safety = 1 // neutral when incidents are unknown
  if (inc != null) safety = inc === 0 ? 4 : inc <= 2 ? 3 : inc <= 4 ? 2 : inc <= 6 ? 1.5 : inc <= 8 ? 1 : inc <= 12 ? 0 : inc <= 18 ? -1 : -2

  return finish + pace + qualy + safety
}

/** Total career credits across a driver's result rows (never below zero). */
export function licenseCredits(rows: LicenseRow[], paceIndex?: PaceIndex): number {
  return Math.max(0, rows.reduce((s, r) => s + raceCredits(r, paceIndex), 0))
}

/** Highest tier whose threshold the credit total has reached. */
export function tierForCredits(credits: number): License {
  let tier: License = 'Bronze'
  for (const t of LICENSE_ORDER) if (credits >= LICENSE_THRESHOLDS[t]) tier = t
  return tier
}

export interface LicenseInfo {
  /** What the driver actually holds — override if set, else computed. */
  effective: License
  /** What the formula computes from results, ignoring any override. */
  computed: License
  /** True when a commissioner override is in force. */
  isOverride: boolean
  credits: number
  /** Next tier up from the computed tier, or null at Platinum. */
  next: License | null
  /** Credits still needed to reach `next` (0 at Platinum). */
  toNext: number
  /** 0–1 progress from the computed tier toward `next`. */
  progress: number
}

/**
 * Resolve a driver's license from their result rows and an optional commissioner
 * override. Progress always reflects earned credits (the override only changes
 * the badge, not the trajectory). Pass the shared PaceIndex for comparative pace.
 */
export function computeLicense(rows: LicenseRow[], paceIndex?: PaceIndex, override?: string | null): LicenseInfo {
  const credits = licenseCredits(rows, paceIndex)
  const computed = tierForCredits(credits)
  const isOverride = !!override && (LICENSE_ORDER as string[]).includes(override)
  const effective = isOverride ? (override as License) : computed

  const idx = LICENSE_ORDER.indexOf(computed)
  const next = idx < LICENSE_ORDER.length - 1 ? LICENSE_ORDER[idx + 1] : null
  const floor = LICENSE_THRESHOLDS[computed]
  const ceil = next ? LICENSE_THRESHOLDS[next] : floor
  const progress = next ? Math.min(1, Math.max(0, (credits - floor) / (ceil - floor))) : 1
  const toNext = next ? Math.max(0, Math.ceil(ceil - credits)) : 0

  return { effective, computed, isOverride, credits: Math.round(credits), next, toNext, progress }
}

// Robust name attribution lives in one place (handles co-drivers + avoids
// substring false-positives); re-exported so existing imports keep working.
export { resultsForDriver } from './attribution'
