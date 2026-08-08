// discord-interactions — the endpoint Discord POSTs a button click to, and the only
// thing standing between a newcomer and the rest of the server.
//
// One button, in #welcome. Pressing it grants discord_config.gate_role_id, which is
// the role every other channel is gated behind. Nothing else in this file does
// anything: no commands, no modals, no state.
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

/** What a member is told when we cannot finish the job. Detail goes to the log, not to them. */
const ASK_A_COMMISSIONER =
  'Something went wrong opening the server up for you — nothing you did. Ask a commissioner and they will sort it out.'

interface Interaction {
  type?: number
  guild_id?: string | null
  data?: { custom_id?: string | null } | null
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
    if (interaction.type !== MESSAGE_COMPONENT) {
      console.error(`discord-interactions: ignoring interaction type ${interaction.type}`)
      return reply('This bot only handles the button in #welcome.')
    }

    const customId = String(interaction.data?.custom_id ?? '')
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
