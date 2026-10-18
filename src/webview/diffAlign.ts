// Pure: turns base + current block arrays into aligned two-pane rows.
// Reuses the LCS from conflictDiff. No DOM, no editor.
import { lineOps } from './conflictDiff';

export type AlignKind = 'eq' | 'change' | 'add' | 'del';
export interface AlignRow {
  kind: AlignKind;
  left: number | null;  // index into baseBlocks
  right: number | null; // index into currentBlocks
}

export function computeAlignment(baseBlocks: string[], currentBlocks: string[]): AlignRow[] {
  const ops = lineOps(baseBlocks, currentBlocks);
  const rows: AlignRow[] = [];
  let li = 0; // base index
  let ri = 0; // current index
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === 'eq') {
      rows.push({ kind: 'eq', left: li, right: ri });
      li++; ri++; k++;
      continue;
    }
    // Gather one hunk of consecutive non-eq ops, counting dels and adds.
    const delStart = li;
    const addStart = ri;
    let dels = 0, adds = 0;
    while (k < ops.length && ops[k].t !== 'eq') {
      if (ops[k].t === 'del') dels++;
      else adds++;
      k++;
    }
    // Pair the overlap positionally: first N read as "changed" (both sides),
    // the remainder is a pure add or pure del. Matches computeConflictDiff.
    const paired = Math.min(dels, adds);
    for (let p = 0; p < paired; p++) rows.push({ kind: 'change', left: delStart + p, right: addStart + p });
    for (let p = paired; p < dels; p++) rows.push({ kind: 'del', left: delStart + p, right: null });
    for (let p = paired; p < adds; p++) rows.push({ kind: 'add', left: null, right: addStart + p });
    li = delStart + dels;
    ri = addStart + adds;
  }
  return rows;
}
