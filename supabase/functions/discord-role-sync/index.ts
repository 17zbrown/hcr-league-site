// discord-role-sync — resolves the signed-in user's portal access from their
// roles in the league's Discord server.
//
// Called right after a Discord sign-in. Reads the caller's Discord id from their
// auth identity, asks the Discord API which roles they hold in the guild, and
// maps the configured role ids to a site role (admin > race_control > member).
//
// It also sets their server nickname to "<iRacing name> #<car number>", because
// signing in is the one moment the site knows both which Discord account is asking
// and what the driver last told us about themselves. Everything about that half is
// best-effort: a rename that fails is reported next to a successful sign-in and
// never turned into an error, since portal access must not depend on it.
//
// Secret required: DISCORD_BOT_TOKEN (the bot must be IN the guild, and needs
// Manage Nicknames — it can never rename the server owner, and can only rename
// members ranked below its own highest role).
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
  let currentNick: string | null = null
  try {
    const res = await fetch(`${DISCORD}/guilds/${cfg.guild_id}/members/${discordId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    })
    if (res.status === 404) return json({ error: 'You are not a member of the league Discord server.' }, 403)
    if (!res.ok) return json({ error: `Discord API ${res.status}` }, 502)
    const member = await res.json()
    roles = Array.isArray(member?.roles) ? member.roles : []
    currentNick = typeof member?.nick === 'string' ? member.nick : null
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502)
  }

  // --- nickname: their iRacing name and car number, e.g. "Tyler Fulk #411" ------
  //
  // Signing in is the natural moment for this: it is the one point where the site
  // knows both who the Discord account is and what the driver most recently told us
  // about themselves, so the two can be reconciled without anybody asking.
  //
  // NOTHING HERE MAY BREAK SIGNING IN. A rename is a nicety; portal access is not.
  // Every failure below is caught and reported alongside a successful sign-in rather
  // than surfaced as an error, which is also why this sits after the member fetch and
  // before nothing — the role mapping underneath it must still run.
  const nickname = await (async (): Promise<Record<string, unknown>> => {
    try {
      const { data: want } = await db.rpc('discord_nickname_for', { p_user: user.id })
      const desired = typeof want === 'string' ? want.trim() : ''
      // No iRacing name on file means leave them alone. Blanking or half-forming
      // somebody's nickname is worse than whatever they chose for themselves.
      if (!desired) return { changed: false, reason: 'no iRacing name on file yet' }
      if ((currentNick ?? '') === desired) return { changed: false, reason: 'already correct', nick: desired }

      const res = await fetch(`${DISCORD}/guilds/${cfg.guild_id}/members/${discordId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick: desired }),
      })
      if (res.ok) return { changed: true, from: currentNick, nick: desired }
      // 403 is the expected, permanent outcome for two people rather than a fault:
      // Discord lets nobody rename the server owner, and lets the bot rename only
      // members ranked below its own highest role.
      if (res.status === 403) {
        return { changed: false, nick: desired,
                 reason: 'Discord will not let the bot rename this member — the server owner and anyone ranked above the bot are off limits' }
      }
      return { changed: false, nick: desired, reason: `Discord API ${res.status}` }
    } catch (e) {
      return { changed: false, reason: String((e as Error)?.message ?? e) }
    }
  })()

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
    return json({ ok: true, role: 'admin', protected: true, discord_roles: roles.length, nickname })
  }

  const { error } = await db.from('profiles').update({ role }).eq('id', user.id)
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true, role, discord_roles: roles.length, nickname })
})
