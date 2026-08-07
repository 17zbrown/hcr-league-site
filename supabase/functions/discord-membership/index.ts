// discord-membership — keeps #welcome announcing joins, and reports departures to a
// staff-only channel.
//
// TWO DIFFERENT MECHANISMS, because Discord treats the two events very differently:
//
//   JOINS are native. Discord posts "X joined the server" into whichever channel is
//   set as the guild's system channel, instantly, with no bot listening. This
//   function's only job there is to point that setting at #welcome and make sure the
//   join flag is not suppressed — after which Discord does it forever, for free, and
//   faster than anything we could poll.
//
//   DEPARTURES are not announced by Discord at all, to any channel, ever. Seeing one
//   as it happens needs a gateway connection, which this stack does not have. So the
//   member list is rolled and diffed: anyone on the previous roll and absent from
//   this one has gone. That is a POLL — late by up to the cron interval, and unable
//   to distinguish left / kicked / banned. It is the honest ceiling without a
//   persistent bot, and it beats not noticing.
//
// The first run seeds the roll and announces nothing, because on an empty table
// every one of sixty members would look like a new arrival.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const MEMBER_PAGE = 1000
const MAX_PAGES = 5
// Discord's system_channel_flags: bit 0 suppresses the join message. Clearing it is
// what turns "X joined the server" back on.
const SUPPRESS_JOIN_NOTIFICATIONS = 1 << 0

const VIEW_CHANNEL = 1n << 10n
const SITE = 'https://hcrleague.com'

/**
 * A member who joined longer ago than this is never greeted.
 *
 * The roll diff alone would treat anyone missing from discord_members as new, so if
 * that table were ever cleared or partially lost, the next run would @-mention sixty
 * people at once. Their join date is the independent check: it comes from Discord,
 * not from our bookkeeping, so it cannot be wrong in the same direction.
 */
const WELCOME_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000

/** The channels worth pointing a newcomer at, in the order they need them. */
const TOUR: { name: string; blurb: string }[] = [
  { name: 'website', blurb: 'the league site — schedule, standings, results and sign-up' },
  { name: 'announcements', blurb: 'race weeks and results — the one channel to keep unmuted' },
  { name: 'news', blurb: 'every story the site publishes' },
  { name: 'general-chat', blurb: 'talk to the rest of the grid' },
  { name: 'race-control', blurb: 'stewarding decisions and rulings' },
  { name: 'protests', blurb: 'discuss an incident — but protests are **filed on the website**, not here' },
]

/**
 * The welcome a new member sees, mentioning them by id so it actually pings.
 *
 * `ref` turns a channel name into a live <#id> link when that channel exists and
 * returns null when it does not, so the tour lists only real places — a newcomer
 * being sent to a channel that was renamed or removed is worse than a shorter list.
 */
function welcomeMessage(userId: string, ref: (name: string) => string | null): string {
  const tour = TOUR.map((t) => {
    const link = ref(t.name)
    return link ? `> ${link} — ${t.blurb}` : null
  }).filter(Boolean) as string[]

  return [
    `## Welcome to HCR League, <@${userId}> 🏁`,
    '',
    'Three-class endurance racing — GTP, LMP2 and GTD share the track and score three separate championships.',
    '',
    '**Getting on the grid**',
    `**1.** Go to ${SITE} and hit **Sign in** — use this same Discord account, it takes one click.`,
    '**2.** Open **My Account** and enter the season.',
    '**3.** You will need your **full iRacing name** and **iRacing customer ID**. Those are how we add you to the league inside iRacing and match you to your results, so an entry without both cannot be accepted.',
    '**4.** Pick your class, your car, and two car numbers. Numbers are league-wide and first come, first served — your second choice is there for when the first is already gone.',
    '',
    'Race Control confirms your grid slot from there. Once you are entered, your nickname in this server updates itself to your iRacing name and car number.',
    ...(tour.length ? ['', '**Where things are**', ...tour] : []),
  ].join('\n')
}

interface Member {
  user?: { id?: string | null; username?: string | null; bot?: boolean | null } | null
  nick?: string | null
  joined_at?: string | null
}

