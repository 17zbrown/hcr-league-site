import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useCurrentSeason } from '../../lib/queries'
import { Skeleton, LoadError } from '../../components/ui'
import { fmtDate } from '../../lib/format'

/** Singleton row (id = 1) that drives the story robot. */
interface AutomationSettings {
  results_story_enabled: boolean
  results_story_autopublish: boolean
  preview_enabled: boolean
  preview_lead_hours: number
  preview_autopublish: boolean
}

interface FormState {
  results_story_enabled: boolean
  results_story_autopublish: boolean
  preview_enabled: boolean
  preview_lead_hours: string // string while editing so the field can be cleared
  preview_autopublish: boolean
}

interface EventLite {
  id: string
  round: number
  name: string | null
  status: string
}

interface AutoNewsRow {
  id: string
  title: string
  source: string
  is_published: boolean
  published_at: string | null
  created_at: string
}

const SOURCE_LABELS: Record<string, string> = {
  'auto-results': 'Race report',
  'auto-preview': 'Preview',
}

export default function AutomationAdmin() {
  const qc = useQueryClient()

  const settingsQ = useQuery({
    queryKey: ['automation'],
    queryFn: async (): Promise<AutomationSettings> => {
      const { data, error } = await supabase
        .from('automation_settings')
        .select('*')
        .eq('id', 1)
        .single()
      if (error) throw error
      return data as AutomationSettings
    },
  })

  // Scope the picker to the current season — old rounds from past seasons
  // shouldn't be compose targets.
  const { data: season } = useCurrentSeason()
  const eventsQ = useQuery({
    enabled: !!season?.id,
    queryKey: ['events', 'automation-picker', season?.id],
    queryFn: async (): Promise<EventLite[]> => {
      const { data, error } = await supabase
        .from('events')
        .select('id,round,name,status')
        .eq('season_id', season!.id)
        .order('round')
      if (error) throw error
      return (data ?? []) as EventLite[]
    },
  })

  const logQ = useQuery({
    queryKey: ['news', 'auto'],
    queryFn: async (): Promise<AutoNewsRow[]> => {
      const { data, error } = await supabase
        .from('news')
        .select('id,title,source,is_published,published_at,created_at')
        .in('source', ['auto-results', 'auto-preview'])
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return (data ?? []) as AutoNewsRow[]
    },
  })

  // ── Settings form ──────────────────────────────────────────────────────
  const s = settingsQ.data
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!s) return
    setForm({
      results_story_enabled: s.results_story_enabled,
      results_story_autopublish: s.results_story_autopublish,
      preview_enabled: s.preview_enabled,
      preview_lead_hours: String(s.preview_lead_hours ?? ''),
      preview_autopublish: s.preview_autopublish,
    })
  }, [s])

  const dirty =
    !!s &&
    !!form &&
    (form.results_story_enabled !== s.results_story_enabled ||
      form.results_story_autopublish !== s.results_story_autopublish ||
      form.preview_enabled !== s.preview_enabled ||
      form.preview_autopublish !== s.preview_autopublish ||
      Number(form.preview_lead_hours) !== s.preview_lead_hours)

  const save = async () => {
    if (!form) return
    const hours = Math.round(Number(form.preview_lead_hours))
    if (!Number.isFinite(hours) || hours < 1 || hours > 336) {
      setErr('Preview lead time must be between 1 and 336 hours.')
      return
    }
    setBusy(true)
    setErr(null)
    const { error } = await supabase
      .from('automation_settings')
      .update({
        results_story_enabled: form.results_story_enabled,
        results_story_autopublish: form.results_story_autopublish,
        preview_enabled: form.preview_enabled,
        preview_lead_hours: hours,
        preview_autopublish: form.preview_autopublish,
      })
      .eq('id', 1)
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
    qc.invalidateQueries({ queryKey: ['automation'] })
  }

  // ── Run now ────────────────────────────────────────────────────────────
  const sortedEvents = useMemo(
    () => [...(eventsQ.data ?? [])].sort((a, b) => a.round - b.round),
    [eventsQ.data],
  )
  const [eventId, setEventId] = useState('')
  const [running, setRunning] = useState<'due' | 'report' | 'preview' | null>(null)
  const [dueMsg, setDueMsg] = useState<string | null>(null)
  const [composeMsg, setComposeMsg] = useState<string | null>(null)
  const [runErr, setRunErr] = useState<string | null>(null)

  useEffect(() => {
    if (!eventId && sortedEvents.length) {
      const next = sortedEvents.find((e) => e.status !== 'complete') ?? sortedEvents[0]
      setEventId(next.id)
    }
  }, [sortedEvents, eventId])

  const publishDue = async () => {
    setRunning('due')
    setRunErr(null)
    setDueMsg(null)
    const { data, error } = await supabase.rpc('publish_due_previews')
    setRunning(null)
    if (error) {
      setRunErr(error.message)
      return
    }
    const n = typeof data === 'number' ? data : Number(data ?? 0)
    setDueMsg(n > 0 ? `Published ${n} preview${n === 1 ? '' : 's'}.` : 'No previews were due.')
    if (n > 0) qc.invalidateQueries({ queryKey: ['news'] })
  }

  const compose = async (kind: 'report' | 'preview') => {
    if (!eventId) return
    setRunning(kind)
    setRunErr(null)
    setComposeMsg(null)
    const { data, error } = await supabase.rpc(
      kind === 'report' ? 'compose_results_story' : 'compose_race_preview',
      { p_event_id: eventId },
    )
    setRunning(null)
    if (error) {
      setRunErr(error.message)
      return
    }
    if (data) {
      setComposeMsg('Story created — check the Newsroom.')
      qc.invalidateQueries({ queryKey: ['news'] })
    } else {
      setComposeMsg('Nothing to do (already exists or disabled).')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (settingsQ.isError) {
    return (
      <div>
        <h2 className="mb-6 text-3xl">Story Automation</h2>
        <LoadError what="automation settings" onRetry={() => settingsQ.refetch()} />
      </div>
    )
  }
  // Covers both the query loading and the one render between data arriving
  // and the effect above seeding the form.
  if (settingsQ.isLoading || !form) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <h2 className="mb-2 text-3xl">Story Automation</h2>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-muted)]">
        The newsroom robot writes race reports and race previews for you. Decide what it writes
        and whether stories go live on their own or wait as drafts for a human read-through.
      </p>

      <div className="max-w-3xl space-y-6">
        {/* Race reports */}
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <h3 className="text-xl">Race reports</h3>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            A report is drafted the moment race control imports results.
          </p>
          <div className="mt-4 space-y-3">
            <Toggle
              checked={form.results_story_enabled}
              onChange={(v) => setForm({ ...form, results_story_enabled: v })}
              label="Write race reports"
              hint="Draft a story automatically after every results import."
            />
            <Toggle
              checked={form.results_story_autopublish}
              onChange={(v) => setForm({ ...form, results_story_autopublish: v })}
              label="Publish immediately"
              hint={
                form.results_story_autopublish
                  ? 'New reports go live in the Newsroom right away.'
                  : 'New reports are saved as drafts for review.'
              }
            />
          </div>
        </div>

        {/* Race previews */}
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <h3 className="text-xl">Race previews</h3>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            A preview posts automatically when the countdown enters the window — checked hourly
            at :17 past.
          </p>
          <div className="mt-4 space-y-3">
            <Toggle
              checked={form.preview_enabled}
              onChange={(v) => setForm({ ...form, preview_enabled: v })}
              label="Write race previews"
              hint="Draft a preview for each round as it approaches."
            />
            <div className="flex items-center justify-between gap-4 py-1">
              <div className="min-w-0">
                <label htmlFor="preview-lead-hours" className="block text-sm font-semibold">
                  Lead time
                </label>
                <div className="text-xs text-[var(--color-muted)]">
                  Hours before green flag (1–336).
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <input
                  id="preview-lead-hours"
                  type="number"
                  min={1}
                  max={336}
                  className="hcr-input tabular w-24 text-right"
                  value={form.preview_lead_hours}
                  onChange={(e) => setForm({ ...form, preview_lead_hours: e.target.value })}
                />
                <span className="font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
                  hrs
                </span>
              </div>
            </div>
            <Toggle
              checked={form.preview_autopublish}
              onChange={(v) => setForm({ ...form, preview_autopublish: v })}
              label="Publish immediately"
              hint={
                form.preview_autopublish
                  ? 'Previews go live the moment the window opens.'
                  : 'Previews are saved as drafts for review.'
              }
            />
          </div>
        </div>

        {err && (
          <p className="rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
            {err}
          </p>
        )}

        <button onClick={save} disabled={!dirty || busy} className="hcr-btn hcr-btn-primary">
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save automation settings'}
        </button>

        {/* Run now */}
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <h3 className="text-xl">Run now</h3>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Don't wait for the schedule — fire the robot by hand.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={publishDue}
              disabled={running !== null}
              className="hcr-btn hcr-btn-dark"
            >
              {running === 'due' ? 'Publishing…' : 'Publish due previews'}
            </button>
            {dueMsg && <span className="text-sm text-[var(--color-green)]">{dueMsg}</span>}
          </div>

          <div className="mt-5 border-t border-[var(--color-line)] pt-4">
            <span className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
              Compose for a round
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="hcr-select max-w-xs flex-1"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                aria-label="Round"
              >
                {sortedEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    R{e.round} · {e.name ?? 'TBD'}
                    {e.status === 'complete' ? ' · complete' : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={() => compose('report')}
                disabled={!eventId || running !== null}
                className="hcr-btn hcr-btn-dark"
              >
                {running === 'report' ? 'Composing…' : 'Compose report'}
              </button>
              <button
                onClick={() => compose('preview')}
                disabled={!eventId || running !== null}
                className="hcr-btn hcr-btn-ghost"
              >
                {running === 'preview' ? 'Composing…' : 'Compose preview'}
              </button>
            </div>
            {composeMsg && (
              <p
                className={`mt-3 text-sm ${
                  composeMsg.startsWith('Story created')
                    ? 'text-[var(--color-green)]'
                    : 'text-[var(--color-muted)]'
                }`}
              >
                {composeMsg}
              </p>
            )}
          </div>

          {runErr && (
            <p className="mt-3 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">
              {runErr}
            </p>
          )}
        </div>

        {/* Automation log */}
        <div className="on-navy rounded-2xl border border-[var(--color-line)] bg-[var(--color-deep)] p-5">
          <h3 className="text-xl">Automation log</h3>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Every story the robot has filed, newest first.
          </p>
          <div className="mt-4">
            {logQ.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : logQ.isError ? (
              <p className="text-sm text-[var(--color-muted)]">Couldn't load the log.</p>
            ) : (logQ.data ?? []).length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">
                Nothing filed yet — stories appear here as automation runs.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {(logQ.data ?? []).map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <span
                      className="rounded-full border border-[var(--color-line-2)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-2)]"
                    >
                      {SOURCE_LABELS[row.source] ?? row.source}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {row.title}
                    </span>
                    <span
                      className={`font-mono text-[11px] font-bold uppercase tracking-wider ${
                        row.is_published
                          ? 'text-[var(--color-brand)]'
                          : 'text-[var(--color-muted)]'
                      }`}
                    >
                      {row.is_published ? 'Live' : 'Draft'}
                    </span>
                    <span className="font-mono text-xs tabular text-[var(--color-faint)]">
                      {fmtDate(row.published_at ?? row.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Accessible switch — 44px hit target, brand yellow when on. */
function Toggle({
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
