// discord-role-sync — resolves the signed-in user's portal access from their
// roles in the league's Discord server.
//
// Called right after a Discord sign-in. Reads the caller's Discord id from their
// auth identity, asks the Discord API which roles they hold in the guild, and
// maps the configured role ids to a site role (admin > race_control > member).
//
// Secret required: DISCORD_BOT_TOKEN (the bot must be IN the guild).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

  // --- who is calling? ---
  const authz = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } })
  const { data: userData } = await userClient.auth.getUser()
  const user = userData?.user
  if (!user) return json({ error: 'Not authenticated' }, 401)

  // Discord id from the linked identity (falls back to OAuth metadata)
  const identity = (user.identities ?? []).find((i) => i.provider === 'discord')
  const discordId =
    (identity?.id as string | undefined) ??
    (user.user_metadata?.provider_id as string | undefined) ??
    (user.user_metadata?.sub as string | undefined)
  const discordName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    (user.user_metadata?.user_name as string | undefined) ??
    null
  const avatar = (user.user_metadata?.avatar_url as string | undefined) ?? null

  const db = createClient(url, service)

  // Always record what we know about the identity, even if role sync is off.
  if (discordId) {
    await db
      .from('profiles')
      .update({ discord_user_id: discordId, discord_username: discordName, avatar_url: avatar })
      .eq('id', user.id)
  }

  const { data: cfg } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
  if (!cfg?.enabled || !cfg?.auto_sync_roles) return json({ skipped: 'Discord role sync is disabled.', role: null })
  if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)
  if (!cfg.guild_id) return json({ error: 'No guild_id configured.' }, 400)
  if (!discordId) return json({ error: 'This account has no linked Discord identity.' }, 400)

  // --- what roles do they hold in the guild? ---
  let roles: string[] = []
  try {
    const res = await fetch(`${DISCORD}/guilds/${cfg.guild_id}/members/${discordId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    })
    if (res.status === 404) return json({ error: 'You are not a member of the league Discord server.' }, 403)
    if (!res.ok) return json({ error: `Discord API ${res.status}` }, 502)
    const member = await res.json()
    roles = Array.isArray(member?.roles) ? member.roles : []
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502)
  }

  // --- map to a site role (highest wins) ---
  let role: 'member' | 'race_control' | 'admin' = 'member'
  if (cfg.role_site_race_control && roles.includes(cfg.role_site_race_control)) role = 'race_control'
  if (cfg.role_site_admin && roles.includes(cfg.role_site_admin)) role = 'admin'

  // Lockout guard: profiles.is_admin is the hard owner flag, set out-of-band and
  // never derived from Discord. If a misconfigured guild/role id would demote a
  // permanent admin, leave their role alone — otherwise a bad id in the panel
  // could strip the league owner of the portal that fixes it.
  const { data: me } = await db.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (me?.is_admin && role !== 'admin') {
    return json({ ok: true, role: 'admin', protected: true, discord_roles: roles.length })
  }

  const { error } = await db.from('profiles').update({ role }).eq('id', user.id)
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true, role, discord_roles: roles.length })
})