interface Overwrite { id: string; type: number; allow?: string | null; deny?: string | null }
/** An overwrite with both bitfields settled, ready to send to Discord. */
interface FullOverwrite { id: string; type: number; allow: string; deny: string }
interface Channel {
  id: string
  name?: string | null
  type: number
  parent_id?: string | null
  permission_overwrites?: Overwrite[] | null
}

/**
 * The rules #member-departures should carry: a copy of ADMIN's, with @everyone
 * denied view on top.
 *
 * Sending permission_overwrites when creating a channel opts OUT of category
 * sync — Discord computes access from the channel's own list and never consults
 * the parent. So an @everyone deny on its own would hide the channel from every
 * staff role that is not a full Administrator, which is the opposite of the
 * point. The category's allows have to be copied across explicitly.
 */
function departureOverwrites(cat: Channel, guildId: string): FullOverwrite[] {
  const out = (cat.permission_overwrites ?? []).map((o) => ({
    id: String(o.id),
    type: Number(o.type ?? 0),
    allow: String(o.allow ?? '0'),
    deny: String(o.deny ?? '0'),
  }))
  const everyone = out.find((o) => o.id === guildId)
  if (everyone) {
    everyone.allow = String(BigInt(everyone.allow) & ~VIEW_CHANNEL)
    everyone.deny = String(BigInt(everyone.deny) | VIEW_CHANNEL)
  } else {
    out.push({ id: guildId, type: 0, allow: '0', deny: String(VIEW_CHANNEL) })
  }
  return out
}

