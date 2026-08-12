// Deno port of src/lib/license.ts + src/lib/attribution.ts — kept in lockstep so
// the Edge Function computes the SAME license the website shows. If you change
// the formula on the site, mirror it here.

export type License = 'Bronze' | 'Silver' | 'Gold' | 'Platinum'
export const LICENSE_ORDER: License[] = ['Bronze', 'Silver', 'Gold', 'Platinum']
// KEEP IN LOCKSTEP WITH src/lib/license.ts. Deno cannot import across that
// boundary, so this is a copy — and if the two drift, a driver's badge on the
// website and their role in Discord disagree about what they have earned, which
// looks like a bug in whichever one the reader happens to trust less.
// See that file for how these numbers were measured.
export const LICENSE_THRESHOLDS: Record<License, number> = { Bronze: 0, Silver: 40, Gold: 100, Platinum: 170 }

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

export type PaceIndex = Map<string, number>

export function lapToSeconds(v?: string | null): number | null {
  if (!v) return null
  const parts = String(v).trim().split(':')
  if (!parts.length || parts.some((p) => p === '' || isNaN(Number(p)))) return null
  let sec = 0
  for (const p of parts) sec = sec * 60 + Number(p)
  return sec > 0 ? sec : null
}

const paceKey = (r: LicenseRow) => `${r.event_id ?? ''}|${r.class_id ?? ''}`

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

export function raceCredits(r: LicenseRow, paceIndex?: PaceIndex): number {
  const participated = r.cls_pos != null || (r.laps ?? 0) > 0
  if (!participated) return 0
  const status = (r.status ?? '').toUpperCase()
  const dnf = status === 'DNF' || status === 'DNS' || status === 'DSQ'

  const cls = r.cls_pos
  let finish = 0
  if (cls != null) finish = cls === 1 ? 5 : cls === 2 ? 4 : cls === 3 ? 3.5 : cls === 4 ? 3 : cls === 5 ? 2.5 : cls <= 8 ? 2 : cls <= 12 ? 1 : 0.5
  if (dnf) finish = Math.min(finish, 0.5)

  const q = r.quali_pos ?? r.grid ?? null
  let pace = 0
  const sec = lapToSeconds(r.best_lap)
  const fastest = paceIndex?.get(paceKey(r))
  if (sec != null && fastest != null && fastest > 0) {
    const ratio = sec / fastest
    pace = ratio <= 1.001 ? 5 : ratio <= 1.005 ? 4 : ratio <= 1.01 ? 3 : ratio <= 1.02 ? 2 : ratio <= 1.035 ? 1 : 0.5
  } else if (q != null) {
    pace = q === 1 ? 3 : q === 2 ? 2 : q === 3 ? 1.5 : q <= 5 ? 1 : 0.5
  }

  let qualy = 0
  if (q != null) qualy = q === 1 ? 3 : q === 2 ? 2.5 : q === 3 ? 2 : q <= 5 ? 1.5 : q <= 8 ? 1 : 0.5

  const inc = r.inc
  let safety = 1
  if (inc != null) safety = inc === 0 ? 4 : inc <= 2 ? 3 : inc <= 4 ? 2 : inc <= 6 ? 1.5 : inc <= 8 ? 1 : inc <= 12 ? 0 : inc <= 18 ? -1 : -2

  return finish + pace + qualy + safety
}

export function licenseCredits(rows: LicenseRow[], paceIndex?: PaceIndex): number {
  return Math.max(0, rows.reduce((s, r) => s + raceCredits(r, paceIndex), 0))
}

export function tierForCredits(credits: number): License {
  let tier: License = 'Bronze'
  for (const t of LICENSE_ORDER) if (credits >= LICENSE_THRESHOLDS[t]) tier = t
  return tier
}

/** Effective license = override if valid, else computed from results. */
export function computeLicense(rows: LicenseRow[], paceIndex: PaceIndex, override?: string | null): License {
  if (override && (LICENSE_ORDER as string[]).includes(override)) return override as License
  return tierForCredits(licenseCredits(rows, paceIndex))
}

// --- attribution (mirror of src/lib/attribution.ts) ---
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function crewNames(driversText?: string | null): string[] {
  if (!driversText) return []
  return driversText
    .split(/\s*(?:\/|,|;|&|\+|\band\b)\s*/i)
    .map((s) => normalizeName(s.trim()))
    .filter(Boolean)
}

export function resultListsDriver(driversText: string | null | undefined, driverName: string): boolean {
  const target = normalizeName(driverName)
  if (!target) return false
  const names = crewNames(driversText)
  if (names.includes(target)) return true
  const targetTokens = target.split(' ').filter((t) => t.length > 1)
  if (targetTokens.length < 2) return false
  return names.some((seg) => {
    const segTokens = new Set(seg.split(' '))
    return targetTokens.every((t) => segTokens.has(t))
  })
}

export function resultsForDriver<T extends { drivers_text?: string | null }>(all: T[], driverName: string): T[] {
  if (!driverName?.trim()) return []
  return all.filter((r) => resultListsDriver(r.drivers_text, driverName))
}
