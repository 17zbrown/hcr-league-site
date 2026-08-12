import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useCurrentSeason, useTakenNumbers } from '../lib/queries'
import type { SeasonRegistration } from '../lib/types'
import { CountryPicker } from './CountryPicker'

/**
 * The season entry form — the one thing a new member must actually do.
 *
 * It used to be the whole of a separate /account page that nothing linked to, so
 * the single most important action in the league was reachable only by knowing a
 * URL. It lives here as a component so the member portal can put it where somebody
 * without a grid slot will find it, next to the tab that tells them they have not
 * got one.
 */

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

/**
 * The two fields an entry cannot be accepted without.
 *
 * Neither can be filled in later by staff — only the driver knows them, and both
 * are what make the entry usable: the full name is how every result sheet names
 * them, and the customer ID is the only thing that can add them to the league in
 * iRacing.
 *
 * These mirror the CHECK constraint on season_registrations exactly, and a test
 * asserts the two agree. The database is what actually enforces the rule; these
 * exist so a driver is told what is wrong while they type rather than being
 * bounced on submit.
 *
 * FULL_NAME wants two parts, because an iRacing account always carries a first
 * and a last name and "Zack" alone matches nothing on a result sheet.
 */
const IRACING_FULL_NAME = /\S\s+\S/
const IRACING_CUSTID = /^\d+$/

