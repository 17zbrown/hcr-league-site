// discord-driver-roles — keeps every LINKED member's Discord presence matching the
// entry list: exactly one class role, Spectator only when seatless, and a nickname
// of "Name #car".
//
// THE ENTRY LIST IS THE TRUTH, NOT RACE HISTORY. The first version of this derived
// classes from results.class_id, which meant a driver kept a role for every class
// they had ever raced and the function could never remove anything — by the fourth
// round the server showed 50 class-role holders against a 37-car grid, with GTD's
// role alone exceeding the entire GTD roster. What a member's roles should say is
// what they run NOW, and entries + entry_drivers for the current season is the one
// table that knows.
//
// SCOPED TO LINKED DRIVERS, DELIBERATELY. A member with no drivers.discord_user_id
// pointing at them is never touched — not renamed, not stripped, not granted. Their
// roles may well be wrong, but an unlinked member's class role is a human's claim
// about who they are, and revoking it on no evidence destroys the only record tying
// them to a class. The linker closes that gap member by member, and every link
// brings one more person under this function's care. Unlinked members holding
// contradictory roles are REPORTED, so the queue is visible while it drains.
//
// WHAT RECONCILE MEANS, per linked driver in the server:
//   seated  → their entry's class role ON, every other class role OFF, Spectator
//             OFF, nickname "Name #car" (registration iRacing name first, roster
//             name as fallback; the name is trimmed to Discord's 32, never the
//             number).
//   seatless → every class role OFF, Spectator ON. No nickname change — there is
//             no number to show, and stripping a name is not this function's call.
//
// Licence tiers are still NOT handled here. discord-sync owns those.
//
// The nickname of the SERVER OWNER cannot be changed by any bot — Discord refuses
// regardless of permissions — so the owner is skipped with a note rather than a
// warning that reads like something is broken.
//
// Callable two ways, mirroring public.assert_admin_or_cron: an admin, or cron.
// Cron must present a service-role credential; there is no unauthenticated path.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs **Manage Roles** and **Manage Nicknames**, and its own role must sit
// ABOVE GTP, LMP2, GTD and Spectator in Server Settings → Roles.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const MEMBER_PAGE = 1000
const MAX_MEMBER_PAGES = 5
const MAX_DRIVERS = 5000
const NICK_MAX = 32

const SNOWFLAKE = /^\d{5,25}$/

