// discord-rebuild — rearranges the league's Discord server into the layout the
// site expects: gated categories, the channels that belong in each, and a posting
// webhook where the site needs one. Admin-only.
//
// It is a DRY RUN unless the caller says otherwise. Send `{"dryRun": false}` to
// actually move anything; a body with no `dryRun` key (or no body at all) only
// ever computes the plan and hands it back. Restructuring a server by accident is
// not a mistake anyone can undo, so the safe answer is the default answer.
//
// Nothing is ever deleted. Old channels are TIDIED, not destroyed: they're moved
// into a hidden ARCHIVE category, which keeps every message intact. Emptied-out
// old categories are left standing and simply listed in the report, because
// deleting them is a human's call to make. There is no DELETE against a channel,
// role, message or member anywhere in this file.
//
// Safe to run twice: existing roles, categories, channels and webhooks are
// adopted rather than duplicated.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs **Manage Channels**, **Manage Roles** and **Manage Webhooks**.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const WEBHOOK_BASE = 'https://discord.com/api/webhooks'
const WEBHOOK_NAME = 'HCR League'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Discord channel types.
const TEXT = 0
const VOICE = 2
const CATEGORY = 4
const FORUM = 15

// permission_overwrites.type: 0 = role, 1 = member.
const OVERWRITE_ROLE = 0
const OVERWRITE_MEMBER = 1
// Overwrite masks arrive and leave as decimal STRINGS, and the interesting bits sit
// well past 2^53, so every mask here is a BigInt. Number() would round them away.
const VIEW_CHANNEL = 1n << 10n

// Discord caps a category at 50 channels. A league that has been running a while
// can easily have more than that to file away, so the archive spills over into
// 'ARCHIVE 2', 'ARCHIVE 3'… rather than failing half the moves.
const ARCHIVE_NAME = 'ARCHIVE'
const MAX_PER_CATEGORY = 50
const MAX_ARCHIVE_CATEGORIES = 6

interface Guild {
  id: string
  name: string
}
interface BotUser {
  id: string
}
interface Role {
  id: string
  name: string
  managed?: boolean
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
  permission_overwrites?: Overwrite[] | null
}
interface Webhook {
  id: string
  name?: string | null
  type?: number
  token?: string | null
  url?: string | null
}

// Staff roles decide who gets the Admin / Race Control portal, so they are matched
// only — a role this function invented could hand out the keys to the site.
const STAFF_ROLES = [
  { key: 'role_site_admin', label: 'Admin', aliases: ['admin', 'commissioner', 'league admin', 'hcr admin'] },
  {
    key: 'role_site_race_control',
    label: 'Race Control',
    aliases: ['racecontrol', 'race control', 'steward', 'stewards', 'race director'],
  },
]

// Membership roles are what actually open the private categories. Also match-only:
// who is in the league is a human decision, and a role invented here would gate
// nothing because nobody would hold it.
const GATE_ROLES = [
  { key: 'league_member', label: 'League Member', aliases: ['hcr league member', 'league member'] },
  { key: 'endurance_member', label: 'Endurance Member', aliases: ['hcr endurance member', 'endurance member'] },
]

// License roles are ours to create. Colours are the metals, not the brand yellow —
// the brand colour is reserved for embeds so it stays a signal, not decoration.
const LICENSE_ROLES = [
  { key: 'role_bronze', label: 'Bronze', name: 'Bronze', aliases: ['bronze', 'hcr bronze'], color: 0xcd7f32 },
  { key: 'role_silver', label: 'Silver', name: 'Silver', aliases: ['silver', 'hcr silver'], color: 0xc0c0c0 },
  { key: 'role_gold', label: 'Gold', name: 'Gold', aliases: ['gold', 'hcr gold'], color: 0xffd700 },
  { key: 'role_platinum', label: 'Platinum', name: 'Platinum', aliases: ['platinum', 'hcr platinum'], color: 0xe5e4e2 },
]

// Only these role keys are columns on discord_config. league_member and
// endurance_member gate categories but have no column, so they're never written.
const CONFIG_ROLE_KEYS = new Set([...STAFF_ROLES, ...LICENSE_ROLES].map((r) => r.key))

interface WantedChannel {
  name: string
  type: number
}
interface WantedCategory {
  name: string
  // Public means @everyone keeps View Channel. Everything else denies @everyone and
  // opens back up to the roles in `gates`.
  open: boolean
  gates: string[]
  channels: WantedChannel[]
}

