// discord-layout — puts the server in a deliberate running order and clears out the
// husks the rebuild left behind.
//
// The rebuild created the right categories with the right channels, then left them
// sitting at the BOTTOM of the sidebar: six emptied-out legacy categories occupied
// positions 0-5, ARCHIVE and its 36 dead channels sat at 6, and everything anybody
// actually needs started at 7. Opening the server showed a wall of empty categories
// with names like "HCR League" — which is not a broken rebuild, it's a rebuild that
// forgot the sidebar is ordered. This function fixes the order and, when asked,
// removes the husks.
//
// Three things it can do, each independently switchable:
//   reorder              — categories into CATEGORY_ORDER, channels into CHANNEL_ORDER
//   deleteEmptyCategories — remove categories that contain nothing
//   deleteChannelIds / deleteRoleIds — remove specific things, by id, never by name
//
// DELETION RULES, and these are not negotiable by the caller:
//   * A channel is only ever deleted if Discord says it has never held a message
//     (last_message_id null AND no thread/message metadata). A channel with history
//     is skipped and reported, whatever the caller asked for. There is no override
//     flag, deliberately — message history is somebody's conversation, and a bug in
//     an id list should cost nothing.
//   * A category is only deleted when a LIVE re-read shows zero children. Categories
//     cannot hold messages, so an empty one is a genuinely empty container.
//   * A role is only deleted if it is named in deleteRoleIds AND is not @everyone,
//     not managed by an integration, and sits strictly below the bot's own top role.
//   * Nothing at all happens unless the caller sends a literal {"dryRun": false}.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Bot needs: Manage Channels (reorder + delete), Manage Roles (delete roles).
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
const MAX_DELETES = 60 // a runaway id list shouldn't be able to empty the server

const CHAN_CATEGORY = 4
const CHAN_VOICE = 2
const CHAN_STAGE = 13

// Sidebar order, top to bottom. The reasoning, since a future reader will want it:
// this is a single-league server since the endurance side closed, and each category
// answers one question — LEAGUE is what the league publishes, PADDOCK is where
// members talk, RACE CONTROL is stewarding, ADMIN is staff. The two staff categories
// sit below the rooms they police; ARCHIVE is dead weight and goes last, always.
// Anything not listed here sorts between ADMIN and ARCHIVE, so an unknown category
// is visible but out of the way rather than silently jumping the queue.
// (START HERE and ENDURANCE are gone — discord-reorg folded them away.)
const CATEGORY_ORDER = ['LEAGUE', 'PADDOCK', 'RACE CONTROL', 'ADMIN']
const ARCHIVE_NAME = 'ARCHIVE'

// Channel order within each category. The newcomer's path first (welcome, rules),
// then read-only reference material, then the rooms people type in, then voice.
// Discord sorts voice into its own block below the text channels regardless, so the
// voice entries here only order voice against voice.
const CHANNEL_ORDER: Record<string, string[]> = {
  LEAGUE: ['welcome', 'rules', 'announcements', 'news', 'standings', 'race-results', 'season-signups', 'rulebook'],
  PADDOCK: ['general-chat', 'gravel-trap', 'promotions', 'Race Channel', 'Voice Chat'],
  // league-recommendations is the only member-writable room in here, so it sits at the
  // bottom of the text channels — staff rooms first, then the one members open.
  'RACE CONTROL': ['race-control', 'incident-protests', 'license-ups', 'race-control-announcements', 'league-recommendations', 'Steward Radio'],
  ADMIN: ['admin-chat', 'bot-log', 'safety-alerts', 'community-updates', 'iracing-names'],
}

