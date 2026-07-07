import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useDrivers, useTeams } from '../../lib/queries'
import type { Driver, Team } from '../../lib/types'
import { Skeleton } from '../../components/ui'

const CATS = ['', 'Bronze', 'Silver', 'Gold', 'Platinum']

export default function DriversAdmin() {
  const qc = useQueryClient()
  const { data: drivers, isLoading } = useDrivers()
  const { data: teams } = useTeams()
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
      <div className="space-y-2">
        {(drivers ?? []).map((d) => (
          <DriverRow key={d.id} driver={d} teams={teams ?? []} onChange={invalidate} />
        ))}
      </div>
    </div>
  )
}

function DriverRow({ driver, teams, onChange }: { driver: Driver; teams: Team[]; onChange: () => void }) {
  const [name, setName] = useState(driver.name)
  const [country, setCountry] = useState(driver.country ?? '')
  const [irating, setIrating] = useState(driver.irating?.toString() ?? '')
  const [teamId, setTeamId] = useState(driver.team_id ?? '')
  const [cat, setCat] = useState(driver.license_override ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty =
    name !== driver.name ||
    country !== (driver.country ?? '') ||
    irating !== (driver.irating?.toString() ?? '') ||
    (teamId || null) !== (driver.team_id ?? null) ||
    (cat || null) !== (driver.license_override ?? null)

  const save = async () => {
    setBusy(true)
    await supabase
      .from('drivers')
      .update({
        name,
        country,
        irating: irating ? parseInt(irating, 10) : null,
        team_id: teamId || null,
        license_override: cat || null,
      })
      .eq('id', driver.id)
    setBusy(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    onChange()
  }
  const del = async () => {
    if (!confirm(`Delete driver "${driver.name}"?`)) return
    await supabase.from('drivers').delete().eq('id', driver.id)
    onChange()
  }

  return (
    <div className="grid items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-3 md:grid-cols-[1.4fr_60px_90px_1.4fr_110px_auto_auto]">
      <input className="hcr-input !py-2" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
      <input className="hcr-input !py-2 text-center" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="🏳️" aria-label="Country" />
      <input className="hcr-input !py-2 tabular" value={irating} onChange={(e) => setIrating(e.target.value)} placeholder="iR" aria-label="iRating" />
      <select className="hcr-select !py-2" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
        <option value="">— Free agent —</option>
        {teams.map((t) => <option key={t.id} value={t.id}>#{t.number} {t.name}</option>)}
      </select>
      <select className="hcr-select !py-2" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
        {CATS.map((c) => <option key={c} value={c}>{c || '— Cat —'}</option>)}
      </select>
      <button onClick={save} disabled={!dirty || busy} className="hcr-btn hcr-btn-dark !py-2 !text-xs">{saved ? '✓' : 'Save'}</button>
      <button onClick={del} className="hcr-btn hcr-btn-ghost !py-2 !text-xs">Del</button>
    </div>
  )
}
