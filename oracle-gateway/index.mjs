#!/usr/bin/env node
// hcr-gateway — turns a Discord join or leave into an instant nudge at the
// membership edge function, instead of waiting out the two-minute cron.
//
// This process is a RELAY AND NOTHING ELSE. It writes no messages, posts nothing
// to Discord, reads no database and holds no league rules. Every event it sees
// ends as one POST to discord-membership, which then does exactly what it already
// does when pg_cron calls it. One source of truth, one place to change the
// welcome copy, one place that can get the rules wrong.
//
// That also means the cron stays switched on. It is the backstop: if this VM is
// rebooted, throttled or simply gone, joins and leaves are still handled, just up
// to two minutes late. Nothing here retries forever or keeps state on disk,
// because a dropped trigger costs latency and never data.
//
// SECRETS. This machine holds the bot token — a gateway connection cannot be made
// without it — and a narrow shared secret that can do nothing but ask for a
// membership refresh. It must never hold the Supabase service-role key; the
// guards below refuse to start if one is pasted in by mistake.
//
// Environment (systemd EnvironmentFile, mode 0600, since the token is in it):
//   DISCORD_BOT_TOKEN   the bot's token
//   HCR_GUILD_ID        the league's server id — events from anywhere else are ignored
//   HCR_HOOK_URL        https URL of the discord-membership trigger function
//   HCR_GATEWAY_SECRET  shared secret; the function stores only its SHA-256 hash
//   HCR_HOOK_AUTH       optional Bearer token for Supabase's gateway — the ANON key
//                       (public by design) when the function is deployed with JWT
//                       verification left on. Never the service-role key.
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js'

/**
 * Timestamped because journald stamps lines in the VM's local zone and drops the
 * stamp entirely once a log is piped or copied somewhere else. Everything goes to
 * stdout, failures included: stdout and stderr interleave unpredictably, and a log
 * whose lines are out of order is worse than one without severity levels.
 */
const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`)

const fatal = (msg) => {
  log(msg)
  process.exit(1) // systemd restarts us, and `systemctl status` shows why
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- settings -----------------------------------------------------------------

const env = (name) => String(process.env[name] ?? '').trim()

const TOKEN = env('DISCORD_BOT_TOKEN')
const GUILD_ID = env('HCR_GUILD_ID')
const HOOK_URL = env('HCR_HOOK_URL')
const SECRET = env('HCR_GATEWAY_SECRET')
const HOOK_AUTH = env('HCR_HOOK_AUTH')

const missing = Object.entries({
  DISCORD_BOT_TOKEN: TOKEN,
  HCR_GUILD_ID: GUILD_ID,
  HCR_HOOK_URL: HOOK_URL,
  HCR_GATEWAY_SECRET: SECRET,
}).filter(([, v]) => !v).map(([k]) => k)

if (missing.length) {
  fatal(
    `Cannot start: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
      'Add the missing line(s) to the environment file (default /etc/hcr-gateway.env), then run ' +
      '`sudo systemctl restart hcr-gateway`.',
  )
}

if (!/^\d{5,}$/.test(GUILD_ID)) {
  fatal(
    `Cannot start: HCR_GUILD_ID is "${GUILD_ID}", which is not a Discord id. Turn on Developer Mode ` +
      'in Discord, right-click the HCR server and choose Copy Server ID.',
  )
}

let hookUrl
try {
  hookUrl = new URL(HOOK_URL)
} catch {
  fatal(`Cannot start: HCR_HOOK_URL is not a URL — "${HOOK_URL}".`)
}
// The shared secret travels in a header on every trigger, so plain http would put
// it in the clear on the wire. Refuse rather than leak it.
if (hookUrl.protocol !== 'https:') {
  fatal(`Cannot start: HCR_HOOK_URL must be https, not ${hookUrl.protocol.replace(':', '')} — the shared secret is sent as a header.`)
}

