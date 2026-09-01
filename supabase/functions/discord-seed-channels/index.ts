// discord-seed-channels — gives every channel a pinned post explaining what it is
// for and linking to whatever that channel actually needs.
//
// An empty channel reads as an abandoned one. A newcomer opening #rulebook and
// finding nothing has to go and ask, which is the thing the channel existed to
// prevent. This posts one starter message per channel and pins it.
//
// IT EDITS, IT DOES NOT REPOST. The message id goes in discord_channel_notes, so
// running this again after a wording change updates the same pinned post. Without
// that every re-run would leave a second copy behind, then a third — the same
// mistake the race reports made before they carried a target_id.
//
// LINKS COME FROM THE DATABASE, not from constants in here. league_settings holds
// the rulebook URL, the Twitch channel and the invite, so changing the rulebook link
// on the site and re-running this updates Discord. A constant would have gone stale
// the first time the rulebook moved, silently, in a pinned post nobody re-reads.
//
// Channels are matched on CATEGORY/name because two categories both contain
// #announcements and #general-chat, and they need different text.
//
// Skipped by design: voice channels, and the results forum (a forum has no message
// list to post into, and it already carries the race reports).
//
// Dry run unless the caller sends {"dryRun": false}.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs Send Messages, Embed Links and Manage Messages (to pin).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const SITE = 'https://hcrleague.com'
const HCR_YELLOW = 0xf2e114
const SNOWFLAKE = /^\d{5,25}$/
const CHAN_CATEGORY = 4
const CHAN_TEXT = 0
const CHAN_ANNOUNCEMENT = 5

interface Links { rulebook: string; twitch: string; invite: string }
interface Note { title: string; body: string; fields?: { name: string; value: string }[] }

/**
 * One entry per channel, keyed CATEGORY/name. Written to be read by somebody who has
 * just joined and does not yet know how the league works — every entry says what the
 * channel is for and, where it matters, what to do next.
 */
