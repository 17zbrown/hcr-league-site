// Rewrites Open Graph / Twitter meta + <title> per route so links unfurl with
// the right card in Discord, iMessage, Twitter, etc. The SPA ships a single
// index.html; crawlers don't run JS, so we inject route-aware tags at the edge.
// All lookups are best-effort — any failure falls back to the section defaults.
import type { Context } from 'https://edge.netlify.com'

const SITE = 'HCR League'

interface Meta {
  title: string
  description: string
  image: string // basename under /public, no extension
}

const SECTIONS: Record<string, Meta> = {
  '': { title: 'HCR League — Realistic Endurance Sim Racing', description: 'Three-class iRacing endurance racing — GTP, LMP2 & GTD. Schedule, standings, results, and season sign-up.', image: 'og-default' },
  schedule: { title: 'Schedule — HCR League', description: 'The full 2026 HCR League endurance calendar — 11 rounds across iconic circuits.', image: 'og-schedule' },
  standings: { title: 'Standings — HCR League', description: 'GTP, LMP2 & GTD championship points and progression for the 2026 season.', image: 'og-standings' },
  results: { title: 'Results — HCR League', description: 'Race-by-race class classifications from the 2026 HCR League season.', image: 'og-results' },
  drivers: { title: 'Roster — HCR League', description: 'Drivers of the HCR League three-class endurance championship.', image: 'og-roster' },
  teams: { title: 'Teams — HCR League', description: 'Teams of the HCR League three-class endurance championship.', image: 'og-roster' },
  signup: { title: 'Enter Season — HCR League', description: 'Claim your seat on the 2026 HCR League grid.', image: 'og-signup' },
  enter: { title: 'Enter Season — HCR League', description: 'Claim your seat on the 2026 HCR League grid.', image: 'og-signup' },
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function sbOne(pathAndQuery: string): Promise<Record<string, unknown> | null> {
  const base = Netlify.env.get('VITE_SUPABASE_URL') || Netlify.env.get('SUPABASE_URL')
  const key = Netlify.env.get('VITE_SUPABASE_ANON_KEY') || Netlify.env.get('SUPABASE_ANON_KEY')
  if (!base || !key) return null
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!res.ok) return null
    const rows = await res.json()
    return Array.isArray(rows) ? (rows[0] ?? null) : null
  } catch {
    return null
  }
}

/** Use the per-entity card if it was generated at build time, else fall back. */
async function pickImage(origin: string, candidate: string, fallback: string): Promise<string> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1000)
    const res = await fetch(`${origin}${candidate}`, { method: 'HEAD', signal: ctrl.signal })
    clearTimeout(t)
    if (res.ok) return `${origin}${candidate}`
  } catch {
    // ignore — fall through to fallback
  }
  return `${origin}/${fallback}.png`
}

export default async function handler(request: Request, context: Context) {
  const res = await context.next()
  const type = res.headers.get('content-type') || ''
  if (!type.includes('text/html')) return res

  const url = new URL(request.url)
  const origin = url.origin
  const parts = url.pathname.split('/').filter(Boolean)
  const section = parts[0] ?? ''

  let meta: Meta = SECTIONS[section] ?? SECTIONS['']
  let imageUrl = `${origin}/${meta.image}.png`

  // Race detail: /schedule/:id -> event name + its own card.
  if (section === 'schedule' && parts[1]) {
    const row = await sbOne(`events?id=eq.${encodeURIComponent(parts[1])}&select=name,track:tracks(name)`)
    const name = (row?.name as string) || ((row?.track as { name?: string })?.name ?? null)
    if (name) meta = { ...meta, title: `${name} — ${SITE}`, description: `Session times, weather, grid and results for ${name}.` }
    imageUrl = await pickImage(origin, `/og/race-${parts[1]}.png`, meta.image)
  } else if (section === 'drivers' && parts[1]) {
    const row = await sbOne(`drivers?id=eq.${encodeURIComponent(parts[1])}&select=name,team:teams(name,class_id)`)
    const name = row?.name as string | undefined
    const team = row?.team as { name?: string; class_id?: string } | undefined
    if (name) {
      const sub = [team?.class_id, team?.name].filter(Boolean).join(' · ')
      meta = { ...meta, title: `${name} — ${SITE}`, description: sub ? `${sub} · HCR League driver profile, stats and license.` : `HCR League driver profile, stats and license.` }
    }
    imageUrl = await pickImage(origin, `/og/driver-${parts[1]}.png`, meta.image)
  }

  const pageUrl = `${origin}${url.pathname}`
  const T = esc(meta.title)
  const D = esc(meta.description)

  let html = await res.text()
  const set = (re: RegExp, replacement: string) => {
    html = html.replace(re, replacement)
  }
  set(/<title>[\s\S]*?<\/title>/, `<title>${T}</title>`)
  set(/(<meta name="description" content=")[^"]*(")/, `$1${D}$2`)
  set(/(<meta property="og:title" content=")[^"]*(")/, `$1${T}$2`)
  set(/(<meta property="og:description" content=")[^"]*(")/, `$1${D}$2`)
  set(/(<meta property="og:url" content=")[^"]*(")/, `$1${esc(pageUrl)}$2`)
  set(/(<meta property="og:image" content=")[^"]*(")/, `$1${esc(imageUrl)}$2`)
  set(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${T}$2`)
  set(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${D}$2`)
  set(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${esc(imageUrl)}$2`)

  const headers = new Headers(res.headers)
  headers.delete('content-length') // body length changed after rewrite
  return new Response(html, { status: res.status, headers })
}

export const config = {
  path: '/*',
  excludedPath: [
    '/assets/*',
    '/hero/*',
    '/*.png',
    '/*.jpg',
    '/*.svg',
    '/*.ico',
    '/*.js',
    '/*.css',
    '/*.json',
    '/*.txt',
    '/*.xml',
    '/*.webmanifest',
    '/*.woff2',
  ],
}
