/**
 * Lightweight fuzzy matching for the command palette: a case-insensitive
 * subsequence test with bonuses for contiguous runs and start-of-word
 * matches. Pure functions, no npm dependency.
 */

const SEPARATOR = /[\s\-_/()[\]:,.;]/;

/**
 * Scores `text` against `query` with a case-insensitive subsequence match:
 * every query character must appear in order in the text. Returns -1 when
 * the query does not match. Higher is better; matches at word starts and
 * contiguous runs score highest.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) {
    return 0;
  }
  let score = 0;
  let searchFrom = 0;
  let previousIndex = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, searchFrom);
    if (found === -1) {
      return -1;
    }
    if (found === 0 || SEPARATOR.test(t[found - 1] ?? "")) {
      score += 8;
    }
    if (found === previousIndex + 1) {
      score += 5;
    }
    score += 1;
    previousIndex = found;
    searchFrom = found + 1;
  }
  return score;
}

/**
 * Keeps the items whose text fuzzy-matches the query, best score first.
 * Ties keep the caller's original order (e.g. the server's recency order).
 * An empty query returns the items unchanged.
 */
export function filterAndSort<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): T[] {
  if (!query.trim()) {
    return items;
  }
  return items
    .map((item, index) => ({
      item,
      index,
      score: fuzzyScore(query, getText(item)),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
