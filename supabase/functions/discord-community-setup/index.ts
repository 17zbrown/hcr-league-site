// discord-community-setup — applies the league's safety + onboarding configuration
// to the Discord server. Admin-only.
//
// These are the settings buried under Server Settings → Safety Setup / Onboarding,
// the menus Discord keeps renaming and reshuffling. Everything here is reachable by
// hand; the point of the function is that it is reachable the same way twice.
//
// It is a DRY RUN unless the caller says otherwise. Send `{"dryRun": false}` to
// actually change anything; a body with no `dryRun` key (or no body at all) only
// ever computes the plan. These particular settings govern who can get into the
// server and what a newcomer can see, so an accidental call must be a no-op.
//
// Nothing is deleted. No channel, role or message is removed anywhere in this file;
// the only writes are a guild PATCH, one category's permissions, `lock_permissions`
// on that category's children, new AutoMod rules, and the onboarding document.
//
// Safe to run twice: the guild PATCH is compared before it is sent, AutoMod rules
// that already exist by name are skipped, and onboarding is a PUT (a full replace of
// a document this function is the only author of).
//
// The bot currently holds Administrator here, which is why any of this works. That
// is not treated as permanent — every call degrades to a warning naming the missing
// permission and the run carries on with whatever else it can still do.
//
// Secrets (Supabase → Edge Functions):  DISCORD_BOT_TOKEN
// Auto-provided:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// The bot needs **Manage Server** (guild settings, AutoMod, onboarding) and
// **Manage Channels** + **Manage Roles** (the PADDOCK visibility change).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DISCORD = 'https://discord.com/api/v10'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const CATEGORY = 4
// permission_overwrites.type: 0 = role, 1 = member.
const OVERWRITE_ROLE = 0
const OVERWRITE_MEMBER = 1
// Overwrite masks arrive and leave as decimal STRINGS, and the interesting bits sit
// well past 2^53, so every mask here is a BigInt. Number() would round them away.
const VIEW_CHANNEL = 1n << 10n

// Guild safety levels, spelled out because `2` twice in a PATCH body says nothing.
const VERIFICATION_MEDIUM = 2 // account must have been registered 5+ minutes
const CONTENT_FILTER_ALL_MEMBERS = 2

// AutoMod enums.
const EVENT_MESSAGE_SEND = 1
const TRIGGER_SPAM = 3
const TRIGGER_KEYWORD_PRESET = 4
const TRIGGER_MENTION_SPAM = 5
const ACTION_BLOCK_MESSAGE = 1
// KEYWORD_PRESET ids: 1 = profanity, 2 = sexual content, 3 = slurs.
const PRESETS_ALL = [1, 2, 3]

// Onboarding prompt type 0 = MULTIPLE_CHOICE; mode 0 = ONBOARDING_DEFAULT.
const PROMPT_MULTIPLE_CHOICE = 0
const ONBOARDING_DEFAULT = 0

// Only these channel types can serve as a rules / updates / onboarding target. A
// voice channel called "rules" is not the rules channel, and Discord would reject
// it further down the line with a much less obvious message.
const TEXTISH = new Set([0, 5, 15])

interface Guild {
  id: string
  name: string
  verification_level?: number | null
  explicit_content_filter?: number | null
  rules_channel_id?: string | null
  public_updates_channel_id?: string | null
  safety_alerts_channel_id?: string | null
}
interface Role {
  id: string
  name: string
  managed?: boolean
}
interface Overwrite {
  id: string
  type: number
  allow?: string | null
  deny?: string | null
}
interface Channel {
  id: string
  name: string
  type: number
  parent_id?: string | null
  position?: number | null
  permission_overwrites?: Overwrite[] | null
}
interface AutoModRule {
  id: string
  name?: string | null
  trigger_type?: number | null
}

