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
 * Event dates are stored as calendar days pinned to UTC midnight
 * (`2026-08-01T00:00:00Z`). Reading those with local getters shows the previous
 * day for everyone west of UTC — i.e. every US viewer. So parse the calendar
 * part and rebuild it in local time: the day you typed is the day that renders.
 * Timestamps that carry a real time-of-day (protest `created_at`) still format
 * correctly, since we only take the date portion for date-only display.
 */
export function calendarDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return new Date(iso)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** `YYYY-MM-DD` for the stored calendar day (no timezone shift). */
export function dateKey(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso)
  return m ? m[1] : new Date(iso).toISOString().slice(0, 10)
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
 * When a race-day event is "past". A round stays current all day locally
 * rather than flipping at UTC midnight (8pm ET the evening before).
 */
export function eventEnded(iso: string, now: number = Date.now()): boolean {
  const d = calendarDate(iso)
  d.setHours(23, 59, 59, 999)
  return d.getTime() < now
}

export function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * Break an ISO target into a countdown, or null once elapsed. Date-only /
 * UTC-midnight event dates count down to the START of that local day, not to
 * UTC midnight (which lands the evening before for US viewers).
 */
export function countdownParts(targetIso: string, now: number) {
  const isCalendarDay = /^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z?)?$/.test(targetIso)
  const target = isCalendarDay ? calendarDate(targetIso).getTime() : new Date(targetIso).getTime()
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
