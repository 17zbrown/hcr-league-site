// discord-driver-roles — mirrors what the website says about a driver onto their
// Discord account: the class(es) they race, and the licence tier they hold.
//
// discord-link-drivers works out WHO somebody is and grants League Member for having
// raced at all. This function starts where that one finishes: it only ever looks at
// drivers who already have a discord_user_id, and decides what else they should be
// wearing. Splitting them keeps the risky half (matching a name to a human) apart
// from the routine half (keeping two systems in step), and lets this one run on a
// schedule without redoing the matching every time.
//
// WHERE THE ANSWERS COME FROM
//   Class roles   — public.discord_class_roles, a row per class. Which classes a
//                   driver has raced comes from results.class_id, attributed by name
//                   using the same rule src/lib/attribution.ts uses. Additive: a
//                   driver who has changed class keeps a role for each, because only
//                   a human knows which one is current, and the run says so.
//   Licence roles — discord_config.role_bronze / _silver / _gold / _platinum, and the
//                   tier itself is recomputed here with the same formula the site
//                   renders from (src/lib/license.ts). The website does not store a
//                   licence anywhere; it works it out from results every time it
//                   draws the page, so "match the website" means running the same
//                   arithmetic rather than reading a column.
//
// THE ONE PLACE THIS REMOVES A ROLE
// A licence is a ladder, and the site shows exactly one rung. So when a driver's
// computed tier is Silver, this takes Bronze back off them. That is the only DELETE
// in this file and it is fenced in hard: it can only ever touch one of the four ids
// named in discord_config as licence tiers, only on a driver whose tier was just
// computed, and never the tier they are supposed to hold. It cannot touch League
// Member, a class role, Admin, or anything a human made up.
//
// Everything else is a PUT, conditional on the member not already holding the role,
// so running it twice in a row does nothing the second time.
//
// Callable two ways, mirroring public.assert_admin_or_cron: if you ARE authenticated
// you must be an admin, while an unauthenticated call is let through (that's cron).
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs **Manage Roles**, and its own role must sit ABOVE the class and
// licence roles in Server Settings → Roles or Discord refuses with a 403.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Same ceilings the linker and the audit use.
const MEMBER_PAGE = 1000
const MAX_MEMBER_PAGES = 5
const MAX_DRIVERS = 5000
const MAX_RESULTS = 20000
const RESULT_PAGE = 1000

const SNOWFLAKE = /^\d{5,25}$/

// ---------------------------------------------------------------------------
// Licence maths — a port of src/lib/license.ts.
//
// This is duplicated rather than imported, because the site builds through Vite
// from src/ and this runs in Deno from supabase/functions/, and neither can reach
// the other's module graph. IF YOU CHANGE THE THRESHOLDS OR THE WEIGHTS, CHANGE
// THEM IN BOTH PLACES — a driver whose badge says Gold on the website and Silver in
// Discord is worse than one whose badge is wrong in a single, consistent way.
// ---------------------------------------------------------------------------
type License = 'Bronze' | 'Silver' | 'Gold' | 'Platinum'
const LICENSE_ORDER: License[] = ['Bronze', 'Silver', 'Gold', 'Platinum']
const LICENSE_THRESHOLDS: Record<License, number> = { Bronze: 0, Silver: 75, Gold: 155, Platinum: 320 }

interface ResultRow {
  drivers_text?: string | null
  event_id?: string | null
  class_id?: string | null
  cls_pos?: number | null
  quali_pos?: number | null
  grid?: number | null
  inc?: number | null
  laps?: number | null
  best_lap?: string | null
  status?: string | null
}

/** Parse a lap time ("1:35.433", "95.4", "1:02:03.1") to seconds. */
function lapToSeconds(v?: string | null): number | null {
  if (!v) return null
  const parts = String(v).trim().split(':')
  if (!parts.length || parts.some((p) => p === '' || isNaN(Number(p)))) return null
  let sec = 0
  for (const p of parts) sec = sec * 60 + Number(p)
  return sec > 0 ? sec : null
}

const paceKey = (r: ResultRow) => `${r.event_id ?? ''}|${r.class_id ?? ''}`

/** Fastest best-lap (seconds) per event+class, for comparative pace. */
function buildPaceIndex(rows: ResultRow[]): Map<string, number> {
  const idx = new Map<string, number>()
  for (const r of rows) {
    const sec = lapToSeconds(r.best_lap)
    if (sec == null) continue
    const k = paceKey(r)
    const cur = idx.get(k)
    if (cur == null || sec < cur) idx.set(k, sec)
  }
  return idx
}

