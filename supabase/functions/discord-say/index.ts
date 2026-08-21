// discord-say — posts a message to a STAFF channel as the bot, for the times race
// control wants a prepared list or note delivered somewhere staff can act on it.
//
// DELIBERATELY NOT A MEGAPHONE. Two restrictions make it safe to keep deployed:
//
//   1. STAFF CHANNELS ONLY. The target is resolved by name and must live in the
//      ADMIN or RACE CONTROL category. Asking it to post to #announcements or any
//      member-facing room is refused by construction, so this can never become the
//      accidental @everyone cannon.
//
//   2. NOTHING IS EVER PINGED. Every message is sent with allowed_mentions {parse: []},
//      so <@id> mentions render as clickable names — which is the point: a list of
//      members a commissioner can click to DM — but notify nobody, even if the content
//      contains @everyone. Discord only fires notifications for armed mentions.
//
// Input: {"channel": "admin-chat", "messages": ["...", "..."]} — each string becomes
// one message (Discord caps content at 2000 chars; callers chunk accordingly).
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

const STAFF_CATEGORIES = new Set(['ADMIN', 'RACE CONTROL'])
const CHAN_CATEGORY = 4
const MAX_MESSAGES = 5
const MAX_LEN = 2000

interface Channel { id: string; name?: string | null; type: number; parent_id?: string | null }

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

    let channelName = ''
    let messages: string[] = []
    try {
      const b = await req.json() as { channel?: unknown; messages?: unknown }
      channelName = String(b.channel ?? '').trim().replace(/^#/, '')
      if (Array.isArray(b.messages)) messages = b.messages.map(String)
    } catch { /* handled below */ }
    if (!channelName || !messages.length) {
      return json({ error: 'Body must be {"channel": "admin-chat", "messages": ["..."]}.' }, 400)
    }
    if (messages.length > MAX_MESSAGES) {
      return json({ error: `At most ${MAX_MESSAGES} messages per call — this is a note-passer, not a firehose.` }, 400)
    }
    const tooLong = messages.findIndex((m) => m.length > MAX_LEN)
    if (tooLong >= 0) return json({ error: `Message ${tooLong + 1} is over Discord's ${MAX_LEN}-character limit.` }, 400)

    const db = createClient(url, service)
    const { data: cfg } = await db.from('discord_config').select('enabled, guild_id').eq('id', 1).maybeSingle()
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    const guildId = String(cfg.guild_id ?? '').trim()

    const chRes = await fetch(`${DISCORD}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${botToken}` },
    })
    if (!chRes.ok) return json({ error: `Could not read the server's channels (${chRes.status}).` }, 502)
    const channels = await chRes.json() as Channel[]
    const target = channels.find((c) => c.type !== CHAN_CATEGORY && (c.name ?? '') === channelName)
    if (!target) return json({ error: `No channel named #${channelName} exists.` }, 404)

    const parent = channels.find((c) => c.type === CHAN_CATEGORY && String(c.id) === String(target.parent_id ?? ''))
    if (!parent || !STAFF_CATEGORIES.has((parent.name ?? '').toUpperCase())) {
      return json({
        error: `#${channelName} is not in a staff category (${[...STAFF_CATEGORIES].join(', ')}), so this ` +
          'function will not post there. Member-facing announcements go through the outbox, with its dedupe ' +
          'and ping rules — not through here.',
      }, 403)
    }

    const posted: string[] = []
    for (const content of messages) {
      const res = await fetch(`${DISCORD}/channels/${target.id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
        // parse: [] — mentions render and are clickable, but nobody is notified.
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      })
      const data = await res.json().catch(() => null) as { id?: string; message?: string } | null
      if (!res.ok) {
        return json({ error: `Posted ${posted.length} of ${messages.length}, then Discord refused: ${data?.message ?? res.status}`, posted }, 502)
      }
      posted.push(String(data?.id ?? ''))
    }

    return json({ ok: true, channel: `#${channelName}`, posted })
  } catch (e) {
    return json({ error: `discord-say failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