/** True when a JWT's payload claims the service_role, without verifying it. */
function isServiceRoleJwt(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const b = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b + '='.repeat((4 - (b.length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))?.role === 'service_role'
  } catch {
    return false
  }
}

/**
 * The one credential that must never reach this machine.
 *
 * A service-role key is total access to the database, and it is easy to paste in
 * by reflex because it is the key every other part of this stack uses. Catching it
 * at startup is the difference between a bot that refuses to run and a VM that
 * quietly holds the keys to everything.
 */
for (const [name, value] of [['HCR_GATEWAY_SECRET', SECRET], ['HCR_HOOK_AUTH', HOOK_AUTH]]) {
  if (!value) continue
  if (isServiceRoleJwt(value) || value.startsWith('sb_secret_')) {
    fatal(
      `Cannot start: ${name} looks like a Supabase service-role key. This machine must never hold one. ` +
        (name === 'HCR_HOOK_AUTH'
          ? 'Use the anon (publishable) key here, or leave it unset if the function is deployed with --no-verify-jwt.'
          : 'Use the random gateway secret whose SHA-256 hash is stored in discord_config.'),
    )
  }
}

if (SECRET.length < 24) {
  log(`Warning: HCR_GATEWAY_SECRET is only ${SECRET.length} characters. Hashing it in the database does not make a guessable secret safe — 32 random bytes is the intent.`)
}

// --- coalescing ---------------------------------------------------------------

/**
 * How long to hold a batch open before firing.
 *
 * Two seconds, because members almost never arrive alone: one invite link posted
 * somewhere brings three or four people in the same breath, and each of them would
 * otherwise cost a separate full member roll on the function's side. Waiting two
 * seconds turns that into one call, and against the two-minute cron this replaces
 * the delay is not perceptible — the function itself spends longer than that
 * reading the member list.
 */
const COALESCE_MS = 2_000

/**
 * The floor between requests, which is the actual defence against a raid.
 *
 * The coalescing window alone would still fire every two seconds for as long as
 * people kept pouring in. This caps the whole process at one request per five
 * seconds no matter how many events arrive, and because the function re-reads the
 * entire member list each time, one late call covers every arrival before it.
 */
const MIN_INTERVAL_MS = 5_000

/** Enough events named for a human reading logs; the rest are counted, not listed. */
const MAX_LISTED = 25

const ATTEMPTS = 3
const BACKOFF_MS = [1_000, 4_000]
const REQUEST_TIMEOUT_MS = 15_000

let pending = []
let timer = null
let sending = false
let lastFlushAt = 0

function queue(type, userId) {
  pending.push({ type, userId, at: new Date().toISOString() })
  schedule()
}

function schedule() {
  if (timer || sending || pending.length === 0) return
  const wait = Math.max(COALESCE_MS, MIN_INTERVAL_MS - (Date.now() - lastFlushAt))
  timer = setTimeout(() => {
    timer = null
    flush()
  }, wait)
}

async function flush() {
  const batch = pending
  pending = []
  sending = true
  lastFlushAt = Date.now()
  try {
    await deliver(batch)
  } catch (err) {
    // deliver() reports its own failures; this only exists so an unexpected throw
    // cannot leave `sending` stuck true and silence the bot for good.
    log(`Unexpected failure while sending a trigger — ${err?.message ?? err}`)
  } finally {
    sending = false
    schedule() // anything that arrived while that request was in flight
  }
}

function describe(batch) {
  const joins = batch.filter((e) => e.type === 'guildMemberAdd').length
  const leaves = batch.length - joins
  const parts = []
  if (joins) parts.push(`${joins} join${joins === 1 ? '' : 's'}`)
  if (leaves) parts.push(`${leaves} departure${leaves === 1 ? '' : 's'}`)
  return parts.join(' and ')
}

