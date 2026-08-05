import { useMemo, useState } from 'react'
import { filterBy } from '../lib/search'

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
