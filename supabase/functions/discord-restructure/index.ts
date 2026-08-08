// discord-restructure — collapses the server from two leagues into one.
//
// HCR ran a league and an endurance team in the same server, and almost every
// structural decision in here existed to keep those two halves apart: a League
// Member role gating the LEAGUE category, an Endurance Member role gating ENDURANCE,
// and two sets of channels that could not see each other. The endurance side is
// finished, so that entire partition is now machinery guarding nothing.
//
// ORDER IS THE SAFETY PROPERTY. League Member is load-bearing: every permission
// overwrite in this server currently keys off it. Delete it first and 48 people lose
// sight of the LEAGUE category in the same instant. So the phases run strictly:
//
//   A  guild settings   — verification level, Community off
//   B  permissions      — hand LEAGUE to @everyone
//   C  Spectator role   — for members not signed up this season
//   D  Endurance        — archive what has history, delete what doesn't
//   E  retire the roles — ONLY if B fully succeeded
//
// Phase E is gated on Phase B reporting zero failures. If a single permission write
// fails, the roles stay exactly where they are and the run says so. A half-migrated
// server that can still see its channels is recoverable; one that cannot is not.
//
// Dry run unless the caller sends {"dryRun": false}.
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
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const SNOWFLAKE = /^\d{5,25}$/
const CHAN_CATEGORY = 4
const CHAN_FORUM = 15
const CHAN_VOICE = 2
const OVERWRITE_ROLE = 0

const LEAGUE = 'LEAGUE'
const ENDURANCE = 'ENDURANCE'
const SPECTATOR = 'Spectator'
// Discord's MEDIUM: verified email, and an account at least 5 minutes old.
const VERIFICATION_MEDIUM = 2

const P = {
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
}
const TALK = P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY | P.SEND_MESSAGES | P.ADD_REACTIONS |
  P.EMBED_LINKS | P.ATTACH_FILES | P.USE_EXTERNAL_EMOJIS | P.SEND_MESSAGES_IN_THREADS
const READ_ONLY_ALLOW = P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY | P.ADD_REACTIONS | P.USE_EXTERNAL_EMOJIS
const READ_ONLY_DENY = P.SEND_MESSAGES | P.SEND_MESSAGES_IN_THREADS | P.CREATE_PUBLIC_THREADS
const FORUM_REPLY_ALLOW = P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY | P.SEND_MESSAGES_IN_THREADS |
  P.ADD_REACTIONS | P.EMBED_LINKS | P.ATTACH_FILES | P.USE_EXTERNAL_EMOJIS
const FORUM_REPLY_DENY = P.SEND_MESSAGES | P.CREATE_PUBLIC_THREADS
const STAFF_ALLOW = TALK | P.CREATE_PUBLIC_THREADS

interface Overwrite { id: string; type: number; allow: string; deny: string }
interface Channel {
  id: string; name?: string | null; type: number; position?: number | null
  parent_id?: string | null; last_message_id?: string | null
  message_count?: number | null; total_message_sent?: number | null
  permission_overwrites?: Overwrite[] | null
}
interface Role { id: string; name?: string | null; position?: number | null; managed?: boolean | null }
interface Guild { id: string; features?: string[] | null; verification_level?: number | null }

type Res<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

