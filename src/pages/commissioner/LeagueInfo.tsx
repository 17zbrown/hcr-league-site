import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useLeagueSettings } from '../../lib/queries'
import { Skeleton } from '../../components/ui'

export default function LeagueInfo() {
  const qc = useQueryClient()
  const { data: settings, isLoading } = useLeagueSettings()

  const [form, setForm] = useState({
    name: '', tagline: '', timezone: '', discord_url: '', broadcast_url: '', rulebook_url: '',
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (settings) {
      setForm({
        name: settings.name ?? '',
        tagline: settings.tagline ?? '',
        timezone: settings.timezone ?? '',
        discord_url: settings.discord_url ?? '',
        broadcast_url: settings.broadcast_url ?? '',
        rulebook_url: settings.rulebook_url ?? '',
      })
    }
  }, [settings])

  if (isLoading) return <Skeleton className="h-96 w-full" />

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('league_settings').update(form).eq('id', settings!.id)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
    qc.invalidateQueries({ queryKey: ['league_settings'] })
  }

  const field = (key: keyof typeof form, label: string, placeholder = '') => (
    <label className="block">
      <span className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</span>
      <input className="hcr-input" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} />
    </label>
  )

  return (
    <div>
      <h2 className="mb-6 text-3xl">League Info</h2>
      <form onSubmit={save} className="max-w-2xl space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {field('name', 'League name')}
          {field('timezone', 'Timezone', 'ET')}
        </div>
        {field('tagline', 'Tagline')}
        {field('discord_url', 'Discord URL')}
        {field('broadcast_url', 'Broadcast URL')}
        {field('rulebook_url', 'Rulebook URL')}
        {err && <p className="text-sm text-[var(--color-red)]">{err}</p>}
        <button type="submit" disabled={busy} className="hcr-btn hcr-btn-primary">
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
        </button>
      </form>
    </div>
  )
}
