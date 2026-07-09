// Driver license progression — Bronze → Silver → Gold → Platinum.
//
// Licenses are EARNED from race results, never self-selected. Each completed
// race awards "license credits" from three components — result (finishing
// position in class), pace (qualifying position), and safety (incidents) — and
// a driver's career credit total maps to a tier. The commissioner can override
// the computed tier per driver (drivers.license_override) for special cases.
//
// Calibration target: a very safe AND quick front-runner earns ~11–12 credits
// per race, so they reach GOLD in about one full season (~11 rounds) and
// PLATINUM after a second full season (~22 rounds). Slower or messier drivers
// earn less per race and climb proportionally more slowly. Tune the weights and
// thresholds below to adjust that pace.

export type License = 'Bronze' | 'Silver' | 'Gold' | 'Platinum'

export const LICENSE_ORDER: License[] = ['Bronze', 'Silver', 'Gold', 'Platinum']

/** Career credits required to hold each tier. */
export const LICENSE_THRESHOLDS: Record<License, number> = {
  Bronze: 0,
  Silver: 55,
  Gold: 120,
  Platinum: 250,
}

/** Classes each license makes a driver eligible for (the license ladder). */
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
  cls_pos?: number | null
  quali_pos?: number | null
  grid?: number | null
  inc?: number | null
  laps?: number | null
  status?: string | null
}

/** Credits earned in a single race (max ≈ 14 for a pole-to-win, zero-incident run). */
export function raceCredits(r: LicenseRow): number {
  const participated = r.cls_pos != null || (r.laps ?? 0) > 0
  if (!participated) return 0

  const status = (r.status ?? '').toUpperCase()
  const dnf = status === 'DNF' || status === 'DNS' || status === 'DSQ'

  // Result — finishing position in class (max 6).
  const cls = r.cls_pos
  let result = 0
  if (cls != null) {
    result = cls === 1 ? 6 : cls === 2 ? 5 : cls === 3 ? 4 : cls === 4 ? 3 : cls === 5 ? 2.5 : cls <= 8 ? 2 : cls <= 12 ? 1 : 0.5
  }
  if (dnf) result = Math.min(result, 0.5) // a DNF still shows race craft, but earns little

  // Pace — qualifying position in class (fallback to grid) (max 4).
  const q = r.quali_pos ?? r.grid ?? null
  let pace = 0
  if (q != null) pace = q === 1 ? 4 : q === 2 ? 3 : q === 3 ? 2.5 : q <= 5 ? 2 : q <= 8 ? 1 : 0.5

  // Safety — incidents; clean races are rewarded, messy ones penalised (−2..4).
  const inc = r.inc
  let safety = 1 // neutral when incident count is unknown
  if (inc != null) safety = inc === 0 ? 4 : inc <= 2 ? 3 : inc <= 4 ? 2 : inc <= 8 ? 1 : inc <= 12 ? 0 : inc <= 20 ? -1 : -2

  return result + pace + safety
}

/** Total career credits across a driver's result rows (never below zero). */
export function licenseCredits(rows: LicenseRow[]): number {
  return Math.max(0, rows.reduce((s, r) => s + raceCredits(r), 0))
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
 * the badge, not the trajectory).
 */
export function computeLicense(rows: LicenseRow[], override?: string | null): LicenseInfo {
  const credits = licenseCredits(rows)
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

/** Rows attributable to a driver by name (same fuzzy match as standings/profiles). */
export function resultsForDriver<T extends LicenseRow>(all: T[], driverName: string): T[] {
  const name = driverName.trim().toLowerCase()
  if (!name) return []
  return all.filter((r) => (r.drivers_text ?? '').toLowerCase().includes(name))
}
