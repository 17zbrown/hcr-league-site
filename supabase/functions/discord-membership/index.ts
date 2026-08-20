// discord-membership — greets arrivals in #welcome, reports departures to a
// staff-only channel, and keeps #website carrying the site link.
//
// TWO DIFFERENT MECHANISMS, because Discord treats the two events very differently:
//
//   JOINS: Discord's own "X joined the server" lines are SUPPRESSED league-wide
//   (system_channel_flags, one owner shared with discord-permissions) — #welcome
//   carries only the bot's guide. This function posts that welcome itself, because a
//   grey join notice could never carry instructions anyway and a newcomer needs them.
//
//   DEPARTURES are not announced by Discord at all, to any channel, ever. Seeing one
//   as it happens needs a gateway connection, which an edge function cannot hold. So
//   the member list is rolled and diffed: anyone on the previous roll and absent from
//   this one has gone, and Discord never says whether they left, were kicked or were
//   banned.
//
// The same diff finds arrivals. A gateway relay on a small VM (see oracle-gateway/ in
// the repo) now nudges this function the moment Discord reports either event, so in
// practice both are near-instant; the every-two-minutes cron remains underneath as
// the backstop for when that VM is down.
//
// The first run seeds the roll and announces nothing, because on an empty table
// every one of sixty members would look like a new arrival.
//
// {"dryRun": true} touches nothing and returns the welcome as it would be posted.
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
// Discord's system_channel_flags: bit 0 suppresses the join message. The league keeps
// it SET, together with bits 2 and 3 (sticker replies, setup tips).
const SUPPRESS_JOIN_NOTIFICATIONS = 1 << 0

const VIEW_CHANNEL = 1n << 10n
const SITE = 'https://hcrleague.com'
/**
 * The iRacing league id, quoted in the welcome guide.
 *
 * Signing up on the website does not make anybody a member of the league on
 * iRacing, and that is the one gap that stops a driver actually racing. It is the
 * league's public identifier, not a secret — it is printed in iRacing's own league
 * directory — so it belongs in the copy rather than in config.
 */
const IRACING_LEAGUE_ID = '14470'

/**
 * A member who joined longer ago than this is never greeted.
 *
 * The roll diff alone would treat anyone missing from discord_members as new, so if
 * that table were ever cleared or partially lost, the next run would @-mention sixty
 * people at once. Their join date is the independent check: it comes from Discord,
 * not from our bookkeeping, so it cannot be wrong in the same direction.
 */
const WELCOME_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000

/**
 * The channels worth pointing a newcomer at, in the order they need them.
 *
 * Each entry lists every name that channel has plausibly been given, because a tour
 * item that silently vanishes is the failure mode here: the first version of this
 * looked for "protests" while the server calls it "incident-protests", so the one
 * line telling people protests are filed on the website quietly dropped out. Listing
 * aliases means a rename costs a missing link only if nobody adds the new name.
 */
const TOUR: { names: string[]; blurb: string }[] = [
  { names: ['website'], blurb: 'the league site — schedule, standings, results and sign-up' },
  { names: ['announcements'], blurb: 'race weeks and results — the one channel to keep unmuted' },
  { names: ['news'], blurb: 'every story the site publishes' },
  { names: ['general-chat', 'general'], blurb: 'talk to the rest of the grid' },
  { names: ['race-control'], blurb: 'stewarding decisions and rulings' },
  { names: ['incident-protests', 'protests'], blurb: 'discuss an incident — but protests are **filed on the website**, not here' },
  { names: ['rules', 'rulebook'], blurb: 'the rulebook — worth ten minutes before your first race' },
]

/**
 * The single welcome guide the bot keeps at the bottom of #welcome.
 *
 * ONE MESSAGE, RECYCLED — not one per arrival. The guide is the same every time, so
 * posting a fresh copy for each newcomer buried the channel in identical tours and
 * pushed the actual conversation out of sight. Instead the previous copy is deleted
 * and a new one posted, which is the only way to keep something at the BOTTOM of a
 * Discord channel: pinning moves a message to the pinned list at the top, where
 * nobody looks, and there is no "sticky last message" feature to use.
 *
 * It still names whoever just arrived, and still mentions them, so the ping and the
 * personal greeting survive the change. Several people arriving together are all
 * named in the one message rather than getting one each.
 *
 * `ref` turns a channel name into a live <#id> link when that channel exists and
 * returns null when it does not, so the tour lists only real places — a newcomer
 * being sent to a channel that was renamed or removed is worse than a shorter list.
 */