async function api<T>(path: string, method: 'GET'|'POST'|'PATCH'|'PUT'|'DELETE', token: string, body?: unknown, attempt = 0): Promise<Res<T>> {
  let r: Response
  try {
    r = await fetch(`${DISCORD}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (e) { return { ok: false, status: 0, message: `Could not reach Discord (${String((e as Error)?.message ?? e)})` } }
  if (r.status === 429 && attempt < 3) {
    const wait = Number(r.headers.get('retry-after') ?? '1')
    await new Promise((f) => setTimeout(f, (Number.isFinite(wait) ? wait : 1) * 1000 + 250))
    return api<T>(path, method, token, body, attempt + 1)
  }
  const t = await r.text()
  let p: unknown = null
  if (t) { try { p = JSON.parse(t) } catch (_) { /* not JSON */ } }
  if (!r.ok) {
    const d = (p as { message?: string } | null)?.message
    return { ok: false, status: r.status, message: `Discord API ${r.status}${d ? `: ${d}` : ''}` }
  }
  return { ok: true, data: (p ?? null) as T }
}

const big = (v: unknown) => { try { return BigInt(String(v ?? '0') || '0') } catch { return 0n } }
/** Has anybody ever spoken here? Any positive signal counts — the question is only
 *  ever asked to decide whether deleting is safe. */
const hasHistory = (c: Channel) =>
  !!String(c.last_message_id ?? '').trim() || Number(c.message_count ?? 0) > 0 || Number(c.total_message_sent ?? 0) > 0

function isServiceRoleJwt(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const b = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    return (JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))) as { role?: unknown })?.role === 'service_role'
  } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

    let dryRun = true
    try {
      const b = await req.json()
      if (b && typeof b === 'object' && (b as { dryRun?: unknown }).dryRun === false) dryRun = false
    } catch (_) { /* safe default */ }

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
    const { data: cfgRow } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    const cfg = (cfgRow ?? null) as Record<string, unknown> | null
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    const guildId = String(cfg.guild_id ?? '').trim()
    if (!guildId || !botToken) return json({ error: 'Guild id or bot token missing.' }, 400)

    const plan: string[] = []
    const done: string[] = []
    const warnings: string[] = []
    // Everything Phase E depends on. Any failure here and the roles do not move.
    let permissionFailures = 0

    // @everyone's role id IS the guild id. That identity is the whole reason this
    // migration is possible without inventing a replacement membership role.
    const everyone = guildId

    const rolesRes = await api<Role[]>(`/guilds/${guildId}/roles`, 'GET', botToken)
    if (!rolesRes.ok) return json({ error: `Could not read roles — ${rolesRes.message}` }, 502)
    const roles = rolesRes.data ?? []
    const byName = (n: string) => roles.find((r) => String(r.name ?? '') === n)

    const chRes = await api<Channel[]>(`/guilds/${guildId}/channels`, 'GET', botToken)
    if (!chRes.ok) return json({ error: `Could not read channels — ${chRes.message}` }, 502)
    const channels = (chRes.data ?? []).filter((c) => c && SNOWFLAKE.test(String(c.id)))
    const cat = (n: string) => channels.find((c) => c.type === CHAN_CATEGORY && String(c.name ?? '') === n)
    const kids = (id: string) => channels.filter((c) => String(c.parent_id ?? '') === id && c.type !== CHAN_CATEGORY)

    const adminRole = String(cfg.role_site_admin ?? '').trim()
    const rcRole = String(cfg.role_site_race_control ?? '').trim()
    let botRole = ''
    {
      const me = await api<{ id: string }>('/users/@me', 'GET', botToken)
      if (me.ok) {
        const mem = await api<{ roles?: string[] }>(`/guilds/${guildId}/members/${String(me.data?.id)}`, 'GET', botToken)
        const managed = new Set(roles.filter((r) => r.managed).map((r) => String(r.id)))
        botRole = (mem.ok ? (mem.data?.roles ?? []) : []).map(String).find((r) => managed.has(r)) ?? ''
      }
    }

    /** Merge bits into an existing overwrite. Never replaces what it doesn't own. */
    const setPerms = async (ch: Channel, target: string, label: string, allow: bigint, deny: bigint) => {
      if (!SNOWFLAKE.test(target)) return
      const cur = (ch.permission_overwrites ?? []).find((o) => String(o.id) === target)
      const a0 = big(cur?.allow), d0 = big(cur?.deny)
      const a1 = (a0 | allow) & ~deny, d1 = (d0 | deny) & ~allow
      if (a1 === a0 && d1 === d0) return
      plan.push(`perms · #${ch.name} · ${label}`)
      if (dryRun) return
      const r = await api(`/channels/${ch.id}/permissions/${target}`, 'PUT', botToken,
        { type: OVERWRITE_ROLE, allow: a1.toString(), deny: d1.toString() })
      if (r.ok) done.push(`perms · #${ch.name} · ${label}`)
      else { permissionFailures++; warnings.push(`Could not set ${label} on #${ch.name} — ${r.message}`) }
    }

    // ---------------------------------------------------------------- PHASE A ----
    // Community off, verification to Medium. Membership screening is a Community
    // feature and disappears with it, so the verification level is what replaces it.
    const gRes = await api<Guild>(`/guilds/${guildId}`, 'GET', botToken)
    if (!gRes.ok) return json({ error: `Could not read the guild — ${gRes.message}` }, 502)
    const features = (gRes.data?.features ?? []).map(String)
    const wantFeatures = features.filter((f) => f !== 'COMMUNITY')
    const communityOn = features.includes('COMMUNITY')
    const levelWrong = Number(gRes.data?.verification_level ?? -1) !== VERIFICATION_MEDIUM

    if (communityOn || levelWrong) {
      plan.push(`guild · ${communityOn ? 'Community OFF' : ''}${communityOn && levelWrong ? ' + ' : ''}${levelWrong ? 'verification → Medium' : ''}`)
      if (!dryRun) {
        const body: Record<string, unknown> = { verification_level: VERIFICATION_MEDIUM }
        if (communityOn) body.features = wantFeatures
        const r = await api(`/guilds/${guildId}`, 'PATCH', botToken, body)
        if (r.ok) done.push('guild settings updated')
        else warnings.push(`Could not update guild settings — ${r.message}. Community and verification are unchanged; the rest of the run continued.`)
      }
    }

    // ---------------------------------------------------------------- PHASE B ----
    // Hand LEAGUE to @everyone. With no endurance side there is nothing left to
    // partition, so a membership role gating the league is machinery guarding
    // nothing — and it is the only thing standing between here and deleting it.
    const league = cat(LEAGUE)
    if (!league) {
      warnings.push('No LEAGUE category found. Permissions were not rewritten, so no roles were retired either.')
      permissionFailures++
    } else {
      await setPerms(league, everyone, '@everyone', P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY, 0n)
      for (const ch of kids(String(league.id))) {
        const name = String(ch.name ?? '')
        if (ch.type === CHAN_FORUM) {
          // Reply to the bot's race reports; don't open your own.
          await setPerms(ch, everyone, '@everyone', FORUM_REPLY_ALLOW, FORUM_REPLY_DENY)
        } else if (ch.type === CHAN_VOICE) {
          await setPerms(ch, everyone, '@everyone', P.VIEW_CHANNEL, 0n)
        } else if (name === 'announcements' || name === 'standings' || name === 'rulebook') {
          // Written by automation, read by everyone.
          await setPerms(ch, everyone, '@everyone', READ_ONLY_ALLOW, READ_ONLY_DENY)
        } else {
          await setPerms(ch, everyone, '@everyone', TALK, 0n)
        }
        for (const [rid, lbl] of [[adminRole, 'Admin'], [rcRole, 'Race Control'], [botRole, 'HCR Bot']] as const) {
          if (SNOWFLAKE.test(rid)) await setPerms(ch, rid, lbl, STAFF_ALLOW, 0n)
        }
      }
      // The two automation channels that live in RACE CONTROL but are read by
      // members. They were opened to League Member; reopen them to @everyone.
      for (const key of ['channel_license_ups', 'channel_race_control']) {
        const ch = channels.find((c) => String(c.id) === String(cfg[key] ?? '').trim())
        if (!ch) { warnings.push(`No channel configured for ${key}; it was not reopened.`); continue }
        await setPerms(ch, everyone, '@everyone', READ_ONLY_ALLOW, READ_ONLY_DENY)
        for (const [rid, lbl] of [[adminRole, 'Admin'], [rcRole, 'Race Control'], [botRole, 'HCR Bot']] as const) {
          if (SNOWFLAKE.test(rid)) await setPerms(ch, rid, lbl, STAFF_ALLOW, 0n)
        }
      }
    }

    // ---------------------------------------------------------------- PHASE C ----
    // Spectator: everyone in the server who is not on this season's grid. Useful as
    // a mention and as a thing to look at, rather than as a gate.
    let spectator = byName(SPECTATOR)
    if (!spectator) {
      plan.push(`role · create ${SPECTATOR}`)
      if (!dryRun) {
        const r = await api<Role>(`/guilds/${guildId}/roles`, 'POST', botToken, {
          name: SPECTATOR, color: 0x8a94a6, mentionable: true, hoist: false,
          permissions: '0',
        })
        if (r.ok && r.data?.id) { spectator = r.data; done.push(`role · created ${SPECTATOR}`) }
        else if (!r.ok) warnings.push(`Could not create ${SPECTATOR} — ${r.message}`)
      }
    }
    if (spectator && !dryRun && String(cfg.role_spectator ?? '') !== String(spectator.id)) {
      const { error } = await db.from('discord_config')
        .update({ role_spectator: String(spectator.id), updated_at: new Date().toISOString() }).eq('id', 1)
      if (error) warnings.push(`Created ${SPECTATOR} but could not save its id — ${error.message}`)
    }

    // ---------------------------------------------------------------- PHASE D ----
    // Endurance goes. Channels that hold conversation are moved out and closed
    // rather than deleted — the rule this project has held throughout is that
    // message history is somebody's conversation and is never destroyed.
    const end = cat(ENDURANCE)
    const endArchived: string[] = []
    const endDeleted: string[] = []
    if (end) {
      for (const ch of kids(String(end.id))) {
        if (hasHistory(ch)) {
          plan.push(`endurance · archive #${ch.name} (has history)`)
          if (!dryRun) {
            // Two steps, reported separately: a channel that moved out but stayed
            // visible is a different (and louder) problem from one that never moved.
            const moved = await api(`/channels/${ch.id}`, 'PATCH', botToken, { parent_id: null })
            if (!moved.ok) {
              warnings.push(`Could not move #${ch.name} out of ENDURANCE — ${moved.message}`)
            } else {
              const hidden = await api(`/channels/${ch.id}/permissions/${everyone}`, 'PUT', botToken,
                { type: OVERWRITE_ROLE, allow: '0', deny: P.VIEW_CHANNEL.toString() })
              if (hidden.ok) endArchived.push(String(ch.name))
              else warnings.push(`#${ch.name} was moved out of ENDURANCE but is still visible — ${hidden.message}`)
            }
          }
        } else {
          plan.push(`endurance · delete #${ch.name} (empty)`)
          if (!dryRun) {
            const r = await api(`/channels/${ch.id}`, 'DELETE', botToken)
            if (r.ok) endDeleted.push(String(ch.name))
            else warnings.push(`Could not delete #${ch.name} — ${r.message}`)
          }
        }
      }
      plan.push('endurance · delete the ENDURANCE category')
      if (!dryRun) {
        const r = await api(`/channels/${end.id}`, 'DELETE', botToken)
        if (r.ok) done.push('ENDURANCE category deleted')
        else warnings.push(`Could not delete the ENDURANCE category — ${r.message}`)
      }
    }

    // ---------------------------------------------------------------- PHASE E ----
    // The roles, last, and only if nothing above failed. A server that has lost a
    // membership role but kept its permissions is fine; one that lost its
    // permissions and kept the role is a server nobody can see.
    const retired: string[] = []
    const toRetire = ['HCR League Member', 'HCR Endurance Member']
    if (permissionFailures > 0) {
      warnings.push(`${permissionFailures} permission write(s) failed, so League Member and Endurance Member were NOT deleted. Fix the failures and run again — deleting them now would leave people unable to see the league.`)
    } else {
      const botTop = roles.filter((r) => String(r.id) === botRole).map((r) => Number(r.position ?? 0))[0] ?? 0
      for (const nm of toRetire) {
        const r = byName(nm)
        if (!r) continue
        if (Number(r.position ?? 0) >= botTop) {
          warnings.push(`${nm} sits at or above the bot's own role, so Discord will not let it be deleted. Move the bot higher in Server Settings → Roles.`)
          continue
        }
        plan.push(`role · retire ${nm}`)
        if (!dryRun) {
          const d = await api(`/guilds/${guildId}/roles/${r.id}`, 'DELETE', botToken)
          if (d.ok) retired.push(nm)
          else warnings.push(`Could not delete ${nm} — ${d.message}`)
        }
      }
      // Config must stop pointing at roles that no longer exist, or the reconciler
      // spends every five minutes chasing them.
      if (!dryRun && retired.length) {
        const patch: Record<string, null> = {}
        if (retired.includes('HCR League Member')) patch.role_league_member = null
        if (retired.includes('HCR Endurance Member')) patch.role_endurance_member = null
        if (Object.keys(patch).length) {
          const { error } = await db.from('discord_config').update(patch).eq('id', 1)
          if (error) warnings.push(`Roles retired but config still references them — ${error.message}`)
        }
      }
    }

    return json({
      ok: warnings.length === 0,
      dryRun,
      plan,
      applied: dryRun ? null : done,
      endurance_archived: endArchived,
      endurance_deleted: endDeleted,
      roles_retired: retired,
      permission_failures: permissionFailures,
      warnings,
    })
  } catch (e) {
    return json({ error: `Restructure failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
