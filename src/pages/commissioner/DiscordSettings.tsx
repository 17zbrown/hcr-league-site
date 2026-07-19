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

export default function DiscordSettings() {
  const [form, setForm] = useState<Cfg>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('discord_config').select('*').eq('id', 1).maybeSingle().then(({ data, error }) => {
      if (error) setErr(error.message)
      if (data) {
        const next = { ...EMPTY }
        for (const k of Object.keys(EMPTY) as (keyof Cfg)[]) {
          const v = (data as Record<string, unknown>)[k]
          if (typeof v === 'boolean') (next[k] as boolean) = v
          else (next[k] as string) = (v as string) ?? ''
        }
        setForm(next)
      }
      setLoading(false)
    })
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

  const field = (key: keyof Cfg, label: string, hint?: string) => (
    <label className="block">
      <span className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</span>
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

  return (
    <div>
      <h2 className="mb-2 text-3xl">Discord</h2>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-muted)]">
        Connect the league Discord so server roles decide who gets which portal, and so results and
        license promotions post themselves. Turn on Developer Mode in Discord, then right-click a
        server, role or channel and choose <strong>Copy ID</strong>.
      </p>

      <form onSubmit={save} className="max-w-2xl space-y-6">
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-display text-xl font-extrabold uppercase">Integration</div>
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
          <legend className="px-2 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">Server</legend>
          <div className="mt-2">{field('guild_id', 'Server (guild) ID')}</div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <legend className="px-2 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">Portal access</legend>
          {field('role_site_admin', 'Admin role', 'Holders get the Admin portal.')}
          {field('role_site_race_control', 'Race Control role', 'Holders get the Race Control portal.')}
        </fieldset>

        <fieldset className="grid gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 sm:grid-cols-2">
          <legend className="px-2 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">License roles (auto-assigned)</legend>
          {field('role_bronze', 'Bronze')}
          {field('role_silver', 'Silver')}
          {field('role_gold', 'Gold')}
          {field('role_platinum', 'Platinum')}
        </fieldset>

        <fieldset className="grid gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 sm:grid-cols-2">
          <legend className="px-2 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">Channels</legend>
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