// What has to be found before any of this can be applied. Names collide with the
// archived copies discord-rebuild leaves behind (there can be three #gravel-trap in
// a long-running server), so a channel is only ever matched INSIDE its category.
const WANTED_CHANNELS = [
  { key: 'rules', name: 'rules', category: 'START HERE' },
  { key: 'welcome', name: 'welcome', category: 'START HERE' },
  { key: 'community-updates', name: 'community-updates', category: 'ADMIN' },
  { key: 'safety-alerts', name: 'safety-alerts', category: 'ADMIN' },
  { key: 'gravel-trap', name: 'gravel-trap', category: 'PADDOCK' },
  // Not in the required set: onboarding falls back to #rules if it is missing.
  { key: 'season-signups', name: 'season-signups', category: 'LEAGUE' },
]

const PADDOCK = 'PADDOCK'

// The three class roles are interest / ping roles — holding one means "tell me about
// GTP", not "you may race". They are the only roles this function will ever put in a
// self-assign dropdown, and they are matched, never created.
const CLASS_ROLES = [
  { name: 'GTP', description: 'Top-class prototypes' },
  { name: 'LMP2', description: 'Le Mans prototypes' },
  { name: 'GTD', description: 'GT3 machinery' },
]

// The four roles that must NEVER appear in an onboarding option. League and
// Endurance membership open the private categories; Admin and Race Control open the
// site's staff portal. All four are earned or granted by a human. A self-assign
// dropdown handing any of them out would not look broken — it would silently make
// the entire gate decorative, which is worse.
const NEVER_SELF_ASSIGN = [
  { key: 'role_league_member', label: 'League Member' },
  { key: 'role_endurance_member', label: 'Endurance Member' },
  { key: 'role_site_admin', label: 'Admin' },
  { key: 'role_site_race_control', label: 'Race Control' },
]

