import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useCurrentSeason, useDrivers, useEntries, useEvents, useLicenseResults, useMyChangeRequests, useProtests } from '../../lib/queries'
import { buildPaceIndex, computeLicense, resultsForDriver } from '../../lib/license'
import { classColor, fmtDateLong } from '../../lib/format'
import { Section, Skeleton } from '../../components/ui'
import { ChangeRequestForm, ChangeRequestList } from '../../components/ChangeRequest'
import { LicenseBadge } from '../../components/LicenseBadge'
import { EvidenceBox, type PendingEvidence } from '../../components/EvidenceBox'
import { StatusPill } from '../../components/ProtestThread'

const CATEGORIES = ['Contact', 'Unsafe rejoin', 'Track limits', 'Blocking', 'Unsporting conduct', 'Other']

/**
 * Three tabs, not four.
 *
 * It used to be profile / my car / file a protest / my protests, which split one
 * question — "how do I ask for something?" — across three of them. Change requests
 * were buried inside My car, filing a protest and tracking it were separate places,
 * and nothing showed a member what they were currently waiting on.
 *
 * Action centre is the answer to that question: everything you can ask for, plus the
 * state of everything you already asked for, in one place. My car goes back to being
 * what it says — the facts about your entry.
 */
type Tab = 'overview' | 'car' | 'actions'

export default function MemberPortal() {
  const { profile, session, isRaceControl, isAdmin, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>('overview')
  const [filedNote, setFiledNote] = useState(false)
  const { data: protests } = useProtests({ mine: true, userId: session?.user?.id })
  const { data: myRequests } = useMyChangeRequests()

  // The badge counts what the member is WAITING ON, not everything they have ever
  // filed. A resolved protest from March is not an outstanding action, and putting it
  // in the count would make the number meaningless within a season.
  const openCount =
    (protests ?? []).filter((p) => p.status !== 'resolved' && p.status !== 'dismissed').length +
    (myRequests ?? []).filter((r) => r.status === 'pending').length

  const selectTab = (id: Tab) => {
    if (id !== 'actions') setFiledNote(false)
    setTab(id)
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'My profile' },
    { id: 'car', label: 'My car' },
    { id: 'actions', label: `Action centre${openCount ? ` (${openCount})` : ''}` },
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
      {tab === 'car' && <MyCar onRequestChange={() => selectTab('actions')} />}
      {tab === 'actions' && (
        <ActionCentre
          filedNote={filedNote}
          onFiled={() => setFiledNote(true)}
          onDismissNote={() => setFiledNote(false)}
        />
      )}
    </Section>
  )
}

/* ---------------- action centre ---------------- */
/**
 * Everything a member can ask for, and the state of everything they already asked.
 *
 * This exists because "how do I request something?" had three different answers
 * depending on what you wanted, and none of them told you what you were waiting on.
 * Change requests were inside My car; filing a protest and reading the outcome were
 * separate tabs. A member had to already know the shape of the system to use it.
 *
 * WAITING-ON GOES FIRST. Somebody opening this tab has usually come to check on
 * something, not to start something new, so the open items are above the forms. When
 * there is nothing outstanding that block disappears rather than showing an empty
 * shell, and the forms move up to fill the space.
 */
