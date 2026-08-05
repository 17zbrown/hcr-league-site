// discord-race-week — on Wednesday of a race week, posts the round's scheduled
// event into #announcements so members can hit "Interested".
//
// The Events tab already mirrors the calendar (discord-events-sync owns that), but
// nobody browses the Events tab unprompted. A guild-event link posted in a channel
// unfurls into the event card with the Interested button on it — so this puts the
// card where people actually look, once per round, in race week.
//
// "Race week" is: an uncompleted round whose date falls within the next 7 days.
// Races run on Sundays and the cron fires on Wednesdays, so the normal case is one
// round, four days out. The window is deliberately day-agnostic — if a Wednesday
// run is missed and this fires Thursday by hand, the answer is still right.
//
// IDEMPOTENT BY TABLE, NOT BY TIMING. discord_race_week_posts records every round
// ever posted, so re-running in the same week does nothing, and a round is posted
// at most once no matter how many Wednesdays its week contains.
//
// {"edit": true} re-renders the recorded post for any round still in the window and
// PATCHes it in place — for when the copy or the schedule changes mid-week.
//
// SESSION TIMES COME FROM THE sessions TABLE, rendered as Discord timestamps so
// every member reads them in their own timezone (the league's 22:45/23:15/00:00 UTC
// schedule reads 6:45 PM / 7:15 PM / 8:00 PM Eastern). Hardcoding "6:45" would be
// wrong for anyone outside Eastern time and silently wrong for everyone the day the
// schedule moves.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const WINDOW_DAYS = 7

interface TrackRow { name: string | null; location: string | null }
interface EventRow {
  id: string
  round: number | null
  name: string | null
  date: string | null
  track: TrackRow | TrackRow[] | null
}
interface SessionRow { event_id: string; type: string | null; start: string | null; dur_min: number | null; sort: number | null }
interface GuildEvent { id: string; name: string; status: number }

// The line members actually plan their evening around. <t:X:t> renders as a short
// local time (6:45 PM for Eastern viewers) in every reader's own timezone.
function scheduleLines(sessions: SessionRow[]): string[] {
  const icon = (t: string) => {
    const k = t.toLowerCase()
    if (k.startsWith('prac')) return '🔧'
    if (k.startsWith('qual')) return '⏱️'
    if (k.startsWith('race')) return '🟢'
    return '📋'
  }
  return sessions
    .filter((s) => s.start && Number.isFinite(Date.parse(s.start)))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((s) => {
      const t = Math.floor(Date.parse(s.start!) / 1000)
      const label = (s.type ?? 'Session').trim()
      const dur = s.dur_min ? ` · ${s.dur_min} minutes` : ''
      return `> ${icon(label)} **${label}** — <t:${t}:t>${dur}`
    })
}

const trackOf = (e: EventRow): TrackRow | null => (Array.isArray(e.track) ? e.track[0] ?? null : e.track)
const clamp = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s)

