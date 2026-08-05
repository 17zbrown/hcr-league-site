// discord-reorg — settles the category layout now that the endurance side is gone.
//
// The server was built for two audiences and the categories still say so. Removing
// ENDURANCE took the channels away but left the shape they were arranged around:
//
//   START HERE  held welcome + rules. A category whose whole job was to sit newcomers
//               down and explain which of the two halves they were joining. With one
//               league there is nothing to explain and nowhere to route them, so two
//               channels occupy a whole sidebar section on their own.
//   PADDOCK     is documented in discord-layout as "the public social room and the only
//               place the two halves of the server meet". There are no two halves. What
//               is left is a social category, which is worth keeping — but the league
//               ALSO has #general-chat, so the same conversation now has two rooms and
//               members have to guess.
//
// So the shape becomes: LEAGUE is what the league publishes, PADDOCK is where members
// talk, RACE CONTROL is stewarding, ADMIN is staff. Four categories, each answering a
// different question, none of them describing an audience split that no longer exists.
//
// It also maintains #incident-protests — the DISCUSSION forum. Protests themselves
// are filed on the website, never in Discord, and every topic or copy written here
// says so.
//
// TWO SAFETY PROPERTIES, both deliberate:
//
//   1. lock_permissions is NEVER sent on a move. Discord treats it as "resync this
//      channel's overwrites to its new parent", which would silently rewrite every
//      per-channel rule built up over the last rebuild. Omitting it moves the channel
//      and leaves its own overwrites exactly as they are.
//   2. Only an EMPTY CATEGORY is ever deleted. A channel is never deleted by this
//      function under any flag — history is not ours to throw away. If START HERE
//      still has a child for any reason, it stays and the run says so.
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

const CHAN_CATEGORY = 4
const CHAN_FORUM = 15

const LEAGUE = 'LEAGUE'
const PADDOCK = 'PADDOCK'
const RACE_CONTROL = 'RACE CONTROL'
const START_HERE = 'START HERE'
const PROTESTS = 'incident-protests'

/** Channels that belong to LEAGUE: what the league publishes. */
const TO_LEAGUE = ['welcome', 'rules']
/** Channels that belong to PADDOCK: where members talk. */
const TO_PADDOCK = ['general-chat', 'Race Channel']

interface Overwrite { id: string; type: number; allow?: string; deny?: string }
interface Channel {
  id: string
  name?: string | null
  type: number
  position?: number | null
  parent_id?: string | null
  topic?: string | null
  permission_overwrites?: Overwrite[] | null
}

