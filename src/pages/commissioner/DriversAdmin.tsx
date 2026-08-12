import { useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import {
  useCurrentSeason,
  useDrivers,
  useEntries,
  useLicenseResults,
  useRegistrations,
  useSeasonResultsFull,
} from '../../lib/queries'
import { LICENSE_COLOR, buildPaceIndex, computeLicense, resultsForDriver, type License } from '../../lib/license'
import { classColor, fmtDateLong } from '../../lib/format'
import type { Driver, IracingLeagueState } from '../../lib/types'
import { Skeleton } from '../../components/ui'
import { CountryPicker } from '../../components/CountryPicker'
import { SearchBox, useSearch } from '../../components/SearchBox'

/**
 * The roster — one row per person, and everything the league knows about them.
 *
 * WHY THE iRACING LEAGUE QUEUE LIVES HERE. It was its own tab and it asked the same
 * question of the same rows: who is this person in iRacing, and are they in the
 * league yet? Its empty state already said "add the ID under Drivers", which is a
 * screen admitting it is half of another screen. Both are person-grain, so they are
 * one screen now.
 *
 * WHAT DID NOT COME WITH IT: class, car and number are ENTRY-grain and stay on the
 * Grid tab. A car can be shared, so "change this driver's class" is a sentence with
 * no meaning — there is only the class of the car they drive, and changing it
 * changes it for whoever shares it.
 *
 * PROVENANCE ON THE LEAGUE COLUMN IS THE WHOLE DESIGN. Every row says how sure we
 * are and why:
 *
 *   Confirmed   a roster sync saw them in the league. Nothing can set this today —
 *               it stays empty on purpose rather than being faked by a button.
 *   Raced       they appear in a result row, which is proof they were in a session.
 *   Marked      you told the site you added them. Bookkeeping, not verification,
 *               and labelled that way so it never reads as certainty.
 *   To add      entered, nothing done yet.
 *
 * Adding a driver to the league is manual because iRacing's Data API is read-only —
 * all nine league endpoints are GETs, there is no add-member call — so this keeps
 * the list of who is outstanding and hands over the customer IDs in one click.
 */

const CATS: License[] = ['Bronze', 'Silver', 'Gold', 'Platinum']

const STATE_META: Record<IracingLeagueState, { label: string; note: string; tone: string }> = {
  confirmed: {
    label: 'Confirmed',
    note: 'Seen in the iRacing league roster by a sync.',
    tone: 'bg-[var(--color-green)]/12 text-[var(--color-green)]',
  },
  raced: {
    label: 'Raced',
    note: 'Appears in this season’s results, so they were in the session.',
    tone: 'bg-[var(--color-green)]/12 text-[var(--color-green)]',
  },
  marked: {
    label: 'Marked added',
    note: 'You told the site you added them. Not verified against iRacing.',
    tone: 'bg-[var(--color-blue)]/12 text-[var(--color-blue)]',
  },
  pending: {
    label: 'To add',
    note: 'Entered this season — still needs adding to the league in iRacing.',
    // Brand yellow as a fill, ink as the text: the raw brand colour fails contrast
    // as text on white, which is what --color-brand-deep exists for elsewhere.
    tone: 'bg-[var(--color-brand)]/25 text-[var(--color-ink)]',
  },
  'no-custid': {
    label: 'No customer ID',
    note: 'Cannot be added until their iRacing customer ID is known.',
    tone: 'bg-[var(--color-red)]/12 text-[var(--color-red)]',
  },
}

/** The work first, then the unactionable, then everything already settled. */
const STATE_RANK: Record<IracingLeagueState, number> = {
  pending: 0, 'no-custid': 1, marked: 2, raced: 3, confirmed: 4,
}

/** Only the fields this page reads. useRegistrations returns more. */
interface Registration {
  id: string
  user_id: string | null
  driver_id: string | null
  display_name: string | null
  iracing_name: string | null
  iracing_custid: string | null
  preferred_class: string | null
  driver?: { name?: string | null } | null
}

interface RosterRow {
  driver: Driver
  /** Their car this season, when they have one. */
  entry?: { id: string; number: string; classId: string; teamed: boolean }
  /**
   * Null means "not in this season at all", which is not the same as "still to add".
   * Only somebody with an entry or a sign-up is queue work.
   */
  state: IracingLeagueState | null
  /** The name to search for in iRacing, which is not always the roster name. */
  iracingName: string | null
  /** Known from the sign-up form but not yet copied onto the driver record. */
  regCustid: string | null
  /** Driver record first, sign-up second — either counts as knowing the ID. */
  custid: string
  computed: License
}

/** Somebody who signed up but has no driver record, so there is nothing to edit yet. */
interface OrphanSignup {
  id: string
  name: string
  custid: string
  iracingName: string | null
  wants: string | null
}

type View = 'all' | 'queue' | 'no-discord'

export default function DriversAdmin() {
  const qc = useQueryClient()
  const { data: drivers, isLoading } = useDrivers()
  const { data: licenseResults } = useLicenseResults()
  const { data: season } = useCurrentSeason()
  const { data: entries } = useEntries(season?.id)
  const { data: seasonRows } = useSeasonResultsFull(season?.id)
  // Sign-ups, not just entries. Somebody who signed up an hour ago needs adding to
  // the iRacing league whether or not Race Control has given them a car yet.
  const { data: registrations } = useRegistrations(season?.id)

  const [view, setView] = useState<View>('all')
  const [copiedAll, setCopiedAll] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const rows = useMemo<RosterRow[]>(() => {
    const paceIndex = buildPaceIndex(licenseResults ?? [])
    // A driver's number lives on their car. For a free agent that car is theirs
    // alone, which is what makes it editable here; a team driver's number belongs to
    // the team, so this page shows it read-only.
    const entryByDriver: Record<string, RosterRow['entry']> = {}
    for (const e of entries ?? []) {
      for (const l of e.drivers ?? []) {
        if (l.driver?.id) {
          entryByDriver[l.driver.id] = { id: e.id, number: e.number, classId: e.class_id, teamed: !!e.team_id }
        }
      }
    }
    // A sign-up carries the iRacing name the driver typed themselves, which is what
    // you actually search for in iRacing — the roster name is often a nickname.
    const regByDriver = new Map<string, Registration>()
    const regByUser = new Map<string, Registration>()
    for (const r of (registrations ?? []) as Registration[]) {
      if (r.driver_id) regByDriver.set(r.driver_id, r)
      if (r.user_id) regByUser.set(r.user_id, r)
    }

    return (drivers ?? []).map((d) => {
      const entry = entryByDriver[d.id]
      const reg = regByDriver.get(d.id) ?? (d.user_id ? regByUser.get(d.user_id) : undefined)
      const own = String(d.iracing_custid ?? '').trim()
      const fromReg = String(reg?.iracing_custid ?? '').trim()
      const custid = own || fromReg
      // Precedence is deliberate: proof beats bookkeeping. Somebody who has raced is
      // in the league whether or not anyone remembered to tick the box, and whether
      // or not we know their customer ID.
      const raced = resultsForDriver(seasonRows ?? [], d.name).length > 0
      const inSeason = !!entry || !!reg
      const state: IracingLeagueState | null =
        !inSeason ? null
          : d.iracing_league_confirmed_at ? 'confirmed'
          : raced ? 'raced'
          : d.iracing_league_marked_at ? 'marked'
          : !custid ? 'no-custid'
          : 'pending'
      return {
        driver: d,
        entry,
        state,
        iracingName: reg?.iracing_name ?? null,
        regCustid: !own && fromReg ? fromReg : null,
        custid,
        computed: computeLicense(resultsForDriver(licenseResults ?? [], d.name), paceIndex, null).computed,
      }
    })
  }, [drivers, entries, licenseResults, registrations, seasonRows])

  // Signed up with no driver record at all. Nothing here can be edited — there is no
  // row to edit — but they still need adding to the league, so hiding them would make
  // the queue quietly wrong the first time somebody new signs up.
  const orphans = useMemo<OrphanSignup[]>(() => {
    const ids = new Set((drivers ?? []).map((d) => d.id))
    const onRoster = new Set(
      (drivers ?? []).map((d) => String(d.iracing_custid ?? '').trim()).filter(Boolean),
    )
    return ((registrations ?? []) as Registration[])
      .filter((r) => !(r.driver_id && ids.has(r.driver_id)))
      .filter((r) => {
        // The customer ID is the identity that survives a missing driver_id, so it is
        // what decides whether this sign-up is already listed above.
        const c = String(r.iracing_custid ?? '').trim()
        return !(c && onRoster.has(c))
      })
      .map((r) => ({
        id: r.id,
        name: r.driver?.name || r.display_name || r.iracing_name || 'Unnamed sign-up',
        custid: String(r.iracing_custid ?? '').trim(),
        iracingName: r.iracing_name ?? null,
        wants: r.preferred_class ?? null,
      }))
  }, [drivers, registrations])

  // Name, nationality, customer ID, Discord ID, number and league status are all
  // searchable — whoever is looking somebody up rarely remembers which they know.
  const { query, setQuery, filtered, total } = useSearch(
    rows,
    (r) => [
      r.driver.name, r.iracingName, r.driver.country, r.custid, r.driver.discord_user_id,
      r.entry?.number, r.state ? STATE_META[r.state].label : null,
    ],
  )

  const pending = rows.filter((r) => r.state === 'pending')
  const missingId = rows.filter((r) => r.state === 'no-custid')
  const noDiscord = rows.filter((r) => !String(r.driver.discord_user_id ?? '').trim())
  const orphansToAdd = orphans.filter((o) => o.custid)
  const toAddCount = pending.length + orphansToAdd.length

  // Who already holds each identity, so a clash is caught with a name attached
  // rather than as a raw constraint violation — or, for Discord, not at all.
  const custidOwners = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
    for (const d of drivers ?? []) {
      const c = String(d.iracing_custid ?? '').trim()
      if (c) m.set(c, { id: d.id, name: d.name })
    }
    return m
  }, [drivers])
  const discordOwners = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
    for (const d of drivers ?? []) {
      const c = String(d.discord_user_id ?? '').trim()
      if (c) m.set(c, { id: d.id, name: d.name })
    }
    return m
  }, [drivers])

  // Counted from what is ON SCREEN, not from the unfiltered roster. With a view chip
  // active the two diverge — "39 of 39" above nine visible rows reads as a bug in the
  // filter rather than a label counting something else.
  const shown = useMemo(() => {
    const list =
      // 'marked' is in the queue DELIBERATELY. Dropping a row the instant it is
      // marked takes its Undo button off screen with it, so a mis-click can only be
      // repaired by leaving the view you are working in. STATE_RANK sorts the
      // outstanding work above it, which is the behaviour the old tab had.
      view === 'queue'
        ? filtered.filter((r) => r.state === 'pending' || r.state === 'no-custid' || r.state === 'marked')
        : view === 'no-discord' ? filtered.filter((r) => !String(r.driver.discord_user_id ?? '').trim())
        : filtered
    if (view !== 'queue') return list
    // Work first inside the queue view; useDrivers already sorts by name otherwise.
    return [...list].sort(
      (a, b) =>
        STATE_RANK[a.state as IracingLeagueState] - STATE_RANK[b.state as IracingLeagueState] ||
        a.driver.name.localeCompare(b.driver.name),
    )
  }, [filtered, view])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['drivers'] })
    qc.invalidateQueries({ queryKey: ['free-agents'] })
    qc.invalidateQueries({ queryKey: ['entries'] })
  }

  const addDriver = async () => {
    const { error } = await supabase.from('drivers').insert({ name: 'New Driver' })
    if (error) { setErr(error.message); return }
    setErr(null)
    invalidate()
  }

  const copyAll = async () => {
    const ids = [...pending.map((r) => r.custid), ...orphansToAdd.map((o) => o.custid)]
    try {
      await navigator.clipboard.writeText(ids.join(', '))
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 1500)
    } catch {
      setErr('Your browser blocked the clipboard. Select the IDs and copy them by hand.')
    }
  }

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-3xl">Drivers</h2>
        <button onClick={addDriver} className="hcr-btn hcr-btn-primary !py-2 !text-xs">+ Add Driver</button>
      </div>
      <p className="mb-5 max-w-2xl text-sm text-[var(--color-muted)]">
        Everyone on the roster, everything about them, and whether they are in the iRacing league
        yet. Open a row to reach the rest of their record. Class, car and number belong to the car
        rather than the person, so they live on <strong>Grid</strong>.
      </p>

      {err && (
        <p role="alert" className="mb-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">{err}</p>
      )}

      {/* The batch action: paste straight into iRacing's add-member field. */}
      <div className="mb-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-display text-2xl leading-none">
              {toAddCount}
              <span className="ml-2 font-body text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                still to add in iRacing
              </span>
            </div>
            <p className="mt-1.5 text-xs text-[var(--color-muted)]">
              {toAddCount === 0
                ? 'Nothing outstanding — every entered driver is accounted for.'
                : 'Copy the customer IDs, add them in iRacing, then mark them here.'}
            </p>
          </div>
          {toAddCount > 0 && (
            <button onClick={copyAll} className="hcr-btn hcr-btn-primary !py-2 !text-xs">
              {copiedAll ? '✓ Copied' : `Copy all ${toAddCount} customer IDs`}
            </button>
          )}
        </div>
      </div>

      {missingId.length > 0 && (
        <p className="mb-4 rounded-lg bg-[var(--color-red)]/8 px-4 py-3 text-sm text-[var(--color-red)]">
          <strong>{missingId.length}</strong> entered {missingId.length === 1 ? 'driver has' : 'drivers have'} no
          iRacing customer ID, so they cannot be added at all: {missingId.map((r) => r.driver.name).join(', ')}.
          Fill in the <strong>Cust ID#</strong> column below.
        </p>
      )}

      {noDiscord.length > 0 && (
        <p className="mb-4 rounded-lg bg-[var(--color-brand)]/15 px-4 py-3 text-sm">
          <strong>{noDiscord.length}</strong> {noDiscord.length === 1 ? 'driver has' : 'drivers have'} no Discord
          ID, so the attendance bot cannot reach them and tells them they are not on the entry list.
          Open a row and paste their Discord user ID to fix it.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBox
          value={query}
          onChange={setQuery}
          count={shown.length}
          total={view === 'all' ? total : rows.length}
          placeholder="Search by name, country, customer ID, Discord ID, number or league status…"
          className="max-w-xl flex-1"
        />
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button" onClick={() => setView('all')} aria-pressed={view === 'all'}
            className={`hcr-chip ${view === 'all' ? 'hcr-chip-active' : ''}`}
          >
            All {rows.length}
          </button>
          <button
            type="button" onClick={() => setView('queue')} aria-pressed={view === 'queue'}
            className={`hcr-chip ${view === 'queue' ? 'hcr-chip-active' : ''}`}
          >
            iRacing queue {pending.length + missingId.length}
          </button>
          <button
            type="button" onClick={() => setView('no-discord')} aria-pressed={view === 'no-discord'}
            className={`hcr-chip ${view === 'no-discord' ? 'hcr-chip-active' : ''}`}
          >
            No Discord ID {noDiscord.length}
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-[var(--color-faint)]">
        Licenses are computed from race results. Leave a driver on <strong>Auto</strong> to use the
        earned tier shown beside it, or pick a tier to override it for special cases.
      </p>

      <div className="space-y-2">
        {shown.length === 0 && (
          <p className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-muted)]">
            {query.trim()
              ? `No drivers match that search${view === 'all' ? '' : ' and filter'}.`
              : view === 'queue' ? 'Nothing outstanding — every entered driver is in the iRacing league.'
              : view === 'no-discord' ? 'Every driver has a Discord ID. The attendance bot can reach all of them.'
              : 'No drivers on the roster yet.'}
          </p>
        )}
        {shown.map((r) => (
          <DriverRow
            key={r.driver.id}
            row={r}
            custidOwners={custidOwners}
            discordOwners={discordOwners}
            onChange={invalidate}
          />
        ))}
      </div>

      {orphans.length > 0 && (
        <div className="mt-6 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <h3 className="text-xl">Signed up, no driver record yet</h3>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">
            These sign-ups are not linked to anyone on the roster, so there is nothing here to
            edit — but they still count as outstanding iRacing work. Add them with{' '}
            <strong>+ Add Driver</strong>, or approve them under <strong>Signups</strong>.
          </p>
          <ul className="mt-3 divide-y divide-[var(--color-line)]">
            {orphans.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="font-semibold">{o.name}</span>
                {o.iracingName && o.iracingName !== o.name && (
                  <span className="text-xs text-[var(--color-muted)]">iRacing: {o.iracingName}</span>
                )}
                <span className="tabular font-mono text-xs">
                  {o.custid || <span className="text-[var(--color-red)]">no customer ID</span>}
                </span>
                {o.wants && <span className="text-xs text-[var(--color-muted)]">wants {o.wants}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 max-w-2xl text-xs text-[var(--color-faint)]">
        <strong>Marked added</strong> is your own note, not a check against iRacing — the site has
        no way to read your league roster today. <strong>Confirmed</strong> is reserved for a real
        roster sync and stays unused until iRacing reopens API access, at which point it fills in
        by itself and any mistakes in the marked column surface on their own.
      </p>
    </div>
  )
}

/** Empty is "unknown", which is a different fact from zero — so it must not become 0. */
const intOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v.trim()))