async function discord(path: string, method: string, token: string, body?: unknown, attempt = 0): Promise<{ ok: boolean; status: number; data: unknown; message: string }> {
  const res = await fetch(`${DISCORD}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 429 && attempt < 3) {
    const retry = Number(res.headers.get('retry-after') ?? '1')
    await new Promise((r) => setTimeout(r, (Number.isFinite(retry) ? retry : 1) * 1000 + 250))
    return discord(path, method, token, body, attempt + 1)
  }
  const text = await res.text()
  let parsed: unknown = null
  try { parsed = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  const msg = (parsed as { message?: string } | null)?.message ?? text.slice(0, 200)
  return { ok: res.ok, status: res.status, data: parsed, message: msg }
}

function isServiceRoleJwt(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const b = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    return (JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))) as { role?: unknown })?.role === 'service_role'
  } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

    // {"edit": true} re-renders and PATCHes this week's recorded posts instead of
    // creating anything.
    let editMode = false
    try {
      const b = await req.json()
      if (b && typeof b === 'object' && (b as { edit?: unknown }).edit === true) editMode = true
    } catch { /* no body — normal posting mode */ }

    const authz = req.headers.get('Authorization') ?? ''
    const bearer = authz.replace(/^Bearer\s+/i, '').trim()
    // A non-empty service-role bearer is the scheduler; an absent one never is.
    const viaCron = bearer.length > 0 && (bearer === service || isServiceRoleJwt(bearer))
    if (!viaCron) {
      const uc = createClient(url, anon, { global: { headers: { Authorization: authz } } })
      const { data: ud } = await uc.auth.getUser()
      if (!ud?.user) return json({ error: 'Not authenticated' }, 401)
      const { data: pf } = await uc.from('profiles').select('is_admin').eq('id', ud.user.id).maybeSingle()
      if (!pf?.is_admin) return json({ error: 'Admins only' }, 403)
    }

    const db = createClient(url, service)
    const { data: cfg } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    const guildId = String(cfg.guild_id ?? '').trim()
    const channelId = String(cfg.channel_announcements ?? '').trim()
    if (!guildId || !botToken) return json({ error: 'Guild id or bot token missing.' }, 400)
    if (!channelId) return json({ skipped: 'No announcements channel is configured.' })

    const { data: season } = await db.from('seasons').select('id, name').eq('is_current', true).limit(1).maybeSingle()
    if (!season?.id) return json({ skipped: 'No season is marked as current.' })

    // Rounds inside the window. `date` is a UTC-midnight calendar day; comparing to
    // "now" naturally excludes a race already run this week.
    const now = Date.now()
    const until = new Date(now + WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data: rows, error: evErr } = await db
      .from('events')
      .select('id, round, name, date, track:tracks(name, location)')
      .eq('season_id', season.id)
      .neq('status', 'complete')
      .gte('date', new Date(now).toISOString())
      .lt('date', until)
      .order('round')
    if (evErr) return json({ error: evErr.message }, 500)

    const upcoming = (rows ?? []) as unknown as EventRow[]
    if (!upcoming.length) return json({ ok: true, posted: [], message: 'No round inside the next 7 days — not race week.' })

    // What was already posted, ever. The primary key does the real enforcement; this
    // read just keeps the normal path quiet — and in edit mode it is the work list.
    const { data: postedRows } = await db
      .from('discord_race_week_posts')
      .select('event_id, message_id, discord_event_id')
      .in('event_id', upcoming.map((e) => e.id))
    type PostedRow = { event_id: string; message_id: string | null; discord_event_id: string }
    const priorPost = new Map(((postedRows ?? []) as PostedRow[]).map((r) => [r.event_id, r.message_id]))
    // The Discord event id we linked when the post was first made — so an edit never
    // has to re-derive it and cannot swap the card out from under the Interested list.
    const priorEventId = new Map(((postedRows ?? []) as PostedRow[]).map((r) => [r.event_id, r.discord_event_id]))

    // Session times for every round in the window, in one read.
    const { data: sessRows } = await db
      .from('sessions')
      .select('event_id, type, start, dur_min, sort')
      .in('event_id', upcoming.map((e) => e.id))
    const sessionsByEvent = new Map<string, SessionRow[]>()
    for (const s of (sessRows ?? []) as SessionRow[]) {
      const list = sessionsByEvent.get(s.event_id) ?? []
      list.push(s)
      sessionsByEvent.set(s.event_id, list)
    }

    // The Events tab, to find the scheduled event this round mirrors to. The name is
    // the join key, built exactly as discord-events-sync builds it.
    const list = await discord(`/guilds/${guildId}/scheduled-events`, 'GET', botToken)
    if (!list.ok) return json({ error: `Could not read the Events tab — ${list.message}` }, 502)
    const guildEvents = (Array.isArray(list.data) ? list.data : []) as GuildEvent[]

    const posted: string[] = []
    const skipped: { round: string; reason: string }[] = []
    const warnings: string[] = []

    for (const row of upcoming) {
      const label = row.name?.trim() || trackOf(row)?.name?.trim() || 'Race'
      const name = clamp(row.round != null ? `R${row.round} · ${label}` : label, 100)
      const prior = priorPost.has(row.id)
      if (!editMode && prior) { skipped.push({ round: name, reason: 'already posted' }); continue }
      if (editMode && !prior) { skipped.push({ round: name, reason: 'nothing posted yet to edit' }); continue }

      const ge = guildEvents.find((g) => g?.name === name)
      if (!ge && !editMode) {
        // events-sync runs hourly, so this is a sequencing hiccup, not a dead end —
        // next Wednesday (or a manual re-run after the sync) picks it up.
        warnings.push(`No Discord event named "${name}" exists yet — run discord-events-sync, then this again.`)
        continue
      }

      const when = row.date ? `<t:${Math.floor(Date.parse(row.date) / 1000)}:D>` : 'this weekend'
      // The session times are the part people plan their evening around, so they get
      // their own emphasised lines, not a clause in a sentence.
      const schedule = scheduleLines(sessionsByEvent.get(row.id) ?? [])
      const content = [
        `🏁 **It's race week!** Round ${row.round ?? '?'} — **${label}** · ${when}`,
        ...schedule,
        `Hit **Interested** below if you're planning to race, or want to follow along.`,
        // The bare event URL is what makes Discord render the event card with its
        // Interested button — that link staying on its own line is the feature.
        `https://discord.com/events/${guildId}/${priorEventId.get(row.id) ?? ge?.id ?? ''}`,
      ].join('\n')

      if (editMode) {
        const messageId = String(priorPost.get(row.id) ?? '')
        if (!/^\d{5,25}$/.test(messageId)) {
          skipped.push({ round: name, reason: 'no message id was recorded for the original post' })
          continue
        }
        const res = await discord(`/channels/${channelId}/messages/${messageId}`, 'PATCH', botToken, { content })
        if (!res.ok) { warnings.push(`Could not edit ${name} — ${res.message}`); continue }
        posted.push(`edited: ${name}`)
        continue
      }

      const res = await discord(`/channels/${channelId}/messages`, 'POST', botToken, { content })
      if (!res.ok) { warnings.push(`Could not post ${name} — ${res.message}`); continue }
      const messageId = String((res.data as { id?: string } | null)?.id ?? '')

      const { error: bookErr } = await db.from('discord_race_week_posts').insert({
        event_id: row.id, discord_event_id: ge!.id, message_id: messageId || null,
      })
      // A conflict here means another run beat us to it — the post above raced, and
      // Discord now shows two. Say so loudly; it is the one failure a human should see.
      if (bookErr) warnings.push(`Posted ${name} but could not record it — ${bookErr.message}. A re-run may duplicate this post.`)
      posted.push(name)
    }

    return json({ ok: warnings.length === 0, posted, skipped, warnings })
  } catch (e) {
    return json({ error: `Race-week post failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
