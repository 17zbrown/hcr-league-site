// discord-prune-pending — removes people who joined the server, never finished
// Discord's membership screening, and have been sitting in that state longer than
// the league is willing to wait.
//
// This is the only function in the project that removes a person from anything, so
// it is written to fail closed at every step. Every gate below returns and kicks
// nobody, the default answer to "should I do this?" is no, and the run is a DRY RUN
// unless the caller sends a literal {"dryRun": false}. An empty body, a missing key,
// a typo, the string "false": all of those report what would happen and touch no one.
//
// A kick is NOT a ban. DELETE /guilds/{guild}/members/{user} removes somebody from
// the server and does nothing else — no messages are deleted, no record is held
// against them, and they can walk straight back in with a fresh invite. If you are
// reading this because somebody was removed by mistake, send them an invite; that is
// the entire fix. Nothing in this file can ban anybody, and it should stay that way.
//
// Who it will never touch: anybody holding any role (a role means a human has already
// made a decision about them, and a human's judgement outranks a timer), any bot,
// anybody who has signed into the website, the server owner, the bot itself, and
// anybody whose join date we could not read. Silence about somebody is treated as a
// reason to leave them alone, never as permission.
//
// Callable two ways, mirroring public.assert_admin_or_cron: an admin, or cron. Cron
// must present a service-role credential; there is deliberately no unauthenticated
// path, because the Supabase gateway lets the PUBLIC publishable key through as
// `apikey` with no Authorization header — which, for a function that removes people
// from a server, would have been the worst possible thing to leave world-callable.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs **Kick Members**, and its own role must sit ABOVE the people it is
// removing in Server Settings → Roles. It does not have that permission yet, so a
// 403 is an expected answer here rather than a surprise — it stops the run and says
// what to change.
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
// same ceiling the audit, the role reconcile and the driver linker use. Unlike those
// three, hitting the cap here is fatal: see the abort below.
const MEMBER_PAGE = 1000
const MAX_MEMBER_PAGES = 5
// Candidate ids go into an `in.(…)` filter, which lives in the query string. Chunk it.
const PROFILE_CHUNK = 200
// The log gets one row per person considered for removal, which is a short list.
const LOG_CHUNK = 500
// …with one exception: a server with a big screening backlog could push thousands of
// people past the per-run cap, every run, for ever. The overflow is real and worth
// naming, but naming all of it would drown the log in the same rows nightly, so only
// the front of the queue is written out. The count is always exact.
const MAX_OVERFLOW_LOGGED = 25
// Log details are for a human reading a table, not an essay.
const MAX_DETAIL = 500
// The same bounds the discord_config check constraints enforce. Read back rather than
// trusted: a column constraint protects the column, not this function's arithmetic.
const MIN_DAYS = 1
const MAX_DAYS = 90
const MIN_PER_RUN = 1
const MAX_PER_RUN = 100
const DAY_MS = 86_400_000

// A Discord snowflake is digits and nothing else. Everything interpolated into a
// request path is checked against this first — and the path being checked here is a
// DELETE, so "probably fine" is not good enough.
const SNOWFLAKE = /^\d{5,25}$/

