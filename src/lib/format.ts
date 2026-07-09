import type { ClassId, LeagueClass } from './types'

/** Fallback class colors if the DB hasn't loaded yet. Mirrors classes.color. */
export const CLASS_FALLBACK: Record<string, string> = {
  GTP: '#f2e114',
  LMP2: '#4F8DF0',
  GTD: '#4ADE80',
}

export function classColor(classId: string, classes?: LeagueClass[]): string {
  const fromDb = classes?.find((c) => c.id === classId)?.color
  return fromDb || CLASS_FALLBACK[classId] || '#ffffff'
}

/** Legible-on-white variants of the class colors — for thin strokes / text
 * where the bright chip colors (esp. GTP yellow) wash out. */
export const CLASS_LINE: Record<string, string> = {
  GTP: '#97890a', // brand-deep
  LMP2: '#2f6bff',
  GTD: '#12b981',
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

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${DAY[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`
}

export function fmtDateLong(iso: string): string {
  const d = new Date(iso)
  return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

export function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Break an ISO target into a countdown, or null once elapsed. */
export function countdownParts(targetIso: string, now: number) {
  const diff = new Date(targetIso).getTime() - now
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
