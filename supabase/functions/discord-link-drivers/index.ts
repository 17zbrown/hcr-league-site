// discord-link-drivers — works out which Discord account belongs to which driver on
// the roster, then keeps the Spectator role tracking the season entry list.
//
// The roster comes from results PDFs, which only ever carry a name, so the two sides
// of the league have never known about each other: drivers.discord_user_id is null
// for almost everybody. This function closes that gap by name, and only by name it
// is sure of. There is no approval queue and no admin sign-off — an unsure match is
// simply left alone until a human renames somebody, which is a better outcome than a
// wrong one. A wrong link would hand one person's licence and race history to
// another, and nothing in here can tell that it happened.
//
// ROLE MODEL (class-first, since the endurance side closed): the class roles
// (GTP/LMP2/GTD) are owned by discord-driver-roles and are not touched here. This
// function owns exactly one role — Spectator, "in the server but not entered this
// season" — and it derives that from the ENTRY LIST (entries + entry_drivers for the
// current season), which is the single source of truth for who runs what. It used to
// grant a League Member role to everyone who had raced; that role is deleted and the
// concept is gone.
//
// WRITE DISCIPLINE. Linking only ever ADDS: a null discord_user_id can be filled,
// never changed. Roles are two writes and no more: PUT Spectator onto a member with
// no entry, DELETE Spectator from a member who has one. That DELETE is the single
// removal this function may make — it is the correction of its own earlier write,
// scoped to one role id it resolved itself. It never touches any other role, channel,
// message or member.
//
// Members whose name plausibly matches a not-yet-linked entered driver are left
// entirely alone: labelling somebody a Spectator seconds before linking proves they
// are on the grid would be wrong in the way that gets screenshotted.
//
// Safe to run as often as you like: every write is conditional on the thing not
// already being true, so a second run in a row does nothing at all.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs **Manage Roles**, and its own role must sit ABOVE Spectator in
// Server Settings → Roles or Discord will refuse with a 403.
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
// The log gets one row per driver considered, so a full roster goes in a few inserts.
const LOG_CHUNK = 500
// Log details are for a human reading a table, not an essay.
const MAX_DETAIL = 500

// The role that says "in the server, not entered this season". The restructure
// created it and saved its id to discord_config.role_spectator; the name is only a
// fallback for a config wiped by hand.
const SPECTATOR_NAME = 'spectator'

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
  user?: { id?: string | null; username?: string | null; global_name?: string | null; bot?: boolean | null } | null
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
// might be known by, what they already hold, and whether they are software.
interface ScannedMember {
  id: string
  labels: string[]
  roles: Set<string>
  isBot: boolean
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

// Every Discord call goes through here, and the method is typed down to the three
// verbs this function is allowed: read the server, add one role, remove that same
// role. DELETE exists solely so Spectator can come off a member who has entered the
// season — the correction of this function's own earlier write — and the one call
// site is the contract for that. It never throws, it retries a rate limit (bounded,
// never forever), and it hands back Discord's own explanation of a refusal.
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

// The canon throws away single characters before comparing tokens: "J" in "J. Smith"
// is an initial, not a name, and matching on it would make every Smith the same person.
const nameTokens = (normalized: string) => normalized.split(' ').filter((t) => t.length > 1)

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

    // --- 1b. which role means "Spectator"? ---
    // A saved id is the admin's explicit choice and wins outright. With the field
    // blank we look the role up by name and write the id back, so the next run — and
    // every other function that reads the column — stops having to guess.
    let roleId = String(cfg.role_spectator ?? '').trim()

    if (!roleId) {
      const rolesRes = await discord<Role[]>(`/guilds/${guildId}/roles`, 'GET', botToken)
      if (!rolesRes.ok) {
        if (rolesRes.status === 401) return json({ error: badToken }, 400)
        warnings.push(
          rolesRes.status === 403
            ? "Discord refused to list the server's roles (403) — the bot needs the Manage Roles permission. Drivers were still linked, but the Spectator role was not synced."
            : `Could not read the server's roles — ${rolesRes.message}. Drivers were still linked, but the Spectator role was not synced.`,
        )
      } else {
        // @everyone and bot-managed roles are skipped: neither can be handed to a driver.
        const found =
          (rolesRes.data ?? [])
            .filter((r) => r?.id && r.name !== '@everyone' && !r.managed)
            .find((r) => (r.name ?? '').trim().toLowerCase() === SPECTATOR_NAME) ?? null

        if (found) {
          roleId = found.id
          // An update rather than an upsert: we only got here by reading this exact
          // row, so it certainly exists, and an update cannot invent a half-filled
          // config row if something is odd.
          const { error: saveErr } = await db
            .from('discord_config')
            .update({ role_spectator: found.id, updated_at: new Date().toISOString() })
            .eq('id', 1)
          if (saveErr) {
            warnings.push(
              `Found the "${found.name}" role in Discord but could not save its id — ${saveErr.message}. The sync still ran; the lookup will just happen again next run.`,
            )
          }
        } else {
          warnings.push(
            'No Spectator role exists in the server. Drivers were still linked, but nobody could be marked a spectator — make the role in Discord, or re-run the restructure that creates it.',
          )
        }
      }
    }

