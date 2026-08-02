// discord-broadcast — drains public.discord_outbox and says the things in Discord.
//
// The queue is filled by database triggers, in the same transaction as the data that
// caused them, so nothing here decides WHETHER something should be announced — that
// was settled at insert time and cannot be lost. This function's only job is turning
// a queued identifier into a message and getting it delivered.
//
// It renders from LIVE data rather than from anything stored on the queue row. A
// result queued at 21:04 and posted at 21:06 shows whatever the results table says at
// 21:06 — so fixing a mis-typed finishing position before the drain runs posts the
// corrected version, and a steward adjustment applied in that window is included.
//
// Idempotency is the queue's, not ours: dedupe_key is unique, so the same race cannot
// be enqueued twice however many times it is re-imported, and a row that has been
// sent is never picked up again. A failure leaves the row pending and increments a
// counter; after MAX_ATTEMPTS it is parked as 'failed' rather than retried for ever,
// because a message that has been refused five times is a bug to look at, not a
// network blip to wait out.
//
// SCORING IS A PORT, NOT AN INVENTION. The standings post uses the same crew keying
// and the same points formula as src/lib/standings.ts — crew names normalised and
// sorted so "A / B" and "B, A" are one entry, points = points + quali_points +
// adjust, fill_in rows excluded because they score the Fill-In Cup instead. If that
// file changes, change this. A public standings post that disagrees with the
// standings page is worse than no post at all.
//
// Callable two ways, mirroring public.assert_admin_or_cron: an admin, or cron.
// Cron must present a service-role credential; there is no unauthenticated path.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs View Channel, Send Messages, Embed Links, and Create Posts on the
// results forum.
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
const SNOWFLAKE = /^\d{5,25}$/

// One drain shouldn't be able to hit Discord's rate limit or run past the function
// timeout. Anything left over is still pending and goes on the next run.
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 25
// Five refusals is a bug, not a blip.
const MAX_ATTEMPTS = 5

const CHAN_FORUM = 15
const CLASS_ORDER = ['GTP', 'LMP2', 'GTD']

// Discord's limits, and the whole reason results posts don't just dump the field.
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
}
interface ResultRow {
  event_id?: string | null
  class_id?: string | null
  number?: string | null
  drivers_text?: string | null
  cls_pos?: number | null
  quali_pos?: number | null
  points?: number | null
  quali_points?: number | null
  adjust?: number | null
  fill_in?: boolean | null
  status?: string | null
  car?: string | null
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

async function discord<T>(
  path: string,
  method: 'GET' | 'POST',
  token: string,
  body?: unknown,
  attempt = 0,
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
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch (_) { /* not JSON */ }
  }
  if (!res.ok) {
    const detail = (parsed as { message?: string } | null)?.message
    return { ok: false, status: res.status, message: `Discord API ${res.status}${detail ? `: ${detail}` : ''}` }
  }
  return { ok: true, data: (parsed ?? null) as T }
}

