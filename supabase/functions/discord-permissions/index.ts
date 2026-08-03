// discord-permissions — makes the LEAGUE category readable by every League Member,
// and turns the results forum into a read-and-reply room rather than a free-for-all.
//
// Two separate jobs, because they are two separate Discord concepts:
//
//   1. VISIBILITY. Channels inherit from their category unless something overrides
//      them, so the fix for "members can't see #announcements" is to guarantee the
//      LEAGUE category allows League Member to view, AND that no child channel is
//      quietly overriding that with a deny of its own. A channel-level deny beats a
//      category-level allow, and it is invisible unless you go looking.
//
//   2. THE FORUM. In a forum channel Discord splits posting in two:
//        SEND_MESSAGES           = "Create Posts"        (start a new thread)
//        SEND_MESSAGES_IN_THREADS = "Send Messages in Posts" (reply in one)
//      They read like the same permission and are not. Denying the first while
//      allowing the second is exactly "reply to the bot's race reports, don't open
//      your own" — and it is the only combination that produces that.
//
// STAFF AND THE BOT ARE EXPLICITLY RE-ALLOWED. Discord resolves role overwrites by
// OR-ing every deny from every role the member holds, then every allow. So a
// commissioner who also holds League Member would inherit that deny and lose the
// ability to open a post. Administrator bypasses overwrites, which papers over it
// today — but the plan is to take Administrator off this bot, and on that day the
// automation would silently stop being able to post race results. Allowing them
// here means the deny is scoped to exactly who it is meant for.
//
// Every write is a merge, never a replacement: the existing allow/deny bitfields for
// a target are read first and only the bits this function has an opinion about are
// changed. Anything somebody set by hand for another reason survives.
//
// Dry run unless the caller sends {"dryRun": false}.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs Manage Roles (to edit channel overwrites) and Manage Channels.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const SNOWFLAKE = /^\d{5,25}$/
const CHAN_CATEGORY = 4
const CHAN_FORUM = 15
const LEAGUE_CATEGORY = 'LEAGUE'
// Named apart from the staff #race-control so the two are never confused.
const RC_ANNOUNCE_NAME = 'race-control-announcements'
const OVERWRITE_ROLE = 0

// Discord permission bits. Named rather than inlined because a wrong bit here is a
// silent, invisible wrong answer — nothing errors, the permission is just not what
// anybody thought.
const P = {
  ADD_REACTIONS:            1n << 6n,
  VIEW_CHANNEL:             1n << 10n,
  SEND_MESSAGES:            1n << 11n,   // in a FORUM this is "Create Posts"
  EMBED_LINKS:              1n << 14n,
  ATTACH_FILES:             1n << 15n,
  READ_MESSAGE_HISTORY:     1n << 16n,
  USE_EXTERNAL_EMOJIS:      1n << 18n,
  CREATE_PUBLIC_THREADS:    1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,   // in a FORUM this is "Send Messages in Posts"
}

/** What a League Member should be able to do in the results forum. */
const FORUM_MEMBER_ALLOW =
  P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY | P.SEND_MESSAGES_IN_THREADS |
  P.ADD_REACTIONS | P.EMBED_LINKS | P.ATTACH_FILES | P.USE_EXTERNAL_EMOJIS
/** …and what they should not: starting their own posts, by either route. */
const FORUM_MEMBER_DENY = P.SEND_MESSAGES | P.CREATE_PUBLIC_THREADS

/**
 * Read-only for members: see it, read the history, react. Reactions are not
 * messages, and an announcement channel where nobody can even acknowledge a
 * promotion is needlessly cold.
 */
const READ_ONLY_ALLOW = P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY | P.ADD_REACTIONS | P.USE_EXTERNAL_EMOJIS
const READ_ONLY_DENY = P.SEND_MESSAGES | P.SEND_MESSAGES_IN_THREADS | P.CREATE_PUBLIC_THREADS

/** Staff and the bot keep the ability to open posts. */
const FORUM_STAFF_ALLOW = P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY | P.SEND_MESSAGES |
  P.SEND_MESSAGES_IN_THREADS | P.CREATE_PUBLIC_THREADS | P.EMBED_LINKS | P.ATTACH_FILES

interface Overwrite { id: string; type: number; allow: string; deny: string }
interface Channel {
  id: string
  name?: string | null
  type: number
  parent_id?: string | null
  permission_overwrites?: Overwrite[] | null
}
interface Member { roles?: string[] | null }
interface Role { id: string; managed?: boolean | null }

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

