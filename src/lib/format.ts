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
 * WHEN THE EVENT STARTS FOR A DRIVER, which is not when the race starts.
 *
 * `events.date` is the green flag and has to stay that way: race completion, the
 * results window and the forecast anchor are all keyed to it. But a member reading
 * the schedule needs to know when to be in the sim, and that is the first session —
 * practice opens an hour before the lights.
 *
 * Falls back to the green flag when an event has no sessions, so a round that has
 * not had its schedule filled in yet still prints a time rather than nothing.
 */
export function eventStart(e: { date: string; sessions?: { start: string }[] | null }): string {
  const starts = (e.sessions ?? []).map((s) => s?.start).filter(Boolean) as string[]
  if (!starts.length) return e.date
  return starts.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b))
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

