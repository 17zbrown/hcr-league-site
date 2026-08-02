// discord-events-sync — mirrors the race calendar into the Discord server's
// Events tab, so members can hit "Interested" and get a reminder before lights out.
//
// Reads the current season's upcoming rounds and creates one EXTERNAL scheduled
// event per round. Matches by exact name, so running it twice never duplicates —
// an existing event is only PATCHed when its start, blurb or location drifted.
// Admin-only. Safe to run repeatedly.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs the **Manage Events** permission in the guild.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Discord scheduled-event constants
const ENTITY_EXTERNAL = 3 // entity_type: happens outside Discord (iRacing)
const PRIVACY_GUILD_ONLY = 2 // privacy_level: the only value Discord accepts
const STATUS_SCHEDULED = 1 // scheduled_event_status: not yet started
const DEFAULT_DURATION_MIN = 90

interface DiscordConfig {
  enabled: boolean
  guild_id: string | null
}

interface TrackRow {
  name: string | null
  location: string | null
}

interface EventRow {
  id: string
  round: number | null
  name: string | null
  date: string | null
  duration_min: number | null
  // PostgREST returns a to-one embed as an object, but older typings hand back an array
  track: TrackRow | TrackRow[] | null
}

interface GuildEvent {
  id: string
  name: string
  description: string | null
  scheduled_start_time: string
  status: number
  entity_type: number
  entity_metadata: { location?: string | null } | null
}

const trackOf = (e: EventRow): TrackRow | null => (Array.isArray(e.track) ? e.track[0] ?? null : e.track)
const clamp = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s)