function welcomeMessage(userIds: string[], ref: (name: string) => string | null): string {
  const tour = TOUR.map((t) => {
    const link = t.names.map(ref).find(Boolean) ?? null
    return link ? `> ${link} — ${t.blurb}` : null
  }).filter(Boolean) as string[]

  // "@a, @b and @c" — Discord renders each as a real mention, so everyone named is
  // pinged by the one message.
  const names = userIds.map((id) => `<@${id}>`)
  const greeting = names.length === 0 ? 'Welcome to HCR League 🏁'
    : names.length === 1 ? `Welcome to HCR League, ${names[0]} 🏁`
    : `Welcome to HCR League, ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} 🏁`

  return [
    `## ${greeting}`,
    '',
    'Three-class endurance racing — GTP, LMP2 and GTD share the track and score three separate championships.',
    '',
    '**Getting on the grid**',
    // EVERY LABEL HERE IS THE ONE ACTUALLY ON THE SCREEN. This guide used to say
    // "hit Sign in" and "open My Account", and neither string appears anywhere on
    // the site — the buttons read "Enter Season" and "My Portal". Sending a newcomer
    // to look for words that are not there is a worse failure than saying nothing,
    // because they assume the fault is theirs. If the site's copy changes, change
    // these with it.
    `**1.** Go to ${SITE} and hit **Enter Season** — sign in with this same Discord account, it takes one click.`,
    // Mentioned as something to have ready, not as a rule. Everyone signing up for an
    // iRacing league knows they will be asked for their iRacing details; spelling out
    // that the entry is refused without them reads as a warning to people who have
    // done nothing wrong. The form itself enforces it and says so at the point it
    // matters, which is where a rule belongs.
    '**2.** In **My Portal**, press **Enter the season**. Pick your class, your car and two car numbers — numbers are league-wide and first come, first served, so the second is there for when your first is taken. Have your iRacing name and customer ID to hand.',
    // THE STEP THAT WAS MISSING. Everything above happens on our website, and none
    // of it puts anybody in the race session — iRacing keeps its own league
    // membership. A driver could complete every step here, be on the published grid,
    // and still be unable to join on race night. That is exactly what happened.
    `**3.** Join the league on **iRacing** — separate from the website. Race control sends you an invite once you have entered; accept it from your iRacing account, or find us in the Leagues directory as **HCR League**, league ID **${IRACING_LEAGUE_ID}**.`,
    '',
    'Race Control confirms your grid slot from there. Once you are entered, your nickname in this server updates itself to your iRacing name and car number, and before each round you will get a post asking whether you are racing — one button.',
    ...(tour.length ? ['', '**Where things are**', ...tour] : []),
  ].join('\n')
}

interface Member {
  user?: { id?: string | null; username?: string | null; bot?: boolean | null } | null
  nick?: string | null
  joined_at?: string | null
  roles?: string[] | null
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
    const wrongChannel = welcome && String(guild.system_channel_id ?? '') !== String(welcome.id)