interface Channel {
  id: string
  name?: string | null
  type: number
  position?: number | null
  parent_id?: string | null
  last_message_id?: string | null
  message_count?: number | null
  total_message_sent?: number | null
}
interface Role {
  id: string
  name?: string | null
  position?: number | null
  managed?: boolean | null
}
interface Member {
  roles?: string[] | null
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

async function discord<T>(
  path: string,
  method: 'GET' | 'PATCH' | 'DELETE',
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

const badToken = 'Discord rejected the bot token — check the DISCORD_BOT_TOKEN secret in Supabase.'

/**
 * Has anybody ever said anything here? Discord gives three separate hints and they
 * disagree depending on channel type (forums carry counts, text channels carry a
 * last_message_id, voice channels carry neither). Any one of them being positive is
 * treated as "yes, there is history" — the question is only ever asked to decide
 * whether deleting is safe, so the cautious answer is the right default.
 */
function hasHistory(c: Channel): boolean {
  if (String(c.last_message_id ?? '').trim()) return true
  if (Number(c.message_count ?? 0) > 0) return true
  if (Number(c.total_message_sent ?? 0) > 0) return true
  return false
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

    let dryRun = true
    let reorder = true
    let deleteEmptyCategories = false
    let deleteChannelIds: string[] = []
    let deleteRoleIds: string[] = []
    try {
      const body = await req.json()
      if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>
        if (b.dryRun === false) dryRun = false
        if (b.reorder === false) reorder = false
        if (b.deleteEmptyCategories === true) deleteEmptyCategories = true
        if (Array.isArray(b.deleteChannelIds)) deleteChannelIds = b.deleteChannelIds.map(String)
        if (Array.isArray(b.deleteRoleIds)) deleteRoleIds = b.deleteRoleIds.map(String)
      }
    } catch (_) { /* empty body — safe defaults stand */ }

    // Ids are interpolated into DELETE paths. Anything that isn't a snowflake is
    // dropped here rather than sent.
    const rejected: string[] = []
    const keepValid = (ids: string[]) =>
      ids.filter((id) => {
        const ok = SNOWFLAKE.test(id)
        if (!ok) rejected.push(id)
        return ok
      })
    deleteChannelIds = keepValid(deleteChannelIds)
    deleteRoleIds = keepValid(deleteRoleIds)

    if (deleteChannelIds.length + deleteRoleIds.length > MAX_DELETES) {
      return json({
        error: `That's ${deleteChannelIds.length + deleteRoleIds.length} things to delete in one run and the cap is ${MAX_DELETES}. Nothing was touched.`,
      }, 400)
    }

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
      const user = userData?.user
      if (!user) return json({ error: 'Not authenticated' }, 401)
      const { data: prof } = await userClient.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
      if (!prof?.is_admin) return json({ error: 'Admins only' }, 403)
    }

    const db = createClient(url, service)
    const { data: cfgRow, error: cfgErr } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    if (cfgErr) return json({ error: `Could not read the Discord config — ${cfgErr.message}` }, 500)
    const cfg = (cfgRow ?? null) as Record<string, unknown> | null
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    const guildId = String(cfg.guild_id ?? '').trim()
    if (!guildId) return json({ skipped: 'No Discord server is configured yet.' })
    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    const warnings: string[] = []

    // --- live read: never act on the cached audit ---
    const chRes = await discord<Channel[]>(`/guilds/${guildId}/channels`, 'GET', botToken)
    if (!chRes.ok) {
      if (chRes.status === 401) return json({ error: badToken }, 400)
      return json({ error: `Could not read the server's channels — ${chRes.message}. Nothing was changed.` }, 502)
    }
    const channels = (Array.isArray(chRes.data) ? chRes.data : []).filter((c) => c && SNOWFLAKE.test(String(c.id)))
    if (channels.length === 0) {
      return json({ error: 'Discord returned no channels at all, which is a symptom rather than a layout. Nothing was changed.' }, 502)
    }

    const categories = channels.filter((c) => c.type === CHAN_CATEGORY)
    const children = new Map<string, Channel[]>()
    for (const c of channels) {
      if (c.type === CHAN_CATEGORY) continue
      const p = String(c.parent_id ?? '').trim()
      if (!p) continue
      const list = children.get(p) ?? []
      list.push(c)
      children.set(p, list)
    }

    // ---------------------------------------------------------------- reorder ----
    // One bulk PATCH for every category, then one per category for its children.
    // Categories not named in CATEGORY_ORDER land after the known ones; ARCHIVE is
    // forced to the very bottom by giving it the highest index there is.
    const plannedCategoryOrder: { id: string; name: string; from: number; to: number }[] = []
    if (reorder) {
      const rank = (name: string) => {
        if (name === ARCHIVE_NAME) return Number.MAX_SAFE_INTEGER
        const i = CATEGORY_ORDER.indexOf(name)
        return i === -1 ? CATEGORY_ORDER.length : i
      }
      const sorted = [...categories].sort((a, b) => {
        const ra = rank(String(a.name ?? ''))
        const rb = rank(String(b.name ?? ''))
        if (ra !== rb) return ra - rb
        // Stable tiebreak for the unlisted ones: keep their existing relative order.
        return (a.position ?? 0) - (b.position ?? 0)
      })
      sorted.forEach((c, idx) => {
        plannedCategoryOrder.push({
          id: String(c.id),
          name: String(c.name ?? ''),
          from: Number(c.position ?? 0),
          to: idx,
        })
      })
    }

