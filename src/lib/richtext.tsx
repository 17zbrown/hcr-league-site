import type { ReactNode } from 'react'

/**
 * `**bold**` and `*italic*` → elements.
 *
 * Bold is matched first, because a lazy single-asterisk rule would otherwise swallow
 * the inner text of a bold run and leave stray asterisks on the page.
 *
 * Shared by the rulebook and the newsroom. It lived in Rulebook.tsx alone until the
 * news feed needed the same thing; two copies of a formatter is how one of them ends
 * up quietly worse than the other.
 *
 * Builds React nodes, never innerHTML, so stored copy can never inject markup.
 */
export function inline(text: string, keyBase: string): ReactNode[] {
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
