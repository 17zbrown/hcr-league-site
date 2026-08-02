// discord-link-drivers — works out which Discord account belongs to which driver on
// the roster, then gives everyone who has actually raced the League Member role.
//
// The roster comes from results PDFs, which only ever carry a name, so the two sides
// of the league have never known about each other: drivers.discord_user_id is null
// for almost everybody. This function closes that gap by name, and only by name it
// is sure of. There is no approval queue and no admin sign-off — an unsure match is
// simply left alone until a human renames somebody, which is a better outcome than a
// wrong one. A wrong link would hand one person's licence and race history to
// another, and nothing in here can tell that it happened.
//
// It only ever ADDS. There is no DELETE anywhere in this file — not against a role,
// a channel, a message or a member — and the League Member role is never taken away
// from anyone, because somebody may well have been given it by hand for a reason
// this function knows nothing about. The only Discord write it can make is a single
// PUT that adds one role; the method parameter is typed to make that structural
// rather than a promise.
//
// Safe to run as often as you like: every write is conditional on the thing not
// already being true, so a second run in a row does nothing at all.
//
// Callable two ways, mirroring public.assert_admin_or_cron: if you ARE authenticated
// you must be an admin, while an unauthenticated call is let through (that's cron). A
// JWT we can't read is the only 401. For the no-JWT path to reach this code the
// function must be deployed with verify_jwt off; a cron job that sends the
// service-role key works either way.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs **Manage Roles**, and its own role must sit ABOVE League Member in
// Server Settings → Roles or Discord will refuse the grant with a 403.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// A big server shouldn't be able to hang the job, so the member walk is capped —
// same ceiling the audit and the role reconcile use.
const MEMBER_PAGE = 1000
const MAX_MEMBER_PAGES = 5
// Matching ceilings on the database side.
const MAX_DRIVERS = 5000
const MAX_PROFILES = 5000
const MAX_RESULTS = 20000
const RESULT_PAGE = 1000
// The log gets one row per driver considered, so a full roster goes in a few inserts.
const LOG_CHUNK = 500
// Log details are for a human reading a table, not an essay.
const MAX_DETAIL = 500

// The role that says "this person races here". Setup and rebuild both match it by
// name rather than create it, so these are the same aliases they look for.
const LEAGUE_MEMBER_ALIASES = ['hcr league member', 'league member']

// A Discord snowflake is digits and nothing else. Everything we interpolate into a
// request path is checked against this first — drivers.discord_user_id is a plain
// text column, and a text column is not a promise about its contents.
const SNOWFLAKE = /^\d{5,25}$/

interface Role {
  id: string
  name: string
  managed?: boolean
}
interface Member {
  nick?: string | null
  roles?: string[] | null
  user?: { id?: string | null; username?: string | null; global_name?: string | null } | null
}
interface DriverRow {
  id: string
  name: string | null
  discord_user_id: string | null
}
interface ProfileRow {
  id: string
  discord_user_id: string | null
  driver_id: string | null
}
// Everything we need to know about one guild member: who they are, every name they
// might be known by, and what they already hold.
interface ScannedMember {
  id: string
  labels: string[]
  roles: Set<string>
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

// Every Discord call goes through here, and the method is typed down to the two verbs
// this function is allowed: read the server, add one role. There is deliberately no
// way to express a DELETE. It never throws, it retries a rate limit (bounded, never
// forever), and it hands back Discord's own explanation of a refusal.
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
  // 429 = rate limited. Back off and retry — but bounded, never forever.
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
    } catch (_) { /* Discord sent something that isn't JSON */ }
  }
  if (!res.ok) {
    const detail = (parsed as { message?: string } | null)?.message
    return { ok: false, status: res.status, message: `Discord API ${res.status}${detail ? `: ${detail}` : ''}` }
  }
  // 204 = success with no content (adding a role the member already has says this too).
  return { ok: true, data: (parsed ?? null) as T }
}

const badToken = 'Discord rejected the bot token — check the DISCORD_BOT_TOKEN secret in Supabase.'

// --- name handling: a straight port of src/lib/attribution.ts ---
// The site already decided what two names being "the same name" means, and it decided
// it in one place. Linking has to agree with it exactly, or a driver could be judged
// to have raced by one rule and matched to a Discord account by another.

