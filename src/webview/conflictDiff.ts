// Pure, dependency-free line diff for the conflict banner. No DOM.
// Produces row-aligned side-by-side rows for ONLY the changed region.

export type DiffRowKind = 'change' | 'add' | 'del';
export interface DiffRow { kind: DiffRowKind; yours: string | null; disk: string | null; }
export interface ConflictDiff { rows: DiffRow[]; truncated: number; }

function splitLines(s: string): string[] {
  const t = s.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  return t === '' ? [] : t.split('\n');
}

type Op = { t: 'eq' | 'del' | 'add'; a?: string; b?: string };

// Classic LCS via DP, then backtrack into an ordered op list.
function lineOps(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: 'eq', a: a[i], b: b[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', a: a[i] }); i++; }
    else { ops.push({ t: 'add', b: b[j] }); j++; }
  }
  while (i < n) ops.push({ t: 'del', a: a[i++] });
  while (j < m) ops.push({ t: 'add', b: b[j++] });
  return ops;
}

export function computeConflictDiff(yours: string, disk: string, maxRows = 200): ConflictDiff {
  const ops = lineOps(splitLines(yours), splitLines(disk));
  const rows: DiffRow[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === 'eq') { k++; continue; }
    const dels: string[] = [];
    const adds: string[] = [];
    while (k < ops.length && ops[k].t !== 'eq') {
      if (ops[k].t === 'del') dels.push(ops[k].a as string);
      else adds.push(ops[k].b as string);
      k++;
    }
    const paired = Math.min(dels.length, adds.length);
    for (let p = 0; p < paired; p++) rows.push({ kind: 'change', yours: dels[p], disk: adds[p] });
    for (let p = paired; p < dels.length; p++) rows.push({ kind: 'del', yours: dels[p], disk: null });
    for (let p = paired; p < adds.length; p++) rows.push({ kind: 'add', yours: null, disk: adds[p] });
  }
  if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), truncated: rows.length - maxRows };
  return { rows, truncated: 0 };
}
