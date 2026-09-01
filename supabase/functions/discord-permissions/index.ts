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
const RACE_CONTROL_CATEGORY = 'RACE CONTROL'
// Named apart from the staff #race-control so the two are never confused.
const RC_ANNOUNCE_NAME = 'race-control-announcements'
// The one room in RACE CONTROL that members WRITE in. See section 6.
const RECS_NAME = 'league-recommendations'
const WELCOME_NAME = 'welcome'
/** Where the grid answers "are you racing". Section 8. */
const ATTEND_NAME = 'race-attendance'
const CHAN_TEXT = 0

/**
 * Discord's own join spam, switched off at the guild level. These are the grey
 * "X joined the server" lines and their sticker replies — system messages, not
 * anything the bot posts, so no permission can suppress them and deleting them one
 * by one is the chore this replaces.
 *
 *   1 = SUPPRESS_JOIN_NOTIFICATIONS
 *   4 = SUPPRESS_GUILD_REMINDER_NOTIFICATIONS  (the "set up your server" tips)
 *   8 = SUPPRESS_JOIN_NOTIFICATION_REPLIES     (the sticker/wave replies)
 */
const SYSTEM_SUPPRESS_JOIN = 1 | 4 | 8
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

/**
 * #welcome is READ-ONLY for everyone but the bot.
 *
 * It is the one channel a brand-new arrival is guaranteed to see, so it must stay
 * VIEWABLE — discord-gate-setup deliberately forces it open for exactly that reason,
 * and a deny of VIEW_CHANNEL here would fight it every run. What changes is that
 * nobody can type in it: the welcome post is the only thing in the room.
 */
const WELCOME_MEMBER_ALLOW = P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY | P.ADD_REACTIONS | P.USE_EXTERNAL_EMOJIS
const WELCOME_MEMBER_DENY =
  P.SEND_MESSAGES | P.SEND_MESSAGES_IN_THREADS | P.CREATE_PUBLIC_THREADS | P.ATTACH_FILES | P.EMBED_LINKS

/** Staff and the bot keep the ability to open posts. */
const FORUM_STAFF_ALLOW = P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY | P.SEND_MESSAGES |
  P.SEND_MESSAGES_IN_THREADS | P.CREATE_PUBLIC_THREADS | P.EMBED_LINKS | P.ATTACH_FILES

/**
 * The recommendations forum is the EXACT OPPOSITE of the results forum.
 *
 * There, members reply and may not open posts. Here, opening a post IS the feature —
 * a suggestion nobody can start is not a suggestion box. So SEND_MESSAGES ("Create
 * Posts" in a forum) is allowed rather than denied, and that one bit is the whole
 * difference between the two rooms.
 */
const RECS_MEMBER_ALLOW =
  P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY | P.SEND_MESSAGES | P.SEND_MESSAGES_IN_THREADS |
  P.ADD_REACTIONS | P.EMBED_LINKS | P.ATTACH_FILES | P.USE_EXTERNAL_EMOJIS

interface Overwrite { id: string; type: number; allow: string; deny: string }
interface Channel {
  id: string
  name?: string | null
  type: number
  position?: number | null
  parent_id?: string | null
  permission_overwrites?: Overwrite[] | null
}
interface Member { roles?: string[] | null }
interface Role { id: string; managed?: boolean | null }

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