interface OnboardingOption {
  id: string
  title: string
  // Nullable in Discord's schema, and null is what "no description" means there.
  // An empty string is a description that happens to be blank, which renders as a
  // stray gap under the option.
  description: string | null
  channel_ids: string[]
  role_ids: string[]
}
interface OnboardingPrompt {
  id: string
  type: number
  title: string
  single_select: boolean
  required: boolean
  in_onboarding: boolean
  options: OnboardingOption[]
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

// Discord nests the useful half of a 400 under `errors`, keyed by the field that
// broke, while the top-level `message` is a shrug ("Invalid Form Body"). Onboarding
// in particular rejects on constraints that are only named down there, so the
// failure text is flattened back out rather than thrown away.
function flattenErrors(node: unknown, path: string[] = [], out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out
  const rec = node as Record<string, unknown>
  const errs = rec._errors
  if (Array.isArray(errs)) {
    for (const e of errs) {
      const m = (e as { message?: string } | null)?.message
      if (m) out.push(path.length ? `${path.join('.')}: ${m}` : m)
    }
  }
  for (const [k, v] of Object.entries(rec)) {
    if (k === '_errors') continue
    flattenErrors(v, [...path, k], out)
  }
  return out
}

// Every Discord call goes through here: it never throws, it retries a rate limit,
// and it hands back Discord's own explanation of a refusal.
async function discord<T>(
  path: string,
  method: string,
  token: string,
  body?: unknown,
  attempt = 0,
): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(`${DISCORD}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    return { ok: false, status: 0, message: `Could not reach Discord (${String((e as Error)?.message ?? e)})` }
  }
  // 429 = rate limited. Back off and retry — but bounded, never forever.
  if (res.status === 429 && attempt < 3) {
    const retry = Number(res.headers.get('retry-after') ?? '1')
    await new Promise((r) => setTimeout(r, (Number.isFinite(retry) ? retry : 1) * 1000 + 250))
    return discord<T>(path, method, token, body, attempt + 1)
  }
  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch (_) { /* Discord sent something that isn't JSON */ }
  }
  if (!res.ok) {
    const err = parsed as { message?: string; errors?: unknown } | null
    const detail = err?.message
    const fields = flattenErrors(err?.errors)
    return {
      ok: false,
      status: res.status,
      message: `Discord API ${res.status}${detail ? `: ${detail}` : ''}${fields.length ? ` — ${fields.join('; ')}` : ''}`,
    }
  }
  // 204 = success with no content.
  return { ok: true, data: (parsed ?? null) as T }
}

// Masks arrive as decimal strings. Anything unparseable is treated as "no bits"
// rather than allowed to throw mid-run.
const bits = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? '0').trim() || '0')
  } catch (_) {
    return 0n
  }
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

// Discord caps how many AutoMod rules of one trigger type a guild may hold, and says
// so in a 400. That is not a failure: it means the protection is already in place
// under a name this function didn't choose, so it is recorded as skipped.
const atRuleCap = (msg: string) => /maximum number|max(imum)? .*rules|already exists|rule limit/i.test(msg)

const badToken = 'Discord rejected the bot token — check the DISCORD_BOT_TOKEN secret in Supabase.'

const RAID_PROTECTION_NOTE =
  'Raid protection is not exposed through the public Discord API, so this function cannot switch it on. ' +
  'Set it by hand: Server Settings → Safety Setup → Raids and spam → turn on "Raid protection" (and, if you ' +
  'want it, "Activity alerts"). It is the one item on this checklist that still has to be clicked.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

    // --- dry run unless told otherwise ---
    // Only a literal `false` arms this. A missing key, an empty body, a typo, a stray
    // retry: every one of those computes the plan and changes nothing. Verification
    // level and onboarding decide who reaches the server at all — the cost of an
    // accidental apply is people locked out or people let in, and neither shows up
    // in a log until someone complains.
    let dryRun = true
    try {
      const body = await req.json()
      if (body && typeof body === 'object' && (body as { dryRun?: unknown }).dryRun === false) dryRun = false
    } catch (_) { /* empty or non-JSON body — the safe default stands */ }

    // --- auth: caller must be a signed-in admin ---
    const authz = req.headers.get('Authorization') ?? ''
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } })
    const { data: userData } = await userClient.auth.getUser()
    const user = userData?.user
    if (!user) return json({ error: 'Not authenticated' }, 401)
    const { data: prof } = await userClient.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
    if (!prof?.is_admin) return json({ error: 'Admins only' }, 403)

    if (!botToken) return json({ error: 'DISCORD_BOT_TOKEN secret is not set.' }, 400)

    // --- config (service role bypasses RLS) ---
    const db = createClient(url, service)
    const { data: cfgRow } = await db.from('discord_config').select('*').eq('id', 1).maybeSingle()
    const cfg = (cfgRow ?? null) as Record<string, unknown> | null
    const configured = (key: string) => String(cfg?.[key] ?? '').trim()

    const warnings: string[] = []
    const applied: { step: string; detail: string }[] = []
    const skipped: { step: string; why: string }[] = []

    // --- 1. which server? (same handshake as setup and rebuild, so all three agree) ---
    let guildId = configured('guild_id')
    let guildName = configured('guild_name')
    // The guild's current safety settings, so step 1 can tell "changed" from
    // "already correct" instead of PATCHing the same values every run.
    let guildNow: Guild | null = null

    if (!guildId) {
      const mine = await discord<Guild[]>('/users/@me/guilds', 'GET', botToken)
      if (!mine.ok) {
        if (mine.status === 401) return json({ error: badToken }, 400)
        return json({ error: mine.message }, 502)
      }
      const guilds = (mine.data ?? []).filter((g) => g?.id).map((g) => ({ id: g.id, name: g.name }))
      if (guilds.length === 0) {
        return json(
          {
            error:
              'The bot is not in any server yet — invite it first (Discord Developer Portal → OAuth2 → URL Generator, scopes "bot" + "applications.commands"), then run community setup again.',
          },
          400,
        )
      }
      if (guilds.length > 1) {
        // More than one server is a decision, not a failure — hand the list back.
        return json({
          ok: false,
          needsGuildSelection: true,
          guilds,
          message:
            'The bot is in more than one server, so community setup stopped rather than guess. Paste the right server (guild) ID into Admin → Discord, save, then run community setup again.',
        })
      }
      guildId = guilds[0].id
      guildName = guilds[0].name
      // /users/@me/guilds is a summary and carries none of the safety fields, so the
      // full object is fetched separately. Not fatal — without it step 1 simply
      // PATCHes rather than comparing first.
      const full = await discord<Guild>(`/guilds/${guildId}`, 'GET', botToken)
      if (full.ok && full.data?.id) guildNow = full.data
    } else {
      // A guild id is already set — confirm the bot can actually see it.
      const g = await discord<Guild>(`/guilds/${guildId}`, 'GET', botToken)
      if (!g.ok) {
        if (g.status === 401) return json({ error: badToken }, 400)
        if (g.status === 403 || g.status === 404) {
          return json(
            {
              error: `The bot cannot see server ${guildId} — invite it to that server, or clear the Server (guild) ID field in Admin → Discord to auto-detect it.`,
            },
            400,
          )
        }
        return json({ error: g.message }, 502)
      }
      guildNow = g.data ?? null
      guildName = g.data?.name || guildName
    }

    // --- 2. find the channels, once ---
    // One GET for the whole server. Every later step reads from this list rather than
    // asking Discord again, so the run sees one consistent picture of the server.
    const chRes = await discord<Channel[]>(`/guilds/${guildId}/channels`, 'GET', botToken)
    if (!chRes.ok) {
      // A wall, not a warning: without the channel list every step below would be
      // guessing at ids, and a wrong id here points the rules channel at #gravel-trap.
      if (chRes.status === 403) {
        return json({ error: "Discord refused to list the server's channels — the bot needs the View Channels permission." }, 400)
      }
      return json({ error: `Could not read the server's channels — ${chRes.message}` }, 502)
    }
    const allChannels = (chRes.data ?? []).filter((c) => c?.id && typeof c.type === 'number')
    const categories = allChannels.filter((c) => c.type === CATEGORY)
    const categoryByName = new Map<string, Channel>()
    for (const c of categories) if (!categoryByName.has(norm(c.name))) categoryByName.set(norm(c.name), c)

