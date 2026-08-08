// discord-gate-setup — a staged, reversible tool for putting a click-to-enter gate on
// the front door of the league's Discord server.
//
// THE GATE: someone arrives, sees #welcome and nothing else, presses a button there,
// is given the Verified role, and the server opens up. This function neither posts that
// button nor hands out the role afterwards — that belongs with the interaction handler.
// What it does is prepare the server so both are safe: make the role, backfill it onto
// everyone who already races, and only then close the doors.
//
// IT IS STAGED BECAUSE IT IS THE ONE FUNCTION IN THIS PROJECT THAT CAN LOCK SIXTY
// PEOPLE OUT OF THEIR OWN COMMUNITY. Every call names its step; with no step it does
// nothing whatsoever. There is deliberately no "do it all" option: the ORDER of the
// steps is the safety property, and a single call that ran all four would leave no
// point at which a human sees the numbers and gets to stop.
//
//   {"step":"plan"}            report only — changes nothing, anywhere, ever
//   {"step":"create-role"}     create or adopt "Verified" and record its id
//   {"step":"grant-existing"}  backfill the role onto every human already here
//   {"step":"restrict"}        close the doors — refuses unless the backfill is complete
//   {"step":"revert"}          put the channel overwrites back
//
// EXISTING MEMBERS NEVER RE-VERIFY. The league owner's decision: sixty people who
// already race are not made to prove it. grant-existing is what implements that, and it
// is also what makes restrict safe — by the time the doors close, everyone holds the key
// already. restrict re-checks that live and refuses otherwise, so locking somebody out
// is not unlikely, it is impossible.
//
// THE GATE IS NOT THE RULEBOOK. It never mentions #rules and is not an acceptance of
// anything. It exists so a drive-by spam account cannot reach the whole server.
//
// PERMISSION MECHANICS — the parts that are easy to get wrong:
//
// @everyone's role id IS THE GUILD ID. There is no separate snowflake for it, so an
// overwrite addressed to the guild id is the one that applies to everybody.
//
// A CATEGORY DOES NOT DENY ANYTHING TO A CHANNEL INSIDE IT. This is the trap. Discord
// resolves a channel's permissions from that channel's OWN overwrite list and never
// consults the parent: a category is a template, not an inheritance chain. What the
// client calls "synced" only means the child's list is a copy of the parent's, made
// when the channel was created — Discord copies the parent's overwrites onto any
// channel created with a parent_id and no list of its own — or when somebody pressed
// sync. discord-membership's departureOverwrites() meets the same fact from the other
// side: it has to copy ADMIN's allows onto the new channel by hand, because nothing of
// ADMIN's would otherwise reach it.
//
// So the deny goes on the categories AND on every currently-public channel. Writing the
// categories is not redundant: it is what makes a channel created next month arrive
// already hidden rather than become a hole in the gate that nobody notices for a week.
//
// A CHANNEL THAT ALREADY DENIES @everyone IS LEFT COMPLETELY ALONE — no deny added and,
// far more importantly, NO Verified ALLOW. ADMIN, RACE CONTROL and #member-departures
// are private on purpose. Allowing Verified to view them would hand the staff channels
// to all sixty members while dressed as a lockdown, which is the worst thing this
// function could plausibly do. "Already denies @everyone" is exactly the right test for
// "somebody meant this to be private", and unlike a list of channel names it cannot go
// stale.
//
// #welcome is forced OPEN to @everyone rather than merely skipped, because a gate whose
// one unlocked door is itself locked is just a locked server.
//
// lock_permissions is never sent, on any call. It resyncs a channel to its parent, which
// would wipe the overwrites this function just wrote — or somebody else's.
//
// SQL: supabase/functions/discord-gate-setup/setup.sql adds the two columns this needs.
// Apply it before the first run.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot currently holds Administrator, which bypasses every overwrite here. When that
// is taken away it will need Manage Roles and Manage Channels, and its own role must sit
// above Verified in Server Settings → Roles.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const STEPS = ['plan', 'create-role', 'grant-existing', 'restrict', 'revert'] as const
type Step = (typeof STEPS)[number]

const WHAT_THE_STEPS_DO: Record<Step, string> = {
  'plan': 'Reports what each later step would do. Changes nothing.',
  'create-role': 'Creates the Verified role if it does not exist, and records its id.',
  'grant-existing': 'Gives Verified to every human already in the server. Safe to run twice.',
  'restrict': 'Hides every public channel except #welcome from @everyone. Refuses unless every human already holds Verified.',
  'revert': 'Restores the channel overwrites recorded before restrict ran.',
}

const SNOWFLAKE = /^\d{5,25}$/
const VIEW_CHANNEL = 1n << 10n
const CHAN_CATEGORY = 4
const OVERWRITE_ROLE = 0

/** The name of the key. Matched case-insensitively when adopting an existing role. */
const GATE_ROLE_NAME = 'Verified'
/** The one channel that stays open. Found by name, the way discord-membership finds it. */
const WELCOME_NAME = 'welcome'

const MEMBER_PAGE = 1000
const MAX_PAGES = 5

/**
 * How long the two long-running steps may keep working before stopping cleanly.
 *
 * Both are resumable, so stopping early costs nothing but a second call, whereas being
 * killed by the platform mid-loop with no report of what got done costs the operator
 * their picture of the server. Well under the edge runtime's wall clock either way.
 */
