// discord-driver-roles — gives every linked driver the Discord role for the class
// they race.
//
// Scope note, because this function used to do more: licence tiers are NOT handled
// here. discord-sync owns those — it recomputes the tier, persists it to
// drivers.license_current, swaps the Discord role and announces promotions in
// #license-ups, and it already runs after every results import. Two functions both
// deciding which licence role somebody should hold is one too many, so this one was
// cut back to the job discord-sync doesn't do.
//
// Class roles come from public.discord_class_roles, a row per class keyed on
// classes.id, so putting a fourth class on the grid is an insert rather than a
// migration and taking one out of Discord's hands is a delete. A class with no row
// is simply not mirrored.
//
// Which classes somebody has raced comes from results.class_id, attributed by name
// with the same rule src/lib/attribution.ts uses — this has to agree with the site
// exactly or a driver could be shown in GTD on their profile and GTP in Discord.
//
// ADDITIVE ONLY. There is no DELETE in this file. A driver who has changed class
// keeps a role for each class they have raced in, because only a human knows which
// one is current — the run says who those drivers are so somebody can trim it.
//
// Callable two ways, mirroring public.assert_admin_or_cron: an admin, or cron.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs **Manage Roles**, and its own role must sit ABOVE GTP, LMP2 and GTD
// in Server Settings → Roles or Discord refuses with a 403.
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
const MAX_RESULTS = 20000
const RESULT_PAGE = 1000

const SNOWFLAKE = /^\d{5,25}$/

interface ResultRow {
  drivers_text?: string | null
  class_id?: string | null
}
interface DriverRow {
  id: string
  name: string | null
  discord_user_id: string | null
}
interface Member {
  roles?: string[] | null
  user?: { id?: string | null } | null
}

// --- name handling: a straight port of src/lib/attribution.ts ---
function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim()
}
function crewNames(driversText?: string | null): string[] {
  if (!driversText) return []
  return driversText
    .split(/\s*(?:\/|,|;|&|\+|\band\b)\s*/i)
    .map((s) => normalizeName(s.trim()))
    .filter(Boolean)
}
const nameTokens = (normalized: string) => normalized.split(' ').filter((t) => t.length > 1)

