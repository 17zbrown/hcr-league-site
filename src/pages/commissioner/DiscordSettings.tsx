import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Skeleton } from '../../components/ui'
import DiscordAutomations, { Switch } from './DiscordAutomations'

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

const num = (v: unknown): number | null => {
  if (Array.isArray(v)) return v.length
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  const s = text(v).trim()
  return /^\d+$/.test(s) ? Number(s) : null
}

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

interface LayoutDeletion {
  name: string
  action: 'delete' | 'skip'
  reason: string
}
interface LayoutReport {
  dryRun: boolean
  categoryOrder: string[]
  channels: LayoutDeletion[]
  categories: LayoutDeletion[]
  roles: LayoutDeletion[]
  appliedSummary: string[]
  warnings: string[]
  note: string | null
}

const toLayoutDeletions = (raw: unknown): LayoutDeletion[] =>
  (Array.isArray(raw) ? raw : [])
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const o = entry as Record<string, unknown>
      const name = text(o.name)
      if (!name) return null
      return {
        name,
        action: o.action === 'delete' ? ('delete' as const) : ('skip' as const),
        reason: text(o.reason) || '',
      }
    })
    .filter((d): d is LayoutDeletion => d !== null)

const readLayoutReport = (body: Record<string, unknown>, asked: boolean): LayoutReport => {
  const dryRun = typeof body.dryRun === 'boolean' ? body.dryRun : asked
  const plan = (body.plan && typeof body.plan === 'object' ? body.plan : {}) as Record<string, unknown>
  const applied = (body.applied && typeof body.applied === 'object' ? body.applied : null) as Record<string, unknown> | null

  // The applied block is counts and name-lists; flatten it into plain sentences
  // rather than making the card understand five separate shapes.
  const summary: string[] = []
  if (applied) {
    const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    const cats = n(applied.categoriesReordered)
    const chans = n(applied.channelsReordered)
    if (cats) summary.push(`Reordered ${cats} categor${cats === 1 ? 'y' : 'ies'}.`)
    if (chans) summary.push(`Reordered ${chans} channel${chans === 1 ? '' : 's'}.`)
    const list = (v: unknown) => toStrings(v)
    const delChans = list(applied.channelsDeleted)
    const delCats = list(applied.categoriesDeleted)
    const delRoles = list(applied.rolesDeleted)
    if (delChans.length) summary.push(`Deleted ${delChans.length} channel${delChans.length === 1 ? '' : 's'}: ${delChans.join(', ')}.`)
    if (delCats.length) summary.push(`Deleted ${delCats.length} empty categor${delCats.length === 1 ? 'y' : 'ies'}: ${delCats.join(', ')}.`)
    if (delRoles.length) summary.push(`Deleted ${delRoles.length} role${delRoles.length === 1 ? '' : 's'}: ${delRoles.join(', ')}.`)
  }

  return {
    dryRun,
    categoryOrder: toStrings(plan.categoryOrder),
    channels: toLayoutDeletions(plan.channels),
    categories: toLayoutDeletions(plan.categories),
    roles: toLayoutDeletions(plan.roles),
    appliedSummary: summary,
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

/**
 * The layout run is mostly harmless — reordering a sidebar is undoable by dragging
 * — but the same button can delete empty categories and named roles, and deleting
 * a role takes it off everybody who had it. So the confirm names the destructive
 * half specifically rather than talking about "changes".
 */
const LAYOUT_CONFIRM = [
  'Apply the server layout?',
  '',
  'Categories are reordered so START HERE, LEAGUE, PADDOCK, ENDURANCE, RACE CONTROL and ADMIN sit at the top, and ARCHIVE drops to the bottom. Channels inside each category are put in a sensible reading order too.',
  '',
  'Anything listed above as "will be deleted" goes as well. Empty categories hold nothing. A channel is only ever deleted if it has never held a message — one with history is skipped no matter what. Deleting a role removes it from everyone who had it, and that cannot be undone from here.',
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
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

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

  const [layoutRunning, setLayoutRunning] = useState<'preview' | 'apply' | null>(null)
  const [layoutErr, setLayoutErr] = useState<string | null>(null)
  const [layoutPreview, setLayoutPreview] = useState<LayoutReport | null>(null)
  const [layoutDone, setLayoutDone] = useState<LayoutReport | null>(null)
  // Off by default. Reordering is reversible by dragging; removing the husks is
  // not, so it takes a deliberate tick rather than riding along with the reorder.
  const [layoutTidy, setLayoutTidy] = useState(false)

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
    if (pruneRunning !== null) return
    setPruneRunning('preview'); setPruneErr(null); setPrunePreview(null); setPruneDone(null)
    const { body, error } = await invokeFn('discord-prune-pending', { dryRun: true })
    if (error) { setPruneErr(error); setPruneRunning(null); return }
    setPrunePreview(readPruneReport(body ?? {}, true))
    setPruneRunning(null)
  }

  const runPrune = async () => {
    // The button is disabled without a preview naming somebody; this is the belt
    // to that brace, and it is worth having twice for a button that removes people.
    if (!prunePreview || pruneDue < 1 || pruneRunning !== null) return
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
  const communityBusy = pruneRunning !== null || communityRunning !== null

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

  /** Same rule as the community card: guild-wide changes never overlap. */
  const layoutBusy =
    pruneRunning !== null || communityRunning !== null || layoutRunning !== null

  // What the tidy tick actually asks for.
  //
  // Empty categories are the general case: any container holding nothing, which
  // after the rebuild means the six legacy ones it emptied out.
  //
  // The rest is a specific, one-time clear-out of what the old server accumulated,
  // agreed item by item. #verification and Verified did a job Discord's own rules
  // screening now does. Clanker was never used. General, Season 0 Driver and
  // Browner are leftovers from before the league had a shape.
  //
  // Named by id rather than by name on purpose — a future channel that happens to
  // be called "verification", or a new role called "General", can never be caught
  // by this list. Once the server is clean these can go.
  const RETIRED_CHANNELS = [
    '1533477093617303713', // #verification
  ]
  const RETIRED_ROLES = [
    '1500995319599726746', // Verified — 57 members, replaced by rules screening
    '1500988211890225203', // Clanker — 0 members
    '1500998379310809128', // General — 8 members
    '1519813359363428576', // Season 0 Driver — 4 members, abandoned partway
    '1524422713681117330', // Browner — 2 members
  ]

  const layoutPayload = (dryRun: boolean) => ({
    dryRun,
    reorder: true,
    deleteEmptyCategories: layoutTidy,
    ...(layoutTidy ? { deleteChannelIds: RETIRED_CHANNELS, deleteRoleIds: RETIRED_ROLES } : {}),
  })

  // Rehearsal only: the function describes the order it would set and lists every
  // deletion with a verdict, and touches nothing.
  const previewLayout = async () => {
    if (layoutBusy) return
    setLayoutRunning('preview'); setLayoutErr(null); setLayoutPreview(null); setLayoutDone(null)
    const { body, error } = await invokeFn('discord-layout', layoutPayload(true))
    if (error) { setLayoutErr(error); setLayoutRunning(null); return }
    setLayoutPreview(readLayoutReport(body ?? {}, true))
    setLayoutRunning(null)
  }

  const applyLayout = async () => {
    if (!layoutPreview || layoutBusy) return
    if (!window.confirm(LAYOUT_CONFIRM)) return
    setLayoutRunning('apply'); setLayoutErr(null); setLayoutDone(null)
    const { body, error } = await invokeFn('discord-layout', layoutPayload(false))
    if (error) { setLayoutErr(error); setLayoutRunning(null); return }
    setLayoutDone(readLayoutReport(body ?? {}, false))
    // The preview described a server that has just changed shape — drop it, which
    // also re-locks the button until somebody reads a fresh one.
    setLayoutPreview(null)
    // Deleting a role clears the config pointer that referenced it, so pull the
    // form back in rather than leaving a stale id on screen.
    await loadConfig(true)
    setLayoutRunning(null)
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

  // A rebuild gates its categories by role ID; the panel already knows the names
  // of the roles it manages, so show "Bronze" rather than an 18-digit number.
  const roleNames = new Map<string, string>()
  for (const f of NAMED_ROLE_FIELDS) {
    const id = form[f.key]
    if (typeof id === 'string' && id) roleNames.set(id, f.label)
  }

  return (
    <div>
      <h2 className="mb-2 text-3xl">Discord</h2>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-muted)]">
        Connect the league Discord so server roles decide who gets which portal, and so results and
        license promotions post themselves. Run the setup below once and every ID fills itself in.
      </p>

      {/* ── Automations ─────────────────────────────────────────────────── */}
      {/* The category ordering that used to have its own card here is now one of
          these, so the manual version is gone. What survives below it is the part
          that is NOT automated and never should be: the one-off clear-out. */}
      <DiscordAutomations />

      {/* ── One-off clean-up ────────────────────────────────────────────── */}
      {/* Deliberately not an automation. Everything here is a deletion, it only
          ever needs doing once, and a scheduled job that removes things is a very
          different risk from one that adds them. Once it has run and the server
          looks right, this card has no further use. */}
      <section className="mb-6 max-w-2xl rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <h3 className="text-xl">One-off clean-up</h3>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Clears out what the server rebuild left behind. Run it once and you can forget this card.
          Ordering is handled by the <span className="font-mono">Sidebar order</span> automation
          above, so this is only about removing things.
        </p>

        <ul className="mt-3 space-y-1 text-sm text-[var(--color-ink-2)]">
          <li>
            Six emptied-out legacy categories — Server Landing, Server General, HCR Endurance Team,
            HCR League, Off Track, Stewards&rsquo; Office.
          </li>
          <li>
            The <span className="font-mono">#verification</span> channel, replaced by Discord&rsquo;s
            own rules screening.
          </li>
          <li>Five retired roles — Verified, Clanker, General, Season 0 Driver, Browner.</li>
        </ul>

        <div className="mt-4 border-t border-[var(--color-line)] pt-4">
          <Switch
            checked={layoutTidy}
            onChange={setLayoutTidy}
            label="Include the deletions"
            hint="With this off it only re-orders and removes nothing. A channel that has ever held a message is never deleted either way. Deleting a role takes it off everyone who had it."
          />
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={previewLayout}
            disabled={layoutBusy}
            aria-busy={layoutRunning === 'preview'}
            className="hcr-btn hcr-btn-ghost"
          >
            {layoutRunning === 'preview' ? 'Previewing…' : 'Preview'}
          </button>
          <p className="mt-2 text-xs text-[var(--color-faint)]">
            Previewing lists everything it would remove, with a reason for anything it refuses to
            touch. It changes nothing.
          </p>
        </div>

        <div aria-live="polite">
          {layoutErr && (
            <p className="mt-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
              {layoutErr}
            </p>
          )}
          {layoutPreview && <LayoutView report={layoutPreview} />}
          {layoutDone && <LayoutView report={layoutDone} />}
        </div>

        <div className="mt-5 rounded-lg border border-[var(--color-line)] bg-[var(--color-cloud)] p-4">
          <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
            Apply
          </span>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Deleting a role cannot be undone from here — it comes off everybody who had it.
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={applyLayout}
              disabled={layoutBusy || !layoutPreview}
              aria-busy={layoutRunning === 'apply'}
              aria-describedby="layout-gate"
              className="hcr-btn hcr-btn-primary"
            >
              {layoutRunning === 'apply' ? 'Applying…' : 'Apply clean-up'}
            </button>
          </div>
          <p id="layout-gate" className="mt-2 text-xs text-[var(--color-faint)]">
            {layoutPreview
              ? 'The preview above is what will happen. You\u2019ll be asked to confirm once more.'
              : 'Preview first \u2014 this unlocks once you\u2019ve read what would go.'}
          </p>
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
            disabled={pruneRunning !== null}
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
              disabled={pruneRunning !== null || !prunePreview || pruneDue < 1}
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

function LayoutDeletions({ title, items }: { title: string; items: LayoutDeletion[] }) {
  if (items.length === 0) return null
  const going = items.filter((i) => i.action === 'delete')
  const staying = items.filter((i) => i.action === 'skip')

  return (
    <div className="mt-4">
      <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
        {title}
      </span>
      {going.length > 0 && (
        <ul className="space-y-1 text-sm text-[var(--color-ink-2)]">
          {going.map((d, i) => (
            <li key={`go-${title}-${d.name}-${i}`}>
              <span className="font-mono font-semibold">{d.name}</span>
              {d.reason && <span className="text-[var(--color-muted)]"> — {d.reason}</span>}
            </li>
          ))}
        </ul>
      )}
      {staying.length > 0 && (
        <div className={going.length > 0 ? 'mt-2' : ''}>
          <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
            Left alone
          </span>
          <ul className="space-y-1 text-sm text-[var(--color-muted)]">
            {staying.map((d, i) => (
              <li key={`stay-${title}-${d.name}-${i}`}>
                <span className="font-mono">{d.name}</span>
                {d.reason && <span> — {d.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function LayoutView({ report }: { report: LayoutReport }) {
  const nothing =
    report.categoryOrder.length === 0 &&
    report.channels.length === 0 &&
    report.categories.length === 0 &&
    report.roles.length === 0 &&
    report.appliedSummary.length === 0 &&
    report.warnings.length === 0 &&
    !report.note

  return (
    <div className="mt-5 border-t border-[var(--color-line)] pt-4">
      <span className="block font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        {report.dryRun ? 'Preview — nothing has been changed yet' : 'Server layout'}
      </span>

      {report.categoryOrder.length > 0 && (
        <div className="mt-3">
          <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
            {report.dryRun ? 'Running order it would set' : 'Running order'}
          </span>
          <ol className="space-y-0.5 font-mono text-sm text-[var(--color-ink-2)]">
            {report.categoryOrder.map((line, i) => (
              <li key={`cat-order-${i}`}>{line}</li>
            ))}
          </ol>
        </div>
      )}

      <LayoutDeletions title="Channels" items={report.channels} />
      <LayoutDeletions title="Categories" items={report.categories} />
      <LayoutDeletions title="Roles" items={report.roles} />

      {report.appliedSummary.length > 0 && (
        <div className="mt-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-cloud)] px-4 py-3">
          <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
            What changed
          </span>
          <ul className="mt-1.5 space-y-1 text-sm text-[var(--color-ink-2)]">
            {report.appliedSummary.map((line, i) => (
              <li key={`layout-applied-${i}`}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {report.note && <p className="mt-3 text-sm text-[var(--color-muted)]">{report.note}</p>}

      {report.warnings.length > 0 && <Callout title="Needs your attention" lines={report.warnings} />}

      {nothing && (
        <p className="mt-2 text-sm text-[var(--color-muted)]">The run finished, but nothing came back to show.</p>
      )}
    </div>
  )
}

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

function Count({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cloud)] px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{label}</dt>
      <dd className="tabular text-xl font-bold">{value}</dd>
    </div>
  )
}