    const plannedChannelOrder: { category: string; channel: string; to: number }[] = []
    const channelPatches: { id: string; position: number }[] = []
    if (reorder) {
      for (const cat of categories) {
        const catName = String(cat.name ?? '')
        const wanted = CHANNEL_ORDER[catName]
        if (!wanted) continue // ARCHIVE and anything unrecognised keep whatever order they have
        const kids = children.get(String(cat.id)) ?? []
        const rank = (n: string) => {
          const i = wanted.indexOf(n)
          return i === -1 ? wanted.length : i
        }
        const sorted = [...kids].sort((a, b) => {
          // Voice/stage always sort after text so the intended text order isn't
          // interleaved with rooms Discord is going to separate anyway.
          const va = a.type === CHAN_VOICE || a.type === CHAN_STAGE ? 1 : 0
          const vb = b.type === CHAN_VOICE || b.type === CHAN_STAGE ? 1 : 0
          if (va !== vb) return va - vb
          const ra = rank(String(a.name ?? ''))
          const rb = rank(String(b.name ?? ''))
          if (ra !== rb) return ra - rb
          return (a.position ?? 0) - (b.position ?? 0)
        })
        sorted.forEach((c, idx) => {
          plannedChannelOrder.push({ category: catName, channel: String(c.name ?? ''), to: idx })
          channelPatches.push({ id: String(c.id), position: idx })
        })
      }
    }

    // ---------------------------------------------------------------- deletes ----
    const byId = new Map(channels.map((c) => [String(c.id), c]))

    const channelPlan: { id: string; name: string; action: 'delete' | 'skip'; reason: string }[] = []
    for (const id of deleteChannelIds) {
      const c = byId.get(id)
      if (!c) {
        channelPlan.push({ id, name: '(unknown)', action: 'skip', reason: 'No channel with that id is in this server.' })
        continue
      }
      const name = String(c.name ?? id)
      if (c.type === CHAN_CATEGORY) {
        channelPlan.push({ id, name, action: 'skip', reason: 'That is a category, not a channel — use deleteEmptyCategories.' })
        continue
      }
      if (hasHistory(c)) {
        channelPlan.push({
          id,
          name,
          action: 'skip',
          reason: 'This channel has messages in it. Channels with history are never deleted by this function, whatever the request says.',
        })
        continue
      }
      channelPlan.push({ id, name, action: 'delete', reason: 'Empty — Discord reports no messages have ever been sent here.' })
    }

    const categoryPlan: { id: string; name: string; action: 'delete' | 'skip'; reason: string }[] = []
    if (deleteEmptyCategories) {
      for (const cat of categories) {
        const id = String(cat.id)
        const name = String(cat.name ?? id)
        const kids = children.get(id) ?? []
        // Children queued for deletion in this same run don't count as occupants.
        const surviving = kids.filter((k) => !channelPlan.some((p) => p.id === String(k.id) && p.action === 'delete'))
        if (surviving.length > 0) {
          categoryPlan.push({ id, name, action: 'skip', reason: `Still holds ${surviving.length} channel${surviving.length === 1 ? '' : 's'}.` })
          continue
        }
        if (name === ARCHIVE_NAME) {
          categoryPlan.push({ id, name, action: 'skip', reason: 'ARCHIVE is kept even when empty — it is where history goes.' })
          continue
        }
        categoryPlan.push({ id, name, action: 'delete', reason: 'Empty container, holds no channels and cannot hold messages.' })
      }
    }

    // Roles. Needs the bot's own top position, because Discord will refuse to delete
    // anything at or above it and a refusal is a worse answer than not asking.
    const rolePlan: { id: string; name: string; action: 'delete' | 'skip'; reason: string }[] = []
    if (deleteRoleIds.length) {
      const rolesRes = await discord<Role[]>(`/guilds/${guildId}/roles`, 'GET', botToken)
      if (!rolesRes.ok) {
        if (rolesRes.status === 401) return json({ error: badToken }, 400)
        return json({ error: `Could not read the server's roles — ${rolesRes.message}. Nothing was changed.` }, 502)
      }
      const roles = Array.isArray(rolesRes.data) ? rolesRes.data : []
      const roleById = new Map(roles.map((r) => [String(r.id), r]))

      const meRes = await discord<{ id: string }>('/users/@me', 'GET', botToken)
      if (!meRes.ok) return json({ error: `Could not identify the bot — ${meRes.message}. Nothing was changed.` }, 502)
      const botId = String(meRes.data?.id ?? '').trim()
      const meMemberRes = await discord<Member>(`/guilds/${guildId}/members/${botId}`, 'GET', botToken)
      if (!meMemberRes.ok) {
        return json({ error: `Could not read the bot's own roles — ${meMemberRes.message}. Nothing was changed.` }, 502)
      }
      const botTop = (meMemberRes.data?.roles ?? [])
        .map((rid) => roleById.get(String(rid))?.position ?? 0)
        .reduce((a, b) => Math.max(a, b), 0)

      for (const id of deleteRoleIds) {
        const r = roleById.get(id)
        if (!r) {
          rolePlan.push({ id, name: '(unknown)', action: 'skip', reason: 'No role with that id is in this server.' })
          continue
        }
        const name = String(r.name ?? id)
        if (id === guildId) {
          rolePlan.push({ id, name, action: 'skip', reason: '@everyone cannot be deleted.' })
          continue
        }
        if (r.managed === true) {
          rolePlan.push({ id, name, action: 'skip', reason: 'Managed by an integration — Discord owns this one.' })
          continue
        }
        if (Number(r.position ?? 0) >= botTop) {
          rolePlan.push({
            id,
            name,
            action: 'skip',
            reason: `Sits at or above the bot's own top role (${r.position} vs ${botTop}). Move the bot's role higher in Server Settings → Roles.`,
          })
          continue
        }
        rolePlan.push({ id, name, action: 'delete', reason: 'Named for deletion and below the bot in the hierarchy.' })
      }
    }

