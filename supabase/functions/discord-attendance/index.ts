// discord-attendance — asks the grid who is racing, chases the ones who have not
// answered, and tells race control what to expect.
//
// THREE THINGS, ONE DAILY RUN. A single cron ticks this once a day and the
// function works out which of them is due:
//
//   THE ASK        On the Wednesday before a race, one post in #announcements
//                  with @everyone and two buttons. Posted once, ever, per race.
//                  This is the ONLY mass ping this function makes.
//   THE NUDGE      Up to MAX_NUDGES afterwards, at most one a day, MENTIONING THE
//                  PEOPLE WHO HAVE NOT ANSWERED rather than @everyone. A chase is
//                  not an announcement: waking sixty-one people because six have
//                  not filled in a form is how a server learns to mute, and a
//                  muted server misses the results post too. Recycled, so the
//                  channel carries one live reminder rather than a pile.
//   THE RECAP      After the race, a private post in race control comparing what
//                  people pressed against the imported classification.
//
// WHO SEES WHAT. The public post is only ever the question — a bare ask and two
// buttons. Every name lives in the private attendance channel inside RACE
// CONTROL, because "who has not replied yet" is a planning tool for staff, not a
// leaderboard of who is ignoring the commissioner. The tally there is ONE message
// edited in place as answers arrive, so staff read a current picture instead of
// scrolling a log of changes.
//
// WHY THE EVENT ID IS IN THE BUTTON. custom_id carries `hcr_attend_yes:<uuid>`,
// so a click is self-describing. Without it the handler would have to infer which
// race a press belonged to, and the one time that inference is wrong — somebody
// scrolls up and clicks last week's post — it silently records an answer against
// the wrong race. The id makes a stale button either correct or obviously stale.
//
// TIMEZONE. "Wednesday" is a calendar word, so every date decision is made in the
// league's own timezone, never UTC. The races start at 00:00 UTC, which is 8pm the
// PREVIOUS EVENING in New York — so a UTC-based weekday would put race day on
// Sunday and the Wednesday ask three days late.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs Manage Channels (to create the attendance channel once) and Send
// Messages in #announcements and the attendance channel.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const SITE = 'https://hcrleague.com'
const HCR_YELLOW = 0xf2e114
const CLEARED_GREEN = 0x12805c
const PENALTY_RED = 0xc62430
const SNOWFLAKE = /^\d{5,25}$/

/** Every date decision is made here, not in UTC. See the header. */
const LEAGUE_TZ = 'America/New_York'
const ATTENDANCE_CHANNEL = 'attendance'
const RACE_CONTROL_CATEGORY = 'RACE CONTROL'

/** Shared with discord-interactions. If this changes, change it there too. */
const ATTEND_YES = 'hcr_attend_yes'
const ATTEND_NO = 'hcr_attend_no'

const MAX_FIELD = 1024
const clip = (s: string, n = MAX_FIELD) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * How many nudges one race may send, ever.
 *
 * A hard ceiling, deliberately separate from the "has everybody answered" check.
 * That check alone was not a stop condition at all: it counted the whole GRID, and
 * nine of the thirty-nine drivers have no Discord account and physically cannot
 * press a button — so it could never reach zero, and the reminder would have fired
 * every day of every race week for ever. Two belts now: only chase people who CAN
 * answer, and stop after this many regardless.
 *
 * Two is the number because a third ask does not produce answers, it produces
 * mutes — and a muted server misses the results post as well.
 */
const MAX_NUDGES = 2

interface TallyRow {
  driver_id: string
  driver_name: string
  class_id: string
  car_number: string | null
  car: string | null
  discord_user_id: string | null
  answer: boolean | null
  /** True for an answer from somebody holding no entry in this event's season. */
  off_grid: boolean
}
interface ReviewRow {
  driver_name: string
  class_id: string
  car_number: string | null
  car: string | null
  planned: boolean
  raced: boolean
  status: 'as_planned' | 'no_show' | 'unannounced' | 'absent' | 'off_grid'
  /** Straight from the imported classification — the race control sheet. */
  finish_pos: number | null
  cls_pos: number | null
  laps: number | null
  race_status: string | null
}
interface Channel { id: string; name?: string | null; type: number; parent_id?: string | null }

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

