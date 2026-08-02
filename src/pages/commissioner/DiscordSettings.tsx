import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Skeleton } from '../../components/ui'

interface Cfg {
  guild_id: string
  role_site_admin: string
  role_site_race_control: string
  role_bronze: string
  role_silver: string
  role_gold: string
  role_platinum: string
  channel_results: string
  channel_standings: string
  channel_license_ups: string
  enabled: boolean
  auto_sync_roles: boolean
}

const EMPTY: Cfg = {
  guild_id: '', role_site_admin: '', role_site_race_control: '',
  role_bronze: '', role_silver: '', role_gold: '', role_platinum: '',
  channel_results: '', channel_standings: '', channel_license_ups: '',
  enabled: false, auto_sync_roles: true,
}

// ── Setup report ─────────────────────────────────────────────────────────────
// discord-provision and discord-events-sync each answer with a JSON report. We
// read those reports loosely on purpose: a new field or a renamed wrapper should
// change what the panel shows, never blow up the page a commissioner is standing
// on. Anything we can't recognise is simply left out.

type ItemState = 'created' | 'found' | 'failed'

interface ReportItem {
  key: string
  label: string
  id: string | null
  state: ItemState
}

interface SetupReport {
  guildName: string | null
  guildId: string | null
  roles: ReportItem[]
  channels: ReportItem[]
  webhooks: ReportItem[]
  /** Populated only when the bot is in several servers and setup stopped to ask. */
  guilds: { id: string; name: string }[]
  warnings: string[]
  note: string | null
}

interface EventsReport {
  created: number
  updated: number
  skipped: number
  unchanged: number
  total: number | null
  /** Why each round was skipped — actionable, so it goes in the callout. */
  reasons: string[]
  note: string | null
}

/** Human names for the config keys, so the report reads like the form below. */
const ITEM_LABELS: Record<string, string> = {
  site_admin: 'Admin',
  race_control: 'Race Control',
  site_race_control: 'Race Control',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  results: 'Results',
  standings: 'Standings',
  license_ups: 'License promotions',
}

const text = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''

/** The events sync reports lists of round names, not tallies — count either. */
const count = (v: unknown): number =>
  Array.isArray(v) ? v.length : typeof v === 'number' && Number.isFinite(v) ? v : 0

const prettify = (key: string): string => {
  const bare = key.replace(/^(role|channel|webhook)_/, '')
  return (
    ITEM_LABELS[bare] ??
    bare.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  )
}

/**
 * Only ever paint a value that looks like a Discord snowflake. Webhook URLs
 * carry a secret token and must never reach the browser — this is the belt to
 * the function's braces.
 */
const snowflake = (v: unknown): string | null => {
  const s = text(v).trim()
  return /^\d{5,25}$/.test(s) ? s : null
}

const toState = (raw: Record<string, unknown>): ItemState => {
  if (raw.created === true) return 'created'
  const s = (text(raw.action) || text(raw.status) || text(raw.state) || text(raw.result)).toLowerCase()
  if (s.includes('creat') || s.includes('new')) return 'created'
  if (s.includes('fail') || s.includes('error') || s.includes('miss')) return 'failed'
  return 'found'
}

const toItem = (key: string, raw: unknown): ReportItem => {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    return {
      key,
      label: text(o.name) || text(o.label) || prettify(key),
      id: snowflake(o.id) ?? snowflake(o.role_id) ?? snowflake(o.channel_id),
      state: toState(o),
    }
  }
  // A bare id string means "here it is" with no created/found signal.
  return { key, label: prettify(key), id: snowflake(raw), state: 'found' }
}

/** Accepts either an array of entries or a `{ key: entry }` map. */
const toItems = (raw: unknown): ReportItem[] => {
  if (Array.isArray(raw)) {
    return raw.map((entry, i) => {
      const o = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
      // Webhook rows are keyed `channel_key`; roles and channels use `key`.
      const key = text(o.key) || text(o.channel_key) || text(o.name) || `item-${i}`
      return toItem(key, entry)
    })
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => toItem(k, v))
  }
  return []
}

/** Flatten warnings that may arrive as strings or as `{ message }` objects. */
const toStrings = (raw: unknown): string[] => {
  if (raw == null) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr
    .map((v) => {
      if (typeof v === 'string') return v
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        return text(o.message) || text(o.warning) || text(o.detail) || text(o.name)
      }
      return ''
    })
    .filter(Boolean)
}

/** The candidate list a function hands back when the bot is in several servers. */
const toGuilds = (raw: unknown): { id: string; name: string }[] =>
  (Array.isArray(raw) ? raw : [])
    .map((g) => {
      const o = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>
      const id = snowflake(o.id)
      return id ? { id, name: text(o.name) || 'Unnamed server' } : null
    })
    .filter((g): g is { id: string; name: string } => g !== null)

const readSetupReport = (body: Record<string, unknown>): SetupReport => {
  const guild = (body.guild && typeof body.guild === 'object' ? body.guild : {}) as Record<string, unknown>

  // Setup already spells out each missing staff role in `warnings`, so the
  // key list is only a fallback for when nothing readable came through.
  const warnings = toStrings(body.warnings)
  if (warnings.length === 0) {
    for (const key of toStrings(body.missing_staff_roles ?? body.missing_roles ?? body.missing)) {
      warnings.push(`No ${prettify(key)} role found — make it in Discord, then paste its ID below.`)
    }
  }

  // "The bot is in several servers" is a question, not a result: put the ask in
  // the callout and list the candidates so an ID can be copied straight across.
  const choosing = body.needsGuildSelection === true
  const message = text(body.message)
  if (choosing && message) warnings.unshift(message)

  const guilds = toGuilds(body.guilds)

  return {
    guildName: text(body.guild_name) || text(guild.name) || null,
    guildId: snowflake(body.guild_id) ?? snowflake(guild.id),
    roles: toItems(body.roles),
    channels: toItems(body.channels),
    webhooks: toItems(body.webhooks),
    guilds,
    warnings: Array.from(new Set(warnings)),
    note: typeof body.skipped === 'string' ? body.skipped : choosing ? null : message || null,
  }
}

const readEventsReport = (body: Record<string, unknown>): EventsReport => {
  const counts = (body.counts && typeof body.counts === 'object' ? body.counts : body) as Record<string, unknown>
  const skipped = Array.isArray(counts.skipped) ? counts.skipped : []
  return {
    created: count(counts.created),
    updated: count(counts.updated),
    skipped: count(counts.skipped),
    unchanged: count(counts.unchanged),
    total: typeof body.total_upcoming === 'number' ? body.total_upcoming : null,
    reasons: skipped
      .map((s) => {
        if (typeof s === 'string') return s
        const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
        const name = text(o.name)
        const reason = text(o.reason)
        return name && reason ? `${name} — ${reason}` : reason || name
      })
      .filter(Boolean),
    // A guard clause answers 200 with a plain `{ skipped: "…" }` string.
    note: typeof body.skipped === 'string' ? body.skipped : text(body.message) || null,
  }
}

// ── Server scan ──────────────────────────────────────────────────────────────
// discord-audit is the read-only sibling of setup: it looks at the server and
// reports what's there, touching nothing. Same loose reading as above — we show
// what we recognise and quietly drop the rest.

interface AuditRole {
  id: string | null
  name: string
  /** null when the scan couldn't count — that must not read as zero. */
  members: number | null
  staff: boolean
}

interface AuditChannel {
  id: string | null
  name: string
  /** Raw instant; formatted at render. null when Discord never said. */
  last: string | null
  quiet: boolean
}

interface AuditGroup {
  key: string
  name: string
  channels: AuditChannel[]
}

interface AuditReport {
  guildName: string | null
  guildId: string | null
  members: number | null
  roles: AuditRole[]
  groups: AuditGroup[]
  /** Populated only when the bot is in several servers and the scan stopped to ask. */
  guilds: { id: string; name: string }[]
  notes: string[]
  choosing: boolean
}

/**
 * A count we may not have been given — unlike `count` above, absent stays
 * absent rather than collapsing to a zero the scan never claimed.
 */
const num = (v: unknown): number | null => {
  if (Array.isArray(v)) return v.length
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  const s = text(v).trim()
  return /^\d+$/.test(s) ? Number(s) : null
}

/** Discord's own ordering, so the lists read like the server's own sidebar. */
const pos = (raw: unknown): number => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return num(o.position) ?? 0
}

const QUIET_DAYS = 60

/** "Quiet" is a judgement about a date, so make it once at read time. */
const isQuiet = (iso: string | null): boolean => {
  if (!iso) return false // "no activity" already says it, and may just mean unknown
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && Date.now() - t > QUIET_DAYS * 86_400_000
}

const toAuditChannel = (raw: unknown): AuditChannel | null => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = text(o.name)
  if (!name) return null
  // Discord type 4 is a category, not a channel — it heads a group, it isn't in one.
  if (o.type === 4 || o.is_category === true) return null
  const last =
    text(o.last_active_at) ||
    text(o.last_activity_at) ||
    text(o.last_activity) ||
    text(o.last_message_at) ||
    null
  return {
    id: snowflake(o.id),
    name,
    last: last ? last.trim() : null,
    quiet: o.quiet === true || o.stale === true || isQuiet(last),
  }
}

const readAuditReport = (body: Record<string, unknown>): AuditReport => {
  const guild = (body.guild && typeof body.guild === 'object' ? body.guild : {}) as Record<string, unknown>

  const roles = (Array.isArray(body.roles) ? [...body.roles] : [])
    // Highest role first, the way Server Settings → Roles stacks them.
    .sort((a, b) => pos(b) - pos(a))
    .map((raw) => {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const name = text(o.name)
      if (!name) return null
      return {
        id: snowflake(o.id),
        name,
        members: num(o.member_count ?? o.members ?? o.count),
        staff: o.is_staffish === true || o.staffish === true || o.is_staff === true,
      }
    })
    .filter((r): r is AuditRole => r !== null)

  // Channels are grouped the way Discord's sidebar groups them.
  const groups: AuditGroup[] = []
  const byKey = new Map<string, AuditGroup>()
  const groupFor = (key: string, name: string): AuditGroup => {
    const found = byKey.get(key)
    if (found) return found
    const made: AuditGroup = { key, name, channels: [] }
    byKey.set(key, made)
    groups.push(made)
    return made
  }
  // A channel listed under its category AND in the flat list is still one channel.
  const seen = new Set<string>()
  const place = (key: string, groupName: string, raw: unknown) => {
    const ch = toAuditChannel(raw)
    if (!ch) return
    const tag = ch.id ?? `${key}/${ch.name.toLowerCase()}`
    if (seen.has(tag)) return
    seen.add(tag)
    groupFor(key, groupName).channels.push(ch)
  }

  // Seed the categories first so the list reads in the server's own order;
  // empty ones drop out below.
  for (const raw of (Array.isArray(body.categories) ? [...body.categories] : []).sort((a, b) => pos(a) - pos(b))) {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const key = snowflake(o.id) ?? text(o.name)
    if (!key) continue
    const name = text(o.name) || 'Category'
    groupFor(key, name)
    // Some reports nest the channels under their category instead of listing
    // them flat — take either shape.
    for (const child of (Array.isArray(o.channels) ? [...o.channels] : []).sort((a, b) => pos(a) - pos(b))) {
      place(key, name, child)
    }
  }

  // Sorted before grouping, so each category lists its channels in server order.
  for (const raw of (Array.isArray(body.channels) ? [...body.channels] : []).sort((a, b) => pos(a) - pos(b))) {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const parentId =
      snowflake(o.parent_id) ?? snowflake(o.category_id) ?? snowflake(o.parent) ?? snowflake(o.category)
    // A category may arrive as a name rather than an id — group on that instead.
    const parentName =
      text(o.category_name) || text(o.parent_name) || (parentId ? '' : text(o.category) || text(o.parent))
    const key = parentId ?? parentName
    place(key, key ? parentName || 'Category' : 'No category', raw)
  }

  // "The bot is in several servers" is a question, not a result — same handling
  // as setup: the ask goes in the callout with the candidates under it.
  const choosing = body.needsGuildSelection === true
  const message = text(body.message)
  const notes = toStrings(body.notes)
  // The guild question leads the callout; a plain remark reads fine after the
  // scan's own notes.
  if (message) {
    if (choosing) notes.unshift(message)
    else notes.push(message)
  }

  return {
    guildName: text(body.guild_name) || text(guild.name) || null,
    guildId: snowflake(body.guild_id) ?? snowflake(guild.id),
    members: num(
      guild.member_count ?? guild.approximate_member_count ?? body.member_count ?? body.approximate_member_count,
    ),
    roles,
    groups: groups.filter((g) => g.channels.length > 0),
    guilds: toGuilds(body.guilds),
    notes: Array.from(new Set(notes)),
    choosing,
  }
}

