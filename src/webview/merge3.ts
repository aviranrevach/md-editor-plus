// Pure line-level 3-way merge. No DOM, no vscode — unit-testable.
//
// Returns the merged text when ours and theirs change DISJOINT line-ranges of
// base; returns null (→ caller asks the user) on any overlap, same-start edit,
// or ambiguity. Never fabricates content or an ordering.

interface Hunk { start: number; end: number; lines: string[]; } // base[start,end) -> lines

function splitLines(s: string): string[] {
  return s === '' ? [] : s.split('\n');
}

// LCS of two line arrays → ordered hunks describing how to turn `base` into `other`.
function diffHunks(base: string[], other: string[]): Hunk[] {
  const n = base.length;
  const m = other.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = base[i] === other[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  // Accumulate a run of non-matching lines into one hunk.
  let runStart = -1;
  let runLines: string[] = [];
  const flush = (endBase: number) => {
    if (runStart >= 0) { hunks.push({ start: runStart, end: endBase, lines: runLines }); runStart = -1; runLines = []; }
  };
  while (i < n && j < m) {
    if (base[i] === other[j]) {
      flush(i);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      // delete base[i]
      if (runStart < 0) runStart = i;
      i++;
    } else {
      // insert other[j]
      if (runStart < 0) runStart = i;
      runLines.push(other[j]);
      j++;
    }
  }
  // tail
  if (i < n || j < m) {
    if (runStart < 0) runStart = i;
    while (j < m) { runLines.push(other[j]); j++; }
    i = n;
  }
  flush(i);
  return hunks;
}

export function merge3(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours;
  if (base === ours) return theirs;
  if (base === theirs) return ours;

  const b = splitLines(base);
  const oh = diffHunks(b, splitLines(ours));
  const th = diffHunks(b, splitLines(theirs));

  // Conflict if any base ranges overlap, or two hunks start at the same base line
  // (catches same-point insertions and same-start replacements).
  for (const a of oh) {
    for (const c of th) {
      if (a.start === c.start) return null;
      if (a.start < c.end && c.start < a.end) return null;
    }
  }

  // Disjoint: apply both hunk sets to base in order.
  const all = [...oh, ...th].sort((x, y) => x.start - y.start || x.end - y.end);
  const out: string[] = [];
  let pos = 0;
  for (const h of all) {
    if (h.start < pos) return null; // residual overlap guard
    for (let k = pos; k < h.start; k++) out.push(b[k]);
    for (const ln of h.lines) out.push(ln);
    pos = h.end;
  }
  for (let k = pos; k < b.length; k++) out.push(b[k]);
  return out.join('\n');
}
