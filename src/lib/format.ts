import type { ClassId, LeagueClass } from './types'

/** Fallback class colors if the DB hasn't loaded yet. Mirrors classes.color. */
export const CLASS_FALLBACK: Record<string, string> = {
  GTP: '#f2e114',
  LMP2: '#2f6bff',
  GTD: '#12b981',
}

export function classColor(classId: string, classes?: LeagueClass[]): string {
  const fromDb = classes?.find((c) => c.id === classId)?.color
  return fromDb || CLASS_FALLBACK[classId] || '#ffffff'
}

/** Legible-on-white variants of the class colors — for thin strokes / text
 * where the bright chip colors (esp. GTP yellow) wash out. */
/** On the dark ground the full-strength class colors read best. */
export const CLASS_LINE: Record<string, string> = {
  GTP: '#f2e114',
  LMP2: '#5b8def',
  GTD: '#3fc98a',
}

export function classLineColor(classId: string): string {
  return CLASS_LINE[classId] || '#97890a'
}

export const CLASS_ORDER: ClassId[] = ['GTP', 'LMP2', 'GTD']

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * EVENT DATES ARE REAL INSTANTS, NOT CALENDAR MARKERS.
 *
 * This file used to strip the date out of the ISO string and rebuild it in local
 * time, on the belief that `events.date` was a calendar day pinned to UTC midnight.
 * That belief is out of date: `events.date` IS the green-flag timestamp, and the
 * green flag is 8pm ET on a Saturday — which is midnight UTC on the SUNDAY. Taking
 * the UTC date part therefore printed every race a day late, and the whole schedule
 * read as Sundays.
 *
 * So an instant is now formatted as an instant, in the VIEWER'S OWN ZONE, with the
 * zone named wherever a time is shown. A member in California sees 5:00 PM PDT and a
 * member in ET sees 8:00 PM EDT — the same moment, described correctly for each of
 * them, rather than one canonical string that is wrong for everybody but the author.
 *
 * The one exception is a bare `YYYY-MM-DD`, which carries no time and no zone and is
 * genuinely a calendar day. Parsing that with `new Date()` would read it as UTC
 * midnight and show the day before to every viewer west of UTC — the original bug
 * this file was written to avoid. That case is still built in local time.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function calendarDate(iso: string): Date {
  const s = String(iso).trim()
  const m = DATE_ONLY.exec(s)
  if (m) {
    const [y, mo, d] = s.split('-').map(Number)
    return new Date(y, mo - 1, d)
  }
  return new Date(s)
}

/** `YYYY-MM-DD` for the day this instant falls on IN THE VIEWER'S ZONE. */
export function dateKey(iso: string): string {
  const d = calendarDate(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * The race's calendar day AT THE TRACK, which is not always the viewer's day.
 *
 * The forecast query sends `timezone=auto`, so Open-Meteo reads start_date in the
 * TRACK's zone — meaning this key has to be the race day there, not wherever the
 * reader happens to be sitting. Every round is an evening event on North American
 * soil, so the Eastern date and the track's local date are the same day (8pm ET is
 * 5pm PT); a reader in Sydney, whose own date is already tomorrow, would otherwise
 * pull the wrong day's forecast.
 *
 * Anchoring to ET rather than the viewer keeps one answer for every reader.
 */
export function raceDateKey(iso: string): string {
  const s = String(iso).trim()
  if (DATE_ONLY.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s.slice(0, 10)
  // en-CA renders as YYYY-MM-DD, which is exactly the shape the API wants.
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

export function fmtDate(iso: string): string {
  const d = calendarDate(iso)
  return `${DAY[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`
}

export function fmtDateLong(iso: string): string {
  const d = calendarDate(iso)
  return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/**
 * A race is over three hours after the green flag — the same window
 * `advance_completed_events()` uses to mark it complete in the database, so the
 * site and the scheduler agree on when a round stops being "next".
 */
const RACE_WINDOW_MS = 3 * 60 * 60 * 1000

export function eventEnded(iso: string, now: number = Date.now()): boolean {
  const s = String(iso).trim()
  if (DATE_ONLY.test(s)) {
    const d = calendarDate(s)
    d.setHours(23, 59, 59, 999)
    return d.getTime() < now
  }
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? false : t + RACE_WINDOW_MS < now
}

export function fmtTime(iso: string, withZone = true): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], {
    hour: 'numeric', minute: '2-digit', ...(withZone ? { timeZoneName: 'short' } : {}),
  })
}

/** "Sat Aug 22 · 8:00 PM EDT" — the green flag, in the reader's own zone. */
export function fmtDateTime(iso: string): string {
  const s = String(iso).trim()
  if (DATE_ONLY.test(s)) return fmtDate(s)
  return `${fmtDate(s)} · ${fmtTime(s)}`
}

/**
 * Break an ISO target into a countdown, or null once elapsed.
 *
 * This counted `...T00:00:00Z` down to local midnight, treating it as a calendar
 * marker. For a green flag stored at midnight UTC that put the clock four hours
 * LATE for an ET viewer, and further out the further west you sat. A timestamp is
 * counted to the instant it names; only a bare `YYYY-MM-DD` counts to local midnight,
 * because that is all the information it carries.
 */
export function countdownParts(targetIso: string, now: number) {
  const target = calendarDate(targetIso).getTime()
  const diff = target - now
  if (diff <= 0) return null
  const s = Math.floor(diff / 1000)
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    mins: Math.floor((s % 3600) / 60),
    secs: s % 60,
  }
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Map an Open-Meteo WMO weather code to a short label + glyph. */
export function wmo(code: number): { label: string; icon: string } {
  const m: Record<number, [string, string]> = {
    0: ['Clear', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
    45: ['Fog', '🌫️'], 48: ['Rime fog', '🌫️'],
    51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
    56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
    61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
    66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
    71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
    80: ['Rain showers', '🌦️'], 81: ['Rain showers', '🌧️'], 82: ['Heavy showers', '⛈️'],
    85: ['Snow showers', '🌨️'], 86: ['Snow showers', '❄️'],
    95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm', '⛈️'], 99: ['Thunderstorm', '⛈️'],
  }
  const [label, icon] = m[code] ?? ['—', '🌡️']
  return { label, icon }
}
