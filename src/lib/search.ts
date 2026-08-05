/**
 * One matching rule for every search box and column filter on the site.
 *
 * Deliberately forgiving in the ways people actually mistype: accents are folded
 * ("Huracán" matches "huracan"), punctuation is ignored ("Collins11" matches
 * "collins 11"), and a query's words may appear in any order and any field
 * ("travis corvette" finds Elijah Travis in the Corvette). Anything stricter makes a
 * search box feel broken; anything looser stops narrowing usefully.
 */

/** Lower-case, strip accents and punctuation, collapse whitespace. */
export function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Does `haystack` satisfy `query`? Every word in the query must appear somewhere,
 * which is what makes multi-word searches narrow instead of widen.
 */
export function matches(query: string, ...haystack: unknown[]): boolean {
  const q = norm(query)
  if (!q) return true
  const hay = norm(haystack.filter((h) => h !== null && h !== undefined).join(' '))
  return q.split(' ').every((word) => hay.includes(word))
}

/** Filter a list by a query over fields chosen per item. */
export function filterBy<T>(rows: T[], query: string, fields: (row: T) => unknown[]): T[] {
  if (!norm(query)) return rows
  return rows.filter((r) => matches(query, ...fields(r)))
}