/** Calendar date and weekday as the league experiences them, not as UTC does. */
function leagueDay(d: Date): { ymd: string; weekday: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: LEAGUE_TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  ) as Record<string, string>
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday }
}

/**
 * The Wednesday immediately before a race, as a league-local date.
 *
 * Walks back a day at a time rather than assuming races are on Saturdays. They
 * are today, but a midweek round would otherwise silently get its ask on the
 * wrong day — and "subtract three days" is the kind of shortcut that looks right
 * until the schedule changes.
 */
function wednesdayBefore(race: Date): string {
  for (let back = 1; back <= 7; back++) {
    const d = new Date(race.getTime() - back * 86400000)
    const day = leagueDay(d)
    if (day.weekday === 'Wed') return day.ymd
  }
  return leagueDay(new Date(race.getTime() - 3 * 86400000)).ymd // unreachable in practice
}

function isServiceRoleJwt(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const b = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    return (JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))) as { role?: unknown })?.role === 'service_role'
  } catch { return false }
}

/**
 * One line per driver, for an embed field.
 *
 * Leads with class and number because that is how race control reads a grid —
 * "how many in GTD, and what are they in" — and ends with the car, which is the
 * half that tells you the shape of the field. A driver whose entry has no car
 * recorded says so rather than trailing an empty dash, so the gap is visible and
 * fixable rather than looking like a rendering bug.
 */