// ── Rebuild plan ─────────────────────────────────────────────────────────────
// discord-rebuild answers with the same shape whether it's rehearsing or doing:
// the categories it wants, the roles that gate each one, the channels beneath
// them, and how many existing channels get moved into ARCHIVE. Read as loosely
// as everything above — a plan a commissioner can't read is worse than no plan.

/** null = the function gave no signal, so no chip is painted at all. */
type PlanState = 'new' | 'exists' | 'failed'

interface PlanChannel {
  key: string
  name: string
  id: string | null
  state: PlanState | null
}

interface PlanCategory {
  key: string
  name: string
  id: string | null
  state: PlanState | null
  /** Role ids or names, whichever the function reported — named at render. */
  roles: string[]
  channels: PlanChannel[]
}

interface RebuildReport {
  /** What actually happened, not what we asked for — see readRebuildReport. */
  dryRun: boolean
  guildName: string | null
  guildId: string | null
  categories: PlanCategory[]
  /** Channels the plan lists outside any category. */
  loose: PlanChannel[]
  /** null when the function never said — that must not read as zero. */
  archive: number | null
  archiveName: string | null
  warnings: string[]
  note: string | null
}

const toPlanState = (raw: Record<string, unknown>): PlanState | null => {
  if (raw.created === true || raw.will_create === true) return 'new'
  const s = (
    text(raw.action) ||
    text(raw.status) ||
    text(raw.state) ||
    text(raw.plan) ||
    text(raw.result)
  ).toLowerCase()
  if (s.includes('fail') || s.includes('error')) return 'failed'
  if (s.includes('creat') || s.includes('new') || s.includes('add')) return 'new'
  if (s.includes('exist') || s.includes('found') || s.includes('keep') || s.includes('kept') || s.includes('reus'))
    return 'exists'
  if (raw.created === false || raw.will_create === false) return 'exists'
  return null
}

const toPlanChannel = (raw: unknown, i: number): PlanChannel | null => {
  if (typeof raw === 'string') {
    const name = raw.trim()
    return name ? { key: `channel-${i}`, name, id: null, state: null } : null
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = text(o.name) || text(o.channel) || text(o.label) || prettify(text(o.key))
  if (!name) return null
  return {
    key: text(o.key) || text(o.channel_key) || snowflake(o.id) || `${name}-${i}`,
    name,
    id: snowflake(o.id) ?? snowflake(o.channel_id),
    state: toPlanState(o),
  }
}

const toPlanChannels = (raw: unknown): PlanChannel[] =>
  (Array.isArray(raw) ? raw : [])
    .map((entry, i) => toPlanChannel(entry, i))
    .filter((c): c is PlanChannel => c !== null)

/** A gate may arrive as a role id, a role name, or `{ id, name }` — take any. */
const toRoleRefs = (raw: unknown): string[] => {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  return arr
    .map((v) => {
      if (typeof v === 'string') return v.trim()
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        return text(o.name) || text(o.role) || text(o.key) || text(o.id)
      }
      return ''
    })
    .filter(Boolean)
}

const toPlanCategory = (key: string, raw: unknown, i: number): PlanCategory | null => {
  // A category may arrive as nothing but its list of channels.
  if (Array.isArray(raw)) {
    const name = prettify(key)
    return name
      ? { key: key || `category-${i}`, name, id: null, state: null, roles: [], channels: toPlanChannels(raw) }
      : null
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = text(o.name) || text(o.category) || text(o.label) || prettify(key)
  if (!name) return null
  return {
    key: key || `category-${i}`,
    name,
    id: snowflake(o.id) ?? snowflake(o.category_id),
    state: toPlanState(o),
    roles: toRoleRefs(o.roles ?? o.gated_by ?? o.visible_to ?? o.allow ?? o.role_keys),
    channels: toPlanChannels(o.channels ?? o.children),
  }
}

/** Accepts either an array of categories or a `{ key: category }` map. */
const toPlanCategories = (raw: unknown): PlanCategory[] => {
  if (Array.isArray(raw)) {
    return raw
      .map((entry, i) => {
        const o = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
        return toPlanCategory(text(o.key) || text(o.category_key) || text(o.name), entry, i)
      })
      .filter((c): c is PlanCategory => c !== null)
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([k, v], i) => toPlanCategory(k, v, i))
      .filter((c): c is PlanCategory => c !== null)
  }
  return []
}

const readRebuildReport = (body: Record<string, unknown>, asked: boolean): RebuildReport => {
  // The plan may sit at the top level or be wrapped in `plan: { … }`; flatten
  // the wrapper over the envelope so the reads below only have one shape to know.
  const wrapper =
    body.plan && typeof body.plan === 'object' && !Array.isArray(body.plan)
      ? (body.plan as Record<string, unknown>)
      : {}
  const src: Record<string, unknown> = { ...body, ...wrapper }

  const guild = (src.guild && typeof src.guild === 'object' ? src.guild : {}) as Record<string, unknown>
  const archive = (src.archive && typeof src.archive === 'object' ? src.archive : {}) as Record<string, unknown>

  // Believe the function over the button: if it says it only rehearsed, this
  // report is a rehearsal even though we asked for the real thing.
  const said = src.dry_run ?? src.dryRun
  const dryRun = typeof said === 'boolean' ? said : asked

  const warnings = toStrings(src.warnings)
  // Only add a missing role the prose hasn't already named, so the callout never
  // says the same thing twice in two voices.
  for (const key of toStrings(src.missing_roles ?? src.missing_staff_roles ?? src.missing)) {
    const label = prettify(key)
    if (!label || warnings.some((w) => w.toLowerCase().includes(label.toLowerCase()))) continue
    warnings.push(`No ${label} role found — make it in Discord, then run setup so its ID is saved.`)
  }

  return {
    dryRun,
    guildName: text(src.guild_name) || text(guild.name) || null,
    guildId: snowflake(src.guild_id) ?? snowflake(guild.id),
    categories: toPlanCategories(
      src.categories ?? (Array.isArray(body.plan) ? body.plan : null) ?? src.tree,
    ),
    loose: toPlanChannels(src.channels),
    archive: num(
      archive.moved ??
        archive.count ??
        archive.channels ??
        src.archived ??
        src.archived_channels ??
        src.archive_count ??
        src.moved ??
        src.to_archive,
    ),
    archiveName: text(archive.name) || text(src.archive_name) || null,
    warnings: Array.from(new Set(warnings)),
    note: typeof src.skipped === 'string' ? src.skipped : text(src.message) || null,
  }
}

// ── Role reconcile ───────────────────────────────────────────────────────────
// discord-role-reconcile walks the members it knows about and puts each one's
// Discord roles back in step with their license. It reports how many it looked
// at, how many it touched, and who — that last list is the interesting one.

interface RoleChange {
  key: string
  name: string
  /** "+ Gold · − Silver", or whatever the function could tell us. */
  detail: string
}

interface ReconcileReport {
  checked: number | null
  changed: number | null
  members: RoleChange[]
  warnings: string[]
  note: string | null
}

const toRoleChange = (raw: unknown, i: number): RoleChange | null => {
  if (typeof raw === 'string') {
    const s = raw.trim()
    return s ? { key: `member-${i}`, name: s, detail: '' } : null
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name =
    text(o.username) ||
    text(o.discord_username) ||
    text(o.display_name) ||
    text(o.name) ||
    text(o.driver) ||
    text(o.member) ||
    snowflake(o.discord_user_id) ||
    snowflake(o.user_id) ||
    snowflake(o.id) ||
    ''
  if (!name) return null

  const parts: string[] = []
  for (const r of toStrings(o.added ?? o.added_roles ?? o.granted)) parts.push(`+ ${r}`)
  for (const r of toStrings(o.removed ?? o.removed_roles ?? o.revoked)) parts.push(`− ${r}`)
  if (parts.length === 0) {
    const from = text(o.from) || text(o.was) || text(o.old_role)
    const to = text(o.to) || text(o.now) || text(o.new_role) || text(o.role) || text(o.license)
    if (to) parts.push(from ? `${from} → ${to}` : to)
  }

  return {
    key: snowflake(o.discord_user_id) ?? snowflake(o.user_id) ?? snowflake(o.id) ?? `${name}-${i}`,
    name,
    detail: parts.join(' · ') || text(o.change) || text(o.reason) || text(o.note),
  }
}

const readReconcileReport = (body: Record<string, unknown>): ReconcileReport => {
  const counts = (body.counts && typeof body.counts === 'object' ? body.counts : body) as Record<string, unknown>

  // The roster of who moved may sit under any of these; only an array is a list.
  const listed = [body.changes, counts.changed, body.changed, body.members, body.updated].find((v) =>
    Array.isArray(v),
  )
  const members = (Array.isArray(listed) ? listed : [])
    .map((entry, i) => toRoleChange(entry, i))
    .filter((m): m is RoleChange => m !== null)

  const changed = num(counts.changed ?? counts.updated ?? counts.synced)

  return {
    checked: num(counts.checked ?? counts.scanned ?? counts.considered ?? counts.total),
    // A tally we were never given still shows if the list itself came through.
    changed: changed ?? (members.length > 0 ? members.length : null),
    members,
    warnings: Array.from(new Set(toStrings(body.warnings))),
    note: typeof body.skipped === 'string' ? body.skipped : text(body.message) || null,
  }
}

// ── Driver linking ───────────────────────────────────────────────────────────
// discord-link-drivers matches the roster to Discord accounts by name and hands
// the League Member role to anyone who has actually raced. It only ever adds, so
// the interesting half of its report is who it deliberately left alone: a driver
// two Discord accounts could plausibly be gets no guess at all.

interface LinkedDriver {
  key: string
  driver: string
  /** The Discord side — a handle where we were given one, else the bare id. */
  label: string
}

interface AmbiguousDriver {
  key: string
  driver: string
  candidates: string[]
}

interface LinkReport {
  considered: number | null
  linked: LinkedDriver[]
  /** Tallies, which may arrive without the list behind them. */
  linkedCount: number | null
  granted: string[]
  grantedCount: number | null
  alreadyLinked: number | null
  ambiguous: AmbiguousDriver[]
  warnings: string[]
  note: string | null
}

/** The roster side of a row: whatever the function called the driver. */
const driverName = (o: Record<string, unknown>): string =>
  text(o.driver_name) || text(o.driver) || text(o.roster_name) || text(o.name)

/**
 * The Discord side. A name a commissioner can recognise beats a snowflake, but a
 * snowflake beats nothing — an id can at least be looked up in the server.
 */
const discordLabel = (o: Record<string, unknown>): string =>
  text(o.discord_label) ||
  text(o.discord_username) ||
  text(o.username) ||
  text(o.global_name) ||
  text(o.display_name) ||
  text(o.label) ||
  text(o.nick) ||
  snowflake(o.discord_user_id) ||
  snowflake(o.user_id) ||
  snowflake(o.id) ||
  ''

const toLinked = (raw: unknown, i: number): LinkedDriver | null => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const driver = driverName(o)
  if (!driver) return null
  return {
    key: text(o.driver_id) || snowflake(o.discord_user_id) || `${driver}-${i}`,
    driver,
    label: discordLabel(o),
  }
}

