// The Discord automations panel — what runs by itself, whether it is switched on,
// and how the last run went.
//
// Everything the league syncs to Discord now happens on a schedule rather than by
// somebody pressing a button, which is better right up until something breaks
// quietly at 03:22 and nobody finds out for a fortnight. This panel exists so the
// answer to "is it working?" costs one glance and triggers nothing.
//
// Status comes from public.discord_automations, which the cron helper and a
// once-a-minute reconciler keep up to date. "Run now" goes straight to the edge
// function with the admin's own session and then records the reply through the same
// RPC, so a manual run and a scheduled one leave identical evidence.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export interface AutomationRow {
  key: string
  label: string
  description: string
  cadence: string
  enabled: boolean
  last_run_at: string | null
  last_status: 'ok' | 'warning' | 'skipped' | 'error' | 'running' | null
  last_summary: string | null
  last_duration_ms: number | null
  consecutive_failures: number
}

/**
 * Shared with DiscordSettings — one switch, so the two panels can't drift into
 * looking like different products.
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
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
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
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

/**
 * "3 minutes ago". Absolute timestamps are the wrong unit for this panel — the
 * question is never "when exactly", it is "recently enough that I can stop
 * worrying", and a relative figure answers that without arithmetic.
 */
function ago(iso: string | null): string {
  if (!iso) return 'never'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'never'
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 45) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

const STATUS: Record<string, { text: string; className: string }> = {
  ok:      { text: 'Working',  className: 'bg-[var(--color-green)]/15 text-[var(--color-green)]' },
  warning: { text: 'Check it', className: 'bg-[var(--color-brand)]/25 text-[var(--color-ink)]' },
  skipped: { text: 'Idle',     className: 'bg-[var(--color-mist)] text-[var(--color-muted)]' },
  error:   { text: 'Failing',  className: 'bg-[var(--color-red)]/15 text-[var(--color-red)]' },
  running: { text: 'Running',  className: 'bg-[var(--color-mist)] text-[var(--color-muted)]' },
}

function StatusPill({ status, off }: { status: string | null; off: boolean }) {
  // A switched-off job hasn't failed, whatever its last run said months ago.
  // Showing a stale red badge next to an off switch reads as a fault to chase.
  if (off) {
    return (
      <span className="rounded-full bg-[var(--color-mist)] px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        Off
      </span>
    )
  }
  const s = STATUS[status ?? ''] ?? { text: 'No runs yet', className: 'bg-[var(--color-mist)] text-[var(--color-muted)]' }
  return (
    <span className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ${s.className}`}>
      {s.text}
    </span>
  )
}

export default function DiscordAutomations() {
  const qc = useQueryClient()
  const [runningKey, setRunningKey] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['discord-automations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discord_automations')
        .select('key, label, description, cadence, enabled, last_run_at, last_status, last_summary, last_duration_ms, consecutive_failures')
        .order('sort')
      if (error) throw error
      return (data ?? []) as AutomationRow[]
    },
    // A scheduled job finishing while somebody is looking at this page should
    // show up without a reload — that is most of the point of the panel.
    refetchInterval: 30_000,
  })

  const toggle = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const { error } = await supabase.from('discord_automations').update({ enabled }).eq('key', key)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discord-automations'] }),
    onError: (e: Error) => setErr(e.message),
  })

  /**
   * Invoke the function with the admin's own session, then record the reply.
   *
   * Deliberately a plain fetch rather than supabase.functions.invoke: invoke throws
   * away the HTTP status on a non-2xx and hands back a generic string, and the
   * status is exactly what tells the difference between "the gateway refused us"
   * and "the function ran and reported a problem".
   */
  const runNow = async (row: AutomationRow) => {
    setRunningKey(row.key)
    setErr(null)
    const started = Date.now()
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) throw new Error('Your session has expired — sign in again.')

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${row.key}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        // The stored payload belongs to the scheduled run. A manual run sends an
        // empty body so it gets each function's own safe default — pressing a
        // button here should never be the more destructive of the two paths.
        body: '{}',
      })
      const text = await res.text()

      await supabase.rpc('discord_automation_record', {
        p_key: row.key,
        p_http_status: res.status,
        p_body: text,
        p_duration_ms: Date.now() - started,
      })
    } catch (e) {
      setErr(`Could not run ${row.label} — ${String((e as Error)?.message ?? e)}`)
    } finally {
      setRunningKey(null)
      qc.invalidateQueries({ queryKey: ['discord-automations'] })
    }
  }

  const rows = data ?? []
  const failing = rows.filter((r) => r.enabled && r.last_status === 'error')
  const neverRun = rows.filter((r) => r.enabled && !r.last_run_at)

  return (
    <section className="mb-6 max-w-2xl rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
      <h3 className="text-xl">Automations</h3>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Everything the league keeps in step with Discord, and whether it is working. These run on
        their own — the buttons are only for when you don't want to wait.
      </p>

      <div aria-live="polite">
        {err && (
          <p className="mt-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">{err}</p>
        )}

        {failing.length > 0 && (
          <div className="mt-4 rounded-lg border border-[var(--color-red)]/40 bg-[var(--color-red)]/10 px-4 py-3">
            <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-red)]">
              {failing.length} automation{failing.length === 1 ? ' is' : 's are'} failing
            </span>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              {failing.map((f) => f.label).join(', ')}. The reason is under each one below.
            </p>
          </div>
        )}

        {failing.length === 0 && neverRun.length > 0 && (
          <div className="mt-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-cloud)] px-4 py-3">
            <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
              Waiting for a first run
            </span>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              {neverRun.length} of these haven't run yet. If that doesn't change within the hour, the{' '}
              <span className="font-mono">service_role_key</span> secret is probably still missing from
              Supabase Vault — nothing can be called without it.
            </p>
          </div>
        )}
      </div>

      {isLoading && <p className="mt-4 text-sm text-[var(--color-muted)]">Loading…</p>}

      <ul className="mt-4 divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
        {rows.map((row) => (
          <li key={row.key} className="py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{row.label}</span>
                  <StatusPill status={row.last_status} off={!row.enabled} />
                </div>
                <p className="mt-1 text-sm text-[var(--color-muted)]">{row.description}</p>
              </div>
              <div className="shrink-0">
                <Switch
                  checked={row.enabled}
                  onChange={(next) => toggle.mutate({ key: row.key, enabled: next })}
                  label={`${row.label} — ${row.enabled ? 'on' : 'off'}`}
                />
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-wider text-[var(--color-faint)]">
              <span>{row.cadence}</span>
              <span>Last run {ago(row.last_run_at)}</span>
              {row.last_duration_ms != null && <span>{(row.last_duration_ms / 1000).toFixed(1)}s</span>}
              {row.consecutive_failures > 1 && (
                <span className="text-[var(--color-red)]">{row.consecutive_failures} failures in a row</span>
              )}
            </div>

            {row.last_summary && (
              <p
                className={`mt-1.5 text-sm ${
                  row.last_status === 'error' ? 'text-[var(--color-red)]' : 'text-[var(--color-ink-2)]'
                }`}
              >
                {row.last_summary}
              </p>
            )}

            <div className="mt-2">
              <button
                type="button"
                onClick={() => runNow(row)}
                disabled={runningKey !== null}
                aria-busy={runningKey === row.key}
                className="hcr-btn hcr-btn-ghost"
              >
                {runningKey === row.key ? 'Running…' : 'Run now'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-[var(--color-faint)]">
        Turning one off stops both the scheduled run and anything the site would have triggered
        itself — a switch here is the whole answer, not half of it.
      </p>
    </section>
  )
}
