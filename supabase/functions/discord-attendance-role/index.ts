// discord-attendance-role — the role that replaces naming people one by one.
//
// THE PROBLEM IT SOLVES. Chasing attendance used to mean writing a message that
// mentions each silent driver individually. That works, and it reads like a list of
// people being told off. One role does the same job: whoever still owes an answer
// holds @Attendance Pending, a single mention reaches exactly them, and the role
// empties itself as answers arrive. Nobody is named.
//
// IT IS A RECONCILER, NOT AN EVENT HANDLER. Every run it recomputes who SHOULD hold
// the role and makes the server match — it never assumes it knows the current state,
// so a hand-edit, a missed webhook or a failed run all self-heal on the next tick.
// That is also why it needs no change to discord-interactions: a driver who presses
// a button simply stops qualifying, and the next run takes the role off them.
//
// WHO SHOULD HOLD IT. Exactly the drivers who are:
//   - on the grid for the event with the open attendance post (off_grid answers and
//     people with no entry are not chased — they have nothing to answer for),
//   - reachable, i.e. they have a Discord account linked (a driver with no account
//     has not ignored anybody; they have no button. Chasing them is what made the
//     old reminder unstoppable), and
//   - still silent — answer is null.
//
// WHEN IT CLEARS. Three ways, all of them the same code path: the driver answers,
// the race starts (the ask window closes), or no drive is open at all. In each case
// the "should hold" set no longer contains them and the role comes off. The cycle
// restarts by itself when the next post appears, because the set is recomputed from
// whichever event currently has one.
//
// The role is created once, hoisted false and mentionable, and its id is recorded in
// discord_config.role_attendance_pending. It is never deleted.
//
// IT ALSO CLEARS THE PUBLIC POST AT THE GREEN FLAG. Once the race has started the
// buttons are meaningless and the question is answered, so the ask and its reminder
// come out of the member-facing channel and the room is empty for the next round.
// This is the same recycling discord-attendance already does with yesterday's nudge,
// extended to the end of the drive — and it destroys nothing: the answers live in
// race_attendance, and the staff tally and post-race recap in the private channel are
// the record. `cleared_at` is stamped so the delete is attempted exactly once rather
// than 404-ing every five minutes forever.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs Manage Roles, and its own highest role must sit ABOVE this one or
// Discord refuses every assignment with a 403.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const SNOWFLAKE = /^\d{5,25}$/
const ROLE_NAME = 'Attendance Pending'
/** Muted amber — a nudge, not an alarm. */
const ROLE_COLOR = 0xb8860b

interface TallyRow {
  discord_user_id: string | null
  answer: boolean | null
  off_grid: boolean
  driver_name?: string
}
interface Role { id: string; name?: string | null }
interface Member { user?: { id?: string } | null; roles?: string[] | null }

function isServiceRoleJwt(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    return (payload as { role?: unknown })?.role === 'service_role'
  } catch { return false }
}

async function api<T>(path: string, method: string, token: string, body?: unknown, attempt = 0): Promise<
  { ok: true; data: T } | { ok: false; status: number; message: string }
