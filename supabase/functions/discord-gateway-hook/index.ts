// discord-gateway-hook — the one door a gateway bot may knock on to say "the member
// list just changed, look now".
//
// The bot runs on a small VM holding a persistent Discord gateway connection, which
// is the only way to hear a join or a leave the instant it happens. It composes
// nothing and posts nothing: it calls this, and this asks the database to run
// discord-membership, exactly as the every-two-minutes cron already does. One source
// of truth, one set of league logic, in discord-membership where it already lives.
//
// The cron stays switched on underneath. If the VM dies, is rebooted, or loses its
// gateway session, nothing breaks — joins and leaves go back to being noticed within
// two minutes, which is how they were noticed before the VM existed.
//
// DEPLOYED WITH verify_jwt ON, like every other function here. Two gates, not one.
//
// An earlier draft turned it off, reasoning that the only key which can invoke a
// JWT-protected function is the service-role key, and that a machine on the public
// internet should not hold one. The premise is false: verify_jwt accepts any JWT
// signed with the project's JWT secret, and the ANON key is one. The site already
// relies on this — src/pages/commissioner/DiscordAutomations.tsx invokes functions
// with the anon key as `apikey` and a user JWT as Bearer.
//
// So the VM carries the anon key, which grants it nothing the public website does not
// already grant every visitor: discord_config, discord_automations and discord_members
// are all RLS-protected to admins, and discord_cron_invoke is EXECUTE-granted to
// service_role alone. Supabase's gateway now rejects unauthenticated callers before
// this code or the database is touched, and the shared secret remains the real gate
// behind it. Turning verify_jwt off would have bought nothing and cost this project
// its only anonymous endpoint.
//
// What is behind the door is deliberately tiny in any case: it takes no parameters
// that change what happens, it cannot address any automation other than
// discord-membership, and the worst a caller holding both credentials can do is make
// the league re-read its own member list slightly more often than the cron already
// does.
//
// THE SECRET IS NEVER STORED IN PLAINTEXT. discord_config.gateway_secret_sha256
// holds a SHA-256 hex digest; the presented header is hashed and the digests are
// compared. A database dump therefore leaks nothing that can be replayed against
// this endpoint.
//
// Auto-provided:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  // x-hcr-gateway-secret is on the allow-list only so this can be exercised from a
  // browser while testing. The bot is a server and never sends a preflight.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hcr-gateway-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

/** The only automation this door can reach. Not a parameter, on purpose. */
const AUTOMATION = 'discord-membership'

/**
 * How recently a run has to have started for this call to be dropped.
 *
 * A floor on how often a run can be started, and nothing more.
 *
 * The bot already collapses its own bursts. This is only here to blunt someone
 * hammering the endpoint, so it must be SHORTER than the bot's flush interval
 * (MIN_INTERVAL_MS, 5s in oracle-gateway/index.mjs) — a floor longer than that would
 * reject the bot's own legitimate second batch, which is precisely the bug an earlier
 * ten-second version had. Causality, not this number, decides whether a call is
 * redundant; see the fold check below.
 */
const FLOOD_FLOOR_MS = 2_000

/** SHA-256 of a string, as lowercase hex — the form stored in the database. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Compare two digests without letting the time taken describe how close a guess was.
 *
 * Every character is examined whatever happens: differences accumulate into `diff`
 * and are only inspected at the end. `===` would stop at the first mismatched byte,
 * which over enough attempts leaks the digest one character at a time.
 */
function digestsMatch(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const span = Math.max(a.length, b.length)
  for (let i = 0; i < span; i++) {
    diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0)
  }
  return diff === 0
}