/** Lower-case, strip diacritics + punctuation, collapse whitespace. */
function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split a `drivers_text` crew field into its individual driver names. */
function splitCrew(driversText?: string | null): string[] {
  if (!driversText) return []
  return driversText
    .split(/\s*(?:\/|,|;|&|\+|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Normalized set of driver names listed on a result. */
function crewNames(driversText?: string | null): string[] {
  return splitCrew(driversText).map(normalizeName).filter(Boolean)
}

// The canon throws away single characters before comparing tokens: "J" in "J. Smith"
// is an initial, not a name, and matching on it would make every Smith the same person.
const nameTokens = (normalized: string) => normalized.split(' ').filter((t) => t.length > 1)

/**
 * resultListsDriver from attribution.ts, hoisted over every crew segment in the
 * results table at once. Both of the canon's branches judge a single segment on its
 * own, so "some row lists this driver" is exactly "some segment matches this driver" —
 * the same answer, worked out once instead of once per row.
 */
function hasRaced(segments: string[], segmentSet: Set<string>, driverName: string): boolean {
  const target = normalizeName(driverName)
  if (!target) return false
  if (segmentSet.has(target)) return true
  // exact-token-set fallback: segment tokens must equal the driver-name tokens
  // exactly (abbreviated forms intentionally not matched)
  const targetTokens = nameTokens(target)
  if (targetTokens.length < 2) return false // too weak to match on a single token
  return segments.some((seg) => {
    const segTokens = nameTokens(seg)
    return segTokens.length === targetTokens.length && targetTokens.every((t) => segTokens.includes(t))
  })
}

/**
 * The token half of a confident match: the same words in any order. Sorted rather
 * than set-compared so it is a true multiset — "Smith Smith John" cannot stand in for
 * "Smith John John". Fewer than two tokens returns null, because "Bob" matching every
 * other Bob in the server is not a match, it is a collision waiting to happen.
 */
const tokenKey = (normalized: string): string | null => {
  const t = nameTokens(normalized)
  return t.length >= 2 ? t.slice().sort().join(' ') : null
}

const clip = (s: string) => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL - 1)}…` : s)
const quote = (s: string) => `"${s}"`

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

    // --- auth: an admin, or cron ---
    // No bearer token at all means nobody is claiming to be anybody — that's the cron
    // path. The service-role key is the same thing wearing a badge: whoever holds it
    // already owns the database, so there is no user to look up. Anything else is a
    // person, and a person has to be an admin.
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
      // A JWT arrived but resolves to nobody — expired, malformed, or the bare anon key.
      if (!user) return json({ error: 'Not authenticated' }, 401)
      const { data: prof } = await userClient.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
      if (!prof?.is_admin) return json({ error: 'Admins only' }, 403)
    }

    // --- 1. config (service role bypasses RLS) ---
    const db = createClient(url, service)
    const { data: cfgRow } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    const cfg = (cfgRow ?? null) as Record<string, unknown> | null
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    // Honour the same switch discord-role-reconcile does. It is worded as "set roles
    // automatically", and an admin who turned that off would not expect a different
    // function to hand out roles anyway — least surprise beats a literal reading.
    if (!cfg.auto_sync_roles) return json({ skipped: 'Automatic role sync is switched off.' })
    if (!String(cfg.guild_id ?? '').trim()) return json({ skipped: 'No Discord server is configured yet.' })
    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    const guildId = String(cfg.guild_id).trim()
    const warnings: string[] = []

    // --- 1b. which role means "League Member"? ---
    // A saved id is the admin's explicit choice and wins outright. With the field
    // blank we look the role up by name and write the id back, so the next run — and
    // every other function that reads the column — stops having to guess.
    let roleId = String(cfg.role_league_member ?? '').trim()

    if (!roleId) {
      const rolesRes = await discord<Role[]>(`/guilds/${guildId}/roles`, 'GET', botToken)
      if (!rolesRes.ok) {
        if (rolesRes.status === 401) return json({ error: badToken }, 400)
        warnings.push(
          rolesRes.status === 403
            ? "Discord refused to list the server's roles (403) — the bot needs the Manage Roles permission. Drivers were still linked, but nobody could be given the League Member role."
            : `Could not read the server's roles — ${rolesRes.message}. Drivers were still linked, but nobody could be given the League Member role.`,
        )
      } else {
        // @everyone and bot-managed roles are skipped: neither can be handed to a driver.
        const found =
          (rolesRes.data ?? [])
            .filter((r) => r?.id && r.name !== '@everyone' && !r.managed)
            .find((r) => LEAGUE_MEMBER_ALIASES.includes((r.name ?? '').trim().toLowerCase())) ?? null

        if (found) {
          roleId = found.id
          // An update rather than an upsert: we only got here by reading this exact
          // row, so it certainly exists, and an update cannot invent a half-filled
          // config row if something is odd.
          const { error: saveErr } = await db
            .from('discord_config')
            .update({ role_league_member: found.id, updated_at: new Date().toISOString() })
            .eq('id', 1)
          if (saveErr) {
            warnings.push(
              `Found the "${found.name}" role in Discord but could not save its id — ${saveErr.message}. Roles were still granted; the lookup will just happen again next run.`,
            )
          }
        } else {
          warnings.push(
            `No League Member role exists in the server (looked for: ${LEAGUE_MEMBER_ALIASES.join(', ')}). Drivers were still linked, but nobody could be given the role — make the role in Discord, or paste its id into Admin → Discord.`,
          )
        }
      }
    }

    if (roleId && !SNOWFLAKE.test(roleId)) {
      warnings.push(
        `The saved League Member role id (${clip(roleId)}) is not a Discord id, so no role was granted. Fix it in Admin → Discord, or clear the field and re-run to have it found by name.`,
      )
      roleId = ''
    }

    // --- 2. who is in the server, and what are they called? ---
    // Paged with ?after= (member ids come back ascending), stopping at the first short
    // page or the page cap, whichever lands first. A half-read guild would produce a
    // log full of "no match" rows about people who are standing right there, so a
    // failed read stops the run rather than writing a misleading answer.
    const membersById = new Map<string, ScannedMember>()
    let membersScanned = 0
    let reachedEnd = false
    let after = '0'
    let pages = 0

    while (pages < MAX_MEMBER_PAGES) {
      const res = await discord<Member[]>(`/guilds/${guildId}/members?limit=${MEMBER_PAGE}&after=${after}`, 'GET', botToken)
      if (!res.ok) {
        if (res.status === 401) return json({ error: badToken }, 400)
        if (res.status === 403) {
          return json(
            {
              error:
                'Discord refused the member list (403) — enable the Server Members Intent for the bot in the Discord Developer Portal. Nothing was linked and no roles were granted.',
            },
            502,
          )
        }
        return json(
          { error: `Could not read the server's members — ${res.message}. Nothing was linked and no roles were granted.` },
          502,
        )
      }
      pages++
      const batch = Array.isArray(res.data) ? res.data : []
      for (const m of batch) {
        const uid = String(m?.user?.id ?? '').trim()
        if (!uid) continue
        membersScanned++
        // Every name this person might be known by, best first: the name they chose
        // for this server, then their display name, then their handle. De-duplicated
        // case-insensitively so a nick that only differs in capitals isn't two labels.
        const labels: string[] = []
        const seen = new Set<string>()
        for (const raw of [m?.nick, m?.user?.global_name, m?.user?.username]) {
          const label = String(raw ?? '').trim()
          if (!label) continue
          const key = label.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          labels.push(label)
        }
        membersById.set(uid, {
          id: uid,
          labels,
          roles: new Set(Array.isArray(m.roles) ? m.roles.filter((r): r is string => typeof r === 'string' && !!r) : []),
        })
      }
      if (batch.length < MEMBER_PAGE) {
        reachedEnd = true
        break
      }
      const last = String(batch[batch.length - 1]?.user?.id ?? '').trim()
      if (!last) {
        reachedEnd = true
        break
      }
      after = last
    }

    // A capped walk didn't fail — it just didn't look at everyone. Nobody on the pages
    // we never fetched can be linked or granted this run, which is fine: this function
    // only adds, so a short scan means "later", never "wrong".
    const scanCapped = !reachedEnd
    if (scanCapped) {
      warnings.push(
        `Stopped after ${membersScanned} members (${MAX_MEMBER_PAGES} pages of ${MEMBER_PAGE}) so a large server can't hang the job. Anyone further down the list will be picked up on a later run.`,
      )
    }

    // Two indexes over every label in the server, so matching is a lookup per driver
    // rather than a comparison against every member.
    const exactIndex = new Map<string, Set<string>>()
    const tokenIndex = new Map<string, Set<string>>()
    const push = (index: Map<string, Set<string>>, key: string, id: string) => {
      const bucket = index.get(key)
      if (bucket) bucket.add(id)
      else index.set(key, new Set([id]))
    }
    for (const m of membersById.values()) {
      for (const label of m.labels) {
        const norm = normalizeName(label)
        if (!norm) continue
        push(exactIndex, norm, m.id)
        const key = tokenKey(norm)
        if (key) push(tokenIndex, key, m.id)
      }
    }

    // --- 3. the roster ---
    const { data: driverRows, error: drvErr } = await db
      .from('drivers')
      .select('id, name, discord_user_id')
      .limit(MAX_DRIVERS)
    if (drvErr) return json({ error: `Could not read the drivers — ${drvErr.message}` }, 500)

    // Sorted so two runs over the same data produce the same report and the same log.
    const drivers = ((driverRows ?? []) as DriverRow[])
      .filter((d) => d?.id)
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    if (drivers.length >= MAX_DRIVERS) {
      warnings.push(`Only the first ${MAX_DRIVERS} drivers were considered. Run again once these are dealt with.`)
    }

    // A Discord account already spoken for cannot be handed to a second driver, no
    // matter how well the names read. Two people really can share a name.
    const takenIds = new Set<string>()
    for (const d of drivers) {
      const uid = String(d.discord_user_id ?? '').trim()
      if (uid) takenIds.add(uid)
    }

    // --- 4. match, both ways round ---
    // Nothing is decided in this pass. A driver with one candidate still isn't linked
    // if that candidate is also the best answer for somebody else, and there is no way
    // to know that until every driver has been looked at.
    interface Pending {
      driver: DriverRow
      norm: string
      free: string[] // candidate member ids nobody else on the roster holds
      blocked: string[] // candidates already linked to a different driver
    }
    const pending: Pending[] = []
    const claimedBy = new Map<string, string[]>() // member id -> driver ids that match it
    const alreadyLinked: { driver: DriverRow; uid: string }[] = []

    for (const d of drivers) {
      const uid = String(d.discord_user_id ?? '').trim()
      if (uid) {
        alreadyLinked.push({ driver: d, uid })
        continue
      }
      const norm = normalizeName(d.name ?? '')
      const cands = new Set<string>()
      if (norm) {
        for (const id of exactIndex.get(norm) ?? []) cands.add(id)
        const key = tokenKey(norm)
        if (key) for (const id of tokenIndex.get(key) ?? []) cands.add(id)
      }
      const free: string[] = []
      const blocked: string[] = []
      for (const id of cands) (takenIds.has(id) ? blocked : free).push(id)
      free.sort()
      blocked.sort()
      for (const id of free) claimedBy.set(id, [...(claimedBy.get(id) ?? []), d.id])
      pending.push({ driver: d, norm, free, blocked })
    }

    // The label to show for a member when talking about a particular driver: the one
    // that actually matched if we can tell, otherwise their best-known name.
    const labelFor = (id: string, norm: string): string => {
      const m = membersById.get(id)
      if (!m) return id
      return m.labels.find((l) => normalizeName(l) === norm) ?? m.labels[0] ?? id
    }
    const describe = (id: string, norm = '') => `${quote(labelFor(id, norm))} (${id})`
    const nameOf = (id: string) => drivers.find((d) => d.id === id)?.name ?? id

    // --- 5. decide, and write the confident ones ---
    const runAt = new Date().toISOString()
    interface LogRow {
      ran_at: string
      driver_id: string
      driver_name: string | null
      discord_user_id: string | null
      discord_label: string | null
      outcome: 'linked' | 'ambiguous' | 'no_match' | 'already_linked'
      detail: string
    }
    const logRows: LogRow[] = []
    const linked: { driver: string; label: string; discord_user_id: string }[] = []
    const ambiguous: { driver: string; candidates: string[] }[] = []
    const noMatch: string[] = []
    // Everyone who ends this run with a Discord account, new or old — the grant pass
    // works from this, so a link made on an earlier run whose grant failed gets
    // another go rather than being stranded.
    const bound: { driver: DriverRow; uid: string }[] = [...alreadyLinked]

    for (const p of pending) {
      const driverName = p.driver.name ?? ''

      if (!p.norm) {
        // A blank or punctuation-only name. Named by id in the report, because "" in
        // a list of names tells nobody which row to go and fix.
        noMatch.push(driverName || `(driver ${p.driver.id})`)
        logRows.push({
          ran_at: runAt,
          driver_id: p.driver.id,
          driver_name: driverName || null,
          discord_user_id: null,
          discord_label: null,
          outcome: 'no_match',
          detail: 'This driver has no usable name to match on.',
        })
        continue
      }

      // More than one member answers to this name.
      if (p.free.length > 1) {
        const cands = p.free.map((id) => describe(id, p.norm))
        ambiguous.push({ driver: driverName, candidates: cands })
        logRows.push({
          ran_at: runAt,
          driver_id: p.driver.id,
          driver_name: driverName || null,
          discord_user_id: null,
          discord_label: null,
          outcome: 'ambiguous',
          detail: clip(
            `${p.free.length} Discord members answer to this name: ${cands.join(', ')}. Left alone — there is no automatic answer to a coin flip, and the wrong one would hand this driver's licence and race history to somebody else.`,
          ),
        })
        continue
      }

      if (p.free.length === 0) {
        noMatch.push(driverName)
        logRows.push({
          ran_at: runAt,
          driver_id: p.driver.id,
          driver_name: driverName || null,
          discord_user_id: null,
          discord_label: null,
          outcome: 'no_match',
          detail: clip(
            p.blocked.length
              ? `The only Discord ${p.blocked.length === 1 ? 'account' : 'accounts'} answering to this name — ${p.blocked
                  .map((id) => describe(id, p.norm))
                  .join(', ')} — ${p.blocked.length === 1 ? 'is' : 'are'} already linked to another driver.`
              : 'No member of the Discord server is known by this name.',
          ),
        })
        continue
      }

      // Exactly one member — but only a link if that member wants exactly one driver back.
      const uid = p.free[0]
      const rivals = (claimedBy.get(uid) ?? []).filter((id) => id !== p.driver.id)
      if (rivals.length) {
        const label = describe(uid, p.norm)
        ambiguous.push({ driver: driverName, candidates: [label] })
        logRows.push({
          ran_at: runAt,
          driver_id: p.driver.id,
          driver_name: driverName || null,
          discord_user_id: null,
          discord_label: null,
          outcome: 'ambiguous',
          detail: clip(
            `Discord member ${label} answers to this name, but also to ${rivals
              .map((id) => quote(nameOf(id)))
              .join(', ')}. Left alone rather than guessing which of them it is.`,
          ),
        })
        continue
      }

      const label = labelFor(uid, p.norm)
      const how = normalizeName(label) === p.norm ? 'the names are identical' : 'the names carry exactly the same words'

      // Conditional on the column still being null, and asking for the row back, so a
      // run that overlaps another one loses the race rather than overwriting it.
      const { data: wrote, error: writeErr } = await db
        .from('drivers')
        .update({ discord_user_id: uid })
        .eq('id', p.driver.id)
        .is('discord_user_id', null)
        .select('id')

      if (writeErr) {
        warnings.push(`Matched ${quote(driverName)} to ${describe(uid, p.norm)} but could not save it — ${writeErr.message}`)
        continue
      }
      if (!wrote?.length) {
        warnings.push(`${quote(driverName)} was linked by another run while this one was working — left as it now stands.`)
        continue
      }

      takenIds.add(uid)
      bound.push({ driver: p.driver, uid })
      linked.push({ driver: driverName, label, discord_user_id: uid })
      logRows.push({
        ran_at: runAt,
        driver_id: p.driver.id,
        driver_name: driverName || null,
        discord_user_id: uid,
        discord_label: label,
        outcome: 'linked',
        detail: clip(`Linked to Discord member ${describe(uid, p.norm)} — ${how}, and neither name matches anybody else.`),
      })
    }

    // The already-linked drivers get their line in the log too, so a run reads as a
    // complete account of the roster rather than only of what changed.
    for (const a of alreadyLinked) {
      const m = membersById.get(a.uid)
      const label = m ? m.labels[0] ?? null : null
      logRows.push({
        ran_at: runAt,
        driver_id: a.driver.id,
        driver_name: a.driver.name ?? null,
        discord_user_id: a.uid,
        discord_label: label,
        outcome: 'already_linked',
        detail: clip(
          m
            ? `Already linked to ${describe(a.uid)}. Left alone.`
            : `Already linked to ${a.uid}, who was not in the pages of the member list this run read. Left alone.`,
        ),
      })
    }

    // --- 5b. close the loop on the site side ---
    // A profile is a Discord login; a driver is a name on a results sheet. When the
    // same Discord id sits on both and the profile has never been pointed at a driver,
    // this is the moment we can say for certain which driver it is. Only ever fills a
    // null — an existing driver_id is somebody's decision and is never overwritten.
    const { data: profileRows, error: profErr } = await db
      .from('profiles')
      .select('id, discord_user_id, driver_id')
      .not('discord_user_id', 'is', null)
      .is('driver_id', null)
      .limit(MAX_PROFILES)
    if (profErr) warnings.push(`Could not check the site profiles — ${profErr.message}. Linking itself was unaffected.`)

    const orphanProfiles = new Map<string, string | null>() // discord id -> profile id, null when more than one claims it
    for (const p of (profileRows ?? []) as ProfileRow[]) {
      const uid = String(p?.discord_user_id ?? '').trim()
      if (!uid || !p?.id) continue
      orphanProfiles.set(uid, orphanProfiles.has(uid) ? null : p.id)
    }

    let profilesLinked = 0
    for (const b of bound) {
      if (!orphanProfiles.has(b.uid)) continue
      const profileId = orphanProfiles.get(b.uid)
      if (!profileId) {
        warnings.push(
          `More than one site profile claims Discord account ${b.uid}, so none of them was pointed at ${quote(b.driver.name ?? b.driver.id)}. Sort the duplicates out by hand.`,
        )
        continue
      }
      const { error: linkErr } = await db
        .from('profiles')
        .update({ driver_id: b.driver.id })
        .eq('id', profileId)
        .is('driver_id', null)
      if (linkErr) {
        warnings.push(`Could not point the site profile for ${quote(b.driver.name ?? b.driver.id)} at their driver — ${linkErr.message}`)
        continue
      }
      profilesLinked++
    }

    // --- 6. who has actually raced? ---
    // Membership is earned on track, not by joining the Discord. Every crew field in
    // the results table is split and normalised once, then de-duplicated: a segment
    // that appears in fifty rows is one string to compare against.
    //
    // Read in pages against the row count rather than in one go with a big limit:
    // PostgREST caps how many rows a single request may return, and that cap is a
    // server setting the client cannot talk it out of. A short page is the cap doing
    // its job, not the end of the table — and quietly stopping there would make a
    // driver look like they had never raced.
    const segmentSet = new Set<string>()
    let resErr: { message: string } | null = null
    let resultsRead = 0
    let resultsTotal: number | null = null

    while (resultsRead < MAX_RESULTS) {
      const to = Math.min(resultsRead + RESULT_PAGE, MAX_RESULTS) - 1
      const { data, error, count } = await db
        .from('results')
        .select('drivers_text', { count: 'exact' })
        .range(resultsRead, to)
      if (error) {
        // Asking for a page past the end is "nothing more to read", not a failure.
        if ((error as { code?: string }).code === 'PGRST103') break
        resErr = error
        break
      }
      if (typeof count === 'number') resultsTotal = count
      const batch = data ?? []
      resultsRead += batch.length
      for (const r of batch) {
        for (const seg of crewNames((r as { drivers_text?: string | null })?.drivers_text)) segmentSet.add(seg)
      }
      if (!batch.length) break
      if (resultsTotal !== null && resultsRead >= resultsTotal) break
    }

    if (resErr) {
      warnings.push(
        `Could not read the results — ${resErr.message}. Nobody was given the League Member role this run; linking was unaffected.`,
      )
    } else if (resultsTotal !== null && resultsRead < resultsTotal) {
      warnings.push(
        `Only ${resultsRead} of ${resultsTotal} results rows were read, so a driver who appears nowhere in those may not have been recognised as having raced. Nobody loses a role over it — this function only ever adds, and the next run picks up where this one stopped.`,
      )
    }
    const segments = [...segmentSet]

    // --- 7. grant the role ---
    // Additive and nothing else: if somebody already holds it we leave them be, and
    // there is no branch anywhere that takes it away.
    const granted: string[] = []
    let alreadyHadRole = 0
    let notInGuild = 0
    let hierarchyBlocked = false
    let staleRoleWarned = false

    if (roleId && !resErr) {
      for (const b of bound) {
        const driverName = b.driver.name ?? ''
        if (!hasRaced(segments, segmentSet, driverName)) continue

        const m = membersById.get(b.uid)
        if (!m) {
          // Either they have left, or they are on a page this run never fetched.
          // Neither is something to act on, and neither is something to undo.
          notInGuild++
          continue
        }
        if (m.roles.has(roleId)) {
          alreadyHadRole++
          continue
        }
        if (!SNOWFLAKE.test(b.uid)) {
          warnings.push(`${quote(driverName)} has a Discord id that isn't a Discord id (${clip(b.uid)}), so no role was granted.`)
          continue
        }
        if (hierarchyBlocked) continue

        const put = await discord(`/guilds/${guildId}/members/${b.uid}/roles/${roleId}`, 'PUT', botToken)
        if (put.ok) {
          granted.push(driverName)
          continue
        }
        if (put.status === 403) {
          // Hierarchy, not permission: the bot may hold Manage Roles and still be
          // unable to give out a role that sits above its own. It would fail
          // identically for everybody left, so stop asking and say what to fix.
          hierarchyBlocked = true
          warnings.push(
            "Discord refused to grant the League Member role (403) — drag the bot's role ABOVE League Member in Server Settings → Roles, then run this again. Everything else in this run still happened.",
          )
          continue
        }
        if (put.status === 404) {
          // We saw this member moments ago, so "unknown" is far more likely to be the
          // role than the person: an id saved in the config and since deleted in
          // Discord. Said once — it will be the same story for everybody after them.
          if (!staleRoleWarned) {
            staleRoleWarned = true
            warnings.push(
              `Discord does not recognise the League Member role id ${roleId} — check the role still exists, or clear the field in Admin → Discord and re-run to have it found by name again. (A member who left mid-run would also read like this.)`,
            )
          }
          continue
        }
        warnings.push(`Could not give ${quote(driverName)} the League Member role — ${put.message}`)
      }
    }

    if (notInGuild) {
      warnings.push(
        `${notInGuild} linked driver${notInGuild === 1 ? ' is' : 's are'} not in the pages of the server this run read, so ${notInGuild === 1 ? 'their role was' : 'their roles were'} left for a later run.`,
      )
    }

    // --- 8. log ---
    // One row per driver considered. The log is the record of why a link happened —
    // or why it deliberately didn't — long after the report has scrolled away.
    for (let i = 0; i < logRows.length; i += LOG_CHUNK) {
      const { error: logErr } = await db.from('discord_link_log').insert(logRows.slice(i, i + LOG_CHUNK))
      if (logErr) {
        warnings.push(`The run finished but part of it could not be written to the link log — ${logErr.message}`)
        break
      }
    }

    // --- 9. report ---
    return json({
      ok: true,
      drivers_considered: drivers.length,
      linked,
      ambiguous,
      no_match: noMatch,
      already_linked: alreadyLinked.length,
      granted,
      already_had_role: alreadyHadRole,
      role_league_member_resolved: !!roleId,
      members_scanned: membersScanned,
      scan_capped: scanCapped,
      profiles_linked: profilesLinked,
      warnings,
    })
  } catch (e) {
    // Nothing above should throw, but a 500 with a readable message beats a stack trace.
    return json({ error: `Discord driver linking failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