    const resolvedChannels: Record<string, string> = {}
    const chanId = (key: string): string | null => resolvedChannels[key] ?? null

    const paddock = categoryByName.get(norm(PADDOCK)) ?? null
    if (paddock) {
      resolvedChannels[PADDOCK] = paddock.id
    } else {
      warnings.push(
        `No ${PADDOCK} category found, so the visibility step was skipped. Run the Discord server rebuild first — it is what creates ${PADDOCK}.`,
      )
    }

    for (const want of WANTED_CHANNELS) {
      const parent = categoryByName.get(norm(want.category)) ?? null
      if (!parent) {
        warnings.push(
          `No "${want.category}" category found, so #${want.name} could not be resolved. Anything that needed it was skipped rather than pointed at a guess.`,
        )
        continue
      }
      const found = allChannels.find(
        (c) => c.parent_id === parent.id && TEXTISH.has(c.type) && norm(c.name) === norm(want.name),
      )
      if (!found) {
        warnings.push(
          `No #${want.name} text channel inside "${want.category}". Anything that needed it was skipped — this function never guesses a channel id, because the wrong one here is invisible until a member trips over it.`,
        )
        continue
      }
      resolvedChannels[want.key] = found.id
    }

    // ---------------------------------------------------------------- STEP 1
    // --- guild safety ---
    // MEDIUM verification is the cheapest real filter there is: a throwaway account
    // made to spam a league server is usually less than five minutes old.
    {
      const patch: Record<string, unknown> = {
        verification_level: VERIFICATION_MEDIUM,
        explicit_content_filter: CONTENT_FILTER_ALL_MEMBERS,
      }
      const changes: string[] = []
      if (guildNow?.verification_level !== VERIFICATION_MEDIUM) changes.push('verification level → Medium')
      if (guildNow?.explicit_content_filter !== CONTENT_FILTER_ALL_MEMBERS) {
        changes.push('explicit media filter → all members')
      }

      // Only keys whose channel actually resolved. Sending `rules_channel_id: null`
      // would UNSET the rules channel, which is the opposite of doing nothing.
      const rulesId = chanId('rules')
      const updatesId = chanId('community-updates')
      const alertsId = chanId('safety-alerts')
      if (rulesId) {
        patch.rules_channel_id = rulesId
        if (guildNow?.rules_channel_id !== rulesId) changes.push('rules channel → #rules')
      }
      if (updatesId) {
        patch.public_updates_channel_id = updatesId
        if (guildNow?.public_updates_channel_id !== updatesId) changes.push('community updates → #community-updates')
      }
      if (alertsId) {
        patch.safety_alerts_channel_id = alertsId
        if (guildNow?.safety_alerts_channel_id !== alertsId) changes.push('safety alerts → #safety-alerts')
      }

      if (guildNow && changes.length === 0) {
        skipped.push({ step: 'guild safety', why: 'Already set to these values — nothing to change.' })
      } else if (dryRun) {
        applied.push({ step: 'guild safety', detail: changes.join(', ') || 'set verification and content filter' })
      } else {
        const res = await discord<Guild>(`/guilds/${guildId}`, 'PATCH', botToken, patch)
        if (!res.ok) {
          warnings.push(
            res.status === 403
              ? `Discord refused to change the server's safety settings — the bot needs the Manage Server permission (Server Settings → Roles). Verification level, the media filter and the rules/updates/alerts channels were left as they are.`
              : `Could not change the server's safety settings — ${res.message}`,
          )
          skipped.push({ step: 'guild safety', why: res.message })
        } else {
          applied.push({ step: 'guild safety', detail: changes.join(', ') || 'set verification and content filter' })
        }
      }
    }