    // POLICY REVERSED 2026-08-20, deliberately: Discord's own grey join lines are now
    // SUPPRESSED, league-wide. #welcome carries only our pinned welcome post, and the
    // bot's guide reaches new members by DM/mention flows instead. This block used to
    // clear the suppress bit — which silently undid discord-permissions' suppression
    // within ten minutes, every ten minutes, while both functions reported success.
    // One owner now: the flags here are asserted to the SAME value discord-permissions
    // sets (join notifications, sticker replies and setup tips all off), and the
    // system channel still points at #welcome so boost messages have a home.
    const WANT_SUPPRESSED = 1 | 4 | 8
    const wantFlags = flags | WANT_SUPPRESSED
    if (welcome && (wrongChannel || wantFlags !== flags)) {
      const patch = await discord(`/guilds/${guildId}`, 'PATCH', botToken, {
        system_channel_id: welcome.id,
        system_channel_flags: wantFlags,
      })
      if (patch.ok) applied.push("#welcome kept quiet — Discord's own join messages stay suppressed")
      else warnings.push(`Could not update the system channel — ${patch.message}`)
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
      } else warnings.push(`Could not create #website — ${made.message}`)
    } else if (!website && dryRun) {
      applied.push('would create #website in LEAGUE with the site link pinned')
    }

    // A channel holding one link should OPEN on that link, so it is pinned rather than
    // left to slide up the history behind the next message.
    //
    // Checked every run against the channel's actual pins rather than done once at
    // creation: the first attempt used the wrong route (the pin endpoint is
    // /channels/{id}/pins/{message}, not /messages/{id}/pin), which 404'd and left the
    // channel with an unpinned link and no way to retry. Reading the pins first makes
    // that self-correcting and keeps the whole thing idempotent.
    if (website && !dryRun) {
      const pins = await discord(`/channels/${website.id}/pins`, 'GET', botToken)
      const pinned = Array.isArray(pins.data) ? (pins.data as unknown[]).length : 0
      if (pins.ok && pinned === 0) {
        const post = await discord(`/channels/${website.id}/messages`, 'POST', botToken, {
          content: [
            `## HCR League`, '',
            `**${SITE}**`, '',
            'Schedule, standings, results, the roster and season sign-up all live here.',
            'Hit **Enter Season** and sign in with the same Discord account you are reading this on.',
          ].join('\n'),
        })
        const msgId = (post.data as { id?: string } | null)?.id
        if (post.ok && msgId) {
          const pin = await discord(`/channels/${website.id}/pins/${msgId}`, 'PUT', botToken)
          if (pin.ok) applied.push('pinned the site link in #website')
          else warnings.push(`Posted the link in #website but could not pin it — ${pin.message}`)
        } else warnings.push(`Could not post the link in #website — ${post.message}`)
      } else if (!pins.ok) {
        warnings.push(`Could not read #website pins — ${pins.message}`)
      }
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
    const seen = new Map<string, { username: string; nick: string | null; joined: string | null; roles: string[] }>()
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
          // The member payload already carries every role id they hold, so keeping a
          // copy costs no extra API call — and it is the only way the database can
          // answer "who holds two class roles" or "who has Spectator AND a class",
          // which the full-site audit could previously only prove in aggregate.
          roles: Array.isArray(m.roles) ? m.roles.filter((r): r is string => typeof r === 'string' && r !== '') : [],
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
      last_seen: now, left_seen_at: null, announced_departure: false, roles: m.roles,
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
    // follows as soon as the gateway relay nudges us.
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
        currentGuideMessage: String(cfg.welcome_message_id ?? '') || '(none posted yet)',
        samplePreview: sampleId ? welcomeMessage([sampleId], ref) : '(no members to sample)',
        sampleIsReal: arrived.length > 0,
      })
    }
    if (!firstRun && arrived.length && welcomeChannel) {
      // Post the new copy BEFORE deleting the old one. If the post fails, the channel
      // keeps the guide it already had rather than being left with none — the wrong
      // order here would turn a transient Discord error into a missing welcome.
      const res = await discord(`/channels/${welcomeChannel}/messages`, 'POST', botToken, {
        content: welcomeMessage(arrived.map((a) => a.id), ref),
        // Only the newcomers. A guide that gets reposted on every join is the last
        // place an accidental @everyone should be reachable.
        allowed_mentions: { users: arrived.map((a) => a.id) },
      })
      const posted = (res.data as { id?: string } | null)?.id
      if (res.ok && posted) {
        welcomed.push(...arrived.map((a) => a.name))
        await db.from('discord_members').update({ welcomed_at: now })
          .in('user_id', arrived.map((a) => a.id))

        const previousGuide = String(cfg.welcome_message_id ?? '').trim()
        if (previousGuide && previousGuide !== posted) {
          const del = await discord(`/channels/${welcomeChannel}/messages/${previousGuide}`, 'DELETE', botToken)
          // A 404 means somebody already removed it by hand, which is a success for
          // our purposes: there is no stale copy left, which is all we wanted.
          if (!del.ok && del.status !== 404) {
            warnings.push(`Posted the new welcome but could not remove the previous one — ${del.message}`)
          }
        }
        const { error } = await db.from('discord_config')
          .update({ welcome_message_id: posted, updated_at: new Date().toISOString() }).eq('id', 1)
        if (error) {
          warnings.push(`Welcome posted but its id could not be saved, so the next one will not ` +
                        `clean this copy up — ${error.message}`)
        }
        applied.push(`welcomed ${arrived.length} arrival(s) and moved the guide to the bottom of #welcome`)
      } else warnings.push(`Could not post the welcome — ${res.message}`)
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

    // LEAVING THE SERVER TAKES YOU OFF THE GRID.
    //
    // Deliberately here rather than in the gateway bot: the bot reports that the member
    // list changed and is trusted for nothing else, and this function already re-reads
    // the whole roll. So a leave noticed instantly by the VM and one noticed two minutes
    // later by the cron withdraw the driver identically, and neither can be spoofed by
    // whatever the bot happened to send.
    //
    // NOTHING IS DELETED. withdraw_from_season marks the sign-up, stamps the crew link
    // and retires the car only once no driver is left on it — results.entry_id is
    // ON DELETE SET NULL, so removing the row would orphan every finish the driver had
    // already scored. Standings compute from results and never read entries, so a
    // withdrawn driver keeps every point they won and simply stops appearing on future
    // grids, which is the whole point.
    //
    // Past the firstRun guard on purpose. `gone` is empty on a seeded first run anyway,
    // but a future change that made it non-empty would otherwise withdraw the entire
    // league in one pass.
    const withdrawn: string[] = []
    if (gone.length) {
      const { data: current } = await db.from('seasons').select('id, name').eq('is_current', true).maybeSingle()
      if (current?.id) {
        // Only a member who linked their site account to Discord can be matched, which
        // is the same link the rest of the league logic runs on.
        const { data: profs } = await db
          .from('profiles')
          .select('id, display_name, discord_user_id')
          .in('discord_user_id', gone.map((g) => g.user_id))

        for (const p of (profs ?? []) as { id: string; display_name: string | null }[]) {
          const { data: out, error: wErr } = await db.rpc('withdraw_from_season', {
            p_season: current.id,
            p_user: p.id,
            p_reason: 'left the Discord server',
          })
          if (wErr) {
            warnings.push(`Could not withdraw ${p.display_name ?? p.id} after they left — ${wErr.message}`)
            continue
          }
          const o = (out ?? {}) as { registrations_withdrawn?: number; seats_withdrawn?: number; cars_retired?: number }
          // Only worth reporting when something actually changed. Most people who leave
          // never entered, and announcing "withdrew 0 things" for each of them is noise.
          if ((o.registrations_withdrawn ?? 0) + (o.seats_withdrawn ?? 0) > 0) {
            withdrawn.push(p.display_name ?? p.id)
            applied.push(`withdrew ${p.display_name ?? p.id} from ${current.name}`)
          }
        }
      }
    }

    const departuresChannel = String(departures?.id ?? '')
    let announced = 0
    if (gone.length && departuresChannel) {
      const lines = gone.map((g) => `• **${g.nickname || g.username || g.user_id}** (\`${g.user_id}\`)`)
      // Race control needs to know the grid just got shorter, in the same message that
      // says somebody left — otherwise the two facts live in different places.
      if (withdrawn.length) {
        lines.push(
          '',
          withdrawn.length === 1
            ? `**${withdrawn[0]}** was entered this season and has been withdrawn. Their results so far still stand.`
            : `**${withdrawn.length} of them were entered** this season and have been withdrawn: ${withdrawn.join(', ')}. Their results so far still stand.`,
        )
      }
      const res = await discord(`/channels/${departuresChannel}/messages`, 'POST', botToken, {
        embeds: [{
          title: gone.length === 1 ? 'A member left the server' : `${gone.length} members left the server`,
          description: lines.join('\n'),
          color: 0xc62430,
          footer: {
            text: 'Discord does not say whether someone left, was kicked or was banned.',
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