function nameList(
  rows: { driver_name: string; class_id: string; car_number: string | null; car: string | null }[],
): string {
  if (!rows.length) return '—'
  return clip(rows.map((r) =>
    `\`${r.class_id}${r.car_number ? ` #${r.car_number}` : ''}\` **${r.driver_name}** — ${r.car?.trim() || '_no car set_'}`
  ).join('\n'))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

    let dryRun = false
    let reviewEventId = ''
    // {"force": true} opens the ask before its Wednesday. For starting a drive
    // mid-week on a race that is already close, which is exactly the situation the
    // very first one is in. It does NOT bypass the once-ever check — the row in
    // race_attendance_posts still stops a second ask being posted.
    let force = false
    try {
      const b = await req.json()
      if (b && typeof b === 'object') {
        const o = b as Record<string, unknown>
        if (o.dryRun === true) dryRun = true
        if (o.force === true) force = true
        if (typeof o.review === 'string') reviewEventId = o.review
      }
    } catch { /* no body — normal daily run */ }

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

    const askChannel = String(cfg.channel_announcements ?? '').trim()
    if (!SNOWFLAKE.test(askChannel)) {
      return json({ error: 'No #announcements channel is configured, so there is nowhere to ask.' }, 400)
    }

    const warnings: string[] = []
    const notes: string[] = []
    const applied: string[] = []

    // --- the private attendance channel, created once ---------------------------
    // Lives in RACE CONTROL and INHERITS that category's permissions rather than
    // carrying its own. Passing permission_overwrites at creation opts a channel
    // out of category sync entirely, which is how #member-departures once ended up
    // invisible to two staff roles that RACE CONTROL grants.
    let controlChannel = String(cfg.channel_attendance ?? '').trim()
    if (!SNOWFLAKE.test(controlChannel)) {
      const chans = await discord(`/guilds/${guildId}/channels`, 'GET', botToken)
      const channels = (chans.ok ? (chans.data as Channel[]) : []) ?? []
      const existing = channels.find((c) => c.type === 0 && (c.name ?? '') === ATTENDANCE_CHANNEL)
      if (existing) {
        controlChannel = String(existing.id)
      } else if (!dryRun) {
        const cat = channels.find((c) => c.type === 4 && (c.name ?? '').toUpperCase() === RACE_CONTROL_CATEGORY)
        if (!cat) {
          warnings.push(`No ${RACE_CONTROL_CATEGORY} category exists, so the private attendance channel was not created.`)
        } else {
          const made = await discord(`/guilds/${guildId}/channels`, 'POST', botToken, {
            name: ATTENDANCE_CHANNEL,
            type: 0,
            parent_id: cat.id,
            topic: 'Who has said they are racing, and who actually turned up. Staff only — the members only ever see the question.',
          })
          if (made.ok) {
            controlChannel = String((made.data as Channel).id)
            applied.push(`created #${ATTENDANCE_CHANNEL} in ${RACE_CONTROL_CATEGORY}`)
          } else warnings.push(`Could not create #${ATTENDANCE_CHANNEL} — ${made.message}`)
        }
      }
      if (SNOWFLAKE.test(controlChannel) && !dryRun) {
        await db.from('discord_config')
          .update({ channel_attendance: controlChannel, updated_at: new Date().toISOString() }).eq('id', 1)
      }
    }

    // --- the post-race review ---------------------------------------------------
    // Runs before the ask, so the day a race is reviewed and the next one opens is
    // handled in a single tick rather than needing two.
    const doReview = async (eventId: string, label: string) => {
      const { data: rows, error } = await db.rpc('race_attendance_review', { p_event: eventId })
      if (error) { warnings.push(`Could not build the review for ${label} — ${error.message}`); return false }
      const all = (rows ?? []) as ReviewRow[]
      if (!all.length) { warnings.push(`No grid found for ${label}, so no review was posted.`); return false }

      const by = (s: string) => all.filter((r) => r.status === s)
      const asPlanned = by('as_planned'), noShow = by('no_show')
      const unannounced = by('unannounced'), absent = by('absent'), offGrid = by('off_grid')
      const raced = asPlanned.length + unannounced.length + offGrid.length
      const answered = asPlanned.length + noShow.length

      // A line for somebody the classification has something to say about: where
      // they finished and how far they got. "Raced" on its own hides the
      // difference between a full distance and nine laps before a disconnection,
      // and that difference is most of what race control is looking for.
      const ranLine = (rows: ReviewRow[]) => rows.length === 0 ? '—' : clip(rows.map((r) => {
        const bits = [
          r.cls_pos != null ? `P${r.cls_pos} in class` : null,
          r.laps != null ? `${r.laps} laps` : null,
          r.race_status && !/^running$/i.test(r.race_status) ? r.race_status : null,
        ].filter(Boolean)
        return `\`${r.class_id}${r.car_number ? ` #${r.car_number}` : ''}\` **${r.driver_name}** — ${r.car?.trim() || '_no car set_'}${bits.length ? ` · ${bits.join(' · ')}` : ''}`
      }).join('\n'))

      const fields: Record<string, unknown>[] = [
        { name: `Raced (${raced})`, value: ranLine([...asPlanned, ...unannounced, ...offGrid]), inline: false },
      ]
      if (noShow.length) {
        fields.push({ name: `Said they were racing, did not (${noShow.length})`, value: nameList(noShow), inline: false })
      }
      if (unannounced.length) {
        fields.push({ name: `Raced without saying (${unannounced.length})`, value: ranLine(unannounced), inline: false })
      }
      // Anybody in the classification with no entry on the grid. Worth its own
      // heading rather than being folded in: it means somebody raced who race
      // control was not expecting at all.
      if (offGrid.length) {
        fields.push({ name: `⚠️ In the results, not on the grid (${offGrid.length})`, value: ranLine(offGrid), inline: false })
      }
      fields.push({ name: `Neither answered nor raced (${absent.length})`, value: nameList(absent), inline: false })

      const accuracy = answered === 0
        ? 'Nobody was asked before this race, so there is nothing to compare against — this is just who turned up, taken from the imported classification.'
        : `${asPlanned.length} of ${answered} who said they were racing actually did. Finishing positions and laps are from the race control sheet.`

      const res = await discord(`/channels/${controlChannel}/messages`, 'POST', botToken, {
        embeds: [{
          title: `Attendance review — ${label}`,
          description: accuracy,
          color: noShow.length ? PENALTY_RED : CLEARED_GREEN,
          fields,
          footer: { text: 'HCR League · staff only · grid taken from the season entry list' },
        }],
      })
      if (!res.ok) { warnings.push(`Could not post the review for ${label} — ${res.message}`); return false }
      applied.push(`posted the attendance review for ${label}`)
      return true
    }

    // Explicit review of one race, for catching up on a round that predates this.
    if (reviewEventId) {
      const { data: ev } = await db.from('events').select('id, round, name').eq('id', reviewEventId).maybeSingle()
      if (!ev) return json({ error: 'That event does not exist.' }, 404)
      const label = `Round ${ev.round} — ${ev.name}`
      if (!SNOWFLAKE.test(controlChannel)) return json({ error: 'No attendance channel to post the review in.' }, 400)
      if (dryRun) return json({ ok: true, dryRun, wouldReview: label, applied, warnings })
      const ok = await doReview(String(ev.id), label)
      if (ok) await db.from('race_attendance_posts')
        .upsert({ event_id: String(ev.id), review_posted_at: new Date().toISOString() }, { onConflict: 'event_id' })
      return json({ ok, reviewed: label, applied, warnings })
    }

    // Automatic review: a race we ran a drive for, now complete, not yet reviewed.
    {
      const { data: due } = await db
        .from('race_attendance_posts')
        .select('event_id, review_posted_at, events!inner(round, name, status)')
        .is('review_posted_at', null)
        .eq('events.status', 'complete')
        .limit(1)
      const row = (due ?? [])[0] as { event_id: string; events?: { round?: number; name?: string } } | undefined
      if (row && SNOWFLAKE.test(controlChannel)) {
        const label = `Round ${row.events?.round} — ${row.events?.name}`
        if (dryRun) notes.push(`would post the attendance review for ${label}`)
        else if (await doReview(row.event_id, label)) {
          await db.from('race_attendance_posts')
            .update({ review_posted_at: new Date().toISOString() }).eq('event_id', row.event_id)
        }
      }
    }

    // --- the next race ----------------------------------------------------------
    const { data: next } = await db
      .from('events')
      .select('id, round, name, date, track_id, season_id')
      .eq('status', 'next')
      .limit(1)
      .maybeSingle()
    if (!next?.id) {
      notes.push('No race is marked next, so there is nothing to ask about.')
      return json({ ok: true, dryRun, applied, notes, warnings })
    }

    const raceAt = new Date(String(next.date))
    const today = leagueDay(new Date())
    const opensOn = wednesdayBefore(raceAt)
    const label = `Round ${next.round} — ${next.name}`

    // Read the drive's state BEFORE the calendar gate, because the gate answers
    // "is it time to OPEN a drive" and must not be allowed to answer "should I
    // service one that is already open". Getting that backwards meant a drive
    // started early (with force) went unserviced until its nominal Wednesday — no
    // tally refresh, no nudge — which is exactly the window where somebody has
    // just been asked and is most likely to answer.
    const { data: post } = await db.from('race_attendance_posts')
      .select('*').eq('event_id', String(next.id)).maybeSingle()

    if (!post && today.ymd < opensOn && !force) {
      notes.push(`${label} opens for attendance on ${opensOn} (${today.ymd} today).`)
      return json({ ok: true, dryRun, next: label, opensOn, applied, notes, warnings })
    }
    if (new Date() >= raceAt) {
      notes.push(`${label} has already started, so the ask window is closed.`)
      return json({ ok: true, dryRun, next: label, applied, notes, warnings })
    }

    const { data: trackRow } = next.track_id
      ? await db.from('tracks').select('name, config').eq('id', next.track_id).maybeSingle()
      : { data: null }
    const where = [trackRow?.name, trackRow?.config].filter(Boolean).join(' · ')
    // Discord renders <t:unix:F> in every reader's own timezone, which beats
    // writing a time that is wrong for half the grid.
    const when = `<t:${Math.floor(raceAt.getTime() / 1000)}:F> (<t:${Math.floor(raceAt.getTime() / 1000)}:R>)`

    // --- the tally, rebuilt from live data every run ----------------------------
    const { data: tallyRows } = await db.rpc('race_attendance_tally', { p_event: String(next.id) })
    const all = (tallyRows ?? []) as TallyRow[]

    // Split the grid from the strays BEFORE counting anything. An off-grid answer
    // has no class, no car and no number, so folding it into "Racing" would both
    // inflate the count and print a row reading `null` where a class code belongs.
    const tally = all.filter((r) => !r.off_grid)
    const offGrid = all.filter((r) => r.off_grid)

    const yes = tally.filter((r) => r.answer === true)
    const no = tally.filter((r) => r.answer === false)
    const silent = tally.filter((r) => r.answer === null)

    // THE DISTINCTION THAT MAKES THE NUDGE STOPPABLE. A driver with no Discord
    // account has not ignored anybody — they have no button. Chasing them is not
    // just futile, it is what made the reminder unstoppable: the old stop condition
    // counted the whole grid, so it could never reach zero.
    const chaseable = silent.filter((r) => !!r.discord_user_id)
    const unreachable = silent.filter((r) => !r.discord_user_id)

    const controlFields: Record<string, unknown>[] = [
      { name: `Racing (${yes.length})`, value: nameList(yes), inline: false },
      { name: `Cannot make it (${no.length})`, value: nameList(no), inline: false },
      { name: `No answer (${chaseable.length})`, value: nameList(chaseable), inline: false },
    ]
    if (unreachable.length) {
      controlFields.push({
        name: `⚠️ Cannot answer — no Discord account linked (${unreachable.length})`,
        value: nameList(unreachable), inline: false,
      })
    }
    // People who pressed a button but hold no entry this season. They used to be
    // told "you are down as racing" and then appear nowhere — which is how a roster
    // gap stays invisible right up until the grid is short on race day. Named AND
    // mentioned: the name is who they are, the mention is how you reach them.
    if (offGrid.length) {
      controlFields.push({
        name: `⚠️ Answered but not on the grid (${offGrid.length})`,
        value: clip(offGrid.map((o) =>
          `**${o.driver_name}**${o.discord_user_id ? ` (<@${o.discord_user_id}>)` : ''} — said ` +
          `${o.answer ? '**racing**' : 'they cannot make it'}`).join('\n')),
        inline: false,
      })
    }

    const controlEmbed = {
      title: `Attendance — ${label}`,
      description: `${where}\n${when}`,
      color: HCR_YELLOW,
      fields: controlFields,
      footer: { text: `HCR League · staff only · ${tally.length} on the grid · updates as people answer` },
    }

    // --- post the ask, or nudge -------------------------------------------------
    if (!post) {
      if (dryRun) {
        return json({
          ok: true, dryRun, next: label, wouldPost: 'the attendance ask + @everyone',
          opensOn, grid: tally.length, applied, notes, warnings,
        })
      }
      const ask = await discord(`/channels/${askChannel}/messages`, 'POST', botToken, {
        content: '@everyone',
        allowed_mentions: { parse: ['everyone'] },
        embeds: [{
          title: `Are you racing? — ${label}`,
          description: `${where}\n${when}\n\nTap a button so race control knows what the grid looks like. You can change your mind any time — press the other one.`,
          color: HCR_YELLOW,
          footer: { text: `HCR League · ${SITE}/schedule` },
        }],
        components: [{
          type: 1,
          components: [
            { type: 2, style: 3, label: "I'm racing", custom_id: `${ATTEND_YES}:${next.id}`, emoji: { name: '🏁' } },
            { type: 2, style: 2, label: "Can't make it", custom_id: `${ATTEND_NO}:${next.id}` },
          ],
        }],
      })
      if (!ask.ok) return json({ error: `Could not post the attendance ask — ${ask.message}`, applied, warnings }, 502)
      const askId = String((ask.data as { id?: string } | null)?.id ?? '')

      let controlId = ''
      if (SNOWFLAKE.test(controlChannel)) {
        const c = await discord(`/channels/${controlChannel}/messages`, 'POST', botToken, { embeds: [controlEmbed] })
        if (c.ok) controlId = String((c.data as { id?: string } | null)?.id ?? '')
        else warnings.push(`Posted the ask but could not open the race-control tally — ${c.message}`)
      }

      await db.from('race_attendance_posts').upsert({
        event_id: String(next.id),
        channel_id: askChannel, message_id: askId,
        last_reminded_on: today.ymd, reminders_sent: 0,
        control_channel_id: controlChannel || null, control_message_id: controlId || null,
      }, { onConflict: 'event_id' })

      applied.push(`asked the server about ${label}`)
      return json({ ok: warnings.length === 0, next: label, posted: true, grid: tally.length, applied, notes, warnings })
    }

    // Already asked. Refresh the staff tally in place, every run.
    if (!dryRun && post.control_message_id && SNOWFLAKE.test(String(post.control_channel_id ?? ''))) {
      const up = await discord(
        `/channels/${post.control_channel_id}/messages/${post.control_message_id}`, 'PATCH', botToken,
        { embeds: [controlEmbed] })
      if (!up.ok) warnings.push(`Could not refresh the race-control tally — ${up.message}`)
    }

    const sentSoFar = Number(post.reminders_sent ?? 0)
    const stats = { yes: yes.length, no: no.length, silent: chaseable.length, unreachable: unreachable.length }

    // Three ways to stay quiet, and the order matters for the reported reason.
    if (post.last_reminded_on === today.ymd) {
      notes.push(`Already nudged today about ${label}.`)
      return json({ ok: true, dryRun, next: label, ...stats, applied, notes, warnings })
    }
    if (sentSoFar >= MAX_NUDGES) {
      notes.push(
        `${label} has had its ${MAX_NUDGES} nudges. ${chaseable.length} still silent — chase them by hand ` +
        `if it matters; a third mass ping buys mutes, not answers.`)
      return json({ ok: true, dryRun, next: label, ...stats, nudges_used: sentSoFar, applied, notes, warnings })
    }
    if (chaseable.length === 0) {
      notes.push(unreachable.length
        ? `Everybody who CAN answer has, for ${label}. ${unreachable.length} more have no Discord account linked and were not chased.`
        : `Everybody on the grid has answered for ${label}.`)
      return json({ ok: true, dryRun, next: label, ...stats, applied, notes, warnings })
    }
    if (dryRun) {
      return json({ ok: true, dryRun, next: label, wouldRemind: `${chaseable.length} chaseable`, ...stats, applied, notes, warnings })
    }

    const jump = post.message_id
      ? `https://discord.com/channels/${guildId}/${post.channel_id}/${post.message_id}`
      : ''
    // MENTIONS THE PEOPLE WHO HAVE NOT ANSWERED, NOT @everyone.
    //
    // A nudge is a chase, not an announcement. @everyone here woke all sixty-one
    // members — including the twenty-two who are not on the grid at all — to tell
    // them somebody else had not filled in a form. The people who need it get a
    // real notification; everybody else gets nothing. allowed_mentions lists the
    // ids explicitly, so this cannot widen into a mass ping by accident even if
    // the copy above it ever changes.
    const chase = chaseable.map((r) => String(r.discord_user_id))
    const rem = await discord(`/channels/${askChannel}/messages`, 'POST', botToken, {
      content: [
        `**${label}** — ${when}`,
        `Still need an answer from ${chase.length}: ${chase.map((id) => `<@${id}>`).join(' ')}`,
        jump ? `One tap here: ${jump}` : 'Answer on the attendance post above.',
      ].join('\n'),
      allowed_mentions: { users: chase },
    })
    if (!rem.ok) return json({ error: `Could not post the reminder — ${rem.message}`, applied, warnings }, 502)
    const remId = String((rem.data as { id?: string } | null)?.id ?? '')

    // Recycle: yesterday's nudge comes down now that today's is up, so the channel
    // carries one live reminder instead of four by race day. Deleted AFTER the new
    // one posts — the reverse order would turn a transient Discord error into a day
    // with no reminder at all. The ORIGINAL ask is never touched; it owns the
    // buttons, and deleting it would take the whole drive down with it.
    const previousNudge = String(post.reminder_message_id ?? '').trim()
    if (previousNudge && previousNudge !== remId) {
      const del = await discord(`/channels/${askChannel}/messages/${previousNudge}`, 'DELETE', botToken)
      // A 404 means somebody already removed it by hand, which is the outcome we
      // wanted anyway: no stale reminder left behind.
      if (!del.ok && del.status !== 404) {
        warnings.push(`Posted today's reminder but could not remove yesterday's — ${del.message}`)
      }
    }

    await db.from('race_attendance_posts').update({
      last_reminded_on: today.ymd,
      reminders_sent: Number(post.reminders_sent ?? 0) + 1,
      reminder_message_id: remId || null,
    }).eq('event_id', String(next.id))

    // Reports the same numbers as every other exit above — `stats`, which counts
    // only the people who can actually be chased. Reporting raw `silent` here
    // instead was how the unstoppable-nudge bug read as normal in the logs.
    applied.push(`reminded the server about ${label} (${chaseable.length} still silent)`)
    return json({ ok: warnings.length === 0, next: label, reminded: true, ...stats, applied, notes, warnings })
  } catch (e) {
    return json({ error: `Attendance run failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
