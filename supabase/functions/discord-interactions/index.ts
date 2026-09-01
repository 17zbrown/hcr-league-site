// discord-interactions — the single endpoint Discord POSTs every interaction to.
//
// THREE THINGS ARRIVE HERE, and they are told apart by interaction.type:
//
//   THE GATE BUTTON      One button, in #welcome. Pressing it grants
//                        discord_config.gate_role_id, the role every other channel
//                        is gated behind.
//   ATTENDANCE BUTTONS   "I'm racing" / "Can't make it", posted by
//                        discord-attendance, carrying the event id in custom_id.
//   SLASH COMMANDS       /next and /standings. The NAMES are registered separately
//                        by discord-commands; the handlers are here. Those two
//                        deployments are one unit — a name registered there with no
//                        handler here is a command that appears, is pressable, and
//                        shrugs.
//
// EVERY REPLY IS EPHEMERAL. Nothing this endpoint says is visible to anybody but
// the person who acted, which is what keeps a channel from filling with other
// people's confirmations and lookups.
//
// THE THREE-SECOND RULE governs everything below. Discord abandons an interaction
// that goes unanswered for three seconds and shows the member a red "This
// interaction failed" — which, on the attendance path, would be an outright lie,
// because the answer is already committed by then. Every handler here keeps its
// database work to a few small indexed reads, runs independent reads with
// Promise.all rather than in sequence, and bounds anything that talks to Discord.
//
// EXISTING MEMBERS NEVER SEE THIS. They are granted the gate role in bulk, so nobody
// who already races has to prove anything. The gate is for arrivals only, and it is
// deliberately NOT tied to the rulebook — it is a "you are a person, not a spambot"
// door, not an agreement to anything. Do not turn it into a rules acknowledgement
// without asking the league owner; that was decided against on purpose.
//
// ── DEPLOY WITH verify_jwt DISABLED ────────────────────────────────────────────────
//
//     supabase functions deploy discord-interactions --no-verify-jwt
//
// This is the one function here that must have the platform gate off, and that is
// correct rather than a shortcut. Discord posts interactions from its own
// infrastructure with a fixed set of headers; there is no field in which it could
// carry a Supabase credential even if we wanted it to, and no configuration screen on
// Discord's side that would let us add one. With verify_jwt on, Supabase's gateway
// returns 401 before this code runs, the endpoint can never be saved in the Discord
// developer portal, and the button does nothing for ever.
//
// Contrast discord-gateway-hook DELIBERATELY, because the two look similar and the
// next person to read them will be tempted to "fix" this one to match. That function
// keeps verify_jwt ON: its caller is our own VM, which can hold the publishable key,
// so the platform gate costs nothing and buys a second lock. Here the caller is
// Discord, which cannot. What replaces the bearer token is not weaker than it —
// an Ed25519 signature over the exact bytes of this request is strictly stronger. A
// shared bearer token proves only that the caller once saw a string; a valid
// signature proves the body was produced by the holder of the application's private
// key AND that not one byte of it has been altered in transit. Replaying a stolen
// bearer token against a different payload works. Doing the same here does not.
//
// So: signature verification IS the security model. It happens before the body is
// parsed, before the database is opened, before anything. If it ever gets moved,
// weakened, or run against a re-serialised object instead of the raw text, this
// endpoint becomes a public "give me a role" button for anyone who knows the URL.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
//
// The application's PUBLIC key lives in discord_config.application_public_key rather
// than an Edge Function secret. It is genuinely public — Discord prints it on the
// app's General Information page, and it can only ever verify a signature, never
// produce one. Keeping it in config means the endpoint is configurable from SQL
// instead of the dashboard. The bot TOKEN, which can act as the bot, stays a secret.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
// Discord is a server and never sends a preflight, so this block is only here so the
// endpoint can be poked from a browser while testing. It grants nothing: a request
// without a valid signature is refused whatever origin it claims.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature-ed25519, x-signature-timestamp',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Interaction types we answer. https://discord.com/developers/docs/interactions
const PING = 1
const APPLICATION_COMMAND = 2
const MESSAGE_COMPONENT = 3
// Response types we send.
const PONG = 1
const CHANNEL_MESSAGE_WITH_SOURCE = 4
/** Message flag 1<<6: only the person who clicked can see it, and it cannot be replied to. */
const EPHEMERAL = 1 << 6

/**
 * The custom_id carried by the gate button.
 *
 * WHATEVER POSTS THE BUTTON MUST USE THIS EXACT STRING. Discord echoes custom_id back
 * verbatim and it is the only thing identifying which button was pressed — a typo at
 * the posting end produces a button that looks perfect, is clickable, and silently
 * does nothing.
 *
 * NOTHING POSTS THIS BUTTON YET. The poster lands with the rest of the gate work —
 * discord-membership's welcome guide gains the button when the gate is armed — and
 * when it does, it must write this literal out rather than import it, because
 * importing this module would run its Deno.serve. If a third thing ever needs it,
 * move it to ../_shared/ (as license.ts already does) instead of copying it again.
 *
 * Changing the value orphans every button already sitting in #welcome — they keep
 * sending the old id — so a change here means reposting that message too.
 */
