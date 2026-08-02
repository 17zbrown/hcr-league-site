// discord-role-reconcile — keeps the site in step with roles edited by hand in Discord.
//
// discord-role-sync only fires when somebody signs in, so a promotion handed out in
// Discord at midnight wouldn't reach the site until that person next logged in. This
// function closes the gap from the other end: it walks the guild's member list, works
// out what each linked profile's site role ought to be, and writes back only the ones
// that actually moved. It runs on a five-minute pg_cron schedule and an admin can also
// press it from the panel.
//
// It only ever sends GET to Discord — there is no code path in here capable of changing
// the server, and nothing is ever deleted. The single write is profiles.role.
//
// Callable two ways, mirroring public.assert_admin_or_cron: if you ARE authenticated you
// must be an admin, while an unauthenticated call is let through (that's cron). A JWT we
// can't read is the only 401. For the no-JWT path to reach this code the function must be
// deployed with verify_jwt off; a cron job that sends the service-role key works either way.
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

// A big server shouldn't be able to hang a job that runs every five minutes, so the
// member walk is capped — same ceiling the audit uses.
const MEMBER_PAGE = 1000
const MAX_MEMBER_PAGES = 5
// Matching ceiling on the profile side, and it keeps the PostgREST URL sane below.
const MAX_PROFILES = 5000
// Ids go into an `in.(…)` filter, which lives in the query string. Chunk it.
const UPDATE_CHUNK = 200

type SiteRole = 'member' | 'race_control' | 'admin'
// Ranked so "never lower an is_admin profile" is a comparison rather than a guess.
const RANK: Record<SiteRole, number> = { member: 0, race_control: 1, admin: 2 }
const asRole = (v: unknown): SiteRole => (v === 'admin' || v === 'race_control' ? v : 'member')

interface Member {
  user?: { id?: string | null } | null
  roles?: string[] | null
}
interface ProfileRow {
  id: string
  discord_user_id: string | null
  discord_username: string | null
  role: string | null
  is_admin: boolean | null
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

// Every Discord call goes through here, and it can only ever do one thing: GET.
// It never throws, it retries a rate limit (bounded, never forever), and it hands
// back Discord's own explanation of a refusal.
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

const badToken = 'Discord rejected the bot token — check the DISCORD_BOT_TOKEN secret in Supabase.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

    // --- auth: an admin, or cron ---
    // No bearer token at all means nobody is claiming to be anybody — that's the cron
    // path. The service-role key is the same thing wearing a badge: whoever holds it
    // already owns the database, so there is no user to look up. Anything else is a
    // person, and a person has to be an admin.
    const authz = req.headers.get('Authorization') ?? ''
    const bearer = authz.replace(/^Bearer\s+/i, '').trim()
    const viaCron = !bearer || bearer === service

