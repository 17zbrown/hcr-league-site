// discord-audit — a read-only census of the league's Discord server. Admin-only.
//
// Walks the server and writes down what's actually there: the guild, every role
// (with how many members hold it), every channel and every category, plus a list
// of plain-English observations. Nothing is created, renamed, moved or deleted —
// this function only ever sends GET requests to Discord. Its single write is the
// one audit row, so it's safe to run as often as you like.
//
// It cannot read messages (the bot has no Read Message History), so "activity" is
// inferred from snowflake ids: a Discord id encodes the moment it was minted, so a
// channel's last_message_id tells us WHEN the last message landed without telling
// us anything about what it said.
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

// Discord's clock starts on 2015-01-01; the top 42 bits of any id are ms since then.
const DISCORD_EPOCH = 1420070400000n

// Permission bits we care about. Discord sends the bitfield as a decimal STRING and
// the high bits are well past 2^53, so every one of these is compared with BigInt —
// Number() would silently round the interesting ones away.
const ADMINISTRATOR = 1n << 3n
const MANAGE_CHANNELS = 1n << 4n
const MANAGE_GUILD = 1n << 5n
const VIEW_CHANNEL = 1n << 10n
const MANAGE_ROLES = 1n << 28n
const STAFFISH = ADMINISTRATOR | MANAGE_GUILD | MANAGE_ROLES | MANAGE_CHANNELS

const CHANNEL_CATEGORY = 4
const OVERWRITE_ROLE = 0 // permission_overwrites.type: 0 = role, 1 = member

// A big server shouldn't be able to hang the function, so the member walk is capped.
const MEMBER_PAGE = 1000
const MAX_MEMBER_PAGES = 5