const STRUCTURE: WantedCategory[] = [
  {
    name: 'START HERE',
    open: true,
    gates: [],
    channels: [
      { name: 'welcome', type: TEXT },
      { name: 'rules', type: TEXT },
      { name: 'verification', type: TEXT },
    ],
  },
  {
    name: 'LEAGUE',
    open: false,
    gates: ['league_member', 'role_site_admin', 'role_site_race_control'],
    channels: [
      { name: 'announcements', type: TEXT },
      { name: 'race-results', type: FORUM },
      { name: 'standings', type: TEXT },
      { name: 'general-chat', type: TEXT },
      { name: 'season-signups', type: TEXT },
      { name: 'rulebook', type: TEXT },
      { name: 'Race Channel', type: VOICE },
    ],
  },
  {
    name: 'ENDURANCE',
    open: false,
    gates: ['endurance_member', 'role_site_admin'],
    channels: [
      { name: 'announcements', type: TEXT },
      { name: 'general-chat', type: TEXT },
      { name: 'event-signups', type: TEXT },
      { name: 'stint-planning', type: TEXT },
      { name: 'Endurance Voice', type: VOICE },
    ],
  },
  {
    name: 'PADDOCK',
    open: false,
    gates: ['league_member', 'endurance_member', 'role_site_admin'],
    channels: [
      { name: 'gravel-trap', type: TEXT },
      { name: 'promotions', type: TEXT },
      { name: 'Voice Chat', type: VOICE },
    ],
  },
  {
    name: 'RACE CONTROL',
    open: false,
    gates: ['role_site_race_control', 'role_site_admin'],
    channels: [
      { name: 'race-control', type: TEXT },
      { name: 'incident-protests', type: FORUM },
      { name: 'license-ups', type: TEXT },
      { name: 'Steward Radio', type: VOICE },
    ],
  },
  {
    name: 'ADMIN',
    open: false,
    gates: ['role_site_admin'],
    channels: [
      { name: 'admin-chat', type: TEXT },
      { name: 'iracing-names', type: TEXT },
      { name: 'bot-log', type: TEXT },
      // Discord's Community features each need a channel to point at. Both are
      // staff-facing — Discord posts to them, members never should — so they
      // live behind the ADMIN gate rather than anywhere public.
      { name: 'community-updates', type: TEXT },
      { name: 'safety-alerts', type: TEXT },
    ],
  },
]

// Where the site posts. Keyed by category + channel because the channel names are
// not unique across the server once the old ones are archived.
const WEBHOOK_TARGETS = [
  { category: 'LEAGUE', channel: 'race-results', configKey: 'channel_results', webhookKey: 'results' },
  { category: 'LEAGUE', channel: 'standings', configKey: 'channel_standings', webhookKey: 'standings' },
  { category: 'RACE CONTROL', channel: 'license-ups', configKey: 'channel_license_ups', webhookKey: 'license_ups' },
]

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

