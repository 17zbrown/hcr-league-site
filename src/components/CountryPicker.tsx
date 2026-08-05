import { useEffect, useRef, useState } from 'react'
import { COUNTRIES, flagFor, searchCountries, type Country } from '../lib/countries'

/**
 * Type a country, see flags.
 *
 * A combobox rather than a <select>: 200 countries in a native dropdown is a scroll,
 * and the thing people actually do is type the first few letters. The list appears
 * under the box as they type and the flag sits inside the field once chosen.
 *
 * It stores the country NAME, not the code — `drivers.country` is read directly by
 * pages that just print it, and a bare "US" would read worse than "United States"
 * everywhere the picker isn't. flagFor() derives the emoji at render time and still
 * understands the raw emoji and codes the column already contains.
 */
export function CountryPicker({
  value,
  onChange,
  placeholder = 'Start typing a country…',
  className = '',
  ariaLabel = 'Nationality',
  compact = false,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
  ariaLabel?: string
  /** Table-row sizing: flag only, no name, narrow field. */
  compact?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const flag = flagFor(value)
  // While open the field shows what is being typed; closed it shows the choice.
  const shown = open ? query : value

  const matches: Country[] = open && query.trim() ? searchCountries(query) : []

  // Clicking anywhere else commits whatever is showing and closes the list.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const choose = (c: Country) => {
    onChange(c.name)
    setQuery('')
    setOpen(false)
    setActive(0)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || !matches.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % matches.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(matches[active]) }
    else if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <div className="relative">
        {flag && !open && (
          <span aria-hidden className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${compact ? 'left-2 text-base' : 'left-3 text-lg'}`}>
            {flag}
          </span>
        )}
        <input
          className={`hcr-input ${compact ? '!py-2 !text-sm' : ''} ${flag && !open ? (compact ? '!pl-8' : '!pl-10') : ''}`}
          value={shown}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => { setQuery(value); setOpen(true) }}
          onKeyDown={onKey}
          placeholder={placeholder}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-autocomplete="list"
        />
      </div>

      {open && matches.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] py-1 shadow-card"
        >
          {matches.map((c, i) => (
            <li key={c.code}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={(e) => { e.preventDefault(); choose(c) }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${
                  i === active ? 'bg-[var(--color-mist)]' : ''
                }`}
              >
                <span className="text-lg" aria-hidden>{c.flag}</span>
                <span className="flex-1">{c.name}</span>
                <span className="font-mono text-[11px] text-[var(--color-muted)]">{c.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && query.trim() && matches.length === 0 && (
        <p className="absolute z-30 mt-1 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-xs text-[var(--color-muted)]">
          No country matches “{query.trim()}”. {COUNTRIES.length} are listed — check the spelling.
        </p>
      )}
    </div>
  )
}