    // ---------------------------------------------------------------- STEP 2
    // --- PADDOCK becomes public ---
    // The rebuild builds PADDOCK members-only, which is right for a league that has
    // already let you in and wrong for the front door. Onboarding needs channels
    // @everyone can see to point new arrivals at, and a server that shows a stranger
    // three channels reads as dead — they leave before anyone can grant them a role.
    // This WIDENS visibility, so it is reported as its own line rather than folded in
    // with the safety settings.
    if (paddock) {
      const current = Array.isArray(paddock.permission_overwrites) ? paddock.permission_overwrites : []
      const everyone = current.find((o) => o?.id === guildId) ?? null
      const alreadyPublic = (bits(everyone?.allow) & VIEW_CHANNEL) !== 0n && (bits(everyone?.deny) & VIEW_CHANNEL) === 0n

      // Every overwrite that isn't @everyone is copied through byte for byte. An admin
      // who hand-added a moderator, or a bot exception the rebuild left behind, keeps
      // exactly what it had — this step only ever touches one entry.
      const next: Overwrite[] = current
        .filter((o) => o?.id && o.id !== guildId)
        .map((o) => ({
          id: o.id,
          type: Number(o.type) === OVERWRITE_MEMBER ? OVERWRITE_MEMBER : OVERWRITE_ROLE,
          allow: String(bits(o.allow)),
          deny: String(bits(o.deny)),
        }))
      // @everyone's role id IS the guild id — that's why a guild id shows up in an
      // overwrite list. Only the View Channel bit moves; any other bit an admin set
      // there (no @mentions, say) is none of this function's business.
      next.push({
        id: guildId,
        type: OVERWRITE_ROLE,
        allow: String(bits(everyone?.allow) | VIEW_CHANNEL),
        deny: String(bits(everyone?.deny) & ~VIEW_CHANNEL),
      })

      const children = allChannels.filter((c) => c.type !== CATEGORY && c.parent_id === paddock.id)

      if (alreadyPublic) {
        skipped.push({ step: 'PADDOCK visibility', why: '@everyone can already see the PADDOCK category.' })
      } else if (dryRun) {
        applied.push({
          step: 'PADDOCK visibility',
          detail: `WIDENS VISIBILITY: @everyone gains View Channel on the ${PADDOCK} category, and its ${children.length} channel(s) are re-synced to inherit that. Anyone who can reach the server will be able to read them.`,
        })
      } else {
        const res = await discord<Channel>(`/channels/${paddock.id}`, 'PATCH', botToken, {
          permission_overwrites: next,
        })
        if (!res.ok) {
          warnings.push(
            res.status === 403
              ? `Discord refused to make the ${PADDOCK} category visible to @everyone — the bot needs Manage Channels and Manage Roles (Server Settings → Roles). ${PADDOCK} is still members-only, and onboarding below may fail for want of public channels.`
              : `Could not make the ${PADDOCK} category visible to @everyone — ${res.message}`,
          )
          skipped.push({ step: 'PADDOCK visibility', why: res.message })
        } else {
          applied.push({
            step: 'PADDOCK visibility',
            detail: `WIDENS VISIBILITY: @everyone can now see the ${PADDOCK} category and its channels.`,
          })
          // Children keep their own overwrites until they are told to re-sync, so a
          // public category full of privately-locked channels would look like the
          // change worked and change nothing. parent_id is sent unchanged alongside
          // it because Discord only honours lock_permissions on a PATCH that names
          // the parent.
          let synced = 0
          for (const c of children) {
            const lock = await discord<Channel>(`/channels/${c.id}`, 'PATCH', botToken, {
              parent_id: paddock.id,
              lock_permissions: true,
            })
            if (!lock.ok) {
              warnings.push(
                lock.status === 403
                  ? `Discord refused to re-sync #${c.name} with the ${PADDOCK} category — the bot needs Manage Channels. That channel keeps its old permissions and may still be hidden.`
                  : `Could not re-sync #${c.name} with the ${PADDOCK} category — ${lock.message}`,
              )
              continue
            }
            synced++
          }
          if (synced) {
            applied.push({ step: 'PADDOCK visibility', detail: `${synced} channel(s) re-synced to inherit ${PADDOCK}.` })
          }
        }
      }
    } else {
      skipped.push({ step: 'PADDOCK visibility', why: `No ${PADDOCK} category found.` })
    }