const GATE_CUSTOM_ID = 'hcr_gate_enter'

/**
 * The attendance buttons, posted by discord-attendance.
 *
 * These carry a payload: `hcr_attend_yes:<event uuid>`. The race is named in the
 * button itself so a press is self-describing — the alternative is inferring which
 * race a click belongs to from "whatever is next", and the one time that inference
 * is wrong (somebody scrolls up and presses last week's post) it records an answer
 * against the wrong race and nobody ever notices. With the id present a stale
 * button is either still correct or provably stale.
 */
const ATTEND_YES = 'hcr_attend_yes'
const ATTEND_NO = 'hcr_attend_no'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const HEX = /^[0-9a-fA-F]+$/

/** Hex string → bytes, or null if it is not clean, even-length hex. */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !HEX.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * The imported public key, kept for the life of the isolate.
 *
 * Only successes are cached. A failed import is retried on the next request, because
 * the usual cause is a secret that had not propagated yet and caching the failure
 * would leave a warm isolate refusing every click until it happened to be recycled.
 */
let verifier: { key: CryptoKey; algorithm: AlgorithmIdentifier } | null = null

async function loadVerifier(keyHex: string): Promise<typeof verifier> {
  if (verifier) return verifier

  const raw = hexToBytes(keyHex.trim())
  // 32 bytes is the whole of an Ed25519 public key. Anything else is the wrong value
  // pasted in — most often the application ID or the bot token — and it is worth
  // saying so in the log, since the symptom is otherwise an endpoint that Discord
  // simply refuses to save with no explanation.
  if (!raw || raw.length !== 32) {
    console.error(
      'discord-interactions: discord_config.application_public_key is missing or is not ' +
      '64 hex characters. Copy the Public Key from the Discord developer portal (General ' +
      'Information) — not the application ID, not the bot token. Every interaction is ' +
      'refused until it is set.')
    return null
  }

  // Deno has shipped this algorithm under two names. Newer runtimes take the standard
  // 'Ed25519'; older ones only recognise the pre-standard 'NODE-ED25519'. Trying both
  // is cheaper than pinning a runtime version, and the name that worked is kept so
  // verify() is called with the same one it was imported under — mismatching them
  // throws at verify time, which would read as every signature being invalid.
  const candidates: AlgorithmIdentifier[] = ['Ed25519', { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' } as unknown as AlgorithmIdentifier]
  for (const algorithm of candidates) {
    try {
      const key = await crypto.subtle.importKey('raw', raw, algorithm, false, ['verify'])
      verifier = { key, algorithm }
      return verifier
    } catch { /* try the other spelling */ }
  }

  console.error('discord-interactions: this runtime accepts neither Ed25519 nor NODE-ED25519 for importKey.')
  return null
}

/**
 * Is this request really from Discord?
 *
 * Verified over `timestamp + rawBody` — the RAW request text, exactly as it arrived.
 * Never JSON.parse it and re-stringify to build this input. Key order, whitespace and
 * number formatting all survive the round trip only by luck, and the moment one of
 * them does not, this check fails closed and nobody notices because the fix looks
 * like "the library must be broken". Worse, the reverse mistake — verifying a
 * re-serialised body — would mean the bytes we act on are not the bytes that were
 * signed, which is the classic way this gets silently defeated.
 *
 * NO REPLAY WINDOW, on purpose. The timestamp is inside the signed payload so it
 * cannot be tampered with, but nothing here rejects an old one: the only action this
 * endpoint takes is idempotent (granting a role somebody already has changes
 * nothing), Discord's interaction token expires on its own after fifteen minutes, and
 * a freshness check would start turning legitimate clicks into failures the first
 * time a clock drifted.
 */
async function signatureIsValid(keyHex: string, signatureHex: string, timestamp: string, rawBody: string): Promise<boolean> {
  if (!timestamp) return false
  const signature = hexToBytes(signatureHex)
  if (!signature || signature.length !== 64) return false

  const v = await loadVerifier(keyHex)
  if (!v) return false

  try {
    return await crypto.subtle.verify(v.algorithm, v.key, signature, new TextEncoder().encode(timestamp + rawBody))
  } catch (e) {
    // Some runtimes throw on a malformed signature rather than returning false. Either
    // way the answer is no.
    console.error(`discord-interactions: signature verification threw — ${String((e as Error)?.message ?? e)}`)
    return false
  }
}

/** A reply only the person who clicked can see, so #welcome does not fill with confirmations. */
const reply = (content: string) =>
  json({ type: CHANNEL_MESSAGE_WITH_SOURCE, data: { content, flags: EPHEMERAL } })

/**
 * The same, with an embed. Also ephemeral, and that is the point of slash commands
 * here: somebody running /standings is looking something up, not announcing it. A
 * channel that fills with other people's lookups is a channel people mute, and a
 * muted channel misses the results post too.
 */
const replyEmbed = (embed: Record<string, unknown>) =>
  json({ type: CHANNEL_MESSAGE_WITH_SOURCE, data: { embeds: [embed], flags: EPHEMERAL } })

const SITE = 'https://hcrleague.com'
/**
 * The iRacing league id, quoted when somebody is turned away from the attendance
 * buttons. It is the league's public identifier — printed in iRacing's own league
 * directory — so it belongs in the copy rather than in config.
 */
const IRACING_LEAGUE_ID = '14470'
const HCR_YELLOW = 0xf2e114
const CLASS_ORDER = ['GTP', 'LMP2', 'GTD']
const MAX_FIELD = 1024
const clip = (s: string, n = MAX_FIELD) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// ── championship scoring ────────────────────────────────────────────────────────
//
// A PORT, NOT AN INVENTION — and now the THIRD copy of it. The others are
// src/lib/standings.ts (the website, via src/lib/attribution.ts) and the
// 'standings' branch of discord-broadcast. All three must agree, because a member
// who runs /standings and then reads the standings post has been told two things
// by the same league.
//
// The rules: crew names normalised and sorted so "A / B" and "B, A" are one entry,
// points = points + quali_points + adjust, fill_in rows excluded because they score
// the Fill-In Cup instead, ties broken by best class finish. If any of that changes
// in src/lib/standings.ts, it must change here and in discord-broadcast too.
//
// The diacritics range is written as an escape rather than as literal combining
// characters, because the literal form is invisible in most editors and does not
// survive being copied between files — which is exactly how three copies drift.
function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}
function crewKey(driversText?: string | null, fallback = ''): string {
  const names = (driversText ?? '')
    .split(/\s*(?:\/|,|;|&|\+|\band\b)\s*/i)
    .map((s) => normalizeName(s.trim()))
    .filter(Boolean)
  return names.length ? names.sort().join('|') : fallback.toLowerCase()
}
interface ScoreRow {
  event_id?: string | null
  class_id?: string | null
  number?: string | null
  drivers_text?: string | null
  cls_pos?: number | null
  points?: number | null
  quali_points?: number | null
  adjust?: number | null
  fill_in?: boolean | null
}
const rowPoints = (r: ScoreRow) => (r.points ?? 0) + (r.quali_points ?? 0) + (r.adjust ?? 0)

/** Count-back tally shape shared by every standings sort in this function. */
interface CountBack {
  finishCounts: number[]
  roundFinish: Map<number, number>
}

/** Record one classified race finish into the count-back tallies. */
function tallyFinish(t: CountBack, clsPos: number | null, round: number | undefined) {
  if (clsPos === null) return
  t.finishCounts[clsPos] = (t.finishCounts[clsPos] ?? 0) + 1
  if (round !== undefined) {
    const prev = t.roundFinish.get(round)
    t.roundFinish.set(round, prev === undefined ? clsPos : Math.min(prev, clsPos))
  }
}

/**
 * Count-back, the way real series break points ties (rulebook §31): most class
 * wins, then most seconds, and so on (FIA/IMSA); identical records fall to the
 * better class finish in the most recent round, walking backwards (MotoGP).
 * MUST stay in step with src/lib/standings.ts and the other Discord port.
 */
function countBack(a: CountBack, b: CountBack): number {
  const maxP = Math.max(a.finishCounts.length, b.finishCounts.length)
  for (let p = 1; p < maxP; p++) {
    const diff = (b.finishCounts[p] ?? 0) - (a.finishCounts[p] ?? 0)
    if (diff) return diff
  }
  const rounds = [...new Set([...a.roundFinish.keys(), ...b.roundFinish.keys()])].sort((x, y) => y - x)
  for (const rd of rounds) {
    const pa = a.roundFinish.get(rd)
    const pb = b.roundFinish.get(rd)
    if (pa !== pb) {
      if (pa === undefined) return 1
      if (pb === undefined) return -1
      return pa - pb
    }
  }
  return 0
}


/** Top `n` per class, keyed by crew, in CLASS_ORDER. */
function standingsByClass(rows: ScoreRow[], n = 5, roundByEvent: Map<string, number> = new Map()) {
  const perClass = new Map<string, Map<string, { key: string; name: string; points: number; best: number | null; starts: number } & CountBack>>()
  for (const r of rows) {
    if (r.fill_in) continue
    const cls = String(r.class_id ?? '')
    if (!CLASS_ORDER.includes(cls)) continue
    const name = (r.drivers_text || '').trim() || `#${r.number ?? '?'}`
    const key = crewKey(r.drivers_text, name)
    const bucket = perClass.get(cls) ?? new Map()
    const cur = bucket.get(key) ?? { key, name, points: 0, best: null, starts: 0, finishCounts: [], roundFinish: new Map() }
    cur.points += rowPoints(r)
    cur.starts += 1
    const p = r.cls_pos ?? null
    cur.best = cur.best === null ? p : Math.min(cur.best, p ?? 99)
    tallyFinish(cur, p, roundByEvent.get(String(r.event_id ?? '')))
    bucket.set(key, cur)
    perClass.set(cls, bucket)
  }
  return CLASS_ORDER.map((cls) => {
    const bucket = perClass.get(cls)
    if (!bucket || bucket.size === 0) return null
    const top = [...bucket.values()]
      .sort((a, b) => b.points - a.points || countBack(a, b) || a.key.localeCompare(b.key))
      .slice(0, n)
    return { cls, top, leader: top[0]?.points ?? 0 }
  }).filter(Boolean) as { cls: string; top: { name: string; points: number }[]; leader: number }[]
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** What a member is told when we cannot finish the job. Detail goes to the log, not to them. */
const ASK_A_COMMISSIONER =
  'Something went wrong opening the server up for you — nothing you did. Ask a commissioner and they will sort it out.'

interface Interaction {
  type?: number
  guild_id?: string | null
  data?: {
    /** Present on MESSAGE_COMPONENT. */
    custom_id?: string | null
    /** Present on APPLICATION_COMMAND — the command name, e.g. "standings". */
    name?: string | null
    options?: { name?: string | null; value?: unknown }[] | null
  } | null
  member?: { user?: { id?: string | null } | null; roles?: string[] | null } | null
  user?: { id?: string | null } | null
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

/**
 * Redraw the race-control tally the moment somebody answers.
 *
 * THIS EMBED IS DUPLICATED FROM discord-attendance ON PURPOSE, and the two must be
 * kept identical. The alternative — letting only the daily cron redraw it — leaves
 * an answer invisible to staff for up to a day, which defeats the point of a live
 * tally. Importing across functions is not possible (each is its own deployment),
 * so the render is copied. If the columns or wording change in discord-attendance,
 * change them here too, or the message will visibly reshape itself every time it
 * alternates between the two writers.
 *
 * Best effort by design: a failure here is logged and swallowed. The answer is
 * already saved, the member has been told so, and the daily run redraws it anyway
 * — none of which is worth turning into a red "interaction failed" in their face.
 */
const NO_CAR = '_no car set_'
async function refreshTally(
  db: ReturnType<typeof createClient>, token: string, eventId: string,
): Promise<void> {
  const { data: post } = await db.from('race_attendance_posts')
    .select('control_channel_id, control_message_id').eq('event_id', eventId).maybeSingle()
  const channelId = String(post?.control_channel_id ?? '').trim()
  const messageId = String(post?.control_message_id ?? '').trim()
  if (!channelId || !messageId) return

  const { data: ev } = await db.from('events')
    .select('round, name, date, track_id').eq('id', eventId).maybeSingle()
  if (!ev) return
  const { data: track } = ev.track_id
    ? await db.from('tracks').select('name, config').eq('id', ev.track_id).maybeSingle()
    : { data: null }

  const { data: rows } = await db.rpc('race_attendance_tally', { p_event: eventId })
  const all = (rows ?? []) as {
    driver_name: string; class_id: string | null; car_number: string | null
    car: string | null; discord_user_id: string | null; answer: boolean | null
    off_grid: boolean
  }[]

  // Split the grid from the strays BEFORE counting. An off-grid answer has no class,
  // no car and no number, so folding it into "Racing" would both inflate the count
  // and print a row reading `null` where a class code belongs.
  const tally = all.filter((r) => !r.off_grid)
  const offGrid = all.filter((r) => r.off_grid)

  // MUST RENDER IDENTICALLY TO discord-attendance's tally — a member pressing a
  // button and the daily run redraw the same message, and every divergence here
  // briefly rewrote the staff view into an older dialect (plain names instead of
  // clickable mentions, no unreachable split, full-width chase lists that blew
  // Discord's 1024-char field cap). Ported 1 Sep; change one, change both.
  const list = (rs: typeof tally, compact = false) => rs.length === 0 ? '—' : rs.map((r) => {
    const who = r.discord_user_id ? `<@${r.discord_user_id}>` : `**${r.driver_name}**`
    const tag = `\`${r.class_id}${r.car_number ? ` #${r.car_number}` : ''}\` ${who}`
    return compact ? tag : `${tag} — ${r.car?.trim() || NO_CAR}`
  }).join('\n').slice(0, 1024)

  const yes = tally.filter((r) => r.answer === true)
  const no = tally.filter((r) => r.answer === false)
  const silent = tally.filter((r) => r.answer === null)
  const chaseable = silent.filter((r) => !!r.discord_user_id)
  const unreachable = silent.filter((r) => !r.discord_user_id)

  // The time shown is when the track opens, matching the ask and the website.
  const { data: sessRow } = await db.from('sessions').select('start')
    .eq('event_id', String(ev.id)).order('start', { ascending: true }).limit(1).maybeSingle()
  const startIso = String((sessRow as { start?: string } | null)?.start ?? ev.date)
  const at = Math.floor(new Date(startIso).getTime() / 1000)

  const fields: Record<string, unknown>[] = [
    { name: `Racing (${yes.length})`, value: list(yes), inline: false },
    { name: `Cannot make it (${no.length})`, value: list(no, true), inline: false },
    { name: `No answer (${chaseable.length})`, value: list(chaseable, true), inline: false },
  ]
  if (unreachable.length) {
    fields.push({
      name: `⚠️ Cannot answer — no Discord account linked (${unreachable.length})`,
      value: list(unreachable, true), inline: false,
    })
  }
  // Somebody who answered while holding no entry. Worth its own heading rather than
  // being hidden: it is a roster gap that only shows up as a short grid on race day.
  if (offGrid.length) {
    fields.push({
      name: `⚠️ Answered but not on the grid (${offGrid.length})`,
      value: offGrid.map((o) =>
        `**${o.driver_name}**${o.discord_user_id ? ` (<@${o.discord_user_id}>)` : ''} — said ` +
        `${o.answer ? '**racing**' : 'they cannot make it'}`).join('\n').slice(0, 1024),
      inline: false,
    })
  }

  await discord(`/channels/${channelId}/messages/${messageId}`, 'PATCH', token, {
    embeds: [{
      title: `Attendance — Round ${ev.round} — ${ev.name}`,
      description: `${[track?.name, track?.config].filter(Boolean).join(' · ')}\n<t:${at}:F> (<t:${at}:R>)`,
      color: 0xf2e114,
      fields,
      footer: { text: `HCR League · staff only · ${tally.length} on the grid · updates as people answer` },
    }],
  })
}

/**
 * /next — the next race, and whether the caller is down as racing.
 *
 * Answers the two questions people actually ask in the server the week of a race,
 * and answers the second one HONESTLY: somebody with no entry is told that, rather
 * than being told they have not answered yet, which would send them looking for a
 * button that will not count them.
 *
 * Every query here is a single indexed row or a tiny set, because the whole reply
 * has to be back inside Discord's three-second interaction budget.
 */
async function handleNext(
  db: ReturnType<typeof createClient>, clicker: string,
): Promise<Response> {
  // 'next' is the curated flag race control sets. Falling back to the earliest
  // unfinished race means the command still answers during the window after a race
  // completes and before the next one is promoted, instead of saying "no races".
  let { data: ev } = await db.from('events')
    .select('id, round, name, date, track_id, season_id, duration_h, duration_min, broadcast_url')
    .eq('status', 'next').limit(1).maybeSingle()
  if (!ev) {
    const { data: soon } = await db.from('events')
      .select('id, round, name, date, track_id, season_id, duration_h, duration_min, broadcast_url')
      .neq('status', 'complete').order('date', { ascending: true }).limit(1).maybeSingle()
    ev = soon ?? null
  }
  if (!ev) {
    return reply('There is no race on the calendar right now. The schedule lives at ' + `${SITE}/schedule`)
  }

  const [{ data: track }, { data: answer }, { data: seats }] = await Promise.all([
    ev.track_id
      ? db.from('tracks').select('name, config').eq('id', ev.track_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('race_attendance').select('planned')
      .eq('event_id', ev.id).eq('discord_user_id', clicker).maybeSingle(),
    db.from('entry_drivers')
      .select('entry_id, drivers!inner(discord_user_id), entries!inner(season_id, class_id, number, car, status)')
      .eq('drivers.discord_user_id', clicker)
      .eq('entries.season_id', ev.season_id)
      // A withdrawn driver is not on the grid for what is still to come. The crew link
      // survives so their finished races keep reading true, so "are you racing?" has to
      // ask whether the link is still live rather than merely whether it exists.
      .is('withdrawn_at', null)
      .neq('entries.status', 'withdrawn')
      .limit(1),
  ])

  const at = Math.floor(new Date(String(ev.date)).getTime() / 1000)
  const where = [track?.name, track?.config].filter(Boolean).join(' · ')
  const length = ev.duration_h ? `${ev.duration_h} hours` : ev.duration_min ? `${ev.duration_min} minutes` : null

  const seat = (seats ?? [])[0] as { entries?: { class_id?: string; number?: string; car?: string } } | undefined
  const yours = seat?.entries
    ? `\`${seat.entries.class_id}${seat.entries.number ? ` #${seat.entries.number}` : ''}\` ${seat.entries.car ?? ''}`.trim()
    : null

  const { data: cfgRow } = await db.from('discord_config')
    .select('channel_race_attendance').eq('id', 1).maybeSingle()
  const attendChannel = String((cfgRow as { channel_race_attendance?: string } | null)?.channel_race_attendance ?? '').trim()

  const you = !seat
    ? 'You are **not on this season\'s entry list**, so nothing has been counted for you. ' +
      `Two minutes to fix: ${SITE}/signup`
    : answer == null
      ? `You have **not answered yet** — the attendance post in ${attendChannel ? `<#${attendChannel}>` : 'the attendance channel'} has the buttons.`
      : answer.planned
        ? 'You are down as **racing**. 🏁'
        : 'You are down as **not racing**. Press "I\'m racing" on the attendance post if that changes.'

  const fields: Record<string, unknown>[] = [
    { name: 'When', value: `<t:${at}:F>\n<t:${at}:R>`, inline: true },
  ]
  if (where) fields.push({ name: 'Where', value: clip(where), inline: true })
  if (length) fields.push({ name: 'Length', value: length, inline: true })
  if (yours) fields.push({ name: 'Your car', value: clip(yours), inline: false })
  fields.push({ name: 'You', value: clip(you), inline: false })

  return replyEmbed({
    title: `Round ${ev.round} — ${ev.name}`,
    url: `${SITE}/schedule`,
    color: HCR_YELLOW,
    fields,
    footer: { text: 'HCR League · only you can see this' },
  })
}

/**
 * /standings — top five per class, or one class if asked.
 *
 * Reads the season from `seasons.is_current` rather than from whatever race happens
 * to be next, so the answer does not change shape in the gap between seasons.
 */
async function handleStandings(
  db: ReturnType<typeof createClient>, only: string,
): Promise<Response> {
  const { data: season } = await db.from('seasons')
    .select('id, name').eq('is_current', true).maybeSingle()
  if (!season?.id) return reply(`No season is marked current. The table is at ${SITE}/standings`)

  const { data: evs } = await db.from('events').select('id, round, status').eq('season_id', season.id)
  const ids = (evs ?? []).map((e) => String(e.id))
  if (!ids.length) return reply(`No races in this season yet. ${SITE}/standings`)

  const { data: res } = await db.from('results')
    .select('event_id, class_id, number, drivers_text, cls_pos, points, quali_points, adjust, fill_in')
    .in('event_id', ids)

  const roundByEvent = new Map<string, number>((evs ?? []).map((e) => [String(e.id), Number(e.round)]))
  const table = standingsByClass((res ?? []) as ScoreRow[], 5, roundByEvent)
  const wanted = only ? table.filter((t) => t.cls === only) : table
  if (!wanted.length) {
    return reply(only
      ? `Nothing scored in ${only} yet this season.`
      : `No championship points scored yet this season. ${SITE}/standings`)
  }

  const fields = wanted.map((t) => ({
    name: t.cls,
    value: clip(t.top.map((d, i) => {
      const behind = i === 0 ? 'leader' : `−${round2(t.leader - d.points)}`
      return `\`${String(i + 1).padStart(2)}\` ${d.name} — **${round2(d.points)}** · ${behind}`
    }).join('\n')),
    inline: false,
  }))

  const done = (evs ?? []).filter((e) => e.status === 'complete').length
  return replyEmbed({
    title: only ? `${only} championship` : 'Championship standings',
    url: `${SITE}/standings`,
    color: HCR_YELLOW,
    description: `${season.name ?? 'This season'} · ${done} of ${ids.length} rounds scored`,
    fields,
    footer: { text: 'HCR League · top five per class · full table on the site · only you can see this' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // ── the gate ────────────────────────────────────────────────────────────────────
  // The body is read as text and nothing is done with it until the signature clears.
  // req.text() can only be called once, which is the other reason it is taken here
  // and passed down rather than re-read later.
  const rawBody = await req.text()

  // The verifying key comes from discord_config, so it has to be read before the gate
  // rather than after it. That means one indexed single-row select ahead of an
  // as-yet-unverified caller, which is the price of not needing a dashboard visit to
  // configure this. It fails CLOSED: no key, no config, or a failed read all end in a
  // 401, never a pass. The loaded key is cached in the isolate, so this select only
  // really happens on a cold start.
  const supaUrl = Deno.env.get('SUPABASE_URL')!
  const supaService = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  let publicKeyHex = ''
  try {
    const { data } = await createClient(supaUrl, supaService)
      .from('discord_config').select('application_public_key').eq('id', 1).maybeSingle()
    publicKeyHex = String(data?.application_public_key ?? '')
  } catch (e) {
    console.error(`discord-interactions: could not read the public key — ${String((e as Error)?.message ?? e)}`)
  }

  const passed = await signatureIsValid(
    publicKeyHex,
    req.headers.get('X-Signature-Ed25519') ?? '',
    req.headers.get('X-Signature-Timestamp') ?? '',
    rawBody,
  )
  // 401 AND NOTHING ELSE. When the endpoint URL is saved, Discord deliberately sends
  // a request with a bad signature and refuses the URL unless it is rejected — so a
  // friendly 200 here does not just weaken the gate, it stops the endpoint being
  // saveable at all. Nothing about which part failed goes back to the caller.
  if (!passed) return json({ error: 'invalid request signature' }, 401)

  let interaction: Interaction
  try {
    interaction = JSON.parse(rawBody) as Interaction
  } catch {
    return json({ error: 'Malformed interaction body' }, 400)
  }

  // Discord validates a newly saved endpoint by PINGing it. If this does not answer
  // with exactly {"type":1} the URL cannot be saved, and nothing else in this file
  // ever gets a chance to run.
  if (interaction.type === PING) return json({ type: PONG })

  // Past this point every failure answers 200 with an ephemeral message. A non-2xx
  // reply makes Discord show the member a red "This interaction failed", which tells
  // them nothing and cannot be acted on; a sentence they can read is always better,
  // and the real reason belongs in the function log either way.
  try {
    // --- slash commands -------------------------------------------------------
    // Registered by discord-commands, which sends Discord the list of names. THE
    // TWO ARE ONE UNIT: a name registered there and not handled here produces a
    // command that appears in the client, is pressable, and shrugs.
    if (interaction.type === APPLICATION_COMMAND) {
      const command = String(interaction.data?.name ?? '')
      const caller = String(interaction.member?.user?.id ?? interaction.user?.id ?? '').trim()
      const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

      if (command === 'next') {
        if (!caller) return reply('Run this in the HCR League server rather than in a DM.')
        return await handleNext(db, caller)
      }
      if (command === 'standings') {
        const opt = (interaction.data?.options ?? []).find((o) => o?.name === 'class')
        const only = String(opt?.value ?? '').trim().toUpperCase()
        // Guarded even though the command declares fixed choices: the choices are
        // enforced by Discord's client, and this endpoint is reachable by anyone
        // holding a valid signature. An unrecognised value is treated as "all".
        return await handleStandings(db, CLASS_ORDER.includes(only) ? only : '')
      }

      console.error(`discord-interactions: no handler for /${command}`)
      return reply(
        `\`/${command}\` is registered but this bot has no handler for it — that is a deploy that ` +
        'went out half-done, not something you did. Tell a commissioner.')
    }

    if (interaction.type !== MESSAGE_COMPONENT) {
      console.error(`discord-interactions: ignoring interaction type ${interaction.type}`)
      return reply('This bot only handles the button in #welcome.')
    }

    const customId = String(interaction.data?.custom_id ?? '')

    // --- attendance -----------------------------------------------------------
    // Handled before the gate check because these carry a payload after a colon
    // and would never match an equality test.
    if (customId.startsWith(`${ATTEND_YES}:`) || customId.startsWith(`${ATTEND_NO}:`)) {
      const [prefix, eventId] = customId.split(':')
      const planned = prefix === ATTEND_YES
      if (!UUID.test(String(eventId ?? ''))) {
        console.error(`discord-interactions: attendance button carried no usable event id (${customId})`)
        return reply('That attendance post is out of date — use the most recent one.')
      }
      const clicker = String(interaction.member?.user?.id ?? interaction.user?.id ?? '').trim()
      if (!clicker) return reply('Press this in the HCR League server rather than here.')

      const url = Deno.env.get('SUPABASE_URL')!
      const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const db = createClient(url, service)

      // The race is named so the confirmation is checkable — pressing a button and
      // being told "noted" gives no way to tell you answered the wrong week.
      const { data: ev } = await db.from('events').select('round, name, status, season_id').eq('id', eventId).maybeSingle()
      if (!ev) return reply('That race is no longer on the calendar.')
      if (ev.status === 'complete') {
        return reply(`Round ${ev.round} has already been run — that post is history now.`)
      }

      // THE SEAT IS CHECKED FIRST, AND IT IS A GATE.
      //
      // Only a driver on this season's grid may answer. An answer from anybody else
      // is not recorded at all — earlier this endpoint saved it and then admitted it
      // had not counted, which is a strange thing to do to somebody: it produced a
      // row nobody acted on and a member who believed they had told us something.
      // Either the answer counts or it is refused, and refusing is the honest half.
      //
      // Scoped to THIS event's season. A driver who raced last year and not this one
      // still holds an entry row, and an unscoped check would wave them through onto
      // a grid they are not on.
      //
      // A WITHDRAWN driver is refused here too. The crew link is kept rather than
      // deleted so their completed races still read true, which means its mere
      // existence no longer answers "are they racing this?" — withdrawn_at does.
      const { data: seats } = await db
        .from('entry_drivers')
        .select('entry_id, drivers!inner(discord_user_id), entries!inner(season_id, status)')
        .eq('drivers.discord_user_id', clicker)
        .eq('entries.season_id', ev.season_id)
        .is('withdrawn_at', null)
        .neq('entries.status', 'withdrawn')
        .limit(1)

      if (!seats?.length) {
        // Nothing is written. The reply is the whole response, so it carries the way
        // out rather than just the refusal — a door with no handle is what makes
        // somebody give up and say nothing to anyone.
        return reply([
          `You are not on the Round ${ev.round} entry list yet, so attendance is not open to you — ` +
          'nothing has been recorded.',
          '',
          '**Getting on the grid takes about two minutes:**',
          `**1.** Go to ${SITE} and hit **Enter Season** — sign in with this same Discord account.`,
          '**2.** In **My Portal**, press **Enter the season**. Pick your class, your car and two car ' +
          'numbers, and have your iRacing name and customer ID to hand.',
          `**3.** Race control confirms your slot and sends your **iRacing** league invite — accept it, ` +
          `or find us in the Leagues directory as **HCR League**, league ID **${IRACING_LEAGUE_ID}**. ` +
          'You cannot join the race session without it.',
          '',
          'Once you are on the grid these buttons start working, and this post is where you answer.',
        ].join('\n'))
      }

      const { error } = await db.rpc('race_attendance_set', {
        p_event: eventId, p_discord_user_id: clicker, p_planned: planned,
      })
      if (error) {
        console.error(`discord-interactions: could not record attendance — ${error.message}`)
        return reply(ASK_A_COMMISSIONER)
      }

      // Redraw the staff tally NOW rather than waiting for the daily run, so race
      // control sees an answer within a second or two of it being given.
      //
      // Bounded, because Discord abandons an interaction that is not answered within
      // THREE SECONDS and shows the member a red "This interaction failed" — which
      // would be a lie, since their answer is already committed. The refresh gets
      // 1.5s and is dropped if it overruns. Losing it costs nothing: the daily run
      // redraws the same message from the same data.
      const refreshToken = Deno.env.get('DISCORD_BOT_TOKEN')
      if (refreshToken) {
        await Promise.race([
          refreshTally(db, refreshToken, eventId).catch((e) =>
            console.error(`discord-interactions: tally refresh failed — ${String((e as Error)?.message ?? e)}`)),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ])
      }

      // Deliberately does NOT edit the public post. Every name lives in the private
      // race-control channel; a public running list turns "who has not replied" into
      // a scoreboard of who is ignoring the commissioner, and that was not the ask.
      return reply(planned
        ? `You are down as racing at Round ${ev.round} — ${ev.name} 🏁\n\nChanged your mind? Press "Can't make it" on the same post.`
        : `Noted — you are not racing at Round ${ev.round} — ${ev.name}.\n\nIf that changes, press "I'm racing" on the same post.`)
    }

    if (customId !== GATE_CUSTOM_ID) {
      console.error(`discord-interactions: unrecognised custom_id ${JSON.stringify(customId)}`)
      return reply('That button is out of date — ask a commissioner to repost the welcome message.')
    }

    // A component in a DM has `user` and no `member`. There is no guild to grant a
    // role in, so there is nothing to do but point them back to the server.
    const userId = String(interaction.member?.user?.id ?? '').trim()
    if (!userId) {
      console.error(`discord-interactions: component with no guild member (user ${interaction.user?.id ?? 'unknown'})`)
      return reply('Press this in the HCR League server rather than here, and it will let you in.')
    }

    const url = Deno.env.get('SUPABASE_URL')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
    const db = createClient(url, service)

    const { data: cfg, error: cfgError } = await db
      .from('discord_config')
      .select('guild_id, gate_role_id')
      .eq('id', 1)
      .maybeSingle()
    if (cfgError) {
      console.error(`discord-interactions: could not read discord_config — ${cfgError.message}`)
      return reply(ASK_A_COMMISSIONER)
    }

    // Deliberately NOT gated on discord_config.enabled. That switch turns off the
    // site's chatter — announcements, syncs, the periodic member roll — and none of
    // it is load-bearing. This is a locked door. Somebody standing outside it should
    // not be turned away because an admin muted the bot for an afternoon.
    const guildId = String(cfg?.guild_id ?? '').trim()
    const gateRoleId = String(cfg?.gate_role_id ?? '').trim()
    if (!gateRoleId) {
      console.error(
        'discord-interactions: discord_config.gate_role_id is empty, so there is no role to grant. ' +
        'Set it to the id of the role every gated channel is keyed to.')
      return reply(ASK_A_COMMISSIONER)
    }
    if (!botToken) {
      console.error('discord-interactions: DISCORD_BOT_TOKEN is not set, so no role can be granted.')
      return reply(ASK_A_COMMISSIONER)
    }

    // The signature proves the click came from Discord, not that it came from OUR
    // server. If the application is ever added to a second guild, a copy of this
    // button there would otherwise try to grant an id that means nothing in it — or,
    // worse, happens to mean something else. The role belongs to one guild; check we
    // are in it.
    const clickedIn = String(interaction.guild_id ?? '').trim()
    if (!guildId || clickedIn !== guildId) {
      console.error(`discord-interactions: gate pressed in guild ${clickedIn || 'unknown'}, expected ${guildId || 'unset'}`)
      return reply('This button only works in the HCR League server.')
    }

    // The interaction payload already lists the roles the clicker holds, so this costs
    // no extra call. Discord's role PUT is idempotent and would return 204 either way,
    // which is exactly why the check is here: without it, somebody who already has
    // access gets a message congratulating them on getting in, every time, and starts
    // to wonder whether the first click actually worked.
    const held = interaction.member?.roles ?? []
    if (Array.isArray(held) && held.map(String).includes(gateRoleId)) {
      return reply('You are already in — the whole server is open to you. See you on track 🏁')
    }

    const put = await discord(`/guilds/${guildId}/members/${userId}/roles/${gateRoleId}`, 'PUT', botToken)
    if (!put.ok) {
      // Every one of these is an operator problem, not a member problem, so the member
      // gets the same actionable sentence and the specifics go to the log:
      //   403 — role hierarchy. The bot holds Administrator today, but that does not
      //         let it grant a role positioned above its own; drag the bot's role up.
      //   404 — gate_role_id points at a role that no longer exists, or the member has
      //         already left the server between clicking and this call.
      //   429 — rate limited, which at this volume means something is hammering it.
      console.error(
        `discord-interactions: could not grant ${gateRoleId} to ${userId} in ${guildId} — ` +
        `${put.status} ${put.message}`)
      return reply(ASK_A_COMMISSIONER)
    }

    return reply([
      'You are in 🏁',
      '',
      'The rest of the server just opened up. The welcome guide in this channel has the tour ' +
      'and the two minutes it takes to get on the grid.',
    ].join('\n'))
  } catch (e) {
    console.error(`discord-interactions: unhandled — ${String((e as Error)?.stack ?? e)}`)
    return reply(ASK_A_COMMISSIONER)
  }
})
