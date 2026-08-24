// discord-forum-limits — the cooldowns on the member suggestion box.
//
// #league-recommendations is the one room in RACE CONTROL that members write in
// (discord-permissions owns who may see and post there; this owns how OFTEN).
// Kept separate deliberately: discord-permissions is a 600-line function that seven
// different rules already share, and a two-field PATCH does not need to ride along
// with a redeploy of all of it.
//
// ON A FORUM THE TWO LIMITS MEAN DIFFERENT THINGS, and they are easy to swap:
//
//   rate_limit_per_user                 → cooldown on STARTING a post
//   default_thread_rate_limit_per_user  → cooldown on REPLIES, stamped onto each
//                                         post at the moment Discord creates it
//
// THE 24-HOUR ASK, AND WHY IT IS SIX. Race control asked for one suggestion per
// member per 24 hours and one reply per 5 minutes. Discord caps slowmode at 21600
// seconds — six hours — and rejects anything larger outright. So the post cooldown
// is set to that maximum and the shortfall is reported in the response rather than
// rounded into a number that merely looks like what was asked for. Enforcing a true
// 24 hours would mean deleting members' posts after the fact, which this league does
// not do.
//
// The reply limit is exact.
//
// Because default_thread_rate_limit_per_user only applies to posts created AFTER it
// is set, any post opened before this ran keeps whatever it was born with. On a
// forum this new that is nothing; worth knowing before assuming a quiet thread is
// evidence of a bug.
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

const CHAN_FORUM = 15
/** Discord's hard ceiling on slowmode, in seconds. 86400 is refused. */
const SLOWMODE_MAX = 21600
const WANT_POST = SLOWMODE_MAX
const WANT_REPLY = 300
const ASKED_POST = 86400

interface Channel {
  id: string
  name?: string | null
  type: number
  rate_limit_per_user?: number | null
  default_thread_rate_limit_per_user?: number | null
}

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
    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    let dryRun = false
    try {
      const b = await req.json()
      if (b && typeof b === 'object' && (b as { dryRun?: unknown }).dryRun === true) dryRun = true
    } catch { /* default: apply */ }

    const authz = req.headers.get('Authorization') ?? ''
    const bearer = authz.replace(/^Bearer\s+/i, '').trim()
    const viaCron = bearer.length > 0 && (bearer === service || isServiceRoleJwt(bearer))
    if (!viaCron) {
      const uc = createClient(url, anon, { global: { headers: { Authorization: authz } } })
      const { data: ud } = await uc.auth.getUser()
      if (!ud?.user) return json({ error: 'Not authenticated' }, 401)
      const { data: pf } = await uc.from('profiles').select('is_admin').eq('id', ud.user.id).maybeSingle()
      if (!pf?.is_admin) return json({ error: 'Admins only' }, 403)
    }

    const db = createClient(url, service)
    const { data: cfg } = await db.from('discord_config')
      .select('enabled, channel_recommendations').eq('id', 1).maybeSingle()
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })

    const channelId = String(cfg.channel_recommendations ?? '').trim()
    if (!channelId) {
      return json({
        skipped: 'no-channel',
        message: 'discord_config.channel_recommendations is empty, so there is no suggestion forum to ' +
          'limit. Run discord-permissions with {"dryRun": false} first — it creates the forum and ' +
          'records its id.',
      })
    }

    const read = await fetch(`${DISCORD}/channels/${channelId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    })
    if (!read.ok) {
      return json({ error: `Could not read the channel (${read.status}). Nothing was changed.` }, 502)
    }
    const ch = await read.json() as Channel
    if (ch.type !== CHAN_FORUM) {
      return json({
        error: `#${ch.name ?? channelId} is not a forum channel (type ${ch.type}), so post and reply ` +
          'cooldowns do not apply to it the way this expects. Nothing was changed.',
      }, 409)
    }

    const before = {
      post: ch.rate_limit_per_user ?? 0,
      reply: ch.default_thread_rate_limit_per_user ?? 0,
    }
    const note = `Discord caps slowmode at ${SLOWMODE_MAX}s (6h) and refuses ${ASKED_POST}s (24h), so the ` +
      'post cooldown is the maximum Discord allows, not the 24h requested.'

    if (before.post === WANT_POST && before.reply === WANT_REPLY) {
      return json({ ok: true, changed: false, channel: `#${ch.name}`, before, note })
    }
    if (dryRun) {
      return json({ ok: true, dryRun: true, channel: `#${ch.name}`, before,
        would_set: { post: WANT_POST, reply: WANT_REPLY }, note })
    }

    const res = await fetch(`${DISCORD}/channels/${channelId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rate_limit_per_user: WANT_POST,
        default_thread_rate_limit_per_user: WANT_REPLY,
      }),
    })
    const data = await res.json().catch(() => null) as Channel & { message?: string } | null
    if (!res.ok) {
      return json({ error: `Discord refused the change: ${data?.message ?? res.status}`, before }, 502)
    }

    return json({
      ok: true,
      changed: true,
      channel: `#${data?.name ?? ch.name}`,
      before,
      after: {
        post: data?.rate_limit_per_user ?? null,
        reply: data?.default_thread_rate_limit_per_user ?? null,
      },
      note,
    })
  } catch (e) {
    return json({ error: `discord-forum-limits failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
