import Papa from 'papaparse'
import type { Season } from './types'

/** Canonical fields we import into the `results` table. */
export type Field =
  | 'cls_pos' | 'pos' | 'class_id' | 'number' | 'drivers_text' | 'car'
  | 'grid' | 'laps' | 'laps_led' | 'total_time' | 'gap' | 'intvl' | 'best_lap' | 'best_on'
  | 'inc' | 'status' | 'points' | 'quali_pos' | 'quali_time' | 'quali_points' | 'avg_lap' | 'fill_in'

export interface ImportedRow {
  cls_pos?: string
  pos?: string
  class_id?: string
  number?: string
  drivers_text?: string
  car?: string
  grid?: string
  laps?: string
  laps_led?: string
  total_time?: string
  gap?: string
  intvl?: string
  best_lap?: string
  best_on?: string
  inc?: string
  status?: string
  points?: string
  quali_pos?: string
  quali_time?: string
  quali_points?: string
  avg_lap?: string
  fill_in?: string
}

export const FIELD_LABELS: Record<Field, string> = {
  cls_pos: 'Cls Pos', pos: 'Overall', class_id: 'Class', number: 'No.',
  drivers_text: 'Driver(s)', car: 'Car', grid: 'Grid', laps: 'Laps',
  laps_led: 'Laps Led', total_time: 'Total Time', gap: 'Gap', intvl: 'Interval', best_lap: 'Best Lap',
  best_on: 'Best On', inc: 'Inc', status: 'Status', points: 'Pts',
  quali_pos: 'Q Pos', quali_time: 'Q Time', quali_points: 'Q Pts', avg_lap: 'Avg Lap', fill_in: 'Fill-In (y/n)',
}

// Columns shown in the review grid, in order.
export const GRID_FIELDS: Field[] = [
  'cls_pos', 'pos', 'class_id', 'number', 'drivers_text', 'car', 'grid', 'laps',
  'laps_led', 'best_lap', 'inc', 'status', 'quali_pos', 'quali_time', 'quali_points', 'points', 'fill_in',
]

/** True when a fill-in cell says yes: y / yes / true / 1 / x / fill / fill-in. */
export function isFillIn(v?: string): boolean {
  const s = (v ?? '').trim().toLowerCase()
  return s === 'y' || s === 'yes' || s === 'true' || s === '1' || s === 'x' || s === 'fill' || s === 'fill-in' || s === 'fillin'
}

const SYNONYMS: Record<Field, string[]> = {
  cls_pos: ['clspos', 'classpos', 'classposition', 'posinclass', 'pic', 'inclass', 'clspos'],
  pos: ['pos', 'position', 'overall', 'fin', 'finish', 'finishpos', 'finishingposition', 'p'],
  class_id: ['class', 'category', 'cls', 'cat'],
  number: ['no', 'number', 'carnumber', 'carno', 'num', 'carnum'],
  drivers_text: ['driver', 'drivers', 'name', 'entry', 'competitor', 'teamdriver', 'crew'],
  car: ['car', 'cartype', 'vehicle', 'model', 'carmodel', 'make', 'chassis'],
  // NB: 'qualpos' belongs to quali_pos only — listing it here too made grid win
  // the match (object key order), so a lone "Qual Pos" column imported as grid.
  grid: ['grid', 'start', 'startpos', 'startingposition', 'st'],
  laps: ['laps', 'lap', 'completed', 'lapscompleted', 'lapscomp'],
  // "Laps Led" used to contains-match `laps` and steal it — a zero-led finisher
  // then imported as laps<1 and the DB trigger scored them DNS. Exact home first.
  laps_led: ['lapsled', 'led', 'lapslead'],
  total_time: ['time', 'totaltime', 'racetime', 'total', 'elapsed'],
  gap: ['gap', 'behind', 'delta'],
  intvl: ['interval', 'int', 'intvl'],
  best_lap: ['best', 'bestlap', 'fastlap', 'fastest', 'fastestlap', 'fastestlaptime', 'besttime', 'fl'],
  // iRaceControl's "Fast Lap#" is the LAP NUMBER the fastest lap was set on. norm()
  // turns '#' into 'num', so it arrives here as 'fastlapnum' and cannot collide
  // with a plain "Fast Lap" time column.
  best_on: ['bestlapnum', 'beston', 'fllap', 'bestlapon', 'fastlapnum'],
  inc: ['inc', 'incidents', 'incident', 'contact', 'x'],
  status: ['status', 'result', 'out', 'classified', 'reason'],
  points: ['points', 'pts', 'championshippoints', 'champpts'],
  quali_pos: ['qualpos', 'qualifying', 'qualifyingposition', 'qpos', 'qualiposition', 'qual'],
  quali_time: ['qualifytime', 'qualtime', 'qualifyingtime', 'qtime', 'qualitime'],
  avg_lap: ['averagelaptime', 'avglap', 'avglaptime', 'averagelap'],
  quali_points: ['qualpoints', 'qpts', 'polepoints', 'qualifyingpoints'],
  fill_in: ['fillin', 'fill', 'guest', 'wildcard', 'nonscoring', 'invitational'],
}

