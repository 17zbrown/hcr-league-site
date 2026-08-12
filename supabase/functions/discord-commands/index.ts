// discord-commands — registers the league's slash commands with Discord.
//
// Run this once after adding, renaming or re-describing a command. It is NOT on a
// cron and does not need to be: Discord stores the command list on its own side, so
// re-registering an unchanged list is a no-op that costs an API call for nothing.
//
// GUILD COMMANDS, NOT GLOBAL. Registering against the one guild makes a command
// appear in the client immediately; a global command can take up to an hour to
// propagate, which during setup is indistinguishable from "it is broken". HCR runs
// one server, so there is no reason to pay that.
//
// PUT REPLACES THE WHOLE LIST. The endpoint is a bulk overwrite, not an append —
// whatever is not in the array sent here is deleted from the guild. That is the
// behaviour we want (the repo is then the only source of truth for what exists),
// but it means a partial array silently removes commands. If you add a command,
// add it to COMMANDS; never PUT a subset.
//
// WHERE THE APPLICATION ID COMES FROM. Nowhere. It is not stored and does not need
// to be: GET /oauth2/applications/@me, authenticated as the bot, returns the
// application that owns the token. That keeps one more id out of the config table
// and makes this function correct even if the app is ever recreated. The bot TOKEN
// never leaves this function — it is a Supabase secret and is never returned, never
// logged, and never written to the database.
//
// The handler for these commands lives in discord-interactions. Registering a
// command whose name that function does not handle produces a command that appears
// in the client, is pressable, and answers with a shrug — so the two must be
// changed together. COMMANDS below and the switch in discord-interactions are one
// unit in two deployments.
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

/** Application command types. 1 = CHAT_INPUT, the ordinary slash command. */
const CHAT_INPUT = 1
/** Command option types. 3 = STRING. */
const OPT_STRING = 3

/**
 * Every slash command the league has.
 *
 * Descriptions are what a member reads in the autocomplete list before they have
 * ever used the command, so they say what comes back, not what the code does.
 *
 * Both are answered EPHEMERALLY by discord-interactions — only the person who ran
 * it sees the reply. That is deliberate: a slash command is somebody looking
 * something up, not announcing it, and a channel that fills with other people's
 * standings lookups is a channel people mute.
 */
const COMMANDS = [
  {
    name: 'next',
    type: CHAT_INPUT,
    description: 'The next race — when it is, and whether you are down as racing.',
  },
  {
    name: 'standings',
    type: CHAT_INPUT,
    description: 'Championship standings, top five in each class.',
    options: [
      {
        name: 'class',
        type: OPT_STRING,
        description: 'One class only. Leave blank for all three.',
        required: false,
        // Choices rather than free text: the class ids are a closed set, and a
        // typo'd free-text class would return an empty table that looks like a bug.
        choices: [
          { name: 'GTP', value: 'GTP' },
          { name: 'LMP2', value: 'LMP2' },
          { name: 'GTD', value: 'GTD' },
        ],
      },
    ],
  },
]

async function discord(path: string, method: string, token: string, body?: unknown) {
  const res = await fetch(`${DISCORD}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: unknown = null
  try { parsed = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  return {
    ok: res.ok, status: res.status, data: parsed,
    message: (parsed as { message?: string } | null)?.message ?? text.slice(0, 300),
  }
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

    let dryRun = false
    // {"clear": true} removes every command from the guild. For backing the feature
    // out without redeploying the handler — the commands vanish from the client
    // rather than staying visible and answering with an error.
    let clear = false
    try {
      const b = await req.json()
      if (b && typeof b === 'object') {
        const o = b as Record<string, unknown>
        if (o.dryRun === true) dryRun = true
        if (o.clear === true) clear = true
      }
    } catch { /* no body — register the list as written */ }

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
    const { data: cfg } = await db.from('discord_config').select('guild_id, enabled').eq('id', 1).maybeSingle()
    const guildId = String(cfg?.guild_id ?? '').trim()
    if (!guildId) return json({ error: 'No guild_id is configured.' }, 400)
    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    const wanted = clear ? [] : COMMANDS
    if (dryRun) {
      return json({
        ok: true, dryRun, guild: guildId,
        wouldRegister: wanted.map((c) => `/${c.name}`),
        note: clear
          ? 'Would remove every slash command from the guild.'
          : 'PUT replaces the guild list wholesale — anything not listed here is removed.',
      })
    }

    // Who are we? The token identifies the application, so this needs no config.
    const me = await discord('/oauth2/applications/@me', 'GET', botToken)
    if (!me.ok) {
      return json({ error: `Could not identify the application — ${me.status} ${me.message}` }, 502)
    }
    const appId = String((me.data as { id?: string } | null)?.id ?? '').trim()
    if (!appId) return json({ error: 'Discord did not return an application id.' }, 502)

    const put = await discord(`/applications/${appId}/guilds/${guildId}/commands`, 'PUT', botToken, wanted)
    if (!put.ok) {
      // 403 here is almost always the same thing: the bot was invited without the
      // applications.commands scope, so it can exist in the server but cannot own
      // commands there. Re-invite with that scope ticked; no code change will fix it.
      return json({
        error: `Could not register commands — ${put.status} ${put.message}`,
        hint: put.status === 403
          ? 'The bot is probably missing the applications.commands scope. Re-invite it with that scope enabled.'
          : undefined,
      }, 502)
    }

    const registered = Array.isArray(put.data)
      ? (put.data as { name?: string }[]).map((c) => `/${c.name}`)
      : []
    return json({
      ok: true,
      guild: guildId,
      registered,
      count: registered.length,
      note: clear
        ? 'Every slash command has been removed from the guild.'
        : 'Guild commands are live immediately — no propagation delay.',
    })
  } catch (e) {
    return json({ error: `Command registration failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
