import { boardIdOf, replaceBoardId, mintBoardId } from '../../src/webview/boardModel';

// c59: duplicating a board left the copy with the original's `board:start id`,
// so the app treated them as the same board. Re-identifying a PASTED board has
// to swap the id on the start marker WITHOUT a parse → serialize round-trip
// (that would renormalize the whole region), hence these surgical helpers.

const SRC = [
  '<!-- board:start id="b-src1" name="My Board" columns="Todo|Done" column-colors="blue|emerald" field-types="Title=text,Status=status,id=text" hidden-fields="id" -->',
  '',
  '| Title | Status | id |',
  '|---|---|---|',
  '| Alpha | Todo | C1 |',
  '',
  '<!-- board:body id="C1" -->',
  '',
  'Body for Alpha',
  '',
  '<!-- board:end -->',
].join('\n');

describe('boardIdOf', () => {
  it('reads the id off the start marker', () => {
    expect(boardIdOf(SRC)).toBe('b-src1');
  });

  it('tolerates the id not being the first attribute', () => {
    expect(boardIdOf('<!-- board:start name="X" id="b-zz9" -->')).toBe('b-zz9');
  });

  it('handles loose whitespace in the marker', () => {
    expect(boardIdOf('<!--   board:start   id="b-w1" -->')).toBe('b-w1');
  });

  it('returns empty string when there is no id', () => {
    expect(boardIdOf('<!-- board:start name="No Id" -->')).toBe('');
  });

  it('returns empty string for a non-board string', () => {
    expect(boardIdOf('just some markdown')).toBe('');
    expect(boardIdOf('')).toBe('');
  });

  it('reads an empty id as empty', () => {
    expect(boardIdOf('<!-- board:start id="" name="X" -->')).toBe('');
  });
});

describe('replaceBoardId', () => {
  it('swaps the id and leaves every other byte alone', () => {
    const out = replaceBoardId(SRC, 'b-new9');
    expect(boardIdOf(out)).toBe('b-new9');
    // The only difference anywhere is the id itself.
    expect(out).toBe(SRC.replace('id="b-src1"', 'id="b-new9"'));
  });

  it('does not touch card ids or body markers', () => {
    const out = replaceBoardId(SRC, 'b-new9');
    expect(out).toContain('| Alpha | Todo | C1 |');
    expect(out).toContain('<!-- board:body id="C1" -->');
    expect(out).toContain('Body for Alpha');
  });

  it('only rewrites the start marker, not a later board:start-looking line', () => {
    const two = SRC + '\n' + SRC.replace('b-src1', 'b-src2');
    const out = replaceBoardId(two, 'b-new9');
    expect(out).toContain('id="b-new9"');
    expect(out).toContain('id="b-src2"');   // second region untouched
    expect(out).not.toContain('id="b-src1"');
  });

  it('is a no-op on a region with no id attribute', () => {
    const noId = '<!-- board:start name="No Id" -->';
    expect(replaceBoardId(noId, 'b-x')).toBe(noId);
  });

  it('round-trips with boardIdOf for a freshly minted id', () => {
    const fresh = mintBoardId([boardIdOf(SRC)]);
    const out = replaceBoardId(SRC, fresh);
    expect(boardIdOf(out)).toBe(fresh);
    expect(boardIdOf(out)).not.toBe('b-src1');
  });
});

describe('mintBoardId — collision avoidance (c59)', () => {
  it('never returns an id already taken, even under heavy contention', () => {
    // Exhaust a big chunk of the space so the retry loop is genuinely exercised.
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = mintBoardId(taken);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
    expect(taken.size).toBe(200);
  });

  it('always produces a b- prefixed id', () => {
    for (let i = 0; i < 50; i++) {
      expect(mintBoardId([])).toMatch(/^b-[a-z0-9]+$/);
    }
  });
});
