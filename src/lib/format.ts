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
