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

  const guilds = (Array.isArray(body.guilds) ? body.guilds : [])
    .map((g) => {
      const o = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>
      const id = snowflake(o.id)
      return id ? { id, name: text(o.name) || 'Unnamed server' } : null
    })
    .filter((g): g is { id: string; name: string } => g !== null)

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

/**
 * `functions.invoke` swallows the response body on a non-2xx and hands back a
 * bare "Edge Function returned a non-2xx status code" — useless to a
 * commissioner. Dig the `{ error }` our functions actually send out of the
 * Response it stashes on the error, and treat a 200 that carries `{ error }`
 * the same way.
 */
async function invokeFn(
  name: string,
): Promise<{ body: Record<string, unknown> | null; error: string | null }> {
  try {
    const res = await supabase.functions.invoke<Record<string, unknown>>(name)
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

export default function DiscordSettings() {
  const [form, setForm] = useState<Cfg>(EMPTY)
  const [provisionedAt, setProvisionedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [running, setRunning] = useState<'setup' | 'events' | null>(null)
  const [setupErr, setSetupErr] = useState<string | null>(null)
  const [setupReport, setSetupReport] = useState<SetupReport | null>(null)
  const [eventsErr, setEventsErr] = useState<string | null>(null)
  const [eventsReport, setEventsReport] = useState<EventsReport | null>(null)

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

  // Read once on mount; provision() re-runs loadConfig by hand afterwards.
  useEffect(() => {
    loadConfig().finally(() => setLoading(false))
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

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cloud)] px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{label}</dt>
      <dd className="tabular text-xl font-bold">{value}</dd>
    </div>
  )
}
