import { useMemo, useState } from 'react'
import { filterBy, matches, norm } from '../lib/search'

/**
 * The site's one search input. A component rather than a bare <input> so every
 * search box has the same clear button, the same count, and the same "nothing
 * matched" behaviour — a filter that silently empties a table reads as a bug.
 */
export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
  count,
  total,
  className = '',
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** Shown as "12 of 37" once filtering, so a short list is obviously filtered. */
  count?: number
  total?: number
  className?: string
  ariaLabel?: string
}) {
  const filtering = value.trim().length > 0
  return (
    <div className={`relative ${className}`}>
      <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]">
        ⌕
      </span>
      <input
        className="hcr-input !py-2 !pl-8 !pr-20 !text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        type="search"
      />
      {filtering && (
        <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {count !== undefined && total !== undefined && (
            <span className="tabular text-[11px] text-[var(--color-muted)]">{count}/{total}</span>
          )}
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="rounded px-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            ✕
          </button>
        </span>
      )}
    </div>
  )
}

/**
 * Search state plus the filtered rows, so a page adds a working search box in two
 * lines instead of re-deriving the same useMemo each time.
 */
export function useSearch<T>(rows: T[], fields: (row: T) => unknown[]) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterBy(rows, query, fields), [rows, query, fields])
  return { query, setQuery, filtered, total: rows.length, count: filtered.length }
}

/**
 * A per-column filter that lives in a table header.
 *
 * Narrower and quieter than SearchBox because it sits under a column label and must
 * not out-shout it.
 */
export function ColumnFilter({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <input
      className="hcr-input mt-1.5 !w-full !border-[var(--color-line)] !px-2 !py-1 !text-[11px] font-body font-normal normal-case tracking-normal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Filter…"
      aria-label={`Filter by ${label}`}
      type="search"
    />
  )
}

/** The parts of a column-filter controller the header UI needs. */
export interface ColumnFilterUi {
  filters: Record<string, string>
  set: (key: string, value: string) => void
  clear: () => void
  open: boolean
  setOpen: (open: boolean) => void
  /** How many columns are actually narrowing right now. */
  active: number
}

export interface ColumnFilters<T> extends ColumnFilterUi {
  apply: (rows: T[]) => T[]
}

/**
 * Per-column filtering for a table.
 *
 * `columns` maps a column key to the value that column *displays*, so a filter asks
 * the same question the eye does — filtering the Driver column on "collins" cannot
 * accidentally match a lap time.
 *
 * The inputs are hidden behind a toggle rather than always on. A permanent row of
 * text boxes under every heading turns a results table into a form, and the timing
 * tower is the one thing on this site that has to look like broadcast rather than
 * admin.
 */
export function useColumnFilters<T>(columns: Record<string, (row: T) => unknown>): ColumnFilters<T> {
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [open, setOpen] = useState(false)

  const live = Object.entries(filters).filter(([, v]) => norm(v))

  return {
    filters,
    open,
    setOpen,
    active: live.length,
    set: (key, value) => setFilters((f) => ({ ...f, [key]: value })),
    clear: () => setFilters({}),
    apply: (rows) => {
      if (!live.length) return rows
      return rows.filter((row) =>
        live.every(([key, q]) => {
          const read = columns[key]
          // An unknown key filters nothing rather than everything: a typo in a column
          // map should not empty the table.
          return read ? matches(q, read(row)) : true
        }),
      )
    },
  }
}

/**
 * The button that reveals the filter row. Closing also clears, so a filter can never
 * keep hiding rows after its input has gone off screen.
 */
export function ColumnFilterToggle({ ctl, className = '' }: { ctl: ColumnFilterUi; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (ctl.open) ctl.clear()
        ctl.setOpen(!ctl.open)
      }}
      aria-pressed={ctl.open}
      className={`hcr-chip ${ctl.open ? 'hcr-chip-active' : ''} ${className}`}
    >
      {ctl.active > 0 ? `Columns · ${ctl.active}` : 'Filter columns'}
    </button>
  )
}

/**
 * The filter row itself, rendered inside <thead> under the labels.
 *
 * `cells` is the table's columns in order, with `null` for any column there is
 * nothing sensible to filter on (a button column, a spacer). Passing the full run of
 * columns is what keeps the inputs lined up with the headings above them.
 */
export function ColumnFilterRow({
  ctl,
  cells,
  className = 'px-4 pb-3 pt-0',
}: {
  ctl: ColumnFilterUi
  cells: ({ key: string; label: string } | null)[]
  className?: string
}) {
  if (!ctl.open) return null
  return (
    <tr className="border-b border-[var(--color-line)] bg-[var(--color-paper)]">
      {cells.map((c, i) => (
        <th key={c?.key ?? `spacer-${i}`} scope="col" className={`${className} align-top`}>
          {c && (
            <ColumnFilter
              value={ctl.filters[c.key] ?? ''}
              onChange={(v) => ctl.set(c.key, v)}
              label={c.label}
            />
          )}
        </th>
      ))}
    </tr>
  )
}
