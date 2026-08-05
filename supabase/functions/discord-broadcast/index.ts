// discord-broadcast — drains public.discord_outbox and says the things in Discord.
//
// The queue is filled by database triggers, in the same transaction as the data that
// caused them, so nothing here decides WHETHER something should be announced — that
// was settled at insert time and cannot be lost. This function's only job is turning
// a queued identifier into a message and getting it delivered.
//
// It renders from LIVE data rather than from anything stored on the queue row, which
// is also what makes {"editSent": true} work: re-running the same renderer over the
// same race a week later picks up every steward adjustment and every correction, so
// an edit is just a send that PATCHes instead of POSTing.
//
// Idempotency is the queue's: dedupe_key is unique, so a race cannot be enqueued
// twice however many times it is re-imported. A failure leaves the row pending and
// increments a counter; after MAX_ATTEMPTS it is parked as 'failed' rather than
// retried for ever.
//
// SCORING IS A PORT, NOT AN INVENTION. The standings post uses the same crew keying
// and the same points formula as src/lib/standings.ts — crew names normalised and
// sorted so "A / B" and "B, A" are one entry, points = points + quali_points +
// adjust, fill_in rows excluded because they score the Fill-In Cup instead. If that
// file changes, change this.
//
// Callable two ways, mirroring public.assert_admin_or_cron: an admin, or cron. Cron
// must present a service-role credential; there is deliberately no unauthenticated
// path, because the gateway lets the PUBLIC publishable key through as `apikey` with
// no Authorization header.
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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const SITE = 'https://hcrleague.com'
const HCR_YELLOW = 0xf2e114
// A decision's colour is the fastest thing to read in a busy channel, so a penalty
// and a no-action finding must never look alike at a glance.
const PENALTY_RED = 0xc62430
const CLEARED_GREEN = 0x12805c
const SNOWFLAKE = /^\d{5,25}$/

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 25
const MAX_ATTEMPTS = 5

const CHAN_FORUM = 15
const CLASS_ORDER = ['GTP', 'LMP2', 'GTD']
const PODIUM = ['🥇', '🥈', '🥉']

const MAX_TITLE = 256
const MAX_FIELD = 1024
const MAX_DESC = 4096
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

interface OutboxRow {
  id: number
  kind: string
  channel_key: string
  dedupe_key: string
  payload: Record<string, unknown>
  attempts: number
  target_id: string | null
}
interface ResultRow {
  event_id?: string | null
  class_id?: string | null
  number?: string | null
  drivers_text?: string | null
  pos?: number | null
  cls_pos?: number | null
  grid?: number | null
  quali_pos?: number | null
  inc?: number | null
  laps?: number | null
  best_lap?: string | null
  best_on?: number | null
  gap?: string | null
  total_time?: string | null
  points?: number | null
  quali_points?: number | null
  adjust?: number | null
  fill_in?: boolean | null
  status?: string | null
  car?: string | null
}
interface Thread { id: string; name?: string | null; parent_id?: string | null }

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