interface Guild {
  id: string
  name: string
  approximate_member_count?: number | null
}
interface Role {
  id: string
  name: string
  color?: number | null
  position?: number | null
  managed?: boolean
  permissions?: string | null
}
interface Overwrite {
  id: string
  type: number
  allow?: string | null
  deny?: string | null
}
interface Channel {
  id: string
  name: string
  type: number
  parent_id?: string | null
  position?: number | null
  last_message_id?: string | null
  permission_overwrites?: Overwrite[] | null
}
interface Member {
  user?: { id?: string | null } | null
  roles?: string[] | null
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

// Every Discord call goes through here, and it can only ever do one thing: GET.
// That's deliberate — this function is a census, so there is no code path in it
// capable of changing the server. It never throws, it retries a rate limit
// (bounded, never forever), and it hands back Discord's own explanation.
async function discordGet<T>(path: string, token: string, attempt = 0): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(`${DISCORD}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return { ok: false, status: 0, message: `Could not reach Discord (${String((e as Error)?.message ?? e)})` }
  }
  // 429 = rate limited. Back off and retry — but bounded, never forever.
  if (res.status === 429 && attempt < 3) {
    const retry = Number(res.headers.get('retry-after') ?? '1')
    await new Promise((r) => setTimeout(r, (Number.isFinite(retry) ? retry : 1) * 1000 + 250))
    return discordGet<T>(path, token, attempt + 1)
  }
  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch (_) { /* Discord sent something that isn't JSON */ }
  }
  if (!res.ok) {
    const detail = (parsed as { message?: string } | null)?.message
    return { ok: false, status: res.status, message: `Discord API ${res.status}${detail ? `: ${detail}` : ''}` }
  }
  return { ok: true, data: (parsed ?? null) as T }
}

// Permissions and overwrite masks arrive as decimal strings. Anything unparseable
// is treated as "no permissions" rather than allowed to throw mid-scan.
const bits = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? '0').trim() || '0')
  } catch (_) {
    return 0n
  }
}
const has = (field: bigint, mask: bigint) => (field & mask) !== 0n

// A snowflake carries its own birthday: shift off the 22 low bits (worker, process,
// sequence) and add Discord's epoch. This is how we date things without reading them.
const snowflakeTime = (id: string | null | undefined): string | null => {
  if (!id || !/^\d+$/.test(String(id))) return null
  try {
    const ms = Number((BigInt(id) >> 22n) + DISCORD_EPOCH)
    if (!Number.isFinite(ms) || ms <= 0) return null
    return new Date(ms).toISOString()
  } catch (_) {
    return null
  }
}

const badToken = 'Discord rejected the bot token — check the DISCORD_BOT_TOKEN secret in Supabase.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
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

    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    // --- config (service role bypasses RLS) ---
    const db = createClient(url, service)
    const { data: cfgRow } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    const cfg = (cfgRow ?? null) as Record<string, unknown> | null
    const configured = (key: string) => String(cfg?.[key] ?? '').trim()

    const notes: string[] = []

    // --- 1. which server? (same handshake as setup, so both agree on the guild) ---
    let guildId = configured('guild_id')
    let guildName = configured('guild_name')

    if (!guildId) {
      const mine = await discordGet<Guild[]>('/users/@me/guilds', botToken)
      if (!mine.ok) {
        if (mine.status === 401) return json({ error: badToken }, 400)
        return json({ error: mine.message }, 502)
      }
      const guilds = (mine.data ?? []).filter((g) => g?.id).map((g) => ({ id: g.id, name: g.name }))
      if (guilds.length === 0) {
        return json(
          {
            error:
              'The bot is not in any server yet — invite it first (Discord Developer Portal → OAuth2 → URL Generator, scopes "bot" + "applications.commands"), then run the audit again.',
          },
          400,
        )
      }
      if (guilds.length > 1) {
        // More than one server is a decision, not a failure — hand the list back.
        return json({
          ok: false,
          needsGuildSelection: true,
          guilds,
          message:
            'The bot is in more than one server, so the audit stopped rather than guess. Paste the right server (guild) ID into Admin → Discord, save, then run the audit again.',
        })
      }
      guildId = guilds[0].id
      guildName = guilds[0].name
      notes.push(
        `No server (guild) ID is saved in Admin → Discord, so the audit scanned the only server the bot is in ("${guildName}"). The audit never writes that ID back — run Setup to save it.`,
      )
    }

    // --- 2. the guild itself ---
    let memberCount: number | null = null
    const g = await discordGet<Guild>(`/guilds/${guildId}?with_counts=true`, botToken)
    if (g.ok) {
      guildName = g.data?.name || guildName
      const approx = g.data?.approximate_member_count
      memberCount = typeof approx === 'number' ? approx : null
    } else {
      if (g.status === 401) return json({ error: badToken }, 400)
      if (g.status === 403 || g.status === 404) {
        return json(
          {
            error: `The bot cannot see server ${guildId} — invite it to that server, or clear the Server (guild) ID field in Admin → Discord to auto-detect it.`,
          },
          400,
        )
      }
      // Anything else is a wobble, not a wall: note it and scan what we still can.
      notes.push(`Could not read the server's own details — ${g.message}. The member total below may be missing.`)
    }

    // --- 3. roles ---
    // A role is "staffish" when its bitfield carries real power over the server.
    // Administrator implies everything, so it's listed first for a reason.
    const rolesRes = await discordGet<Role[]>(`/guilds/${guildId}/roles`, botToken)
    let rawRoles: Role[] = []
    if (rolesRes.ok) {
      rawRoles = (rolesRes.data ?? []).filter((r) => r?.id)
    } else {
      notes.push(
        rolesRes.status === 403
          ? "Discord refused to list the server's roles (403) — the bot needs the Manage Roles permission, so this audit has no role list."
          : `Could not read the server's roles — ${rolesRes.message}. This audit has no role list.`,
      )
    }

    // --- 4. how many members hold each role ---
    // Paged with ?after= (member ids come back ascending), stopping at the first
    // short page or the page cap, whichever lands first.
    const roleCounts = new Map<string, number>()
    let membersScanned = 0
    let noRoleMembers = 0
    let memberScanOk = true
    let reachedEnd = false
    let after = '0'
    let pages = 0