async function discord(path: string, method: string, token: string, body?: unknown) {
  const res = await fetch(`${DISCORD}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: unknown = null
  try { parsed = text ? JSON.parse(text) : null } catch { /* Discord sends bare text on some errors */ }
  const msg = (parsed as { message?: string } | null)?.message ?? text.slice(0, 200)
  return { ok: res.ok, status: res.status, data: parsed, message: msg }
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

    let dryRun = true
    try {
      const b = await req.json()
      if (b && typeof b === 'object' && (b as { dryRun?: unknown }).dryRun === false) dryRun = false
    } catch { /* no body: stay in dry run, which is the safe default */ }

    const authz = req.headers.get('Authorization') ?? ''
    const bearer = authz.replace(/^Bearer\s+/i, '').trim()
    // An empty bearer must never count as the service role — that was an actual
    // auth bypass in an earlier revision of these functions.
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

    const got = await discord(`/guilds/${guildId}/channels`, 'GET', botToken)
    if (!got.ok) return json({ error: `Could not read channels — ${got.message}` }, 502)
    const channels = (got.data ?? []) as Channel[]

    const catByName = (n: string) =>
      channels.find((c) => c.type === CHAN_CATEGORY && (c.name ?? '').trim().toUpperCase() === n.toUpperCase())
    const league = catByName(LEAGUE)
    const paddock = catByName(PADDOCK)
    const raceControl = catByName(RACE_CONTROL)
    const startHere = catByName(START_HERE)

    const plan: { step: string; detail: string }[] = []
    const applied: string[] = []
    const warnings: string[] = []

    // --- Moves --------------------------------------------------------------------
    // Each channel keeps its own permission overwrites. Reported so the effect on
    // visibility is inspectable rather than assumed: a channel with its own overwrites
    // is unaffected by the parent it hangs from, while one with none inherits its new
    // parent's, and that is the only case where a move can change who sees what.
    const moves: { ch: Channel; to: Channel; toName: string }[] = []
    for (const [names, target, targetName] of [
      [TO_LEAGUE, league, LEAGUE],
      [TO_PADDOCK, paddock, PADDOCK],
    ] as [string[], Channel | undefined, string][]) {
      if (!target) { warnings.push(`Category ${targetName} not found — nothing moved into it.`); continue }
      for (const name of names) {
        const ch = channels.find((c) => c.type !== CHAN_CATEGORY && (c.name ?? '') === name)
        if (!ch) { warnings.push(`#${name} not found — skipped.`); continue }
        if (String(ch.parent_id ?? '') === String(target.id)) continue // already home
        moves.push({ ch, to: target, toName: targetName })
      }
    }

    // Permission analysis, done against the live rules rather than assumed:
    //
    // This guild's @everyone ROLE does not carry VIEW_CHANNEL, and START HERE has no
    // overwrites at all — so #welcome and #rules are only visible to members whose
    // other roles grant view. A brand-new member with no roles yet cannot see the
    // very channels meant to greet them.
    //
    // LEAGUE's category overwrite grants @everyone VIEW + READ_MESSAGE_HISTORY. So
    // for these two channels, plain inheritance under LEAGUE is not a risk to
    // mitigate, it is the fix: after the move, the welcome mat is visible to
    // everyone, including the roleless newcomer it exists for. #general-chat and
    // #Race Channel carry their own overwrites and are unaffected by reparenting.
    for (const m of moves) {
      const own = (m.ch.permission_overwrites ?? []).length
      const fromCat = channels.find((c) => c.id === String(m.ch.parent_id ?? ''))
      plan.push({
        step: 'move',
        detail: `#${m.ch.name}: ${fromCat?.name ?? '(none)'} → ${m.toName} · ${own} own overwrite(s)${
          own === 0
            ? ` — will inherit ${m.toName}'s rules (@everyone view+history), fixing the gap where roleless newcomers could not see it`
            : ' — visibility unchanged'
        }`,
      })
      if (!dryRun) {
        // No lock_permissions: see the header. Its absence is the safety property.
        const res = await discord(`/channels/${m.ch.id}`, 'PATCH', botToken, { parent_id: m.to.id })
        if (res.ok) applied.push(`#${m.ch.name} → ${m.toName}`)
        else warnings.push(`Could not move #${m.ch.name} — ${res.message}`)
      }
    }

    // --- The protests discussion forum -----------------------------------------------
    // PROTESTS ARE FILED ON THE WEBSITE, never in Discord — that is the league's rule,
    // and every piece of copy this function writes must say so. The forum exists to
    // DISCUSS incidents and published decisions. (An earlier topic told drivers to
    // file here, contradicting the site being the only reviewed intake.)
    //
    // It lives in RACE CONTROL, whose category rule DENIES @everyone view — right for
    // #race-control and #Steward Radio, fatal for a discussion room. So the forum
    // carries its own @everyone overwrite: view, read, create posts, reply.
    const PROTESTS_TOPIC =
      'Protests are filed on the website — hcrleague.com/portal. A protest posted here does not get reviewed. This forum is for discussing incidents and published decisions.'
    const VIEW = 1n << 10n, SEND = 1n << 11n, HISTORY = 1n << 16n, REACT = 1n << 6n, THREADS = 1n << 38n
    const protestsAllow = String(VIEW | SEND | HISTORY | REACT | THREADS) // SEND on a forum = create posts

    const existingProtests = channels.find((c) => c.type !== CHAN_CATEGORY && (c.name ?? '') === PROTESTS)
    if (!existingProtests) {
      if (!raceControl) warnings.push(`Category ${RACE_CONTROL} not found — could not create #${PROTESTS}.`)
      else {
        plan.push({
          step: 'create',
          detail: `#${PROTESTS} (forum) in ${RACE_CONTROL}, open to drivers — discussion only; filing happens on the site`,
        })
        if (!dryRun) {
          const res = await discord(`/guilds/${guildId}/channels`, 'POST', botToken, {
            name: PROTESTS,
            type: CHAN_FORUM,
            parent_id: raceControl.id,
            topic: PROTESTS_TOPIC,
            permission_overwrites: [{ id: guildId, type: 0, allow: protestsAllow, deny: '0' }],
          })
          if (res.ok) applied.push(`created #${PROTESTS}`)
          else warnings.push(`Could not create #${PROTESTS} — ${res.message}`)
        }
      }
    } else {
      // Exists already: make sure drivers can actually use it (the category deny wins
      // for any channel with no rule of its own), and that its topic sends filers to
      // the website rather than inviting them to file here.
      const ow = (existingProtests.permission_overwrites ?? []).find((o) => String(o.id) === guildId)
      if (!ow || BigInt(ow.allow ?? '0') !== BigInt(protestsAllow)) {
        plan.push({ step: 'permissions', detail: `#${PROTESTS}: set @everyone allow so drivers can see and post` })
        if (!dryRun) {
          const res = await discord(`/channels/${existingProtests.id}/permissions/${guildId}`, 'PUT', botToken, {
            type: 0, allow: protestsAllow, deny: '0',
          })
          if (res.ok) applied.push(`#${PROTESTS}: drivers can see and post`)
          else warnings.push(`Could not open #${PROTESTS} to drivers — ${res.message}`)
        }
      }
      const currentTopic = String(existingProtests.topic ?? '')
      if (currentTopic !== PROTESTS_TOPIC) {
        plan.push({ step: 'topic', detail: `#${PROTESTS}: topic points filing at the website, not this forum` })
        if (!dryRun) {
          const res = await discord(`/channels/${existingProtests.id}`, 'PATCH', botToken, { topic: PROTESTS_TOPIC })
          if (res.ok) applied.push(`#${PROTESTS}: topic corrected — file on the website`)
          else warnings.push(`Could not update #${PROTESTS}'s topic — ${res.message}`)
        }
      }
    }

    // --- The bot's configured targets must live where members look ------------------
    // discord_config holds the channel ids the automations actually post into, and
    // those ids are the ground truth — not channel names. This run found the config's
    // #announcements floating at top level with no category (its category died in an
    // earlier restructure) while a same-named twin sat inside LEAGUE. Result: every
    // race report and news post landed in a channel outside the sidebar, and members
    // read an #announcements the bot never posts to.
    //
    // Rule: each configured target is moved into its proper category; a same-named
    // twin that is NOT the configured id is moved to ARCHIVE (never deleted — it may
    // hold history). Names are how humans find channels, ids are how bots do; when
    // the two disagree, the id wins and the name gets reunited with it.
    // ARCHIVE is where displaced history goes instead of being deleted. It no longer
    // exists on this server (an earlier restructure removed it), so it is recreated
    // on demand — hidden from members, bottom of the sidebar.
    let archive = catByName('ARCHIVE')
    const ensureArchive = async (): Promise<Channel | undefined> => {
      if (archive || dryRun) return archive
      const res = await discord(`/guilds/${guildId}/channels`, 'POST', botToken, {
        name: 'ARCHIVE',
        type: CHAN_CATEGORY,
        permission_overwrites: [{ id: guildId, type: 0, allow: '0', deny: String(1n << 10n) }],
      })
      if (res.ok) {
        archive = res.data as Channel
        applied.push('created the ARCHIVE category (hidden)')
      } else warnings.push(`Could not create ARCHIVE — ${res.message}`)
      return archive
    }
    // readonly: members read and react, only the bot writes. Necessary because the
    // guild-level @everyone carries SEND_MESSAGES, and LEAGUE grants view — without a
    // channel-level deny, moving a bare channel into LEAGUE would let anyone type in
    // #announcements.
    const RO_ALLOW = String((1n << 10n) | (1n << 16n) | (1n << 6n)) // view, history, react
    const RO_DENY = String((1n << 11n) | (1n << 35n) | (1n << 36n) | (1n << 38n)) // send, threads

    // --- #news: automated news posts get their own room --------------------------------
    // News stories used to land in #announcements alongside race reports and standings,
    // which buried the operational posts under editorial ones. #news is read-only like
    // the other bot channels, and its id lives in discord_config.channel_news — the
    // broadcast worker falls back to announcements until this has run once.
    if (league) {
      const newsId = String(cfg.channel_news ?? '').trim()
      let newsCh = newsId ? channels.find((c) => String(c.id) === newsId) : undefined
      // A configured id that no longer exists is stale, not authoritative.
      newsCh ??= channels.find((c) => c.type !== CHAN_CATEGORY && (c.name ?? '') === 'news')
      if (!newsCh) {
        plan.push({ step: 'create', detail: '#news (read-only) in LEAGUE — automated news posts move out of #announcements' })
        if (!dryRun) {
          const res = await discord(`/guilds/${guildId}/channels`, 'POST', botToken, {
            name: 'news',
            type: 0,
            parent_id: league.id,
            topic: 'League news, posted automatically from hcrleague.com/news.',
            permission_overwrites: [{ id: guildId, type: 0, allow: RO_ALLOW, deny: RO_DENY }],
          })
          if (res.ok && (res.data as Channel | null)?.id) {
            newsCh = res.data as Channel
            applied.push('created #news in LEAGUE (read-only)')
          } else warnings.push(`Could not create #news — ${res.message}`)
        }
      }
      if (newsCh && String(cfg.channel_news ?? '') !== String(newsCh.id)) {
        plan.push({ step: 'config', detail: `save #news id to discord_config.channel_news` })
        if (!dryRun) {
          const { error } = await db.from('discord_config')
            .update({ channel_news: String(newsCh.id), updated_at: new Date().toISOString() }).eq('id', 1)
          if (error) warnings.push(`#news exists but its id could not be saved — ${error.message}`)
          else applied.push('news posts now route to #news')
        }
      }
    }
    const TARGETS: { col: string; cat: Channel | undefined; catName: string; readonly?: boolean }[] = [
      { col: 'channel_announcements', cat: league, catName: LEAGUE, readonly: true },
      { col: 'channel_news', cat: league, catName: LEAGUE, readonly: true },
      { col: 'channel_standings', cat: league, catName: LEAGUE, readonly: true },
      { col: 'channel_results', cat: league, catName: LEAGUE },
      { col: 'channel_signups', cat: league, catName: LEAGUE },
      { col: 'channel_license_ups', cat: raceControl, catName: RACE_CONTROL },
      { col: 'channel_race_control', cat: raceControl, catName: RACE_CONTROL },
    ]
    for (const t of TARGETS) {
      const id = String(cfg[t.col] ?? '').trim()
      if (!id || !t.cat) continue
      const ch = channels.find((c) => String(c.id) === id)
      if (!ch) { warnings.push(`${t.col} points at ${id}, which is not in this server.`); continue }
      if (String(ch.parent_id ?? '') !== String(t.cat.id)) {
        const from = channels.find((c) => c.id === String(ch.parent_id ?? ''))?.name ?? '(no category)'
        plan.push({ step: 'move', detail: `#${ch.name} (${t.col}): ${from} → ${t.catName} — the bot posts here, members must see it` })
        if (!dryRun) {
          const res = await discord(`/channels/${ch.id}`, 'PATCH', botToken, { parent_id: t.cat.id })
          if (res.ok) applied.push(`#${ch.name} (${t.col}) → ${t.catName}`)
          else { warnings.push(`Could not move #${ch.name} (${t.col}) — ${res.message}`); continue }
        }
      }
      if (t.readonly) {
        const ow = (ch.permission_overwrites ?? []).find((o) => String(o.id) === guildId)
        if (!ow || BigInt(ow.deny ?? '0') !== BigInt(RO_DENY) || BigInt(ow.allow ?? '0') !== BigInt(RO_ALLOW)) {
          plan.push({ step: 'permissions', detail: `#${ch.name}: read-only for members — view and react, only the bot posts` })
          if (!dryRun) {
            const res = await discord(`/channels/${ch.id}/permissions/${guildId}`, 'PUT', botToken, {
              type: 0, allow: RO_ALLOW, deny: RO_DENY,
            })
            if (res.ok) applied.push(`#${ch.name}: read-only`)
            else warnings.push(`Could not make #${ch.name} read-only — ${res.message}`)
          }
        }
      }
      // A twin with the same name as a bot target, that isn't the real target, can
      // only mislead — wherever it sits. One was found floating at top level with no
      // category at all: same name as #announcements, zero posts from the bot. Only
      // a twin already in ARCHIVE is exempt — archived history may share a name.
      //
      // The exemption must be conditional on ARCHIVE existing: comparing against
      // `archive?.id ?? ''` when there is no ARCHIVE made the orphan's empty parent
      // compare equal to the missing category, silently exempting the exact channel
      // this sweep exists to catch.
      for (const twin of channels.filter(
        (c) => c.id !== id && c.type !== CHAN_CATEGORY && (c.name ?? '') === (ch.name ?? '') &&
               !(archive && String(c.parent_id ?? '') === String(archive.id)),
      )) {
        plan.push({ step: 'move', detail: `#${twin.name} (${twin.id}): duplicate of the ${t.col} target → ARCHIVE` })
        if (!dryRun) {
          const arc = await ensureArchive()
          if (!arc) continue // already warned
          const res = await discord(`/channels/${twin.id}`, 'PATCH', botToken, { parent_id: arc.id })
          if (res.ok) applied.push(`#${twin.name} duplicate → ARCHIVE`)
          else warnings.push(`Could not archive the duplicate #${twin.name} — ${res.message}`)
        }
      }
    }

    // --- Retire START HERE, but only once genuinely empty ---------------------------
    if (startHere) {
      // Recount against what the moves will leave behind rather than the pre-move list.
      const movedIds = new Set(moves.map((m) => m.ch.id))
      const remaining = channels.filter(
        (c) => c.type !== CHAN_CATEGORY && String(c.parent_id ?? '') === String(startHere.id) && !movedIds.has(c.id),
      )
      if (remaining.length > 0) {
        warnings.push(
          `${START_HERE} still holds ${remaining.map((c) => `#${c.name}`).join(', ')} — left in place. ` +
            `A category is only removed once empty, and channels are never deleted here.`,
        )
      } else {
        plan.push({ step: 'delete-category', detail: `${START_HERE} — empty after the moves, no message history involved` })
        if (!dryRun) {
          const res = await discord(`/channels/${startHere.id}`, 'DELETE', botToken)
          if (res.ok) applied.push(`removed the ${START_HERE} category`)
          else warnings.push(`Could not remove ${START_HERE} — ${res.message}`)
        }
      }
    }

    return json({
      ok: true,
      dryRun,
      guild_id: guildId,
      plan,
      applied: dryRun ? null : applied,
      warnings,
      // Who each category actually admits, so the move can be judged rather than
      // trusted. @everyone is the role whose id equals the guild id.
      categoryRules: [startHere, league, paddock, raceControl].filter(Boolean).map((c) => ({
        category: c!.name,
        rules: (c!.permission_overwrites ?? []).map((o) => ({
          role: String(o.id) === guildId ? '@everyone' : String(o.id),
          allow: o.allow ?? '0',
          deny: o.deny ?? '0',
        })),
      })),
      shape: {
        LEAGUE: 'what the league publishes',
        PADDOCK: 'where members talk',
        'RACE CONTROL': 'stewarding',
        ADMIN: 'staff',
      },
    })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
