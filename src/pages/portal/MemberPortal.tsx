import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useCurrentSeason, useDrivers, useEvents, useLicenseResults, useProtests } from '../../lib/queries'
import { buildPaceIndex, computeLicense, resultsForDriver } from '../../lib/license'
import { fmtDateLong } from '../../lib/format'
import { Section, Skeleton } from '../../components/ui'
import { LicenseBadge } from '../../components/LicenseBadge'
import { EvidenceBox, type PendingEvidence } from '../../components/EvidenceBox'
import { StatusPill } from '../../components/ProtestThread'

const CATEGORIES = ['Contact', 'Unsafe rejoin', 'Track limits', 'Blocking', 'Unsporting conduct', 'Other']

type Tab = 'overview' | 'file' | 'mine'

export default function MemberPortal() {
  const { profile, session, isRaceControl, isAdmin, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>('overview')
  const [filedNote, setFiledNote] = useState(false)
  const { data: protests } = useProtests({ mine: true, userId: session?.user?.id })

  const selectTab = (id: Tab) => {
    if (id !== 'mine') setFiledNote(false)
    setTab(id)
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'My profile' },
    { id: 'file', label: 'File a protest' },
    { id: 'mine', label: `My protests${protests?.length ? ` (${protests.length})` : ''}` },
  ]

  return (
    <Section eyebrow={`Signed in as ${profile?.display_name ?? profile?.email ?? 'member'}`} title="Member Portal" titleTag="h1">
      {/* staff shortcuts */}
      {(isRaceControl || isAdmin) && (
        <div className="mb-6 flex flex-wrap gap-2">
          {isRaceControl && <Link to="/control" className="hcr-btn hcr-btn-dark !text-xs">Race Control Portal →</Link>}
          {isAdmin && <Link to="/admin" className="hcr-btn hcr-btn-ghost !text-xs">Admin Portal →</Link>}
        </div>
      )}

      <div className="mb-8 flex flex-wrap gap-1 border-b border-[var(--color-line)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTab(t.id)}
            aria-pressed={tab === t.id}
            className={`relative px-5 py-3 font-alt text-sm font-bold uppercase tracking-wide transition-colors ${
              tab === t.id ? 'text-[var(--color-ink)]' : 'text-[var(--color-faint)] hover:text-[var(--color-ink)]'
            }`}
          >
            {t.label}
            {tab === t.id && <span className="absolute inset-x-0 -bottom-px h-[3px] bg-[var(--color-brand)]" />}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview onSignOut={signOut} />}
      {tab === 'file' && <FileProtest onFiled={() => { setFiledNote(true); setTab('mine') }} />}
      {tab === 'mine' && (
        <>
          {filedNote && (
            <p role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--color-green)]/10 px-4 py-3 text-sm text-[var(--color-green)]">
              Protest submitted — race control has been notified.
              <button
                onClick={() => setFiledNote(false)}
                aria-label="Dismiss"
                className="-my-2 inline-flex min-h-11 min-w-11 items-center justify-center font-semibold hover:text-[var(--color-ink)]"
              >
                ✕
              </button>
            </p>
          )}
          <MyProtests />
        </>
      )}
    </Section>
  )
}

