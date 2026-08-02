// discord-provision — one-click setup of the league's Discord server. Admin-only.
//
// Finds the server the bot is in, then find-or-creates the license roles, the
// three announcement channels and a posting webhook for each, and writes every
// id back into discord_config / discord_webhooks. Safe to run as many times as
// you like: anything that already exists is adopted, never duplicated.
//
// Two things it deliberately does NOT do: create the staff roles (Admin / Race
// Control carry real power, so they're matched only) and flip `enabled` — that
// switch stays the admin's.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
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

interface Guild {
  id: string
  name: string
}
interface Role {
  id: string
  name: string
  managed?: boolean
}
interface Channel {
  id: string
  name: string
  type: number
}
interface Webhook {
  id: string
  name?: string | null
  type?: number
  token?: string | null
  url?: string | null
}

// License roles are ours to create. Colours are the metals, not the brand yellow —
// the brand colour is reserved for embeds so it stays a signal, not decoration.
const LICENSE_ROLES = [
  { key: 'role_bronze', name: 'Bronze', aliases: ['bronze', 'hcr bronze'], color: 0xcd7f32 },
  { key: 'role_silver', name: 'Silver', aliases: ['silver', 'hcr silver'], color: 0xc0c0c0 },
  { key: 'role_gold', name: 'Gold', aliases: ['gold', 'hcr gold'], color: 0xffd700 },
  { key: 'role_platinum', name: 'Platinum', aliases: ['platinum', 'hcr platinum'], color: 0xe5e4e2 },
]

// Staff roles decide who gets the Admin / Race Control portal. Matched only —
// a role this function invented could hand out the keys to the site.
const STAFF_ROLES = [
  { key: 'role_site_admin', label: 'Admin', aliases: ['commissioner', 'admin', 'league admin', 'hcr admin'] },
  {
    key: 'role_site_race_control',
    label: 'Race Control',
    aliases: ['race control', 'steward', 'stewards', 'race director'],
  },
]