function ActionCentre({
  filedNote, onFiled, onDismissNote,
}: {
  filedNote: boolean
  onFiled: () => void
  onDismissNote: () => void
}) {
  const { session } = useAuth()
  const { data: protests } = useProtests({ mine: true, userId: session?.user?.id })
  const { data: requests } = useMyChangeRequests()

  const openProtests = (protests ?? []).filter((p) => p.status !== 'resolved' && p.status !== 'dismissed')
  const openRequests = (requests ?? []).filter((r) => r.status === 'pending')
  const waiting = openProtests.length + openRequests.length

  return (
    <div className="space-y-8">
      {filedNote && (
        <p role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--color-green)]/10 px-4 py-3 text-sm text-[var(--color-green)]">
          Protest submitted — race control has been notified.
          <button
            onClick={onDismissNote}
            aria-label="Dismiss"
            className="-my-2 inline-flex min-h-11 min-w-11 items-center justify-center font-semibold hover:text-[var(--color-ink)]"
          >
            ✕
          </button>
        </p>
      )}

      {waiting > 0 && (
        <section>
          <h3 className="mb-1 text-2xl">Waiting on race control</h3>
          <p className="mb-4 text-sm text-[var(--color-muted)]">
            {waiting === 1 ? 'One thing' : `${waiting} things`} of yours {waiting === 1 ? 'is' : 'are'} still open.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {openRequests.length > 0 && (
              <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
                <div className="eyebrow mb-3">Change requests</div>
                <ChangeRequestList rows={openRequests} />
              </div>
            )}
            {openProtests.length > 0 && (
              <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
                <div className="eyebrow mb-3">Protests</div>
                <ul className="space-y-2">
                  {openProtests.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                      <Link to={`/portal/protests/${p.id}`} className="min-w-0 truncate font-semibold hover:underline">
                        {p.category}{p.event?.name ? ` · ${p.event.name}` : ''}
                      </Link>
                      <StatusPill status={p.status} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-1 text-2xl">Request a change</h3>
        <p className="mb-4 max-w-xl text-sm text-[var(--color-muted)]">
          Your number, car or class. Race control decides these because the grid is published
          and the standings are keyed to it — approving a request applies it for you.
        </p>
        <RequestChangeCard />
      </section>

      <section>
        <h3 className="mb-1 text-2xl">File a protest</h3>
        <p className="mb-4 max-w-xl text-sm text-[var(--color-muted)]">
          Protests are filed here on the site, not in Discord, so they reach race control with
          the evidence attached and a record that cannot be lost in a channel.
        </p>
        <FileProtest onFiled={onFiled} />
      </section>

      {(requests ?? []).some((r) => r.status !== 'pending') && (
        <section>
          <h3 className="mb-4 text-2xl">Decided</h3>
          <ChangeRequestList rows={(requests ?? []).filter((r) => r.status !== 'pending')} />
        </section>
      )}

      <section>
        <h3 className="mb-4 text-2xl">All my protests</h3>
        <MyProtests />
      </section>
    </div>
  )
}

/**
 * The change-request form, plus the two states where there is nothing to request.
 *
 * Split out of MyCar so the Action centre and the car page can both show it without
 * one importing the other's layout. The kinds offered differ by situation: a driver
 * on a team cannot ask for a number, because the team owns it and their manager sets
 * it directly through set_entry_number.
 */
function RequestChangeCard() {
  const { profile } = useAuth()
  const { data: season } = useCurrentSeason()
  const { data: entries, isLoading } = useEntries(season?.id)

  const mine = useMemo(
    () => (entries ?? []).find((e) => (e.drivers ?? []).some((l) => l.driver?.id === profile?.driver_id)),
    [entries, profile?.driver_id],
  )

  if (isLoading) return <Skeleton className="h-40 w-full" />

  if (!profile?.driver_id || !mine) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-line-2)] bg-[var(--color-paper)] p-5 text-sm text-[var(--color-muted)]">
        You need a car on this season's grid before there is anything to change. Enter the
        season from your account page and race control will assign one.
      </p>
    )
  }

  const onTeam = !!mine.team_id
  return (
    <>
      {onTeam && (
        <p className="mb-3 text-sm text-[var(--color-muted)]">
          You run your team's car, so your number is theirs to change — ask your manager.
          Car and class still come through race control.
        </p>
      )}
      <ChangeRequestForm
        kinds={onTeam ? ['car', 'class'] : ['number', 'car', 'class', 'team']}
        entryId={mine.id}
        driverId={profile.driver_id}
        current={{ number: mine.number, car: mine.car, class: mine.class_id }}
      />
    </>
  )
}

/* ---------------- my car ---------------- */
/**
 * A driver's own entry, and how to change it.
 *
 * Nothing here is directly editable. A number, a car model or a class is what the
 * published grid and every scored result are keyed to, so each is a request Race
 * Control decides — and approving one applies it, rather than leaving somebody to
 * remember. A driver on a team sees their number as the TEAM's, because the team
 * owns it and their manager is the one who can change it.
 */
function MyCar({ onRequestChange }: { onRequestChange: () => void }) {
  const { profile } = useAuth()
  const { data: season } = useCurrentSeason()
  const { data: entries, isLoading } = useEntries(season?.id)

  const mine = useMemo(
    () => (entries ?? []).find((e) => (e.drivers ?? []).some((l) => l.driver?.id === profile?.driver_id)),
    [entries, profile?.driver_id],
  )

  if (isLoading) return <Skeleton className="h-64 w-full" />

  if (!profile?.driver_id) {
    return (
      <p className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-muted)]">
        Your account isn't linked to a driver on the roster yet, so there's no car to show.
        Race control links these as results come in — ask them if it's been a while.
      </p>
    )
  }
  if (!mine) {
    return (
      <p className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-muted)]">
        You're not on this season's grid yet. Enter the season from your account page and race
        control will assign your car.
      </p>
    )
  }

  const onTeam = !!mine.team_id

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <div className="flex flex-wrap items-center gap-4">
          <span className="h-5 w-5 shrink-0 rounded-sm" style={{ background: classColor(mine.class_id) }} />
          <div className="font-display text-5xl leading-none tabular">#{mine.number}</div>
          <div>
            <div className="font-semibold">{mine.class_id}</div>
            <div className="text-sm text-[var(--color-muted)]">{mine.car ?? 'Car not set'}</div>
          </div>
          <div className="ml-auto text-right text-sm">
            {onTeam ? (
              <>
                <div className="font-semibold">{mine.team?.name}</div>
                <div className="text-xs text-[var(--color-muted)]">Your number comes from the team</div>
              </>
            ) : (
              <div className="text-xs text-[var(--color-muted)]">Free agent — this number is yours</div>
            )}
          </div>
        </div>
        {onTeam && (
          <p className="mt-4 text-xs text-[var(--color-faint)]">
            Everyone racing this car runs No. {mine.number}. Your team manager changes it from
            their portal; a class or car change still goes to race control.
          </p>
        )}
      </div>

      {/* Neither the form nor the request list is repeated here. The Action centre
          owns both, so there is exactly one place to look for what is pending.
          The form itself lives in the Action centre. Two copies of it would mean two
          places to look when something is pending, which is the confusion this
          reorganisation exists to remove. */}
      <button
        onClick={onRequestChange}
        className="hcr-btn hcr-btn-dark mt-2 self-start"
      >
        Request a change →
      </button>
    </div>
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