/* ---------------- overview ---------------- */
function Overview({ onSignOut }: { onSignOut: () => void }) {
  const { profile, role } = useAuth()
  const { data: drivers } = useDrivers()
  const { data: licenseResults } = useLicenseResults()

  const driver = useMemo(
    () => (drivers ?? []).find((d) => d.id === profile?.driver_id || d.name === profile?.display_name),
    [drivers, profile],
  )
  const license = useMemo(() => {
    if (!driver) return null
    const idx = buildPaceIndex(licenseResults ?? [])
    return computeLicense(resultsForDriver(licenseResults ?? [], driver.name), idx, driver.license_override)
  }, [driver, licenseResults])

  return (
    <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <div className="font-display text-3xl">{profile?.display_name ?? 'Member'}</div>
        <div className="mt-1 text-sm text-[var(--color-muted)]">{profile?.email}</div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--color-mist)] px-3 py-1 font-alt text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-2)]">
            {role === 'race_control' ? 'Race Control' : role === 'admin' ? 'Admin' : 'Member'}
          </span>
          {license && <LicenseBadge tier={license.effective} />}
        </div>
        {driver ? (
          <Link to={`/drivers/${driver.id}`} className="mt-5 inline-block text-sm font-semibold text-[var(--color-blue)]">
            View my driver profile →
          </Link>
        ) : (
          <p className="mt-5 text-sm text-[var(--color-muted)]">
            No driver profile linked yet — the commissioner links your account once your entry is approved.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <h3 className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Account</h3>
        <div className="mt-4 space-y-2">
          <Link to="/account" className="hcr-btn hcr-btn-ghost w-full">Season entry &amp; iRacing details</Link>
          <button onClick={onSignOut} className="hcr-btn hcr-btn-ghost w-full">Sign out</button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- file a protest ---------------- */
function FileProtest({ onFiled }: { onFiled: () => void }) {
  const qc = useQueryClient()
  const { session } = useAuth()
  const { data: season } = useCurrentSeason()
  const { data: events } = useEvents(season?.id)
  const { data: drivers } = useDrivers()

  const [eventId, setEventId] = useState('')
  const [againstId, setAgainstId] = useState('')
  const [lap, setLap] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [summary, setSummary] = useState('')
  const [evidence, setEvidence] = useState<PendingEvidence[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.user) return
    if (!summary.trim()) { setErr('Describe what happened before submitting.'); return }
    setBusy(true)
    setErr(null)
    const against = (drivers ?? []).find((d) => d.id === againstId)
    const { data: created, error } = await supabase
      .from('protests')
      .insert({
        season_id: season?.id ?? null,
        event_id: eventId || null,
        filed_by: session.user.id,
        against_driver_id: againstId || null,
        against_text: against?.name ?? null,
        incident_lap: lap || null,
        category,
        summary: summary.trim(),
      })
      .select('id')
      .single()
    if (error) { setErr(error.message); setBusy(false); return }

    if (evidence.length) {
      const rows = evidence.map((ev) => ({
        protest_id: created.id,
        kind: ev.kind,
        url: ev.url,
        storage_path: ev.storage_path ?? null,
        title: ev.title ?? null,
      }))
      const att = await supabase.from('protest_attachments').insert(rows)
      if (att.error) setErr(att.error.message)
    }
    setBusy(false)
    setSummary(''); setLap(''); setAgainstId(''); setEvidence([])
    qc.invalidateQueries({ queryKey: ['protests'] })
    onFiled()
  }

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-5 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 md:p-8">
      <p className="text-sm text-[var(--color-muted)]">
        Protests go straight to race control. Include the lap and a clip if you can — it gets a decision back to you far faster.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Race</span>
          <select className="hcr-select" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">— Select a round —</option>
            {(events ?? []).map((ev) => (
              <option key={ev.id} value={ev.id}>Round {ev.round} · {ev.name ?? ev.track?.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Driver involved</span>
          <select className="hcr-select" value={againstId} onChange={(e) => setAgainstId(e.target.value)}>
            <option value="">— Select a driver —</option>
            {(drivers ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Lap / time</span>
          <input className="hcr-input" value={lap} onChange={(e) => setLap(e.target.value)} placeholder="e.g. Lap 14, T1" />
        </label>
        <label className="block">
          <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Category</span>
          <select className="hcr-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">What happened</span>
        <textarea
          className="hcr-textarea"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Describe the incident factually — corner, positions, and what you believe went wrong."
          required
        />
      </label>

      <div>
        <span className="mb-2 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Evidence</span>
        <EvidenceBox items={evidence} onChange={setEvidence} disabled={busy} />
      </div>

      {err && <p role="alert" className="rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">{err}</p>}

      <button type="submit" disabled={busy} className="hcr-btn hcr-btn-primary">
        {busy ? 'Submitting…' : 'Submit protest'}
      </button>
    </form>
  )
}

/* ---------------- my protests ---------------- */
function MyProtests() {
  const { session } = useAuth()
  const { data: protests, isLoading } = useProtests({ mine: true, userId: session?.user?.id })

  if (isLoading) return <Skeleton className="h-64 w-full" />
  if (!protests?.length) {
    return (
      <p className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-cloud)] p-8 text-center text-[var(--color-muted)]">
        You haven't filed any protests. Clean racing.
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {protests.map((p) => (
        <li key={p.id}>
          <Link
            to={`/portal/protests/${p.id}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 transition-all hover:-translate-y-0.5 hover:shadow-card"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-xl">{p.category ?? 'Protest'}</span>
                {p.against_text && <span className="text-sm text-[var(--color-muted)]">vs {p.against_text}</span>}
              </div>
              <div className="mt-1.5 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                {p.event ? `Round ${p.event.round} · ${p.event.name ?? p.event.track?.name} · ` : ''}
                Filed {fmtDateLong(p.created_at)}
              </div>
            </div>
            <StatusPill status={p.status} />
          </Link>
        </li>
      ))}
    </ul>
  )
}