async function deliver(batch) {
  const summary = describe(batch)
  const body = JSON.stringify({
    source: 'oracle-gateway',
    guildId: GUILD_ID,
    sentAt: new Date().toISOString(),
    // Diagnostic only. The function rolls the whole member list itself, so it
    // neither trusts nor needs this list to be complete — which is what makes
    // truncating it safe, and what makes a lost trigger cost only time.
    events: batch.slice(0, MAX_LISTED),
    omitted: Math.max(0, batch.length - MAX_LISTED),
  })

  const headers = {
    'Content-Type': 'application/json',
    'x-hcr-gateway-secret': SECRET,
  }
  if (HOOK_AUTH) headers.Authorization = `Bearer ${HOOK_AUTH}`

  let lastError = 'unknown'
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(hookUrl, {
        method: 'POST',
        headers,
        body,
        // Never follow a redirect. Node strips Authorization on a cross-origin hop
        // but does NOT strip custom headers, so a 3xx would hand the shared secret in
        // x-hcr-gateway-secret to whatever host the Location named. This endpoint is
        // a fixed first-party URL that should never redirect, so a redirect means a
        // typo in HCR_HOOK_URL, hijacked DNS, or something worse — all of which are
        // better failed than followed. The retry loop treats it as an error, and the
        // two-minute cron covers the dropped trigger.
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const text = (await res.text()).slice(0, 300)

      if (res.ok) {
        log(`Triggered a membership refresh for ${summary}.`)
        return
      }

      // A rejected secret is a configuration mistake, not a blip. Retrying it just
      // buries the one line that says how to fix it.
      if (res.status === 401 || res.status === 403) {
        log(
          `The membership function refused this trigger (${res.status}) and it will keep refusing until the ` +
            'settings are fixed. Either HCR_GATEWAY_SECRET on this VM does not match the hash stored in ' +
            'discord_config.gateway_secret_sha256, or the function still requires a Supabase JWT and ' +
            `HCR_HOOK_AUTH is unset. Discord joins and leaves are still handled by the two-minute cron. Reply was: ${text}`,
        )
        return
      }

      lastError = `HTTP ${res.status}${text ? ` — ${text}` : ''}`
    } catch (err) {
      lastError = err?.name === 'TimeoutError'
        ? `no reply within ${REQUEST_TIMEOUT_MS / 1000}s`
        : String(err?.message ?? err)
    }

    if (attempt < ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1])
  }

  log(
    `Could not reach the membership function after ${ATTEMPTS} tries (${lastError}). Nothing is lost: ` +
      `the two-minute cron will pick up ${summary} on its next run, so this costs speed only. If these ` +
      'lines keep appearing, check that the function is deployed and that this VM can reach the internet.',
  )
}

// --- Discord ------------------------------------------------------------------

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  /**
   * guildMemberRemove arrives describing someone who is, by definition, already
   * gone. Without the GuildMember partial, discord.js silently drops the event for
   * anyone it had not cached — and Discord only sends the full member list at
   * connect for small servers, so most departures would never be seen at all. The
   * partial gives us the one field this relay actually uses: the user id.
   */
  partials: [Partials.GuildMember],
})

function onMember(type, member) {
  const guildId = String(member?.guild?.id ?? '')
  // The bot could be invited to another server by anyone with Manage Server there.
  // Only the league's own guild is allowed to trigger writes to league data.
  if (guildId !== GUILD_ID) {
    log(`Ignored ${type} in server ${guildId || 'unknown'} — not the configured HCR server.`)
    return
  }

  const userId = String(member?.id ?? member?.user?.id ?? '')
  if (!userId) {
    log(`A ${type} event arrived without a user id and was ignored.`)
    return
  }

  const who = member?.user?.username ? `${member.user.username} (${userId})` : userId
  log(`${type === 'guildMemberAdd' ? 'Joined' : 'Left'}: ${who}`)
  queue(type, userId)
}

