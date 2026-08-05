import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useCurrentSeason, useDrivers, useEntries, useLicenseResults, useTeams } from '../../lib/queries'
import { buildPaceIndex, computeLicense, resultsForDriver } from '../../lib/license'
import type { Driver, Team } from '../../lib/types'
import { Skeleton } from '../../components/ui'
import { LicenseBadge } from '../../components/LicenseBadge'

const CATS = ['', 'Bronze', 'Silver', 'Gold', 'Platinum']

export default function DriversAdmin() {
  const qc = useQueryClient()
  const { data: drivers, isLoading } = useDrivers()
  const { data: licenseResults } = useLicenseResults()
  const { data: teams } = useTeams()
  const { data: season } = useCurrentSeason()
  const { data: entries } = useEntries(season?.id)
  // A driver's number lives on their car. For a free agent that car is theirs alone,
  // which is what makes it editable here; a team driver's number belongs to the team
  // and is changed by their manager, so this page shows it read-only.
  const entryByDriver = useMemo(() => {
    const m: Record<string, { id: string; number: string; teamed: boolean }> = {}
    for (const e of entries ?? []) {
      for (const l of e.drivers ?? []) {
        if (l.driver?.id) m[l.driver.id] = { id: e.id, number: e.number, teamed: !!e.team_id }
      }
    }
    return m
  }, [entries])
  const paceIndex = buildPaceIndex(licenseResults ?? [])
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['drivers'] })
    qc.invalidateQueries({ queryKey: ['free-agents'] })
  }

  const addDriver = async () => {
    await supabase.from('drivers').insert({ name: 'New Driver' })
    invalidate()
  }

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-3xl">Drivers</h2>
        <button onClick={addDriver} className="hcr-btn hcr-btn-primary !py-2 !text-xs">+ Add Driver</button>
      </div>
      <p className="mb-4 text-sm text-[var(--color-muted)]">
        Licenses are computed automatically from race results. Leave a driver on <strong>Auto</strong>
        {' '}to use the earned tier (shown in each row), or pick a tier to override it for special cases.
      </p>
      <div className="space-y-2">
        {(drivers ?? []).map((d) => (
          <DriverRow
            key={d.id}
            driver={d}
            entry={entryByDriver[d.id]}
            teams={teams ?? []}
            computed={computeLicense(resultsForDriver(licenseResults ?? [], d.name), paceIndex, null).computed}
            onChange={invalidate}
          />
        ))}
      </div>
    </div>
  )
}

function DriverRow({ driver, entry, teams, computed, onChange }: {
  driver: Driver
  entry?: { id: string; number: string; teamed: boolean }
  teams: Team[]
  computed: import('../../lib/license').License
  onChange: () => void
}) {
  const [name, setName] = useState(driver.name)
  const [country, setCountry] = useState(driver.country ?? '')
  // Customer ID, not iRating: the league doesn't use iRating for anything, while the
  // custid is what every iRacing-facing workflow (session invites, result matching)
  // keys on — it's the one identity field worth editing here.
  const [custid, setCustid] = useState(driver.iracing_custid ?? '')
  const [teamId, setTeamId] = useState(driver.team_id ?? '')
  const [cat, setCat] = useState(driver.license_override ?? '')
  const [number, setNumber] = useState(entry?.number ?? '')
  const [busy, setBusy] = useState(false)
  const [numBusy, setNumBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dirty =
    name !== driver.name ||
    country !== (driver.country ?? '') ||
    custid.trim() !== (driver.iracing_custid ?? '') ||
    (teamId || null) !== (driver.team_id ?? null) ||
    (cat || null) !== (driver.license_override ?? null)

  const save = async () => {
    setBusy(true)
    setErr(null)
    const { error } = await supabase
      .from('drivers')
      .update({
        name,
        country,
        // Trimmed, and empty means "unknown" — a unique index guards against the
        // same iRacing account landing on two drivers.
        iracing_custid: custid.trim() || null,
        team_id: teamId || null,
        license_override: cat || null,
      })
      .eq('id', driver.id)
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
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

  const del = async () => {
    if (!confirm(`Delete driver "${driver.name}"?`)) return
    const { error } = await supabase.from('drivers').delete().eq('id', driver.id)
    if (error) { setErr(error.message); return }
    onChange()
  }

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-3">
    <div className="grid items-center gap-2 md:grid-cols-[1.4fr_60px_76px_110px_1.4fr_150px_88px_auto_auto]">
      <input className="hcr-input !py-2" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
      <input className="hcr-input !py-2 text-center" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="🏳️" aria-label="Country" />
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
      <input className="hcr-input !py-2 tabular" value={custid} onChange={(e) => setCustid(e.target.value)} placeholder="Cust ID#" aria-label="iRacing customer ID" />
      <select className="hcr-select !py-2" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
        <option value="">— Free agent —</option>
        {teams.map((t) => <option key={t.id} value={t.id}>#{t.number} {t.name}</option>)}
      </select>
      <select className="hcr-select !py-2" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="License">
        <option value="">Auto ({computed})</option>
        {CATS.filter(Boolean).map((c) => <option key={c} value={c}>{c} (override)</option>)}
      </select>
      <div className="flex justify-center">
        <LicenseBadge tier={cat ? (cat as import('../../lib/license').License) : computed} size="xs" title={cat ? 'Commissioner override' : 'Auto (earned)'} />
      </div>
      <button onClick={save} disabled={!dirty || busy} className="hcr-btn hcr-btn-dark !py-2 !text-xs">{saved ? '✓' : 'Save'}</button>
      <button onClick={del} className="hcr-btn hcr-btn-ghost !py-2 !text-xs">Del</button>
    </div>
    {err && <p className="mt-2 text-xs text-[var(--color-red)]">{err}</p>}
    </div>
  )
}