export function SeasonEntryForm() {
  const { profile, session, refreshProfile } = useAuth()
  const { data: season } = useCurrentSeason()
  const { data: takenNumbers } = useTakenNumbers(season?.id)
  const [reg, setReg] = useState<SeasonRegistration | null>(null)
  const [loading, setLoading] = useState(true)

  const [displayName, setDisplayName] = useState('')
  const [iracingName, setIracingName] = useState('')
  const [iracingCustid, setIracingCustid] = useState('')
  const [category, setCategory] = useState('Bronze')
  const [preferredClass, setPreferredClass] = useState('GTD')
  const [preferredCar, setPreferredCar] = useState('')
  const [nationality, setNationality] = useState('')
  // Two choices, because numbers are league-wide and first come, first served — a
  // single choice leaves whoever asks second with nothing to fall back on.
  const [prefNumber, setPrefNumber] = useState('')
  const [prefNumberAlt, setPrefNumberAlt] = useState('')

  /**
   * Is this number already spoken for? Answered from the in-memory set so the
   * warning appears on the keystroke rather than after a round-trip.
   *
   * A number held by the driver's OWN car is not a clash — somebody re-opening
   * their entry to change a car shouldn't be told their own number is taken.
   */
  const numberTaken = useMemo(() => {
    const mine = profile?.driver_id
    return (n: string): string | null => {
      const key = n.trim().toLowerCase()
      if (!key || !takenNumbers) return null
      const hit = takenNumbers.get(key)
      if (!hit) return null
      if (mine && hit.driverIds.includes(mine)) return null
      return hit.holder
    }
  }, [takenNumbers, profile?.driver_id])

  const firstTakenBy = numberTaken(prefNumber)
  const altTakenBy = numberTaken(prefNumberAlt)
  // Both gone is a different message: there is nothing left to fall back on, so it
  // is a dead end rather than a nudge toward the second choice.
  const bothTaken = !!firstTakenBy && !!altTakenBy
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A blank box is not a mistake until they try to submit — shouting "required" at
  // an untouched form is hostile. A wrong-format box, on the other hand, is worth
  // saying immediately.
  const [attempted, setAttempted] = useState(false)

  const iracingNameError = (() => {
    const v = iracingName.trim()
    if (!v) return attempted ? 'Your full iRacing name is required to enter.' : null
    if (!IRACING_FULL_NAME.test(v)) return 'First and last name, exactly as on your iRacing account.'
    return null
  })()
  const iracingCustidError = (() => {
    const v = iracingCustid.trim()
    if (!v) return attempted ? 'Your iRacing customer ID is required to enter.' : null
    if (!IRACING_CUSTID.test(v)) return 'Digits only — the number on your iRacing account.'
    return null
  })()
  const iracingIncomplete =
    !IRACING_FULL_NAME.test(iracingName.trim()) || !IRACING_CUSTID.test(iracingCustid.trim())

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
          setNationality(data.nationality ?? '')
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
    // No current season means there is nothing to enter, and this used to return
    // silently — the member pressed the button and absolutely nothing happened, no
    // error, no spinner, which reads as a broken site rather than a closed window.
    if (!season) {
      setError('No season is open for entries right now. Ask a commissioner — this is not something you did wrong.')
      return
    }
    // An entry missing either of these cannot be accepted, so it is never sent.
    // The RPC refuses it too, and the table's constraint refuses it after that —
    // this is only the first and friendliest of the three.
    setAttempted(true)
    if (iracingIncomplete) {
      setError('Add your full iRacing name and customer ID — an entry cannot be accepted without both.')
      return
    }
    // Both choices gone is a dead end, not a warning to click past: race control
    // would have nothing to assign. Entering with no number at all is still fine,
    // so this only blocks when both were actually filled in and both are taken.
    if (bothTaken) {
      setError('Both of those car numbers are taken — pick another pair before entering.')
      return
    }
    setBusy(true)
    setError(null)
    setMsg(null)
    const { error } = await supabase.rpc('enter_season', {
      p_season_id: season.id,
      p_display_name: displayName,
      p_fia_category: category,
      p_preferred_class: preferredClass,
      p_preferred_car: preferredCar.trim(),
      p_nationality: nationality.trim(),
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
        earns upgrades from race results — pace, safety and finishing position.
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
              className={`hcr-input ${iracingNameError ? '!border-[var(--color-red)]' : ''}`}
              value={iracingName}
              onChange={(e) => setIracingName(e.target.value)}
              placeholder="Exactly as on your iRacing account"
              autoComplete="name"
              required
              aria-invalid={!!iracingNameError}
              aria-describedby={iracingNameError ? 'iracing-name-error' : undefined}
            />
            {iracingNameError && (
              <p id="iracing-name-error" role="status" aria-live="polite"
                 className="mt-1 text-xs font-semibold text-[var(--color-red)]">
                {iracingNameError}
              </p>
            )}
          </label>
          <label className="block">
            <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
              iRacing customer ID# <span className="text-[var(--color-red)]">*</span>
            </span>
            <input
              className={`hcr-input tabular ${iracingCustidError ? '!border-[var(--color-red)]' : ''}`}
              value={iracingCustid}
              onChange={(e) => setIracingCustid(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              pattern="[0-9]+"
              placeholder="e.g. 123456"
              required
              aria-invalid={!!iracingCustidError}
              aria-describedby={iracingCustidError ? 'iracing-custid-error' : undefined}
            />
            {iracingCustidError && (
              <p id="iracing-custid-error" role="status" aria-live="polite"
                 className="mt-1 text-xs font-semibold text-[var(--color-red)]">
                {iracingCustidError}
              </p>
            )}
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Preferred class</span>
          <select className="hcr-select" value={preferredClass} onChange={(e) => setPreferredClass(e.target.value)}>
            {CLASSES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">Nationality</span>
          <CountryPicker value={nationality} onChange={setNationality} />
          <span className="mt-1 block text-xs text-[var(--color-faint)]">
            Start typing and pick from the list — the flag shows on the roster and in results.
          </span>
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
            <div className="flex-1">
              <input
                className={`hcr-input tabular text-center ${firstTakenBy ? '!border-[var(--color-red)]' : ''}`}
                value={prefNumber}
                onChange={(e) => setPrefNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                inputMode="numeric"
                placeholder="1st choice"
                aria-label="First choice car number"
                aria-invalid={!!firstTakenBy}
                aria-describedby={firstTakenBy ? 'pref-number-taken' : undefined}
              />
              {/* aria-live so a screen reader hears the clash as it happens, not
                  only on submit. */}
              {firstTakenBy && (
                <p id="pref-number-taken" role="status" aria-live="polite"
                   className="mt-1 text-xs font-semibold text-[var(--color-red)]">
                  #{prefNumber} is already taken — {firstTakenBy}
                </p>
              )}
            </div>
            <div className="flex-1">
              <input
                className={`hcr-input tabular text-center ${altTakenBy ? '!border-[var(--color-red)]' : ''}`}
                value={prefNumberAlt}
                onChange={(e) => setPrefNumberAlt(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                inputMode="numeric"
                placeholder="2nd choice"
                aria-label="Second choice car number"
                aria-invalid={!!altTakenBy}
                aria-describedby={altTakenBy ? 'pref-number-alt-taken' : undefined}
              />
              {altTakenBy && (
                <p id="pref-number-alt-taken" role="status" aria-live="polite"
                   className="mt-1 text-xs font-semibold text-[var(--color-red)]">
                  #{prefNumberAlt} is already taken — {altTakenBy}
                </p>
              )}
            </div>
          </div>

          {bothTaken && (
            <p role="alert" className="mt-2 rounded-lg bg-[var(--color-red)]/10 px-3 py-2 text-xs text-[var(--color-red)]">
              <strong>Sorry — both of those numbers are taken.</strong> You'll need to choose
              another pair. Every number in use is on the{' '}
              <Link to="/drivers" className="underline underline-offset-2">drivers page</Link>{' '}
              if it helps to see what's free.
            </p>
          )}

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

        <button type="submit" disabled={busy || bothTaken} className="hcr-btn hcr-btn-primary w-full">
          {busy ? 'Submitting…' : reg ? 'Update Registration' : 'Enter the Season'}
        </button>
      </form>
    </div>
  )
}