// Every Discord call goes through here: it never throws, it retries a rate limit,
// and it hands back Discord's own explanation of a refusal.
async function discord<T>(
  path: string,
  method: string,
  token: string,
  body?: unknown,
  attempt = 0,
): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(`${DISCORD}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    return { ok: false, status: 0, message: `Could not reach Discord (${String((e as Error)?.message ?? e)})` }
  }
  // 429 = rate limited. Back off and retry — but bounded, never forever.
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
    } catch (_) { /* Discord sent something that isn't JSON */ }
  }
  if (!res.ok) {
    const detail = (parsed as { message?: string } | null)?.message
    return { ok: false, status: res.status, message: `Discord API ${res.status}${detail ? `: ${detail}` : ''}` }
  }
  // 204 = success with no content.
  return { ok: true, data: (parsed ?? null) as T }
}

// Masks arrive as decimal strings. Anything unparseable is treated as "no bits"
// rather than allowed to throw mid-rebuild.
const bits = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? '0').trim() || '0')
  } catch (_) {
    return 0n
  }
}

// Discord slugs text and forum channel names (lower case, spaces to hyphens) but
// leaves voice names alone, so a name is compared the way Discord would store it.
const nameKey = (name: string, type: number) => {
  const base = (name ?? '').trim().toLowerCase()
  return type === TEXT || type === FORUM ? base.replace(/\s+/g, '-') : base
}

// The overwrites we want, folded into the ones already on the channel. Entries for
// ids we don't manage are copied through untouched — an admin who hand-added a
// moderator to a category keeps that moderator.
function planOverwrites(
  existing: Overwrite[],
  guildId: string,
  gateIds: string[],
  botUserId: string | null,
  open: boolean,
): Overwrite[] {
  const ours = new Set<string>([guildId, ...gateIds])
  if (!open && botUserId) ours.add(botUserId)

  const prev = new Map<string, Overwrite>()
  for (const o of existing) if (o?.id) prev.set(o.id, o)

  const out: Overwrite[] = []
  for (const o of existing) {
    if (!o?.id || ours.has(o.id)) continue
    out.push({
      id: o.id,
      type: Number(o.type) === OVERWRITE_MEMBER ? OVERWRITE_MEMBER : OVERWRITE_ROLE,
      allow: String(bits(o.allow)),
      deny: String(bits(o.deny)),
    })
  }

  if (open) {
    // Public lifts only the View Channel deny from @everyone; any other bit an admin
    // set there (no @mentions, say) is none of this function's business.
    const e = prev.get(guildId)
    if (e) {
      const allow = bits(e.allow)
      const deny = bits(e.deny) & ~VIEW_CHANNEL
      if (allow !== 0n || deny !== 0n) {
        out.push({ id: guildId, type: OVERWRITE_ROLE, allow: String(allow), deny: String(deny) })
      }
    }
    return out
  }

  // @everyone's role id IS the guild id — that's why a guild id shows up in an
  // overwrite list.
  const everyone = prev.get(guildId)
  out.push({
    id: guildId,
    type: OVERWRITE_ROLE,
    allow: String(bits(everyone?.allow) & ~VIEW_CHANNEL),
    deny: String(bits(everyone?.deny) | VIEW_CHANNEL),
  })
  for (const rid of gateIds) {
    const g = prev.get(rid)
    out.push({
      id: rid,
      type: OVERWRITE_ROLE,
      allow: String(bits(g?.allow) | VIEW_CHANNEL),
      deny: String(bits(g?.deny) & ~VIEW_CHANNEL),
    })
  }
  // The bot is not an administrator, so denying @everyone would blind it to the very
  // category it just made — and then it could not add the webhook the site posts
  // through. One member-level overwrite for the bot keeps it able to finish the job.
  if (botUserId) {
    const b = prev.get(botUserId)
    out.push({
      id: botUserId,
      type: OVERWRITE_MEMBER,
      allow: String(bits(b?.allow) | VIEW_CHANNEL),
      deny: String(bits(b?.deny) & ~VIEW_CHANNEL),
    })
  }
  return out.filter((o) => o.allow !== '0' || o.deny !== '0')
}

const sameOverwrites = (a: Overwrite[], b: Overwrite[]) => {
  const norm = (list: Overwrite[]) =>
    list
      .filter((o) => o?.id)
      .map((o) => `${o.id}:${Number(o.type) === OVERWRITE_MEMBER ? 1 : 0}:${bits(o.allow)}:${bits(o.deny)}`)
      .sort()
      .join('|')
  return norm(a) === norm(b)
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

    // --- dry run unless told otherwise ---
    // Only a literal `false` arms the rebuild. A missing key, an empty body, a typo,
    // a stray GET-turned-POST: every one of those computes the plan and changes
    // nothing. The Admin panel sends dryRun:false on purpose, after a confirmation.
    let dryRun = true
    try {
      const body = await req.json()
      if (body && typeof body === 'object' && (body as { dryRun?: unknown }).dryRun === false) dryRun = false
    } catch (_) { /* empty or non-JSON body — the safe default stands */ }

    // --- auth: caller must be a signed-in admin ---
    const authz = req.headers.get('Authorization') ?? ''
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } })
    const { data: userData } = await userClient.auth.getUser()
    const user = userData?.user
    if (!user) return json({ error: 'Not authenticated' }, 401)
    const { data: prof } = await userClient.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
    if (!prof?.is_admin) return json({ error: 'Admins only' }, 403)

    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    // --- config (service role bypasses RLS; discord_webhooks has no policies at all) ---
    const db = createClient(url, service)
    const { data: cfgRow } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    const cfg = (cfgRow ?? null) as Record<string, unknown> | null
    const configured = (key: string) => String(cfg?.[key] ?? '').trim()

    const warnings: string[] = []
    const patch: Record<string, unknown> = {}
    let hierarchyHint = false

    // --- 1. which server? (same handshake as setup, so both agree on the guild) ---
    let guildId = configured('guild_id')
    let guildName = configured('guild_name')

    if (!guildId) {
      const mine = await discord<Guild[]>('/users/@me/guilds', 'GET', botToken)
      if (!mine.ok) {
        if (mine.status === 401) return json({ error: badToken }, 400)
        return json({ error: mine.message }, 502)
      }
      const guilds = (mine.data ?? []).filter((g) => g?.id).map((g) => ({ id: g.id, name: g.name }))
      if (guilds.length === 0) {
        return json(
          {
            error:
              'The bot is not in any server yet — invite it first (Discord Developer Portal → OAuth2 → URL Generator, scopes "bot" + "applications.commands"), then run the rebuild again.',
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
            'The bot is in more than one server, so the rebuild stopped rather than guess. Paste the right server (guild) ID into Admin → Discord, save, then run the rebuild again.',
        })
      }
      guildId = guilds[0].id
      guildName = guilds[0].name
    } else {
      // A guild id is already set — confirm the bot can actually see it.
      const g = await discord<Guild>(`/guilds/${guildId}`, 'GET', botToken)
      if (!g.ok) {
        if (g.status === 401) return json({ error: badToken }, 400)
        if (g.status === 403 || g.status === 404) {
          return json(
            {
              error: `The bot cannot see server ${guildId} — invite it to that server, or clear the Server (guild) ID field in Admin → Discord to auto-detect it.`,
            },
            400,
          )
        }
        return json({ error: g.message }, 502)
      }
      guildName = g.data?.name || guildName
    }

    // Who the bot is, so private categories can keep a door open for it. Not fatal
    // if it fails — the rebuild just says so.
    let botUserId: string | null = null
    const me = await discord<BotUser>('/users/@me', 'GET', botToken)
    if (me.ok && me.data?.id) {
      botUserId = me.data.id
    } else {
      warnings.push(
        'Could not work out the bot\'s own user id, so the private categories get no exception for it. If the bot later cannot post to a hidden channel, give its role the View Channel permission there.',
      )
    }

    // --- 2. roles ---
    const rolesRes = await discord<Role[]>(`/guilds/${guildId}/roles`, 'GET', botToken)
    if (!rolesRes.ok) {
      // Without the role list every category would be gated at a guess, so this one
      // really is a wall rather than a warning.
      if (rolesRes.status === 403) {
        return json({ error: "Discord refused to list the server's roles — the bot needs the Manage Roles permission." }, 400)
      }
      return json({ error: `Could not read the server's roles — ${rolesRes.message}` }, 502)
    }
    const allRoles = (rolesRes.data ?? []).filter((r) => r?.id)
    // An id already saved in the panel is honoured whatever kind of role it is —
    // that's the admin's explicit choice. Name matching is fussier: it skips
    // @everyone and bot-managed roles, since neither can be handed to a driver.
    const rolesById = new Map(allRoles.map((r) => [r.id, r]))
    const matchable = allRoles.filter((r) => r.name !== '@everyone' && !r.managed)
    const matchRole = (aliases: string[]) =>
      matchable.find((r) => aliases.includes((r.name ?? '').trim().toLowerCase())) ?? null

    const roleReport: { key: string; name: string; id: string | null; created: boolean }[] = []
    const resolvedRoles = new Map<string, { id: string; name: string }>()
    const missingRoles: string[] = []
    const labelOf = (key: string) =>
      [...STAFF_ROLES, ...GATE_ROLES, ...LICENSE_ROLES].find((r) => r.key === key)?.label ?? key

    // Match-only roles first: staff (they carry real power) and the two membership
    // roles the private categories hang off.
    for (const want of [...STAFF_ROLES, ...GATE_ROLES]) {
      const saved = CONFIG_ROLE_KEYS.has(want.key) ? configured(want.key) : ''
      const role: Role | null = (saved ? rolesById.get(saved) : null) ?? matchRole(want.aliases)
      if (!role) {
        missingRoles.push(want.label)
        warnings.push(
          `No ${want.label} role found (looked for: ${want.aliases.join(', ')}). The rebuild never creates that role — make it in Discord, then run the rebuild again.`,
        )
        continue
      }
      resolvedRoles.set(want.key, { id: role.id, name: role.name })
      if (CONFIG_ROLE_KEYS.has(want.key)) patch[want.key] = role.id
      roleReport.push({ key: want.key, name: role.name, id: role.id, created: false })
    }

    // License roles are ours to make.
    for (const want of LICENSE_ROLES) {
      // Order matters: an id already in the panel wins over a name match, so an
      // admin's manual choice survives every re-run.
      const saved = configured(want.key)
      let role: Role | null = (saved ? rolesById.get(saved) : null) ?? matchRole(want.aliases)
      let created = false

      if (!role) {
        if (dryRun) {
          roleReport.push({ key: want.key, name: want.name, id: null, created: true })
          continue
        }
        const made = await discord<Role>(`/guilds/${guildId}/roles`, 'POST', botToken, {
          name: want.name,
          color: want.color,
          mentionable: false,
        })
        if (!made.ok) {
          if (made.status === 403) {
            hierarchyHint = true
            warnings.push(
              `Discord refused to create the ${want.name} role — drag the bot's role higher in Server Settings → Roles.`,
            )
          } else {
            warnings.push(`Could not create the ${want.name} role — ${made.message}`)
          }
          continue
        }
        role = made.data
        created = true
      }

      if (!role?.id) continue
      patch[want.key] = role.id
      resolvedRoles.set(want.key, { id: role.id, name: role.name || want.name })
      roleReport.push({ key: want.key, name: role.name || want.name, id: role.id, created })
    }

    // --- 3. what's in the server now ---
    const chRes = await discord<Channel[]>(`/guilds/${guildId}/channels`, 'GET', botToken)
    if (!chRes.ok) {
      // Also a wall: a rebuild that cannot see the current channels would archive
      // nothing and create a second copy of everything.
      if (chRes.status === 403) {
        return json({ error: "Discord refused to list the server's channels — the bot needs the View Channels permission." }, 400)
      }
      return json({ error: `Could not read the server's channels — ${chRes.message}` }, 502)
    }
    const allChannels = (chRes.data ?? []).filter((c) => c?.id && typeof c.type === 'number')
    const byPosition = (a: Channel, b: Channel) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id)

    // A local model of "who lives where", updated as the plan proceeds, so the empty
    // category list at the end reflects the finished state — dry run included.
    const parentOf = new Map<string, string | null>()
    for (const c of allChannels) if (c.type !== CATEGORY) parentOf.set(c.id, c.parent_id ?? null)
    const childCount = (catId: string) => {
      let n = 0
      for (const p of parentOf.values()) if (p === catId) n++
      return n
    }

    const existingCategories = allChannels.filter((c) => c.type === CATEGORY).sort(byPosition)
    const isArchiveName = (name: string) => /^archive(\s+\d+)?$/i.test((name ?? '').trim())

    // Categories that already carry a target name are ADOPTED, not archived — that's
    // what makes a second run a no-op instead of a demolition of the first run's work.
    const targetCategory = new Map<string, Channel | null>()
    const protectedCategoryIds = new Set<string>()
    for (const want of STRUCTURE) {
      const found = existingCategories.find(
        (c) => !isArchiveName(c.name) && (c.name ?? '').trim().toLowerCase() === want.name.toLowerCase(),
      )
      targetCategory.set(want.name, found ?? null)
      if (found) protectedCategoryIds.add(found.id)
    }

    // --- 4. archive ---
    // Find-or-create ARCHIVE, hidden from @everyone, then move every other channel
    // into it. Categories are never moved (a category cannot nest inside one) and
    // nothing is ever deleted.
    const archiveOverwrites = (existing: Overwrite[]) => planOverwrites(existing, guildId, [], botUserId, false)

    const archiveSlots: { id: string | null; name: string; count: number }[] = []
    for (const c of existingCategories.filter((c) => isArchiveName(c.name))) {
      const current = Array.isArray(c.permission_overwrites) ? c.permission_overwrites : []
      const wantOw = archiveOverwrites(current)
      if (!dryRun && !sameOverwrites(current, wantOw)) {
        const fixed = await discord<Channel>(`/channels/${c.id}`, 'PATCH', botToken, { permission_overwrites: wantOw })
        if (!fixed.ok) {
          warnings.push(
            fixed.status === 403
              ? `Discord refused to hide the ${c.name} category — give the bot the Manage Channels permission in Server Settings → Roles.`
              : `Could not hide the ${c.name} category — ${fixed.message}`,
          )
        }
      }
      archiveSlots.push({ id: c.id, name: c.name, count: childCount(c.id) })
    }
    const archiveIds = new Set(archiveSlots.map((s) => s.id).filter((id): id is string => !!id))

    let archiveFull = false
    // Hands back an archive category with room in it, making a new one if the last is
    // full. Returns null once creation is impossible, so the caller can stop moving.
    const archiveSlot = async (): Promise<{ id: string | null; name: string; count: number } | null> => {
      const open = archiveSlots.find((s) => s.count < MAX_PER_CATEGORY)
      if (open) return open
      if (archiveSlots.length >= MAX_ARCHIVE_CATEGORIES) {
        if (!archiveFull) {
          archiveFull = true
          warnings.push(
            `The archive is full (${MAX_ARCHIVE_CATEGORIES} categories of ${MAX_PER_CATEGORY} channels). The rest of the old channels were left exactly where they are — tidy some by hand and run the rebuild again.`,
          )
        }
        return null
      }
      // First free name, so an odd server that already has an 'ARCHIVE 2' and no
      // 'ARCHIVE' doesn't end up with two categories called the same thing.
      const taken = new Set(archiveSlots.map((s) => s.name.trim().toLowerCase()))
      let name = ARCHIVE_NAME
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${ARCHIVE_NAME} ${n}`
      if (dryRun) {
        const planned = { id: null, name, count: 0 }
        archiveSlots.push(planned)
        return planned
      }
      const made = await discord<Channel>(`/guilds/${guildId}/channels`, 'POST', botToken, {
        name,
        type: CATEGORY,
        permission_overwrites: archiveOverwrites([]),
      })
      if (!made.ok || !made.data?.id) {
        warnings.push(
          made.ok
            ? `Discord created the ${name} category but returned no id, so nothing was archived.`
            : made.status === 403
            ? `Discord refused to create the ${name} category — give the bot the Manage Channels permission in Server Settings → Roles. Nothing was archived.`
            : `Could not create the ${name} category — ${made.message}. Nothing was archived.`,
        )
        archiveFull = true
        return null
      }
      const slot = { id: made.data.id, name: made.data.name || name, count: 0 }
      archiveSlots.push(slot)
      archiveIds.add(slot.id)
      return slot
    }

    // Pre-existing = every channel that isn't a category, isn't already filed away,
    // and doesn't belong to a category this rebuild is adopting.
    const toArchive = allChannels
      .filter((c) => c.type !== CATEGORY)
      .filter((c) => {
        const parent = parentOf.get(c.id) ?? null
        if (parent && archiveIds.has(parent)) return false
        if (parent && protectedCategoryIds.has(parent)) return false
        return true
      })
      .sort(byPosition)

    const archivedReport: { name: string; id: string }[] = []
    for (const c of toArchive) {
      const slot = await archiveSlot()
      if (!slot) break
      // A channel keeps its own permissions when it moves (lock_permissions: false),
      // so one that explicitly showed itself to @everyone stays visible even inside a
      // hidden category. Worth saying out loud rather than quietly getting wrong.
      const own = Array.isArray(c.permission_overwrites) ? c.permission_overwrites : []
      const everyoneAllow = own.find((o) => o?.id === guildId && (bits(o.allow) & VIEW_CHANNEL) !== 0n)
      if (everyoneAllow) {
        warnings.push(
          `#${c.name} carries its own "everyone can view" permission, so it will still be visible after being archived. Clear that overwrite on the channel if you want it hidden.`,
        )
      }

      if (!dryRun) {
        const moved = await discord<Channel>(`/channels/${c.id}`, 'PATCH', botToken, {
          parent_id: slot.id,
          lock_permissions: false,
        })
        if (!moved.ok) {
          warnings.push(
            moved.status === 403
              ? `Discord refused to move #${c.name} into ${slot.name} — give the bot the Manage Channels permission in Server Settings → Roles.`
              : `Could not move #${c.name} into ${slot.name} — ${moved.message}`,
          )
          continue
        }
      }
      slot.count++
      parentOf.set(c.id, slot.id)
      archivedReport.push({ name: c.name ?? '', id: c.id })
    }

    // --- 5. the new structure ---
    const categoryReport: { name: string; id: string | null; created: boolean; gated_by: string[] }[] = []
    const channelReport: { category: string; name: string; id: string | null; type: number; created: boolean }[] = []
    const resolvedTargets = new Map<string, { id: string | null; name: string }>()

    for (const want of STRUCTURE) {
      const gateIds: string[] = []
      const gateNames: string[] = []
      for (const key of want.gates) {
        const role = resolvedRoles.get(key)
        if (!role) {
          // The missing role already produced its own warning above; this one says
          // what it costs here, which is that the category opens to Admin only.
          warnings.push(
            `${want.name} was gated without a ${labelOf(key)} role — nobody holding that role can see it until you make the role and run the rebuild again.`,
          )
          continue
        }
        if (gateIds.includes(role.id)) continue
        gateIds.push(role.id)
        gateNames.push(role.name)
      }
      if (!want.open && gateIds.length === 0) {
        warnings.push(
          `${want.name} is hidden from everyone: none of the roles it should open to exist yet, so only server administrators can see it.`,
        )
      }

      // --- the category itself ---
      let category = targetCategory.get(want.name) ?? null
      let createdCategory = false
      if (!category) {
        if (dryRun) {
          categoryReport.push({ name: want.name, id: null, created: true, gated_by: gateNames })
        } else {
          const made = await discord<Channel>(`/guilds/${guildId}/channels`, 'POST', botToken, {
            name: want.name,
            type: CATEGORY,
            permission_overwrites: planOverwrites([], guildId, gateIds, botUserId, want.open),
          })
          if (!made.ok || !made.data?.id) {
            warnings.push(
              made.ok
                ? `Discord created the ${want.name} category but returned no id, so its channels were skipped.`
                : made.status === 403
                ? `Discord refused to create the ${want.name} category — give the bot the Manage Channels permission in Server Settings → Roles. Its channels were skipped.`
                : `Could not create the ${want.name} category — ${made.message}. Its channels were skipped.`,
            )
            continue
          }
          category = made.data
          createdCategory = true
          categoryReport.push({ name: category.name || want.name, id: category.id, created: true, gated_by: gateNames })
        }
      } else {
        // Adopted: bring its permissions in line, but only if they actually differ,
        // so a re-run doesn't churn the audit log for nothing.
        const current = Array.isArray(category.permission_overwrites) ? category.permission_overwrites : []
        const wantOw = planOverwrites(current, guildId, gateIds, botUserId, want.open)
        if (!dryRun && !sameOverwrites(current, wantOw)) {
          const fixed = await discord<Channel>(`/channels/${category.id}`, 'PATCH', botToken, {
            permission_overwrites: wantOw,
          })
          if (!fixed.ok) {
            warnings.push(
              fixed.status === 403
                ? `Discord refused to set who can see ${want.name} — give the bot the Manage Channels permission in Server Settings → Roles.`
                : `Could not set who can see ${want.name} — ${fixed.message}`,
            )
          }
        }
        categoryReport.push({ name: category.name || want.name, id: category.id, created: false, gated_by: gateNames })
      }

      const categoryId = category?.id ?? null

      // --- its channels ---
      // Names collide with the archived ones on purpose (two #general-chat, and
      // Discord is fine with that), so a match is only ever looked for INSIDE this
      // category. Anywhere else and a re-run would adopt an archived channel.
      const existingChildren = categoryId
        ? allChannels.filter((c) => c.type !== CATEGORY && parentOf.get(c.id) === categoryId)
        : []

      for (const wantCh of want.channels) {
        const sameName = existingChildren.filter(
          (c) => nameKey(c.name ?? '', c.type) === nameKey(wantCh.name, wantCh.type),
        )
        const found = sameName.find((c) => c.type === wantCh.type) ?? null
        if (!found && sameName.length) {
          // Discord cannot convert a channel from one type to another, and this
          // function will not delete one to make room, so the right channel goes in
          // alongside the wrong one and the admin is told why there are two.
          warnings.push(
            `${want.name} already has a #${sameName[0].name} of a different kind, and Discord cannot convert a channel's type. The ${
              wantCh.type === FORUM ? 'forum' : wantCh.type === VOICE ? 'voice channel' : 'text channel'
            } the site needs goes in alongside it — move the old one to the archive by hand if you don't want both.`,
          )
        }

        if (found) {
          resolvedTargets.set(`${want.name}/${wantCh.name}`, { id: found.id, name: found.name || wantCh.name })
          channelReport.push({
            category: want.name,
            name: found.name || wantCh.name,
            id: found.id,
            type: found.type,
            created: false,
          })
          continue
        }

        if (dryRun || !categoryId) {
          resolvedTargets.set(`${want.name}/${wantCh.name}`, { id: null, name: wantCh.name })
          channelReport.push({ category: want.name, name: wantCh.name, id: null, type: wantCh.type, created: true })
          continue
        }

        // No permission_overwrites of its own: the channel inherits the category,
        // which is the whole point of gating at the category level.
        const made = await discord<Channel>(`/guilds/${guildId}/channels`, 'POST', botToken, {
          name: wantCh.name,
          type: wantCh.type,
          parent_id: categoryId,
        })
        if (!made.ok || !made.data?.id) {
          warnings.push(
            made.ok
              ? `Discord created ${want.name} / ${wantCh.name} but returned no id.`
              : made.status === 403
              ? `Discord refused to create ${want.name} / ${wantCh.name} — give the bot the Manage Channels permission in Server Settings → Roles.`
              : `Could not create ${want.name} / ${wantCh.name} — ${made.message}`,
          )
          continue
        }
        parentOf.set(made.data.id, categoryId)
        resolvedTargets.set(`${want.name}/${wantCh.name}`, { id: made.data.id, name: made.data.name || wantCh.name })
        channelReport.push({
          category: want.name,
          name: made.data.name || wantCh.name,
          id: made.data.id,
          type: wantCh.type,
          created: true,
        })
      }

      if (createdCategory && category?.id) protectedCategoryIds.add(category.id)
    }

    // --- 6. what's left standing ---
    // Old categories emptied by the move. They are NOT deleted: a category is cheap
    // to remove by hand and impossible to un-remove by machine, so the admin decides.
    const emptyOldCategories = existingCategories
      .filter((c) => !archiveIds.has(c.id) && !protectedCategoryIds.has(c.id) && !isArchiveName(c.name))
      .filter((c) => childCount(c.id) === 0)
      .map((c) => ({ name: c.name ?? '', id: c.id }))

    // --- 7. webhooks (service-role only — a webhook URL is a bearer token) ---
    const webhookReport: { channel_key: string; created: boolean }[] = []

    for (const target of WEBHOOK_TARGETS) {
      const ch = resolvedTargets.get(`${target.category}/${target.channel}`)
      if (!ch) continue
      if (!ch.id) {
        // Planned but not yet real: say what would happen and move on.
        webhookReport.push({ channel_key: target.webhookKey, created: true })
        continue
      }

      patch[target.configKey] = ch.id

      const listed = await discord<Webhook[]>(`/channels/${ch.id}/webhooks`, 'GET', botToken)
      if (!listed.ok) {
        warnings.push(
          listed.status === 403
            ? `Discord refused to read the webhooks in ${target.category} / ${ch.name} — give the bot the Manage Webhooks permission.`
            : `Could not read the webhooks in ${target.category} / ${ch.name} — ${listed.message}`,
        )
        continue
      }

      // Reuse ours if it's there. Only type 1 (incoming) webhooks carry a token.
      let hook =
        (listed.data ?? []).find(
          (w) =>
            w?.id &&
            (w.type ?? 1) === 1 &&
            (w.name ?? '').trim().toLowerCase() === WEBHOOK_NAME.toLowerCase() &&
            (w.token || w.url),
        ) ?? null

      let created = false
      if (dryRun) {
        webhookReport.push({ channel_key: target.webhookKey, created: !hook })
        continue
      }
      if (!hook) {
        const made = await discord<Webhook>(`/channels/${ch.id}/webhooks`, 'POST', botToken, { name: WEBHOOK_NAME })
        if (!made.ok) {
          warnings.push(
            made.status === 403
              ? `Discord refused to create a webhook in ${target.category} / ${ch.name} — give the bot the Manage Webhooks permission.`
              : `Could not create the webhook for ${target.category} / ${ch.name} — ${made.message}`,
          )
          continue
        }
        hook = made.data
        created = true
      }

      const hookUrl = hook?.url || (hook?.id && hook?.token ? `${WEBHOOK_BASE}/${hook.id}/${hook.token}` : null)
      if (!hook?.id || !hookUrl) {
        warnings.push(
          `Discord returned a webhook for ${target.category} / ${ch.name} with no token — delete the "${WEBHOOK_NAME}" webhook under Channel Settings → Integrations and run the rebuild again.`,
        )
        continue
      }

      const { error: hookErr } = await db.from('discord_webhooks').upsert(
        {
          channel_key: target.webhookKey,
          channel_id: ch.id,
          webhook_id: hook.id,
          webhook_url: hookUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'channel_key' },
      )
      if (hookErr) {
        warnings.push(`Made the ${target.category} / ${ch.name} webhook in Discord but could not save it — ${hookErr.message}`)
        continue
      }
      webhookReport.push({ channel_key: target.webhookKey, created })
    }

    // --- 8. save ---
    // A dry run writes nothing at all, not even the ids it resolved: a plan that
    // quietly repointed the site's channels would not be a plan.
    if (!dryRun) {
      const stamp = new Date().toISOString()
      patch.guild_id = guildId
      if (guildName) patch.guild_name = guildName
      patch.provisioned_at = stamp
      patch.updated_at = stamp

      // Upsert so a missing singleton row is created, and so `enabled` — the admin's
      // switch — is never part of the write.
      const { error: saveErr } = await db.from('discord_config').upsert({ id: 1, ...patch }, { onConflict: 'id' })
      if (saveErr) {
        return json({ error: `The rebuild ran, but saving the IDs failed — ${saveErr.message}` }, 500)
      }
    }

    // --- 9. report (never any webhook URLs) ---
    return json({
      ok: true,
      dryRun,
      guild: { id: guildId, name: guildName || null },
      roles: roleReport,
      categories: categoryReport,
      channels: channelReport,
      archived: archivedReport,
      empty_old_categories: emptyOldCategories,
      webhooks: webhookReport,
      missing_roles: missingRoles,
      warnings,
      hierarchyHint,
    })
  } catch (e) {
    // Nothing above should throw, but a 500 with a readable message beats a stack trace.
    return json({ error: `Discord rebuild failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
