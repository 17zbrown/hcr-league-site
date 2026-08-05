import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useCurrentSeason } from '../lib/queries'
import type { SeasonRegistration } from '../lib/types'
import { Section } from '../components/ui'

/**
 * Typeahead hints per class, drawn from what the grid actually runs. Deliberately a
 * <datalist> and not a <select>: iRacing releases cars mid-season, and a fixed list
 * would turn a legal entry into an impossible one.
 */
const CAR_SUGGESTIONS: Record<string, string[]> = {
  GTP: ['Acura ARX-06', 'Cadillac V-Series.R', 'Porsche 963', 'BMW M Hybrid V8', 'Ferrari 499P'],
  LMP2: ['Dallara P217'],
  GTD: [
    'Ferrari 296 GT3', 'Porsche 911 GT3 R (992)', 'Chevrolet Corvette Z06 GT3.R',
    'Lamborghini Huracan GT3 EVO', 'McLaren 720S GT3 EVO', 'Mercedes-AMG GT3 2020',
    'Audi R8 LMS GT3', 'BMW M4 GT3', 'Aston Martin Vantage GT3 EVO', 'Ford Mustang GT3',
  ],
}

const CLASSES = ['GTP', 'LMP2', 'GTD']

export default function Account() {
  const { profile, session, isAdmin, isManager, signOut, refreshProfile } = useAuth()
  const { data: season } = useCurrentSeason()
  const [reg, setReg] = useState<SeasonRegistration | null>(null)
  const [loading, setLoading] = useState(true)

  const [displayName, setDisplayName] = useState('')
  const [iracingName, setIracingName] = useState('')
  const [iracingCustid, setIracingCustid] = useState('')
  const [category, setCategory] = useState('Bronze')
  const [preferredClass, setPreferredClass] = useState('GTD')
  const [preferredCar, setPreferredCar] = useState('')
  // Two choices, because numbers are league-wide and first come, first served — a
  // single choice leaves whoever asks second with nothing to fall back on.
  const [prefNumber, setPrefNumber] = useState('')
  const [prefNumberAlt, setPrefNumberAlt] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name)
  }, [profile?.display_name])

  useEffect(() => {
    if (!session || !season) return
    let active = true
    supabase
      .from('season_registrations')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('season_id', season.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        setReg(data as SeasonRegistration | null)
        if (data) {
          setIracingName(data.iracing_name ?? '')
          setIracingCustid(data.iracing_custid ?? '')
          setCategory(data.fia_category ?? 'Bronze')
          setPreferredClass(data.preferred_class ?? 'GTD')
          setPreferredCar(data.preferred_car ?? '')
          setPrefNumber(data.preferred_number ?? '')
          setPrefNumberAlt(data.preferred_number_alt ?? '')
          setNotes(data.notes ?? '')
        }
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [session, season, busy])

  const enter = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!season) return
    setBusy(true)
    setError(null)
    setMsg(null)
    const { error } = await supabase.rpc('enter_season', {
      p_season_id: season.id,
      p_display_name: displayName,
      p_fia_category: category,
      p_preferred_class: preferredClass,
      p_preferred_car: preferredCar.trim(),
      p_preferred_number: prefNumber.trim(),
      p_preferred_number_alt: prefNumberAlt.trim(),
      p_notes: notes,
      p_iracing_name: iracingName.trim(),
      p_iracing_custid: iracingCustid.trim(),
    })
    if (error) {
      setError(error.message)
    } else {
      setMsg(reg ? 'Registration updated.' : "You're entered. The commissioner will confirm your grid slot.")
      await refreshProfile()
    }
    setBusy(false)
  }

  return (
    <Section eyebrow={`Signed in as ${profile?.email ?? ''}`} title="My Account">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
        {/* left: identity + portals */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
            <div className="font-display text-3xl">{profile?.display_name ?? 'Member'}</div>
            <div className="mt-1 text-sm text-[var(--color-muted)]">{profile?.email}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              {isAdmin && <span className="rounded-full bg-[var(--color-brand)] px-3 py-1 font-alt text-xs font-bold uppercase tracking-wide text-black">Commissioner</span>}
              {isManager && <span className="rounded-full bg-[var(--color-blue)] px-3 py-1 font-alt text-xs font-bold uppercase tracking-wide text-white">Team Manager</span>}
              {!isAdmin && !isManager && <span className="rounded-full bg-[var(--color-mist)] px-3 py-1 font-alt text-xs font-bold uppercase tracking-wide text-[var(--color-ink-2)]">Member</span>}
            </div>
          </div>

          {(isAdmin || isManager) && (
            <div className="space-y-2">
              {isAdmin && (
                <Link to="/commissioner" className="hcr-btn hcr-btn-dark w-full">Commissioner Portal →</Link>
              )}
              {(isManager || isAdmin) && (
                <Link to="/manager" className="hcr-btn hcr-btn-ghost w-full">Team Manager Portal →</Link>
              )}
            </div>
          )}

          <button onClick={() => signOut()} className="hcr-btn hcr-btn-ghost w-full">Sign out</button>
        </div>

        {/* right: season entry */}
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 md:p-8">
          <div className="flex items-center justify-between">
            <h2 className="text-3xl">Enter {season?.name ?? 'the Season'}</h2>
            {!loading && reg && (
              <span
                className="rounded-full px-3 py-1 font-alt text-xs font-bold uppercase tracking-wide"
                style={{
                  background:
                    reg.status === 'declined' ? 'rgba(220,53,69,0.12)'
                    : reg.status === 'pending' ? 'var(--color-mist)'
                    : 'rgba(18,157,111,0.14)',
                  color:
                    reg.status === 'declined' ? 'var(--color-red)'
                    : reg.status === 'pending' ? 'var(--color-ink-2)'
                    : 'var(--color-green)',
                }}
              >
                {reg.status}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Register your interest for the season. Every driver starts on a Bronze license and
            earns upgrades from race results — pace, safety and finishing position. Team managers
            can then sign you from the free-agent pool.
          </p>

          <form onSubmit={enter} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Driver name</span>
              <input className="hcr-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                  iRacing full name <span className="text-[var(--color-red)]">*</span>
                </span>
                <input
                  className="hcr-input"
                  value={iracingName}
                  onChange={(e) => setIracingName(e.target.value)}
                  placeholder="Exactly as on your iRacing account"
                  autoComplete="name"
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                  iRacing customer ID# <span className="text-[var(--color-red)]">*</span>
                </span>
                <input
                  className="hcr-input"
                  value={iracingCustid}
                  onChange={(e) => setIracingCustid(e.target.value.replace(/[^0-9]/g, ''))}
                  inputMode="numeric"
                  pattern="[0-9]+"
                  placeholder="e.g. 123456"
                  required
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Preferred class</span>
              <select className="hcr-select" value={preferredClass} onChange={(e) => setPreferredClass(e.target.value)}>
                {CLASSES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Preferred car</span>
              <input
                className="hcr-input"
                value={preferredCar}
                onChange={(e) => setPreferredCar(e.target.value)}
                placeholder="e.g. Ferrari 296 GT3"
                list="hcr-car-suggestions"
                maxLength={80}
              />
              {/* Suggestions, not a fixed list. iRacing adds cars mid-season, and a
                  hardcoded dropdown would silently block a perfectly legal entry. */}
              <datalist id="hcr-car-suggestions">
                {CAR_SUGGESTIONS[preferredClass]?.map((c) => <option key={c} value={c} />)}
              </datalist>
              <span className="mt-1 block text-xs text-[var(--color-faint)]">
                The car you'll run all season, named as it appears in iRacing. Locked once the
                season starts unless staff agree otherwise.
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                Preferred car number
              </span>
              <div className="flex gap-2">
                <input
                  className="hcr-input tabular text-center"
                  value={prefNumber}
                  onChange={(e) => setPrefNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                  inputMode="numeric"
                  placeholder="1st choice"
                  aria-label="First choice car number"
                />
                <input
                  className="hcr-input tabular text-center"
                  value={prefNumberAlt}
                  onChange={(e) => setPrefNumberAlt(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                  inputMode="numeric"
                  placeholder="2nd choice"
                  aria-label="Second choice car number"
                />
              </div>
              <span className="mt-1 block text-xs text-[var(--color-faint)]">
                Numbers are league-wide — one car per number across every class, first come
                first served. If your first choice is gone you get your second, so pick one you'd
                actually be happy with.
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Notes (optional)</span>
              <textarea className="hcr-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Team preference, availability…" />
            </label>

            {error && <p role="alert" className="rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">{error}</p>}
            {msg && <p role="status" className="rounded-lg bg-[var(--color-green)]/10 px-4 py-3 text-sm text-[var(--color-green)]">{msg}</p>}

            <button type="submit" disabled={busy} className="hcr-btn hcr-btn-primary w-full">
              {busy ? 'Submitting…' : reg ? 'Update Registration' : 'Enter the Season'}
            </button>
          </form>
        </div>
      </div>
    </Section>
  )
}
