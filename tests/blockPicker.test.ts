import { filterBlocks, BLOCK_DEFS } from '../src/webview/blockPicker';

describe('filterBlocks', () => {
  it('returns all blocks when query is empty', () => {
    expect(filterBlocks('')).toHaveLength(BLOCK_DEFS.length);
  });

  it('filters by label case-insensitively', () => {
    const results = filterBlocks('head');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(b =>
      b.label.toLowerCase().includes('head') ||
      b.description.toLowerCase().includes('head') ||
      b.id.toLowerCase().includes('head')
    )).toBe(true);
  });

  it('returns empty array for no matches', () => {
    expect(filterBlocks('zzznomatch')).toHaveLength(0);
  });

  it('finds heading1 when querying "h1"', () => {
    const ids = filterBlocks('h1').map(b => b.id);
    expect(ids).toContain('heading1');
  });

  it('finds image block when querying "image"', () => {
    const ids = filterBlocks('image').map(b => b.id);
    expect(ids).toContain('image');
  });
});

describe('board block picker entries', () => {
  const kanban = BLOCK_DEFS.find((b) => b.id === 'board-kanban');
  const table  = BLOCK_DEFS.find((b) => b.id === 'board-table');

  it('board-kanban is registered', () => {
    expect(kanban).toBeDefined();
  });

  it('board-table is registered', () => {
    expect(table).toBeDefined();
  });

  it('board-kanban has the expected label and aliases', () => {
    expect(kanban!.label).toBe('Board: Kanban');
    expect(kanban!.aliases).toEqual(
      expect.arrayContaining(['board', 'kanban', 'tasks', 'project']),
    );
  });

  it('board-table has the expected label and aliases', () => {
    expect(table!.label).toBe('Board: Table');
    expect(table!.aliases).toEqual(
      expect.arrayContaining(['board', 'table', 'database', 'grid']),
    );
  });

  it('both entries live in the "lists" section', () => {
    expect(kanban!.section).toBe('lists');
    expect(table!.section).toBe('lists');
  });

  it('both entries declare an insert handler (not a sub-menu)', () => {
    expect(typeof kanban!.insert).toBe('function');
    expect(kanban!.subItems).toBeUndefined();
    expect(typeof table!.insert).toBe('function');
    expect(table!.subItems).toBeUndefined();
  });
});