async function discord<T>(
  path: string, method: 'GET' | 'POST' | 'PATCH', token: string, body?: unknown, attempt = 0,
): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(`${DISCORD}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (e) {
    return { ok: false, status: 0, message: `Could not reach Discord (${String((e as Error)?.message ?? e)})` }
  }
  if (res.status === 429 && attempt < 3) {
    const retry = Number(res.headers.get('retry-after') ?? '1')
    await new Promise((r) => setTimeout(r, (Number.isFinite(retry) ? retry : 1) * 1000 + 250))
    return discord<T>(path, method, token, body, attempt + 1)
  }
  const text = await res.text()
  let parsed: unknown = null
  if (text) { try { parsed = JSON.parse(text) } catch (_) { /* not JSON */ } }
  if (!res.ok) {
    const detail = (parsed as { message?: string } | null)?.message
    return { ok: false, status: res.status, message: `Discord API ${res.status}${detail ? `: ${detail}` : ''}` }
  }
  return { ok: true, data: (parsed ?? null) as T }
}

// --- crew identity: a port of crewKey from src/lib/standings.ts ---
function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}
function crewNames(driversText?: string | null): string[] {
  if (!driversText) return []
  return driversText.split(/\s*(?:\/|,|;|&|\+|\band\b)\s*/i).map((s) => normalizeName(s.trim())).filter(Boolean)
}
function crewKey(driversText?: string | null, fallback = ''): string {
  const names = crewNames(driversText)
  return names.length ? names.sort().join('|') : fallback.toLowerCase()
}
const rowPoints = (r: ResultRow) => (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)

/** "1:35.433" / "95.4" / "1:02:03.1" → seconds. Null when it isn't a lap time. */
function lapToSeconds(v?: string | null): number | null {
  if (!v) return null
  const parts = String(v).trim().split(':')
  if (!parts.length || parts.some((p) => p === '' || isNaN(Number(p)))) return null
  let sec = 0
  for (const p of parts) sec = sec * 60 + Number(p)
  return sec > 0 ? sec : null
}

const DNF_STATUS = new Set(['DNF', 'DNS', 'DSQ', 'DQ', 'RET'])
const isDnf = (r: ResultRow) => DNF_STATUS.has(String(r.status ?? '').toUpperCase())
const who = (r: ResultRow) => (r.drivers_text || `#${r.number ?? '?'}`).trim()

/**
 * Is this a legacy service-role JWT? Only consulted for a token the gateway has
 * already accepted — verify_jwt is on, so the signature was checked before this ran.
 */
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
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

    let limit = DEFAULT_LIMIT
    let dryRun = false
    // Re-render things already sent and PATCH them in place, instead of draining
    // what's pending. Used after a steward adjustment, or when the report format
    // itself improves and the archive should catch up.
    let editSent = false
    let onlyKind = ''
    try {
      const body = await req.json()
      if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>
        const n = Number(b.limit)
        if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT)
        if (b.dryRun === true) dryRun = true
        if (b.editSent === true) editSent = true
        if (typeof b.kind === 'string') onlyKind = b.kind
      }
    } catch (_) { /* defaults stand */ }

    const authz = req.headers.get('Authorization') ?? ''
    const bearer = authz.replace(/^Bearer\s+/i, '').trim()
    const viaCron = bearer.length > 0 && (bearer === service || isServiceRoleJwt(bearer))
    if (!viaCron) {
      const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } })
      const { data: userData } = await userClient.auth.getUser()
      if (!userData?.user) return json({ error: 'Not authenticated' }, 401)
      const { data: prof } = await userClient
        .from('profiles').select('is_admin').eq('id', userData.user.id).maybeSingle()
      if (!prof?.is_admin) return json({ error: 'Admins only' }, 403)
    }

    const db = createClient(url, service)
    const { data: cfgRow, error: cfgErr } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    if (cfgErr) return json({ error: `Could not read the Discord config — ${cfgErr.message}` }, 500)
    const cfg = (cfgRow ?? null) as Record<string, unknown> | null
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)
    const guildId = String(cfg.guild_id ?? '').trim()

    const channelFor: Record<string, string> = {
      results: String(cfg.channel_results ?? '').trim(),
      standings: String(cfg.channel_standings ?? '').trim(),
      announcements: String(cfg.channel_announcements ?? '').trim(),
      // News has its own channel; until the reorg has created it and saved the id,
      // fall back to announcements so a published story is never stranded unsent.
      news: String(cfg.channel_news ?? '').trim() || String(cfg.channel_announcements ?? '').trim(),
      license_ups: String(cfg.channel_license_ups ?? '').trim(),
      race_control: String(cfg.channel_race_control ?? '').trim(),
    }

    let q = db.from('discord_outbox')
      .select('id, kind, channel_key, dedupe_key, payload, attempts, target_id')
      .eq('status', editSent ? 'sent' : 'pending')
      .order('created_at', { ascending: true })
      .limit(limit)
    if (onlyKind) q = q.eq('kind', onlyKind)
    const { data: queued, error: qErr } = await q
    if (qErr) return json({ error: `Could not read the outbox — ${qErr.message}` }, 500)

    const rows = (queued ?? []) as OutboxRow[]
    if (rows.length === 0) {
      return json({ ok: true, drained: 0, editSent, message: editSent ? 'Nothing sent yet to edit.' : 'Nothing waiting to be announced.' })
    }

    // Editing needs a message id per row, and the first four race reports predate
    // the column. A forum post's thread id IS its starter message id, so the ids can
    // be recovered by matching thread names — but only for threads Discord still
    // considers active. An archived one is reported rather than silently skipped.
    let activeThreads: Thread[] = []
    if (editSent && guildId) {
      const t = await discord<{ threads?: Thread[] }>(`/guilds/${guildId}/threads/active`, 'GET', botToken)
      if (t.ok) activeThreads = t.data?.threads ?? []
    }

    const channelType = new Map<string, number>()
    const typeOf = async (id: string): Promise<number | null> => {
      if (channelType.has(id)) return channelType.get(id)!
      const res = await discord<{ type?: number }>(`/channels/${id}`, 'GET', botToken)
      if (!res.ok) return null
      const t = Number(res.data?.type ?? -1)
      channelType.set(id, t)
      return t
    }

    const sent: string[] = []
    const skipped: { key: string; reason: string }[] = []
    const failed: { key: string; reason: string }[] = []

    for (const row of rows) {
      const channelId = channelFor[row.channel_key] ?? ''
      if (!SNOWFLAKE.test(channelId)) {
        skipped.push({ key: row.dedupe_key, reason: `No channel is configured for "${row.channel_key}".` })
        if (!dryRun && !editSent) {
          await db.from('discord_outbox').update({ status: 'skipped', last_error: `No channel configured for ${row.channel_key}` }).eq('id', row.id)
        }
        continue
      }

      let title = ''
      let embed: Record<string, unknown> | null = null

      // ------------------------------------------------------------ result ----
      if (row.kind === 'result') {
        const eventId = String(row.payload?.event_id ?? '')
        const { data: ev } = await db
          .from('events').select('id, round, name, date, track_id, season_id, duration_h, duration_min')
          .eq('id', eventId).maybeSingle()
        const { data: track } = ev?.track_id
          ? await db.from('tracks').select('name, config').eq('id', ev.track_id).maybeSingle()
          : { data: null }
        const { data: res } = await db
          .from('results')
          .select('class_id, number, drivers_text, pos, cls_pos, grid, quali_pos, inc, laps, best_lap, best_on, gap, total_time, fill_in, status, car')
          .eq('event_id', eventId)

        const all = (res ?? []) as ResultRow[]
        if (all.length === 0) {
          skipped.push({ key: row.dedupe_key, reason: 'The race has no result rows any more.' })
          if (!dryRun && !editSent) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'no result rows' }).eq('id', row.id)
          continue
        }

        const where = [track?.name, track?.config].filter(Boolean).join(' · ')
        const roundLabel = ev?.round != null ? `Round ${ev.round}` : 'Race'
        title = clip([roundLabel, ev?.name || where || null].filter(Boolean).join(' — '), MAX_TITLE)

        // Championship entries only, so the podium here agrees with the standings
        // page. Fill-ins raced but score the Fill-In Cup, and are counted separately
        // in the notes below rather than quietly mixed in.
        const scoring = all.filter((r) => !r.fill_in)
        const fillIns = all.length - scoring.length

        const fields: Record<string, unknown>[] = []
        for (const cls of CLASS_ORDER) {
          const inClass = scoring
            .filter((r) => r.class_id === cls && r.cls_pos != null)
            .sort((a, b) => (a.cls_pos ?? 99) - (b.cls_pos ?? 99))
            .slice(0, 5)
          if (inClass.length === 0) continue
          const lines = inClass.map((r, i) => {
            const mark = PODIUM[i] ?? `\`P${r.cls_pos}\``
            // Gap is only recorded from Round 3 on; laps is always there, so the
            // winner's distance stands in for it and everyone else shows a gap when
            // one exists.
            const detail: string[] = []
            if (i > 0 && String(r.gap ?? '').trim()) detail.push(`+${String(r.gap).trim().replace(/^\+/, '')}`)
            else if (r.laps != null) detail.push(`${r.laps} laps`)
            if (r.best_lap) detail.push(r.best_lap)
            if (isDnf(r)) detail.push(String(r.status).toUpperCase())
            const pole = r.quali_pos === 1 ? ' 🅿️' : ''
            return `${mark} **${who(r)}**${pole}${detail.length ? ` · ${detail.join(' · ')}` : ''}`
          })
          fields.push({ name: cls, value: clip(lines.join('\n'), MAX_FIELD), inline: false })
        }

        if (fields.length === 0) {
          skipped.push({ key: row.dedupe_key, reason: 'No classified finishers to announce.' })
          if (!dryRun && !editSent) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'no classified finishers' }).eq('id', row.id)
          continue
        }

        // --- the talking points ---
        // Deliberately a handful of superlatives rather than a data dump: the
        // question this block answers is "what would somebody argue about in the
        // replies", not "what happened".
        const notes: string[] = []

        const timed = all.map((r) => ({ r, s: lapToSeconds(r.best_lap) }))
          .filter((x): x is { r: ResultRow; s: number } => x.s !== null)
        if (timed.length) {
          const fl = timed.reduce((a, b) => (b.s < a.s ? b : a))
          notes.push(`⏱️ **Fastest lap** — ${who(fl.r)} · \`${fl.r.best_lap}\`${fl.r.best_on ? ` on lap ${fl.r.best_on}` : ''}`)
        }

        const maxLaps = all.reduce((m, r) => Math.max(m, r.laps ?? 0), 0)
        if (maxLaps > 0) {
          const mins = Number(ev?.duration_min ?? 0) || Number(ev?.duration_h ?? 0) * 60
          notes.push(`🏁 **Distance** — ${maxLaps} laps${mins ? ` · ${mins} minutes` : ''}`)
        }

        const withInc = all.filter((r) => r.inc != null)
        if (withInc.length) {
          const total = withInc.reduce((s, r) => s + (r.inc ?? 0), 0)
          const clean = withInc.filter((r) => (r.laps ?? 0) > 0).sort((a, b) => (a.inc ?? 0) - (b.inc ?? 0))[0]
          const messy = withInc.reduce((a, b) => ((b.inc ?? 0) > (a.inc ?? 0) ? b : a))
          notes.push(`💥 **Incidents** — ${total}x across the field`)
          if (clean) notes.push(`🧼 **Cleanest run** — ${who(clean)} · ${clean.inc}x`)
          if (messy && (messy.inc ?? 0) > (clean?.inc ?? 0)) notes.push(`🔧 **Most incidents** — ${who(messy)} · ${messy.inc}x`)
        }

        // Grid position minus finishing position. Only meaningful for cars that were
        // actually classified, so retirements are excluded — "gained 9 places" is a
        // silly thing to say about somebody who parked it.
        const movers = all
          .filter((r) => r.grid != null && r.pos != null && !isDnf(r))
          .map((r) => ({ r, gain: (r.grid ?? 0) - (r.pos ?? 0) }))
          .filter((x) => x.gain > 0)
        if (movers.length) {
          const best = movers.reduce((a, b) => (b.gain > a.gain ? b : a))
          notes.push(`📈 **Biggest mover** — ${who(best.r)} · P${best.r.grid} → P${best.r.pos} (+${best.gain})`)
        }

        const dnfs = all.filter(isDnf).length
        if (dnfs > 0) notes.push(`🚧 **Did not finish** — ${dnfs}`)
        if (fillIns > 0) notes.push(`🎟️ **Fill-In Cup entries** — ${fillIns} (scored separately)`)

        if (notes.length) fields.push({ name: 'Race notes', value: clip(notes.join('\n'), MAX_FIELD), inline: false })

        embed = {
          title,
          url: ev?.id ? `${SITE}/schedule/${ev.id}` : `${SITE}/results`,
          description: clip(where ? `Provisional classification — ${where}` : 'Provisional classification', MAX_DESC),
          color: HCR_YELLOW,
          fields,
          footer: { text: 'HCR League · 🅿️ pole · full classification and lap times on the site' },
        }
      // -------------------------------------------------------------- news ----
      } else if (row.kind === 'news') {
        const newsId = String(row.payload?.news_id ?? '')
        const { data: article } = await db
          .from('news').select('id, slug, title, dek, author, cover_url, is_published, category').eq('id', newsId).maybeSingle()
        if (!article) {
          skipped.push({ key: row.dedupe_key, reason: 'The article no longer exists.' })
          if (!dryRun && !editSent) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'article deleted' }).eq('id', row.id)
          continue
        }
        if (article.is_published !== true) {
          skipped.push({ key: row.dedupe_key, reason: 'The article was unpublished before this ran.' })
          if (!dryRun && !editSent) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'unpublished before send' }).eq('id', row.id)
          continue
        }
        title = clip(String(article.title ?? 'League news'), MAX_TITLE)

        // A story's own photo, so the Discord post looks like the article rather than
        // a bare link. cover_url wins if one was set by hand; otherwise the first
        // attached image leads. Video is deliberately not embedded — Discord will not
        // play a 50MB file inline, and a second link under the embed reads as clutter,
        // so the "read it on the site" link stays the way to the video.
        const { data: shots } = await db
          .from('news_media')
          .select('kind, url, sort')
          .eq('news_id', newsId)
          .eq('kind', 'image')
          .order('sort')
          .limit(1)
        const lead = String(article.cover_url ?? '').trim() || String((shots ?? [])[0]?.url ?? '').trim()

        embed = {
          title,
          url: `${SITE}/news`,
          description: clip(String(article.dek ?? ''), MAX_DESC),
          color: HCR_YELLOW,
          ...(lead && /^https?:\/\//i.test(lead) ? { image: { url: lead } } : {}),
          footer: { text: article.author ? `HCR League · ${article.author}` : 'HCR League' },
        }
      // --------------------------------------------------------- standings ----
      } else if (row.kind === 'standings') {
        const eventId = String(row.payload?.after_event_id ?? '')
        const { data: ev } = await db.from('events').select('id, round, season_id').eq('id', eventId).maybeSingle()
        const seasonId = ev?.season_id ?? null
        if (!seasonId) {
          skipped.push({ key: row.dedupe_key, reason: 'That race is not attached to a season.' })
          if (!dryRun && !editSent) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'no season' }).eq('id', row.id)
          continue
        }
        const { data: seasonEvents } = await db.from('events').select('id').eq('season_id', seasonId)
        const eventIds = (seasonEvents ?? []).map((e) => String(e.id))
        const { data: res } = await db
          .from('results')
          .select('class_id, number, drivers_text, cls_pos, points, quali_points, adjust, fill_in')
          .in('event_id', eventIds.length ? eventIds : ['00000000-0000-0000-0000-000000000000'])

        const perClass = new Map<string, Map<string, { name: string; points: number; best: number | null; starts: number }>>()
        for (const r of ((res ?? []) as ResultRow[])) {
          if (r.fill_in) continue
          const cls = String(r.class_id ?? '')
          if (!CLASS_ORDER.includes(cls)) continue
          const name = (r.drivers_text || '').trim() || `#${r.number ?? '?'}`
          const key = crewKey(r.drivers_text, name)
          const bucket = perClass.get(cls) ?? new Map()
          const cur = bucket.get(key) ?? { name, points: 0, best: null, starts: 0 }
          cur.points += rowPoints(r)
          cur.starts += 1
          const p = r.cls_pos ?? null
          cur.best = cur.best === null ? p : Math.min(cur.best, p ?? 99)
          bucket.set(key, cur)
          perClass.set(cls, bucket)
        }

        const fields = CLASS_ORDER.map((cls) => {
          const bucket = perClass.get(cls)
          if (!bucket || bucket.size === 0) return null
          const top = [...bucket.values()]
            .sort((a, b) => b.points - a.points || (a.best ?? 99) - (b.best ?? 99)).slice(0, 5)
          const leader = top[0]?.points ?? 0
          const lines = top.map((t, i) => {
            const pts = Math.round(t.points * 100) / 100
            const behind = i === 0 ? 'leader' : `−${Math.round((leader - t.points) * 100) / 100}`
            return `\`${String(i + 1).padStart(2)}\` ${t.name} — **${pts}** · ${behind}`
          })
          return { name: cls, value: clip(lines.join('\n'), MAX_FIELD), inline: false }
        }).filter(Boolean) as Record<string, unknown>[]

        if (fields.length === 0) {
          skipped.push({ key: row.dedupe_key, reason: 'No championship points to show yet.' })
          if (!dryRun && !editSent) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'no points' }).eq('id', row.id)
          continue
        }

        title = clip(ev?.round != null ? `Championship after Round ${ev.round}` : 'Championship standings', MAX_TITLE)
        embed = {
          title, url: `${SITE}/standings`, color: HCR_YELLOW, fields,
          footer: { text: 'HCR League · top five per class · full table on the site' },
        }
      // ------------------------------------------------------------ ruling ----
      } else if (row.kind === 'ruling') {
        const protestId = String(row.payload?.protest_id ?? '')
        const { data: pr } = await db.from('protests')
          .select('id, status, verdict, penalty, category, summary, incident_lap, against_driver_id, against_text, event_id')
          .eq('id', protestId).maybeSingle()
        if (!pr) {
          skipped.push({ key: row.dedupe_key, reason: 'The protest no longer exists.' })
          if (!dryRun && !editSent) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'protest deleted' }).eq('id', row.id)
          continue
        }
        // Reopened between queueing and sending. The queue is not the authority on
        // whether a decision still stands, so publishing it now would be wrong.
        if (pr.status !== 'resolved' && pr.status !== 'dismissed') {
          skipped.push({ key: row.dedupe_key, reason: `The protest went back to "${pr.status}" before this ran, so no decision was published.` })
          if (!dryRun && !editSent) await db.from('discord_outbox').update({ status: 'skipped', last_error: `reopened as ${pr.status}` }).eq('id', row.id)
          continue
        }

        // Prefer the linked driver's real name; against_text is the free-text
        // fallback for somebody who has no driver profile yet.
        let against = String(pr.against_text ?? '').trim()
        if (pr.against_driver_id) {
          const { data: d } = await db.from('drivers').select('name').eq('id', pr.against_driver_id).maybeSingle()
          if (d?.name) against = String(d.name)
        }
        const { data: ev } = pr.event_id
          ? await db.from('events').select('round, name').eq('id', pr.event_id).maybeSingle()
          : { data: null }

        const dismissed = pr.status === 'dismissed'
        const penalty = String(pr.penalty ?? '').trim()
        const round = ev?.round != null ? `Round ${ev.round}` : null
        title = clip(['Stewards\u2019 decision', round, ev?.name].filter(Boolean).join(' \u2014 '), MAX_TITLE)

        const fields: Record<string, unknown>[] = []
        if (against) fields.push({ name: 'Driver', value: clip(against, MAX_FIELD), inline: true })
        if (pr.incident_lap) fields.push({ name: 'Lap', value: clip(String(pr.incident_lap), MAX_FIELD), inline: true })
        if (pr.category) fields.push({ name: 'Category', value: clip(String(pr.category), MAX_FIELD), inline: true })
        if (pr.summary) fields.push({ name: 'Incident', value: clip(String(pr.summary), MAX_FIELD), inline: false })
        if (pr.verdict) fields.push({ name: 'Finding', value: clip(String(pr.verdict), MAX_FIELD), inline: false })
        fields.push({
          name: 'Outcome',
          value: dismissed
            ? 'Dismissed \u2014 no further action.'
            : (penalty ? clip(penalty, MAX_FIELD) : 'Upheld \u2014 no penalty applied.'),
          inline: false,
        })

        embed = {
          title,
          url: `${SITE}/portal`,
          // Green for a driver cleared, red only where a penalty was actually
          // applied. An upheld protest with no penalty is neither, so it stays brand
          // yellow rather than being coloured like a punishment.
          color: dismissed ? CLEARED_GREEN : (penalty ? PENALTY_RED : HCR_YELLOW),
          fields,
          footer: { text: 'HCR League \u00b7 race control \u00b7 decisions are final once published' },
        }
      } else {
        skipped.push({ key: row.dedupe_key, reason: `Unknown announcement kind "${row.kind}".` })
        if (!dryRun && !editSent) await db.from('discord_outbox').update({ status: 'skipped', last_error: `unknown kind ${row.kind}` }).eq('id', row.id)
        continue
      }

      if (!embed) continue
      if (dryRun) { sent.push(`${row.dedupe_key} → ${title}`); continue }

      // ----------------------------------------------------------- deliver ----
      if (editSent) {
        // Recover the id if this row predates the target_id column. A forum post's
        // thread id doubles as its starter message id, so a name match is enough.
        let targetId = String(row.target_id ?? '').trim()
        if (!SNOWFLAKE.test(targetId)) {
          const match = activeThreads.find(
            (t) => String(t.parent_id ?? '') === channelId && String(t.name ?? '').trim() === title.trim(),
          )
          targetId = String(match?.id ?? '')
        }
        if (!SNOWFLAKE.test(targetId)) {
          skipped.push({ key: row.dedupe_key, reason: `Could not find the post for "${title}" — it may have been archived or renamed, so there was nothing to edit.` })
          continue
        }
        const patch = await discord(`/channels/${targetId}/messages/${targetId}`, 'PATCH', botToken, { embeds: [embed] })
        if (patch.ok) {
          sent.push(`edited: ${title}`)
          await db.from('discord_outbox').update({ target_id: targetId, edited_at: new Date().toISOString() }).eq('id', row.id)
        } else {
          failed.push({ key: row.dedupe_key, reason: patch.message })
        }
        continue
      }

      const t = await typeOf(channelId)
      const post = t === CHAN_FORUM
        ? await discord<{ id?: string; message?: { id?: string } }>(
            `/channels/${channelId}/threads`, 'POST', botToken,
            { name: clip(title || 'HCR League', 100), message: { embeds: [embed] } })
        : await discord<{ id?: string }>(`/channels/${channelId}/messages`, 'POST', botToken, { embeds: [embed] })

      if (post.ok) {
        // For a forum the thread id is also the starter message id; for a normal
        // channel it is just the message id. Either way this is the handle an edit
        // will need later, and not recording it was the reason the first four race
        // reports had to be found again by name.
        const targetId = String(
          (post.data as { id?: string; message?: { id?: string } })?.message?.id ??
          (post.data as { id?: string })?.id ?? '',
        )
        sent.push(`${row.dedupe_key} → ${title}`)
        await db.from('discord_outbox').update({
          status: 'sent', sent_at: new Date().toISOString(), attempts: row.attempts + 1,
          last_error: null, target_id: SNOWFLAKE.test(targetId) ? targetId : null,
        }).eq('id', row.id)
        continue
      }

      const attempts = row.attempts + 1
      const giveUp = attempts >= MAX_ATTEMPTS
      failed.push({ key: row.dedupe_key, reason: `${post.message}${giveUp ? ' — parked after too many attempts' : ''}` })
      await db.from('discord_outbox')
        .update({ status: giveUp ? 'failed' : 'pending', attempts, last_error: clip(post.message, 500) })
        .eq('id', row.id)
    }

    return json({ ok: failed.length === 0, dryRun, editSent, drained: sent.length, sent, skipped, failed })
  } catch (e) {
    return json({ error: `Broadcast failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
