// Pure: turns base + current block arrays into positioned change marks (c55).
// No DOM / no editor. Reuses the LCS from conflictDiff.
import { lineOps } from './conflictDiff';

export interface BlockSide { md: string; docY: number; pos: number; }
export type DiffMarkKind = 'add' | 'change' | 'del';
export interface DiffMark { docY: number; kind: DiffMarkKind; pos?: number; }
export interface DiffMapInput { baseBlocks: string[]; currentBlocks: BlockSide[]; maxMarks?: number; }
export interface DiffMapResult { marks: DiffMark[]; truncated: number; }

export function computeDiffMarks(input: DiffMapInput): DiffMapResult {
  const { baseBlocks, currentBlocks, maxMarks = 200 } = input;
  const ops = lineOps(baseBlocks, currentBlocks.map((b) => b.md));
  const marks: DiffMark[] = [];
  const docEndY = currentBlocks.length ? currentBlocks[currentBlocks.length - 1].docY : 0;

  let bi = 0; // index into currentBlocks (the "b"/add side)
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === 'eq') { bi++; k++; continue; }

    const addStart = bi;
    let delCount = 0;
    let addCount = 0;
    while (k < ops.length && ops[k].t !== 'eq') {
      if (ops[k].t === 'del') delCount++;
      else { addCount++; bi++; }
      k++;
    }

    const paired = Math.min(delCount, addCount);
    for (let p = 0; p < addCount; p++) {
      const block = currentBlocks[addStart + p];
      if (!block) continue;
      marks.push({ docY: block.docY, kind: p < paired ? 'change' : 'add', pos: block.pos });
    }
    if (delCount > paired) {
      const seam = currentBlocks[addStart + addCount];
      marks.push({ docY: seam ? seam.docY : docEndY, kind: 'del' });
    }
  }

  marks.sort((a, b) => a.docY - b.docY);
  if (marks.length > maxMarks) {
    return { marks: marks.slice(0, maxMarks), truncated: marks.length - maxMarks };
  }
  return { marks, truncated: 0 };
}
