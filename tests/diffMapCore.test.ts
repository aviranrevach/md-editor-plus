import { computeDiffMarks, type BlockSide } from '../src/webview/diffMapCore';

const blk = (md: string, docY: number, pos: number): BlockSide => ({ md, docY, pos });

describe('computeDiffMarks', () => {
  it('marks an added block green at its docY', () => {
    const r = computeDiffMarks({
      baseBlocks: ['# A', 'para B'],
      currentBlocks: [blk('# A', 0, 1), blk('NEW', 50, 9), blk('para B', 100, 20)],
    });
    expect(r.marks).toEqual([{ docY: 50, kind: 'add', pos: 9 }]);
  });

  it('marks a modified block as change at the new block docY', () => {
    const r = computeDiffMarks({
      baseBlocks: ['# A', 'para B'],
      currentBlocks: [blk('# A', 0, 1), blk('para B EDITED', 80, 9)],
    });
    expect(r.marks).toEqual([{ docY: 80, kind: 'change', pos: 9 }]);
  });

  it('marks a deletion as a del seam at the following block', () => {
    const r = computeDiffMarks({
      baseBlocks: ['# A', 'para B', 'para C'],
      currentBlocks: [blk('# A', 0, 1), blk('para C', 120, 20)],
    });
    expect(r.marks).toEqual([{ docY: 120, kind: 'del' }]);
  });

  it('places a trailing deletion seam at the last block docY', () => {
    const r = computeDiffMarks({
      baseBlocks: ['# A', 'para B'],
      currentBlocks: [blk('# A', 40, 1)],
    });
    expect(r.marks).toEqual([{ docY: 40, kind: 'del' }]);
  });

  it('returns no marks for identical content', () => {
    const r = computeDiffMarks({
      baseBlocks: ['# A', 'para B'],
      currentBlocks: [blk('# A', 0, 1), blk('para B', 50, 9)],
    });
    expect(r.marks).toEqual([]);
    expect(r.truncated).toBe(0);
  });

  it('sorts marks by docY', () => {
    const r = computeDiffMarks({
      baseBlocks: ['keep'],
      currentBlocks: [blk('z-new', 200, 1), blk('keep', 100, 5), blk('a-new', 10, 9)],
    });
    expect(r.marks.map(m => m.docY)).toEqual([10, 200]);
  });

  it('caps at maxMarks and reports truncated', () => {
    const currentBlocks = Array.from({ length: 5 }, (_, i) => blk(`new${i}`, i * 10, i + 1));
    const r = computeDiffMarks({ baseBlocks: [], currentBlocks, maxMarks: 3 });
    expect(r.marks).toHaveLength(3);
    expect(r.truncated).toBe(2);
  });
});