const HEX_64 = /^[0-9a-f]{64}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const db = createClient(url, service)

    const { data: cfg, error: cfgError } = await db
      .from('discord_config')
      .select('gateway_secret_sha256')
      .eq('id', 1)
      .maybeSingle()
    // Everything from here to the secret check answers an as-yet UNAUTHENTICATED
    // caller, so the detail goes to the function log and the caller gets a bare
    // status. The operator-facing sentences below were genuinely useful, but they
    // named the exact column holding the credential and said whether it was missing
    // or malformed, which is configuration reconnaissance for anyone with the URL.
    if (cfgError) {
      console.error(`discord-gateway-hook: could not read discord_config — ${cfgError.message}`)
      return json({ error: 'Unavailable' }, 503)
    }

    // Fail closed. With no digest on file there is nothing to check a caller against,
    // and an endpoint that lets everyone through because it was never configured is
    // worse than one that lets nobody through.
    const expected = String(cfg?.gateway_secret_sha256 ?? '').trim().toLowerCase()
    if (!expected) {
      console.error(
        'discord-gateway-hook: refusing everything — discord_config.gateway_secret_sha256 is empty. ' +
        'Store the SHA-256 hex digest of the shared secret the VM sends. Joins and leaves are still ' +
        'being picked up by the two-minute check.')
      return json({ error: 'Unavailable' }, 503)
    }
    // A value that is not a SHA-256 digest is almost certainly the secret itself,
    // pasted into the wrong place — which is exactly the mistake this design exists
    // to prevent, so it is named in the log rather than left to fail as a silent 401
    // for ever.
    if (!HEX_64.test(expected)) {
      console.error(
        'discord-gateway-hook: refusing everything — discord_config.gateway_secret_sha256 is not a ' +
        'SHA-256 hex digest. Store the digest of the secret, never the secret itself.')
      return json({ error: 'Unavailable' }, 503)
    }

    // Absent and wrong are answered identically, in the same words, with the same
    // status. Telling a caller which of the two they managed is telling them whether
    // they are on the right track.
    const presented = req.headers.get('x-hcr-gateway-secret') ?? ''
    if (!digestsMatch(await sha256Hex(presented), expected)) {
      return json({ error: 'Not authorised' }, 401)
    }

    const { data: auto, error: autoError } = await db
      .from('discord_automations')
      .select('enabled, last_run_at, last_status')
      .eq('key', AUTOMATION)
      .maybeSingle()
    if (autoError) {
      return json({ error: `Could not read when ${AUTOMATION} last ran — ${autoError.message}` }, 500)
    }
    // discord_cron_invoke raises on an unregistered name. Catching it here says why
    // in a sentence someone can act on instead of surfacing a Postgres exception.
    if (!auto) {
      return json({
        error: `${AUTOMATION} is not registered in discord_automations, so there is nothing to trigger. ` +
               'It has to exist there before either this or the schedule can run it.',
      }, 500)
    }
    // Switched off in the commissioner panel. discord_cron_invoke would return
    // quietly; saying so plainly saves someone wondering why the VM looks healthy
    // and nothing is being announced.
    if (auto.enabled !== true) {
      return json({
        skipped: 'automation-disabled',
        message: `${AUTOMATION} is switched off in the Discord automations panel, so nothing was run.`,
      })
    }

    // The body is read here rather than at the end because the newest event's
    // timestamp decides whether this call can be folded away. Everything taken from
    // it is advisory: it can shorten work, never widen it, and never steer what runs.
    let event: string | null = null
    let newestEventAt = Number.NaN
    try {
      const body = await req.json() as { event?: unknown; events?: unknown } | null
      const raw = body?.event
      if (typeof raw === 'string') event = raw.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || null
      if (Array.isArray(body?.events)) {
        for (const e of body.events as { at?: unknown }[]) {
          const t = Date.parse(String(e?.at ?? ''))
          if (Number.isFinite(t) && (!Number.isFinite(newestEventAt) || t > newestEventAt)) newestEventAt = t
        }
      }
    } catch { /* no body, or not JSON — the trigger does not depend on one */ }

    // FOLDING IS ABOUT CAUSALITY, NOT ELAPSED TIME.
    //
    // last_run_at is stamped when a run STARTS. A run can only have seen a member who
    // was already there when it read the roll, so the question is not "did something
    // run recently" but "did it run AFTER the newest thing we are reporting".
    //
    // Getting that wrong drops people. The first version folded on wall-clock alone
    // with a 10s window, which was twice the bot's 5s flush interval — so in a burst
    // of joins the second batch was always discarded, and discarded against a run that
    // had read the member list before those people existed. They then waited for the
    // 2-minute cron, in exactly the case the whole gateway exists to make instant.
    //
    // A short absolute floor stays, purely to blunt someone hammering the endpoint. It
    // is deliberately shorter than the bot's flush interval so it can never swallow a
    // legitimate batch, and it is skipped entirely once we know the events are newer
    // than the last run.
    const lastRun = auto.last_run_at ? Date.parse(String(auto.last_run_at)) : NaN
    const sinceMs = Number.isFinite(lastRun) ? Date.now() - lastRun : Number.POSITIVE_INFINITY
    const alreadyObserved = Number.isFinite(lastRun) && Number.isFinite(newestEventAt)
      ? lastRun > newestEventAt
      : sinceMs < FLOOD_FLOOR_MS // no usable timestamps: fall back to the floor alone
    if (alreadyObserved) {
      return json({
        skipped: 'already-covered',
        message: Number.isFinite(newestEventAt)
          ? `${AUTOMATION} started after the newest event in this batch, so that run already saw it.`
          : `${AUTOMATION} started ${Math.round(sinceMs / 1000)}s ago and this call carried no event times, so it was folded in.`,
        since_ms: Number.isFinite(sinceMs) ? sinceMs : null,
      })
    }

    // Through discord_cron_invoke rather than straight at the function's URL, because
    // that helper carries the in-flight guard that stops two membership runs
    // overlapping — and it is the same path the cron takes, so a gateway-triggered
    // run is indistinguishable from a scheduled one everywhere downstream. That guard
    // is also why this function does not need one of its own: a call arriving mid-run
    // is serialised there rather than dropped here.
    const { error: rpcError } = await db.rpc('discord_cron_invoke', { fn: AUTOMATION })
    if (rpcError) {
      console.error(`discord-gateway-hook: rpc failed — ${rpcError.message}`)
      return json({ error: 'Could not start the membership run.' }, 502)
    }

    return json({ ok: true, invoked: AUTOMATION, event })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