    if (!viaCron) {
      const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } })
      const { data: userData } = await userClient.auth.getUser()
      const user = userData?.user
      // A JWT arrived but resolves to nobody — expired, malformed, or the bare anon key.
      if (!user) return json({ error: 'Not authenticated' }, 401)
      const { data: prof } = await userClient.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
      if (!prof?.is_admin) return json({ error: 'Admins only' }, 403)
    }

    // --- config (service role bypasses RLS) ---
    const db = createClient(url, service)
    const { data: cfg } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    if (!cfg.auto_sync_roles) return json({ skipped: 'Automatic role sync is switched off.' })
    if (!cfg.guild_id) return json({ skipped: 'No Discord server is configured yet.' })
    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    const guildId = String(cfg.guild_id).trim()
    const adminRole = String(cfg.role_site_admin ?? '').trim()
    const rcRole = String(cfg.role_site_race_control ?? '').trim()

    // With neither staff role id saved, every single profile resolves to 'member' and a
    // job that runs unattended every five minutes would quietly strip the whole staff.
    // A blank config is a config problem, not a Discord change — refuse rather than obey.
    if (!adminRole && !rcRole) {
      return json({
        skipped:
          'Neither the Admin nor the Race Control role id is set, so every profile would resolve to member. Refusing to mass-demote — set the staff role ids in Admin → Discord first.',
      })
    }

    // --- 2. the profiles that could be affected ---
    const { data: profileRows, error: profErr } = await db
      .from('profiles')
      .select('id, discord_user_id, discord_username, role, is_admin')
      .not('discord_user_id', 'is', null)
      .limit(MAX_PROFILES)
    if (profErr) return json({ error: `Could not read the profiles — ${profErr.message}` }, 500)

    const profiles = ((profileRows ?? []) as ProfileRow[]).filter((p) => p?.id && (p.discord_user_id ?? '').trim())
    if (!profiles.length) {
      // Nobody has linked a Discord account, so there is nothing to ask Discord about.
      return json({ ok: true, checked: 0, changed: [], skipped_protected: 0, left_guild: 0 })
    }

    // --- 3. who holds what in the guild ---
    // Paged with ?after= (member ids come back ascending), stopping at the first short
    // page or the page cap, whichever lands first.
    const heldRoles = new Map<string, Set<string>>()
    let membersScanned = 0
    let reachedEnd = false
    let after = '0'
    let pages = 0

    while (pages < MAX_MEMBER_PAGES) {
      const res = await discordGet<Member[]>(`/guilds/${guildId}/members?limit=${MEMBER_PAGE}&after=${after}`, botToken)
      if (!res.ok) {
        // A half-read guild is worse than no read at all — it would look like people
        // left. Bail with nothing written.
        if (res.status === 401) return json({ error: badToken }, 400)
        if (res.status === 403) {
          return json(
            {
              error:
                'Discord refused the member list (403) — enable the Server Members Intent for the bot in the Discord Developer Portal. No roles were changed.',
            },
            502,
          )
        }
        return json({ error: `Could not read the server's members — ${res.message}. No roles were changed.` }, 502)
      }
      pages++
      const batch = Array.isArray(res.data) ? res.data : []
      for (const m of batch) {
        const uid = m?.user?.id
        if (!uid) continue
        membersScanned++
        heldRoles.set(
          String(uid),
          new Set(Array.isArray(m.roles) ? m.roles.filter((r): r is string => typeof r === 'string' && !!r) : []),
        )
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
      after = String(last)
    }

    // A capped walk didn't fail — it just didn't look at everyone. Members on the pages
    // we never fetched must NOT be read as having left the guild, or a big server would
    // demote its tail every five minutes. When the walk stops early we reconcile only
    // the members we actually saw.
    const capped = !reachedEnd

    // --- 4/5. what should each profile be? ---
    const changes: { id: string; discord_username: string | null; from: SiteRole; to: SiteRole }[] = []
    let checked = 0
    let skippedProtected = 0
    let leftGuild = 0
    let unchecked = 0

    for (const p of profiles) {
      const did = String(p.discord_user_id).trim()
      const held = heldRoles.get(did)

      if (!held) {
        if (capped) {
          // Absent from a partial scan proves nothing.
          unchecked++
          continue
        }
        leftGuild++
      }

      checked++
      const current = asRole(p.role)
      // Highest wins, and somebody Discord no longer returns holds nothing at all.
      let desired: SiteRole = 'member'
      if (held) {
        if (rcRole && held.has(rcRole)) desired = 'race_control'
        if (adminRole && held.has(adminRole)) desired = 'admin'
      }

      if (desired === current) continue

      // Lockout guard, same as discord-role-sync: profiles.is_admin is the hard owner
      // flag, set out-of-band and never derived from Discord. If a wrong role id would
      // demote a permanent admin, leave them where they are — that flag is the league
      // owner's way back into the portal that fixes the wrong id.
      if (p.is_admin === true && RANK[desired] < RANK[current]) {
        skippedProtected++
        continue
      }

      changes.push({ id: p.id, discord_username: p.discord_username ?? null, from: current, to: desired })
    }

    // --- 6. write back only what moved ---
    // Grouped by target role and chunked, so a normal five-minute run is zero
    // statements and even a config-wide correction is a handful.
    const applied: typeof changes = []
    let writeError: string | null = null

    const byRole = new Map<SiteRole, typeof changes>()
    for (const c of changes) byRole.set(c.to, [...(byRole.get(c.to) ?? []), c])

    outer: for (const [role, group] of byRole) {
      for (let i = 0; i < group.length; i += UPDATE_CHUNK) {
        const slice = group.slice(i, i + UPDATE_CHUNK)
        const { error } = await db.from('profiles').update({ role }).in('id', slice.map((c) => c.id))
        if (error) {
          writeError = `Could not save the role changes — ${error.message}`
          break outer
        }
        applied.push(...slice)
      }
    }

    // The change list names people. An admin who pressed the button should see who
    // moved; an unauthenticated cron call gets the same shape with the identities left
    // out, because nothing on that end is reading them.
    const changedOut = applied.map((c) => ({
      id: viaCron ? null : c.id,
      discord_username: viaCron ? null : c.discord_username,
      from: c.from,
      to: c.to,
    }))

    const body: Record<string, unknown> = {
      ok: !writeError,
      checked,
      changed: changedOut,
      skipped_protected: skippedProtected,
      left_guild: leftGuild,
      members_scanned: membersScanned,
      scan_capped: capped,
    }
    if (capped) {
      body.unchecked = unchecked
      body.note = `Stopped after ${membersScanned} members (${MAX_MEMBER_PAGES} pages of ${MEMBER_PAGE}) so a large server can't hang the job. ${unchecked} linked profile${unchecked === 1 ? ' was' : 's were'} left alone rather than assumed to have left the server.`
    }
    if (writeError) return json({ ...body, error: writeError }, 500)

    return json(body)
  } catch (e) {
    // Nothing above should throw, but a 500 with a readable message beats a stack trace.
    return json({ error: `Discord role reconcile failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