interface Guild {
  id: string
  owner_id?: string | null
}
interface BotUser {
  id: string
}
interface Member {
  pending?: boolean | null
  joined_at?: string | null
  nick?: string | null
  roles?: string[] | null
  user?: { id?: string | null; username?: string | null; global_name?: string | null; bot?: boolean | null } | null
}
// One person who has joined and not finished screening: everything the decision needs,
// pulled out of Discord's payload once so the rules below read as rules.
interface Holdout {
  id: string
  label: string
  joinedAt: string | null
  daysPending: number | null
}
type Outcome = 'kicked' | 'would_kick' | 'failed' | 'spared'
interface LogRow {
  ran_at: string
  discord_user_id: string
  discord_label: string | null
  joined_at: string | null
  days_pending: number | null
  dry_run: boolean
  outcome: Outcome
  detail: string
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

// Every Discord call goes through here, and the method is typed down to the two verbs
// this function is allowed: read the server, remove one member. It never throws, it
// retries a rate limit (bounded, never forever), and it hands back Discord's own
// explanation of a refusal so a 403 can be reported rather than guessed at.
async function discord<T>(
  path: string,
  method: 'GET' | 'DELETE',
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
  // 204 = success with no content, which is what a kick returns.
  return { ok: true, data: (parsed ?? null) as T }
}

const badToken = 'Discord rejected the bot token — check the DISCORD_BOT_TOKEN secret in Supabase.'
const kickPermissionFix =
  'Discord refused the removal (403) — the bot needs the **Kick Members** permission, and its own role must sit ABOVE the members it removes in Server Settings → Roles. Fix that and run this again.'

const clip = (s: string) => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL - 1)}…` : s)
const quote = (s: string) => `"${s}"`
// Two decimals is plenty for a column whose whole job is "how long have they sat there".
const round2 = (n: number) => Math.round(n * 100) / 100

/** The best name we have for somebody, for a log a human will read months from now. */
function labelOf(m: Member, id: string): string {
  for (const raw of [m?.nick, m?.user?.global_name, m?.user?.username]) {
    const label = String(raw ?? '').trim()
    if (label) return label
  }
  return id
}

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

    // --- dry run unless told otherwise ---
    // Only a literal `false` arms this. A missing key, an empty body, a non-JSON body,
    // the string "false", `0`: every one of those reports the plan and removes nobody.
    // Removing people is the one thing here that cannot be undone from this side, so
    // the safe answer is the default answer and the caller has to be explicit.
    let dryRun = true
    try {
      const body = await req.json()
      if (body && typeof body === 'object' && (body as { dryRun?: unknown }).dryRun === false) dryRun = false
    } catch (_) { /* empty or non-JSON body — the safe default stands */ }

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
    // signature the gateway has already verified. Anything else is a person, and a
    // person has to be an admin.
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

    // --- gate 1: is this switched on at all? ---
    // Two separate switches, both of which must be true. The integration being live is
    // not consent to remove anybody; prune_pending_enabled is the one that says that,
    // and it is off by default.
    const db = createClient(url, service)
    const { data: cfgRow, error: cfgErr } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    if (cfgErr) return json({ error: `Could not read the Discord config — ${cfgErr.message}. Nobody was removed.` }, 500)
    const cfg = (cfgRow ?? null) as Record<string, unknown> | null
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    if (!cfg.prune_pending_enabled) {
      return json({ skipped: 'Pending-member clean-up is switched off. Turn it on in Admin → Discord to use it.' })
    }

    // --- gate 2: can we talk to the right server? ---
    if (!String(cfg.guild_id ?? '').trim()) return json({ skipped: 'No Discord server is configured yet.' })
    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)
    const guildId = String(cfg.guild_id).trim()

    // The bounds are also check constraints on the column, but this function does
    // arithmetic with them and a nonsense value would do real damage: a threshold of 0
    // makes everybody old enough. Refuse rather than repair — a config nobody can
    // explain is not a mandate to remove people.
    const rawDays = Number(cfg.prune_pending_days)
    if (!Number.isFinite(rawDays) || !Number.isInteger(rawDays) || rawDays < MIN_DAYS || rawDays > MAX_DAYS) {
      return json({
        skipped: `The pending clean-up threshold (${String(cfg.prune_pending_days ?? 'unset')}) is not a whole number of days between ${MIN_DAYS} and ${MAX_DAYS}. Nobody was removed — fix it in Admin → Discord.`,
      })
    }
    const thresholdDays = rawDays

    const rawCap = Number(cfg.prune_pending_max_per_run)
    if (!Number.isFinite(rawCap) || !Number.isInteger(rawCap) || rawCap < MIN_PER_RUN || rawCap > MAX_PER_RUN) {
      return json({
        skipped: `The per-run limit (${String(cfg.prune_pending_max_per_run ?? 'unset')}) is not a whole number between ${MIN_PER_RUN} and ${MAX_PER_RUN}. Nobody was removed — fix it in Admin → Discord.`,
      })
    }
    const maxPerRun = rawCap

    const warnings: string[] = []

    // --- who must never be a candidate, whatever the timer says ---
    // Both of these are reads, and both are fatal if they fail. Not knowing who the
    // owner is means not being able to promise we won't remove them, and a promise we
    // cannot keep is not a promise. (Discord would refuse to kick the owner anyway —
    // but "the API would have stopped me" is not a safety mechanism, it is luck.)
    const guildRes = await discord<Guild>(`/guilds/${guildId}`, 'GET', botToken)
    if (!guildRes.ok) {
      if (guildRes.status === 401) return json({ error: badToken }, 400)
      return json(
        { error: `Could not read the server (${guildRes.message}), so the owner could not be identified. Nobody was removed.` },
        502,
      )
    }
    const ownerId = String(guildRes.data?.owner_id ?? '').trim()
    if (!ownerId) {
      return json({ error: 'Discord did not say who owns the server, so the owner could not be excluded. Nobody was removed.' }, 502)
    }

    const meRes = await discord<BotUser>('/users/@me', 'GET', botToken)
    if (!meRes.ok) {
      if (meRes.status === 401) return json({ error: badToken }, 400)
      return json(
        { error: `Could not work out the bot's own user id (${meRes.message}), so it could not be excluded from its own clean-up. Nobody was removed.` },
        502,
      )
    }
    const botUserId = String(meRes.data?.id ?? '').trim()
    if (!botUserId) {
      return json({ error: 'Discord did not say who the bot is, so it could not be excluded from its own clean-up. Nobody was removed.' }, 502)
    }

    // --- gate 3: read the WHOLE member list, or read none of it ---
    // Paged with ?after= (member ids come back ascending), stopping at the first short
    // page or the page cap, whichever lands first.
    const holdouts = new Map<string, Holdout>()
    const spared: { label: string; reason: string }[] = []
    const logRows: LogRow[] = []
    const runAt = new Date().toISOString()
    const now = Date.now()

    // Somebody we have looked at and decided against. The reason is recorded rather
    // than swallowed: "why is this person still here?" is the question this table
    // exists to answer, and a silent skip answers nothing.
    const spare = (h: { id: string; label: string; joinedAt: string | null; daysPending: number | null }, reason: string) => {
      spared.push({ label: h.label, reason })
      logRows.push({
        ran_at: runAt,
        discord_user_id: h.id,
        discord_label: h.label,
        joined_at: h.joinedAt,
        days_pending: h.daysPending,
        dry_run: dryRun,
        outcome: 'spared',
        detail: clip(reason),
      })
    }

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
                'Discord refused the member list (403) — enable the Server Members Intent for the bot in the Discord Developer Portal. Nobody was removed.',
            },
            502,
          )
        }
        return json({ error: `Could not read the server's members — ${res.message}. Nobody was removed.` }, 502)
      }
      pages++
      const batch = Array.isArray(res.data) ? res.data : []
      for (const m of batch) {
        const uid = String(m?.user?.id ?? '').trim()
        if (!uid) continue
        membersScanned++

        // Never an integration. A bot sitting in the server is somebody's plumbing.
        if (m?.user?.bot === true) continue
        // Discord's own flag for "has agreed to nothing yet". Note that it is only ever
        // true where the server has membership screening turned on — with screening off
        // nobody is pending and this function correctly finds nothing to do.
        if (m?.pending !== true) continue
        // Any role at all means a human has already touched this account: verified them,
        // given them a colour, made them staff. A timer does not get to overrule that.
        const roles = Array.isArray(m.roles) ? m.roles.filter((r): r is string => typeof r === 'string' && !!r) : []
        if (roles.length) continue

        const label = labelOf(m, uid)
        const rawJoined = String(m?.joined_at ?? '').trim()
        const parsed = rawJoined ? Date.parse(rawJoined) : Number.NaN
        const daysPending = Number.isNaN(parsed) ? null : round2((now - parsed) / DAY_MS)
        holdouts.set(uid, { id: uid, label, joinedAt: Number.isNaN(parsed) ? null : rawJoined, daysPending })
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

    // A short read is survivable everywhere else in this project — the reconcile just
    // reconciles who it saw, the linker picks the rest up next time. Here it is fatal.
    // A partial member list is the single input that could make this function remove
    // the wrong people: the pages we never fetched are exactly where the roles, the
    // profiles and the recent joins we would have spared somebody for are hiding.
    // "I only saw some of the server" is never a safe basis for removing anybody.
    if (!reachedEnd) {
      return json({
        skipped: `Read ${membersScanned} members and hit the page cap (${MAX_MEMBER_PAGES} pages of ${MEMBER_PAGE}) without reaching the end of the list, so this run never saw the whole server. Nobody was removed — a partial member list is not something anyone should be removed on the strength of.`,
      })
    }

    // --- gate 4: an empty server is a bug, not a clean-up job ---
    if (membersScanned === 0) {
      return json({
        skipped:
          'Discord returned an empty member list. A server with nobody in it is a symptom of something wrong — a missing Server Members Intent, or the wrong guild id — not a server that needs tidying. Nobody was removed.',
      })
    }

    // --- selection, continued: the checks that need more than the member payload ---
    // Everything from here is about somebody who is already pending, roleless and human.
    // Anybody who never got that far isn't logged: they are not near a removal, and a
    // row per bystander would bury the handful of rows that matter.
    const overdue: Holdout[] = []
    for (const h of holdouts.values()) {
      if (h.id === ownerId) {
        spare(h, 'This is the server owner. Never removed, whatever the timer says.')
        continue
      }
      if (h.id === botUserId) {
        spare(h, 'This is the bot itself. It does not remove itself.')
        continue
      }
      if (!SNOWFLAKE.test(h.id)) {
        // Belt and braces: this id is about to be interpolated into a DELETE path.
        spare(h, `Discord returned an id that is not a Discord id (${clip(h.id)}), so nothing was sent about them.`)
        continue
      }
      if (h.daysPending === null) {
        // The one rule with no upside to guessing at: an unreadable join date means we
        // cannot say how long they have been waiting, and somebody whose age we could
        // not establish is somebody we have no case against.
        spare(h, 'Their join date was missing or unreadable, so there is no way to tell how long they have been pending. Left alone.')
        continue
      }
      if (h.daysPending <= thresholdDays) continue // simply not old enough yet
      overdue.push(h)
    }

    // Anybody who has signed into the website is a real person who has done real
    // things here, whatever Discord's screening prompt thinks. Looked up by id in
    // chunks rather than by reading the whole profiles table, and a failed lookup
    // stops the run: not knowing whether somebody has an account is not the same as
    // knowing they don't.
    const linkedIds = new Set<string>()
    for (let i = 0; i < overdue.length; i += PROFILE_CHUNK) {
      const chunk = overdue.slice(i, i + PROFILE_CHUNK).map((h) => h.id)
      const { data: rows, error } = await db.from('profiles').select('discord_user_id').in('discord_user_id', chunk)
      if (error) {
        return json(
          { error: `Could not check who has a site account — ${error.message}. Nobody was removed, because a site account is the main reason not to remove somebody.` },
          500,
        )
      }
      for (const r of (rows ?? []) as { discord_user_id: string | null }[]) {
        const uid = String(r?.discord_user_id ?? '').trim()
        if (uid) linkedIds.add(uid)
      }
    }

    const eligible: Holdout[] = []
    for (const h of overdue) {
      if (linkedIds.has(h.id)) {
        spare(h, 'They have signed into the HCR League website, so they are a real member of the league however Discord\'s screening prompt reads. Left alone.')
        continue
      }
      eligible.push(h)
    }

    // Oldest first, so a capped run always works from the far end of the queue and the
    // same backlog doesn't get re-shuffled every night. Ties broken by id so two runs
    // over the same data produce the same list.
    eligible.sort((a, b) => (b.daysPending ?? 0) - (a.daysPending ?? 0) || a.id.localeCompare(b.id))

    const candidates = eligible.slice(0, maxPerRun)
    const overflow = eligible.slice(maxPerRun)
    const capped = overflow.length > 0
    if (capped) {
      // Never silently work through the rest. The cap exists so a misconfiguration
      // empties a handful of chairs rather than the room, and quietly carrying on would
      // hand back exactly that safety.
      warnings.push(
        `${eligible.length} members matched but the per-run limit is ${maxPerRun}, so ${overflow.length} ${overflow.length === 1 ? 'was' : 'were'} left for a later run. Nothing happened to them — check this run's report before letting the next one go.`,
      )
      for (const h of overflow.slice(0, MAX_OVERFLOW_LOGGED)) {
        spare(h, `Matched, but this run's limit of ${maxPerRun} was already used up. Left for a later run.`)
      }
      if (overflow.length > MAX_OVERFLOW_LOGGED) {
        warnings.push(
          `Only the first ${MAX_OVERFLOW_LOGGED} of those ${overflow.length} are named in the report and the log — the count is exact, the list is not. A backlog this size is worth understanding before the clean-up is armed.`,
        )
      }
    }

    const asEntry = (h: Holdout) => ({
      discord_user_id: h.id,
      label: h.label,
      joined_at: h.joinedAt,
      days_pending: h.daysPending,
    })

    // --- action ---
    const kicked: ReturnType<typeof asEntry>[] = []
    let failures = 0

    if (dryRun) {
      for (const h of candidates) {
        logRows.push({
          ran_at: runAt,
          discord_user_id: h.id,
          discord_label: h.label,
          joined_at: h.joinedAt,
          days_pending: h.daysPending,
          dry_run: true,
          outcome: 'would_kick',
          detail: clip(
            `Pending for ${h.daysPending} days (limit ${thresholdDays}), holds no roles and has no site account. This run was a dry run, so nothing was sent to Discord.`,
          ),
        })
      }
    } else {
      // Armed. Each of these is a DELETE against the guild's member list, which is
      // Discord's kick: the person is removed from the server, keeps their messages and
      // their account, and can rejoin with a fresh invite. It is NOT a ban — nobody
      // reading this later should mistake it for one, and nothing here should ever be
      // "upgraded" into one.
      let blocked = false
      for (const h of candidates) {
        if (blocked) {
          failures++
          logRows.push({
            ran_at: runAt,
            discord_user_id: h.id,
            discord_label: h.label,
            joined_at: h.joinedAt,
            days_pending: h.daysPending,
            dry_run: false,
            outcome: 'failed',
            detail: 'Not attempted — an earlier removal in this run was refused by Discord and the run stopped there.',
          })
          continue
        }

        const res = await discord(`/guilds/${guildId}/members/${h.id}`, 'DELETE', botToken)

        if (res.ok) {
          kicked.push(asEntry(h))
          logRows.push({
            ran_at: runAt,
            discord_user_id: h.id,
            discord_label: h.label,
            joined_at: h.joinedAt,
            days_pending: h.daysPending,
            dry_run: false,
            outcome: 'kicked',
            detail: clip(
              `Removed from the server after ${h.daysPending} days pending (limit ${thresholdDays}), with no roles and no site account. This is a kick, not a ban — they can rejoin with a fresh invite.`,
            ),
          })
          continue
        }

        if (res.status === 403 || res.status === 401) {
          // The expected failure while the bot still lacks Kick Members, and it would
          // fail identically for everybody left, so stop asking. Hierarchy counts too:
          // the bot can hold the permission and still be unable to remove somebody whose
          // role sits above its own.
          blocked = true
          failures++
          warnings.push(res.status === 401 ? badToken : kickPermissionFix)
          logRows.push({
            ran_at: runAt,
            discord_user_id: h.id,
            discord_label: h.label,
            joined_at: h.joinedAt,
            days_pending: h.daysPending,
            dry_run: false,
            outcome: 'failed',
            detail: clip(`${res.message}. ${res.status === 401 ? badToken : kickPermissionFix}`),
          })
          continue
        }

        if (res.status === 404) {
          // They were in the member list minutes ago and are not there now: they left
          // under their own steam while this run was working. The wanted end state
          // arrived without us, so this is a spare rather than a failure.
          spare(h, 'They had already left the server by the time this run reached them, so nothing was done.')
          continue
        }

        failures++
        logRows.push({
          ran_at: runAt,
          discord_user_id: h.id,
          discord_label: h.label,
          joined_at: h.joinedAt,
          days_pending: h.daysPending,
          dry_run: false,
          outcome: 'failed',
          detail: clip(`Discord would not remove them — ${res.message}`),
        })
        warnings.push(`Could not remove ${quote(h.label)} — ${res.message}`)
      }
    }

    // --- log ---
    // One row per person this run had an opinion about. Written after the fact rather
    // than before, so the table records what happened instead of what was intended —
    // and written even when the run removed nobody, because "why was X spared?" is
    // asked far more often than "who did we kick?".
    for (let i = 0; i < logRows.length; i += LOG_CHUNK) {
      const { error: logErr } = await db.from('discord_prune_log').insert(logRows.slice(i, i + LOG_CHUNK))
      if (logErr) {
        warnings.push(`The run finished but part of it could not be written to the prune log — ${logErr.message}`)
        break
      }
    }

    // --- report ---
    return json({
      ok: failures === 0,
      dryRun,
      threshold_days: thresholdDays,
      scanned: membersScanned,
      candidates: candidates.map(asEntry),
      kicked,
      spared,
      capped,
      over_cap_count: overflow.length,
      warnings,
    })
  } catch (e) {
    // Nothing above should throw, but a 500 with a readable message beats a stack trace.
    return json({ error: `Pending-member clean-up failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
