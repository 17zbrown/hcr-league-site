import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useCurrentSeason, useEvents, useTeams } from '../../lib/queries'
import {
  GRID_FIELDS,
  FIELD_LABELS,
  autofillPoints,
  parseCsv,
  parseText,
  pdfToText,
  toResultInsert,
  type Field,
  type ImportedRow,
} from '../../lib/importResults'
import { Skeleton } from '../../components/ui'

export default function ResultsAdmin() {
  const qc = useQueryClient()
  const { data: season } = useCurrentSeason()
  const { data: events, isLoading } = useEvents(season?.id)
  const { data: teams } = useTeams()
  const fileRef = useRef<HTMLInputElement>(null)

  const [eventId, setEventId] = useState('')
  const [rows, setRows] = useState<ImportedRow[]>([])
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [existing, setExisting] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sortedEvents = useMemo(() => [...(events ?? [])].sort((a, b) => a.round - b.round), [events])

  useEffect(() => {
    if (!eventId && sortedEvents.length) {
      const next = sortedEvents.find((e) => e.status !== 'complete') ?? sortedEvents[0]
      setEventId(next.id)
    }
  }, [sortedEvents, eventId])

  // existing result count for the selected event
  useEffect(() => {
    if (!eventId) return
    supabase
      .from('results')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .then(({ count }) => setExisting(count ?? 0))
  }, [eventId, busy])

  const onFile = async (file: File) => {
    setError(null)
    setNote(null)
    try {
      let parsed: ImportedRow[]
      if (file.name.toLowerCase().endsWith('.pdf')) {
        setNote('Reading PDF…')
        const text = await pdfToText(file)
        parsed = parseText(text)
      } else {
        const text = await file.text()
        parsed = parseCsv(text)
      }
      if (!parsed.length) {
        setError('Could not read any rows. Try a CSV export, or add rows manually below.')
        return
      }
      setRows(parsed)
      setNote(`Parsed ${parsed.length} rows — review and edit below, then save.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read file.')
    }
  }

  const runPaste = () => {
    const parsed = parseText(pasteText)
    setRows(parsed)
    setPasteOpen(false)
    setNote(parsed.length ? `Parsed ${parsed.length} rows.` : null)
  }

  const setCell = (i: number, field: Field, value: string) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }
  const addRow = () => setRows((rs) => [...rs, {}])
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i))
  const autofill = () => setRows((rs) => autofillPoints(rs, season))

  const save = async () => {
    if (!eventId) return
    const clean = rows.filter((r) => (r.number ?? '').trim() || (r.drivers_text ?? '').trim())
    if (!clean.length) {
      setError('Nothing to save.')
      return
    }
    if (!confirm(`Save ${clean.length} results for this round? This replaces any existing results for the event.`)) return
    setBusy(true)
    setError(null)
    setNote(null)
    const teamByNumber = new Map((teams ?? []).map((t) => [t.number, t.id]))
    const inserts = clean.map((r) => toResultInsert(r, eventId, teamByNumber))

    // Atomic replace: delete + insert + mark complete run in one transaction,
    // so a failed insert can never leave the round with no results.
    const { data: saved, error: rpcErr } = await supabase.rpc('replace_event_results', {
      p_event_id: eventId,
      p_rows: inserts,
    })
    if (rpcErr) {
      setError(rpcErr.message)
      setBusy(false)
      return
    }
    qc.invalidateQueries({ queryKey: ['results'] })
    qc.invalidateQueries({ queryKey: ['news'] }) // the import may have composed a story
    qc.invalidateQueries({ queryKey: ['events'] })
    qc.invalidateQueries({ queryKey: ['drivers'] })
    // Push any license/role changes to Discord (no-op if the integration is off).
    supabase.functions.invoke('discord-sync').catch(() => {})
    // Saving the import queued a race report and a standings refresh (database
    // triggers, same transaction as the results). Draining here just makes them
    // land in seconds instead of waiting for the scheduled drain — the queue is
    // the thing that guarantees delivery, so a failure here loses nothing.
    supabase.functions.invoke('discord-broadcast').catch(() => {})
    setNote(`Saved ${saved ?? inserts.length} results. Standings updated.`)
    setRows([])
    if (fileRef.current) fileRef.current.value = '' // allow re-uploading the same file
    setBusy(false)
  }

  if (isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div>
      <h2 className="mb-2 text-3xl">Import Results</h2>
      <p className="mb-6 text-sm text-[var(--color-muted)]">
        Pick a round, drop in the race-control export (CSV is cleanest; PDF is best-effort), review
        the grid, and save. Saving replaces that round's results and recomputes standings.
      </p>

      {/* Event picker + source */}
      <div className="grid gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">Round</span>
          <select className="hcr-select" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {sortedEvents.map((e) => (
              <option key={e.id} value={e.id}>
                R{e.round} · {e.name ?? e.track?.name} {e.status === 'complete' ? '· (has results)' : ''}
              </option>
            ))}
          </select>
          {existing != null && (
            <span className="mt-1.5 block text-xs text-[var(--color-faint)]">
              {existing > 0 ? `${existing} result rows currently saved for this round.` : 'No results saved yet.'}
            </span>
          )}
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.pdf,text/csv,application/pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          <button onClick={() => fileRef.current?.click()} className="hcr-btn hcr-btn-dark">Upload CSV / PDF</button>
          <button onClick={() => setPasteOpen((v) => !v)} className="hcr-btn hcr-btn-ghost">Paste</button>
          <button onClick={addRow} className="hcr-btn hcr-btn-ghost">+ Row</button>
        </div>
      </div>

      {pasteOpen && (
        <div className="mt-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <textarea
            className="hcr-textarea font-mono text-xs"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste tab- or space-separated results (with a header row if you have one)…"
          />
          <div className="mt-2 flex gap-2">
            <button onClick={runPaste} className="hcr-btn hcr-btn-primary">Parse Pasted Text</button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 rounded-lg bg-[var(--color-red)]/10 px-4 py-3 text-sm text-[var(--color-red)]">{error}</p>}
      {note && <p className="mt-4 rounded-lg bg-[var(--color-green)]/10 px-4 py-3 text-sm text-[var(--color-green)]">{note}</p>}

      {/* Review grid */}
      {rows.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xl">Review · {rows.length} rows</h3>
            <div className="flex gap-2">
              <button onClick={autofill} className="hcr-btn hcr-btn-ghost !py-2 !text-xs">Auto-fill points</button>
              <button onClick={() => setRows([])} className="hcr-btn hcr-btn-ghost !py-2 !text-xs">Clear</button>
              <button onClick={save} disabled={busy} className="hcr-btn hcr-btn-primary !py-2 !text-xs">
                {busy ? 'Saving…' : 'Save Results'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-[var(--color-line)]">
            <table className="border-collapse bg-[var(--color-paper)] text-xs">
              <thead>
                <tr className="border-b border-[var(--color-line)] bg-[var(--color-mist)] text-left font-mono uppercase tracking-wider text-[var(--color-muted)]">
                  <th className="px-2 py-2"></th>
                  {GRID_FIELDS.map((f) => (
                    <th key={f} className="whitespace-nowrap px-2 py-2">{FIELD_LABELS[f]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-[var(--color-line)] last:border-0">
                    <td className="px-2 py-1">
                      <button onClick={() => removeRow(i)} className="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center text-[var(--color-faint)] hover:text-[var(--color-red)]" aria-label="Remove row">✕</button>
                    </td>
                    {GRID_FIELDS.map((f) => (
                      <td key={f} className="px-1 py-1">
                        <input
                          value={row[f] ?? ''}
                          onChange={(e) => setCell(i, f, e.target.value)}
                          className={`w-full rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-[var(--color-line)] focus:border-[var(--color-blue)] focus:outline-none tabular ${
                            f === 'drivers_text' ? 'min-w-[150px]' : f === 'car' ? 'min-w-[110px]' : 'min-w-[52px]'
                          }`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