    // ------------------------------------------------------------------ apply ----
    const applied = { categoriesReordered: 0, channelsReordered: 0, channelsDeleted: [] as string[], categoriesDeleted: [] as string[], rolesDeleted: [] as string[] }

    if (!dryRun) {
      // Deletes first, then reorder — so the positions we assign describe the server
      // as it will actually be, not as it was before the husks went.
      for (const p of channelPlan.filter((x) => x.action === 'delete')) {
        const res = await discord(`/channels/${p.id}`, 'DELETE', botToken)
        if (res.ok) applied.channelsDeleted.push(p.name)
        else warnings.push(`Could not delete channel "${p.name}" — ${res.message}`)
      }
      for (const p of categoryPlan.filter((x) => x.action === 'delete')) {
        const res = await discord(`/channels/${p.id}`, 'DELETE', botToken)
        if (res.ok) applied.categoriesDeleted.push(p.name)
        else warnings.push(`Could not delete category "${p.name}" — ${res.message}`)
      }
      for (const p of rolePlan.filter((x) => x.action === 'delete')) {
        const res = await discord(`/guilds/${guildId}/roles/${p.id}`, 'DELETE', botToken)
        if (res.ok) applied.rolesDeleted.push(p.name)
        else warnings.push(`Could not delete role "${p.name}" — ${res.message}`)
      }

      if (reorder) {
        const gone = new Set([...categoryPlan, ...channelPlan].filter((x) => x.action === 'delete').map((x) => x.id))
        const catBody = plannedCategoryOrder
          .filter((c) => !gone.has(c.id))
          .map((c, idx) => ({ id: c.id, position: idx }))
        if (catBody.length) {
          const res = await discord(`/guilds/${guildId}/channels`, 'PATCH', botToken, catBody)
          if (res.ok) applied.categoriesReordered = catBody.length
          else warnings.push(`Could not reorder the categories — ${res.message}`)
        }
        const chBody = channelPatches.filter((c) => !gone.has(c.id))
        if (chBody.length) {
          const res = await discord(`/guilds/${guildId}/channels`, 'PATCH', botToken, chBody)
          if (res.ok) applied.channelsReordered = chBody.length
          else warnings.push(`Could not reorder the channels — ${res.message}`)
        }
      }

      // A deleted role may still be referenced by config. Clear those pointers so the
      // reconciler doesn't spend every five minutes chasing a role that isn't there.
      if (applied.rolesDeleted.length) {
        const roleCols = [
          'role_site_admin', 'role_site_race_control', 'role_league_member', 'role_endurance_member',
          'role_driver', 'role_bronze', 'role_silver', 'role_gold', 'role_platinum',
        ]
        const deletedIds = new Set(rolePlan.filter((p) => p.action === 'delete').map((p) => p.id))
        const patch: Record<string, null> = {}
        for (const col of roleCols) {
          const v = String(cfg[col] ?? '').trim()
          if (v && deletedIds.has(v)) patch[col] = null
        }
        if (Object.keys(patch).length) {
          const { error } = await db.from('discord_config').update(patch).eq('id', 1)
          if (error) warnings.push(`Roles were deleted but the config still points at them — ${error.message}`)
          else warnings.push(`Cleared config references to deleted roles: ${Object.keys(patch).join(', ')}`)
        }
      }
    }

    if (rejected.length) warnings.push(`Ignored ${rejected.length} id(s) that are not Discord snowflakes.`)

    return json({
      ok: warnings.length === 0,
      dryRun,
      guild_id: guildId,
      plan: {
        categoryOrder: plannedCategoryOrder.map((c) => `${c.to}. ${c.name}${c.from === c.to ? '' : ` (was ${c.from})`}`),
        channelOrder: plannedChannelOrder,
        channels: channelPlan,
        categories: categoryPlan,
        roles: rolePlan,
      },
      applied: dryRun ? null : applied,
      warnings,
    })
  } catch (e) {
    return json({ error: `Layout run failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