const WORK_BUDGET_MS = 60_000

/**
 * Longest single back-off honoured from a 429, in seconds, and how many times.
 *
 * Bounded on both axes on purpose: a global rate limit can quote a minute or more, and
 * four unbounded waits inside one request would spend the whole function budget asleep
 * with nothing to show. Capping means an unlucky call fails and gets retried by the
 * next invocation of a resumable step, which is the cheaper failure.
 */
const RETRY_CAP_S = 15
const RETRIES = 4

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const big = (v: unknown) => { try { return BigInt(String(v ?? '0') || '0') } catch { return 0n } }

interface Overwrite { id: string; type: number; allow?: string | null; deny?: string | null }
interface Channel {
  id: string
  name?: string | null
  type: number
  parent_id?: string | null
  permission_overwrites?: Overwrite[] | null
}
interface Role { id: string; name?: string | null; managed?: boolean | null; position?: number | null }
interface Member {
  user?: { id?: string | null; username?: string | null; bot?: boolean | null } | null
  nick?: string | null
  roles?: string[] | null
}

interface Rate { remaining: number | null; resetAfter: number | null }
type ApiResult<T> =
  | { ok: true; status: number; data: T; rate: Rate }
  | { ok: false; status: number; message: string; rate: Rate }

/**
 * One call to Discord, with the rate-limit headers handed back to the caller.
 *
 * `reason` becomes X-Audit-Log-Reason. Worth the extra argument here more than anywhere
 * else in this project: when someone asks in three months why #general suddenly denied
 * @everyone, the server's own audit log will say so in a sentence instead of naming a
 * bot and leaving them to guess.
 */