    while (pages < MAX_MEMBER_PAGES) {
      const res = await discordGet<Member[]>(`/guilds/${guildId}/members?limit=${MEMBER_PAGE}&after=${after}`, botToken)
      if (!res.ok) {
        memberScanOk = false
        notes.push(
          res.status === 403
            ? 'Could not count how many members hold each role — Discord refused the member list (403). Enable the Server Members Intent for the bot in the Discord Developer Portal.'
            : `Could not count how many members hold each role — ${res.message}`,
        )
        break
      }
      pages++
      const batch = Array.isArray(res.data) ? res.data : []
      for (const m of batch) {
        membersScanned++
        const held = Array.isArray(m?.roles) ? m.roles.filter((r) => typeof r === 'string' && r) : []
        // @everyone is implicit — Discord never lists it — so an empty array really
        // does mean "this member has nothing but @everyone".
        if (!held.length) noRoleMembers++
        for (const rid of held) roleCounts.set(rid, (roleCounts.get(rid) ?? 0) + 1)
      }
      if (batch.length < MEMBER_PAGE) {
        reachedEnd = true
        break
      }
      const last = batch[batch.length - 1]?.user?.id
      if (!last) {
        reachedEnd = true
        break
      }
      after = last
    }

    const memberScanCapped = memberScanOk && !reachedEnd
    if (memberScanCapped) {
      notes.push(
        `Stopped counting after ${membersScanned} members (${MAX_MEMBER_PAGES} pages of ${MEMBER_PAGE}) so a large server can't hang the scan — the per-role counts cover only those members.`,
      )
    }

    const roles = rawRoles.map((r) => {
      const perms = bits(r.permissions)
      // Every member holds @everyone (its id is the guild id), but Discord never
      // lists it on a member, so the tally would read zero. Say what's true instead.
      const isEveryone = r.id === guildId
      const count = isEveryone ? membersScanned : roleCounts.get(r.id) ?? 0
      return {
        id: r.id,
        name: r.name ?? '',
        color: typeof r.color === 'number' ? r.color : 0,
        position: typeof r.position === 'number' ? r.position : 0,
        managed: r.managed === true,
        permissions: String(r.permissions ?? '0'),
        is_staffish: has(perms, STAFFISH),
        member_count: memberScanOk ? count : null,
      }
    })

    // --- 5. channels ---
    const chRes = await discordGet<Channel[]>(`/guilds/${guildId}/channels`, botToken)
    let rawChannels: Channel[] = []
    if (chRes.ok) {
      rawChannels = (chRes.data ?? []).filter((c) => c?.id)
    } else {
      notes.push(
        chRes.status === 403
          ? "Discord refused to list the server's channels (403) — the bot needs the View Channels permission, so this audit has no channel or category list."
          : `Could not read the server's channels — ${chRes.message}. This audit has no channel or category list.`,
      )
    }

    const channels = rawChannels.map((c) => ({
      id: c.id,
      name: c.name ?? '',
      type: typeof c.type === 'number' ? c.type : -1,
      parent_id: c.parent_id ?? null,
      position: typeof c.position === 'number' ? c.position : 0,
      overwrite_count: c.permission_overwrites?.length ?? 0,
      created_at: snowflakeTime(c.id),
      last_active_at: snowflakeTime(c.last_message_id),
    }))

    // --- 6. categories (type 4) ---
    // "Private" means @everyone has been denied View Channel here; @everyone's role
    // id is the guild id, which is why the guild id shows up in an overwrite list.
    const categories = rawChannels
      .filter((c) => c.type === CHANNEL_CATEGORY)
      .map((c) => {
        const overwrites = Array.isArray(c.permission_overwrites) ? c.permission_overwrites : []
        const everyone = overwrites.find((o) => o?.id === guildId)
        return {
          id: c.id,
          name: c.name ?? '',
          position: typeof c.position === 'number' ? c.position : 0,
          private: everyone ? has(bits(everyone.deny), VIEW_CHANNEL) : false,
          allowed_role_ids: overwrites
            .filter((o) => o?.id && Number(o.type) === OVERWRITE_ROLE && has(bits(o.allow), VIEW_CHANNEL))
            .map((o) => o.id),
        }
      })