/** Credits earned in a single race. */
function raceCredits(r: ResultRow, paceIndex?: Map<string, number>): number {
  const participated = r.cls_pos != null || (r.laps ?? 0) > 0
  if (!participated) return 0

  const status = (r.status ?? '').toUpperCase()
  const dnf = status === 'DNF' || status === 'DNS' || status === 'DSQ'

  const cls = r.cls_pos
  let finish = 0
  if (cls != null) {
    finish = cls === 1 ? 5 : cls === 2 ? 4 : cls === 3 ? 3.5 : cls === 4 ? 3 : cls === 5 ? 2.5 : cls <= 8 ? 2 : cls <= 12 ? 1 : 0.5
  }
  if (dnf) finish = Math.min(finish, 0.5)

  const q = r.quali_pos ?? r.grid ?? null

  let pace = 0
  const sec = lapToSeconds(r.best_lap)
  const fastest = paceIndex?.get(paceKey(r))
  if (sec != null && fastest != null && fastest > 0) {
    const ratio = sec / fastest
    pace = ratio <= 1.001 ? 5 : ratio <= 1.005 ? 4 : ratio <= 1.01 ? 3 : ratio <= 1.02 ? 2 : ratio <= 1.035 ? 1 : 0.5
  } else if (q != null) {
    pace = q === 1 ? 3 : q === 2 ? 2 : q === 3 ? 1.5 : q <= 5 ? 1 : 0.5
  }

  let qualy = 0
  if (q != null) qualy = q === 1 ? 3 : q === 2 ? 2.5 : q === 3 ? 2 : q <= 5 ? 1.5 : q <= 8 ? 1 : 0.5

  const inc = r.inc
  let safety = 1 // neutral when incidents are unknown
  if (inc != null) safety = inc === 0 ? 4 : inc <= 2 ? 3 : inc <= 4 ? 2 : inc <= 6 ? 1.5 : inc <= 8 ? 1 : inc <= 12 ? 0 : inc <= 18 ? -1 : -2

  return finish + pace + qualy + safety
}

/** Highest tier whose threshold the credit total has reached. */
function tierForCredits(credits: number): License {
  let tier: License = 'Bronze'
  for (const t of LICENSE_ORDER) if (credits >= LICENSE_THRESHOLDS[t]) tier = t
  return tier
}

// --- name handling: a straight port of src/lib/attribution.ts ---
// The site already decided what two names being "the same name" means. This has to
// agree with it exactly, or a driver's licence here would be computed from a
// different set of races than the one their profile page adds up.

function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim()
}