async function discord(path: string, method: string, token: string, body?: unknown, attempt = 0): Promise<Response> {
  const res = await fetch(`${DISCORD}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  // 429 = rate limited. Back off and retry, but give up rather than loop forever.
  if (res.status === 429 && attempt < 3) {
    const raw = Number(res.headers.get('retry-after') ?? '1')
    const retry = Number.isFinite(raw) ? raw : 1
    await new Promise((r) => setTimeout(r, (retry + 0.25) * 1000))
    return discord(path, method, token, body, attempt + 1)
  }
  return res
}

// Turn a non-2xx Discord response into something an admin can act on.
async function reasonFor(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = await res.json()
    if (typeof body?.message === 'string') detail = body.message
  } catch (_) { /* empty or non-JSON body — the status is enough */ }
  if (res.status === 401) return 'Discord rejected the bot token (401) — check DISCORD_BOT_TOKEN.'
  if (res.status === 403) return 'Discord refused (403) — the bot needs the Manage Events permission in this server.'
  if (res.status === 404) return 'Discord could not find that server or event (404) — check the guild id.'
  if (res.status === 429) return 'Discord rate limited the sync (429) — try again in a minute.'
  return `Discord API ${res.status}${detail ? ` — ${detail}` : ''}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

  // --- auth: caller must be a signed-in admin ---
  const authz = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } })
  const { data: userData } = await userClient.auth.getUser()
  const user = userData?.user
  if (!user) return json({ error: 'Not authenticated' }, 401)
  const { data: prof } = await userClient.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (!prof?.is_admin) return json({ error: 'Admins only' }, 403)

  // --- config (service role bypasses RLS) ---
  const db = createClient(url, service)
  const { data: cfg } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle<DiscordConfig>()
  if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
  if (!cfg.guild_id) return json({ skipped: 'No Discord server is configured yet.' })
  if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

  // --- the calendar we want mirrored ---
  const { data: season, error: seasonErr } = await db
    .from('seasons')
    .select('id, name')
    .eq('is_current', true)
    .limit(1)
    .maybeSingle<{ id: string; name: string | null }>()
  if (seasonErr) return json({ error: seasonErr.message }, 500)
  if (!season) return json({ skipped: 'No season is marked as current.' })

  // events.date is a calendar day at UTC midnight, so yesterday's rounds are still
  // in the window — they get filtered out below by the past-start check instead.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: rows, error: eventsErr } = await db
    .from('events')
    .select('id, round, name, date, duration_min, track:tracks(name, location)')
    .eq('season_id', season.id)
    .neq('status', 'complete')
    .gte('date', since)
    .order('round')
  if (eventsErr) return json({ error: eventsErr.message }, 500)

  const upcoming = (rows ?? []) as unknown as EventRow[]
  const created: string[] = []
  const updated: string[] = []
  const skipped: { name: string; reason: string }[] = []
  let unchanged = 0

  if (!upcoming.length) {
    return json({ ok: true, created, updated, skipped, unchanged, total_upcoming: 0 })
  }

  // --- what already lives in the Events tab? ---
  const existingByName = new Map<string, GuildEvent>()
  try {
    const listRes = await discord(`/guilds/${cfg.guild_id}/scheduled-events`, 'GET', botToken)
    if (!listRes.ok) return json({ error: await reasonFor(listRes) }, listRes.status === 403 ? 403 : 502)
    const list = await listRes.json()
    if (!Array.isArray(list)) return json({ error: 'Discord returned an unexpected scheduled-events payload.' }, 502)
    // First match wins, so a hand-made duplicate never causes us to create a third.
    for (const ev of list as GuildEvent[]) {
      if (ev?.name && !existingByName.has(ev.name)) existingByName.set(ev.name, ev)
    }
  } catch (e) {
    return json({ error: `Could not reach Discord: ${String((e as Error)?.message ?? e)}` }, 502)
  }

  const seasonName = season.name?.trim() || 'HCR League'

  for (const row of upcoming) {
    const track = trackOf(row)
    const label = row.name?.trim() || track?.name?.trim() || 'Race'
    // Names double as the idempotency key, so build (and truncate) it once.
    const name = clamp(row.round != null ? `R${row.round} · ${label}` : label, 100)

    const startMs = Date.parse(row.date ?? '')
    if (!Number.isFinite(startMs)) {
      skipped.push({ name, reason: 'The round has no usable date.' })
      continue
    }
    if (startMs <= Date.now()) {
      skipped.push({ name, reason: 'Start time has already passed — Discord only accepts future events.' })
      continue
    }

    const mins = row.duration_min && row.duration_min > 0 ? row.duration_min : DEFAULT_DURATION_MIN
    const start = new Date(startMs).toISOString()
    const end = new Date(startMs + mins * 60_000).toISOString()

    const place = [track?.name?.trim(), track?.location?.trim()].filter(Boolean).join(' · ')
    const description = clamp([place, `HCR League — ${seasonName}`].filter(Boolean).join('\n'), 1000)
    const location = clamp(track?.location?.trim() || track?.name?.trim() || 'iRacing', 100)

    const existing = existingByName.get(name)

    try {
      if (!existing) {
        const res = await discord(`/guilds/${cfg.guild_id}/scheduled-events`, 'POST', botToken, {
          name,
          description,
          scheduled_start_time: start,
          scheduled_end_time: end,
          entity_type: ENTITY_EXTERNAL,
          privacy_level: PRIVACY_GUILD_ONLY,
          entity_metadata: { location },
        })
        if (!res.ok) {
          skipped.push({ name, reason: await reasonFor(res) })
          continue
        }
        created.push(name)
        continue
      }

      // Only ever touch events we could have made: still scheduled, still EXTERNAL.
      if (existing.status !== STATUS_SCHEDULED) {
        skipped.push({ name, reason: 'The Discord event has already started, finished or been cancelled.' })
        continue
      }
      if (existing.entity_type !== ENTITY_EXTERNAL) {
        skipped.push({ name, reason: 'A Discord event with this name is tied to a channel — left alone.' })
        continue
      }

      const patch: Record<string, unknown> = {}
      if (Date.parse(existing.scheduled_start_time) !== startMs) {
        patch.scheduled_start_time = start
        patch.scheduled_end_time = end // end is derived from start, so they move together
      }
      if ((existing.description ?? '') !== description) patch.description = description
      if ((existing.entity_metadata?.location ?? '') !== location) patch.entity_metadata = { location }

      if (!Object.keys(patch).length) {
        unchanged++
        continue
      }

      const res = await discord(`/guilds/${cfg.guild_id}/scheduled-events/${existing.id}`, 'PATCH', botToken, patch)
      if (!res.ok) {
        skipped.push({ name, reason: await reasonFor(res) })
        continue
      }
      updated.push(name)
    } catch (e) {
      skipped.push({ name, reason: `Could not reach Discord: ${String((e as Error)?.message ?? e)}` })
    }
  }

  return json({
    ok: true,
    created,
    updated,
    skipped,
    unchanged,
    total_upcoming: upcoming.length,
  })
})