/** The grant list names people, so a bare string is the shape to expect. */
const toGrantedNames = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : [])
    .map((v) => {
      if (typeof v === 'string') return v.trim()
      const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
      return driverName(o) || discordLabel(o)
    })
    .filter(Boolean)

/** A candidate is a Discord account the function could have picked, and didn't. */
const toCandidates = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
    .map((v) => {
      if (typeof v === 'string') return v.trim()
      const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
      return discordLabel(o)
    })
    .filter(Boolean)

const toAmbiguous = (raw: unknown, i: number): AmbiguousDriver | null => {
  if (typeof raw === 'string') {
    const s = raw.trim()
    return s ? { key: `ambiguous-${i}`, driver: s, candidates: [] } : null
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const driver = driverName(o)
  if (!driver) return null
  return {
    key: text(o.driver_id) || `${driver}-${i}`,
    driver,
    candidates: toCandidates(o.candidates ?? o.matches ?? o.options ?? o.possible),
  }
}

const readLinkReport = (body: Record<string, unknown>): LinkReport => {
  const counts = (body.counts && typeof body.counts === 'object' ? body.counts : body) as Record<string, unknown>

  const listed = (a: unknown, b: unknown): unknown[] =>
    Array.isArray(a) ? a : Array.isArray(b) ? b : []

  const linked = listed(body.linked, counts.linked)
    .map((entry, i) => toLinked(entry, i))
    .filter((l): l is LinkedDriver => l !== null)

  const granted = toGrantedNames(
    [body.granted, body.granted_league_member, body.granted_member, body.roles_granted, counts.granted].find((v) =>
      Array.isArray(v),
    ),
  )

  const ambiguous = listed(body.ambiguous, counts.ambiguous)
    .map((entry, i) => toAmbiguous(entry, i))
    .filter((a): a is AmbiguousDriver => a !== null)

  const linkedCount = num(counts.linked)
  const grantedCount = num(counts.granted ?? counts.granted_league_member ?? counts.roles_granted)

  return {
    considered: num(counts.considered ?? counts.checked ?? counts.scanned ?? counts.drivers ?? counts.total),
    linked,
    // A tally we were never given still shows if the list itself came through.
    linkedCount: linkedCount ?? (linked.length > 0 ? linked.length : null),
    granted,
    grantedCount: grantedCount ?? (granted.length > 0 ? granted.length : null),
    alreadyLinked: num(counts.already_linked ?? counts.alreadyLinked ?? counts.already),
    ambiguous,
    warnings: Array.from(new Set(toStrings(body.warnings))),
    note: typeof body.skipped === 'string' ? body.skipped : text(body.message) || null,
  }
}

// ── Inactive members ─────────────────────────────────────────────────────────
// discord-prune-pending removes people who joined the Discord and never came
// back to finish onboarding. It reports the same rows it writes to
// discord_prune_log, so each row names its own outcome. Read as loosely as
// everything above, with one rule the other readers don't need: a row we can
// only half-read still stays on the list. Dropping it would quietly shrink a
// count of people about to be removed, and that is the one number on this page
// that must never be too small.

type PruneOutcome = 'kicked' | 'would_kick' | 'failed' | 'spared'

interface PruneRow {
  key: string
  label: string
  /** Raw instant; formatted at render. null when the function never said. */
  joined: string | null
  /** May arrive fractional — whole days are what a commissioner reads. */
  days: number | null
  outcome: PruneOutcome | null
  detail: string
}

interface PruneReport {
  /** What actually happened, not what we asked for — same rule as the rebuild. */
  dryRun: boolean
  candidates: PruneRow[]
  kicked: PruneRow[]
  spared: PruneRow[]
  failed: PruneRow[]
  /** How many are overdue. May arrive as a tally with no list behind it. */
  dueCount: number | null
  /** More people matched than prune_pending_max_per_run allows in one run. */
  capped: boolean
  overCap: number | null
  warnings: string[]
  note: string | null
}

/** Unlike `num`, a fractional day count keeps its fraction until render. */
const dayCount = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = text(v).trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** "would_kick" contains "kick", so the rehearsal is tested for first. */
const toPruneOutcome = (o: Record<string, unknown>): PruneOutcome | null => {
  const s = (text(o.outcome) || text(o.result) || text(o.status) || text(o.action)).toLowerCase()
  if (!s) return null
  if (s.includes('would') || s.includes('due') || s.includes('pending')) return 'would_kick'
  if (s.includes('fail') || s.includes('error') || s.includes('refus')) return 'failed'
  if (s.includes('spare') || s.includes('skip') || s.includes('kept') || s.includes('keep')) return 'spared'
  if (s.includes('kick') || s.includes('remov')) return 'kicked'
  return null
}

const toPruneRow = (raw: unknown, i: number): PruneRow | null => {
  if (typeof raw === 'string') {
    const s = raw.trim()
    return s ? { key: `member-${i}`, label: s, joined: null, days: null, outcome: null, detail: '' } : null
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const label = discordLabel(o)
  const joined = (text(o.joined_at) || text(o.joinedAt) || text(o.joined)).trim()
  const days = dayCount(o.days_pending ?? o.daysPending ?? o.days ?? o.pending_days)
  // Nothing readable at all is noise. Anything readable is a person.
  if (!label && !joined && days === null) return null
  return {
    key:
      snowflake(o.discord_user_id) ??
      snowflake(o.user_id) ??
      snowflake(o.id) ??
      `${label || 'member'}-${i}`,
    label: label || 'Unnamed member',
    joined: joined || null,
    days,
    outcome: toPruneOutcome(o),
    detail: text(o.detail) || text(o.reason) || text(o.message) || text(o.error),
  }
}

const toPruneRows = (raw: unknown): PruneRow[] =>
  (Array.isArray(raw) ? raw : [])
    .map((entry, i) => toPruneRow(entry, i))
    .filter((r): r is PruneRow => r !== null)

const readPruneReport = (body: Record<string, unknown>, asked: boolean): PruneReport => {
  const counts = (body.counts && typeof body.counts === 'object' ? body.counts : body) as Record<string, unknown>

  // Believe the function over the button, exactly as the rebuild does: if it
  // says it only rehearsed then nobody left the server, whatever we asked for.
  const said = body.dry_run ?? body.dryRun
  const dryRun = typeof said === 'boolean' ? said : asked

  // Rows may arrive sorted into buckets, or as one flat list where each row
  // names its own outcome. Prefer the buckets and fall back to the flat list, so
  // a function that sends both shapes never counts the same person twice.
  const buckets: [unknown, PruneOutcome][] = [
    [body.kicked ?? body.removed, 'kicked'],
    [body.would_kick ?? body.wouldKick ?? body.candidates ?? body.pending, 'would_kick'],
    [body.spared ?? body.skipped_members, 'spared'],
    [body.failed ?? body.errors, 'failed'],
  ]
  const bucketed = buckets.flatMap(([raw, outcome]) =>
    toPruneRows(raw).map((r) => ({ ...r, outcome: r.outcome ?? outcome })),
  )
  const rows =
    bucketed.length > 0
      ? bucketed
      : toPruneRows([body.results, body.rows, body.members, body.log, body.entries].find((v) => Array.isArray(v)))

  const of = (outcome: PruneOutcome): PruneRow[] => rows.filter((r) => r.outcome === outcome)
  // A row that never said what happened to it. Which list it belongs on depends
  // entirely on whether this run was real.
  const unsaid = rows.filter((r) => r.outcome === null)

  // A rehearsal removed nobody, so every row it lists is only a candidate — even
  // one labelled "kicked". A real run reports the people it acted on, so a row
  // that says nothing is counted as removed: naming someone who went is
  // recoverable, losing them off the list is not.
  const candidates = dryRun ? [...of('would_kick'), ...of('kicked'), ...unsaid] : of('would_kick')
  const kicked = dryRun ? [] : [...of('kicked'), ...unsaid]

  const overCap = num(
    body.over_cap_count ?? body.overCapCount ?? counts.over_cap_count ?? counts.overCapCount ?? counts.over_cap,
  )

  return {
    dryRun,
    candidates,
    kicked,
    spared: of('spared'),
    failed: of('failed'),
    // A tally we were never given still shows if the list itself came through.
    dueCount:
      num(counts.would_kick ?? counts.wouldKick ?? counts.candidates ?? counts.due ?? counts.overdue) ??
      (candidates.length > 0 ? candidates.length : null),
    capped:
      body.capped === true ||
      counts.capped === true ||
      body.hit_cap === true ||
      (overCap !== null && overCap > 0),
    overCap,
    warnings: Array.from(new Set(toStrings(body.warnings))),
    note: typeof body.skipped === 'string' ? body.skipped : text(body.message) || null,
  }
}

// ── Safety & onboarding ──────────────────────────────────────────────────────
// discord-community-setup turns on the settings that live several screens deep
// in Discord's own Server Settings: verification, the content filter, the
// community channels, AutoMod, who can see PADDOCK, and the onboarding
// questions. It reports each one as its own row, so a run where the bot lost a
// permission halfway still says exactly which settings landed and which didn't.
// Read as loosely as everything above.

type CommunityOutcome = 'applied' | 'skipped' | 'failed'

interface CommunityStep {
  key: string
  label: string
  /** The value it set, or why it didn't — whichever the function gave us. */
  detail: string
  outcome: CommunityOutcome
}

interface CommunityReport {
  /** What actually happened, not what we asked for — same rule as the rebuild. */
  dryRun: boolean
  applied: CommunityStep[]
  skipped: CommunityStep[]
  failed: CommunityStep[]
  /** The one toggle no bot can flick, so it gets its own callout. */
  raidNote: string | null
  warnings: string[]
  note: string | null
}

/** "would apply" is still an apply — the tense lives on the chip, not here. */
const toCommunityOutcome = (o: Record<string, unknown>): CommunityOutcome | null => {
  if (o.applied === true) return 'applied'
  if (o.applied === false) return 'skipped'
  const s = (
    text(o.outcome) ||
    text(o.status) ||
    text(o.result) ||
    text(o.action) ||
    text(o.state)
  ).toLowerCase()
  if (!s) return null
  if (s.includes('fail') || s.includes('error') || s.includes('refus') || s.includes('forbidden'))
    return 'failed'
  if (s.includes('skip') || s.includes('unchanged') || s.includes('already') || s.includes('kept'))
    return 'skipped'
  if (s.includes('appl') || s.includes('set') || s.includes('creat') || s.includes('updat') || s.includes('would'))
    return 'applied'
  return null
}

const toCommunityStep = (raw: unknown, i: number, fallback: CommunityOutcome): CommunityStep | null => {
  if (typeof raw === 'string') {
    const s = raw.trim()
    return s ? { key: `step-${i}`, label: s, detail: '', outcome: fallback } : null
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const label =
    text(o.label) || text(o.name) || text(o.setting) || text(o.step) || prettify(text(o.key))
  if (!label) return null
  return {
    key: text(o.key) || text(o.setting) || `${label}-${i}`,
    label,
    detail:
      text(o.detail) ||
      text(o.value) ||
      text(o.reason) ||
      text(o.message) ||
      text(o.note) ||
      text(o.error),
    outcome: toCommunityOutcome(o) ?? fallback,
  }
}

const toCommunitySteps = (raw: unknown, fallback: CommunityOutcome): CommunityStep[] =>
  (Array.isArray(raw) ? raw : [])
    .map((entry, i) => toCommunityStep(entry, i, fallback))
    .filter((s): s is CommunityStep => s !== null)

const readCommunityReport = (body: Record<string, unknown>, asked: boolean): CommunityReport => {
  // Believe the function over the button, exactly as the rebuild does.
  const said = body.dry_run ?? body.dryRun
  const dryRun = typeof said === 'boolean' ? said : asked

  // Rows may arrive sorted into buckets or as one flat list where each row names
  // its own outcome. Prefer the buckets and fall back to the flat list, so a
  // function that sends both shapes never lists the same setting twice.
  const buckets: [unknown, CommunityOutcome][] = [
    [body.applied ?? body.would_apply ?? body.wouldApply ?? body.changes, 'applied'],
    [body.skipped ?? body.unchanged ?? body.left_alone, 'skipped'],
    [body.failed ?? body.errors, 'failed'],
  ]
  const bucketed = buckets.flatMap(([raw, outcome]) => toCommunitySteps(raw, outcome))
  // A flat row that never said what happened to it is counted as applied: these
  // are settings, not people, and a genuine refusal lands in `warnings` anyway.
  const steps =
    bucketed.length > 0
      ? bucketed
      : toCommunitySteps(
          [body.steps, body.settings, body.results, body.items].find((v) => Array.isArray(v)),
          'applied',
        )

  const of = (outcome: CommunityOutcome): CommunityStep[] => steps.filter((s) => s.outcome === outcome)

  const raid = (body.raid_protection && typeof body.raid_protection === 'object'
    ? body.raid_protection
    : {}) as Record<string, unknown>

  return {
    dryRun,
    applied: of('applied'),
    skipped: of('skipped'),
    failed: of('failed'),
    raidNote:
      text(body.raid_protection_note) ||
      text(body.raidProtectionNote) ||
      text(body.raid_note) ||
      text(raid.note) ||
      null,
    warnings: Array.from(new Set(toStrings(body.warnings))),
    note: typeof body.skipped === 'string' ? body.skipped : text(body.message) || null,
  }
}

/**
 * `functions.invoke` swallows the response body on a non-2xx and hands back a
 * bare "Edge Function returned a non-2xx status code" — useless to a
 * commissioner. Dig the `{ error }` our functions actually send out of the
 * Response it stashes on the error, and treat a 200 that carries `{ error }`
 * the same way.
 */
async function invokeFn(
  name: string,
  payload?: Record<string, unknown>,
): Promise<{ body: Record<string, unknown> | null; error: string | null }> {
  try {
    const res = await supabase.functions.invoke<Record<string, unknown>>(
      name,
      payload ? { body: payload } : undefined,
    )
    if (res.error) {
      const ctx = (res.error as unknown as { context?: unknown }).context
      if (ctx instanceof Response) {
        let raw = ''
        try {
          raw = await ctx.text()
        } catch { /* body already consumed — fall through to the generic message */ }
        if (raw.trim()) {
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>
            const msg = text(parsed.error) || text(parsed.message)
            if (msg) return { body: null, error: msg }
          } catch {
            return { body: null, error: raw.trim().slice(0, 300) }
          }
        }
      }
      return { body: null, error: res.error.message || 'The function could not be reached.' }
    }
    const body = (res.data ?? {}) as Record<string, unknown>
    const inline = text(body.error)
    if (inline) return { body: null, error: inline }
    return { body, error: null }
  } catch (e) {
    return { body: null, error: (e as Error)?.message || 'The function could not be reached.' }
  }
}

/** `provisioned_at` is a real instant, not a calendar day — format it locally. */
const fmtStamp = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The last thing standing between a click and a reshaped server, so it says
 * plainly what happens — including the part that matters most: nothing is
 * deleted, and the old channels are still there afterwards.
 */
const REBUILD_CONFIRM = [
  'Run the rebuild?',
  '',
  "This creates the league's new categories and channels, then MOVES every channel that exists today into a hidden ARCHIVE category.",
  '',
  'Nothing is deleted. No messages are lost. The archived channels stay exactly as they are, out of sight of members, and you can delete them by hand later if you want to.',
].join('\n')

/** Days pending may arrive fractional; a commissioner reads whole days. */
const fmtDays = (n: number): string => {
  const d = Math.max(0, Math.floor(n))
  return `${d} day${d === 1 ? '' : 's'}`
}

/**
 * Both prune numbers are bounded in the database. Clamp before sending and show
 * the clamped value back, so the box on screen never disagrees with the rule the
 * automation will actually follow.
 */
const clampInt = (raw: string, lo: number, hi: number, fallback: number): number => {
  const n = raw.trim() === '' ? NaN : Math.trunc(Number(raw))
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

/**
 * The last thing standing between a click and people losing their place in the
 * server. It names the count, and it says the thing a commissioner most needs to
 * hear before agreeing: this is a kick, and a kick is undoable by invitation.
 */
const pruneConfirm = (n: number): string =>
  [
    `Remove ${n} ${n === 1 ? 'person' : 'people'} from the Discord?`,
    '',
    'They joined the server and never finished onboarding. This kicks them out — it is not a ban. Nothing is deleted, and anyone removed can rejoin with a new invite.',
    '',
    'Only the people listed in the preview will be removed.',
  ].join('\n')

/**
 * Most of what this button does is invisible until something goes wrong — a
 * filter, a verification level, three AutoMod rules. Two parts are not, and they
 * are the two a commissioner would be annoyed to discover afterwards, so those
 * are the two the dialog leads with.
 */
const COMMUNITY_CONFIRM = [
  'Apply the safety and onboarding settings?',
  '',
  'Two of these are visible to every member straight away: PADDOCK opens up so everyone in the server can see it, and new arrivals answer two onboarding questions instead of dropping straight into the server.',
  '',
  'The rest is quieter — verification level, the explicit-content filter, the rules and alert channels, and the AutoMod rules. Nothing is deleted, no channel is removed and no messages are touched.',
].join('\n')

/** The roles the panel manages, so a gate reported as an ID can be named. */
const NAMED_ROLE_FIELDS: { key: keyof Cfg; label: string }[] = [
  { key: 'role_site_admin', label: 'Admin' },
  { key: 'role_site_race_control', label: 'Race Control' },
  { key: 'role_bronze', label: 'Bronze' },
  { key: 'role_silver', label: 'Silver' },
  { key: 'role_gold', label: 'Gold' },
  { key: 'role_platinum', label: 'Platinum' },
]

export default function DiscordSettings() {
  const [form, setForm] = useState<Cfg>(EMPTY)
  const [provisionedAt, setProvisionedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [running, setRunning] = useState<
    'setup' | 'events' | 'audit' | 'preview' | 'rebuild' | 'roles' | 'link' | null
  >(null)
  const [setupErr, setSetupErr] = useState<string | null>(null)
  const [setupReport, setSetupReport] = useState<SetupReport | null>(null)
  const [eventsErr, setEventsErr] = useState<string | null>(null)
  const [eventsReport, setEventsReport] = useState<EventsReport | null>(null)
  const [auditErr, setAuditErr] = useState<string | null>(null)
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null)
  const [rebuildErr, setRebuildErr] = useState<string | null>(null)
  /** The rehearsal. Its presence is also what unlocks the real run. */
  const [rebuildPlan, setRebuildPlan] = useState<RebuildReport | null>(null)
  const [rebuildDone, setRebuildDone] = useState<RebuildReport | null>(null)
  const [rolesErr, setRolesErr] = useState<string | null>(null)
  const [rolesReport, setRolesReport] = useState<ReconcileReport | null>(null)
  const [linkErr, setLinkErr] = useState<string | null>(null)
  const [linkReport, setLinkReport] = useState<LinkReport | null>(null)

  // Inactive members. Kept on its own state rather than folded into `form`: the
  // two numbers are numbers, not snowflake strings, and the card saves on its own
  // so a half-typed ID in the form below can never ride along with a rule about
  // removing people. `pruneRunning` is likewise separate, so this card locks
  // itself without changing when any other button on the page is available.
  const [pruneEnabled, setPruneEnabled] = useState(false)
  const [pruneDays, setPruneDays] = useState('7')
  const [pruneMax, setPruneMax] = useState('10')
  const [pruneSaving, setPruneSaving] = useState(false)
  const [pruneSaved, setPruneSaved] = useState(false)
  const [pruneCfgErr, setPruneCfgErr] = useState<string | null>(null)
  const [pruneRunning, setPruneRunning] = useState<'preview' | 'remove' | null>(null)
  const [pruneErr, setPruneErr] = useState<string | null>(null)
  /** The rehearsal. Its presence is also what unlocks the real run. */
  const [prunePreview, setPrunePreview] = useState<PruneReport | null>(null)
  const [pruneDone, setPruneDone] = useState<PruneReport | null>(null)

  // Safety & onboarding. On its own `communityRunning` for the same reason the
  // prune card has one: this card locks itself while it works without changing
  // when any other button on the page is available.
  const [communityRunning, setCommunityRunning] = useState<'preview' | 'apply' | null>(null)
  const [communityErr, setCommunityErr] = useState<string | null>(null)
  /** The rehearsal. Its presence is also what unlocks the real run. */
  const [communityPreview, setCommunityPreview] = useState<CommunityReport | null>(null)
  const [communityDone, setCommunityDone] = useState<CommunityReport | null>(null)

  /**
   * `keepSwitches` is for the post-setup refresh: setup writes the ids but
   * deliberately never touches `enabled`, so an unsaved flick of either toggle
   * shouldn't quietly snap back when the ids land.
   */
  const loadConfig = async (keepSwitches = false) => {
    const { data, error } = await supabase.from('discord_config').select('*').eq('id', 1).maybeSingle()
    if (error) setErr(error.message)
    if (!data) return
    const row = data as Record<string, unknown>
    setForm((prev) => {
      const next = { ...EMPTY }
      for (const k of Object.keys(EMPTY) as (keyof Cfg)[]) {
        const v = row[k]
        if (typeof v === 'boolean') (next[k] as boolean) = v
        else (next[k] as string) = (v as string) ?? ''
      }
      if (keepSwitches) {
        next.enabled = prev.enabled
        next.auto_sync_roles = prev.auto_sync_roles
      }
      return next
    })
    setProvisionedAt(typeof row.provisioned_at === 'string' ? row.provisioned_at : null)
  }

  /**
   * The prune settings come off the same row, read separately so nothing about
   * the shape of the form below has to change to hold them. A row that has never
   * been touched leaves the defaults standing: off, seven days, ten at a time.
   */
  const loadPrune = async () => {
    const { data, error } = await supabase
      .from('discord_config')
      .select('prune_pending_enabled, prune_pending_days, prune_pending_max_per_run')
      .eq('id', 1)
      .maybeSingle()
    if (error) { setPruneCfgErr(error.message); return }
    if (!data) return
    const row = data as Record<string, unknown>
    setPruneEnabled(row.prune_pending_enabled === true)
    const days = num(row.prune_pending_days)
    const max = num(row.prune_pending_max_per_run)
    if (days !== null) setPruneDays(String(days))
    if (max !== null) setPruneMax(String(max))
  }

  // Read once on mount; provision() re-runs loadConfig by hand afterwards.
  useEffect(() => {
    loadConfig().finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadPrune()
  }, [])

  if (loading) return <Skeleton className="h-96 w-full" />

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const payload: Record<string, unknown> = { ...form }
    // store blanks as null so "unset" is unambiguous
    for (const k of Object.keys(payload)) {
      if (payload[k] === '') payload[k] = null
    }
    const { error } = await supabase.from('discord_config').update(payload).eq('id', 1)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setSaved(true); setTimeout(() => setSaved(false), 1800)
  }

  const provision = async () => {
    setRunning('setup'); setSetupErr(null); setSetupReport(null)
    const { body, error } = await invokeFn('discord-provision')
    if (error) { setSetupErr(error); setRunning(null); return }
    setSetupReport(readSetupReport(body ?? {}))
    // The function wrote the ids straight into discord_config — pull them back
    // so the form below is filled in without a reload.
    await loadConfig(true)
    setRunning(null)
  }

  const syncEvents = async () => {
    setRunning('events'); setEventsErr(null); setEventsReport(null)
    const { body, error } = await invokeFn('discord-events-sync')
    if (error) { setEventsErr(error); setRunning(null); return }
    setEventsReport(readEventsReport(body ?? {}))
    setRunning(null)
  }

  // Rehearsal only: dryRun asks the function to describe what it would do and
  // change nothing at all, so this is as safe as the scan above.
  const previewRebuild = async () => {
    setRunning('preview'); setRebuildErr(null); setRebuildPlan(null); setRebuildDone(null)
    const { body, error } = await invokeFn('discord-rebuild', { dryRun: true })
    if (error) { setRebuildErr(error); setRunning(null); return }
    setRebuildPlan(readRebuildReport(body ?? {}, true))
    setRunning(null)
  }

  const runRebuild = async () => {
    // The button is disabled without a plan; this is the belt to that brace.
    if (!rebuildPlan || running !== null) return
    if (!window.confirm(REBUILD_CONFIRM)) return
    setRunning('rebuild'); setRebuildErr(null); setRebuildDone(null)
    const { body, error } = await invokeFn('discord-rebuild', { dryRun: false })
    if (error) { setRebuildErr(error); setRunning(null); return }
    setRebuildDone(readRebuildReport(body ?? {}, false))
    // The plan described a server that has just changed shape, so it isn't true
    // any more — drop it, which also re-locks the button until the next preview.
    setRebuildPlan(null)
    // The rebuild writes the new channel ids into discord_config; pull them back
    // so the form below is right without a reload.
    await loadConfig(true)
    setRunning(null)
  }

  const syncRoles = async () => {
    setRunning('roles'); setRolesErr(null); setRolesReport(null)
    const { body, error } = await invokeFn('discord-role-reconcile')
    if (error) { setRolesErr(error); setRunning(null); return }
    setRolesReport(readReconcileReport(body ?? {}))
    setRunning(null)
  }

  // Additive only: this hands out the League Member role and fills in the
  // driver ↔ Discord links. It writes nothing into discord_config, so there is
  // nothing to reload afterwards either.
  const linkDrivers = async () => {
    setRunning('link'); setLinkErr(null); setLinkReport(null)
    const { body, error } = await invokeFn('discord-link-drivers')
    if (error) { setLinkErr(error); setRunning(null); return }
    setLinkReport(readLinkReport(body ?? {}))
    setRunning(null)
  }

  // Read-only: the scan writes nothing back into discord_config, so unlike
  // provision() there's nothing to reload afterwards.
  const scan = async () => {
    setRunning('audit'); setAuditErr(null); setAuditReport(null)
    const { body, error } = await invokeFn('discord-audit')
    if (error) { setAuditErr(error); setRunning(null); return }
    setAuditReport(readAuditReport(body ?? {}))
    setRunning(null)
  }

  /**
   * How many people the next real run would remove. The list the preview showed
   * is the truthful number: a preview that hit the ceiling lists only as many as
   * the ceiling allows, which is exactly how many would go. The tally is the
   * fallback for a function that counted without naming anybody.
   */
  const pruneDue = prunePreview ? prunePreview.candidates.length || prunePreview.dueCount || 0 : 0

  const savePrune = async (e: React.FormEvent) => {
    e.preventDefault()
    setPruneSaving(true); setPruneCfgErr(null)
    const days = clampInt(pruneDays, 1, 90, 7)
    const max = clampInt(pruneMax, 1, 100, 10)
    // Put the clamped numbers back on screen before saving them, so the boxes
    // show the rule that is about to be stored rather than the one typed over it.
    setPruneDays(String(days)); setPruneMax(String(max))
    const { error } = await supabase
      .from('discord_config')
      .update({
        prune_pending_enabled: pruneEnabled,
        prune_pending_days: days,
        prune_pending_max_per_run: max,
      })
      .eq('id', 1)
    setPruneSaving(false)
    if (error) { setPruneCfgErr(error.message); return }
    setPruneSaved(true); setTimeout(() => setPruneSaved(false), 1800)
  }

  // Rehearsal only: dryRun asks the function to work out who is overdue and
  // remove nobody. Safe to run whenever, and the only way to unlock the button
  // below it.
  const previewPrune = async () => {
    if (running !== null || pruneRunning !== null) return
    setPruneRunning('preview'); setPruneErr(null); setPrunePreview(null); setPruneDone(null)
    const { body, error } = await invokeFn('discord-prune-pending', { dryRun: true })
    if (error) { setPruneErr(error); setPruneRunning(null); return }
    setPrunePreview(readPruneReport(body ?? {}, true))
    setPruneRunning(null)
  }

  const runPrune = async () => {
    // The button is disabled without a preview naming somebody; this is the belt
    // to that brace, and it is worth having twice for a button that removes people.
    if (!prunePreview || pruneDue < 1 || running !== null || pruneRunning !== null) return
    if (!window.confirm(pruneConfirm(pruneDue))) return
    setPruneRunning('remove'); setPruneErr(null); setPruneDone(null)
    const { body, error } = await invokeFn('discord-prune-pending', { dryRun: false })
    if (error) { setPruneErr(error); setPruneRunning(null); return }
    setPruneDone(readPruneReport(body ?? {}, false))
    // The preview described a server that has just changed — drop it, which also
    // re-locks the button until somebody looks at a fresh list.
    setPrunePreview(null)
    setPruneRunning(null)
  }

  /** Nothing else on the page may be mid-flight — these settings are guild-wide. */
  const communityBusy = running !== null || pruneRunning !== null || communityRunning !== null

  // Rehearsal only: dryRun asks the function to describe every setting it would
  // touch and change nothing at all. Safe to run whenever, and the only way to
  // unlock the button below it.
  const previewCommunity = async () => {
    if (communityBusy) return
    setCommunityRunning('preview'); setCommunityErr(null); setCommunityPreview(null); setCommunityDone(null)
    const { body, error } = await invokeFn('discord-community-setup', { dryRun: true })
    if (error) { setCommunityErr(error); setCommunityRunning(null); return }
    setCommunityPreview(readCommunityReport(body ?? {}, true))
    setCommunityRunning(null)
  }

  const applyCommunity = async () => {
    // The button is disabled without a preview; this is the belt to that brace.
    if (!communityPreview || communityBusy) return
    if (!window.confirm(COMMUNITY_CONFIRM)) return
    setCommunityRunning('apply'); setCommunityErr(null); setCommunityDone(null)
    const { body, error } = await invokeFn('discord-community-setup', { dryRun: false })
    if (error) { setCommunityErr(error); setCommunityRunning(null); return }
    setCommunityDone(readCommunityReport(body ?? {}, false))
    // The preview described a server that has just changed, so it isn't true any
    // more — drop it, which also re-locks the button until the next preview.
    setCommunityPreview(null)
    setCommunityRunning(null)
  }

  const field = (key: keyof Cfg, label: string, hint?: string) => (
    <label className="block">
      <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">{label}</span>
      <input
        className="hcr-input tabular"
        value={form[key] as string}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder="000000000000000000"
        inputMode="numeric"
      />
      {hint && <span className="mt-1 block text-xs text-[var(--color-faint)]">{hint}</span>}
    </label>
  )

  const hasSetupDetail =
    !!setupReport &&
    (setupReport.roles.length > 0 ||
      setupReport.channels.length > 0 ||
      setupReport.webhooks.length > 0)

  const hasAuditDetail =
    !!auditReport && (auditReport.roles.length > 0 || auditReport.groups.length > 0)

  // A rebuild gates its categories by role ID; the panel already knows the names
  // of the roles it manages, so show "Bronze" rather than an 18-digit number.
  const roleNames = new Map<string, string>()
  for (const f of NAMED_ROLE_FIELDS) {
    const id = form[f.key]
    if (typeof id === 'string' && id) roleNames.set(id, f.label)
  }

  const showEventCounts =
    !!eventsReport &&
    (!eventsReport.note ||
      eventsReport.created + eventsReport.updated + eventsReport.skipped > 0)

  return (
    <div>
      <h2 className="mb-2 text-3xl">Discord</h2>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-muted)]">
        Connect the league Discord so server roles decide who gets which portal, and so results and
        license promotions post themselves. Run the setup below once and every ID fills itself in.
      </p>

      {/* ── Server setup ────────────────────────────────────────────────── */}
      <section className="mb-6 max-w-2xl rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-xl">Server setup</h3>
          {provisionedAt && (
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-faint)]">
              Last set up {fmtStamp(provisionedAt)}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          One click finds or creates the league's roles, channels and webhooks in Discord and fills
          in every ID below automatically — so you never copy an ID by hand. Run it as often as you
          like: anything that already exists is reused, never duplicated.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={provision}
            disabled={running !== null}
            aria-busy={running === 'setup'}
            className="hcr-btn hcr-btn-primary"
          >
            {running === 'setup' ? 'Setting up…' : 'Set up my server'}
          </button>
          <button
            type="button"
            onClick={syncEvents}
            disabled={running !== null}
            aria-busy={running === 'events'}
            className="hcr-btn hcr-btn-ghost"
          >
            {running === 'events' ? 'Syncing…' : 'Sync race calendar to Discord'}
          </button>
          <button
            type="button"
            onClick={scan}
            disabled={running !== null}
            aria-busy={running === 'audit'}
            className="hcr-btn hcr-btn-ghost"
          >
            {running === 'audit' ? 'Scanning…' : 'Scan my server'}
          </button>
          <button
            type="button"
            onClick={previewRebuild}
            disabled={running !== null}
            aria-busy={running === 'preview'}
            className="hcr-btn hcr-btn-ghost"
          >
            {running === 'preview' ? 'Previewing…' : 'Preview rebuild'}
          </button>
          <button
            type="button"
            onClick={syncRoles}
            disabled={running !== null}
            aria-busy={running === 'roles'}
            className="hcr-btn hcr-btn-ghost"
          >
            {running === 'roles' ? 'Syncing…' : 'Sync roles now'}
          </button>
          <button
            type="button"
            onClick={linkDrivers}
            disabled={running !== null}
            aria-busy={running === 'link'}
            aria-describedby="link-drivers-note"
            className="hcr-btn hcr-btn-ghost"
          >
            {running === 'link' ? 'Linking…' : 'Link drivers & grant roles'}
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--color-faint)]">
          Scanning and previewing read the server and report back — neither creates, renames or
          deletes anything.
        </p>
        <p id="link-drivers-note" className="mt-2 text-xs text-[var(--color-faint)]">
          Linking drivers matches roster drivers to Discord accounts by name and gives anyone who
          has raced the League Member role. It only ever adds roles, never removes them.
        </p>

        {/* The one control here that reshapes the server, kept apart from the
            read-only buttons above and locked until a plan has been seen. */}
        <div className="mt-5 rounded-lg border border-[var(--color-line)] bg-[var(--color-cloud)] p-4">
          <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
            Rebuild the layout
          </span>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Builds the league's categories and channels, sets who can see each one, then moves every
            channel the server has today into a hidden <span className="font-mono">ARCHIVE</span>{' '}
            category. Nothing is ever deleted — the old channels and all their messages stay put
            until you remove them by hand.
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={runRebuild}
              disabled={running !== null || !rebuildPlan}
              aria-busy={running === 'rebuild'}
              aria-describedby="rebuild-gate"
              className="hcr-btn hcr-btn-primary"
            >
              {running === 'rebuild' ? 'Rebuilding…' : 'Run rebuild'}
            </button>
          </div>
          <p id="rebuild-gate" className="mt-2 text-xs text-[var(--color-faint)]">
            {rebuildPlan
              ? 'The plan below is what will be built. You’ll be asked to confirm once more.'
              : 'Preview the rebuild first — this unlocks once you’ve read the plan.'}
          </p>
        </div>

        <div aria-live="polite">
          {setupErr && (
            <p className="mt-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
              {setupErr}
            </p>
          )}

          {setupReport && (
            <div className="mt-5 border-t border-[var(--color-line)] pt-4">
              {setupReport.guildName && (
                <div>
                  <span className="block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                    Server
                  </span>
                  <span className="text-sm font-semibold">{setupReport.guildName}</span>
                  {setupReport.guildId && (
                    <span className="ml-2 font-mono text-[11px] tabular text-[var(--color-faint)]">
                      {setupReport.guildId}
                    </span>
                  )}
                </div>
              )}

              <ItemGroup title="Roles" items={setupReport.roles} />
              <ItemGroup title="Channels" items={setupReport.channels} />
              <ItemGroup title="Webhooks" items={setupReport.webhooks} showIds={false} />

              {setupReport.note && (
                <p className="mt-3 text-sm text-[var(--color-muted)]">{setupReport.note}</p>
              )}

              {setupReport.warnings.length > 0 && (
                <Callout title="Needs your attention" lines={setupReport.warnings}>
                  {setupReport.guilds.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {setupReport.guilds.map((g) => (
                        <li key={g.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                          <span className="font-semibold">{g.name}</span>
                          <span className="font-mono text-[11px] tabular text-[var(--color-ink-2)]">{g.id}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Callout>
              )}

              {!setupReport.guildName &&
                !hasSetupDetail &&
                !setupReport.note &&
                setupReport.warnings.length === 0 && (
                  <p className="text-sm text-[var(--color-muted)]">
                    Setup finished, but Discord sent nothing back to show. Check the IDs below.
                  </p>
                )}
            </div>
          )}

          {eventsErr && (
            <p className="mt-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
              {eventsErr}
            </p>
          )}

          {eventsReport && (
            <div className="mt-5 border-t border-[var(--color-line)] pt-4">
              <span className="block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                Race calendar
              </span>
              {/* A guard clause ("integration is disabled") did no work — three
                  zeroes would only muddy the reason. */}
              {showEventCounts && (
                <dl className="mt-2 grid grid-cols-3 gap-3">
                  <Count label="Created" value={eventsReport.created} />
                  <Count label="Updated" value={eventsReport.updated} />
                  <Count label="Skipped" value={eventsReport.skipped} />
                </dl>
              )}
              {eventsReport.total !== null && (
                <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-faint)]">
                  {eventsReport.total} upcoming round{eventsReport.total === 1 ? '' : 's'}
                  {eventsReport.unchanged > 0 && ` · ${eventsReport.unchanged} already in sync`}
                </p>
              )}
              {eventsReport.note && (
                <p className="mt-3 text-sm text-[var(--color-muted)]">{eventsReport.note}</p>
              )}
              {eventsReport.reasons.length > 0 && (
                <Callout title="Rounds that were skipped" lines={eventsReport.reasons} />
              )}
            </div>
          )}

          {auditErr && (
            <p className="mt-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
              {auditErr}
            </p>
          )}

          {auditReport && (
            <div className="mt-5 border-t border-[var(--color-line)] pt-4">
              <span className="block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                Server scan
              </span>

              {(auditReport.guildName || auditReport.guildId || auditReport.members !== null) && (
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold">{auditReport.guildName ?? 'This server'}</span>
                  {auditReport.guildId && (
                    <span className="font-mono text-[11px] tabular text-[var(--color-faint)]">
                      {auditReport.guildId}
                    </span>
                  )}
                  {auditReport.members !== null && (
                    <span className="font-mono text-[11px] tabular text-[var(--color-faint)]">
                      {auditReport.members} member{auditReport.members === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              )}

              <RoleTable roles={auditReport.roles} />
              <ChannelGroups groups={auditReport.groups} />

              {auditReport.notes.length > 0 && (
                <Callout
                  title={auditReport.choosing ? 'Needs your attention' : 'Notes'}
                  lines={auditReport.notes}
                >
                  {auditReport.guilds.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {auditReport.guilds.map((g) => (
                        <li key={g.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                          <span className="font-semibold">{g.name}</span>
                          <span className="font-mono text-[11px] tabular text-[var(--color-ink-2)]">{g.id}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Callout>
              )}

              {!auditReport.guildName &&
                auditReport.members === null &&
                !hasAuditDetail &&
                auditReport.notes.length === 0 && (
                  <p className="text-sm text-[var(--color-muted)]">
                    The scan finished, but Discord sent nothing back to show.
                  </p>
                )}
            </div>
          )}

          {rebuildErr && (
            <p className="mt-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
              {rebuildErr}
            </p>
          )}

          {rebuildPlan && <RebuildView report={rebuildPlan} names={roleNames} />}
          {rebuildDone && <RebuildView report={rebuildDone} names={roleNames} />}

          {rolesErr && (
            <p className="mt-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
              {rolesErr}
            </p>
          )}

          {rolesReport && <RoleSyncView report={rolesReport} />}

          {linkErr && (
            <p className="mt-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
              {linkErr}
            </p>
          )}

          {linkReport && <LinkDriversView report={linkReport} />}
        </div>
      </section>

      {/* ── Safety & onboarding ─────────────────────────────────────────── */}
      {/* Every setting in here lives several screens deep in Discord's own
          Server Settings, in four different menus. Doing it by hand is mostly a
          memory test, so this card does the whole set in one go — and shows the
          set before it touches any of it. */}
      <section className="mb-6 max-w-2xl rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <h3 className="text-xl">Safety &amp; onboarding</h3>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          This applies the league's safety and onboarding settings to the server directly, so you
          don't have to hunt through Discord's menus for them.
        </p>

        <span className="mt-4 block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
          What it sets
        </span>
        <ul className="mt-1.5 space-y-1 text-sm text-[var(--color-ink-2)]">
          <li>Verification level set to Medium, so a brand-new account can't post the moment it arrives.</li>
          <li>Explicit-content filter switched on.</li>
          <li>Rules, community-updates and safety-alerts channels wired up to the right channels.</li>
          <li>AutoMod rules for spam, mention spam and flagged words.</li>
          <li>
            <span className="font-mono">PADDOCK</span> opened up so everyone in the server can see it.
          </li>
          <li>Onboarding turned on, with two questions for new members to answer.</li>
        </ul>

        <div className="mt-4">
          <button
            type="button"
            onClick={previewCommunity}
            disabled={communityBusy}
            aria-busy={communityRunning === 'preview'}
            className="hcr-btn hcr-btn-ghost"
          >
            {communityRunning === 'preview' ? 'Previewing…' : 'Preview settings'}
          </button>
          <p className="mt-2 text-xs text-[var(--color-faint)]">
            Previewing reads the server and lists what it would change. It sets nothing.
          </p>
        </div>

        <div aria-live="polite">
          {communityErr && (
            <p className="mt-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
              {communityErr}
            </p>
          )}

          {communityPreview && <CommunityView report={communityPreview} />}
          {communityDone && <CommunityView report={communityDone} />}
        </div>

        {/* The control that actually changes the server, kept apart from the
            read-only button above and locked until a preview has been read. */}
        <div className="mt-5 rounded-lg border border-[var(--color-line)] bg-[var(--color-cloud)] p-4">
          <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
            Apply the settings
          </span>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Two of these show up for members straight away: <span className="font-mono">PADDOCK</span>{' '}
            becomes visible to everyone, and new arrivals answer the onboarding questions before they
            land. Nothing is deleted and no messages are touched.
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={applyCommunity}
              disabled={communityBusy || !communityPreview}
              aria-busy={communityRunning === 'apply'}
              aria-describedby="community-gate"
              className="hcr-btn hcr-btn-primary"
            >
              {communityRunning === 'apply' ? 'Applying…' : 'Apply settings'}
            </button>
          </div>
          <p id="community-gate" className="mt-2 text-xs text-[var(--color-faint)]">
            {communityPreview
              ? 'The preview above is what will be set. You’ll be asked to confirm once more.'
              : 'Preview the settings first — this unlocks once you’ve read what would change.'}
          </p>
        </div>
      </section>

      {/* ── Inactive members ────────────────────────────────────────────── */}
      {/* Everything above this line builds things. This card takes people out of
          the server, so it says so plainly and never in the panel's usual
          cheerful voice. */}
      <section className="mb-6 max-w-2xl rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <h3 className="text-xl">Inactive members</h3>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          People who join the Discord and never finish onboarding can be removed automatically after
          a set number of days. Removing someone is a kick, not a ban — nothing of theirs is deleted,
          and they can rejoin at any time with a new invite.
        </p>

        <form onSubmit={savePrune} className="mt-4 border-t border-[var(--color-line)] pt-4">
          <Switch
            checked={pruneEnabled}
            onChange={setPruneEnabled}
            label="Remove inactive members automatically"
            hint="Off by default. While this is off, nobody is removed unless you do it here yourself."
          />

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block">
                <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                  Days before removal
                </span>
                <input
                  className="hcr-input tabular"
                  type="number"
                  min={1}
                  max={90}
                  step={1}
                  inputMode="numeric"
                  value={pruneDays}
                  onChange={(e) => setPruneDays(e.target.value)}
                  aria-describedby="prune-days-hint"
                />
              </label>
              <p id="prune-days-hint" className="mt-1 text-xs text-[var(--color-faint)]">
                How long someone can sit un-onboarded before they count as overdue. 1 to 90.
              </p>
            </div>

            <div>
              <label className="block">
                <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                  Most removals per run
                </span>
                <input
                  className="hcr-input tabular"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  value={pruneMax}
                  onChange={(e) => setPruneMax(e.target.value)}
                  aria-describedby="prune-max-hint"
                />
              </label>
              <p id="prune-max-hint" className="mt-1 text-xs text-[var(--color-faint)]">
                A safety ceiling, 1 to 100. A run that reaches it stops there rather than carrying
                on, so a mistake in these settings can only ever cost you this many people at once.
              </p>
            </div>
          </div>

          <div className="mt-4">
            <button type="submit" disabled={pruneSaving} className="hcr-btn hcr-btn-ghost">
              {pruneSaving ? 'Saving…' : pruneSaved ? 'Saved ✓' : 'Save removal settings'}
            </button>
            <p className="mt-2 text-xs text-[var(--color-faint)]">
              None of these three settings take effect until you save.
            </p>
          </div>

          {pruneCfgErr && (
            <p className="mt-3 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
              {pruneCfgErr}
            </p>
          )}
        </form>

        <div className="mt-5 border-t border-[var(--color-line)] pt-4">
          <button
            type="button"
            onClick={previewPrune}
            disabled={running !== null || pruneRunning !== null}
            aria-busy={pruneRunning === 'preview'}
            className="hcr-btn hcr-btn-ghost"
          >
            {pruneRunning === 'preview' ? 'Checking…' : 'Preview removals'}
          </button>
          <p className="mt-2 text-xs text-[var(--color-faint)]">
            Previewing reads the member list and works out who is overdue. Nobody is removed by it.
          </p>
        </div>

        <div aria-live="polite">
          {pruneErr && (
            <p className="mt-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
              {pruneErr}
            </p>
          )}

          {prunePreview && <PruneView report={prunePreview} />}
          {pruneDone && <PruneView report={pruneDone} />}
        </div>

        {/* The one control on the page that takes people out of the server, kept
            apart from everything else and locked until a real list has been read. */}
        <div className="mt-5 rounded-lg border border-[var(--color-red)]/40 bg-[var(--color-cloud)] p-4">
          <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-red)]">
            Remove them now
          </span>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Removes the people named in the preview above, and nobody else. They are kicked, not
            banned: they keep their account, and a new invite brings any of them back.
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={runPrune}
              disabled={running !== null || pruneRunning !== null || !prunePreview || pruneDue < 1}
              aria-busy={pruneRunning === 'remove'}
              aria-describedby="prune-gate"
              className="hcr-btn border border-[var(--color-red)] bg-[var(--color-red)] text-white"
            >
              {pruneRunning === 'remove' ? 'Removing…' : 'Remove now'}
            </button>
          </div>
          <p id="prune-gate" className="mt-2 text-xs text-[var(--color-faint)]">
            {!prunePreview
              ? 'Preview the removals first — this unlocks once you’ve read the list.'
              : pruneDue < 1
                ? 'Nobody is overdue, so there is nothing to remove.'
                : `${pruneDue} ${pruneDue === 1 ? 'person' : 'people'} would be removed. You’ll be asked to confirm once more.`}
          </p>
        </div>
      </section>

      <p className="mb-4 max-w-2xl text-sm text-[var(--color-muted)]">
        Prefer to wire it up by hand, or need to point the site at something that already exists?
        Turn on Developer Mode in Discord, then right-click a server, role or channel and choose{' '}
        <strong>Copy ID</strong>. Anything you type here overrides what setup found.
      </p>

      <form onSubmit={save} className="max-w-2xl space-y-6">
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-display text-2xl">Integration</div>
              <p className="text-sm text-[var(--color-muted)]">Nothing is sent or synced while this is off.</p>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="h-5 w-5 accent-[var(--color-blue)]"
              />
              Enabled
            </label>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.auto_sync_roles}
              onChange={(e) => setForm({ ...form, auto_sync_roles: e.target.checked })}
              className="h-5 w-5 accent-[var(--color-blue)]"
            />
            Set portal access from Discord roles when a member signs in
          </label>
        </div>

        <fieldset className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <legend className="px-2 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Server</legend>
          <div className="mt-2">{field('guild_id', 'Server (guild) ID')}</div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <legend className="px-2 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Portal access</legend>
          {field('role_site_admin', 'Admin role', 'Holders get the Admin portal.')}
          {field('role_site_race_control', 'Race Control role', 'Holders get the Race Control portal.')}
        </fieldset>

        <fieldset className="grid gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 sm:grid-cols-2">
          <legend className="px-2 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">License roles (auto-assigned)</legend>
          {field('role_bronze', 'Bronze')}
          {field('role_silver', 'Silver')}
          {field('role_gold', 'Gold')}
          {field('role_platinum', 'Platinum')}
        </fieldset>

        <fieldset className="grid gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 sm:grid-cols-2">
          <legend className="px-2 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Channels</legend>
          {field('channel_results', 'Results')}
          {field('channel_standings', 'Standings')}
          {field('channel_license_ups', 'License promotions')}
        </fieldset>

        {err && <p className="rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">{err}</p>}

        <button type="submit" disabled={busy} className="hcr-btn hcr-btn-primary">
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save Discord settings'}
        </button>

        <p className="text-xs text-[var(--color-faint)]">
          The bot token is stored as a Supabase secret, never here.
        </p>
      </form>
    </div>
  )
}

/** One section of the setup report — nothing renders when the list is empty. */
function ItemGroup({
  title,
  items,
  showIds = true,
}: {
  title: string
  items: ReportItem[]
  showIds?: boolean
}) {
  if (items.length === 0) return null
  return (
    <div className="mt-4">
      <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        {title}
      </span>
      <ul className="divide-y divide-[var(--color-line)]">
        {items.map((it, i) => (
          <li key={`${it.key}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{it.label}</span>
            {showIds && it.id && (
              <span className="font-mono text-[11px] tabular text-[var(--color-faint)]">{it.id}</span>
            )}
            <StateChip state={it.state} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The "read this" box. Brand yellow at low opacity is the only amber the
 * palette has; body copy stays on --color-ink-2 so it clears AA over the tint.
 */
function Callout({
  title,
  lines,
  children,
}: {
  title: string
  lines: string[]
  children?: React.ReactNode
}) {
  return (
    <div className="mt-4 rounded-lg border border-[var(--color-brand-deep)]/35 bg-[var(--color-brand)]/12 px-4 py-3">
      <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-brand-deep)]">
        {title}
      </span>
      <ul className="mt-1.5 space-y-1 text-sm text-[var(--color-ink-2)]">
        {lines.map((line, i) => (
          <li key={`${i}-${line}`}>{line}</li>
        ))}
      </ul>
      {children}
    </div>
  )
}

/** created = brand tint, found = quiet, failed = red. */
function StateChip({ state }: { state: ItemState }) {
  const styles: Record<ItemState, string> = {
    created: 'border-[var(--color-brand-deep)]/40 bg-[var(--color-brand)]/15 text-[var(--color-brand-deep)]',
    found: 'border-[var(--color-line-2)] text-[var(--color-muted)]',
    failed: 'border-[var(--color-red)]/40 bg-[var(--color-red)]/10 text-[var(--color-red)]',
  }
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${styles[state]}`}
    >
      {state}
    </span>
  )
}

/** Every role in the server as the scan found it — nothing here is editable. */
function RoleTable({ roles }: { roles: AuditRole[] }) {
  if (roles.length === 0) return null
  return (
    <div className="mt-4">
      <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        Roles
      </span>
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--color-line)]">
            <th
              scope="col"
              className="py-1.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]"
            >
              Role
            </th>
            <th
              scope="col"
              className="py-1.5 text-right font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]"
            >
              Members
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {roles.map((r, i) => (
            <tr key={r.id ?? `${r.name}-${i}`}>
              <th scope="row" className="py-2 pr-3 text-left font-body text-sm font-semibold">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words">{r.name}</span>
                  {r.staff && <MiniChip tone="brand">Staff</MiniChip>}
                </span>
              </th>
              {/* An unknown count is a blank, never a zero. */}
              <td className="py-2 text-right tabular text-sm">{r.members === null ? '—' : r.members}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Channels under their category, each with the last time anything happened. */
function ChannelGroups({ groups }: { groups: AuditGroup[] }) {
  if (groups.length === 0) return null
  return (
    <div className="mt-4">
      <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        Channels
      </span>
      {groups.map((g) => (
        <div key={g.key} className="mt-2">
          <span className="block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
            {g.name}
          </span>
          <ul className="divide-y divide-[var(--color-line)]">
            {g.channels.map((c, i) => (
              <li
                key={c.id ?? `${g.key}-${c.name}-${i}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                <span className="font-mono text-[11px] tabular text-[var(--color-faint)]">
                  {c.last ? fmtStamp(c.last) : 'no activity'}
                </span>
                {c.quiet && <MiniChip tone="quiet">Quiet</MiniChip>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/**
 * The scan's small chips — the same pill as StateChip: brand tint when the chip
 * flags something notable, plain outline when it's only an observation.
 */
function MiniChip({ tone, children }: { tone: 'brand' | 'quiet'; children: React.ReactNode }) {
  const styles: Record<'brand' | 'quiet', string> = {
    brand: 'border-[var(--color-brand-deep)]/40 bg-[var(--color-brand)]/15 text-[var(--color-brand-deep)]',
    quiet: 'border-[var(--color-line-2)] text-[var(--color-muted)]',
  }
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${styles[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * The rebuild plan, read-only — the same block whether it's the rehearsal or the
 * report from the real run; only the tense of the chips and the archive line
 * changes.
 */
function RebuildView({ report, names }: { report: RebuildReport; names: Map<string, string> }) {
  const nothing =
    report.categories.length === 0 &&
    report.loose.length === 0 &&
    report.archive === null &&
    !report.note &&
    report.warnings.length === 0

  return (
    <div className="mt-5 border-t border-[var(--color-line)] pt-4">
      <span className="block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        {report.dryRun ? 'Rebuild preview — nothing has changed yet' : 'Rebuild'}
      </span>

      {(report.guildName || report.guildId) && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-semibold">{report.guildName ?? 'This server'}</span>
          {report.guildId && (
            <span className="font-mono text-[11px] tabular text-[var(--color-faint)]">{report.guildId}</span>
          )}
        </div>
      )}

      {report.categories.map((c, i) => (
        <div key={`${c.key}-${i}`} className="mt-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 break-words font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
              {c.name}
            </span>
            {c.state && <PlanChip state={c.state} dryRun={report.dryRun} />}
          </div>
          {/* Only claim a gate the function actually reported — silence here
              means "not said", not "open to everyone". */}
          {c.roles.length > 0 && <RoleGate roles={c.roles} names={names} />}
          <PlanChannels channels={c.channels} dryRun={report.dryRun} groupKey={c.key} />
        </div>
      ))}

      {report.loose.length > 0 && (
        <div className="mt-4">
          <span className="block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
            No category
          </span>
          <PlanChannels channels={report.loose} dryRun={report.dryRun} groupKey="loose" />
        </div>
      )}

      {report.archive !== null && (
        <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-[var(--color-faint)]">
          {report.archive} channel{report.archive === 1 ? '' : 's'}{' '}
          {report.dryRun ? 'will move to' : 'moved to'} {report.archiveName || 'ARCHIVE'}
        </p>
      )}

      {!report.dryRun && (
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Your old channels are all in the <span className="font-mono">ARCHIVE</span> category now,
          hidden from members. Nothing was deleted and every message is still there — delete them by
          hand whenever you like, or leave them.
        </p>
      )}

      {report.note && <p className="mt-3 text-sm text-[var(--color-muted)]">{report.note}</p>}

      {report.warnings.length > 0 && <Callout title="Needs your attention" lines={report.warnings} />}

      {report.dryRun && nothing && (
        <p className="text-sm text-[var(--color-muted)]">
          The preview finished, but nothing came back to show. Scan the server first, then try again.
        </p>
      )}
    </div>
  )
}

/**
 * Who will be able to see a category. A gate reported as a role ID is named
 * where the panel knows the name and shown as the bare ID where it doesn't —
 * an ID a commissioner can look up beats a guess.
 */
function RoleGate({ roles, names }: { roles: string[]; names: Map<string, string> }) {
  return (
    <p className="mt-1 text-xs text-[var(--color-muted)]">
      Visible to{' '}
      {roles.map((r, i) => {
        const named = names.get(r)
        return (
          <span key={`${r}-${i}`}>
            {i > 0 && ' · '}
            {named ? (
              named
            ) : snowflake(r) ? (
              <span className="font-mono tabular">{r}</span>
            ) : (
              r
            )}
          </span>
        )
      })}
    </p>
  )
}

/** The channels under one category in the plan. */
function PlanChannels({
  channels,
  dryRun,
  groupKey,
}: {
  channels: PlanChannel[]
  dryRun: boolean
  groupKey: string
}) {
  if (channels.length === 0) return null
  return (
    <ul className="divide-y divide-[var(--color-line)]">
      {channels.map((c, i) => (
        <li
          key={c.id ?? `${groupKey}-${c.key}-${i}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
          {c.id && <span className="font-mono text-[11px] tabular text-[var(--color-faint)]">{c.id}</span>}
          {c.state && <PlanChip state={c.state} dryRun={dryRun} />}
        </li>
      ))}
    </ul>
  )
}

/** Same pill as StateChip, in the future tense while the run is only a plan. */
function PlanChip({ state, dryRun }: { state: PlanState; dryRun: boolean }) {
  const labels: Record<PlanState, string> = dryRun
    ? { new: 'will create', exists: 'in place', failed: 'failed' }
    : { new: 'created', exists: 'found', failed: 'failed' }
  const styles: Record<PlanState, string> = {
    new: 'border-[var(--color-brand-deep)]/40 bg-[var(--color-brand)]/15 text-[var(--color-brand-deep)]',
    exists: 'border-[var(--color-line-2)] text-[var(--color-muted)]',
    failed: 'border-[var(--color-red)]/40 bg-[var(--color-red)]/10 text-[var(--color-red)]',
  }
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${styles[state]}`}
    >
      {labels[state]}
    </span>
  )
}

/** What the role sync looked at, what it moved, and who. */
function RoleSyncView({ report }: { report: ReconcileReport }) {
  return (
    <div className="mt-5 border-t border-[var(--color-line)] pt-4">
      <span className="block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        Role sync
      </span>

      {(report.checked !== null || report.changed !== null) && (
        <dl className="mt-2 grid grid-cols-2 gap-3">
          {/* A tally we were never given is a dash, never a zero. */}
          <Count label="Checked" value={report.checked ?? '—'} />
          <Count label="Changed" value={report.changed ?? '—'} />
        </dl>
      )}

      {report.members.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--color-line)]">
          {report.members.map((m, i) => (
            <li key={`${m.key}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.name}</span>
              {m.detail && (
                <span className="font-mono text-[11px] text-[var(--color-muted)]">{m.detail}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {report.changed === 0 && report.members.length === 0 && !report.note && (
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Every member's Discord roles already matched their license — nothing to change.
        </p>
      )}

      {report.note && <p className="mt-3 text-sm text-[var(--color-muted)]">{report.note}</p>}

      {report.warnings.length > 0 && <Callout title="Needs your attention" lines={report.warnings} />}
    </div>
  )
}

/**
 * Who got linked, who got the role, and — the part worth reading — who was left
 * alone. The ambiguous list is a deliberate non-action, so it says so in words
 * before it names anybody.
 */
function LinkDriversView({ report }: { report: LinkReport }) {
  const anyCount =
    report.considered !== null ||
    report.linkedCount !== null ||
    report.grantedCount !== null ||
    report.alreadyLinked !== null

  const anyList =
    report.linked.length > 0 || report.granted.length > 0 || report.ambiguous.length > 0

  return (
    <div className="mt-5 border-t border-[var(--color-line)] pt-4">
      <span className="block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        Driver linking
      </span>

      {anyCount && (
        <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* A tally we were never given is a dash, never a zero. */}
          <Count label="Considered" value={report.considered ?? '—'} />
          <Count label="Linked" value={report.linkedCount ?? '—'} />
          <Count label="Granted" value={report.grantedCount ?? '—'} />
          <Count label="Already linked" value={report.alreadyLinked ?? '—'} />
        </dl>
      )}

      {report.linked.length > 0 && (
        <div className="mt-4">
          <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
            Newly linked
          </span>
          <ul className="divide-y divide-[var(--color-line)]">
            {report.linked.map((l, i) => (
              <li key={`${l.key}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{l.driver}</span>
                <span aria-hidden="true" className="text-sm text-[var(--color-faint)]">→</span>
                <span className="sr-only">linked to</span>
                <span className="font-mono text-[11px] text-[var(--color-muted)]">
                  {l.label || 'a Discord account'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.granted.length > 0 && (
        <div className="mt-4">
          <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
            Given the League Member role
          </span>
          <ul className="divide-y divide-[var(--color-line)]">
            {report.granted.map((name, i) => (
              <li key={`${name}-${i}`} className="py-2 text-sm font-semibold">
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.ambiguous.length > 0 && (
        <div className="mt-4">
          <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
            Left alone
          </span>
          <p className="text-sm text-[var(--color-muted)]">
            More than one person plausibly matched each of these drivers, so nothing was linked and
            no role was handed out — a wrong guess is worse than waiting. Each one sorts itself out
            the moment that driver signs in to the site with Discord.
          </p>
          <ul className="mt-1 divide-y divide-[var(--color-line)]">
            {report.ambiguous.map((a, i) => (
              <li key={`${a.key}-${i}`} className="py-2">
                <span className="block text-sm font-semibold">{a.driver}</span>
                {a.candidates.length > 0 && (
                  <span className="mt-0.5 block font-mono text-[11px] text-[var(--color-muted)]">
                    {a.candidates.join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {anyCount && !anyList && !report.note && (
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Nothing new to link — everyone who could be matched already has their account and their
          role.
        </p>
      )}

      {report.note && <p className="mt-3 text-sm text-[var(--color-muted)]">{report.note}</p>}

      {report.warnings.length > 0 && <Callout title="Needs your attention" lines={report.warnings} />}

      {!anyCount && !anyList && !report.note && report.warnings.length === 0 && (
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          The run finished, but nothing came back to show.
        </p>
      )}
    </div>
  )
}

/**
 * Who is overdue, or who went — the same block for the rehearsal and the real
 * run. Deliberately plainer than the reports above it: no state chips and no
 * tallies for their own sake, because a list of people about to lose their place
 * in the server should read like a list of people, not like a build log.
 */
function PruneView({ report }: { report: PruneReport }) {
  // The list is the truthful count; the tally only stands in when the function
  // counted people without naming them.
  const due = report.candidates.length || report.dueCount || 0

  return (
    <div className="mt-5 border-t border-[var(--color-line)] pt-4">
      <span className="block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        {report.dryRun ? 'Preview — nobody has been removed' : 'Removals'}
      </span>

      {/* The ceiling held, which means the list below is not the whole story. */}
      {report.capped && (
        <Callout
          title="More people matched than the ceiling allows"
          lines={[
            report.overCap !== null
              ? `${report.overCap} more ${report.overCap === 1 ? 'person is' : 'people are'} overdue than one run will take.`
              : 'More people are overdue than one run will take.',
            'The run stops at the ceiling rather than carrying on. Raise “most removals per run” if that is what you want, or run this again once these are done.',
          ]}
        />
      )}

      {report.dryRun &&
        (due < 1 ? (
          <p className="mt-2 text-sm text-[var(--color-muted)]">Nobody is overdue.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              {due} {due === 1 ? 'person is' : 'people are'} overdue.
            </p>
            {report.candidates.length > 0 ? (
              <PruneRows rows={report.candidates} groupKey="due" />
            ) : (
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                The preview counted them but didn’t name them.
              </p>
            )}
          </>
        ))}

      {!report.dryRun && (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-3">
            <Count label="Removed" value={report.kicked.length} />
            <Count label="Left alone" value={report.spared.length} />
          </dl>

          {report.kicked.length > 0 && (
            <div className="mt-4">
              <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
                Removed
              </span>
              <PruneRows rows={report.kicked} groupKey="kicked" />
            </div>
          )}

          {report.spared.length > 0 && (
            <div className="mt-4">
              <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
                Left alone
              </span>
              <p className="text-sm text-[var(--color-muted)]">
                These came up in the check and were kept — they had onboarded after all, or the run
                reached its ceiling before it got to them.
              </p>
              <PruneRows rows={report.spared} groupKey="spared" />
            </div>
          )}

          {report.kicked.length === 0 && report.failed.length === 0 && !report.note && (
            <p className="mt-2 text-sm text-[var(--color-muted)]">Nobody was removed.</p>
          )}
        </>
      )}

      {/* A refusal from Discord is the one thing here that is genuinely wrong,
          and the likeliest cause is a permission the bot has never been given. */}
      {report.failed.length > 0 && (
        <div className="mt-4 rounded-lg border border-[var(--color-red)]/40 bg-[var(--color-red)]/10 px-4 py-3">
          <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-red)]">
            Could not be removed
          </span>
          <ul className="mt-1.5 space-y-1 text-sm text-[var(--color-ink-2)]">
            {report.failed.map((f, i) => (
              <li key={`failed-${f.key}-${i}`}>
                <span className="font-semibold">{f.label}</span>
                {f.detail && <span> — {f.detail}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            Usually the bot is missing the Kick Members permission, or its role sits below theirs in
            the list. Both are fixed in Server Settings → Roles, and this can be run again after.
          </p>
        </div>
      )}

      {report.note && <p className="mt-3 text-sm text-[var(--color-muted)]">{report.note}</p>}

      {report.warnings.length > 0 && <Callout title="Needs your attention" lines={report.warnings} />}
    </div>
  )
}

/** One person per row: who they are, when they joined, how long they've waited. */
function PruneRows({ rows, groupKey }: { rows: PruneRow[]; groupKey: string }) {
  if (rows.length === 0) return null
  return (
    <ul className="divide-y divide-[var(--color-line)]">
      {rows.map((r, i) => (
        <li
          key={`${groupKey}-${r.key}-${i}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.label}</span>
          {r.joined && (
            <span className="font-mono text-[11px] tabular text-[var(--color-faint)]">
              joined {fmtStamp(r.joined)}
            </span>
          )}
          {r.days !== null && (
            <span className="font-mono text-[11px] tabular text-[var(--color-muted)]">
              {fmtDays(r.days)} pending
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * What the safety run set, or would set — the same block for the rehearsal and
 * the real run, with only the tense of the chips changing. A setting the bot
 * couldn't touch gets its own red block rather than a chip in a list: a
 * half-applied server is the one outcome worth noticing here.
 */
function CommunityView({ report }: { report: CommunityReport }) {
  const nothing =
    report.applied.length === 0 &&
    report.skipped.length === 0 &&
    report.failed.length === 0 &&
    report.warnings.length === 0 &&
    !report.raidNote &&
    !report.note

  return (
    <div className="mt-5 border-t border-[var(--color-line)] pt-4">
      <span className="block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        {report.dryRun ? 'Preview — nothing has been changed yet' : 'Safety & onboarding'}
      </span>

      <CommunitySteps
        title={report.dryRun ? 'Would be set' : 'Set'}
        steps={report.applied}
        dryRun={report.dryRun}
        groupKey="applied"
      />

      {report.skipped.length > 0 && (
        <div className="mt-4">
          <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
            Left alone
          </span>
          <p className="text-sm text-[var(--color-muted)]">
            These already matched what the league wants, so they weren't touched.
          </p>
          <CommunitySteps steps={report.skipped} dryRun={report.dryRun} groupKey="skipped" />
        </div>
      )}

      {/* A refusal from Discord, which almost always means a permission the bot
          doesn't have — so the block names the fix, not just the failure. */}
      {report.failed.length > 0 && (
        <div className="mt-4 rounded-lg border border-[var(--color-red)]/40 bg-[var(--color-red)]/10 px-4 py-3">
          <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-red)]">
            Could not be set
          </span>
          <ul className="mt-1.5 space-y-1 text-sm text-[var(--color-ink-2)]">
            {report.failed.map((f, i) => (
              <li key={`community-failed-${f.key}-${i}`}>
                <span className="font-semibold">{f.label}</span>
                {f.detail && <span> — {f.detail}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            Everything else on the list still went through. Usually the bot is missing a permission —
            fix it in Server Settings → Roles, then preview and apply again.
          </p>
        </div>
      )}

      {report.note && <p className="mt-3 text-sm text-[var(--color-muted)]">{report.note}</p>}

      {report.warnings.length > 0 && <Callout title="Needs your attention" lines={report.warnings} />}

      {/* Raid protection can't be turned on through the API at all, so this is
          the one thing the run can only ever tell somebody about. */}
      {report.raidNote && <Callout title="One switch you still have to flick yourself" lines={[report.raidNote]} />}

      {nothing && (
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          The run finished, but nothing came back to show.
        </p>
      )}
    </div>
  )
}

/** One setting per row: what it is, what it's set to, and where it stands. */
function CommunitySteps({
  title,
  steps,
  dryRun,
  groupKey,
}: {
  title?: string
  steps: CommunityStep[]
  dryRun: boolean
  groupKey: string
}) {
  if (steps.length === 0) return null
  return (
    <div className="mt-4">
      {title && (
        <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
          {title}
        </span>
      )}
      <ul className="divide-y divide-[var(--color-line)]">
        {steps.map((s, i) => (
          <li
            key={`${groupKey}-${s.key}-${i}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.label}</span>
            {s.detail && (
              <span className="font-mono text-[11px] text-[var(--color-muted)]">{s.detail}</span>
            )}
            <CommunityChip outcome={s.outcome} dryRun={dryRun} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Same pill as StateChip, in the future tense while the run is only a plan. */
function CommunityChip({ outcome, dryRun }: { outcome: CommunityOutcome; dryRun: boolean }) {
  const labels: Record<CommunityOutcome, string> = dryRun
    ? { applied: 'will set', skipped: 'in place', failed: 'failed' }
    : { applied: 'set', skipped: 'in place', failed: 'failed' }
  const styles: Record<CommunityOutcome, string> = {
    applied: 'border-[var(--color-brand-deep)]/40 bg-[var(--color-brand)]/15 text-[var(--color-brand-deep)]',
    skipped: 'border-[var(--color-line-2)] text-[var(--color-muted)]',
    failed: 'border-[var(--color-red)]/40 bg-[var(--color-red)]/10 text-[var(--color-red)]',
  }
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${styles[outcome]}`}
    >
      {labels[outcome]}
    </span>
  )
}

/**
 * Accessible switch — 44px hit target, brand yellow when on. The same control
 * the automation panel uses, so a toggle behaves the same wherever a
 * commissioner meets one.
 */
function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        {hint && <div className="text-xs text-[var(--color-muted)]">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center"
      >
        <span
          aria-hidden="true"
          className={`relative inline-block h-7 w-12 rounded-full border transition-colors ${
            checked
              ? 'border-[var(--color-brand)] bg-[var(--color-brand)]'
              : 'border-[var(--color-line-2)] bg-[var(--color-mist)]'
          }`}
        >
          <span
            className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-[left] ${
              checked
                ? 'left-[calc(100%-1.5rem)] bg-black'
                : 'left-1 bg-white shadow-[inset_0_0_0_1px_var(--color-line-2)]'
            }`}
          />
        </span>
      </button>
    </div>
  )
}

function Count({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cloud)] px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{label}</dt>
      <dd className="tabular text-xl font-bold">{value}</dd>
    </div>
  )
}