    if (roleId && !SNOWFLAKE.test(roleId)) {
      warnings.push(
        `The saved Spectator role id (${clip(roleId)}) is not a Discord id, so the role was not synced. Fix it in Admin → Discord, or clear the field and re-run to have it found by name.`,
      )
      roleId = ''
    }

    // --- 1c. which roles mean "racing"? ---
    // Spectator and a class role are contradictory: one says "not entered this
    // season", the other only ever marks a racer. The Spectator loop below therefore
    // skips anyone holding a class role, linked or not — a GTP/LMP2/GTD role on an
    // unlinked member is a human's claim that this person races, and the answer to a
    // contradiction is the link that settles it, not a Spectator grant racing it.
    const classRoleIds = new Set<string>()
    {
      const { data: crRows } = await db.from('discord_class_roles').select('role_id')
      for (const r of (crRows ?? []) as { role_id?: string | null }[]) {
        const rid = String(r?.role_id ?? '').trim()
        if (SNOWFLAKE.test(rid)) classRoleIds.add(rid)
      }
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
          isBot: m?.user?.bot === true,
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

    // --- 6. who is entered this season? ---
    // The entry list, not the results, decides who is on the grid: entries +
    // entry_drivers for the current season is the single source of truth for who runs
    // what, and it covers a driver who has entered but not yet raced — exactly the
    // person the old "has raced" test wrongly left out.
    const enteredDriverIds = new Set<string>()
    let entryErr: { message: string } | null = null
    {
      const { data: season, error: seasonErr } = await db
        .from('seasons')
        .select('id')
        .eq('is_current', true)
        .limit(1)
        .maybeSingle()
      if (seasonErr || !season?.id) {
        entryErr = seasonErr ?? { message: 'no season is marked current' }
      } else {
        const { data: entryRows, error: edErr } = await db
          .from('entry_drivers')
          .select('driver_id, withdrawn_at, entries!inner(season_id, status)')
          .eq('entries.season_id', season.id)
          // Withdrawn drivers go back to Spectator: they are no longer racing this
          // season, even though the crew link survives to keep their results honest.
          .is('withdrawn_at', null)
          .neq('entries.status', 'withdrawn')
        if (edErr) entryErr = edErr
        else for (const r of (entryRows ?? []) as { driver_id?: string | null }[]) {
          const id = String(r?.driver_id ?? '').trim()
          if (id) enteredDriverIds.add(id)
        }
      }
    }
    if (entryErr) {
      warnings.push(
        `Could not read the entry list — ${entryErr.message}. The Spectator role was not touched this run; linking was unaffected.`,
      )
    }

    // Discord accounts that belong to an entered driver.
    const enteredUids = new Set<string>()
    for (const b of bound) if (enteredDriverIds.has(b.driver.id)) enteredUids.add(b.uid)

    // Members whose name matches an entered driver who is not linked yet. Nothing is
    // decided about them this run: marking somebody a Spectator moments before a link
    // proves they are on the grid would be wrong in the most visible way possible.
    const possiblyEntered = new Set<string>()
    for (const [uid, driverIds] of claimedBy) {
      if (driverIds.some((id) => enteredDriverIds.has(id))) possiblyEntered.add(uid)
    }

    // --- 7. sync the Spectator role against the entry list ---
    // Two writes exist: Spectator ON for a member with no entry, Spectator OFF for a
    // member with one. The removal is scoped to this one role id and nothing else —
    // it is this function correcting its own earlier write once somebody enters.
    const grantedSpectator: string[] = []
    const removedSpectator: string[] = []
    let alreadyCorrect = 0
    let leftAlonePossible = 0
    let leftAloneClassRole = 0
    let hierarchyBlocked = false
    let staleRoleWarned = false

    if (roleId && !entryErr) {
      for (const m of membersById.values()) {
        if (m.isBot) continue // software does not spectate
        const label = m.labels[0] ?? m.id
        const entered = enteredUids.has(m.id)
        const hasRole = m.roles.has(roleId)

        // A class role on a member with no linked entry is somebody's claim that
        // this person races. Not deepened here in either direction: no Spectator
        // goes ON while it stands, and none comes off on the strength of it.
        if (!entered && [...classRoleIds].some((rid) => m.roles.has(rid))) {
          leftAloneClassRole++
          continue
        }

        if (!entered && possiblyEntered.has(m.id)) {
          // Might be an entered driver we have not linked yet — leave them be.
          if (!hasRole) leftAlonePossible++
          else alreadyCorrect++ // they hold it; resolving the link decides its fate
          continue
        }
        if (entered === !hasRole) {
          alreadyCorrect++
          continue
        }
        if (hierarchyBlocked) continue

        const method = entered ? 'DELETE' : 'PUT'
        const res = await discord(`/guilds/${guildId}/members/${m.id}/roles/${roleId}`, method, botToken)
        if (res.ok) {
          ;(entered ? removedSpectator : grantedSpectator).push(label)
          continue
        }
        if (res.status === 403) {
          // Hierarchy, not permission: the bot may hold Manage Roles and still be
          // unable to manage a role that sits above its own. It would fail
          // identically for everybody left, so stop asking and say what to fix.
          hierarchyBlocked = true
          warnings.push(
            "Discord refused to change the Spectator role (403) — drag the bot's role ABOVE Spectator in Server Settings → Roles, then run this again. Everything else in this run still happened.",
          )
          continue
        }
        if (res.status === 404) {
          // We saw this member moments ago, so "unknown" is far more likely to be the
          // role than the person: an id saved in the config and since deleted in
          // Discord. Said once — it will be the same story for everybody after them.
          if (!staleRoleWarned) {
            staleRoleWarned = true
            warnings.push(
              `Discord does not recognise the Spectator role id ${roleId} — check the role still exists, or clear the field in Admin → Discord and re-run to have it found by name again. (A member who left mid-run would also read like this.)`,
            )
          }
          continue
        }
        warnings.push(`Could not ${entered ? 'remove the Spectator role from' : 'give the Spectator role to'} ${quote(label)} — ${res.message}`)
      }
    }

    // Steady-state observations go in `notes`, not `warnings`. discord_status_of
    // turns any non-empty warnings[] into an amber run in the admin panel, and both
    // of these are permanent facts about a server where people race without a site
    // account — filing them as warnings would leave this automation amber forever
    // and make the colour meaningless. Warnings are for things to fix.
    const notes: string[] = []
    if (leftAlonePossible) {
      notes.push(
        `${leftAlonePossible} member${leftAlonePossible === 1 ? '' : 's'} answer to the name of an entered driver who is not linked yet, so their Spectator status was deliberately left alone until the link resolves.`,
      )
    }
    if (leftAloneClassRole) {
      notes.push(
        `${leftAloneClassRole} member${leftAloneClassRole === 1 ? ' holds' : 's hold'} a class role without a linked entry, so Spectator was not touched for them — the role is a claim they race, and the link that proves it either way is the fix, not a guess here.`,
      )
    }

    // --- 8. log — transitions only ---
    // One row per driver WHOSE ANSWER CHANGED. The first version logged every driver
    // every run, which at 24 runs a day was ~600 identical no_match rows a day — and
    // a log nobody can read is not a record. The latest row per driver is fetched
    // and a new one written only when the outcome, or the account it points at,
    // differs. A steady state is silence; a transition is a row.
    let toLog = logRows
    {
      const { data: latest, error: latestErr } = await db.rpc('discord_link_log_latest')
      if (latestErr) {
        warnings.push(`Could not read the log's last state, so this run logged every driver — ${latestErr.message}`)
      } else {
        const prev = new Map(
          ((latest ?? []) as { driver_id: string; outcome: string; discord_user_id: string | null }[])
            .map((r) => [String(r.driver_id), `${r.outcome}|${r.discord_user_id ?? ''}`]),
        )
        toLog = logRows.filter((r) => prev.get(r.driver_id) !== `${r.outcome}|${r.discord_user_id ?? ''}`)
      }
    }
    for (let i = 0; i < toLog.length; i += LOG_CHUNK) {
      const { error: logErr } = await db.from('discord_link_log').insert(toLog.slice(i, i + LOG_CHUNK))
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
      entered_drivers: enteredDriverIds.size,
      granted_spectator: grantedSpectator,
      removed_spectator: removedSpectator,
      spectator_already_correct: alreadyCorrect,
      role_spectator_resolved: !!roleId,
      members_scanned: membersScanned,
      scan_capped: scanCapped,
      profiles_linked: profilesLinked,
      log_rows_written: toLog.length,
      notes,
      warnings,
    })
  } catch (e) {
    // Nothing above should throw, but a 500 with a readable message beats a stack trace.
    return json({ error: `Discord driver linking failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