async function discord<T>(
  path: string, method: 'GET' | 'PUT' | 'POST' | 'PATCH', token: string, body?: unknown, attempt = 0,
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

    // WHO IS "A MEMBER"? The configured League Member role if one exists — and
    // @everyone when it does not, which is this server's actual state: the reorg
    // deleted the role, role_league_member has been empty ever since, and sections
    // 1-5 silently skipped for weeks. The cost of that skip was not cosmetic:
    // nothing asserted that members can read #race-control-announcements (where
    // penalties and rulings publish) or #license-ups, and nothing enforced
    // reply-only on the results forum. @everyone's role id is the guild id — a
    // Discord invariant — and every rule below is exactly the "all members" rule
    // under either identity. Sections 6-8 already work this way.
    const cfgMemberRole = String(cfg.role_league_member ?? '').trim()
    const usingEveryone = !SNOWFLAKE.test(cfgMemberRole)
    const memberRole = usingEveryone ? guildId : cfgMemberRole
    const memberLabel = usingEveryone ? '@everyone' : 'League Member'
    const adminRole = String(cfg.role_site_admin ?? '').trim()
    const rcRole = String(cfg.role_site_race_control ?? '').trim()
    const forumId = String(cfg.channel_results ?? '').trim()

    const warnings: string[] = []

    /**
     * A MISSING League Member role SKIPS sections 1-5; it no longer kills the run.
     *
     * There is no such role in this server any more — the reorg left Admin,
     * RaceControl, the three class roles, the licence roles and Spectator, and
     * discord_config.role_league_member has been empty ever since. This function
     * therefore returned 400 and did nothing at all, silently, for every job it owns.
     *
     * Sections 1-5 genuinely cannot run without knowing who "a member" is, so they
     * are skipped rather than guessed at — nothing dormant is re-enabled by this
     * change. Section 6 does not need the role: a suggestion box open to "all
     * members" is @everyone, whose role id is the guild id.
     */
    if (usingEveryone) {
      warnings.push(
        'No League Member role is configured, so the member-facing rules in sections 1-5 were applied to ' +
        '@everyone instead of being skipped. Configure role_league_member to scope them to a role again.',
      )
    }

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
      if (!botRole) warnings.push("Could not find the bot's own role, so it was not explicitly allowed to post. It can still post while it holds Administrator — but grant it Send Messages on these channels before you take Administrator away.")
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
    await setPerms(league, memberRole, memberLabel, P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY, 0n)

    // --- 2. no child may quietly override that ---
    // Only ever clears a DENY of view/history for League Member. It does not grant
    // anything a channel hasn't already inherited, so a deliberately private channel
    // inside LEAGUE stays private unless its denial is on this specific role.
    for (const ch of children) {
      const ow = (ch.permission_overwrites ?? []).find((o) => String(o.id) === memberRole)
      const deny = big(ow?.deny)
      if ((deny & (P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY)) !== 0n) {
        await setPerms(ch, memberRole, memberLabel, P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY, 0n)
      }
    }

    // --- 3. the results forum: reply, don't post ---
    // Found by its CONFIGURED ID across the whole server, not by hunting LEAGUE:
    // the topology decision of 1 Sep keeps it in RACE CONTROL, and the old
    // LEAGUE-only search made this whole section a silent no-op there.
    const forum = channels.find((c) => String(c.id) === forumId)
      ?? children.find((c) => c.type === CHAN_FORUM)
    if (!forum) {
      warnings.push('No results forum was found (channel_results unset and no forum in LEAGUE), so the reply-only rule was not applied.')
    } else {
      if (forum.type !== CHAN_FORUM) {
        warnings.push(`#${forum.name} is not a forum channel, so "reply but don't create posts" does not apply to it the same way. Left alone.`)
      } else {
        await setPerms(forum, memberRole, memberLabel, FORUM_MEMBER_ALLOW, FORUM_MEMBER_DENY)
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
      await setPerms(licenseUps, memberRole, memberLabel, READ_ONLY_ALLOW, READ_ONLY_DENY)
      for (const [rid, label] of [[adminRole, 'Admin'], [rcRole, 'Race Control'], [botRole, 'HCR Bot']] as const) {
        if (SNOWFLAKE.test(rid)) await setPerms(licenseUps, rid, label, FORUM_STAFF_ALLOW, 0n)
      }
    }

    // --- 5. #race-control-announcements: where stewarding decisions are published ---
    // Lives in RACE CONTROL, alongside #license-ups. That category is private, so
    // the channel is only visible to members because of the explicit League Member
    // overwrite applied below — a channel-level allow beats a category-level deny.
    // Remove that overwrite and the channel silently disappears for everyone it was
    // meant for, which is exactly how #license-ups came to be invisible.
    const raceControlCat = channels.find(
      (c) => c.type === CHAN_CATEGORY && String(c.name ?? '') === RACE_CONTROL_CATEGORY,
    )
    if (!raceControlCat) warnings.push(`No ${RACE_CONTROL_CATEGORY} category exists, so the announcements channel could not be placed next to #license-ups.`)

    // Found by id, else by name anywhere in the server — it may be sitting in the
    // wrong category, which is the case this block exists to correct.
    let rcChannel = channels.find((c) => String(c.id) === String(cfg.channel_race_control ?? '').trim())
      ?? channels.find((c) => String(c.name ?? '') === RC_ANNOUNCE_NAME && c.type !== CHAN_CATEGORY)

    if (!rcChannel && !dryRun && raceControlCat) {
      const made = await discord<Channel>(`/guilds/${guildId}/channels`, 'POST', botToken, {
        name: RC_ANNOUNCE_NAME,
        type: 0,
        parent_id: raceControlCat.id,
        topic: 'Stewarding decisions: protest outcomes and penalties. Published by race control — discussion goes in the protest thread.',
      })
      if (made.ok && made.data?.id) { rcChannel = made.data; created.push(RC_ANNOUNCE_NAME) }
      else if (!made.ok) warnings.push(`Could not create #${RC_ANNOUNCE_NAME} — ${made.message}`)
    } else if (!rcChannel && dryRun) {
      planned.push({ channel: RC_ANNOUNCE_NAME, target: '(channel)', add: [`CREATE in ${RACE_CONTROL_CATEGORY}`], remove: [] })
    }

    // Already exists but in the wrong category: move it, and sit it directly after
    // #license-ups.
    //
    // lock_permissions is deliberately NOT sent. Setting it true would resync the
    // channel's overwrites to the new category, wiping the League Member allow and
    // making the channel vanish for the very people it is published for. Omitting it
    // keeps the overwrites exactly as they are, which is the whole point of the move
    // being safe.
    if (rcChannel && raceControlCat && String(rcChannel.parent_id ?? '') !== String(raceControlCat.id)) {
      const licencePos = licenseUps?.position
      const body: Record<string, unknown> = { parent_id: raceControlCat.id }
      if (typeof licencePos === 'number') body.position = licencePos + 1
      planned.push({
        channel: RC_ANNOUNCE_NAME, target: '(category)',
        add: [`MOVE to ${RACE_CONTROL_CATEGORY}${typeof licencePos === 'number' ? ' after #license-ups' : ''}`],
        remove: [],
      })
      if (!dryRun) {
        const moved = await discord(`/channels/${rcChannel.id}`, 'PATCH', botToken, body)
        if (moved.ok) applied.push(`${RC_ANNOUNCE_NAME} · moved to ${RACE_CONTROL_CATEGORY}`)
        else warnings.push(`Could not move #${RC_ANNOUNCE_NAME} — ${moved.message}`)
      }
    }

    if (rcChannel) {
      await setPerms(rcChannel, memberRole, memberLabel, READ_ONLY_ALLOW, READ_ONLY_DENY)
      for (const [rid, label] of [[adminRole, 'Admin'], [rcRole, 'Race Control'], [botRole, 'HCR Bot']] as const) {
        if (SNOWFLAKE.test(rid)) await setPerms(rcChannel, rid, label, FORUM_STAFF_ALLOW, 0n)
      }
      if (!dryRun && String(cfg.channel_race_control ?? '') !== String(rcChannel.id)) {
        const { error } = await db.from('discord_config')
          .update({ channel_race_control: String(rcChannel.id), updated_at: new Date().toISOString() }).eq('id', 1)
        if (error) warnings.push(`Created the channel but could not save its id — ${error.message}`)
      }
    }

    // --- 6. #league-recommendations: the one room in RACE CONTROL members write in ---
    //
    // Members submit suggestions to race control and admins here. It sits in RACE
    // CONTROL because that is who answers it, not because it is private — and it is
    // the only channel in that category members can reach, by the same mechanism
    // #race-control-announcements uses: a channel-level League Member allow beating
    // the category-level deny. Every other channel in RACE CONTROL is untouched by
    // this block and stays staff-only.
    //
    // A FORUM rather than a text channel, so each suggestion is its own thread that
    // can be replied to and resolved without three conversations interleaving.
    //
    // Created with parent_id and no overwrites of its own, so Discord copies RACE
    // CONTROL's deny of @everyone onto it at birth. That is deliberate twice over: it
    // is never briefly public between creation and the allow below, and because it
    // then DENIES @everyone, discord-gate-setup leaves it completely alone on every
    // future run instead of re-deciding who may see it.
    let recsChannel = channels.find((c) => String(c.id) === String(cfg.channel_recommendations ?? '').trim())
      ?? channels.find((c) => String(c.name ?? '') === RECS_NAME && c.type !== CHAN_CATEGORY)

    if (!recsChannel && !dryRun && raceControlCat) {
      const made = await discord<Channel>(`/guilds/${guildId}/channels`, 'POST', botToken, {
        name: RECS_NAME,
        type: CHAN_FORUM,
        parent_id: raceControlCat.id,
        topic: 'Suggestions for race control and the admins. Open a post for each idea — format, schedule, rules, the site, anything. Every post is read; not every idea can be adopted, and you will get an answer either way.',
      })
      if (made.ok && made.data?.id) { recsChannel = made.data; created.push(RECS_NAME) }
      else if (!made.ok) warnings.push(`Could not create #${RECS_NAME} — ${made.message}`)
    } else if (!recsChannel && dryRun) {
      planned.push({ channel: RECS_NAME, target: '(channel)', add: [`CREATE forum in ${RACE_CONTROL_CATEGORY}`], remove: [] })
    } else if (!recsChannel && !raceControlCat) {
      warnings.push(`No ${RACE_CONTROL_CATEGORY} category exists, so #${RECS_NAME} could not be created.`)
    }

    // Same move-without-lock_permissions rule as above: resyncing to the parent would
    // wipe the League Member allow and make the suggestion box vanish for everyone
    // meant to use it.
    if (recsChannel && raceControlCat && String(recsChannel.parent_id ?? '') !== String(raceControlCat.id)) {
      planned.push({ channel: RECS_NAME, target: '(category)', add: [`MOVE to ${RACE_CONTROL_CATEGORY}`], remove: [] })
      if (!dryRun) {
        const moved = await discord(`/channels/${recsChannel.id}`, 'PATCH', botToken, { parent_id: raceControlCat.id })
        if (moved.ok) applied.push(`${RECS_NAME} · moved to ${RACE_CONTROL_CATEGORY}`)
        else warnings.push(`Could not move #${RECS_NAME} — ${moved.message}`)
      }
    }

    if (recsChannel) {
      if (recsChannel.type !== CHAN_FORUM) {
        warnings.push(`#${recsChannel.name} exists but is not a forum channel, so suggestions will not thread. Permissions were still applied.`)
      }
      // @EVERYONE, NOT League Member — that role does not exist in this server, and
      // "open to all members" is literally what @everyone means. Its role id IS the
      // guild id, which is a Discord invariant rather than a lucky coincidence.
      //
      // This is the one channel in RACE CONTROL where the category's @everyone deny is
      // overridden. A channel-level allow beats a category-level deny, so the forum is
      // visible and postable to the whole server while every sibling stays staff-only.
      //
      // CAVEAT worth knowing: discord-gate-setup leaves alone any channel that DENIES
      // @everyone and re-gates the rest. This one now allows @everyone, so a future
      // gate-setup run would try to deny it and grant a "Verified" role that no longer
      // exists — which would hide this forum from everybody. Re-run this function
      // afterwards, or teach gate-setup to skip it, before running that one again.
      await setPerms(recsChannel, guildId, '@everyone', RECS_MEMBER_ALLOW, 0n)
      for (const [rid, label] of [[adminRole, 'Admin'], [rcRole, 'Race Control'], [botRole, 'HCR Bot']] as const) {
        if (SNOWFLAKE.test(rid)) await setPerms(recsChannel, rid, label, FORUM_STAFF_ALLOW, 0n)
      }
      if (!dryRun && String(cfg.channel_recommendations ?? '') !== String(recsChannel.id)) {
        const { error } = await db.from('discord_config')
          .update({ channel_recommendations: String(recsChannel.id), updated_at: new Date().toISOString() }).eq('id', 1)
        if (error) warnings.push(`Created #${RECS_NAME} but could not save its id — ${error.message}`)
      }
    }

    // --- 7. #welcome: our announcement only, and nobody types in it ---
    //
    // Two different silences, and they need two different mechanisms.
    //
    // MEMBERS are silenced with a channel overwrite: view and read yes, post no. That
    // is an ordinary permission and merges like every other one here.
    //
    // DISCORD ITSELF is silenced at the guild level. The grey "X joined the server"
    // lines are SYSTEM messages generated by Discord, not posts by anybody, so no
    // channel permission touches them — the only switch is system_channel_flags on
    // the guild. Without this the channel still fills with join spam no matter how
    // locked down it is, which is the half people usually miss.
    const welcome = channels.find((c) => c.type !== CHAN_CATEGORY && String(c.name ?? '') === WELCOME_NAME)
    if (!welcome) {
      warnings.push(`No #${WELCOME_NAME} channel was found, so the read-only rule and the join-spam switch were skipped.`)
    } else {
      await setPerms(welcome, guildId, '@everyone', WELCOME_MEMBER_ALLOW, WELCOME_MEMBER_DENY)
      // The bot and staff keep the ability to post the welcome itself.
      for (const [rid, label] of [[adminRole, 'Admin'], [rcRole, 'Race Control'], [botRole, 'HCR Bot']] as const) {
        if (SNOWFLAKE.test(rid)) await setPerms(welcome, rid, label, FORUM_STAFF_ALLOW, 0n)
      }

      const g = await discord<{ system_channel_id?: string | null; system_channel_flags?: number }>(
        `/guilds/${guildId}`, 'GET', botToken)
      if (!g.ok) {
        warnings.push(`Could not read the server settings, so Discord's own join messages were left on — ${g.message}`)
      } else {
        const curFlags = Number(g.data?.system_channel_flags ?? 0)
        const nextFlags = curFlags | SYSTEM_SUPPRESS_JOIN
        if (nextFlags !== curFlags) {
          planned.push({ channel: '(server settings)', target: 'system_channel_flags',
                         add: [`SUPPRESS_JOIN_NOTIFICATIONS (${curFlags} -> ${nextFlags})`], remove: [] })
          if (!dryRun) {
            const patched = await discord(`/guilds/${guildId}`, 'PATCH', botToken, { system_channel_flags: nextFlags })
            if (patched.ok) applied.push("server \u00b7 Discord's join messages suppressed")
            else warnings.push(`Could not suppress Discord's join messages — ${patched.message}`)
          }
        }
      }
    }

    // --- 7b. the published-information channels in RACE CONTROL stay readable ---
    //
    // Topology decision, 1 Sep: #standings, #race-results and #rulebook live in
    // RACE CONTROL because race control is the league staff and these are what
    // they publish. The category denies @everyone, so each channel needs its own
    // member allow — until now those allows were LEFTOVERS from before the move,
    // guaranteed by nothing. This asserts them every run. Read-only: they are
    // publication surfaces, not conversations.
    for (const name of ['standings', 'race-results', 'rulebook']) {
      const ch = channels.find((c) => c.type !== CHAN_CATEGORY && String(c.name ?? '') === name
        && String(c.parent_id ?? '') === String(raceControlCat?.id ?? ''))
      if (!ch) continue
      if (ch.type === CHAN_FORUM) continue // the results forum has its own rule above
      await setPerms(ch, memberRole, memberLabel, READ_ONLY_ALLOW, READ_ONLY_DENY)
      for (const [rid, label] of [[adminRole, 'Admin'], [rcRole, 'Race Control'], [botRole, 'HCR Bot']] as const) {
        if (SNOWFLAKE.test(rid)) await setPerms(ch, rid, label, FORUM_STAFF_ALLOW, 0n)
      }
    }

    // --- 7c. the uncategorised strays get homes in LEAGUE ---
    //
    // #welcome, #rules and #website have floated outside every category since the
    // reorg dissolved START HERE. Moved (not resynced) into LEAGUE so their own
    // overwrites survive; the layout order puts them at the top.
    if (league) {
      for (const name of [WELCOME_NAME, 'rules', 'website']) {
        const ch = channels.find((c) => c.type !== CHAN_CATEGORY && String(c.name ?? '') === name)
        if (!ch || String(ch.parent_id ?? '') === String(league.id)) continue
        if (ch.parent_id != null) continue // categorised elsewhere on purpose — leave it
        planned.push({ channel: name, target: '(category)', add: ['MOVE to LEAGUE'], remove: [] })
        if (!dryRun) {
          const moved = await discord(`/channels/${ch.id}`, 'PATCH', botToken, { parent_id: league.id })
          if (moved.ok) applied.push(`${name} · moved to LEAGUE`)
          else warnings.push(`Could not move #${name} into LEAGUE — ${moved.message}`)
        }
      }
    }

    // --- 8. #race-attendance: where the grid answers, and nothing else ---
    //
    // The ask used to live in #announcements, which put a form in the middle of the
    // room people come back to for results and standings. It has its own channel now,
    // and discord-attendance reads the id from discord_config.channel_race_attendance
    // (falling back to #announcements if this has never run).
    //
    // READ-ONLY FOR MEMBERS, DELIBERATELY. Pressing a button needs only VIEW_CHANNEL —
    // components are not messages — so members can answer without being able to post.
    // That keeps the channel exactly one post per race instead of a conversation with
    // the buttons scrolled somewhere above it.
    let attendChannel = channels.find((c) => String(c.id) === String(cfg.channel_race_attendance ?? '').trim())
      ?? channels.find((c) => c.type !== CHAN_CATEGORY && String(c.name ?? '') === ATTEND_NAME)

    if (!attendChannel && !dryRun) {
      const made = await discord<Channel>(`/guilds/${guildId}/channels`, 'POST', botToken, {
        name: ATTEND_NAME,
        type: CHAN_TEXT,
        parent_id: league.id,
        topic: 'Are you racing this weekend? One post per round — tap a button. You can change your mind any time by pressing the other one. Race control reads this to know what the grid looks like.',
      })
      if (made.ok && made.data?.id) { attendChannel = made.data; created.push(ATTEND_NAME) }
      else if (!made.ok) warnings.push(`Could not create #${ATTEND_NAME} — ${made.message}`)
    } else if (!attendChannel && dryRun) {
      planned.push({ channel: ATTEND_NAME, target: '(channel)', add: [`CREATE text channel in ${LEAGUE_CATEGORY}`], remove: [] })
    }

    if (attendChannel) {
      await setPerms(attendChannel, guildId, '@everyone', READ_ONLY_ALLOW, READ_ONLY_DENY)
      for (const [rid, label] of [[adminRole, 'Admin'], [rcRole, 'Race Control'], [botRole, 'HCR Bot']] as const) {
        if (SNOWFLAKE.test(rid)) await setPerms(attendChannel, rid, label, FORUM_STAFF_ALLOW, 0n)
      }
      if (!dryRun && String(cfg.channel_race_attendance ?? '') !== String(attendChannel.id)) {
        const { error } = await db.from('discord_config')
          .update({ channel_race_attendance: String(attendChannel.id), updated_at: new Date().toISOString() }).eq('id', 1)
        if (error) warnings.push(`Created #${ATTEND_NAME} but could not save its id — ${error.message}`)
      }
    }

    return json({
      ok: warnings.length === 0,
      dryRun,
      created,
      license_ups: licenseUps?.name ?? null,
      race_control_announcements: rcChannel?.name ?? null,
      league_recommendations: recsChannel?.name ?? null,
      race_attendance: attendChannel?.name ?? null,
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