    // ---------------------------------------------------------------- STEP 3
    // --- AutoMod ---
    const WANT_RULES = [
      {
        name: 'Block spam',
        event_type: EVENT_MESSAGE_SEND,
        trigger_type: TRIGGER_SPAM,
        actions: [{ type: ACTION_BLOCK_MESSAGE }],
        enabled: true,
      },
      {
        name: 'Block mention spam',
        event_type: EVENT_MESSAGE_SEND,
        trigger_type: TRIGGER_MENTION_SPAM,
        // Five pings in one message is a raid, not a conversation. A stint plan that
        // tags four team-mates still gets through.
        trigger_metadata: { mention_total_limit: 5 },
        actions: [{ type: ACTION_BLOCK_MESSAGE }],
        enabled: true,
      },
      {
        name: 'Block flagged words',
        event_type: EVENT_MESSAGE_SEND,
        trigger_type: TRIGGER_KEYWORD_PRESET,
        trigger_metadata: { presets: PRESETS_ALL },
        actions: [{ type: ACTION_BLOCK_MESSAGE }],
        enabled: true,
      },
    ]

    const existingRules = await discord<AutoModRule[]>(`/guilds/${guildId}/auto-moderation/rules`, 'GET', botToken)
    if (!existingRules.ok) {
      // Not a wall — but posting rules blind would duplicate whatever is already
      // there, so the whole step stands down rather than make a mess.
      warnings.push(
        existingRules.status === 403
          ? 'Discord refused to list the AutoMod rules — the bot needs the Manage Server permission. No AutoMod rules were added; check Server Settings → AutoMod by hand.'
          : `Could not list the AutoMod rules — ${existingRules.message}. No AutoMod rules were added.`,
      )
      skipped.push({ step: 'automod', why: existingRules.message })
    } else {
      const haveNames = new Set((existingRules.data ?? []).map((r) => norm(r?.name)))
      for (const want of WANT_RULES) {
        if (haveNames.has(norm(want.name))) {
          skipped.push({ step: `automod: ${want.name}`, why: 'A rule with this name already exists.' })
          continue
        }
        if (dryRun) {
          applied.push({ step: `automod: ${want.name}`, detail: 'would be created' })
          continue
        }
        const made = await discord<AutoModRule>(`/guilds/${guildId}/auto-moderation/rules`, 'POST', botToken, want)
        if (!made.ok) {
          if (made.status === 400 && atRuleCap(made.message)) {
            // Discord allows only so many rules per trigger type. Hitting that ceiling
            // means the protection is already switched on under a different name —
            // reporting it as an error would send an admin looking for a fault.
            skipped.push({
              step: `automod: ${want.name}`,
              why: `Discord already has a rule of this kind (${made.message}). Nothing to add.`,
            })
            continue
          }
          warnings.push(
            made.status === 403
              ? `Discord refused to create the "${want.name}" AutoMod rule — the bot needs the Manage Server permission.`
              : `Could not create the "${want.name}" AutoMod rule — ${made.message}`,
          )
          skipped.push({ step: `automod: ${want.name}`, why: made.message })
          continue
        }
        applied.push({ step: `automod: ${want.name}`, detail: 'created' })
      }
    }