// --- crew identity: a port of crewKey from src/lib/standings.ts ---
function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function crewNames(driversText?: string | null): string[] {
  if (!driversText) return []
  return driversText
    .split(/\s*(?:\/|,|;|&|\+|\band\b)\s*/i)
    .map((s) => normalizeName(s.trim()))
    .filter(Boolean)
}
function crewKey(driversText?: string | null, fallback = ''): string {
  const names = crewNames(driversText)
  return names.length ? names.sort().join('|') : fallback.toLowerCase()
}
/** Row points: race + quali + steward adjustment. The single scoring formula. */
const rowPoints = (r: ResultRow) => (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

/**
 * Is this a legacy service-role JWT?
 *
 * Only ever consulted for a token the Supabase gateway has ALREADY accepted, and
 * that is what makes reading an unverified claim sound here: this function is
 * deployed with verify_jwt on, so the signature was checked before any of this code
 * ran. A forged or unsigned token never arrives. The project's anon / publishable
 * key does arrive, but carries role "anon", so it fails this.
 *
 * Needed because Supabase is mid-migration between key formats: the runtime's
 * SUPABASE_SERVICE_ROLE_KEY on this project is an sb_secret_ string, while the
 * dashboard still issues a legacy service_role JWT. Both are the scheduler.
 */
function isServiceRoleJwt(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    return (payload as { role?: unknown })?.role === 'service_role'
  } catch {
    return false
  }
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
    try {
      const body = await req.json()
      if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>
        const n = Number(b.limit)
        if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT)
        // Unlike the destructive functions, this one defaults to actually sending:
        // it is a queue drain, and a drain that does nothing by default is a drain
        // nobody remembers to arm. dryRun is here for looking at the queue safely.
        if (b.dryRun === true) dryRun = true
      }
    } catch (_) { /* empty body — defaults stand */ }

    // --- auth: an admin, or cron ---
    const authz = req.headers.get('Authorization') ?? ''
    const bearer = authz.replace(/^Bearer\s+/i, '').trim()
    // An ABSENT bearer token is not cron. The gateway accepts the project's
    // publishable key via the `apikey` header with no Authorization header at all,
    // and that key ships inside the public frontend bundle — so treating "no token"
    // as "this must be the scheduler" left every one of these functions callable by
    // anybody who could guess the slug. It did, until this line changed.
    //
    // What actually identifies the scheduler is a service-role credential: either an
    // exact match on the runtime's own key, or a legacy service_role JWT whose
    // signature the gateway has already verified.
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

    // channel_key -> the channel it posts into.
    const channelFor: Record<string, string> = {
      results: String(cfg.channel_results ?? '').trim(),
      standings: String(cfg.channel_standings ?? '').trim(),
      announcements: String(cfg.channel_announcements ?? '').trim(),
      license_ups: String(cfg.channel_license_ups ?? '').trim(),
    }

    const { data: queued, error: qErr } = await db
      .from('discord_outbox')
      .select('id, kind, channel_key, dedupe_key, payload, attempts')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit)
    if (qErr) return json({ error: `Could not read the outbox — ${qErr.message}` }, 500)

    const rows = (queued ?? []) as OutboxRow[]
    if (rows.length === 0) return json({ ok: true, drained: 0, message: 'Nothing waiting to be announced.' })

    // Forum channels take a thread, everything else takes a message. Looked up once
    // per channel per run rather than guessed from the channel_key.
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
        // Not a retryable problem — nobody has told the league where this goes.
        skipped.push({ key: row.dedupe_key, reason: `No channel is configured for "${row.channel_key}".` })
        if (!dryRun) {
          await db.from('discord_outbox')
            .update({ status: 'skipped', last_error: `No channel configured for ${row.channel_key}` })
            .eq('id', row.id)
        }
        continue
      }

      // --- render ---
      let title = ''
      let embed: Record<string, unknown> | null = null

      if (row.kind === 'result') {
        const eventId = String(row.payload?.event_id ?? '')
        const { data: ev } = await db
          .from('events').select('id, round, name, date, track_id, season_id').eq('id', eventId).maybeSingle()
        const { data: track } = ev?.track_id
          ? await db.from('tracks').select('name, config').eq('id', ev.track_id).maybeSingle()
          : { data: null }
        const { data: res } = await db
          .from('results')
          .select('class_id, number, drivers_text, cls_pos, quali_pos, points, quali_points, adjust, fill_in, status, car')
          .eq('event_id', eventId)

        const all = (res ?? []) as ResultRow[]
        if (all.length === 0) {
          skipped.push({ key: row.dedupe_key, reason: 'The race has no result rows any more.' })
          if (!dryRun) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'no result rows' }).eq('id', row.id)
          continue
        }

        const where = [track?.name, track?.config].filter(Boolean).join(' · ')
        const roundLabel = ev?.round != null ? `Round ${ev.round}` : 'Race'
        title = clip([roundLabel, ev?.name || where || null].filter(Boolean).join(' — '), MAX_TITLE)

        const fields = CLASS_ORDER.map((cls) => {
          const podium = all
            .filter((r) => r.class_id === cls && !r.fill_in && r.cls_pos != null)
            .sort((a, b) => (a.cls_pos ?? 99) - (b.cls_pos ?? 99))
            .slice(0, 5)
          if (podium.length === 0) return null
          const medal = ['🥇', '🥈', '🥉']
          const lines = podium.map((r, i) => {
            const mark = medal[i] ?? `${ordinal(r.cls_pos ?? i + 1)}`
            const who = (r.drivers_text || `#${r.number ?? '?'}`).trim()
            const pole = r.quali_pos === 1 ? ' · pole' : ''
            return `${mark} ${who}${pole}`
          })
          return { name: cls, value: clip(lines.join('\n'), MAX_FIELD), inline: false }
        }).filter(Boolean)

        if (fields.length === 0) {
          skipped.push({ key: row.dedupe_key, reason: 'No classified finishers to announce.' })
          if (!dryRun) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'no classified finishers' }).eq('id', row.id)
          continue
        }

        embed = {
          title,
          url: ev?.id ? `${SITE}/schedule/${ev.id}` : `${SITE}/results`,
          description: clip(where ? `Provisional classification — ${where}` : 'Provisional classification', MAX_DESC),
          color: HCR_YELLOW,
          fields,
          footer: { text: 'HCR League · full classification and lap times on the site' },
        }
      } else if (row.kind === 'news') {
        const newsId = String(row.payload?.news_id ?? '')
        const { data: article } = await db
          .from('news').select('id, slug, title, dek, author, cover_url, is_published, category').eq('id', newsId).maybeSingle()
        if (!article) {
          skipped.push({ key: row.dedupe_key, reason: 'The article no longer exists.' })
          if (!dryRun) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'article deleted' }).eq('id', row.id)
          continue
        }
        // Unpublished between queueing and draining: the queue is not the authority
        // on whether something is still meant to be public. Don't post it.
        if (article.is_published !== true) {
          skipped.push({ key: row.dedupe_key, reason: 'The article was unpublished before this ran.' })
          if (!dryRun) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'unpublished before send' }).eq('id', row.id)
          continue
        }
        title = clip(String(article.title ?? 'League news'), MAX_TITLE)
        embed = {
          title,
          url: `${SITE}/news`,
          description: clip(String(article.dek ?? ''), MAX_DESC),
          color: HCR_YELLOW,
          ...(article.cover_url && /^https?:\/\//i.test(String(article.cover_url))
            ? { image: { url: String(article.cover_url) } }
            : {}),
          footer: { text: article.author ? `HCR League · ${article.author}` : 'HCR League' },
        }
      } else if (row.kind === 'standings') {
        const eventId = String(row.payload?.after_event_id ?? '')
        const { data: ev } = await db.from('events').select('id, round, season_id').eq('id', eventId).maybeSingle()
        const seasonId = ev?.season_id ?? null
        if (!seasonId) {
          skipped.push({ key: row.dedupe_key, reason: 'That race is not attached to a season.' })
          if (!dryRun) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'no season' }).eq('id', row.id)
          continue
        }
        const { data: seasonEvents } = await db.from('events').select('id').eq('season_id', seasonId)
        const eventIds = (seasonEvents ?? []).map((e) => String(e.id))
        const { data: res } = await db
          .from('results')
          .select('class_id, number, drivers_text, cls_pos, points, quali_points, adjust, fill_in')
          .in('event_id', eventIds.length ? eventIds : ['00000000-0000-0000-0000-000000000000'])

        // The port of computeStandings: crew-keyed, fill-ins excluded, sorted on
        // points then best class finish.
        const perClass = new Map<string, Map<string, { name: string; points: number; best: number | null }>>()
        for (const r of ((res ?? []) as ResultRow[])) {
          if (r.fill_in) continue
          const cls = String(r.class_id ?? '')
          if (!CLASS_ORDER.includes(cls)) continue
          const name = (r.drivers_text || '').trim() || `#${r.number ?? '?'}`
          const key = crewKey(r.drivers_text, name)
          const bucket = perClass.get(cls) ?? new Map()
          const cur = bucket.get(key) ?? { name, points: 0, best: null }
          cur.points += rowPoints(r)
          const p = r.cls_pos ?? null
          cur.best = cur.best === null ? p : Math.min(cur.best, p ?? 99)
          bucket.set(key, cur)
          perClass.set(cls, bucket)
        }

        const fields = CLASS_ORDER.map((cls) => {
          const bucket = perClass.get(cls)
          if (!bucket || bucket.size === 0) return null
          const top = [...bucket.values()]
            .sort((a, b) => b.points - a.points || (a.best ?? 99) - (b.best ?? 99))
            .slice(0, 5)
          const lines = top.map((t, i) => `\`${String(i + 1).padStart(2)}\` ${t.name} — **${Math.round(t.points * 100) / 100}**`)
          return { name: cls, value: clip(lines.join('\n'), MAX_FIELD), inline: false }
        }).filter(Boolean)

        if (fields.length === 0) {
          skipped.push({ key: row.dedupe_key, reason: 'No championship points to show yet.' })
          if (!dryRun) await db.from('discord_outbox').update({ status: 'skipped', last_error: 'no points' }).eq('id', row.id)
          continue
        }

        title = clip(ev?.round != null ? `Championship after Round ${ev.round}` : 'Championship standings', MAX_TITLE)
        embed = {
          title,
          url: `${SITE}/standings`,
          color: HCR_YELLOW,
          fields,
          footer: { text: 'HCR League · top five per class · full table on the site' },
        }
      } else {
        skipped.push({ key: row.dedupe_key, reason: `Unknown announcement kind "${row.kind}".` })
        if (!dryRun) await db.from('discord_outbox').update({ status: 'skipped', last_error: `unknown kind ${row.kind}` }).eq('id', row.id)
        continue
      }

      if (dryRun) { sent.push(`${row.dedupe_key} → ${title}`); continue }
      if (!embed) continue

      // --- deliver ---
      const t = await typeOf(channelId)
      const post = t === CHAN_FORUM
        // A forum has no message list to post into — every message is a thread, and
        // the thread needs a name up front.
        ? await discord(`/channels/${channelId}/threads`, 'POST', botToken, {
            name: clip(title || 'HCR League', 100),
            message: { embeds: [embed] },
          })
        : await discord(`/channels/${channelId}/messages`, 'POST', botToken, { embeds: [embed] })

      if (post.ok) {
        sent.push(`${row.dedupe_key} → ${title}`)
        await db.from('discord_outbox')
          .update({ status: 'sent', sent_at: new Date().toISOString(), attempts: row.attempts + 1, last_error: null })
          .eq('id', row.id)
        continue
      }

      const attempts = row.attempts + 1
      const giveUp = attempts >= MAX_ATTEMPTS
      failed.push({ key: row.dedupe_key, reason: `${post.message}${giveUp ? ' — parked after too many attempts' : ''}` })
      await db.from('discord_outbox')
        .update({ status: giveUp ? 'failed' : 'pending', attempts, last_error: clip(post.message, 500) })
        .eq('id', row.id)
    }

    return json({
      ok: failed.length === 0,
      dryRun,
      drained: sent.length,
      sent,
      skipped,
      failed,
    })
  } catch (e) {
    return json({ error: `Broadcast failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