function DriverRow({ row, custidOwners, discordOwners, onChange }: {
  row: RosterRow
  custidOwners: Map<string, { id: string; name: string }>
  discordOwners: Map<string, { id: string; name: string }>
  onChange: () => void
}) {
  const { driver, entry, state, computed } = row
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(driver.name)
  const [country, setCountry] = useState(driver.country ?? '')
  const [custid, setCustid] = useState(driver.iracing_custid ?? '')
  const [cat, setCat] = useState(driver.license_override ?? '')
  const [irating, setIrating] = useState(driver.irating == null ? '' : String(driver.irating))
  const [adjust, setAdjust] = useState(driver.points_adjust == null ? '' : String(driver.points_adjust))
  const [discord, setDiscord] = useState(driver.discord_user_id ?? '')
  const [bio, setBio] = useState(driver.bio ?? '')
  const [number, setNumber] = useState(entry?.number ?? '')
  const [busy, setBusy] = useState(false)
  const [numBusy, setNumBusy] = useState(false)
  const [marking, setMarking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dirty =
    name !== driver.name ||
    country !== (driver.country ?? '') ||
    custid.trim() !== (driver.iracing_custid ?? '') ||
    (cat || null) !== (driver.license_override ?? null) ||
    irating.trim() !== (driver.irating == null ? '' : String(driver.irating)) ||
    adjust.trim() !== (driver.points_adjust == null ? '' : String(driver.points_adjust)) ||
    discord.trim() !== (driver.discord_user_id ?? '') ||
    bio !== (driver.bio ?? '')

  const save = async () => {
    const nm = name.trim()
    const cid = custid.trim()
    const dis = discord.trim()
    const ir = irating.trim()
    const adj = adjust.trim()

    // Everything is checked before anything is written, so a row never lands half
    // saved and the message names the field rather than echoing a constraint.
    const problems: string[] = []
    if (!nm) problems.push('A driver needs a name.')
    if (cid && !/^\d{1,12}$/.test(cid)) problems.push('An iRacing customer ID is digits only.')
    else if (cid) {
      const owner = custidOwners.get(cid)
      if (owner && owner.id !== driver.id) problems.push(`Customer ID ${cid} already belongs to ${owner.name}.`)
    }
    // The snowflake shape, because a wrong Discord ID is worse than none: the bot
    // would then confidently message the wrong person.
    if (dis && !/^\d{5,25}$/.test(dis)) {
      problems.push('A Discord user ID is the 17–19 digit snowflake from Copy User ID — not a username.')
    } else if (dis) {
      const owner = discordOwners.get(dis)
      if (owner && owner.id !== driver.id) problems.push(`Discord ID ${dis} already belongs to ${owner.name}.`)
    }
    if (ir && !/^\d{1,5}$/.test(ir)) problems.push('iRating is a whole number, or blank for unknown.')
    if (adj && !/^-?\d{1,5}$/.test(adj)) problems.push('Points adjustment is a whole number, or blank for none.')
    if (problems.length) { setErr(problems.join(' ')); return }

    const next = {
      name: nm,
      country,
      // Trimmed, and empty means "unknown" — a unique index guards against the same
      // iRacing account landing on two drivers.
      iracing_custid: cid || null,
      license_override: cat || null,
      irating: intOrNull(ir),
      // Blank clears the adjustment rather than zeroing it. A stray 0 where null
      // belonged is a silent scoring change nobody would go looking for.
      points_adjust: intOrNull(adj),
      discord_user_id: dis || null,
      bio: bio.trim() || null,
      // user_id is deliberately absent. It binds this driver to an auth account, and
      // a wrong value hands one person's portal, entry and protests to another —
      // it is set by sign-up and by the Discord linker, never typed in here.
    }

    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('drivers').update(next).eq('id', driver.id)
    setBusy(false)
    if (error) {
      setErr(
        error.code === '23505'
          ? 'Another driver already holds that iRacing customer ID.'
          : error.message,
      )
      return
    }
    // Re-seed the inputs from what was actually written; otherwise a trimmed or
    // nulled field stays "dirty" forever against the value that came back.
    setName(next.name)
    setCustid(next.iracing_custid ?? '')
    setDiscord(next.discord_user_id ?? '')
    setIrating(next.irating == null ? '' : String(next.irating))
    setAdjust(next.points_adjust == null ? '' : String(next.points_adjust))
    setBio(next.bio ?? '')
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    onChange()
  }

  /**
   * The number goes through set_entry_number, not a table update: it lives on the
   * driver's car, and the league-wide uniqueness check belongs on the server where
   * a second admin in another tab cannot race past it.
   */
  const saveNumber = async () => {
    if (!entry) return
    setNumBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('set_entry_number', { p_entry: entry.id, p_number: number.trim() })
    setNumBusy(false)
    if (error) { setErr(error.message.replace(/^.*?:\s*/, '')); setNumber(entry.number); return }
    onChange()
  }

  /**
   * An RPC rather than a table update: the function cannot touch the confirmed
   * column, so a bug here can never promote a guess into a verified fact.
   */
  const setMarked = async (marked: boolean) => {
    setMarking(true)
    setErr(null)
    const { error } = await supabase.rpc('set_iracing_league_marked', {
      p_driver_id: driver.id,
      p_marked: marked,
    })
    setMarking(false)
    if (error) { setErr(error.message); return }
    onChange()
  }

  // What is in the box beats what was fetched: an ID typed but not yet saved is still
  // the one you are about to paste into iRacing.
  const copyable = custid.trim() || row.custid

  const copyCustid = async () => {
    try {
      await navigator.clipboard.writeText(copyable)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setErr('Your browser blocked the clipboard. Select the ID and copy it by hand.')
    }
  }

  const del = async () => {
    if (!confirm(`Delete driver "${driver.name}"?`)) return
    const { error } = await supabase.from('drivers').delete().eq('id', driver.id)
    if (error) { setErr(error.message); return }
    onChange()
  }

  const meta = state ? STATE_META[state] : null

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-3">
      <div className="grid items-center gap-2 md:grid-cols-[24px_minmax(0,1.4fr)_54px_62px_minmax(0,1fr)_148px_150px_auto]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="h-8 w-6 rounded text-[var(--color-muted)] hover:bg-[var(--color-mist)] hover:text-[var(--color-ink)]"
          title={open ? 'Hide the rest of the record' : 'iRating, points adjustment, Discord ID, bio'}
          aria-label={`${open ? 'Hide' : 'Show'} the rest of ${driver.name}’s record`}
        >
          {open ? '▾' : '▸'}
        </button>

        <div className="min-w-0">
          <input className="hcr-input !py-2" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          {/* The iRacing name is what you type into iRacing's search, and it often is
              not the roster name — "Benji Hoar" is "Benjamin Hoar" there. */}
          {row.iracingName && row.iracingName !== driver.name && (
            <span className="mt-0.5 block truncate text-[11px] text-[var(--color-muted)]">
              iRacing: {row.iracingName}
            </span>
          )}
        </div>

        <CountryPicker value={country} onChange={setCountry} compact ariaLabel="Nationality" placeholder="Country" />

        {/* Free agents own their number outright, so it is editable here. A driver on
            a team runs the team's car and their manager owns that number — showing it
            editable would promise something this page cannot deliver. */}
        {entry && !entry.teamed ? (
          <input
            className="hcr-input tabular !py-2 text-center"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onBlur={() => { if (number.trim() && number.trim() !== entry.number) saveNumber() }}
            disabled={numBusy}
            maxLength={4}
            inputMode="numeric"
            placeholder="No."
            title="Free agent's own number — saves on blur"
            aria-label="Car number"
          />
        ) : (
          <div
            className="tabular text-center text-sm text-[var(--color-muted)]"
            title={entry ? "Team's number — the manager changes it" : 'Not on this season\'s grid'}
          >
            {entry ? `#${entry.number}` : '—'}
          </div>
        )}

        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <input
              className="hcr-input tabular !min-w-0 !py-2"
              value={custid}
              onChange={(e) => setCustid(e.target.value)}
              placeholder="Cust ID#"
              inputMode="numeric"
              aria-label="iRacing customer ID"
            />
            {copyable && (
              <button
                type="button"
                onClick={copyCustid}
                title="Copy this customer ID"
                aria-label={`Copy ${driver.name}’s iRacing customer ID`}
                className="shrink-0 rounded px-1.5 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-mist)] hover:text-[var(--color-ink)]"
              >
                {copied ? '✓' : '⧉'}
              </button>
            )}
          </div>
          {/* The ID often arrives on the sign-up form long before anyone copies it
              onto the driver record. One click rather than a re-type. */}
          {row.regCustid && (
            <button
              type="button"
              onClick={() => setCustid(row.regCustid!)}
              className="mt-0.5 text-[11px] text-[var(--color-blue)] underline-offset-2 hover:underline"
            >
              use {row.regCustid} from their sign-up
            </button>
          )}
        </div>

        {/* The tier as a swatch rather than a second badge column: the select already
            names it, so a separate chip spent 80px repeating the word next to it. */}
        <span className="inline-flex min-w-0 items-center gap-1.5" title={cat ? 'Commissioner override' : `Auto — earned ${computed}`}>
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: LICENSE_COLOR[cat ? (cat as License) : computed] }}
          />
          <select className="hcr-select !min-w-0 !py-2" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="License">
            <option value="">Auto ({computed})</option>
            {CATS.map((c) => <option key={c} value={c}>{c} (override)</option>)}
          </select>
        </span>

        <div className="flex flex-col items-start gap-1">
          {meta ? (
            <span title={meta.note} className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.tone}`}>
              {meta.label}
            </span>
          ) : (
            <span className="text-[11px] text-[var(--color-faint)]" title="No entry and no sign-up this season, so nothing to add in iRacing.">
              Not this season
            </span>
          )}
          {/* Only the self-reported flag is ever editable here. A driver who has raced
              needs no button — the results already said so. */}
          {(state === 'pending' || state === 'marked') && (
            <button
              onClick={() => setMarked(state !== 'marked')}
              disabled={marking}
              className={`hcr-btn !py-1 !text-[11px] ${state === 'marked' ? 'hcr-btn-ghost' : 'hcr-btn-dark'}`}
            >
              {state === 'marked' ? 'Undo' : 'Mark added'}
            </button>
          )}
        </div>

        <button onClick={save} disabled={!dirty || busy} className="hcr-btn hcr-btn-dark !py-2 !text-xs">
          {saved ? '✓' : busy ? '…' : 'Save'}
        </button>
      </div>

      {open && (
        <div className="mt-3 border-t border-[var(--color-line)] pt-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="iRating" hint="Blank means unknown — not zero.">
              <input
                className="hcr-input tabular !py-2"
                value={irating}
                onChange={(e) => setIrating(e.target.value)}
                inputMode="numeric"
                placeholder="—"
                aria-label={`iRating for ${driver.name}`}
              />
            </Field>
            <Field label="Points adjustment" hint="Stewards' correction to the season total. Blank clears it.">
              <input
                className="hcr-input tabular !py-2"
                value={adjust}
                onChange={(e) => setAdjust(e.target.value)}
                inputMode="numeric"
                placeholder="—"
                aria-label={`Points adjustment for ${driver.name}`}
              />
            </Field>
            <Field
              label="Discord user ID"
              hint="Right-click their name in Discord → Copy User ID. Without it the attendance bot cannot reach them."
            >
              <input
                className="hcr-input tabular !py-2"
                value={discord}
                onChange={(e) => setDiscord(e.target.value)}
                inputMode="numeric"
                placeholder="e.g. 214037134477230080"
                aria-label={`Discord user ID for ${driver.name}`}
              />
            </Field>
          </div>

          <div className="mt-3">
            {/* Honest hint: nothing on the public site renders drivers.bio today, so
                promising "shown on their profile" would be the same kind of lie the
                Season Entries label was. */}
            <Field label="Bio" hint="Free text on the driver record. Stored, not yet published anywhere on the site.">
              <textarea
                className="hcr-textarea !min-h-24"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="A couple of lines about this driver…"
                aria-label={`Bio for ${driver.name}`}
              />
            </Field>
          </div>

          {/* Facts this screen reports but must never author — each says who owns it,
              so a missing input reads as a rule rather than an oversight. */}
          <dl className="mt-3 grid gap-x-6 gap-y-2 rounded-lg bg-[var(--color-mist)] p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <ReadOnly label="Discord license role" value={driver.license_current ?? 'none yet'} why="Written by the Discord sync from the earned tier." />
            <ReadOnly
              label="Site account"
              value={driver.user_id ? 'linked' : 'not linked'}
              why="Bound by sign-up and the Discord linker. Editing it by hand would hand this driver's portal to somebody else."
            />
            <ReadOnly
              label="In the iRacing league"
              value={
                driver.iracing_league_confirmed_at ? `confirmed ${fmtDateLong(driver.iracing_league_confirmed_at)}`
                  : driver.iracing_league_marked_at ? `marked ${fmtDateLong(driver.iracing_league_marked_at)}`
                  : 'not marked'
              }
              why="Marked by the button on this row; confirmed only ever by a roster sync."
            />
            <ReadOnly
              label="On the roster since"
              value={driver.created_at ? fmtDateLong(driver.created_at) : '—'}
              why="Set when the driver record was created."
            />
          </dl>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            {entry ? (
              <p className="text-xs text-[var(--color-muted)]">
                <span className="mr-1.5 inline-block h-2.5 w-2.5 translate-y-px rounded-full" style={{ background: classColor(entry.classId) }} />
                Runs #{entry.number} in {entry.classId}. Class and car model are edited on <strong>Grid</strong>.
              </p>
            ) : <span />}
            {/* Deleting sits in here rather than beside Save. On a list of thirty-nine
                rows a one-click destructive button lives a mis-aim away from the thing
                next to it, and this is the one action with nothing to undo it. */}
            <button onClick={del} className="hcr-btn hcr-btn-ghost !py-1.5 !text-xs">Delete driver</button>
          </div>
        </div>
      )}

      {err && <p role="alert" className="mt-2 text-xs text-[var(--color-red)]">{err}</p>}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--color-faint)]">{hint}</span>}
    </label>
  )
}

function ReadOnly({ label, value, why }: { label: string; value: string; why: string }) {
  return (
    <div title={why}>
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">{label}</dt>
      <dd className="mt-0.5 text-[var(--color-ink-2)]">{value}</dd>
    </div>
  )
}
