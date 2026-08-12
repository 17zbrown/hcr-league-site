import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCurrentSeason, useDrivers, useEvents, useNews } from '../lib/queries'
import { flagFor } from '../lib/countries'
import { matches } from '../lib/search'
import { fmtDateLong } from '../lib/format'

interface Hit {
  id: string
  kind: 'Driver' | 'Race' | 'News'
  label: string
  detail: string
  to: string
  lead?: string
}

/**
 * One search across everything the site knows: drivers, races, news.
 *
 * No teams. `teams` has zero rows and nothing references one, so the branch could
 * only ever emit hits to an empty page — while the placeholder and the empty state
 * went on advertising a fourth thing to search.
 *
 * All three lists are already in the query cache for other pages, so searching adds
 * no requests — it filters what is in memory. That is also why it can answer on the
 * keystroke rather than debouncing against the network.
 *
 * Opens on ⌘K / Ctrl-K, closes on Escape, and arrow keys move through results, so
 * it behaves like the palette people expect rather than a box that only takes a
 * mouse.
 */
export function GlobalSearch() {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: season } = useCurrentSeason()
  const { data: drivers } = useDrivers()
  const { data: events } = useEvents(season?.id)
  const { data: news } = useNews(30)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      } else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10)
    else { setQ(''); setActive(0) }
  }, [open])

  const hits = useMemo<Hit[]>(() => {
    if (!q.trim()) return []
    const out: Hit[] = []
    for (const d of drivers ?? []) {
      if (matches(q, d.name, d.country, d.team?.name, d.iracing_custid)) {
        out.push({
          id: `d-${d.id}`, kind: 'Driver', label: d.name,
          detail: d.team?.name ?? 'Free agent',
          to: `/drivers/${d.id}`, lead: flagFor(d.country),
        })
      }
    }
    for (const e of events ?? []) {
      if (matches(q, e.name, e.track?.name, e.track?.location, e.round)) {
        out.push({
          id: `e-${e.id}`, kind: 'Race', label: e.name || e.track?.name || `Round ${e.round}`,
          detail: `Round ${e.round} · ${fmtDateLong(e.date)}`,
          to: `/schedule/${e.id}`,
        })
      }
    }
    for (const a of news ?? []) {
      if (matches(q, a.title, a.dek, a.category, a.author)) {
        out.push({ id: `n-${a.id}`, kind: 'News', label: a.title, detail: a.category, to: '/news' })
      }
    }
    return out.slice(0, 12)
  }, [q, drivers, events, news])

  const go = (h: Hit) => { nav(h.to); setOpen(false) }

  const onKey = (e: React.KeyboardEvent) => {
    if (!hits.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % hits.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + hits.length) % hits.length) }
    else if (e.key === 'Enter') { e.preventDefault(); go(hits[active]) }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search the site"
        className="flex h-11 items-center gap-2 rounded-lg border border-[var(--color-line-2)] px-3 text-[var(--color-muted)] transition-colors hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
      >
        <span aria-hidden>⌕</span>
        <span className="hidden font-mono text-xs uppercase tracking-widest md:inline">Search</span>
        <kbd className="hidden rounded border border-[var(--color-line-2)] px-1.5 py-0.5 font-mono text-[10px] lg:inline">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
          role="dialog"
          aria-modal="true"
          aria-label="Search"
        >
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] shadow-card">
            <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4">
              <span aria-hidden className="text-[var(--color-muted)]">⌕</span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => { setQ(e.target.value); setActive(0) }}
                onKeyDown={onKey}
                placeholder="Drivers, races, news…"
                aria-label="Search drivers, races and news"
                className="w-full bg-transparent py-4 text-base outline-none placeholder:text-[var(--color-faint)]"
              />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close search"
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]">Esc</button>
            </div>

            {q.trim() && hits.length === 0 && (
              <p className="px-4 py-6 text-sm text-[var(--color-muted)]">
                Nothing matches “{q.trim()}”.
              </p>
            )}

            {hits.length > 0 && (
              <ul className="max-h-[55vh] overflow-auto py-1">
                {hits.map((h, i) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); go(h) }}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${i === active ? 'bg-[var(--color-mist)]' : ''}`}
                    >
                      {h.lead && <span aria-hidden className="text-lg">{h.lead}</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{h.label}</span>
                        <span className="block truncate text-xs text-[var(--color-muted)]">{h.detail}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-[var(--color-mist)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                        {h.kind}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!q.trim() && (
              <p className="px-4 py-6 text-sm text-[var(--color-muted)]">
                Search across drivers, races and news. ↑↓ to move, ↵ to open.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