    // ---------------------------------------------------------------- STEP 4
    // --- onboarding ---
    // Runs last on purpose: Discord validates the onboarding document against what
    // @everyone can actually see, so step 2 has to have landed first.
    const rolesRes = await discord<Role[]>(`/guilds/${guildId}/roles`, 'GET', botToken)
    const classRoleIds = new Map<string, string>()
    if (!rolesRes.ok) {
      warnings.push(
        rolesRes.status === 403
          ? "Discord refused to list the server's roles — the bot needs the Manage Roles permission. The class-interest prompt was left out of onboarding."
          : `Could not read the server's roles — ${rolesRes.message}. The class-interest prompt was left out of onboarding.`,
      )
    } else {
      const matchable = (rolesRes.data ?? []).filter((r) => r?.id && r.name !== '@everyone' && !r.managed)
      for (const want of CLASS_ROLES) {
        const role = matchable.find((r) => norm(r.name) === norm(want.name)) ?? null
        if (!role) {
          warnings.push(
            `No ${want.name} role in the server, so that option was left out of the class prompt. Create a plain ${want.name} role with no permissions if you want members to be able to pick it.`,
          )
          continue
        }
        classRoleIds.set(want.name, role.id)
      }
    }

    // The guard. Every role_ids array is strained through this before it is sent, and
    // it is deliberately keyed off discord_config rather than off role names: a role
    // renamed in Discord is still the role that opens the LEAGUE category.
    const forbidden = new Map<string, string>()
    for (const r of NEVER_SELF_ASSIGN) {
      const id = configured(r.key)
      if (id) forbidden.set(id, r.label)
    }
    const safeRoleIds = (ids: string[], where: string): string[] => {
      const kept: string[] = []
      for (const id of ids) {
        const label = forbidden.get(id)
        if (label) {
          // Reaching this branch means something upstream mismatched — a class role
          // sharing an id with a gate role. Say it loudly; the drop is the easy part.
          warnings.push(
            `Refused to put the ${label} role in the onboarding option "${where}". ${label} is granted, not chosen — a dropdown that handed it out would let anyone into the gated channels. The option was sent without it.`,
          )
          continue
        }
        kept.push(id)
      }
      return kept
    }

    const welcomeId = chanId('welcome')
    const rulesId = chanId('rules')
    const gravelId = chanId('gravel-trap')
    const signupsId = chanId('season-signups')

    // Only channels that actually resolved. An id we invented would either 400 the
    // whole document or, worse, point a newcomer at the wrong room.
    const defaultChannelIds = [welcomeId, rulesId, gravelId].filter((id): id is string => !!id)

    // Prompt 1: pick as many classes as you like. Multi-select, because plenty of
    // people follow two.
    const classOptions: OnboardingOption[] = []
    let optionId = 0
    for (const want of CLASS_ROLES) {
      const roleId = classRoleIds.get(want.name)
      // An option with neither a role nor a channel is rejected by Discord and means
      // nothing to a member, so a class whose role is missing is simply left out.
      if (!roleId) continue
      const roles = safeRoleIds([roleId], want.name)
      if (roles.length === 0) continue
      classOptions.push({
        id: String(optionId++),
        title: want.name,
        description: want.description,
        channel_ids: [],
        role_ids: roles,
      })
    }

