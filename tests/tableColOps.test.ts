import { colMenuModel, reorderColumns, COL_MENU_LABEL } from '../src/webview/tableColOps';

describe('tableColOps.colMenuModel (c46)', () => {
  it('offers insert left/right, duplicate, delete for a normal column', () => {
    expect(colMenuModel({ isOnly: false })).toEqual([
      'insert-left', 'insert-right', 'duplicate', 'delete',
    ]);
  });
  it('drops Delete for the only remaining column', () => {
    expect(colMenuModel({ isOnly: true })).toEqual([
      'insert-left', 'insert-right', 'duplicate',
    ]);
  });
});

describe('tableColOps.reorderColumns (c46)', () => {
  it('moves a column to the requested slot (no fixed column)', () => {
    expect(reorderColumns(['a', 'b', 'c'], 0, 3)).toEqual(['b', 'c', 'a']);
  });
  it('can move a column to the very front (index 0)', () => {
    expect(reorderColumns(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
  it('is a no-op when dropping onto itself', () => {
    expect(reorderColumns(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });
  it('does not mutate the input', () => {
    const input = ['a', 'b', 'c'];
    reorderColumns(input, 0, 2);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});

describe('tableColOps.COL_MENU_LABEL (c46)', () => {
  it('labels every action kind', () => {
    expect(COL_MENU_LABEL).toEqual({
      'insert-left': 'Insert column left',
      'insert-right': 'Insert column right',
      'duplicate': 'Duplicate column',
      'delete': 'Delete column',
    });
  });
});