async function discord<T>(
  path: string, method: 'GET' | 'PUT' | 'POST', token: string, body?: unknown, attempt = 0,
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

const badToken = 'Discord rejected the bot token — check the DISCORD_BOT_TOKEN secret in Supabase.'
const big = (v: unknown) => { try { return BigInt(String(v ?? '0') || '0') } catch { return 0n } }

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

/** Human-readable list of the permission names in a bitfield, for the report. */
function names(bits: bigint): string[] {
  return Object.entries(P).filter(([, b]) => (bits & b) === b).map(([n]) => n)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

    let dryRun = true
    try {
      const body = await req.json()
      if (body && typeof body === 'object' && (body as { dryRun?: unknown }).dryRun === false) dryRun = false
    } catch (_) { /* safe default */ }

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
    const { data: cfgRow } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    const cfg = (cfgRow ?? null) as Record<string, unknown> | null
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    const guildId = String(cfg.guild_id ?? '').trim()
    if (!guildId) return json({ skipped: 'No Discord server is configured yet.' })
    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    const memberRole = String(cfg.role_league_member ?? '').trim()
    const adminRole = String(cfg.role_site_admin ?? '').trim()
    const rcRole = String(cfg.role_site_race_control ?? '').trim()
    const forumId = String(cfg.channel_results ?? '').trim()
    if (!SNOWFLAKE.test(memberRole)) {
      return json({ error: 'No League Member role is configured, so there is nobody to grant this to.' }, 400)
    }

    const warnings: string[] = []

    // The bot's own managed role, so the automation keeps its ability to open forum
    // posts once Administrator is taken away.
    let botRole = ''
    {
      const me = await discord<{ id: string }>('/users/@me', 'GET', botToken)
      if (!me.ok) {
        if (me.status === 401) return json({ error: badToken }, 400)
        return json({ error: `Could not identify the bot — ${me.message}` }, 502)
      }
      const mem = await discord<Member>(`/guilds/${guildId}/members/${String(me.data?.id)}`, 'GET', botToken)
      const roles = await discord<Role[]>(`/guilds/${guildId}/roles`, 'GET', botToken)
      if (mem.ok && roles.ok) {
        const managed = new Set((roles.data ?? []).filter((r) => r.managed).map((r) => String(r.id)))
        botRole = (mem.data?.roles ?? []).map(String).find((r) => managed.has(r)) ?? ''
      }
      if (!botRole) warnings.push("Could not find the bot's own role, so it was not explicitly allowed to open forum posts. It can still post while it holds Administrator — but grant it Create Posts on the results forum before you take Administrator away.")
    }

    const chRes = await discord<Channel[]>(`/guilds/${guildId}/channels`, 'GET', botToken)
    if (!chRes.ok) {
      if (chRes.status === 401) return json({ error: badToken }, 400)
      return json({ error: `Could not read the server's channels — ${chRes.message}. Nothing was changed.` }, 502)
    }
    const channels = (chRes.data ?? []).filter((c) => c && SNOWFLAKE.test(String(c.id)))
    const league = channels.find((c) => c.type === CHAN_CATEGORY && String(c.name ?? '') === LEAGUE_CATEGORY)
    if (!league) return json({ error: `No category named ${LEAGUE_CATEGORY} exists in this server.` }, 404)
    const children = channels.filter((c) => String(c.parent_id ?? '') === String(league.id))

    const planned: { channel: string; target: string; add: string[]; remove: string[] }[] = []
    const applied: string[] = []
    const created: string[] = []

    /**
     * Merge a set of allow/deny bits into whatever overwrite already exists.
     * Returns false when nothing needed changing, so an idempotent re-run is silent.
     */
    const setPerms = async (
      ch: Channel, targetId: string, targetLabel: string, allowBits: bigint, denyBits: bigint,
    ): Promise<void> => {
      if (!SNOWFLAKE.test(targetId)) return
      const existing = (ch.permission_overwrites ?? []).find((o) => String(o.id) === targetId)
      const curAllow = big(existing?.allow)
      const curDeny = big(existing?.deny)
      // A bit can't be in both fields; setting one clears it from the other.
      const nextAllow = (curAllow | allowBits) & ~denyBits
      const nextDeny = (curDeny | denyBits) & ~allowBits
      if (nextAllow === curAllow && nextDeny === curDeny) return // already right

      planned.push({
        channel: String(ch.name ?? ch.id),
        target: targetLabel,
        add: names(nextAllow & ~curAllow),
        remove: names(nextDeny & ~curDeny),
      })
      if (dryRun) return

      const res = await discord(
        `/channels/${ch.id}/permissions/${targetId}`, 'PUT', botToken,
        { type: OVERWRITE_ROLE, allow: nextAllow.toString(), deny: nextDeny.toString() },
      )
      if (res.ok) applied.push(`${ch.name} · ${targetLabel}`)
      else warnings.push(`Could not update ${targetLabel} on #${ch.name} — ${res.message}`)
    }

    // --- 1. the category: League Member can see LEAGUE ---
    await setPerms(league, memberRole, 'League Member', P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY, 0n)

    // --- 2. no child may quietly override that ---
    // Only ever clears a DENY of view/history for League Member. It does not grant
    // anything a channel hasn't already inherited, so a deliberately private channel
    // inside LEAGUE stays private unless its denial is on this specific role.
    for (const ch of children) {
      const ow = (ch.permission_overwrites ?? []).find((o) => String(o.id) === memberRole)
      const deny = big(ow?.deny)
      if ((deny & (P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY)) !== 0n) {
        await setPerms(ch, memberRole, 'League Member', P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY, 0n)
      }
    }

    // --- 3. the results forum: reply, don't post ---
    const forum = children.find((c) => String(c.id) === forumId)
      ?? children.find((c) => c.type === CHAN_FORUM)
    if (!forum) {
      warnings.push('No forum channel was found in LEAGUE, so the reply-only rule was not applied to anything.')
    } else {
      if (forum.type !== CHAN_FORUM) {
        warnings.push(`#${forum.name} is not a forum channel, so "reply but don't create posts" does not apply to it the same way. Left alone.`)
      } else {
        await setPerms(forum, memberRole, 'League Member', FORUM_MEMBER_ALLOW, FORUM_MEMBER_DENY)
        // Staff and the bot must not inherit that deny through League Member.
        for (const [rid, label] of [[adminRole, 'Admin'], [rcRole, 'Race Control'], [botRole, 'HCR Bot']] as const) {
          if (SNOWFLAKE.test(rid)) await setPerms(forum, rid, label, FORUM_STAFF_ALLOW, 0n)
        }
      }
    }

    // --- 4. #license-ups: visible to members, read-only ---
    // It lives in the staff category, so members cannot see it at all by
    // inheritance. A channel that exists to celebrate drivers is worth nothing if
    // the drivers can't see it — but it is written by automation, so nobody except
    // the bot should be posting into it.
    const licenseUps = channels.find((c) => String(c.id) === String(cfg.channel_license_ups ?? '').trim())
    if (!licenseUps) {
      warnings.push('No #license-ups channel is configured, so licence promotions were not opened up to members.')
    } else {
      await setPerms(licenseUps, memberRole, 'League Member', READ_ONLY_ALLOW, READ_ONLY_DENY)
      for (const [rid, label] of [[adminRole, 'Admin'], [rcRole, 'Race Control'], [botRole, 'HCR Bot']] as const) {
        if (SNOWFLAKE.test(rid)) await setPerms(licenseUps, rid, label, FORUM_STAFF_ALLOW, 0n)
      }
    }

    // --- 5. #race-control-announcements: where stewarding decisions are published ---
    // Deliberately in LEAGUE, not RACE CONTROL. The staff channel is where a call is
    // argued out; this is where the answer is published, and the people it concerns
    // have to be able to read it.
    let rcChannel = channels.find((c) => String(c.id) === String(cfg.channel_race_control ?? '').trim())
      ?? children.find((c) => String(c.name ?? '') === RC_ANNOUNCE_NAME)
    if (!rcChannel && !dryRun) {
      const made = await discord<Channel>(`/guilds/${guildId}/channels`, 'POST', botToken, {
        name: RC_ANNOUNCE_NAME,
        type: 0,
        parent_id: league.id,
        topic: 'Stewarding decisions: protest outcomes and penalties. Published by race control — discussion goes in the protest thread.',
      })
      if (made.ok && made.data?.id) {
        rcChannel = made.data
        created.push(RC_ANNOUNCE_NAME)
      } else if (!made.ok) {
        warnings.push(`Could not create #${RC_ANNOUNCE_NAME} — ${made.message}`)
      }
    } else if (!rcChannel && dryRun) {
      planned.push({ channel: RC_ANNOUNCE_NAME, target: '(channel)', add: ['CREATE in LEAGUE'], remove: [] })
    }

    if (rcChannel) {
      await setPerms(rcChannel, memberRole, 'League Member', READ_ONLY_ALLOW, READ_ONLY_DENY)
      for (const [rid, label] of [[adminRole, 'Admin'], [rcRole, 'Race Control'], [botRole, 'HCR Bot']] as const) {
        if (SNOWFLAKE.test(rid)) await setPerms(rcChannel, rid, label, FORUM_STAFF_ALLOW, 0n)
      }
      if (!dryRun && String(cfg.channel_race_control ?? '') !== String(rcChannel.id)) {
        const { error } = await db.from('discord_config')
          .update({ channel_race_control: String(rcChannel.id), updated_at: new Date().toISOString() }).eq('id', 1)
        if (error) warnings.push(`Created the channel but could not save its id — ${error.message}`)
      }
    }

    return json({
      ok: warnings.length === 0,
      dryRun,
      created,
      license_ups: licenseUps?.name ?? null,
      race_control_announcements: rcChannel?.name ?? null,
      league_category: league.name,
      channels_in_league: children.map((c) => c.name),
      forum: forum?.name ?? null,
      planned,
      applied: dryRun ? null : applied,
      warnings,
    })
  } catch (e) {
    return json({ error: `Permission update failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