    // Prompt 2: single-select, and it grants nothing — every option only opens a door
    // the member could already walk through.
    const intentSpecs = [
      { title: 'I want to race the league', channel: signupsId ?? rulesId },
      { title: 'Just here to watch', channel: gravelId },
      { title: "I'm on the Endurance team", channel: welcomeId },
    ]
    const intentOptions: OnboardingOption[] = []
    for (const spec of intentSpecs) {
      if (!spec.channel) {
        warnings.push(
          `The onboarding option "${spec.title}" had no channel to point at, so it was left out. Onboarding rejects an option with neither a channel nor a role.`,
        )
        continue
      }
      intentOptions.push({
        id: String(optionId++),
        title: spec.title,
        description: null,
        // Always empty, and still strained through the guard: the day someone adds a
        // "gets you into the league" option here, the guard is what stops it.
        channel_ids: [spec.channel],
        role_ids: safeRoleIds([], spec.title),
      })
    }

    const prompts: OnboardingPrompt[] = []
    if (classOptions.length) {
      prompts.push({
        id: '0',
        type: PROMPT_MULTIPLE_CHOICE,
        title: 'Which class interests you?',
        single_select: false,
        required: false,
        in_onboarding: true,
        options: classOptions,
      })
    } else {
      warnings.push('The class-interest prompt was left out of onboarding: none of GTP, LMP2 or GTD resolved to a role.')
    }
    if (intentOptions.length) {
      prompts.push({
        id: '1',
        type: PROMPT_MULTIPLE_CHOICE,
        title: 'What brings you to HCR?',
        single_select: true,
        required: false,
        in_onboarding: true,
        options: intentOptions,
      })
    } else {
      warnings.push('The "what brings you here" prompt was left out of onboarding: none of its channels resolved.')
    }

    if (defaultChannelIds.length === 0) {
      skipped.push({
        step: 'onboarding',
        why: 'None of #welcome, #rules or #gravel-trap resolved, so there was nothing to show a new member. Run the Discord server rebuild first.',
      })
    } else if (prompts.length === 0) {
      skipped.push({ step: 'onboarding', why: 'Neither prompt could be built, so the onboarding document was not sent.' })
    } else if (dryRun) {
      applied.push({
        step: 'onboarding',
        detail: `enable onboarding with ${defaultChannelIds.length} default channel(s) and ${prompts.length} prompt(s): ${prompts
          .map((p) => `"${p.title}" (${p.options.length} option(s))`)
          .join(', ')}`,
      })
    } else {
      const res = await discord<unknown>(`/guilds/${guildId}/onboarding`, 'PUT', botToken, {
        enabled: true,
        mode: ONBOARDING_DEFAULT,
        default_channel_ids: defaultChannelIds,
        prompts,
      })
      if (!res.ok) {
        if (res.status === 400) {
          // Discord enforces its own rules on onboarding — a minimum number of default
          // channels @everyone can see and write in, among others — and the refusal
          // names the exact one. Passed through word for word: a paraphrase would send
          // the admin hunting through settings for a constraint nobody stated.
          warnings.push(`Discord rejected the onboarding configuration. Its exact words: ${res.message}`)
        } else {
          warnings.push(
            res.status === 403
              ? 'Discord refused to save the onboarding configuration — the bot needs the Manage Server and Manage Roles permissions. Onboarding is unchanged.'
              : `Could not save the onboarding configuration — ${res.message}`,
          )
        }
        skipped.push({ step: 'onboarding', why: res.message })
      } else {
        applied.push({
          step: 'onboarding',
          detail: `enabled with ${defaultChannelIds.length} default channel(s) and ${prompts.length} prompt(s)`,
        })
      }
    }

    // ---------------------------------------------------------------- STEP 5
    // --- report ---
    // Nothing is written back to discord_config: every id here was READ from it or
    // resolved from Discord, and this function owns none of those columns.
    return json({
      ok: true,
      dryRun,
      guild: { id: guildId, name: guildName || null },
      applied,
      skipped,
      warnings,
      resolved_channels: resolvedChannels,
      raid_protection_note: RAID_PROTECTION_NOTE,
    })
  } catch (e) {
    // Nothing above should throw, but a 500 with a readable message beats a stack trace.
    return json({ error: `Discord community setup failed — ${String((e as Error)?.message ?? e)}` }, 500)
  }
})
