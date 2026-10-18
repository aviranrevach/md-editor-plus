import {
  reorderRows,
  clampInsertIndex,
  rowMenuModel,
  canDragRow,
} from '../src/webview/tableRowOps';

describe('tableRowOps.clampInsertIndex (c46)', () => {
  it('never lands above the header row', () => {
    expect(clampInsertIndex(0, 1, 4)).toBe(1);
  });
  it('never exceeds the row count', () => {
    expect(clampInsertIndex(9, 1, 4)).toBe(4);
  });
  it('passes a valid index through', () => {
    expect(clampInsertIndex(2, 1, 4)).toBe(2);
  });
});

describe('tableRowOps.reorderRows (c46)', () => {
  it('moves a body row down to the requested slot', () => {
    expect(reorderRows(['h', 'a', 'b', 'c'], 1, 3)).toEqual(['h', 'b', 'a', 'c']);
  });

  it('moves a body row up, clamped just below the header', () => {
    expect(reorderRows(['h', 'a', 'b', 'c'], 2, 0)).toEqual(['h', 'b', 'a', 'c']);
  });

  it('is a no-op when inserting at the same slot (insertIdx === fromIdx)', () => {
    expect(reorderRows(['h', 'a', 'b', 'c'], 1, 1)).toEqual(['h', 'a', 'b', 'c']);
  });

  it('is a no-op when inserting just after itself (insertIdx === fromIdx + 1)', () => {
    expect(reorderRows(['h', 'a', 'b', 'c'], 1, 2)).toEqual(['h', 'a', 'b', 'c']);
  });

  it('refuses to move the header row', () => {
    expect(reorderRows(['h', 'a', 'b', 'c'], 0, 3)).toEqual(['h', 'a', 'b', 'c']);
  });

  it('returns a fresh array (no mutation of the input)', () => {
    const input = ['h', 'a', 'b'];
    const out = reorderRows(input, 1, 3);
    expect(out).not.toBe(input);
    expect(input).toEqual(['h', 'a', 'b']);
  });
});

describe('tableRowOps.rowMenuModel (c46)', () => {
  it('gives a body row the full action set', () => {
    expect(rowMenuModel({ isHeader: false })).toEqual([
      'insert-above', 'insert-below', 'duplicate', 'delete',
    ]);
  });
  it('restricts the header row to inserting below (keeps markdown valid)', () => {
    expect(rowMenuModel({ isHeader: true })).toEqual(['insert-below']);
  });
});

describe('tableRowOps.canDragRow (c46)', () => {
  it('allows dragging a body row', () => {
    expect(canDragRow(false)).toBe(true);
  });
  it('pins the header row in place', () => {
    expect(canDragRow(true)).toBe(false);
  });
});