client.once(Events.ClientReady, (c) => {
  log(`Connected to Discord as ${c.user.tag}, watching server ${GUILD_ID}.`)
  if (!c.guilds.cache.has(GUILD_ID)) {
    // Not fatal: the moment someone invites the bot, GUILD_CREATE arrives and this
    // process starts working without a restart.
    log(
      `Warning: this bot is not in server ${GUILD_ID}, so no joins or leaves will be seen. ` +
        `It is currently in: ${[...c.guilds.cache.values()].map((g) => `${g.name} (${g.id})`).join(', ') || 'no servers'}.`,
    )
  }
})

client.on(Events.GuildMemberAdd, (member) => onMember('guildMemberAdd', member))
client.on(Events.GuildMemberRemove, (member) => onMember('guildMemberRemove', member))

// discord.js reconnects and resumes on its own; these listeners exist to make that
// visible in journalctl and — for Error and ShardError — because an unhandled
// 'error' event on an EventEmitter takes the whole process down, which is exactly
// what must not happen for a dropped socket.
client.on(Events.Error, (err) => log(`Discord client error (staying up, discord.js will reconnect) — ${err?.message ?? err}`))
client.on(Events.ShardError, (err) => log(`Gateway socket error (staying up, discord.js will reconnect) — ${err?.message ?? err}`))
client.on(Events.ShardDisconnect, (event) => log(`Gateway disconnected (code ${event?.code ?? '?'}) — reconnecting.`))
client.on(Events.ShardReconnecting, () => log('Reconnecting to the Discord gateway.'))
client.on(Events.ShardResume, (_id, replayed) => log(`Gateway session resumed, ${replayed} event(s) replayed.`))

// The session was invalidated in a way discord.js cannot recover from. A fresh
// process can, so hand it to systemd rather than sitting here deaf.
client.on(Events.Invalidated, () => fatal('Discord invalidated this session and it cannot be resumed. Restarting.'))

// A dropped trigger is not worth losing the gateway connection over — the cron
// covers it. Log loudly and keep listening.
process.on('unhandledRejection', (reason) => log(`Unhandled promise rejection (staying up) — ${reason?.message ?? reason}`))
process.on('uncaughtException', (err) => log(`Uncaught exception (staying up) — ${err?.stack ?? err}`))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`${signal} received — closing the gateway connection.`)
    Promise.resolve(client.destroy()).finally(() => process.exit(0))
  })
}

/**
 * Connect, distinguishing "this will never work" from "the network is not up yet".
 *
 * On a rebooting VM the first attempt often lands before DNS is ready, so a
 * transient failure is retried rather than treated as a crash. A bad token or a
 * missing privileged intent is retried by nobody: it needs a human in the Discord
 * developer portal, and saying so once beats a restart loop that says nothing.
 */
async function connect() {
  const backoff = [2_000, 5_000, 15_000, 30_000]
  for (let attempt = 1; ; attempt++) {
    try {
      await client.login(TOKEN)
      return
    } catch (err) {
      const msg = String(err?.message ?? err)

      if (/disallowed intents/i.test(msg)) {
        fatal(
          'Discord refused the connection because a privileged intent is switched off. Open the Discord ' +
            'developer portal → this application → Bot, turn on SERVER MEMBERS INTENT, save, then restart ' +
            'this service. Nothing else will fix it.',
        )
      }
      if (/token|unauthorized|401/i.test(msg)) {
        fatal(
          `Discord rejected the bot token — ${msg}. Check DISCORD_BOT_TOKEN in the environment file; if the ` +
            'token was regenerated in the developer portal, the old one is dead and must be replaced.',
        )
      }
      if (attempt > backoff.length) {
        fatal(`Could not reach Discord after ${attempt} attempts — ${msg}. Giving up so systemd restarts cleanly.`)
      }

      const wait = backoff[attempt - 1]
      log(`Could not connect to Discord (${msg}). Retrying in ${wait / 1000}s.`)
      await sleep(wait)
    }
  }
}

log('Starting the HCR Discord gateway relay.')
connect()
