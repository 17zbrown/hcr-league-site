// discord-membership — keeps #welcome announcing joins, and reports departures to a
// staff-only channel.
//
// TWO DIFFERENT MECHANISMS, because Discord treats the two events very differently:
//
//   JOINS are native. Discord posts "X joined the server" into whichever channel is
//   set as the guild's system channel, instantly, with no bot listening. This
//   function's only job there is to point that setting at #welcome and make sure the
//   join flag is not suppressed — after which Discord does it forever, for free, and
//   faster than anything we could poll.
//
//   DEPARTURES are not announced by Discord at all, to any channel, ever. Seeing one
//   as it happens needs a gateway connection, which this stack does not have. So the
//   member list is rolled and diffed: anyone on the previous roll and absent from
//   this one has gone. That is a POLL — late by up to the cron interval, and unable
//   to distinguish left / kicked / banned. It is the honest ceiling without a
//   persistent bot, and it beats not noticing.
//
// The first run seeds the roll and announces nothing, because on an empty table
// every one of sixty members would look like a new arrival.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const MEMBER_PAGE = 1000
const MAX_PAGES = 5
// Discord's system_channel_flags: bit 0 suppresses the join message. Clearing it is
// what turns "X joined the server" back on.
const SUPPRESS_JOIN_NOTIFICATIONS = 1 << 0

const VIEW_CHANNEL = 1n << 10n

interface Member {
  user?: { id?: string | null; username?: string | null; bot?: boolean | null } | null
  nick?: string | null
  joined_at?: string | null
}

interface Overwrite { id: string; type: number; allow?: string | null; deny?: string | null }
/** An overwrite with both bitfields settled, ready to send to Discord. */
interface FullOverwrite { id: string; type: number; allow: string; deny: string }
interface Channel {
  id: string
  name?: string | null
  type: number
  parent_id?: string | null
  permission_overwrites?: Overwrite[] | null
}

/**
 * The rules #member-departures should carry: a copy of ADMIN's, with @everyone
 * denied view on top.
 *
 * Sending permission_overwrites when creating a channel opts OUT of category
 * sync — Discord computes access from the channel's own list and never consults
 * the parent. So an @everyone deny on its own would hide the channel from every
 * staff role that is not a full Administrator, which is the opposite of the
 * point. The category's allows have to be copied across explicitly.
 */
function departureOverwrites(cat: Channel, guildId: string): FullOverwrite[] {
  const out = (cat.permission_overwrites ?? []).map((o) => ({
    id: String(o.id),
    type: Number(o.type ?? 0),
    allow: String(o.allow ?? '0'),
    deny: String(o.deny ?? '0'),
  }))
  const everyone = out.find((o) => o.id === guildId)
  if (everyone) {
    everyone.allow = String(BigInt(everyone.allow) & ~VIEW_CHANNEL)
    everyone.deny = String(BigInt(everyone.deny) | VIEW_CHANNEL)
  } else {
    out.push({ id: guildId, type: 0, allow: '0', deny: String(VIEW_CHANNEL) })
  }
  return out
}