async function discord(path: string, method: string, token: string, body?: unknown) {
  const res = await fetch(`${DISCORD}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: unknown = null
  try { parsed = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, data: parsed,
           message: (parsed as { message?: string } | null)?.message ?? text.slice(0, 200) }
}

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

    // {"dryRun": true} changes nothing in Discord or the database and returns the
    // welcome exactly as it would be posted — including a sample built from the most
    // recent member when nobody has actually just joined, so the copy and the channel
    // links can be read before sixty people are pinged by them.
    let dryRun = false
    try {
      const b = await req.json()
      if (b && typeof b === 'object' && (b as { dryRun?: unknown }).dryRun === true) dryRun = true
    } catch { /* no body — normal mode */ }

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
    const { data: cfg } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    const guildId = String(cfg.guild_id ?? '').trim()
    if (!guildId || !botToken) return json({ error: 'Guild id or bot token missing.' }, 400)

    const warnings: string[] = []
    const applied: string[] = []

    // --- joins: point Discord's own welcome message at #welcome -------------------
    const chans = await discord(`/guilds/${guildId}/channels`, 'GET', botToken)
    const channels = (chans.ok ? (chans.data as Channel[]) : []) ?? []
    const welcome = channels.find((c) => (c.name ?? '') === 'welcome' && c.type === 0)

    const g = await discord(`/guilds/${guildId}`, 'GET', botToken)
    if (!g.ok) return json({ error: `Could not read the guild — ${g.message}` }, 502)
    const guild = g.data as { system_channel_id?: string | null; system_channel_flags?: number }
    const flags = Number(guild.system_channel_flags ?? 0)
    const joinsSuppressed = (flags & SUPPRESS_JOIN_NOTIFICATIONS) !== 0
    const wrongChannel = welcome && String(guild.system_channel_id ?? '') !== String(welcome.id)

    if (welcome && (wrongChannel || joinsSuppressed)) {
      const patch = await discord(`/guilds/${guildId}`, 'PATCH', botToken, {
        system_channel_id: welcome.id,
        system_channel_flags: flags & ~SUPPRESS_JOIN_NOTIFICATIONS,
      })
      if (patch.ok) applied.push('#welcome now receives Discord’s join messages')
      else warnings.push(`Could not point join messages at #welcome — ${patch.message}`)
    } else if (!welcome) {
      warnings.push('No #welcome channel found, so join messages were not configured.')
    }

    // --- the departures channel, owned by the thing that writes to it --------------
    // It carries its own @everyone DENY rather than relying on ADMIN's: a channel
    // listing who has walked out should not be one mis-set category rule away from
    // public.
    const adminCat = channels.find((c) => c.type === 4 && (c.name ?? '').toUpperCase() === 'ADMIN')
    let departures = String(cfg.channel_departures ?? '').trim()
      ? channels.find((c) => String(c.id) === String(cfg.channel_departures))
      : undefined
    departures ??= channels.find((c) => c.type === 0 && (c.name ?? '') === 'member-departures')
    if (!departures && adminCat) {
      const made = await discord(`/guilds/${guildId}/channels`, 'POST', botToken, {
        name: 'member-departures',
        type: 0,
        parent_id: adminCat.id,
        topic: 'Members who have left the server, noticed by a periodic check. Staff only.',
        permission_overwrites: departureOverwrites(adminCat, guildId),
      })
      if (made.ok) {
        departures = made.data as Channel
        applied.push('created #member-departures in ADMIN (staff only)')
      } else warnings.push(`Could not create #member-departures — ${made.message}`)
    } else if (!departures && !adminCat) {
      warnings.push('No ADMIN category found, so #member-departures was not created.')
    }

    // Reconcile the rules every run, additively: any role ADMIN grants gets the same
    // grant here, and @everyone stays denied. Only ids ADMIN mentions are touched, so
    // an extra overwrite added by hand in Discord survives untouched.
    if (departures && adminCat) {
      const have = new Map((departures.permission_overwrites ?? []).map((o) => [String(o.id), o]))
      for (const want of departureOverwrites(adminCat, guildId)) {
        const got = have.get(want.id)
        if (got && BigInt(got.allow ?? '0') === BigInt(want.allow) && BigInt(got.deny ?? '0') === BigInt(want.deny)) continue
        const res = await discord(`/channels/${departures.id}/permissions/${want.id}`, 'PUT', botToken, {
          type: want.type, allow: want.allow, deny: want.deny,
        })
        if (res.ok) {
          applied.push(want.id === guildId
            ? '#member-departures: @everyone denied view'
            : `#member-departures: matched ADMIN’s access for ${want.id}`)
        } else warnings.push(`Could not set #member-departures permissions for ${want.id} — ${res.message}`)
      }
    }

    if (departures && String(cfg.channel_departures ?? '') !== String(departures.id)) {
      const { error } = await db.from('discord_config')
        .update({ channel_departures: String(departures.id), updated_at: new Date().toISOString() }).eq('id', 1)
      if (error) warnings.push(`#member-departures exists but its id could not be saved — ${error.message}`)
      else applied.push('departure reports now route to #member-departures')
    }

    // --- #website: the link, somewhere permanent -----------------------------------
    // In LEAGUE rather than ADMIN, and left to inherit that category's rules, so every
    // member — including a roleless newcomer following the welcome — can read it.
    const leagueCat = channels.find((c) => c.type === 4 && (c.name ?? '').toUpperCase() === 'LEAGUE')
    let website = String(cfg.channel_website ?? '').trim()
      ? channels.find((c) => String(c.id) === String(cfg.channel_website))
      : undefined
    website ??= channels.find((c) => c.type === 0 && (c.name ?? '') === 'website')
    if (!website && !dryRun) {
      const made = await discord(`/guilds/${guildId}/channels`, 'POST', botToken, {
        name: 'website',
        type: 0,
        parent_id: leagueCat?.id,
        topic: `HCR League — schedule, standings, results and season sign-up. ${SITE}`,
      })
      if (made.ok) {
        website = made.data as Channel
        applied.push('created #website in LEAGUE')
        // A channel holding one link should open on that link, so it is pinned rather
        // than left to slide up the history behind the next message.
        const post = await discord(`/channels/${website.id}/messages`, 'POST', botToken, {
          content: [
            `## HCR League`, '',
            `**${SITE}**`, '',
            'Schedule, standings, results, the roster and season sign-up all live here.',
            'Sign in with the same Discord account you are reading this on.',
          ].join('\n'),
        })
        const pinId = (post.data as { id?: string } | null)?.id
        if (post.ok && pinId) {
          const pin = await discord(`/channels/${website.id}/messages/${pinId}/pin`, 'PUT', botToken)
          if (pin.ok) applied.push('pinned the site link in #website')
          else warnings.push(`Posted the link but could not pin it — ${pin.message}`)
        } else warnings.push(`Created #website but could not post the link — ${post.message}`)
      } else warnings.push(`Could not create #website — ${made.message}`)
    } else if (!website && dryRun) {
      applied.push('would create #website in LEAGUE with the site link pinned')
    }
    if (website && !dryRun && String(cfg.channel_website ?? '') !== String(website.id)) {
      const { error } = await db.from('discord_config')
        .update({ channel_website: String(website.id), updated_at: new Date().toISOString() }).eq('id', 1)
      if (error) warnings.push(`#website exists but its id could not be saved — ${error.message}`)
      else applied.push('#website recorded in config')
    }

    // Channel mentions for the welcome tour, resolved against what really exists.
    const byName = new Map(channels.filter((c) => c.type === 0 || c.type === 15)
      .map((c) => [(c.name ?? '').toLowerCase(), String(c.id)]))
    const ref = (name: string): string | null => {
      const id = byName.get(name.toLowerCase()) ?? (name === 'website' ? String(website?.id ?? '') : '')
      return id ? `<#${id}>` : null
    }

    // --- departures: roll the member list and diff --------------------------------
    const seen = new Map<string, { username: string; nick: string | null; joined: string | null }>()
    let after = '0'
    let pages = 0
    let complete = false
    while (pages < MAX_PAGES) {
      const res = await discord(`/guilds/${guildId}/members?limit=${MEMBER_PAGE}&after=${after}`, 'GET', botToken)
      if (!res.ok) {
        return json({
          error: res.status === 403
            ? 'Discord refused the member list (403) — enable the Server Members Intent for the bot.'
            : `Could not read members — ${res.message}`,
          applied, warnings,
        }, 502)
      }
      const batch = (res.data as Member[]) ?? []
      pages++
      for (const m of batch) {
        const id = String(m?.user?.id ?? '').trim()
        if (!id || m?.user?.bot) continue // software neither joins nor leaves
        seen.set(id, {
          username: String(m.user?.username ?? ''),
          nick: m.nick ?? null,
          joined: m.joined_at ?? null,
        })
      }
      if (batch.length < MEMBER_PAGE) { complete = true; break }
      after = String(batch[batch.length - 1]?.user?.id ?? '')
      if (!after) { complete = true; break }
    }

    // A partial roll would read as a mass exodus. Refuse to diff one.
    if (!complete) {
      return json({
        error: `Only ${seen.size} members were read before the page cap, so the roll is incomplete and was not diffed — nothing would distinguish an unread page from a departure.`,
        applied, warnings,
      }, 502)
    }

    const { data: previous } = await db.from('discord_members')
      .select('user_id, username, nickname, left_seen_at, welcomed_at')
    const known = new Map(((previous ?? []) as { user_id: string; username: string | null; nickname: string | null; left_seen_at: string | null; welcomed_at: string | null }[])
      .map((r) => [r.user_id, r]))
    const firstRun = known.size === 0

    // Arrivals, worked out BEFORE the upsert below overwrites the old roll: on it now,
    // absent from it last time, never greeted, and recently enough joined that a lost
    // table cannot turn the whole server into new arrivals.
    const cutoff = Date.now() - WELCOME_MAX_AGE_MS
    const arrived = [...seen.entries()]
      .filter(([id, m]) => {
        const prior = known.get(id)
        if (prior && prior.welcomed_at) return false
        if (prior && !prior.left_seen_at) return false // already on the roll and present
        const joined = m.joined ? Date.parse(m.joined) : NaN
        return Number.isFinite(joined) && joined >= cutoff
      })
      .map(([id, m]) => ({ id, name: m.nick || m.username || id }))

    const now = new Date().toISOString()
    const rows = [...seen.entries()].map(([id, m]) => ({
      user_id: id, username: m.username, nickname: m.nick, joined_at: m.joined,
      last_seen: now, left_seen_at: null, announced_departure: false,
    }))
    if (!dryRun) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from('discord_members').upsert(rows.slice(i, i + 500), { onConflict: 'user_id' })
        if (error) warnings.push(`Part of the roll could not be saved — ${error.message}`)
      }
    }

    // --- welcomes -------------------------------------------------------------------
    // Posted by the bot rather than relying on Discord's own join notice, because that
    // notice cannot carry instructions. Both run: Discord's fires instantly, this one
    // follows within the hour with the part a newcomer actually needs.
    const welcomeChannel = String(welcome?.id ?? '')
    const welcomed: string[] = []
    // In a dry run with nobody new, show the copy against the newest member so it can
    // still be read — clearly labelled, and nothing is sent.
    const sampleId = arrived[0]?.id
      ?? [...seen.entries()].sort((a, b) => Date.parse(b[1].joined ?? '') - Date.parse(a[1].joined ?? ''))[0]?.[0]
    if (dryRun) {
      return json({
        ok: true, dryRun: true, applied, warnings,
        members: rows.length,
        wouldWelcome: arrived.map((a) => a.name),
        wouldAnnounceDepartures: [...known.values()].filter((r) => !seen.has(r.user_id) && !r.left_seen_at).length,
        welcomeChannel: welcomeChannel ? `#welcome (${welcomeChannel})` : 'MISSING — no #welcome channel found',
        samplePreview: sampleId ? welcomeMessage(sampleId, ref) : '(no members to sample)',
        sampleIsReal: arrived.length > 0,
      })
    }
    if (!firstRun && arrived.length && welcomeChannel) {
      for (const a of arrived) {
        const res = await discord(`/channels/${welcomeChannel}/messages`, 'POST', botToken, {
          content: welcomeMessage(a.id, ref),
          allowed_mentions: { users: [a.id] }, // only the newcomer; never @everyone here
        })
        if (res.ok) {
          welcomed.push(a.name)
          await db.from('discord_members').update({ welcomed_at: now }).eq('user_id', a.id)
        } else warnings.push(`Could not welcome ${a.name} — ${res.message}`)
      }
    } else if (arrived.length && !welcomeChannel) {
      warnings.push(`${arrived.length} member(s) joined but there is no #welcome channel to greet them in.`)
    }

    const gone = [...known.values()].filter((r) => !seen.has(r.user_id) && !r.left_seen_at)
    if (gone.length) {
      await db.from('discord_members')
        .update({ left_seen_at: now })
        .in('user_id', gone.map((g) => g.user_id))
    }

    // The first run has nothing to compare against; announcing then would report the
    // whole server as arrivals and departures at once.
    if (firstRun) {
      return json({ ok: true, seeded: rows.length, announced: 0, applied, warnings,
                    message: 'First run — the roll was seeded and nothing was announced.' })
    }

    const departuresChannel = String(departures?.id ?? '')
    let announced = 0
    if (gone.length && departuresChannel) {
      const lines = gone.map((g) => `• **${g.nickname || g.username || g.user_id}** (\`${g.user_id}\`)`)
      const res = await discord(`/channels/${departuresChannel}/messages`, 'POST', botToken, {
        embeds: [{
          title: gone.length === 1 ? 'A member left the server' : `${gone.length} members left the server`,
          description: lines.join('\n'),
          color: 0xc62430,
          footer: {
            text: 'Noticed by a periodic check, so this may be up to an hour after they left. ' +
                  'Discord does not say whether someone left, was kicked or was banned.',
          },
        }],
      })
      if (res.ok) announced = gone.length
      else warnings.push(`Could not post departures — ${res.message}`)
      if (announced) {
        await db.from('discord_members')
          .update({ announced_departure: true })
          .in('user_id', gone.map((g) => g.user_id))
      }
    } else if (gone.length && !departuresChannel) {
      warnings.push(`${gone.length} member(s) left but no departures channel is configured.`)
    }

    return json({ ok: warnings.length === 0, members: rows.length, welcomed,
                  departures: gone.length, announced, applied, warnings })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
