// iracing-weather-sync — keeps the site's in-sim forecast honest during race week.
//
// The race page's "In-sim forecast" block reads public.weather, which mirrors what
// the iRacing session editor shows — the weather drivers will actually get, which is
// NOT the real-world race-day weather: these sessions run a different in-sim date
// (May 15) under Realistic Weather. The two Open-Meteo blocks on the same page cover
// the real world; this table is iRacing's truth, and iRacing can revise it as the
// session approaches. Hence a daily sync for events inside the coming week.
//
// DORMANT UNTIL CREDENTIALS EXIST. iRacing's Data API only answers authenticated
// members. The function needs two Supabase secrets — IRACING_EMAIL and
// IRACING_PASSWORD (Dashboard → Edge Functions → Secrets) — and returns a clear
// {skipped} explaining exactly that until they are set. It never guesses, and it
// NEVER deletes: a failed fetch or an unrecognised payload leaves the row that race
// control last wrote completely untouched.
//
// Auth is the documented legacy flow: POST /auth with the password hashed as
// base64(sha256(password + lowercase(email))), then carry the returned cookies into
// /data/* calls, each of which answers with a {link} to the real S3 payload.
//
// Secrets:        IRACING_EMAIL, IRACING_PASSWORD  (plus DISCORD-style auto ones)
// Auto-provided:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const IR = 'https://members-ng.iracing.com'
const LEAGUE_ID = 14470

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

/** base64(sha256(password + lowercase(email))) — iRacing's documented password encoding. */
async function encodePassword(email: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(password + email.toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

/** Skies codes as the session editor labels them. */
const SKIES: Record<number, string> = { 0: 'Clear', 1: 'Partly Cloudy', 2: 'Mostly Cloudy', 3: 'Overcast' }

interface SessionRow {
  launch_at?: string
  weather?: Record<string, unknown>
  track?: { track_name?: string }
}

/** Legacy service-role JWT check, same as every sibling function carries. */
function isServiceRoleJwt(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    return (payload as { role?: unknown })?.role === 'service_role'
  } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    // CRON OR ADMIN ONLY. The platform gate lets the site's PUBLIC key through as a
    // bearer credential, and this function logs into iRacing with the league owner's
    // account — repeated forced logins from strangers could lock it. Same block every
    // sibling function carries, for the same reason.
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authz = req.headers.get('Authorization') ?? ''
    const bearer = authz.replace(/^Bearer\s+/i, '').trim()
    const viaCron = bearer.length > 0 && (bearer === service || isServiceRoleJwt(bearer))
    if (!viaCron) {
      const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authz } } })
      const { data: userData } = await userClient.auth.getUser()
      if (!userData?.user) return json({ error: 'Not authenticated' }, 401)
      const { data: prof } = await userClient.from('profiles').select('is_admin').eq('id', userData.user.id).maybeSingle()
      if (!prof?.is_admin) return json({ error: 'Admins only' }, 403)
    }

    const email = (Deno.env.get('IRACING_EMAIL') ?? '').trim()
    const password = Deno.env.get('IRACING_PASSWORD') ?? ''
    if (!email || !password) {
      return json({
        skipped: 'credentials-missing',
        message: 'IRACING_EMAIL and IRACING_PASSWORD are not set in Edge Function secrets, so the ' +
          'in-sim forecast was left exactly as race control last wrote it. Add both secrets in the ' +
          'Supabase dashboard to switch this sync on.',
      })
    }

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Race week only: events in the current season starting within the next 7 days.
    const { data: events, error: evErr } = await db
      .from('events')
      .select('id, round, date, seasons!inner(is_current)')
      .eq('seasons.is_current', true)
      .neq('status', 'complete')
      .gte('date', new Date().toISOString())
      .lte('date', new Date(Date.now() + 7 * 86400_000).toISOString())
    if (evErr) return json({ error: `Could not read events — ${evErr.message}` }, 500)
    if (!events?.length) {
      return json({ ok: true, updated: 0, message: 'No race inside the next 7 days, so there is nothing to refresh.' })
    }

    // --- authenticate ---
    const authRes = await fetch(`${IR}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: await encodePassword(email, password) }),
    })
    const cookies = authRes.headers.getSetCookie?.() ?? []
    const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ')
    if (!authRes.ok || !/authtoken/i.test(cookieHeader)) {
      const detail = (await authRes.text()).slice(0, 200)
      return json({ error: `iRacing refused the login (${authRes.status}). Check the IRACING_EMAIL / IRACING_PASSWORD secrets. ${detail}` }, 502)
    }

    /** Every /data endpoint answers {link} to the real payload. */
    const data = async <T>(path: string): Promise<T | null> => {
      const r = await fetch(`${IR}${path}`, { headers: { Cookie: cookieHeader } })
      if (!r.ok) return null
      const body = await r.json().catch(() => null) as { link?: string } | null
      if (!body?.link) return body as T | null
      const real = await fetch(body.link)
      return real.ok ? (await real.json().catch(() => null)) as T : null
    }

    const payload = await data<{ sessions?: SessionRow[] } | SessionRow[]>(
      `/data/league/season_sessions?league_id=${LEAGUE_ID}&results_only=false`)
    const sessions: SessionRow[] = Array.isArray(payload) ? payload : (payload?.sessions ?? [])
    if (!sessions.length) {
      return json({ ok: false, message: 'iRacing returned no league sessions; the stored forecast was left alone.' })
    }

    const updated: string[] = []
    const skipped: string[] = []
    for (const ev of events) {
      const evTime = Date.parse(String(ev.date))
      // The session that belongs to this event: launched within 12 hours of the green flag.
      const ses = sessions.find((s) => s.launch_at && Math.abs(Date.parse(String(s.launch_at)) - evTime) < 12 * 3600_000)
      const w = ses?.weather as Record<string, unknown> | undefined
      if (!w) { skipped.push(`R${ev.round}: no matching iRacing session/weather`); continue }

      // Only write fields we can read with confidence; anything unrecognised keeps
      // whatever the row already says. temp_units 0 = Fahrenheit.
      const patch: Record<string, unknown> = {}
      if (typeof w.temp_value === 'number') patch.air_f = w.temp_units === 1 ? Math.round((w.temp_value as number) * 9 / 5 + 32) : w.temp_value
      if (typeof w.skies === 'number' && SKIES[w.skies as number]) patch.sky = SKIES[w.skies as number]
      if (typeof w.rel_humidity === 'number') patch.humidity = w.rel_humidity
      // wind_units 1 = km/h; convert so the site's mph column stays honest.
      if (typeof w.wind_value === 'number') patch.wind_mph = w.wind_units === 1 ? Math.round((w.wind_value as number) * 0.621371) : w.wind_value
      if (typeof w.precip_option === 'number') patch.precip = w.precip_option
      if (Object.keys(patch).length === 0) { skipped.push(`R${ev.round}: weather payload had no recognisable fields`); continue }

      const { data: existing } = await db.from('weather').select('id').eq('event_id', ev.id).order('sort').limit(1)
      if (existing?.length) {
        const { error } = await db.from('weather').update(patch).eq('id', existing[0].id)
        if (error) { skipped.push(`R${ev.round}: ${error.message}`); continue }
      } else {
        const { error } = await db.from('weather').insert({ event_id: ev.id, sort: 0, ...patch })
        if (error) { skipped.push(`R${ev.round}: ${error.message}`); continue }
      }
      updated.push(`R${ev.round}: ${JSON.stringify(patch)}`)
    }

    return json({ ok: true, updated: updated.length, detail: updated, skipped })
  } catch (e) {
    return json({ error: `Weather sync failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