    // --- 7. observations ---
    if (rawChannels.length) {
      notes.push(
        'Channel activity is read from ids, not messages: a Discord snowflake encodes the moment it was created, so last_active_at is when the newest message landed. The bot has no Read Message History permission, so this is the only traffic signal available — and it never reveals what was said.',
      )

      const childCount = new Map<string, number>()
      for (const c of rawChannels) {
        if (c.parent_id) childCount.set(c.parent_id, (childCount.get(c.parent_id) ?? 0) + 1)
      }
      const empty = categories.filter((cat) => !childCount.get(cat.id)).map((cat) => cat.name || cat.id)
      if (empty.length) {
        notes.push(`${empty.length} categor${empty.length === 1 ? 'y holds' : 'ies hold'} no channels: ${empty.join(', ')}.`)
      }

      // Only channels that can hold messages are expected to have an activity signal —
      // categories (4) and voice/stage rooms (2, 13) never do.
      const messageish = channels.filter((c) => ![CHANNEL_CATEGORY, 2, 13].includes(c.type))
      const silent = messageish.filter((c) => !c.last_active_at).map((c) => c.name || c.id)
      if (silent.length) {
        notes.push(
          `${silent.length} channel${silent.length === 1 ? ' has' : 's have'} never had a message, or the bot cannot see into ${silent.length === 1 ? 'it' : 'them'}: ${silent.join(', ')}.`,
        )
      }
    }

    if (roles.length) {
      const staffish = roles.filter((r) => r.is_staffish)
      if (staffish.length) {
        notes.push(
          `${staffish.length} role${staffish.length === 1 ? '' : 's'} can manage the server (Administrator, Manage Server, Manage Roles or Manage Channels): ${staffish
            .map((r) => r.name)
            .join(', ')}.`,
        )
      }
      if (memberScanOk && !memberScanCapped) {
        const unused = roles.filter((r) => r.id !== guildId && !r.managed && (r.member_count ?? 0) === 0)
        if (unused.length) {
          notes.push(
            `${unused.length} role${unused.length === 1 ? ' is' : 's are'} held by nobody: ${unused.map((r) => r.name).join(', ')}.`,
          )
        }
        if (noRoleMembers) {
          notes.push(`${noRoleMembers} member${noRoleMembers === 1 ? ' has' : 's have'} no role beyond @everyone.`)
        }
      }
    }

    const guild = {
      id: guildId,
      name: guildName || null,
      member_count: memberCount,
      // What the role tally is actually based on, so a capped scan can't be misread.
      members_scanned: memberScanOk ? membersScanned : null,
      members_scan_capped: memberScanCapped,
      no_role_members: memberScanOk ? noRoleMembers : null,
    }

    // --- 8. save the single audit row (service role: writes are admin-invisible by RLS) ---
    const scanned_at = new Date().toISOString()
    const payload = { guild, roles, channels, categories, notes }

    const { error: saveErr } = await db
      .from('discord_server_audit')
      .upsert({ id: 1, scanned_at, ...payload }, { onConflict: 'id' })
    if (saveErr) {
      // The scan is the valuable part — hand it back rather than throw it away.
      notes.push(`The scan finished but could not be saved — ${saveErr.message}. Nothing in Discord was touched.`)
    }

    return json({ ok: true, saved: !saveErr, scanned_at, ...payload })
  } catch (e) {
    // Nothing above should throw, but a 500 with a readable message beats a stack trace.
    return json({ error: `Discord audit failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