function notes(L: Links): Record<string, Note> {
  return {
    'LEAGUE/welcome': {
      title: 'Welcome to HCR League',
      body: 'Three classes, one grid. **GTP**, **LMP2** and **GTD** race together and score three separate championships — so you are racing the whole field for position and your own class for the title.',
      fields: [
        { name: 'Start here', value: `**1.** Read <#LEAGUE/rules>\n**2.** Enter a season at ${SITE}/signup\n**3.** Read the rulebook before your first race\n**4.** Say hello in <#PADDOCK/gravel-trap>` },
        { name: 'Where things live', value: `Standings · ${SITE}/standings\nSchedule · ${SITE}/schedule\nResults · ${SITE}/results\nDrivers · ${SITE}/drivers` },
        { name: 'Watch', value: L.twitch || 'Broadcast details to follow.' },
      ],
    },

    'LEAGUE/rules': {
      title: 'Server rules',
      body: 'Short list, seriously meant. Breaking these can cost you a race, a role, or your place in the server.',
      fields: [
        { name: 'Conduct', value:
          '**1.** Race respectfully — on track and in here.\n' +
          '**2.** Criticise the driving, never the driver.\n' +
          '**3.** No slurs, harassment or bigotry. This one is immediate removal, no warning.\n' +
          '**4.** No arguing an incident in chat. Protests are filed on the website.\n' +
          '**5.** Stewards’ decisions are final once published.' },
        { name: 'Housekeeping', value:
          '**6.** Keep channels roughly on topic.\n' +
          '**7.** Do not DM staff about league business — use the channels, so the next person can find the answer.\n' +
          '**8.** English in shared channels, so everyone can follow.\n' +
          '**9.** No advertising other leagues or services without asking first.\n' +
          '**10.** Discord’s own Terms of Service apply, including being 13 or older.' },
        { name: 'If something goes wrong', value: 'Report it to a member of staff. If it is about a member of staff, report it to the commissioner directly.' },
      ],
    },

    'LEAGUE/announcements': {
      title: 'League announcements',
      // The old note taught the RETIRED Interested mechanism (read by nothing) and
      // claimed penalties post here (they publish in race-control-announcements,
      // deliberately without a ping). Both claims sent members to the wrong place.
      body: 'Operational league business lands here: schedule changes, rule updates and league notices. Race attendance has its own room — answer the buttons in <#LEAGUE/race-attendance> each week. News stories post to <#LEAGUE/news>.',
      fields: [{ name: 'Also on the site', value: `Schedule · ${SITE}/schedule` }],
    },

    'LEAGUE/race-attendance': {
      title: 'Are you racing this weekend?',
      body: 'One post per round, two buttons. Tap **I\'m racing** or **Can\'t make it** — that button is the only signal race control counts, and you can change your answer any time by pressing the other one. The post opens on Monday and comes down when the race starts.',
      fields: [{ name: 'Why it matters', value: 'The grid is planned from these answers. Thirty seconds here saves race control chasing you all week.' }],
    },

    'LEAGUE/news': {
      title: 'League news',
      body: `Stories from the league, posted automatically the moment they publish on the site. The full archive lives at ${SITE}/news.`,
    },

    'LEAGUE/standings': {
      title: 'Championship standings',
      body: 'The table is posted here after every round, top five per class. Points are race + qualifying + any steward adjustment.',
      fields: [{ name: 'Full tables', value: `Championship · ${SITE}/standings\nFill-In Cup · ${SITE}/standings/fill-in` }],
    },

    'PADDOCK/general-chat': {
      title: 'League chat',
      body: 'Anything about the championship — setups, strategy, who owes who an apology from Sunday. Incidents get filed on the website, not argued here.',
    },

    'LEAGUE/season-signups': {
      title: 'Season sign-ups',
      body: `Entries open here and on the site at ${SITE}/signup.`,
      fields: [
        { name: 'What you need', value: 'Your iRacing name and customer ID, the class you want to run, the car you will run all season, and two car number choices.' },
        { name: 'Car numbers', value: '**First come, first served.** If somebody already has the number you want, you get your second choice — so enter early if the number matters to you.' },
        { name: 'Locked for the season', value: 'Class, car and number are fixed once the season starts unless staff give permission. Ask before you assume.' },
      ],
    },

    'LEAGUE/rulebook': {
      title: 'HCR League rulebook',
      body: L.rulebook
        ? `The full rulebook lives here: ${L.rulebook}\n\nIt is binding. Entering a race means you have read it.`
        : 'The rulebook has not been linked yet — ask staff for a copy.',
      fields: [
        { name: 'The short version', value:
          'Leave racing room. Rejoin safely and give the place back if you gained it off track.\n' +
          'Blue flags: let the faster class through cleanly, do not brake-test them.\n' +
          'Contact happens; deliberate contact does not.\n' +
          'Finish the race before you argue about it.' },
        { name: 'Something unclear?', value: 'Ask in this channel rather than guessing. If the rulebook is ambiguous, that is worth fixing for everybody.' },
      ],
    },

    'PADDOCK/gravel-trap': {
      title: 'Off topic',
      body: 'Anything that is not the league. Other series, other games, memes, life. Server rules still apply here.',
    },

    'PADDOCK/promotions': {
      title: 'Streams, videos and self-promotion',
      body: 'Post your own stream, onboard, highlight reel or channel here — and nowhere else in the server.',
      fields: [
        { name: 'Please do', value: 'Share your own content. Share a league member’s content. Post the broadcast.' },
        { name: 'Please do not', value: 'Advertise another league, sell anything, or post affiliate links without asking staff first.' },
      ],
    },





    'RACE CONTROL/race-control': {
      title: 'Race control',
      body: 'Working channel for stewards and race control during and after sessions. Calls are coordinated here before anything is published.',
      fields: [{ name: 'Dashboard', value: `${SITE}/control` }],
    },

    'RACE CONTROL/incident-protests': {
      title: 'Incident protests',
      body: `**Protests are filed on the website, not in Discord** — ${SITE}/portal. A protest posted in chat does not get reviewed. This forum is for discussing incidents and published decisions.`,
      fields: [
        { name: 'What a protest needs', value: '**Race and lap** · which round and roughly which lap\n**Cars involved** · numbers, not just names\n**What happened** · one or two sentences, no editorialising\n**Evidence** · a clip or a replay timestamp' },
        { name: 'Deadlines', value: 'Protests close **24 hours** after the race unless otherwise stated (rulebook §27.1). After that the result stands.' },
        { name: 'How it goes', value: 'Stewards review on the site, both drivers may be asked for their side, and the decision is published to #race-control-announcements with a reason.' },
      ],
    },

    'RACE CONTROL/race-control-announcements': {
      title: 'Race control announcements',
      body: 'Stewards’ decisions are published here as they are made: protest verdicts, penalties, and post-race rulings. Read-only — the decisions themselves come from race control on the site.',
      fields: [
        { name: 'Disagree with a decision?', value: `Decisions are final once published (rulebook §27). If you were involved and have new evidence, file on the website: ${SITE}/portal.` },
      ],
    },

    'RACE CONTROL/license-ups': {
      title: 'Licence promotions',
      body: 'Posted automatically when a driver earns a new licence tier: **Bronze → Silver → Gold → Platinum**.',
      fields: [{ name: 'How it is earned', value: 'Credits from every race — finishing position in class, pace against the class-fastest lap, qualifying, and safety. Clean and quick climbs fastest. It is earned from results, never requested.' }],
    },

    'ADMIN/admin-chat': {
      title: 'Admin',
      body: 'Staff-only working channel. Anything member-facing gets published elsewhere once it is decided.',
      fields: [{ name: 'Dashboards', value: `Commissioner · ${SITE}/admin\nRace control · ${SITE}/control` }],
    },

    'ADMIN/bot-log': {
      title: 'Automation log',
      body: 'Where the league bot reports what it has been doing. Quiet is good.',
      fields: [{ name: 'What runs by itself', value: 'Race reports, standings and news post themselves. Discord role edits reach the website within five minutes. Class roles and licence tiers follow race results.\n\nThe live status of every automation is in the admin dashboard under **Discord → Automations**.' }],
    },

    'ADMIN/safety-alerts': {
      title: 'Safety alerts',
      body: 'Discord posts moderation and raid warnings here. If this channel is busy, something is wrong.',
    },

    'ADMIN/community-updates': {
      title: 'Community updates',
      body: 'Discord’s own notices about Community features, moderation changes and server health.',
    },

    'ADMIN/iracing-names': {
      title: 'iRacing name reference',
      body: 'Where staff keep the mapping between Discord accounts and iRacing names and customer IDs, for verifying results and inviting people to league sessions.',
      fields: [{ name: 'Why it matters', value: 'Results arrive as free text with only a name on them. If a driver’s Discord nickname and iRacing name do not match, their results cannot be attributed automatically and somebody has to fix it by hand.' }],
    },
  }
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

async function discord<T>(
  path: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT', token: string, body?: unknown, attempt = 0,
): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(`${DISCORD}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (e) {
    return { ok: false, status: 0, message: `Could not reach Discord (${String((e as Error)?.message ?? e)})` }
  }
  if (res.status === 429 && attempt < 3) {
    const retry = Number(res.headers.get('retry-after') ?? '1')
    await new Promise((r) => setTimeout(r, (Number.isFinite(retry) ? retry : 1) * 1000 + 250))
    return discord<T>(path, method, token, body, attempt + 1)
  }
  const text = await res.text()
  let parsed: unknown = null
  if (text) { try { parsed = JSON.parse(text) } catch (_) { /* not JSON */ } }
  if (!res.ok) {
    const detail = (parsed as { message?: string } | null)?.message
    return { ok: false, status: res.status, message: `Discord API ${res.status}${detail ? `: ${detail}` : ''}` }
  }
  return { ok: true, data: (parsed ?? null) as T }
}

interface Channel { id: string; name?: string | null; type: number; parent_id?: string | null }

function isServiceRoleJwt(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    return (payload as { role?: unknown })?.role === 'service_role'
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
      const body = await req.json()
      if (body && typeof body === 'object' && (body as { dryRun?: unknown }).dryRun === false) dryRun = false
    } catch (_) { /* safe default */ }

    const authz = req.headers.get('Authorization') ?? ''
    const bearer = authz.replace(/^Bearer\s+/i, '').trim()
    const viaCron = bearer.length > 0 && (bearer === service || isServiceRoleJwt(bearer))
    if (!viaCron) {
      const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } })
      const { data: userData } = await userClient.auth.getUser()
      if (!userData?.user) return json({ error: 'Not authenticated' }, 401)
      const { data: prof } = await userClient
        .from('profiles').select('is_admin').eq('id', userData.user.id).maybeSingle()
      if (!prof?.is_admin) return json({ error: 'Admins only' }, 403)
    }

    const db = createClient(url, service)
    const { data: cfg } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    if (!cfg?.enabled) return json({ skipped: 'Discord integration is disabled in config.' })
    const guildId = String(cfg.guild_id ?? '').trim()
    if (!guildId) return json({ skipped: 'No Discord server is configured yet.' })
    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    // Read the links rather than hardcode them, so a rulebook that moves stays right.
    const { data: ls } = await db.from('league_settings')
      .select('rulebook_url, broadcast_url, discord_url').limit(1).maybeSingle()
    const links: Links = {
      rulebook: String(ls?.rulebook_url ?? '').trim(),
      twitch: String(ls?.broadcast_url ?? '').trim(),
      invite: String(ls?.discord_url ?? '').trim(),
    }
    const warnings: string[] = []
    if (!links.rulebook) warnings.push('league_settings.rulebook_url is empty, so #rulebook says the rulebook has not been linked yet. Set it on the site and re-run.')

    const chRes = await discord<Channel[]>(`/guilds/${guildId}/channels`, 'GET', botToken)
    if (!chRes.ok) return json({ error: `Could not read the server's channels — ${chRes.message}` }, 502)
    const channels = (chRes.data ?? []).filter((c) => c && SNOWFLAKE.test(String(c.id)))
    const catName = new Map(
      channels.filter((c) => c.type === CHAN_CATEGORY).map((c) => [String(c.id), String(c.name ?? '')]),
    )

    const { data: existingRows } = await db.from('discord_channel_notes').select('channel_id, message_id')
    const existing = new Map(((existingRows ?? []) as { channel_id: string; message_id: string }[])
      .map((r) => [String(r.channel_id), String(r.message_id)]))

    const CONTENT = notes(links)
    const posted: string[] = []
    const updated: string[] = []
    const planned: string[] = []
    const unmatched: string[] = []

    for (const ch of channels) {
      // Text-like channels only. A forum has no message list to post into, and a
      // voice channel's chat is not where anybody looks for orientation.
      if (ch.type !== CHAN_TEXT && ch.type !== CHAN_ANNOUNCEMENT) continue
      const parent = catName.get(String(ch.parent_id ?? '')) ?? ''
      const key = `${parent}/${ch.name ?? ''}`
      const note = CONTENT[key]
      if (!note) { unmatched.push(key); continue }

      // Channel mentions are written as <#CATEGORY/name> in the copy above and
      // resolved here, so the text can refer to a channel without hardcoding an id
      // that would break the moment a channel is recreated.
      const resolve = (s: string) => s.replace(/<#([^>]+)>/g, (whole, ref: string) => {
        const target = channels.find((c) => `${catName.get(String(c.parent_id ?? '')) ?? ''}/${c.name ?? ''}` === ref)
        return target ? `<#${target.id}>` : `#${String(ref).split('/').pop()}`
      })

      const embed = {
        title: note.title,
        description: resolve(note.body),
        color: HCR_YELLOW,
        ...(note.fields?.length
          ? { fields: note.fields.map((f) => ({ name: f.name, value: resolve(f.value), inline: false })) }
          : {}),
        footer: { text: 'HCR League' },
      }

      const known = existing.get(String(ch.id))
      planned.push(`${key} → ${known ? 'update' : 'post'}`)
      if (dryRun) continue

      if (known) {
        const patch = await discord(`/channels/${ch.id}/messages/${known}`, 'PATCH', botToken, { embeds: [embed] })
        if (patch.ok) { updated.push(key); continue }
        // The pinned post was deleted by hand. Fall through and make a new one
        // rather than failing — the row is about to be overwritten anyway.
        if (patch.status !== 404) { warnings.push(`Could not update the pinned post in #${ch.name} — ${patch.message}`); continue }
      }

      const post = await discord<{ id?: string }>(`/channels/${ch.id}/messages`, 'POST', botToken, { embeds: [embed] })
      if (!post.ok) { warnings.push(`Could not post in #${ch.name} — ${post.message}`); continue }
      const messageId = String(post.data?.id ?? '')
      if (!SNOWFLAKE.test(messageId)) { warnings.push(`Posted in #${ch.name} but Discord did not return a message id, so it cannot be updated later.`); continue }

      // Pinning is a nicety, not the point — a failure here should not lose the post.
      const pin = await discord(`/channels/${ch.id}/pins/${messageId}`, 'PUT', botToken)
      if (!pin.ok) warnings.push(`Posted in #${ch.name} but could not pin it — ${pin.message}`)

      await db.from('discord_channel_notes').upsert({
        channel_id: String(ch.id), channel_name: String(ch.name ?? ''),
        message_id: messageId, updated_at: new Date().toISOString(),
      })
      posted.push(key)
    }

    if (unmatched.length) {
      warnings.push(`No starter text is written for ${unmatched.length} channel(s): ${unmatched.join(', ')}. They were left empty.`)
    }

    return json({
      ok: warnings.length === 0,
      dryRun,
      planned,
      posted: dryRun ? null : posted,
      updated: dryRun ? null : updated,
      warnings,
    })
  } catch (e) {
    return json({ error: `Channel seeding failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