interface DriverRow {
  id: string
  name: string | null
  discord_user_id: string | null
}
interface Member {
  nick?: string | null
  roles?: string[] | null
  user?: { id?: string | null; bot?: boolean | null } | null
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

// GET to read, PUT/DELETE for roles, PATCH for nicknames. This function is a
// reconciler now: removal is part of the contract, bounded to the class roles and
// Spectator on LINKED members and to nothing else.
async function discord<T>(
  path: string,
  method: 'GET' | 'PUT' | 'DELETE' | 'PATCH',
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
const quote = (s: string) => `"${s}"`

/**
 * "Name #car", capped at Discord's 32 characters by trimming the NAME, never the
 * number — "Francisco Morales Rodrig… #16" still identifies the car, which is the
 * half race control actually greps for. Mirrors public.discord_nickname_for; if one
 * changes, change the other.
 */
function nicknameFor(name: string, num: string): string {
  const suffix = num ? ` #${num}` : ''
  if (name.length + suffix.length <= NICK_MAX) return name + suffix
  return name.slice(0, Math.max(1, NICK_MAX - suffix.length)).trimEnd() + suffix
}

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

    // This function removes things now, so dryRun is worth reaching for: it reports
    // every change it would make and touches nothing.
    let dryRun = false
    try {
      const body = await req.json()
      if (body && typeof body === 'object' && (body as { dryRun?: unknown }).dryRun === true) dryRun = true
    } catch (_) { /* empty body — default stands */ }

    // --- auth: an admin, or cron ---
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
    const { data: cfgRow, error: cfgErr } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    if (cfgErr) return json({ error: `Could not read the Discord config — ${cfgErr.message}` }, 500)
    const cfg = (cfgRow ?? null) as Record<string, unknown> | null
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    // The same switch the linker honours: an admin who turned off "set roles
    // automatically" would not expect this function to keep enforcing them.
    if (!cfg.auto_sync_roles) return json({ skipped: 'Automatic role sync is switched off.' })
    const guildId = String(cfg.guild_id ?? '').trim()
    if (!guildId) return json({ skipped: 'No Discord server is configured yet.' })
    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    const warnings: string[] = []
    const spectatorRole = SNOWFLAKE.test(String(cfg.role_spectator ?? '').trim())
      ? String(cfg.role_spectator).trim()
      : ''
    if (!spectatorRole) {
      warnings.push('No Spectator role id is saved in config, so seatless linked drivers keep whatever they hold.')
    }

    // --- class -> role ---
    const classRoles = new Map<string, string>()
    {
      const { data: rows, error } = await db.from('discord_class_roles').select('class_id, role_id')
      if (error) return json({ error: `Could not read the class-role mapping — ${error.message}. Nothing was changed.` }, 500)
      for (const r of (rows ?? []) as { class_id?: string | null; role_id?: string | null }[]) {
        const cid = String(r?.class_id ?? '').trim()
        const rid = String(r?.role_id ?? '').trim()
        // The column has a check constraint for this, but the id is about to be
        // interpolated into a request path, so it gets checked here too.
        if (cid && SNOWFLAKE.test(rid)) classRoles.set(cid, rid)
      }
    }
    if (classRoles.size === 0) {
      return json({ skipped: 'No classes are mapped to Discord roles, so there is nothing to reconcile.' })
    }
    const classRoleIds = new Set(classRoles.values())

    // --- the season, the seats, and the names to show ---
    const { data: season, error: seasonErr } = await db
      .from('seasons').select('id').eq('is_current', true).limit(1).maybeSingle()
    if (seasonErr || !season?.id) {
      return json({ error: `Could not find the current season — ${seasonErr?.message ?? 'no season is marked current'}. Nothing was changed.` }, 500)
    }

    // driver id -> their car this season. One seat per driver is an invariant the
    // site enforces; if data ever breaks it, first seat wins and it is reported.
    const seatOf = new Map<string, { class_id: string; number: string }>()
    {
      const { data: seatRows, error } = await db
        .from('entry_drivers')
        .select('driver_id, entries!inner(season_id, class_id, number)')
        .eq('entries.season_id', season.id)
      if (error) return json({ error: `Could not read the entry list — ${error.message}. Nothing was changed.` }, 500)
      for (const r of (seatRows ?? []) as { driver_id?: string | null; entries?: { class_id?: string | null; number?: string | null } | null }[]) {
        const did = String(r?.driver_id ?? '').trim()
        const cls = String(r?.entries?.class_id ?? '').trim()
        const num = String(r?.entries?.number ?? '').trim()
        if (!did || !cls) continue
        if (seatOf.has(did)) {
          warnings.push(`Driver ${did} appears on more than one current-season entry; the first seat read was used.`)
          continue
        }
        seatOf.set(did, { class_id: cls, number: num })
      }
    }

    // driver id -> the iRacing name they registered with, when they registered.
    // The roster name is the fallback: it came off a results PDF and is close, but
    // the registration name is the one they typed as their own.
    const iracingNameOf = new Map<string, string>()
    {
      const { data: regRows, error } = await db
        .from('season_registrations')
        .select('driver_id, iracing_name')
        .eq('season_id', season.id)
        .not('driver_id', 'is', null)
      if (error) warnings.push(`Could not read registrations for nickname names — ${error.message}. Roster names were used instead.`)
      for (const r of (regRows ?? []) as { driver_id?: string | null; iracing_name?: string | null }[]) {
        const did = String(r?.driver_id ?? '').trim()
        const nm = String(r?.iracing_name ?? '').trim()
        if (did && nm) iracingNameOf.set(did, nm)
      }
    }

    // --- drivers who already have a Discord account attached ---
    const { data: driverRows, error: drvErr } = await db
      .from('drivers')
      .select('id, name, discord_user_id')
      .not('discord_user_id', 'is', null)
      .limit(MAX_DRIVERS)
    if (drvErr) return json({ error: `Could not read the drivers — ${drvErr.message}. Nothing was changed.` }, 500)
    const drivers = ((driverRows ?? []) as DriverRow[]).filter((d) => SNOWFLAKE.test(String(d.discord_user_id ?? '')))
    if (drivers.length === 0) {
      return json({
        skipped: 'No driver has a Discord account attached yet. Run "Link drivers" first — it works out who is who.',
      })
    }

    // --- the owner, whose nickname no bot can touch ---
    let ownerId = ''
    {
      const g = await discord<{ owner_id?: string | null }>(`/guilds/${guildId}`, 'GET', botToken)
      if (g.ok) ownerId = String(g.data?.owner_id ?? '').trim()
      // A failed read just means an owner rename attempt would 403 and be reported;
      // not worth stopping the run over.
    }

    // --- who is in the server, and what do they hold ---
    const membersById = new Map<string, { nick: string | null; roles: Set<string> }>()
    let after = '0'
    let pages = 0
    let reachedEnd = false
    while (pages < MAX_MEMBER_PAGES) {
      const res = await discord<Member[]>(`/guilds/${guildId}/members?limit=${MEMBER_PAGE}&after=${after}`, 'GET', botToken)
      if (!res.ok) {
        if (res.status === 401) return json({ error: badToken }, 400)
        if (res.status === 403) {
          return json({
            error:
              'Discord refused the member list (403) — enable the Server Members Intent for the bot in the Discord Developer Portal. Nothing was changed.',
          }, 502)
        }
        return json({ error: `Could not read the server's members — ${res.message}. Nothing was changed.` }, 502)
      }
      pages++
      const batch = Array.isArray(res.data) ? res.data : []
      for (const m of batch) {
        const uid = String(m?.user?.id ?? '').trim()
        if (!uid || m?.user?.bot) continue
        membersById.set(uid, {
          nick: m.nick ?? null,
          roles: new Set((m.roles ?? []).map(String)),
        })
      }
      if (batch.length < MEMBER_PAGE) { reachedEnd = true; break }
      const last = String(batch[batch.length - 1]?.user?.id ?? '').trim()
      if (!last) { reachedEnd = true; break }
      after = last
    }
    if (!reachedEnd) {
      warnings.push(
        `Read ${membersById.size} members and hit the page cap without reaching the end of the list. Anybody on a page this run never fetched was left alone.`,
      )
    }

    // --- reconcile every linked driver ---
    const granted: string[] = []
    const revoked: string[] = []
    const spectatorOn: string[] = []
    const spectatorOff: string[] = []
    const renamed: string[] = []
    let alreadyCorrect = 0
    let notInGuild = 0
    let ownerSkipped: string | null = null
    let hierarchyBlocked = false

    // One helper so every role write shares the same error handling. Returns true
    // when the change is (or would be) made.
    const setRole = async (uid: string, rid: string, on: boolean, label: string): Promise<boolean> => {
      if (hierarchyBlocked) return false
      if (dryRun) return true
      const res = await discord(`/guilds/${guildId}/members/${uid}/roles/${rid}`, on ? 'PUT' : 'DELETE', botToken)
      if (res.ok) return true
      if (res.status === 403) {
        // Hierarchy, not permission: the bot can hold Manage Roles and still be
        // unable to touch a role above its own. Same answer for everybody left.
        hierarchyBlocked = true
        warnings.push(
          "Discord refused a role change (403) — drag the bot's role ABOVE GTP, LMP2, GTD and Spectator in Server Settings → Roles, then run this again.",
        )
        return false
      }
      warnings.push(`Could not ${on ? 'grant' : 'remove'} a role for ${quote(label)} — ${res.message}`)
      return false
    }

    for (const d of drivers) {
      const name = String(d.name ?? '').trim()
      const uid = String(d.discord_user_id)
      const member = membersById.get(uid)
      if (!member) { notInGuild++; continue }

      const seat = seatOf.get(d.id) ?? null
      const wantRole = seat ? (classRoles.get(seat.class_id) ?? '') : ''
      if (seat && !wantRole) {
        warnings.push(`Class ${seat.class_id} has no Discord role mapped, so ${quote(name)} could not be reconciled.`)
        continue
      }

      let touched = false

      // The class roles: exactly the seat's, or none at all.
      for (const rid of classRoleIds) {
        const has = member.roles.has(rid)
        const want = rid === wantRole
        if (has === want) continue
        if (await setRole(uid, rid, want, name)) {
          const cls = [...classRoles.entries()].find(([, v]) => v === rid)?.[0] ?? rid
          ;(want ? granted : revoked).push(`${name} ${want ? '→' : '−'} ${cls}`)
          touched = true
        }
      }

      // Spectator: the exact inverse of having a seat.
      if (spectatorRole) {
        const has = member.roles.has(spectatorRole)
        const want = !seat
        if (has !== want) {
          if (await setRole(uid, spectatorRole, want, name)) {
            ;(want ? spectatorOn : spectatorOff).push(name)
            touched = true
          }
        }
      }

      // The nickname, for seated drivers only. Seatless drivers keep whatever they
      // have — there is no number to show and stripping a name is not our call.
      if (seat) {
        const displayName = iracingNameOf.get(d.id) ?? name
        const want = nicknameFor(displayName, seat.number)
        if ((member.nick ?? '') !== want) {
          if (uid === ownerId) {
            // Discord refuses this for every bot, with any permission. Not a warning
            // — nothing is broken — but said once so the one unmanaged nickname in
            // the server is accounted for.
            ownerSkipped = `${name} owns the server, and Discord lets no bot rename the owner — set ${quote(want)} by hand.`
          } else if (dryRun) {
            renamed.push(`${name} → ${quote(want)}`)
            touched = true
          } else {
            const res = await discord(`/guilds/${guildId}/members/${uid}`, 'PATCH', botToken, { nick: want })
            if (res.ok) { renamed.push(`${name} → ${quote(want)}`); touched = true }
            else if (res.status === 403) {
              warnings.push(`Discord refused to rename ${quote(name)} (403) — the bot needs Manage Nicknames and its role must sit above theirs.`)
            } else {
              warnings.push(`Could not rename ${quote(name)} — ${res.message}`)
            }
          }
        }
      }

      if (!touched) alreadyCorrect++
    }

    // --- report the queue this function is NOT allowed to fix ---
    // Unlinked members holding a class role are the linker's backlog, not ours, but
    // the number belongs in every report so the drain is visible.
    let unlinkedHoldingClassRole = 0
    for (const [uid, m] of membersById) {
      if (drivers.some((d) => String(d.discord_user_id) === uid)) continue
      if ([...classRoleIds].some((rid) => m.roles.has(rid))) unlinkedHoldingClassRole++
    }
    if (unlinkedHoldingClassRole) {
      warnings.push(
        `${unlinkedHoldingClassRole} member${unlinkedHoldingClassRole === 1 ? ' holds' : 's hold'} a class role without being linked to a driver, and stay untouched until the link is made — an unlinked member's roles are somebody's claim about who they are, not this function's to revoke.`,
      )
    }
    if (notInGuild) {
      warnings.push(
        `${notInGuild} linked driver${notInGuild === 1 ? ' is' : 's are'} not in the server (or not on a page this run read), so they were left alone.`,
      )
    }

    return json({
      ok: true,
      dryRun,
      drivers_linked: drivers.length,
      seats: seatOf.size,
      classes_mapped: classRoles.size,
      granted,
      revoked,
      spectator_granted: spectatorOn,
      spectator_removed: spectatorOff,
      renamed,
      owner_note: ownerSkipped,
      already_correct: alreadyCorrect,
      warnings,
    })
  } catch (e) {
    return json({ error: `Class role reconcile failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