/** resultListsDriver from attribution.ts. */
function resultListsDriver(driversText: string | null | undefined, driverName: string): boolean {
  const target = normalizeName(driverName)
  if (!target) return false
  const names = crewNames(driversText)
  if (names.includes(target)) return true
  // exact-token-set fallback: abbreviated forms intentionally not matched
  const targetTokens = nameTokens(target)
  if (targetTokens.length < 2) return false
  return names.some((seg) => {
    const segTokens = nameTokens(seg)
    return segTokens.length === targetTokens.length && targetTokens.every((t) => segTokens.includes(t))
  })
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

// GET to read, PUT to add a role. There is deliberately no way to express a DELETE.
async function discord<T>(
  path: string,
  method: 'GET' | 'PUT',
  token: string,
  attempt = 0,
): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(`${DISCORD}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return { ok: false, status: 0, message: `Could not reach Discord (${String((e as Error)?.message ?? e)})` }
  }
  if (res.status === 429 && attempt < 3) {
    const retry = Number(res.headers.get('retry-after') ?? '1')
    await new Promise((r) => setTimeout(r, (Number.isFinite(retry) ? retry : 1) * 1000 + 250))
    return discord<T>(path, method, token, attempt + 1)
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

    // Nothing here removes anything, so the default is to just do it — same
    // ergonomics as the driver linker. dryRun is there for looking first.
    let dryRun = false
    try {
      const body = await req.json()
      if (body && typeof body === 'object' && (body as { dryRun?: unknown }).dryRun === true) dryRun = true
    } catch (_) { /* empty body — default stands */ }

    // --- auth: an admin, or cron ---
    const authz = req.headers.get('Authorization') ?? ''
    const bearer = authz.replace(/^Bearer\s+/i, '').trim()
    const viaCron = !bearer || bearer === service
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
    const guildId = String(cfg.guild_id ?? '').trim()
    if (!guildId) return json({ skipped: 'No Discord server is configured yet.' })
    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    const warnings: string[] = []

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
      return json({ skipped: 'No classes are mapped to Discord roles, so there is nothing to mirror.' })
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

    // --- every result, paged: PostgREST caps a single response and a short read
    // would make a driver look like they had never raced in a class ---
    const results: ResultRow[] = []
    let read = 0
    let total: number | null = null
    while (read < MAX_RESULTS) {
      const to = Math.min(read + RESULT_PAGE, MAX_RESULTS) - 1
      const { data, error, count } = await db
        .from('results').select('drivers_text, class_id', { count: 'exact' }).range(read, to)
      if (error) {
        if ((error as { code?: string }).code === 'PGRST103') break
        return json({ error: `Could not read the results — ${error.message}. Nothing was changed.` }, 500)
      }
      if (typeof count === 'number') total = count
      const batch = (data ?? []) as ResultRow[]
      read += batch.length
      results.push(...batch)
      if (!batch.length) break
      if (total !== null && read >= total) break
    }
    if (total !== null && read < total) {
      warnings.push(
        `Only ${read} of ${total} results rows were read, so a class somebody raced in may have been missed. Nobody loses a role over it — this only ever adds — and the next run picks it up.`,
      )
    }

    // --- who is in the server, and what do they hold ---
    const membersById = new Map<string, Set<string>>()
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
        if (!uid) continue
        membersById.set(uid, new Set((m.roles ?? []).map(String)))
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

    // --- apply ---
    const granted: string[] = []
    const multiClass: string[] = []
    let alreadyCorrect = 0
    let notInGuild = 0
    let blocked = false

    for (const d of drivers) {
      const name = String(d.name ?? '').trim()
      if (!name) continue
      const uid = String(d.discord_user_id)
      const mine = results.filter((r) => resultListsDriver(r.drivers_text, name))
      if (mine.length === 0) continue // never raced — the linker's League Member grant covers them

      const classes = [...new Set(mine.map((r) => String(r.class_id ?? '').trim()).filter(Boolean))].sort()
      if (classes.length > 1) multiClass.push(`${name} (${classes.join(', ')})`)

      const held = membersById.get(uid)
      if (!held) { notInGuild++; continue }

      let touched = false
      for (const cls of classes) {
        const rid = classRoles.get(cls)
        if (!rid || held.has(rid)) continue
        if (blocked) break
        if (dryRun) { granted.push(`${name} → ${cls}`); touched = true; continue }
        const put = await discord(`/guilds/${guildId}/members/${uid}/roles/${rid}`, 'PUT', botToken)
        if (put.ok) { granted.push(`${name} → ${cls}`); touched = true; continue }
        if (put.status === 403) {
          // Hierarchy, not permission: the bot can hold Manage Roles and still be
          // unable to hand out a role above its own. Same for everybody left.
          blocked = true
          warnings.push(
            "Discord refused to grant a class role (403) — drag the bot's role ABOVE GTP, LMP2 and GTD in Server Settings → Roles, then run this again.",
          )
          continue
        }
        if (put.status === 404) {
          warnings.push(`Discord does not recognise the role mapped to class ${cls} — check discord_class_roles still points at a role that exists.`)
          continue
        }
        warnings.push(`Could not give ${quote(name)} the ${cls} role — ${put.message}`)
      }
      if (!touched) alreadyCorrect++
    }

    // Not a failure, but the one thing here a human has to settle.
    if (multiClass.length) {
      warnings.push(
        `${multiClass.length} driver${multiClass.length === 1 ? ' has' : 's have'} raced in more than one class and hold a role for each — ${multiClass.join('; ')}. Nothing here removes a role, so take off the one they no longer drive by hand.`,
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
      classes_mapped: classRoles.size,
      results_read: read,
      granted,
      already_correct: alreadyCorrect,
      warnings,
    })
  } catch (e) {
    return json({ error: `Class role sync failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
