// discord-sync — recompute every driver's license from results, and for anyone
// whose tier changed: swap their Discord license role (Bronze→Silver, …) and
// announce promotions in #license-ups. Admin-only. Safe to run repeatedly.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  buildPaceIndex,
  computeLicense,
  LICENSE_ORDER,
  resultsForDriver,
  type License,
} from '../_shared/license.ts'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

interface DiscordConfig {
  enabled: boolean
  guild_id: string | null
  role_bronze: string | null
  role_silver: string | null
  role_gold: string | null
  role_platinum: string | null
  channel_license_ups: string | null
}

const rank = (t: License) => LICENSE_ORDER.indexOf(t)

async function discord(path: string, method: string, token: string, body?: unknown) {
  const res = await fetch(`${DISCORD}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  // 204 = success with no content (role add/remove). 429 = rate limited.
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after') ?? '1')
    await new Promise((r) => setTimeout(r, (retry + 0.25) * 1000))
    return discord(path, method, token, body)
  }
  return res
}

/**
 * Is this a legacy service-role JWT? Only consulted for a token the gateway has
 * already signature-checked (verify_jwt is on), so reading the claim is sound. Needed
 * because the runtime's SUPABASE_SERVICE_ROLE_KEY is an sb_secret_ string while the
 * scheduler sends the dashboard's legacy JWT — both are the scheduler.
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

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

  // --- auth: a signed-in admin, or the scheduler ---
  // This function had no cron path at all: every scheduled run presented the
  // service-role credential, fell into the user branch, failed getUser(), and logged
  // "Not authenticated" — every five minutes, forever. The cron check requires a
  // NON-EMPTY service-role bearer; an absent token is never the scheduler (that
  // shortcut was an auth bypass in sibling functions once already).
  const authz = req.headers.get('Authorization') ?? ''
  const bearer = authz.replace(/^Bearer\s+/i, '').trim()
  const viaCron = bearer.length > 0 && (bearer === service || isServiceRoleJwt(bearer))
  if (!viaCron) {
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } })
    const { data: userData } = await userClient.auth.getUser()
    const user = userData?.user
    if (!user) return json({ error: 'Not authenticated' }, 401)
    const { data: prof } = await userClient.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
    if (!prof?.is_admin) return json({ error: 'Admins only' }, 403)
  }

  // --- data (service role bypasses RLS) ---
  const db = createClient(url, service)
  const { data: cfg } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle<DiscordConfig>()
  if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
  if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

  const roleFor: Record<License, string | null> = {
    Bronze: cfg.role_bronze,
    Silver: cfg.role_silver,
    Gold: cfg.role_gold,
    Platinum: cfg.role_platinum,
  }

  const { data: drivers } = await db
    .from('drivers')
    .select('id, name, discord_user_id, license_current, license_override')
  const { data: results } = await db
    .from('results')
    .select('drivers_text, event_id, class_id, cls_pos, quali_pos, grid, inc, laps, best_lap, status')

  const paceIndex = buildPaceIndex(results ?? [])

  const changed: { name: string; from: string | null; to: License; promoted: boolean; roleSynced: boolean }[] = []

  for (const d of drivers ?? []) {
    const rows = resultsForDriver(results ?? [], d.name)
    const tier = computeLicense(rows, paceIndex, d.license_override)
    const prev = d.license_current as License | null
    if (tier === prev) continue

    // persist the new tier
    await db.from('drivers').update({ license_current: tier }).eq('id', d.id)

    // swap Discord roles if the driver is linked and the guild/roles are set
    let roleSynced = false
    if (cfg.guild_id && d.discord_user_id && roleFor[tier]) {
      try {
        // add the new tier role
        await discord(`/guilds/${cfg.guild_id}/members/${d.discord_user_id}/roles/${roleFor[tier]}`, 'PUT', botToken)
        // remove the other three license roles
        for (const t of LICENSE_ORDER) {
          if (t !== tier && roleFor[t]) {
            await discord(`/guilds/${cfg.guild_id}/members/${d.discord_user_id}/roles/${roleFor[t]}`, 'DELETE', botToken)
          }
        }
        roleSynced = true
      } catch (_) {
        roleSynced = false
      }
    }

    const promoted = prev != null && rank(tier) > rank(prev)
    changed.push({ name: d.name, from: prev, to: tier, promoted, roleSynced })
  }

  // announce promotions (skip first-time initialisation where prev was null)
  const promos = changed.filter((c) => c.promoted)
  if (promos.length && cfg.channel_license_ups) {
    const lines = promos.map((c) => `🎖️ **${c.name}** earned their **${c.to}** license${c.from ? ` (up from ${c.from})` : ''}!`)
    try {
      await discord(`/channels/${cfg.channel_license_ups}/messages`, 'POST', botToken, {
        embeds: [
          {
            title: promos.length === 1 ? 'License Promotion' : 'License Promotions',
            description: lines.join('\n'),
            color: 0xf2e114,
            footer: { text: 'HCR League · earned from race pace, safety & results' },
          },
        ],
      })
    } catch (_) { /* non-fatal */ }
  }

  return json({
    ok: true,
    checked: drivers?.length ?? 0,
    changed: changed.length,
    promotions: promos.length,
    detail: changed,
  })
})
