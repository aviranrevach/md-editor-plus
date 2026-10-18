// Pure text-search logic shared by the find bar. No ProseMirror, no DOM — just
// "given a string and a query, where are the matches". The ProseMirror position
// mapping and decoration rendering live in searchExtension.ts; this stays
// trivially unit-testable.

export interface MatchRange {
  /** Offset of the first matched character (inclusive). */
  start: number;
  /** Offset just past the last matched character (exclusive). */
  end: number;
}

export interface FindOptions {
  caseSensitive?: boolean;
}

/**
 * Find every non-overlapping occurrence of `query` in `text`. Plain-text match
 * (the query is treated literally, never as a regex). Case-insensitive unless
 * `caseSensitive` is set. An empty query yields no matches.
 */
export function findMatches(text: string, query: string, opts: FindOptions = {}): MatchRange[] {
  if (!query) return [];

  const caseSensitive = opts.caseSensitive ?? false;
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();

  const out: MatchRange[] = [];
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) break;
    out.push({ start: idx, end: idx + needle.length });
    from = idx + needle.length; // advance past the match → non-overlapping
  }
  return out;
}