async function discord<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  token: string,
  body?: unknown,
  reason?: string,
  attempt = 0,
): Promise<ApiResult<T>> {
  const noRate: Rate = { remaining: null, resetAfter: null }
  let res: Response
  try {
    res = await fetch(`${DISCORD}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        ...(reason ? { 'X-Audit-Log-Reason': reason.slice(0, 400) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (e) {
    return { ok: false, status: 0, message: `Could not reach Discord (${String((e as Error)?.message ?? e)})`, rate: noRate }
  }

  const header = (name: string): number | null => {
    const raw = res.headers.get(name)
    if (raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  const rate: Rate = { remaining: header('x-ratelimit-remaining'), resetAfter: header('x-ratelimit-reset-after') }

  const text = await res.text()
  let parsed: unknown = null
  if (text) { try { parsed = JSON.parse(text) } catch { /* not JSON */ } }

  // 429. The JSON body's retry_after is fractional and the more precise of the two, so
  // it is preferred over the header; the extra 250ms covers clock skew between us and
  // Discord, which is the difference between one retry and a second 429.
  if (res.status === 429 && attempt < RETRIES) {
    const fromBody = Number((parsed as { retry_after?: unknown } | null)?.retry_after)
    const fromHeader = Number(res.headers.get('retry-after') ?? Number.NaN)
    const wait = [fromBody, fromHeader].find((n) => Number.isFinite(n) && n >= 0) ?? 1
    await sleep(Math.min(wait, RETRY_CAP_S) * 1000 + 250)
    return discord<T>(path, method, token, body, reason, attempt + 1)
  }

  if (!res.ok) {
    const detail = (parsed as { message?: string } | null)?.message
    return { ok: false, status: res.status, message: `Discord API ${res.status}${detail ? `: ${detail}` : ''}`, rate }
  }
  return { ok: true, status: res.status, data: (parsed ?? null) as T, rate }
}

/**
 * Wait only when Discord says the bucket is empty.
 *
 * No fixed delay between calls: sixty grants paced at one a second would take a minute
 * for no reason at all. Discord reports how many requests are left in the bucket and
 * how long until it refills, which is strictly better information than any interval
 * guessed in advance.
 */
async function respectBucket(rate: Rate): Promise<void> {
  if (rate.remaining !== null && rate.remaining <= 0 && rate.resetAfter !== null && rate.resetAfter > 0) {
    await sleep(Math.min(rate.resetAfter, RETRY_CAP_S) * 1000 + 100)
  }
}

/** Is this a legacy service-role JWT? Only asked of a token the gateway already accepted. */
function isServiceRoleJwt(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const b = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    return (JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))) as { role?: unknown })?.role === 'service_role'
  } catch { return false }
}

type Roll =
  | { ok: true; humans: Member[]; bots: Member[]; complete: boolean }
  | { ok: false; status: number; message: string }

/** The whole member list, paged. `complete` is false if the page cap was hit first. */
async function rollMembers(guildId: string, token: string): Promise<Roll> {
  const humans: Member[] = []
  const bots: Member[] = []
  let after = '0'
  let pages = 0
  while (pages < MAX_PAGES) {
    const res = await discord<Member[]>(
      `/guilds/${guildId}/members?limit=${MEMBER_PAGE}&after=${after}`, 'GET', token)
    if (!res.ok) return { ok: false, status: res.status, message: res.message }
    const batch = res.data ?? []
    pages++
    for (const m of batch) {
      if (!String(m?.user?.id ?? '').trim()) continue
      if (m.user?.bot) bots.push(m); else humans.push(m)
    }
    if (batch.length < MEMBER_PAGE) return { ok: true, humans, bots, complete: true }
    after = String(batch[batch.length - 1]?.user?.id ?? '')
    if (!after) return { ok: true, humans, bots, complete: true }
  }
  return { ok: true, humans, bots, complete: false }
}

const label = (m: Member) => m.nick || m.user?.username || String(m.user?.id ?? 'unknown')

/** What a channel's overwrite says about VIEW_CHANNEL right now, in one word. */
function viewState(o: Overwrite | undefined): 'allowed' | 'denied' | 'not set' {
  if (!o) return 'not set'
  if ((big(o.deny) & VIEW_CHANNEL) !== 0n) return 'denied'
  if ((big(o.allow) & VIEW_CHANNEL) !== 0n) return 'allowed'
  return 'not set'
}

type Act = 'gate' | 'open' | 'none'

/**
 * Decide what restrict would do to one channel, and say why in a sentence.
 *
 * The whole policy lives here so plan and restrict can never disagree about it: plan
 * reports exactly what restrict will then carry out, from the same function.
 */
function classify(ch: Channel, guildId: string, gateRoleId: string, welcomeId: string): { act: Act; because: string } {
  const ow = ch.permission_overwrites ?? []
  const everyone = ow.find((o) => String(o.id) === guildId)
  const gate = gateRoleId ? ow.find((o) => String(o.id) === gateRoleId) : undefined
  const everyoneView = viewState(everyone)
  const gateAllowed = (big(gate?.allow) & VIEW_CHANNEL) !== 0n

  if (String(ch.id) === welcomeId) {
    return everyoneView === 'allowed'
      ? { act: 'none', because: 'the door — already explicitly open to @everyone' }
      : { act: 'open', because: 'the door — @everyone will be explicitly allowed to view it' }
  }
  if (everyoneView === 'denied') {
    return gateAllowed
      ? { act: 'none', because: 'already gated — @everyone denied, Verified allowed' }
      : { act: 'none', because: 'already private to @everyone, so somebody meant it that way — left untouched' }
  }
  return { act: 'gate', because: 'public today — @everyone will be denied and Verified allowed' }
}

/** What a channel's @everyone and Verified overwrites looked like before we touched it. */
interface OverwriteMemo { present: boolean; allow: string; deny: string }
interface ChannelMemo { name: string; type: number; everyone: OverwriteMemo; gate: OverwriteMemo }
interface Snapshot {
  version: 1
  taken_at: string
  guild_id: string
  gate_role_id: string
  channels: Record<string, ChannelMemo>
  reverted_at: string | null
}

function memoFor(ch: Channel, id: string): OverwriteMemo {
  const o = (ch.permission_overwrites ?? []).find((x) => String(x.id) === id)
  return o
    ? { present: true, allow: String(o.allow ?? '0'), deny: String(o.deny ?? '0') }
    : { present: false, allow: '0', deny: '0' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const startedAt = Date.now()
  const outOfTime = () => Date.now() - startedAt > WORK_BUDGET_MS

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

    // NOTHING WITHOUT A STEP. No default, no "most useful thing to do", not even a
    // silent plan: a caller who forgot the body gets an error listing the steps, so the
    // only way to change this server is to have named the change.
    let step = ''
    try {
      const b = await req.json()
      if (b && typeof b === 'object') step = String((b as { step?: unknown }).step ?? '').trim().toLowerCase()
    } catch { /* no body at all — handled the same as no step */ }
    if (!step || !(STEPS as readonly string[]).includes(step)) {
      return json({
        error: step
          ? `"${step}" is not a step this function knows.`
          : 'No step given, so nothing was done. Send {"step":"plan"} to see where things stand.',
        steps: WHAT_THE_STEPS_DO,
        order: 'plan → create-role → grant-existing → plan again → restrict. revert undoes restrict.',
      }, 400)
    }
    const doing = step as Step

    const authz = req.headers.get('Authorization') ?? ''
    const bearer = authz.replace(/^Bearer\s+/i, '').trim()
    const viaCron = bearer.length > 0 && (bearer === service || isServiceRoleJwt(bearer))
    if (!viaCron) {
      const uc = createClient(url, anon, { global: { headers: { Authorization: authz } } })
      const { data: ud } = await uc.auth.getUser()
      if (!ud?.user) return json({ error: 'Not authenticated' }, 401)
      const { data: pf } = await uc.from('profiles').select('is_admin').eq('id', ud.user.id).maybeSingle()
      if (!pf?.is_admin) return json({ error: 'Admins only' }, 403)
    }

    const db = createClient(url, service)
    const { data: cfgRow, error: cfgError } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    if (cfgError) return json({ error: `Could not read discord_config — ${cfgError.message}` }, 500)
    const cfg = (cfgRow ?? null) as Record<string, unknown> | null

    // revert is exempt from the enabled flag on purpose. It is the way out, and the way
    // out must not sit behind a switch that somebody might have flicked off in the same
    // panic that made them want to use it.
    if (!cfg?.enabled && doing !== 'revert') {
      return json({ step: doing, skipped: 'Discord integration is disabled in config, so nothing was done.' })
    }
    const guildId = String(cfg?.guild_id ?? '').trim()
    if (!SNOWFLAKE.test(guildId)) return json({ step: doing, error: 'No Discord server is configured yet.' }, 400)
    if (!botToken) return json({ step: doing, error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    const warnings: string[] = []
    const applied: string[] = []
    const savedRoleId = String(cfg?.gate_role_id ?? '').trim()

    // gate_restore is missing entirely if setup.sql has not been applied. Saying so here
    // beats letting restrict discover it at the moment it needs somewhere to put the
    // only record of how the server used to look.
    const columnsReady = cfg !== null && 'gate_role_id' in cfg && 'gate_restore' in cfg
    if (!columnsReady) {
      return json({
        step: doing,
        error: 'discord_config is missing gate_role_id and/or gate_restore. Apply ' +
               'supabase/functions/discord-gate-setup/setup.sql first — without gate_restore there is ' +
               'nowhere to record how the server looked before the gate, and restrict would be a one-way door.',
      }, 400)
    }
    const snapshot = (cfg?.gate_restore ?? null) as Snapshot | null
    const gateIsApplied = !!snapshot && !snapshot.reverted_at && Object.keys(snapshot.channels ?? {}).length > 0

    // --- what the server currently looks like ------------------------------------
    const rolesRes = await discord<Role[]>(`/guilds/${guildId}/roles`, 'GET', botToken)
    if (!rolesRes.ok) {
      if (rolesRes.status === 401) {
        return json({ step: doing, error: 'Discord rejected the bot token — check the DISCORD_BOT_TOKEN secret in Supabase.' }, 400)
      }
      return json({ step: doing, error: `Could not read the server's roles — ${rolesRes.message}. Nothing was changed.` }, 502)
    }
    const roles = (rolesRes.data ?? []).filter((r) => r?.id)
    const rolesById = new Map(roles.map((r) => [String(r.id), r]))
    const gateRole =
      (savedRoleId ? rolesById.get(savedRoleId) : undefined) ??
      roles.find((r) => !r.managed && String(r.id) !== guildId &&
        (r.name ?? '').trim().toLowerCase() === GATE_ROLE_NAME.toLowerCase())
    const gateRoleId = String(gateRole?.id ?? '')
    if (savedRoleId && !rolesById.has(savedRoleId)) {
      warnings.push(`discord_config.gate_role_id points at role ${savedRoleId}, which no longer exists in this server.`)
    }

    // Can the bot actually hand this role out? Assigning a role needs the bot's own
    // highest role to sit above it. Checking up front turns sixty identical 403s into
    // one sentence naming the fix.
    let botTop = -1
    {
      const me = await discord<{ id: string }>('/users/@me', 'GET', botToken)
      if (me.ok && me.data?.id) {
        const mem = await discord<Member>(`/guilds/${guildId}/members/${me.data.id}`, 'GET', botToken)
        if (mem.ok) {
          for (const rid of mem.data?.roles ?? []) {
            botTop = Math.max(botTop, Number(rolesById.get(String(rid))?.position ?? 0))
          }
        }
      }
      if (botTop < 0) warnings.push("Could not work out where the bot's own role sits, so the hierarchy was not checked.")
    }
    const gatePosition = Number(gateRole?.position ?? -1)
    const hierarchyOk = botTop < 0 || gatePosition < 0 || gatePosition < botTop
    const hierarchyHint =
      `Drag the bot's role above ${GATE_ROLE_NAME} in Server Settings → Roles — Discord will not let a bot hand out a role ranked at or above its own.`

    // ============================ create-role =====================================
    if (doing === 'create-role') {
      if (gateRole) {
        // Adopting a role somebody already made by hand is the right default: creating a
        // second "Verified" would leave two roles with one name and a gate wired to
        // whichever one this function happened to make.
        if (savedRoleId !== String(gateRole.id)) {
          const { error } = await db.from('discord_config')
            .update({ gate_role_id: String(gateRole.id), updated_at: new Date().toISOString() }).eq('id', 1)
          if (error) return json({ step: doing, error: `Found the ${GATE_ROLE_NAME} role but could not record its id — ${error.message}` }, 500)
          applied.push(`recorded the existing ${GATE_ROLE_NAME} role (${gateRole.id}) in discord_config.gate_role_id`)
        }
        if (!hierarchyOk) warnings.push(hierarchyHint)
        return json({
          step: doing, ok: true, created: false, role: { id: String(gateRole.id), name: gateRole.name },
          message: applied.length
            ? `A role named ${GATE_ROLE_NAME} already existed, so it was adopted rather than duplicated. Nothing in Discord changed.`
            : `${GATE_ROLE_NAME} already exists and is already recorded. Nothing was done.`,
          applied, warnings, next_step: 'grant-existing',
        })
      }

      // permissions: '0' — the role is a key, not a rank. Guild permissions are the OR
      // of every role a member holds, so granting nothing here adds nothing to anybody;
      // all the role has to do is exist, so a channel overwrite can name it.
      //
      // color: 0 — no colour. Discord paints a name with its highest COLOURED role, and
      // everybody will hold this one. Give it a colour and it either flattens the whole
      // grid to one shade or loses a silent argument with the class roles, which are
      // colour-coded because GTP/LMP2/GTD is the thing worth reading off a name.
      //
      // hoist: false — everybody holds it, so hoisting would file the entire server
      // under one "Verified" heading and destroy the member list.
      const made = await discord<Role>(`/guilds/${guildId}/roles`, 'POST', botToken, {
        name: GATE_ROLE_NAME, permissions: '0', color: 0, hoist: false, mentionable: false,
      }, 'Gate setup: the role that a verified member holds')
      if (!made.ok) {
        return json({
          step: doing,
          error: made.status === 403
            ? `Discord refused to create the ${GATE_ROLE_NAME} role — the bot needs Manage Roles. ${hierarchyHint}`
            : `Could not create the ${GATE_ROLE_NAME} role — ${made.message}`,
        }, made.status === 403 ? 400 : 502)
      }
      const newId = String(made.data?.id ?? '')
      const { error } = await db.from('discord_config')
        .update({ gate_role_id: newId, updated_at: new Date().toISOString() }).eq('id', 1)
      if (error) {
        // The role exists in Discord but nothing here knows its id. Say so loudly: a
        // silent version of this leaves a second Verified role on the next run.
        return json({
          step: doing, error: `Created the ${GATE_ROLE_NAME} role (${newId}) but could not save its id — ${error.message}. ` +
                 'Re-run create-role: it will adopt the role that now exists rather than making another.',
        }, 500)
      }
      return json({
        step: doing, ok: true, created: true,
        role: { id: newId, name: GATE_ROLE_NAME, color: 'none', hoist: false, permissions: 'none' },
        message: `Created ${GATE_ROLE_NAME} with no colour, no hoist and no permissions of its own, and recorded its id. ` +
                 'Nobody holds it yet and no channel has changed, so the server looks exactly as it did.',
        applied: [`created the ${GATE_ROLE_NAME} role`], warnings, next_step: 'grant-existing',
      })
    }

    // Everything below needs the role to exist.
    if (doing !== 'plan' && doing !== 'revert' && !gateRole) {
      return json({
        step: doing,
        refused: `There is no ${GATE_ROLE_NAME} role yet, so there is nothing to grant or to allow.`,
        next_step: 'create-role',
      }, 409)
    }

    // ============================ grant-existing ==================================
    if (doing === 'grant-existing') {
      if (!hierarchyOk) return json({ step: doing, refused: `The bot cannot hand out ${GATE_ROLE_NAME}. ${hierarchyHint}` }, 409)

      const roll = await rollMembers(guildId, botToken)
      if (!roll.ok) {
        return json({
          step: doing,
          error: roll.status === 403
            ? 'Discord refused the member list (403) — enable the Server Members Intent for the bot.'
            : `Could not read the member list — ${roll.message}. Nothing was changed.`,
        }, 502)
      }

      // Bots are skipped. They neither press buttons nor need to; ours holds
      // Administrator, which bypasses every overwrite this function writes.
      const lacking = roll.humans.filter((m) => !(m.roles ?? []).map(String).includes(gateRoleId))
      let granted = 0
      const failed: { member: string; why: string }[] = []
      let stopped = false

      for (const m of lacking) {
        if (outOfTime()) { stopped = true; break }
        const uid = String(m.user?.id)
        const res = await discord(
          `/guilds/${guildId}/members/${uid}/roles/${gateRoleId}`, 'PUT', botToken, undefined,
          'Gate setup: existing member, verified by already being here')
        if (res.ok) granted++
        else if (res.status === 404) failed.push({ member: label(m), why: 'left the server between the roll and the grant' })
        else if (res.status === 403) {
          // Not a per-member problem: the bot is ranked wrong, and the next fifty calls
          // would fail identically. Stop and say the one thing that fixes it.
          return json({
            step: doing, ok: false, granted, already_had: roll.humans.length - lacking.length,
            refused: `Discord refused at member ${granted + 1} of ${lacking.length}. ${hierarchyHint}`,
            message: `${granted} member(s) were given ${GATE_ROLE_NAME} before that. Fix the hierarchy and run grant-existing again — ` +
                     'it will pick up exactly where it stopped.',
            warnings,
          }, 409)
        } else failed.push({ member: label(m), why: res.message })
        await respectBucket(res.rate)
      }

      const remaining = lacking.length - granted - failed.length
      if (!roll.complete) {
        warnings.push(`The member list was longer than ${MEMBER_PAGE * MAX_PAGES} and was cut off, so this pass only covered what it read. Run grant-existing again.`)
      }
      return json({
        step: doing,
        ok: failed.length === 0 && !stopped && roll.complete,
        // Everything needed to decide whether to run it again, in numbers rather than prose.
        humans_in_server: roll.humans.length,
        already_had: roll.humans.length - lacking.length,
        granted,
        failed,
        not_reached: stopped ? remaining : 0,
        complete: !stopped && failed.length === 0 && roll.complete,
        message: stopped
          ? `Ran out of time after ${granted} grant(s) with ${remaining} to go. Nothing is half-done — each grant either happened or did not — so run grant-existing again to continue.`
          : failed.length
            ? `Gave ${GATE_ROLE_NAME} to ${granted} member(s); ${failed.length} could not be done. Running this again retries only those.`
            : granted === 0
              ? `Every one of the ${roll.humans.length} human members already holds ${GATE_ROLE_NAME}. Nothing to do.`
              : `Gave ${GATE_ROLE_NAME} to ${granted} member(s). All ${roll.humans.length} humans in the server now hold it.`,
        warnings,
        next_step: 'plan, then restrict',
      })
    }

    // --- channels, needed by plan, restrict and (for names) revert ------------------
    const chRes = await discord<Channel[]>(`/guilds/${guildId}/channels`, 'GET', botToken)
    if (!chRes.ok) {
      return json({ step: doing, error: `Could not read the server's channels — ${chRes.message}. Nothing was changed.` }, 502)
    }
    const channels = (chRes.data ?? []).filter((c) => c && SNOWFLAKE.test(String(c.id)))
    const welcome = channels.find((c) => c.type === 0 && (c.name ?? '') === WELCOME_NAME)
    const welcomeId = String(welcome?.id ?? '')

    // ============================ revert ==========================================
    if (doing === 'revert') {
      // WHAT REVERT CAN AND CANNOT RESTORE.
      //
      // CAN: the exact @everyone and Verified overwrites, bit for bit, on every channel
      // restrict changed — including deleting an overwrite entirely where the channel
      // had none before. That is what the snapshot is for, and it is taken and written
      // to the database BEFORE restrict touches Discord, so it always exists if the
      // restrict did.
      //
      // CANNOT: anything not written down. A channel created after restrict ran is not
      // in the snapshot and is left alone. A channel deleted since is skipped. Every
      // permission other than VIEW_CHANNEL, and every overwrite for any other role or
      // member, is not restored because it was never changed. The Verified role is left
      // in place and nobody is stripped of it — it grants nothing once the denies are
      // gone, and taking a role off sixty people to undo a permissions change would be a
      // second irreversible act done in the name of undoing the first.
      //
      // AND THE ONE THAT BITES: the snapshot is a photograph of a single moment. If
      // somebody hand-edited a channel's @everyone view AFTER restrict ran, revert
      // overwrites that edit with the older value. It restores the server to how it
      // looked before the gate, not to how it looked five minutes ago.
      if (!snapshot || !Object.keys(snapshot.channels ?? {}).length) {
        return json({
          step: doing,
          refused: 'There is no record of a restrict having run, so there is nothing to put back and guessing would be worse than doing nothing.',
          message: 'If channels really are hidden and this row is empty, the manual fix is one line per channel in Discord: ' +
                   'Server Settings → the channel → Permissions → @everyone → View Channel back to the green tick.',
        }, 409)
      }
      if (snapshot.reverted_at) {
        return json({
          step: doing, ok: true, already_reverted_at: snapshot.reverted_at,
          message: `These overwrites were already put back at ${snapshot.reverted_at}. Nothing was done.`,
        })
      }

      const byId = new Map(channels.map((c) => [String(c.id), c]))
      const memos = Object.entries(snapshot.channels)
      let restored = 0
      let goneAlready = 0
      let stopped = false
      const restoreEveryone = String(snapshot.guild_id || guildId)
      const restoreGate = String(snapshot.gate_role_id || gateRoleId)

      for (const [id, memo] of memos) {
        if (outOfTime()) {
          stopped = true
          warnings.push('Ran out of time part-way through. Run revert again — it repeats safely and finishes the rest.')
          break
        }
        if (!byId.has(id)) { goneAlready++; continue }
        const name = memo.name || id
        let whole = true
        for (const [target, want] of [[restoreEveryone, memo.everyone], [restoreGate, memo.gate]] as const) {
          if (!SNOWFLAKE.test(target)) continue
          const res = want.present
            ? await discord(`/channels/${id}/permissions/${target}`, 'PUT', botToken,
                { type: OVERWRITE_ROLE, allow: want.allow, deny: want.deny }, 'Gate setup: revert to the pre-gate overwrites')
            : await discord(`/channels/${id}/permissions/${target}`, 'DELETE', botToken, undefined,
                'Gate setup: revert — this channel had no such overwrite before the gate')
          await respectBucket(res.rate)
          // A 404 on a delete means it is already not there, which is the state wanted.
          if (res.ok || (res.status === 404 && !want.present)) continue
          whole = false
          warnings.push(`Could not restore ${target === restoreEveryone ? '@everyone' : GATE_ROLE_NAME} on #${name} — ${res.message}`)
        }
        if (whole) { restored++; applied.push(`#${name}`) }
      }

      // Only stamped when every recorded channel was accounted for. A half-finished
      // revert that marked itself done would make the next call refuse with "already
      // reverted" and leave the remainder hidden, which is the exact shape of bug this
      // whole function exists to avoid.
      const finished = !stopped && restored + goneAlready === memos.length
      if (finished) {
        const done: Snapshot = { ...snapshot, reverted_at: new Date().toISOString() }
        const { error } = await db.from('discord_config')
          .update({ gate_restore: done, updated_at: new Date().toISOString() }).eq('id', 1)
        if (error) {
          warnings.push(`Channels were restored but the record could not be marked reverted — ${error.message}. ` +
                        'Running revert again is harmless: it would write the same values a second time.')
        }
      }
      return json({
        step: doing, ok: finished && warnings.length === 0,
        channels_restored: restored, channels_gone: goneAlready, channels_recorded: memos.length,
        complete: finished,
        message: finished
          ? `Put the @everyone and ${GATE_ROLE_NAME} view overwrites back on ${restored} channel(s)` +
            `${goneAlready ? `; ${goneAlready} recorded channel(s) no longer exist and were skipped` : ''}. ` +
            `Nobody was stripped of ${GATE_ROLE_NAME} and the role still exists — it simply no longer controls anything.`
          : `Restored ${restored} of ${memos.length} recorded channel(s) and stopped short. The record is left un-reverted ` +
            'on purpose so that running revert again picks up the rest.',
        applied, warnings,
      })
    }

    // --- the shared verdict, used identically by plan and restrict -------------------
    const verdicts = channels
      .map((c) => ({ ch: c, ...classify(c, guildId, gateRoleId, welcomeId) }))
      .sort((a, b) => (a.ch.type === CHAN_CATEGORY ? 0 : 1) - (b.ch.type === CHAN_CATEGORY ? 0 : 1))
    const todo = verdicts.filter((v) => v.act !== 'none')

    const roll = await rollMembers(guildId, botToken)
    if (!roll.ok) {
      return json({
        step: doing,
        error: roll.status === 403
          ? 'Discord refused the member list (403) — enable the Server Members Intent for the bot.'
          : `Could not read the member list — ${roll.message}. Nothing was changed.`,
      }, 502)
    }
    const lacking = gateRoleId
      ? roll.humans.filter((m) => !(m.roles ?? []).map(String).includes(gateRoleId))
      : roll.humans

    // ============================ plan ============================================
    if (doing === 'plan') {
      const blockers: string[] = []
      if (!gateRole) blockers.push(`the ${GATE_ROLE_NAME} role does not exist yet — run create-role`)
      if (!roll.complete) blockers.push('the member list was cut off by the page cap, so "everybody has it" cannot be established')
      if (lacking.length) blockers.push(`${lacking.length} of ${roll.humans.length} human members do not hold ${GATE_ROLE_NAME} — run grant-existing`)
      if (!welcome) blockers.push(`there is no #${WELCOME_NAME} channel, so the gate would have no door`)
      if (!hierarchyOk) blockers.push(`the bot is ranked at or below ${GATE_ROLE_NAME} and could not hand it out`)

      return json({
        step: 'plan',
        ok: true,
        changed_nothing: true,
        role: gateRole
          ? { exists: true, id: String(gateRole.id), name: gateRole.name, recorded_in_config: savedRoleId === String(gateRole.id) }
          : { exists: false, would_create: GATE_ROLE_NAME, colour: 'none', hoist: false, permissions: 'none' },
        members: {
          humans: roll.humans.length,
          bots: roll.bots.length,
          holding_the_role: roll.humans.length - lacking.length,
          lacking_the_role: lacking.length,
          first_few_lacking: lacking.slice(0, 10).map(label),
          roll_complete: roll.complete,
        },
        welcome_channel: welcome ? `#${welcome.name} (${welcome.id})` : `MISSING — no #${WELCOME_NAME} channel exists`,
        gate_currently_applied: gateIsApplied,
        // Every channel, with what @everyone sees now and what it would see after.
        channels: verdicts.map((v) => ({
          name: v.ch.type === CHAN_CATEGORY ? `${v.ch.name} (category)` : `#${v.ch.name}`,
          everyone_view_now: viewState((v.ch.permission_overwrites ?? []).find((o) => String(o.id) === guildId)),
          everyone_view_after: v.act === 'gate' ? 'denied' : v.act === 'open' ? 'allowed' : 'unchanged',
          verified_view_after: v.act === 'gate' ? 'allowed' : 'unchanged',
          note: v.because,
        })),
        would_change: todo.length,
        would_leave_alone: verdicts.length - todo.length,
        restrict_would_run: blockers.length === 0,
        restrict_blockers: blockers,
        message: blockers.length === 0
          ? `restrict would change ${todo.length} channel(s) and leave ${verdicts.length - todo.length} alone. ` +
            `All ${roll.humans.length} humans already hold ${GATE_ROLE_NAME}, so nobody would lose anything they can see today.`
          : `restrict would refuse right now: ${blockers.join('; ')}.`,
        warnings,
      })
    }

    // ============================ restrict ========================================
    // The refusals below are the whole point of this function. Each one is a way the
    // gate could have shut on somebody, checked live against Discord rather than against
    // what an earlier step reported.
    if (!welcome) {
      return json({
        step: doing,
        refused: `There is no #${WELCOME_NAME} channel, so hiding everything else would leave the server with no way in and no way to ask for one.`,
      }, 409)
    }
    if (!roll.complete) {
      return json({
        step: doing,
        refused: `The member list was cut off at ${roll.humans.length + roll.bots.length} before it ended, so it is not possible to say that everybody holds ${GATE_ROLE_NAME} — and "probably everybody" is not good enough to lock a door on.`,
      }, 409)
    }
    if (lacking.length) {
      return json({
        step: doing,
        refused: `${lacking.length} of ${roll.humans.length} human members do not hold ${GATE_ROLE_NAME}, and each of them would be locked out the moment this ran.`,
        first_few_lacking: lacking.slice(0, 10).map(label),
        next_step: 'grant-existing',
        message: 'Run grant-existing until it reports every human holding the role, then run restrict again. This check is live, so it cannot be satisfied by an old report.',
      }, 409)
    }
    if (!todo.length) {
      return json({
        step: doing, ok: true, changed: 0,
        message: `Every public channel is already gated and #${WELCOME_NAME} is already open. Nothing to do.`,
        warnings,
      })
    }
    // Bots other than ours lose sight of everything the moment @everyone is denied,
    // unless they hold Administrator or a role that is separately allowed. Worth one
    // sentence: an integration that quietly stops working is hard to trace back to here.
    if (roll.bots.length > 1) {
      warnings.push(`${roll.bots.length} bots are in this server. Any of them without Administrator will lose sight of the gated channels — give them ${GATE_ROLE_NAME} if they need to stay.`)
    }

    // THE SNAPSHOT IS WRITTEN BEFORE ANY DISCORD CALL, and a failure to write it stops
    // the whole step. An applied restrict with no record of what came before is the one
    // outcome this design must never produce.
    //
    // Entries are FIRST-WRITE-WINS against any existing un-reverted snapshot: run
    // restrict twice and the second run must not overwrite the memory of the original
    // state with the state its own first run created. That single rule is what makes
    // restrict resumable after a partial failure without eating its own escape route.
    const base: Snapshot = gateIsApplied && snapshot && snapshot.guild_id === guildId
      ? snapshot
      : { version: 1, taken_at: new Date().toISOString(), guild_id: guildId, gate_role_id: gateRoleId, channels: {}, reverted_at: null }
    const next: Snapshot = { ...base, reverted_at: null, gate_role_id: gateRoleId, channels: { ...(base.channels ?? {}) } }
    for (const v of todo) {
      const id = String(v.ch.id)
      if (next.channels[id]) continue // already remembered from an earlier run
      next.channels[id] = {
        name: String(v.ch.name ?? id),
        type: v.ch.type,
        everyone: memoFor(v.ch, guildId),
        gate: memoFor(v.ch, gateRoleId),
      }
    }
    const { error: snapError } = await db.from('discord_config')
      .update({ gate_restore: next, updated_at: new Date().toISOString() }).eq('id', 1)
    if (snapError) {
      return json({
        step: doing,
        refused: `The current channel permissions could not be written down (${snapError.message}), so nothing was changed. ` +
                 'Without that record revert would be guesswork, and this step is not worth doing on those terms.',
      }, 500)
    }

    let changed = 0
    let processed = 0
    let stopped = false
    for (const v of todo) {
      if (outOfTime()) { stopped = true; break }
      processed++
      const id = String(v.ch.id)
      const name = v.ch.type === CHAN_CATEGORY ? String(v.ch.name) : `#${v.ch.name}`
      const ow = v.ch.permission_overwrites ?? []
      const everyone = ow.find((o) => String(o.id) === guildId)

      if (v.act === 'open') {
        // A bit cannot sit in both fields, so setting one clears it from the other.
        const res = await discord(`/channels/${id}/permissions/${guildId}`, 'PUT', botToken, {
          type: OVERWRITE_ROLE,
          allow: String(big(everyone?.allow) | VIEW_CHANNEL),
          deny: String(big(everyone?.deny) & ~VIEW_CHANNEL),
        }, 'Gate setup: the one channel that stays open to everyone')
        if (res.ok) { changed++; applied.push(`${name}: @everyone can see it — this is the door`) }
        else warnings.push(`Could not open ${name} to @everyone — ${res.message}`)
        await respectBucket(res.rate)
        continue
      }

      const denied = await discord(`/channels/${id}/permissions/${guildId}`, 'PUT', botToken, {
        type: OVERWRITE_ROLE,
        allow: String(big(everyone?.allow) & ~VIEW_CHANNEL),
        deny: String(big(everyone?.deny) | VIEW_CHANNEL),
      }, `Gate setup: hidden until a member holds ${GATE_ROLE_NAME}`)
      await respectBucket(denied.rate)
      if (!denied.ok) {
        warnings.push(`Could not deny @everyone on ${name} — ${denied.message}. It is still visible to everyone.`)
        continue
      }

      // The allow must land or the channel is now invisible to the whole league. Ordered
      // second only because the reverse order would briefly show a hidden channel to
      // everyone, which is the far cheaper of the two mistakes; if this half fails it is
      // reported as an error to fix now, and re-running restrict repairs it.
      const gate = ow.find((o) => String(o.id) === gateRoleId)
      const allowed = await discord(`/channels/${id}/permissions/${gateRoleId}`, 'PUT', botToken, {
        type: OVERWRITE_ROLE,
        allow: String(big(gate?.allow) | VIEW_CHANNEL),
        deny: String(big(gate?.deny) & ~VIEW_CHANNEL),
      }, `Gate setup: visible to ${GATE_ROLE_NAME}`)
      await respectBucket(allowed.rate)
      if (allowed.ok) { changed++; applied.push(`${name}: @everyone denied, ${GATE_ROLE_NAME} allowed`) }
      else {
        warnings.push(`${name} is now hidden from @everyone but ${GATE_ROLE_NAME} was NOT allowed (${allowed.message}) — ` +
                      'nobody can see it. Run restrict again to finish it, or revert.')
      }
    }

    return json({
      step: doing,
      ok: warnings.length === 0 && !stopped,
      channels_changed: changed,
      channels_left_alone: verdicts.length - todo.length,
      not_reached: todo.length - processed,
      revert_recorded: true,
      message: stopped
        ? `Ran out of time after ${processed} of ${todo.length} channel(s). The rest are untouched and still public — run restrict again to finish.`
        : `Hid ${changed} channel(s) from @everyone and allowed ${GATE_ROLE_NAME} on them, left ` +
          `${verdicts.length - todo.length} alone as already-private or already-gated, and kept #${WELCOME_NAME} open. ` +
          `All ${roll.humans.length} humans hold ${GATE_ROLE_NAME}, so nobody lost sight of anything. ` +
          'revert puts every one of these back.',
      applied, warnings,
    })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
