import { filterBlocks, BLOCK_DEFS, footerCloseVerb, shortcutForBlock } from '../src/webview/blockPicker';

describe('filterBlocks', () => {
  it('returns the regular block catalog when query is empty', () => {
    expect(filterBlocks('')).toEqual(BLOCK_DEFS.filter((block) => !block.searchOnly));
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

  it.each(['math', 'latex', 'equation', '公式'])(
    'finds both equation commands and the contextual conversion through "%s"',
    (query) => {
      expect(filterBlocks(query).map(b => b.id)).toEqual([
        'blockMath',
        'inlineMath',
        'blockMathConvert',
      ]);
    },
  );

  it('hides the contextual conversion until the user searches', () => {
    expect(filterBlocks('').map(b => b.id)).not.toContain('blockMathConvert');
  });
});

describe('footerCloseVerb', () => {
  it('says "Close" at the root list', () => {
    expect(footerCloseVerb(false)).toBe('Close');
  });

  it('says "Back" inside a drill-down', () => {
    expect(footerCloseVerb(true)).toBe('Back');
  });
});

describe('shortcutForBlock', () => {
  it('maps headings to hash shortcuts', () => {
    expect(shortcutForBlock('heading1')).toBe('#');
    expect(shortcutForBlock('heading2')).toBe('##');
    expect(shortcutForBlock('heading3')).toBe('###');
  });

  it('maps lists, quote, and code', () => {
    expect(shortcutForBlock('bulletList')).toBe('-');
    expect(shortcutForBlock('orderedList')).toBe('1.');
    expect(shortcutForBlock('taskList')).toBe('[]');
    expect(shortcutForBlock('blockquote')).toBe('"');
    expect(shortcutForBlock('codeBlock')).toBe('```');
    expect(shortcutForBlock('blockMath')).toBe('$$');
  });

  it('returns undefined for blocks without a shortcut', () => {
    expect(shortcutForBlock('paragraph')).toBeUndefined();
    expect(shortcutForBlock('image')).toBeUndefined();
    expect(shortcutForBlock('zzznope')).toBeUndefined();
  });
});

describe('math block picker entries', () => {
  const block = BLOCK_DEFS.find((b) => b.id === 'blockMath');
  const inline = BLOCK_DEFS.find((b) => b.id === 'inlineMath');
  const convert = BLOCK_DEFS.find((b) => b.id === 'blockMathConvert');

  it('registers a directly insertable and convertible block equation', () => {
    expect(block).toBeDefined();
    expect(block?.label).toBe('Block equation');
    expect(block?.section).toBe('media');
    expect(typeof block?.insert).toBe('function');
    expect(typeof block?.convert).toBe('function');
    expect(block?.previewDisplayMode).toBe(true);
  });

  it('registers an inline equation command at the cursor', () => {
    expect(inline).toBeDefined();
    expect(inline?.label).toBe('Inline equation');
    expect(typeof inline?.insert).toBe('function');
    expect(inline?.convert).toBeUndefined();
    expect(inline?.previewDisplayMode).toBe(false);
  });

  it('registers a search-only block conversion command', () => {
    expect(convert).toBeDefined();
    expect(convert?.label).toBe('Block equation');
    expect(convert?.qualifier).toBe('Turn into');
    expect(convert?.searchOnly).toBe(true);
    expect(typeof convert?.insert).toBe('function');
    expect(convert?.convert).toBeUndefined();
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
      expect.arrayContaining(['board', 'database']),
    );
    // 'table' and 'grid' are intentionally removed to avoid ambiguity with
    // the plain-table block type (alias disambiguation, c31/Task 3).
    expect(table!.aliases).not.toContain('table');
    expect(table!.aliases).not.toContain('grid');
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
