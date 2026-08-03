import { useMemo } from 'react'
import raw from '../content/rulebook.md?raw'

/**
 * The rulebook, as a page rather than a Drive link.
 *
 * A Drive PDF is invisible to search, awkward on a phone, and unreachable to anyone
 * who has lost the link — which is a poor home for the one document every driver is
 * told they have agreed to. The source of truth is now src/content/rulebook.md,
 * converted from the PDF and versioned with the site, so a rule change is a diff.
 *
 * Rendering is hand-rolled to match the newsroom, which also parses its own markup
 * rather than pulling in a library. The subset here is exactly what the rulebook
 * uses and nothing more: two heading levels, bullets, one table, and bold runs.
 */

type Block =
  | { kind: 'h2'; id: string; num: string; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'ul'; items: { text: string; sub: boolean }[] }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'p'; text: string }

/**
 * `**bold**` and `*italic*` → elements. Bold is matched first, because a lazy
 * single-asterisk rule would otherwise swallow the inner text of a bold run and
 * leave stray asterisks on the page.
 */
function inline(text: string, keyBase: string) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean).map((part, i) => {
    const key = `${keyBase}-${i}`
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key} className="font-semibold text-[var(--color-ink)]">{part.slice(2, -2)}</strong>
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      return <em key={key}>{part.slice(1, -1)}</em>
    }
    return <span key={key}>{part}</span>
  })
}

function parse(md: string): Block[] {
  const out: Block[] = []
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const s = line.trim()
    if (!s) { i++; continue }

    const h2 = /^##\s+(\d+)\.\s+(.+)$/.exec(s)
    if (h2) { out.push({ kind: 'h2', id: `s${h2[1]}`, num: h2[1], text: h2[2] }); i++; continue }

    const h3 = /^###\s+(.+)$/.exec(s)
    if (h3) { out.push({ kind: 'h3', text: h3[1] }); i++; continue }

    if (s.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        // the |---|---| separator row carries no data
        if (!cells.every((c) => /^-*$/.test(c))) rows.push(cells)
        i++
      }
      if (rows.length) out.push({ kind: 'table', rows })
      continue
    }

    if (s.startsWith('- ') || line.startsWith('  - ')) {
      const items: { text: string; sub: boolean }[] = []
      while (i < lines.length && (lines[i].trim().startsWith('- '))) {
        items.push({ text: lines[i].trim().slice(2), sub: lines[i].startsWith('  - ') })
        i++
      }
      out.push({ kind: 'ul', items })
      continue
    }

    out.push({ kind: 'p', text: s })
    i++
  }
  return out
}

export default function Rulebook() {
  const blocks = useMemo(() => parse(raw), [])
  const toc = useMemo(
    () => blocks.filter((b): b is Extract<Block, { kind: 'h2' }> => b.kind === 'h2'),
    [blocks],
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:py-14">
      <header className="mb-10">
        <span className="hcr-chip">Official document</span>
        <h1 className="mt-3 text-4xl md:text-6xl">Rulebook</h1>
        <p className="mt-3 max-w-2xl text-[var(--color-muted)]">
          Every driver who enters a race is treated as having read this. If something here is
          ambiguous, say so in Discord — an unclear rule is worth fixing for everyone.
        </p>
        <p className="mt-4 font-mono text-xs uppercase tracking-wider text-[var(--color-faint)]">
          Version 1.1 · {toc.length} sections
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[16rem_1fr]">
        {/* Contents. Sticky on desktop so section 31 is one click from section 4. */}
        <nav aria-label="Rulebook contents" className="lg:sticky lg:top-24 lg:self-start">
          <span className="mb-3 block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
            Contents
          </span>
          <ol className="max-h-[70vh] space-y-1 overflow-y-auto pr-2 text-sm">
            {toc.map((h) => (
              <li key={h.id}>
                <a
                  href={`#${h.id}`}
                  className="flex gap-2 rounded px-1 py-0.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-cloud)] hover:text-[var(--color-ink)]"
                >
                  <span className="tabular shrink-0 font-mono text-[var(--color-faint)]">{h.num}</span>
                  <span>{h.text}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="min-w-0">
          {blocks.map((b, i) => {
            switch (b.kind) {
              case 'h2':
                return (
                  <h2
                    key={i}
                    id={b.id}
                    className="mt-12 scroll-mt-24 border-t border-[var(--color-line)] pt-6 text-2xl first:mt-0 first:border-0 first:pt-0 md:text-3xl"
                  >
                    <span className="mr-2 font-mono text-base text-[var(--color-faint)]">{b.num}</span>
                    {b.text}
                  </h2>
                )
              case 'h3':
                return (
                  <h3 key={i} className="mt-7 font-body text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                    {b.text}
                  </h3>
                )
              case 'ul':
                return (
                  <ul key={i} className="mt-3 space-y-1.5">
                    {b.items.map((it, j) => (
                      <li
                        key={j}
                        className={`flex gap-2.5 text-[var(--color-ink-2)] ${it.sub ? 'ml-5' : ''}`}
                      >
                        <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--color-brand)]" />
                        <span>{inline(it.text, `${i}-${j}`)}</span>
                      </li>
                    ))}
                  </ul>
                )
              case 'table':
                return (
                  <div key={i} className="mt-4 overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <tbody>
                        {b.rows.map((r, j) => (
                          <tr key={j} className="border-b border-[var(--color-line)]">
                            {r.map((c, k) => (
                              <td
                                key={k}
                                className={`py-2 pr-4 align-top ${k === 0 ? 'font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]' : 'text-[var(--color-ink-2)]'}`}
                              >
                                {inline(c, `${i}-${j}-${k}`)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              default:
                return (
                  <p key={i} className="mt-3 leading-relaxed text-[var(--color-ink-2)]">
                    {inline(b.text, String(i))}
                  </p>
                )
            }
          })}

          <p className="mt-14 border-t border-[var(--color-line)] pt-6 text-sm text-[var(--color-faint)]">
            Rulebook version 1.1 · HCR Sim Racing League. Staff may amend these rules between
            seasons; material changes are announced in Discord before they take effect.
          </p>
        </article>
      </div>
    </div>
  )
}
