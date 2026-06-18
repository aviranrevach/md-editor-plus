import { BLOCK_DEFS, filterBlocks } from '../src/webview/blockPicker';
import { convertibleTargets } from '../src/webview/blockActions';

describe('plain table block', () => {
  it('exists as its own block distinct from Board: Table', () => {
    const ids = BLOCK_DEFS.map(b => b.id);
    expect(ids).toContain('table');
    expect(ids).toContain('board-table');
  });

  it('surfaces both plain and board table when searching "table"', () => {
    const hits = filterBlocks('table').map(b => b.id);
    expect(hits).toContain('table');
    expect(hits).toContain('board-table');
  });

  it('is a convertible Turn-into target', () => {
    expect(convertibleTargets(BLOCK_DEFS).some(t => t.id === 'table')).toBe(true);
  });
});