async function discord(path: string, method: string, token: string, body?: unknown) {
  const res = await fetch(`${DISCORD}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: unknown = null
  try { parsed = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, data: parsed,
           message: (parsed as { message?: string } | null)?.message ?? text.slice(0, 200) }
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
    const { data: cfg } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    const guildId = String(cfg.guild_id ?? '').trim()
    if (!guildId || !botToken) return json({ error: 'Guild id or bot token missing.' }, 400)

    const warnings: string[] = []
    const applied: string[] = []

    // --- joins: point Discord's own welcome message at #welcome -------------------
    const chans = await discord(`/guilds/${guildId}/channels`, 'GET', botToken)
    const channels = (chans.ok ? (chans.data as Channel[]) : []) ?? []
    const welcome = channels.find((c) => (c.name ?? '') === 'welcome' && c.type === 0)

    const g = await discord(`/guilds/${guildId}`, 'GET', botToken)
    if (!g.ok) return json({ error: `Could not read the guild — ${g.message}` }, 502)
    const guild = g.data as { system_channel_id?: string | null; system_channel_flags?: number }
    const flags = Number(guild.system_channel_flags ?? 0)
    const joinsSuppressed = (flags & SUPPRESS_JOIN_NOTIFICATIONS) !== 0
    const wrongChannel = welcome && String(guild.system_channel_id ?? '') !== String(welcome.id)

    if (welcome && (wrongChannel || joinsSuppressed)) {
      const patch = await discord(`/guilds/${guildId}`, 'PATCH', botToken, {
        system_channel_id: welcome.id,
        system_channel_flags: flags & ~SUPPRESS_JOIN_NOTIFICATIONS,
      })
      if (patch.ok) applied.push('#welcome now receives Discord’s join messages')
      else warnings.push(`Could not point join messages at #welcome — ${patch.message}`)
    } else if (!welcome) {
      warnings.push('No #welcome channel found, so join messages were not configured.')
    }

    // --- the departures channel, owned by the thing that writes to it --------------
    // It carries its own @everyone DENY rather than relying on ADMIN's: a channel
    // listing who has walked out should not be one mis-set category rule away from
    // public.
    const adminCat = channels.find((c) => c.type === 4 && (c.name ?? '').toUpperCase() === 'ADMIN')
    let departures = String(cfg.channel_departures ?? '').trim()
      ? channels.find((c) => String(c.id) === String(cfg.channel_departures))
      : undefined
    departures ??= channels.find((c) => c.type === 0 && (c.name ?? '') === 'member-departures')
    if (!departures && adminCat) {
      const made = await discord(`/guilds/${guildId}/channels`, 'POST', botToken, {
        name: 'member-departures',
        type: 0,
        parent_id: adminCat.id,
        topic: 'Members who have left the server, noticed by a periodic check. Staff only.',
        permission_overwrites: departureOverwrites(adminCat, guildId),
      })
      if (made.ok) {
        departures = made.data as Channel
        applied.push('created #member-departures in ADMIN (staff only)')
      } else warnings.push(`Could not create #member-departures — ${made.message}`)
    } else if (!departures && !adminCat) {
      warnings.push('No ADMIN category found, so #member-departures was not created.')
    }

    // Reconcile the rules every run, additively: any role ADMIN grants gets the same
    // grant here, and @everyone stays denied. Only ids ADMIN mentions are touched, so
    // an extra overwrite added by hand in Discord survives untouched.
    if (departures && adminCat) {
      const have = new Map((departures.permission_overwrites ?? []).map((o) => [String(o.id), o]))
      for (const want of departureOverwrites(adminCat, guildId)) {
        const got = have.get(want.id)
        if (got && BigInt(got.allow ?? '0') === BigInt(want.allow) && BigInt(got.deny ?? '0') === BigInt(want.deny)) continue
        const res = await discord(`/channels/${departures.id}/permissions/${want.id}`, 'PUT', botToken, {
          type: want.type, allow: want.allow, deny: want.deny,
        })
        if (res.ok) {
          applied.push(want.id === guildId
            ? '#member-departures: @everyone denied view'
            : `#member-departures: matched ADMIN’s access for ${want.id}`)
        } else warnings.push(`Could not set #member-departures permissions for ${want.id} — ${res.message}`)
      }
    }

    if (departures && String(cfg.channel_departures ?? '') !== String(departures.id)) {
      const { error } = await db.from('discord_config')
        .update({ channel_departures: String(departures.id), updated_at: new Date().toISOString() }).eq('id', 1)
      if (error) warnings.push(`#member-departures exists but its id could not be saved — ${error.message}`)
      else applied.push('departure reports now route to #member-departures')
    }

    // --- departures: roll the member list and diff --------------------------------
    const seen = new Map<string, { username: string; nick: string | null; joined: string | null }>()
    let after = '0'
    let pages = 0
    let complete = false
    while (pages < MAX_PAGES) {
      const res = await discord(`/guilds/${guildId}/members?limit=${MEMBER_PAGE}&after=${after}`, 'GET', botToken)
      if (!res.ok) {
        return json({
          error: res.status === 403
            ? 'Discord refused the member list (403) — enable the Server Members Intent for the bot.'
            : `Could not read members — ${res.message}`,
          applied, warnings,
        }, 502)
      }
      const batch = (res.data as Member[]) ?? []
      pages++
      for (const m of batch) {
        const id = String(m?.user?.id ?? '').trim()
        if (!id || m?.user?.bot) continue // software neither joins nor leaves
        seen.set(id, {
          username: String(m.user?.username ?? ''),
          nick: m.nick ?? null,
          joined: m.joined_at ?? null,
        })
      }
      if (batch.length < MEMBER_PAGE) { complete = true; break }
      after = String(batch[batch.length - 1]?.user?.id ?? '')
      if (!after) { complete = true; break }
    }

    // A partial roll would read as a mass exodus. Refuse to diff one.
    if (!complete) {
      return json({
        error: `Only ${seen.size} members were read before the page cap, so the roll is incomplete and was not diffed — nothing would distinguish an unread page from a departure.`,
        applied, warnings,
      }, 502)
    }

    const { data: previous } = await db.from('discord_members').select('user_id, username, nickname, left_seen_at')
    const known = new Map(((previous ?? []) as { user_id: string; username: string | null; nickname: string | null; left_seen_at: string | null }[])
      .map((r) => [r.user_id, r]))
    const firstRun = known.size === 0

    const now = new Date().toISOString()
    const rows = [...seen.entries()].map(([id, m]) => ({
      user_id: id, username: m.username, nickname: m.nick, joined_at: m.joined,
      last_seen: now, left_seen_at: null, announced_departure: false,
    }))
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('discord_members').upsert(rows.slice(i, i + 500), { onConflict: 'user_id' })
      if (error) warnings.push(`Part of the roll could not be saved — ${error.message}`)
    }

    const gone = [...known.values()].filter((r) => !seen.has(r.user_id) && !r.left_seen_at)
    if (gone.length) {
      await db.from('discord_members')
        .update({ left_seen_at: now })
        .in('user_id', gone.map((g) => g.user_id))
    }

    // The first run has nothing to compare against; announcing then would report the
    // whole server as arrivals and departures at once.
    if (firstRun) {
      return json({ ok: true, seeded: rows.length, announced: 0, applied, warnings,
                    message: 'First run — the roll was seeded and nothing was announced.' })
    }

    const departuresChannel = String(departures?.id ?? '')
    let announced = 0
    if (gone.length && departuresChannel) {
      const lines = gone.map((g) => `• **${g.nickname || g.username || g.user_id}** (\`${g.user_id}\`)`)
      const res = await discord(`/channels/${departuresChannel}/messages`, 'POST', botToken, {
        embeds: [{
          title: gone.length === 1 ? 'A member left the server' : `${gone.length} members left the server`,
          description: lines.join('\n'),
          color: 0xc62430,
          footer: {
            text: 'Noticed by a periodic check, so this may be up to an hour after they left. ' +
                  'Discord does not say whether someone left, was kicked or was banned.',
          },
        }],
      })
      if (res.ok) announced = gone.length
      else warnings.push(`Could not post departures — ${res.message}`)
      if (announced) {
        await db.from('discord_members')
          .update({ announced_departure: true })
          .in('user_id', gone.map((g) => g.user_id))
      }
    } else if (gone.length && !departuresChannel) {
      warnings.push(`${gone.length} member(s) left but no departures channel is configured.`)
    }

    return json({ ok: warnings.length === 0, members: rows.length, departures: gone.length, announced, applied, warnings })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