function splitCrew(driversText?: string | null): string[] {
  if (!driversText) return []
  return driversText
    .split(/\s*(?:\/|,|;|&|\+|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

function crewNames(driversText?: string | null): string[] {
  return splitCrew(driversText).map(normalizeName).filter(Boolean)
}

const nameTokens = (normalized: string) => normalized.split(' ').filter((t) => t.length > 1)

/** resultListsDriver from attribution.ts. */
function resultListsDriver(driversText: string | null | undefined, driverName: string): boolean {
  const target = normalizeName(driverName)
  if (!target) return false
  const names = crewNames(driversText)
  if (names.includes(target)) return true
  const targetTokens = nameTokens(target)
  if (targetTokens.length < 2) return false
  return names.some((seg) => {
    const segTokens = nameTokens(seg)
    return segTokens.length === targetTokens.length && targetTokens.every((t) => segTokens.includes(t))
  })
}

interface DriverRow {
  id: string
  name: string | null
  discord_user_id: string | null
  license_override: string | null
}
interface Member {
  roles?: string[] | null
  user?: { id?: string | null } | null
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

// GET to read, PUT to add, DELETE to take a licence tier back off. The method is
// typed to exactly those three so nothing else can be expressed here.
async function discord<T>(
  path: string,
  method: 'GET' | 'PUT' | 'DELETE',
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

    // Dry run unless told otherwise. This one can take a role away, so the default
    // answer to "should I?" is no and the caller has to be explicit.
    let dryRun = true
    try {
      const body = await req.json()
      if (body && typeof body === 'object' && (body as { dryRun?: unknown }).dryRun === false) dryRun = false
    } catch (_) { /* empty body — the safe default stands */ }

    // --- auth: an admin, or cron ---
    const authz = req.headers.get('Authorization') ?? ''
    const bearer = authz.replace(/^Bearer\s+/i, '').trim()
    const viaCron = !bearer || bearer === service
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

    // --- the two role maps ---
    const classRoles = new Map<string, string>()
    {
      const { data: rows, error } = await db.from('discord_class_roles').select('class_id, role_id')
      if (error) warnings.push(`Could not read the class-role mapping — ${error.message}. No class roles were touched.`)
      else {
        for (const r of (rows ?? []) as { class_id?: string | null; role_id?: string | null }[]) {
          const cid = String(r?.class_id ?? '').trim()
          const rid = String(r?.role_id ?? '').trim()
          if (cid && SNOWFLAKE.test(rid)) classRoles.set(cid, rid)
        }
      }
    }

    // tier -> role id, and the reverse set used to decide what may be removed.
    const licenseRoles = new Map<License, string>()
    for (const tier of LICENSE_ORDER) {
      const rid = String(cfg[`role_${tier.toLowerCase()}`] ?? '').trim()
      if (SNOWFLAKE.test(rid)) licenseRoles.set(tier, rid)
    }
    // The complete, closed set of ids this function is permitted to remove. Built
    // from config and nothing else — if an id isn't in here it cannot be deleted,
    // whatever else happens below.
    const removableLicenseIds = new Set(licenseRoles.values())
    if (licenseRoles.size === 0) {
      warnings.push('No licence roles are configured, so licence tiers were not mirrored. Set them in Admin → Discord.')
    } else if (licenseRoles.size < LICENSE_ORDER.length) {
      warnings.push(
        `Only ${licenseRoles.size} of the 4 licence roles are configured (${[...licenseRoles.keys()].join(', ')}). Drivers on an unconfigured tier were left as they are.`,
      )
    }

    // --- drivers who already have a Discord account attached ---
    const { data: driverRows, error: drvErr } = await db
      .from('drivers')
      .select('id, name, discord_user_id, license_override')
      .not('discord_user_id', 'is', null)
      .limit(MAX_DRIVERS)
    if (drvErr) return json({ error: `Could not read the drivers — ${drvErr.message}. Nothing was changed.` }, 500)
    const drivers = ((driverRows ?? []) as DriverRow[]).filter((d) => SNOWFLAKE.test(String(d.discord_user_id ?? '')))
    if (drivers.length === 0) {
      return json({
        skipped:
          'No driver has a Discord account attached yet, so there is nobody to mirror. Run "Link drivers" first — it works out who is who.',
      })
    }

    // --- every result, because a licence is a career total ---
    const results: ResultRow[] = []
    let resErr: { message: string } | null = null
    let read = 0
    let total: number | null = null
    while (read < MAX_RESULTS) {
      const to = Math.min(read + RESULT_PAGE, MAX_RESULTS) - 1
      const { data, error, count } = await db
        .from('results')
        .select('drivers_text, event_id, class_id, cls_pos, quali_pos, grid, inc, laps, best_lap, status', { count: 'exact' })
        .range(read, to)
      if (error) {
        if ((error as { code?: string }).code === 'PGRST103') break
        resErr = error
        break
      }
      if (typeof count === 'number') total = count
      const batch = (data ?? []) as ResultRow[]
      read += batch.length
      results.push(...batch)
      if (!batch.length) break
      if (total !== null && read >= total) break
    }
    if (resErr) {
      return json({ error: `Could not read the results — ${resErr.message}. Nothing was changed.` }, 500)
    }
    // A licence computed from half the season is a wrong licence, not a partial one,
    // and it would be applied as though it were right. Refuse instead.
    if (total !== null && read < total) {
      return json({
        skipped: `Only ${read} of ${total} results rows could be read, and a licence is a career total — a partial read would compute the wrong tier for everybody. Nothing was changed.`,
      })
    }

    const paceIndex = buildPaceIndex(results)

    // --- what the website would say about each of them ---
    interface Want {
      driver: DriverRow
      uid: string
      name: string
      classes: string[]
      tier: License | null
      credits: number
      overridden: boolean
    }
    const wants: Want[] = []
    for (const d of drivers) {
      const name = String(d.name ?? '').trim()
      if (!name) continue
      const mine = results.filter((r) => resultListsDriver(r.drivers_text, name))
      if (mine.length === 0) continue // never raced — the linker's League Member grant covers them

      const classes = [...new Set(mine.map((r) => String(r.class_id ?? '').trim()).filter(Boolean))].sort()

      const credits = Math.max(0, mine.reduce((s, r) => s + raceCredits(r, paceIndex), 0))
      const computed = tierForCredits(credits)
      // Same precedence the site uses: a commissioner override wins over the maths.
      const override = String(d.license_override ?? '').trim()
      const overridden = !!override && (LICENSE_ORDER as string[]).includes(override)
      const tier = overridden ? (override as License) : computed

      wants.push({ driver: d, uid: String(d.discord_user_id), name, classes, tier, credits: Math.round(credits), overridden })
    }

    // --- who is actually in the server, and what do they already hold ---
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
        `Read ${membersById.size} members and hit the page cap without reaching the end of the list. Anybody on a page this run never fetched was left alone; the next run picks them up.`,
      )
    }

    // --- apply ---
    const classGranted: string[] = []
    const licenseGranted: string[] = []
    const licenseRemoved: string[] = []
    const multiClass: string[] = []
    const unchanged: string[] = []
    let notInGuild = 0
    let classBlocked = false
    let licenseBlocked = false

    for (const w of wants) {
      const held = membersById.get(w.uid)
      if (!held) { notInGuild++; continue }
      let touched = false

      // --- class roles: additive, one per class they have raced in ---
      if (w.classes.length > 1) multiClass.push(`${w.name} (${w.classes.join(', ')})`)
      for (const cls of w.classes) {
        const rid = classRoles.get(cls)
        if (!rid || held.has(rid)) continue
        if (classBlocked) break
        if (dryRun) { classGranted.push(`${w.name} → ${cls}`); touched = true; continue }
        const put = await discord(`/guilds/${guildId}/members/${w.uid}/roles/${rid}`, 'PUT', botToken)
        if (put.ok) { classGranted.push(`${w.name} → ${cls}`); touched = true; continue }
        if (put.status === 403) {
          classBlocked = true
          warnings.push(
            "Discord refused to grant a class role (403) — drag the bot's role ABOVE the GTP, LMP2 and GTD roles in Server Settings → Roles, then run this again.",
          )
          continue
        }
        warnings.push(`Could not give ${quote(w.name)} the ${cls} role — ${put.message}`)
      }

      // --- licence: exactly one rung of the ladder ---
      const wantRole = w.tier ? licenseRoles.get(w.tier) : undefined
      if (wantRole) {
        if (!held.has(wantRole)) {
          if (dryRun) {
            licenseGranted.push(`${w.name} → ${w.tier}${w.overridden ? ' (override)' : ` (${w.credits} credits)`}`)
            touched = true
          } else if (!licenseBlocked) {
            const put = await discord(`/guilds/${guildId}/members/${w.uid}/roles/${wantRole}`, 'PUT', botToken)
            if (put.ok) {
              licenseGranted.push(`${w.name} → ${w.tier}${w.overridden ? ' (override)' : ` (${w.credits} credits)`}`)
              touched = true
            } else if (put.status === 403) {
              licenseBlocked = true
              warnings.push(
                "Discord refused to grant a licence role (403) — drag the bot's role ABOVE Bronze, Silver, Gold and Platinum in Server Settings → Roles, then run this again.",
              )
            } else {
              warnings.push(`Could not give ${quote(w.name)} the ${w.tier} role — ${put.message}`)
            }
          }
        }

        // The only removal in this file. Every id here came out of removableLicenseIds,
        // which was built from the four licence columns in discord_config and nothing
        // else, and the tier they are meant to hold is excluded by construction.
        for (const rid of held) {
          if (!removableLicenseIds.has(rid)) continue
          if (rid === wantRole) continue
          const staleTier = [...licenseRoles.entries()].find(([, v]) => v === rid)?.[0] ?? rid
          if (dryRun) { licenseRemoved.push(`${w.name} ✕ ${staleTier}`); touched = true; continue }
          if (licenseBlocked) break
          const del = await discord(`/guilds/${guildId}/members/${w.uid}/roles/${rid}`, 'DELETE', botToken)
          if (del.ok) { licenseRemoved.push(`${w.name} ✕ ${staleTier}`); touched = true; continue }
          if (del.status === 403) {
            licenseBlocked = true
            warnings.push(
              "Discord refused to remove an old licence role (403) — the bot's role must sit ABOVE the licence roles in Server Settings → Roles.",
            )
            continue
          }
          warnings.push(`Could not take the old ${staleTier} role off ${quote(w.name)} — ${del.message}`)
        }
      }

      if (!touched) unchanged.push(w.name)
    }

    if (multiClass.length) {
      warnings.push(
        `${multiClass.length} driver${multiClass.length === 1 ? ' has' : 's have'} raced in more than one class and hold a role for each — ${multiClass.join('; ')}. Class roles are only ever added here, so take off the one they no longer drive by hand.`,
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
      drivers_with_results: wants.length,
      results_read: read,
      class_roles_mapped: classRoles.size,
      license_roles_mapped: licenseRoles.size,
      class_granted: classGranted,
      license_granted: licenseGranted,
      license_removed: licenseRemoved,
      unchanged: unchanged.length,
      warnings,
    })
  } catch (e) {
    return json({ error: `Driver role sync failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