function norm(s: string) {
  // '#' means "number" on every timing sheet — keep that meaning instead of
  // deleting it, so "Car #" and "Fast Lap#" stay distinguishable from "Car" and
  // "Fast Lap" after normalisation.
  return s.toLowerCase().replace(/#/g, 'num').replace(/[^a-z0-9]/g, '')
}

/**
 * Map every header to a canonical field — EXACT MATCHES FIRST, ACROSS THE WHOLE
 * ROW, then a contains pass over what is left.
 *
 * A per-column exact-then-contains order let an EARLIER fuzzy column steal a
 * LATER column's exact home: iRaceControl orders "Out ID" before "Out" and
 * "Laps Led" before "Laps Comp", so `status` held a numeric id and `laps` held
 * laps led — and a finisher who led nothing imported as a 0-lap DNS.
 *
 * The contains pass keeps two guards: only the header may contain the synonym
 * (never the reverse — a lone short header used to claim whole fields), and the
 * synonym must be 5+ characters, because 'car' inside 'carid' and 'fill' inside
 * 'maxfuelfill' are coincidences, not matches.
 */
function mapHeaders(headers: string[]): (Field | null)[] {
  const fields = Object.keys(SYNONYMS) as Field[]
  const taken = new Set<Field>()
  const out: (Field | null)[] = headers.map(() => null)

  headers.forEach((header, i) => {
    const h = norm(header)
    if (!h) return
    for (const f of fields) {
      if (taken.has(f)) continue
      if (SYNONYMS[f].some((s) => s === h)) { out[i] = f; taken.add(f); return }
    }
  })
  headers.forEach((header, i) => {
    if (out[i]) return
    const h = norm(header)
    if (!h) return
    for (const f of fields) {
      if (taken.has(f)) continue
      if (SYNONYMS[f].some((s) => s.length >= 5 && h.includes(s))) { out[i] = f; taken.add(f); return }
    }
  })
  return out
}

/** Parse a CSV string into review rows with fuzzy header mapping. */
export function parseCsv(text: string): ImportedRow[] {
  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true })
  const rows = parsed.data.filter((r) => Array.isArray(r) && r.some((c) => String(c).trim() !== ''))
  if (!rows.length) return []

  const headers = rows[0].map(String)
  const colMap = mapHeaders(headers)

  // If we mapped at least a couple of columns, treat row 0 as a header.
  const mappedCount = colMap.filter(Boolean).length
  const dataRows = mappedCount >= 2 ? rows.slice(1) : rows

  return dataRows.map((cells) => {
    const row: ImportedRow = {}
    cells.forEach((val, i) => {
      const f = colMap[i]
      if (f) row[f] = String(val).trim()
    })
    return row
  })
}

