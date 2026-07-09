// Attribute a race result to individual drivers.
//
// The results PDF only gives a free-text driver field (`drivers_text`), never a
// driver id or iRacing customer id, so per-driver stats (profiles, licenses)
// must be matched by name. This module does it robustly rather than with a naive
// substring `includes`, which mis-fires on short names (e.g. "Ryan" ⊂ "Bryan")
// and can't split co-driven endurance entries ("A. Smith / B. Jones").

/** Lower-case, strip diacritics + punctuation, collapse whitespace. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split a `drivers_text` crew field into its individual driver names. */
export function splitCrew(driversText?: string | null): string[] {
  if (!driversText) return []
  return driversText
    .split(/\s*(?:\/|,|;|&|\+|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Normalized set of driver names listed on a result. */
export function crewNames(driversText?: string | null): string[] {
  return splitCrew(driversText).map(normalizeName).filter(Boolean)
}

/**
 * Does this result list the given driver? Exact match on any crew segment, with
 * a guarded fallback: if the driver's full normalized name appears as a whole-word
 * run inside a single segment (handles "J. Smith" vs "John Smith" only when the
 * segment fully contains every token of the driver name).
 */
export function resultListsDriver(driversText: string | null | undefined, driverName: string): boolean {
  const target = normalizeName(driverName)
  if (!target) return false
  const names = crewNames(driversText)
  if (names.includes(target)) return true
  // token-subset fallback: every token of the driver name present in one segment
  const targetTokens = target.split(' ').filter((t) => t.length > 1)
  if (targetTokens.length < 2) return false // too weak to match on a single token
  return names.some((seg) => {
    const segTokens = new Set(seg.split(' '))
    return targetTokens.every((t) => segTokens.has(t))
  })
}

/** Filter a result list to those attributable to a driver by name. */
export function resultsForDriver<T extends { drivers_text?: string | null }>(
  all: T[],
  driverName: string,
): T[] {
  if (!driverName?.trim()) return []
  return all.filter((r) => resultListsDriver(r.drivers_text, driverName))
}