const WANTED_CHANNELS = [
  { key: 'channel_results', webhookKey: 'results', name: 'race-results' },
  { key: 'channel_standings', webhookKey: 'standings', name: 'standings' },
  { key: 'channel_license_ups', webhookKey: 'license_ups', name: 'license-ups' },
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

    // --- config (service role bypasses RLS; discord_webhooks has no policies at all) ---
    const db = createClient(url, service)
    const { data: cfgRow } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    const cfg = (cfgRow ?? null) as Record<string, unknown> | null
    const configured = (key: string) => String(cfg?.[key] ?? '').trim()

    const warnings: string[] = []
    const patch: Record<string, unknown> = {}
    let hierarchyHint = false

    // --- 1. which server? ---
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
              'The bot is not in any server yet — invite it first (Discord Developer Portal → OAuth2 → URL Generator, scopes "bot" + "applications.commands"), then run setup again.',
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
            'The bot is in more than one server, so setup stopped rather than guess. Paste the right server (guild) ID into Admin → Discord, save, then run setup again.',
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

    // --- 2. roles ---
    const rolesRes = await discord<Role[]>(`/guilds/${guildId}/roles`, 'GET', botToken)
    if (!rolesRes.ok) {
      if (rolesRes.status === 403) {
        return json({ error: "Discord refused to list the server's roles — the bot needs the Manage Roles permission." }, 400)
      }
      return json({ error: `Could not read the server's roles — ${rolesRes.message}` }, 502)
    }
    const roles = (rolesRes.data ?? []).filter((r) => r?.id)
    // An id already saved in the panel is honoured whatever kind of role it is —
    // that's the admin's explicit choice. Name matching is fussier: it skips
    // @everyone and bot-managed roles, since neither can be handed to a driver.
    const rolesById = new Map(roles.map((r) => [r.id, r]))
    const matchable = roles.filter((r) => r.name !== '@everyone' && !r.managed)
    const matchRole = (aliases: string[]) =>
      matchable.find((r) => aliases.includes((r.name ?? '').trim().toLowerCase())) ?? null

    const roleReport: { key: string; name: string; id: string; created: boolean }[] = []

    for (const want of LICENSE_ROLES) {
      // Order matters: an id already in the panel wins over a name match, so an
      // admin's manual choice survives every re-run.
      const saved = configured(want.key)
      let role: Role | null = (saved ? rolesById.get(saved) : null) ?? matchRole(want.aliases)
      let created = false

      if (!role) {
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
      roleReport.push({ key: want.key, name: role.name || want.name, id: role.id, created })
    }

    const missingStaffRoles: string[] = []
    for (const want of STAFF_ROLES) {
      const saved = configured(want.key)
      const role: Role | null = (saved ? rolesById.get(saved) : null) ?? matchRole(want.aliases)
      if (!role) {
        missingStaffRoles.push(want.key)
        warnings.push(
          `No ${want.label} role found (looked for: ${want.aliases.join(', ')}). Setup never creates staff roles — make it in Discord, then paste its ID into Admin → Discord.`,
        )
        continue
      }
      patch[want.key] = role.id
      roleReport.push({ key: want.key, name: role.name, id: role.id, created: false })
    }

    // --- 3. channels ---
    const chRes = await discord<Channel[]>(`/guilds/${guildId}/channels`, 'GET', botToken)
    if (!chRes.ok) {
      if (chRes.status === 403) {
        return json({ error: "Discord refused to list the server's channels — the bot needs the View Channels permission." }, 400)
      }
      return json({ error: `Could not read the server's channels — ${chRes.message}` }, 502)
    }
    // type 0 = text, 5 = announcement, 15 = forum. All three take webhooks, so
    // all three are adoptable. Forums matter especially: discord-rebuild creates
    // race-results and incident-protests as forums, and leaving 15 out of this
    // list made setup blind to them — it decided race-results was missing,
    // created a duplicate plain-text one at the top level, and repointed the
    // config and its webhook at the empty duplicate.
    const channels = (chRes.data ?? []).filter((c) => c?.id && (c.type === 0 || c.type === 5 || c.type === 15))
    const channelsById = new Map(channels.map((c) => [c.id, c]))

    const resolved: { key: string; webhookKey: string; name: string; id: string; created: boolean }[] = []

    for (const want of WANTED_CHANNELS) {
      const saved = configured(want.key)
      let channel: Channel | null =
        (saved ? channelsById.get(saved) : null) ??
        channels.find((c) => (c.name ?? '').trim().toLowerCase() === want.name) ??
        null
      let created = false

      if (!channel) {
        const made = await discord<Channel>(`/guilds/${guildId}/channels`, 'POST', botToken, {
          name: want.name,
          type: 0,
        })
        if (!made.ok) {
          warnings.push(
            made.status === 403
              ? `Discord refused to create #${want.name} — give the bot the Manage Channels permission in Server Settings → Roles.`
              : `Could not create #${want.name} — ${made.message}`,
          )
          continue
        }
        channel = made.data
        created = true
      }

      if (!channel?.id) continue
      patch[want.key] = channel.id
      resolved.push({ key: want.key, webhookKey: want.webhookKey, name: channel.name || want.name, id: channel.id, created })
    }

    // --- 4. webhooks (service-role only — a webhook URL is a bearer token) ---
    const webhookReport: { channel_key: string; created: boolean }[] = []

    for (const ch of resolved) {
      const listed = await discord<Webhook[]>(`/channels/${ch.id}/webhooks`, 'GET', botToken)
      if (!listed.ok) {
        warnings.push(
          listed.status === 403
            ? `Discord refused to read the webhooks in #${ch.name} — give the bot the Manage Webhooks permission.`
            : `Could not read the webhooks in #${ch.name} — ${listed.message}`,
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

      if (!hook) {
        const made = await discord<Webhook>(`/channels/${ch.id}/webhooks`, 'POST', botToken, { name: WEBHOOK_NAME })
        if (!made.ok) {
          warnings.push(
            made.status === 403
              ? `Discord refused to create a webhook in #${ch.name} — give the bot the Manage Webhooks permission.`
              : `Could not create the webhook for #${ch.name} — ${made.message}`,
          )
          continue
        }
        hook = made.data
        created = true
      }

      const hookUrl = hook?.url || (hook?.id && hook?.token ? `${WEBHOOK_BASE}/${hook.id}/${hook.token}` : null)
      if (!hook?.id || !hookUrl) {
        warnings.push(
          `Discord returned a webhook for #${ch.name} with no token — delete the "${WEBHOOK_NAME}" webhook under Channel Settings → Integrations and run setup again.`,
        )
        continue
      }

      const now = new Date().toISOString()
      const { error: hookErr } = await db.from('discord_webhooks').upsert(
        {
          channel_key: ch.webhookKey,
          channel_id: ch.id,
          webhook_id: hook.id,
          webhook_url: hookUrl,
          updated_at: now,
        },
        { onConflict: 'channel_key' },
      )
      if (hookErr) {
        warnings.push(`Made the #${ch.name} webhook in Discord but could not save it — ${hookErr.message}`)
        continue
      }
      webhookReport.push({ channel_key: ch.webhookKey, created })
    }

    // --- 5. save (upsert so a missing singleton row is created, and so that
    // `enabled` — the admin's switch — is never part of the write) ---
    const stamp = new Date().toISOString()
    patch.guild_id = guildId
    if (guildName) patch.guild_name = guildName
    patch.provisioned_at = stamp
    patch.updated_at = stamp

    const { error: saveErr } = await db.from('discord_config').upsert({ id: 1, ...patch }, { onConflict: 'id' })
    if (saveErr) {
      return json({ error: `Discord setup ran, but saving the IDs failed — ${saveErr.message}` }, 500)
    }

    // --- 6. report (never any webhook URLs) ---
    return json({
      ok: true,
      guild: { id: guildId, name: guildName || null },
      roles: roleReport,
      channels: resolved.map((c) => ({ key: c.key, name: c.name, id: c.id, created: c.created })),
      webhooks: webhookReport,
      missing_staff_roles: missingStaffRoles,
      warnings,
      hierarchyHint,
    })
  } catch (e) {
    // Nothing above should throw, but a 500 with a readable message beats a stack trace.
    return json({ error: `Discord setup failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
