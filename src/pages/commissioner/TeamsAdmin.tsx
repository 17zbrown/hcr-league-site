import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useTeams } from '../../lib/queries'
import { CLASS_ORDER, classColor } from '../../lib/format'
import type { Team } from '../../lib/types'
import { Skeleton } from '../../components/ui'

export default function TeamsAdmin() {
  const qc = useQueryClient()
  const { data: teams, isLoading } = useTeams()
  const [adding, setAdding] = useState(false)
  const invalidate = () => qc.invalidateQueries({ queryKey: ['teams'] })

  const addTeam = async () => {
    setAdding(true)
    await supabase.from('teams').insert({ name: 'New Team', number: '00', car: '', class_id: 'GTD', sort: 0 })
    invalidate()
    setAdding(false)
  }

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-3xl">Teams</h2>
        <button onClick={addTeam} disabled={adding} className="hcr-btn hcr-btn-primary !py-2 !text-xs">+ Add Team</button>
      </div>
      <div className="space-y-2">
        {(teams ?? []).map((t) => (
          <TeamRow key={t.id} team={t} onChange={invalidate} />
        ))}
      </div>
    </div>
  )
}

function TeamRow({ team, onChange }: { team: Team; onChange: () => void }) {
  const [name, setName] = useState(team.name)
  // Null when the team fields no car this season; the input still needs a string.
  const [number, setNumber] = useState(team.number ?? '')
  const [car, setCar] = useState(team.car ?? '')
  const [classId, setClassId] = useState(team.class_id)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dirty = name !== team.name || number !== team.number || car !== (team.car ?? '') || classId !== team.class_id

  const save = async () => {
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('teams').update({ name, number, car, class_id: classId }).eq('id', team.id)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    onChange()
  }
  const del = async () => {
    if (!confirm(`Delete team "${team.name}"?`)) return
    const { error } = await supabase.from('teams').delete().eq('id', team.id)
    if (error) { setErr(error.message); return }
    onChange()
  }

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-3">
    <div className="grid items-center gap-2 md:grid-cols-[70px_1.5fr_1.5fr_110px_auto_auto]">
      <input className="hcr-input !py-2 tabular" value={number} onChange={(e) => setNumber(e.target.value)} aria-label="Number" />
      <input className="hcr-input !py-2" value={name} onChange={(e) => setName(e.target.value)} aria-label="Team name" />
      <input className="hcr-input !py-2" value={car} onChange={(e) => setCar(e.target.value)} placeholder="Car" aria-label="Car" />
      <select className="hcr-select !py-2" value={classId} onChange={(e) => setClassId(e.target.value as Team['class_id'])} aria-label="Class"
        style={{ borderLeft: `4px solid ${classColor(classId)}` }}>
        {CLASS_ORDER.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <button onClick={save} disabled={!dirty || busy} className="hcr-btn hcr-btn-dark !py-2 !text-xs">{saved ? '✓' : 'Save'}</button>
      <button onClick={del} className="hcr-btn hcr-btn-ghost !py-2 !text-xs">Del</button>
    </div>
    {err && <p className="mt-2 text-xs text-[var(--color-red)]">{err}</p>}
    </div>
  )
}