> {
  let res: Response
  try {
    res = await fetch(`${DISCORD}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (e) {
    return { ok: false, status: 0, message: String((e as Error)?.message ?? e) }
  }
  if (res.status === 429 && attempt < 3) {
    const retry = Number(res.headers.get('retry-after') ?? '1')
    await new Promise((r) => setTimeout(r, (Number.isFinite(retry) ? retry : 1) * 1000 + 250))
    return api<T>(path, method, token, body, attempt + 1)
  }
  const text = await res.text()
  let parsed: unknown = null
  if (text) { try { parsed = JSON.parse(text) } catch { /* not JSON */ } }
  if (!res.ok) {
    const detail = (parsed as { message?: string } | null)?.message
    return { ok: false, status: res.status, message: `Discord ${res.status}${detail ? `: ${detail}` : ''}` }
  }
  return { ok: true, data: (parsed ?? null) as T }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    let dryRun = false
    try {
      const b = await req.json()
      if (b && typeof b === 'object' && (b as { dryRun?: unknown }).dryRun === true) dryRun = true
    } catch { /* default: apply */ }

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
    const { data: cfg } = await db.from('discord_config')
      .select('enabled, guild_id, role_attendance_pending').eq('id', 1).maybeSingle()
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    const guildId = String(cfg.guild_id ?? '').trim()
    if (!SNOWFLAKE.test(guildId)) return json({ skipped: 'No Discord server is configured.' })

    const warnings: string[] = []

    // --- the role, created once --------------------------------------------------
    let roleId = String(cfg.role_attendance_pending ?? '').trim()
    const roles = await api<Role[]>(`/guilds/${guildId}/roles`, 'GET', botToken)
    if (!roles.ok) return json({ error: `Could not read roles — ${roles.message}` }, 502)
    const live = roles.data ?? []
    if (!SNOWFLAKE.test(roleId) || !live.some((r) => String(r.id) === roleId)) {
      const found = live.find((r) => String(r.name ?? '') === ROLE_NAME)
      if (found) roleId = String(found.id)
      else if (dryRun) roleId = ''
      else {
        // mentionable so ONE ping reaches everyone who owes an answer; not hoisted,
        // because owing an answer is not a rank and does not belong in the sidebar.
        const made = await api<Role>(`/guilds/${guildId}/roles`, 'POST', botToken, {
          name: ROLE_NAME, color: ROLE_COLOR, hoist: false, mentionable: true, permissions: '0',
        })
        if (!made.ok) return json({ error: `Could not create the ${ROLE_NAME} role — ${made.message}` }, 502)
        roleId = String(made.data?.id ?? '')
      }
      if (SNOWFLAKE.test(roleId) && !dryRun) {
        await db.from('discord_config')
          .update({ role_attendance_pending: roleId, updated_at: new Date().toISOString() }).eq('id', 1)
      }
    }
    if (!SNOWFLAKE.test(roleId)) {
      return json({ ok: true, dryRun, note: `The ${ROLE_NAME} role does not exist yet and dryRun did not create it.` })
    }

    // --- who SHOULD hold it ------------------------------------------------------
    // The open drive is the attendance post whose race has not started. Reading the
    // post rather than the event means a drive opened early with {"force": true} is
    // serviced from the moment it exists, not from its nominal Wednesday.
    const nowIso = new Date().toISOString()
    const { data: openRows } = await db
      .from('race_attendance_posts')
      .select('event_id, events!inner(id, round, name, date, status)')
      .gt('events.date', nowIso)
      .neq('events.status', 'complete')
      .limit(1)
    const open = (openRows ?? [])[0] as
      { event_id: string; events?: { round?: number; name?: string } } | undefined

    let should = new Set<string>()
    let label = 'no open attendance post'
    if (open?.event_id) {
      label = `Round ${open.events?.round} — ${open.events?.name}`
      const { data: tallyRows, error: tErr } = await db
        .rpc('race_attendance_tally', { p_event: open.event_id })
      if (tErr) return json({ error: `Could not read the tally — ${tErr.message}` }, 500)
      should = new Set(
        ((tallyRows ?? []) as TallyRow[])
          .filter((r) => !r.off_grid && r.answer === null && !!r.discord_user_id)
          .map((r) => String(r.discord_user_id)),
      )
    }

    // --- take the public post down once the flag has flown ------------------------
    const cleared: string[] = []
    {
      const { data: stale } = await db
        .from('race_attendance_posts')
        .select('event_id, channel_id, message_id, reminder_message_id, events!inner(round, name, date)')
        .is('cleared_at', null)
        .not('message_id', 'is', null)
        .lte('events.date', nowIso)
        .limit(5)

      for (const row of (stale ?? []) as Array<{
        event_id: string; channel_id: string | null
        message_id: string | null; reminder_message_id: string | null
        events?: { round?: number; name?: string }
      }>) {
        const ch = String(row.channel_id ?? '').trim()
        if (!SNOWFLAKE.test(ch)) continue
        if (dryRun) { cleared.push(`would clear Round ${row.events?.round}`); continue }

        let failed = false
        for (const mid of [row.message_id, row.reminder_message_id]) {
          const id = String(mid ?? '').trim()
          if (!SNOWFLAKE.test(id)) continue
          const del = await api(`/channels/${ch}/messages/${id}`, 'DELETE', botToken)
          // 404 is the outcome we wanted anyway — somebody removed it by hand.
          if (!del.ok && del.status !== 404) {
            warnings.push(`Could not clear a Round ${row.events?.round} post — ${del.message}`)
            failed = true
          }
        }
        // Only stamp when nothing errored, so a transient failure retries next run.
        if (!failed) {
          await db.from('race_attendance_posts')
            .update({ cleared_at: new Date().toISOString() }).eq('event_id', row.event_id)
          cleared.push(`Round ${row.events?.round} — ${row.events?.name}`)
        }
      }
    }

    // --- who DOES hold it --------------------------------------------------------
    const holders: string[] = []
    // Everyone actually IN the guild right now. A driver who has left cannot hold a
    // role, and asking Discord to give them one answers 404 Unknown Member — which
    // this function then reported as a failure on every five-minute run, for ever.
    // Presley Bromberg left on 25 Aug while still seated and did exactly that.
    const present = new Set<string>()
    let after = '0'
    for (let page = 0; page < 20; page++) {
      const res = await api<Member[]>(`/guilds/${guildId}/members?limit=1000&after=${after}`, 'GET', botToken)
      if (!res.ok) {
        // 403 here is almost always the missing GUILD_MEMBERS privileged intent.
        return json({ error: `Could not list members — ${res.message}. Nothing was changed.` }, 502)
      }
      const batch = res.data ?? []
      for (const m of batch) {
        const uid = String(m.user?.id ?? '')
        if (!uid) continue
        present.add(uid)
        if ((m.roles ?? []).map(String).includes(roleId)) holders.push(uid)
      }
      if (batch.length < 1000) break
      after = String(batch[batch.length - 1]?.user?.id ?? '0')
    }
    const has = new Set(holders)

    // Only people who are here. Someone still on the grid but no longer in the server
    // is a roster problem for race control, not something to retry against Discord
    // every five minutes — so they are counted and named once, not warned about
    // repeatedly.
    const gone = [...should].filter((id) => !present.has(id))
    const toAdd = [...should].filter((id) => !has.has(id) && present.has(id))
    const toRemove = [...has].filter((id) => !should.has(id))

    if (dryRun) {
      return json({ ok: true, dryRun, drive: label, role: ROLE_NAME,
        holding: has.size, should: should.size, would_add: toAdd.length,
        would_remove: toRemove.length, left_the_server: gone, cleared })
    }

    let added = 0, removed = 0
    for (const uid of toAdd) {
      const r = await api(`/guilds/${guildId}/members/${uid}/roles/${roleId}`, 'PUT', botToken)
      if (r.ok) added++
      else warnings.push(`Could not add the role to ${uid} — ${r.message}`)
    }
    for (const uid of toRemove) {
      const r = await api(`/guilds/${guildId}/members/${uid}/roles/${roleId}`, 'DELETE', botToken)
      if (r.ok) removed++
      else warnings.push(`Could not remove the role from ${uid} — ${r.message}`)
    }

    return json({
      ok: warnings.length === 0,
      drive: label,
      role: ROLE_NAME,
      role_id: roleId,
      still_owing: should.size,
      added,
      removed,
      // Seated, silent, and no longer in the server. Named so race control can decide
      // whether to withdraw them; never retried, because there is nothing to retry.
      left_the_server: gone,
      cleared,
      warnings,
    })
  } catch (e) {
    return json({ error: `discord-attendance-role failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