/** Best-effort parse of pasted / PDF-extracted plain text (whitespace or tab columns). */
export function parseText(text: string): ImportedRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() !== '')
  if (!lines.length) return []

  // Find a header line containing recognizable tokens.
  let headerIdx = lines.findIndex((l) => /\b(pos|driver|class|laps|grid)\b/i.test(l))
  if (headerIdx < 0) headerIdx = 0

  const splitCells = (l: string) => l.split(/\t|\s{2,}/).map((c) => c.trim()).filter(Boolean)
  const headers = splitCells(lines[headerIdx])
  const colMap = mapHeaders(headers)
  const mapped = colMap.filter(Boolean).length

  const body = lines.slice(headerIdx + 1)
  return body.map((line) => {
    const cells = splitCells(line)
    const row: ImportedRow = {}
    if (mapped >= 2) {
      cells.forEach((val, i) => {
        const f = colMap[i]
        if (f) row[f] = val
      })
    } else {
      // no reliable header: drop the whole line into driver text for manual editing
      row.drivers_text = line.trim()
    }
    return row
  })
}

/** Extract text from a PDF File using pdfjs (loaded on demand). */
export async function pdfToText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const out: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    // Group text items into lines by their vertical position.
    const byLine = new Map<number, { x: number; s: string }[]>()
    for (const item of content.items as any[]) {
      const y = Math.round(item.transform[5])
      const x = item.transform[4]
      if (!byLine.has(y)) byLine.set(y, [])
      byLine.get(y)!.push({ x, s: item.str })
    }
    const ys = Array.from(byLine.keys()).sort((a, b) => b - a)
    for (const y of ys) {
      const parts = byLine.get(y)!.sort((a, b) => a.x - b.x)
      // Collapse whitespace WITHIN each cell, then join with the double-space
      // delimiter parseText splits on. Collapsing after the join erased the
      // very delimiters we just inserted, so PDF rows never split into columns.
      out.push(
        parts
          .map((p) => p.s.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join('  ')
          .trim(),
      )
    }
  }
  return out.filter(Boolean).join('\n')
}

/** Fill championship points from the season tables based on class position. */
export function autofillPoints(rows: ImportedRow[], season: Season | null | undefined): ImportedRow[] {
  const pts = season?.points_table ?? []
  const qpts = season?.quali_table ?? []
  return rows.map((r) => {
    const clsPos = parseInt(r.cls_pos ?? '', 10)
    const qPos = parseInt(r.quali_pos ?? '', 10)
    const next = { ...r }
    if (!Number.isNaN(clsPos) && clsPos >= 1 && pts.length >= clsPos) next.points = String(pts[clsPos - 1])
    if (!Number.isNaN(qPos) && qPos >= 1 && qpts.length >= qPos) next.quali_points = String(qpts[qPos - 1])
    return next
  })
}

const numOrNull = (v?: string) => {
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/** Key for `teamByClassNumber`: numbers repeat across classes, so class is part of it. */
export function teamKey(classId: string | null | undefined, number: string | null | undefined) {
  return `${(classId ?? '').toUpperCase()}|${(number ?? '').trim()}`
}

/**
 * Convert a review row into a `results` insert payload.
 *
 * `teamByClassNumber` is keyed by class AND number because car numbers are only unique
 * within a class. Keying on the number alone silently misattributed team points the
 * moment two classes shared one: GTD #87 is ALDI Racing, LMP2 #87 is Bad Penny Racing.
 */
export function toResultInsert(r: ImportedRow, eventId: string, teamByClassNumber: Map<string, string>) {
  const number = (r.number ?? '').trim()
  const classId = (r.class_id ?? '').toUpperCase() || null
  return {
    event_id: eventId,
    class_id: classId,
    number,
    drivers_text: r.drivers_text ?? null,
    car: r.car ?? null,
    pos: numOrNull(r.pos),
    cls_pos: numOrNull(r.cls_pos),
    grid: numOrNull(r.grid),
    laps: numOrNull(r.laps),
    laps_led: numOrNull(r.laps_led),
    total_time: r.total_time ?? null,
    gap: r.gap ?? null,
    intvl: r.intvl ?? null,
    best_lap: r.best_lap ?? null,
    best_on: numOrNull(r.best_on),
    inc: numOrNull(r.inc),
    status: r.status ?? null,
    points: numOrNull(r.points),
    quali_pos: numOrNull(r.quali_pos),
    quali_time: r.quali_time?.trim() || null,
    quali_points: numOrNull(r.quali_points),
    avg_lap: r.avg_lap?.trim() || null,
    team_id: (number && teamByClassNumber.get(teamKey(classId, number))) || null,
    fill_in: isFillIn(r.fill_in),
  }
}
