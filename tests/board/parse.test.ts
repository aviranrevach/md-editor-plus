import { parseBoardSource } from '../../src/webview/boardModel';

describe('parseBoardSource — minimal', () => {
  it('returns an empty Board when given just start/end markers', () => {
    const source = `<!-- board:start id="b1" -->\n\n<!-- board:end -->`;
    const board = parseBoardSource(source);
    expect(board).toEqual({
      id: 'b1',
      name: '',
      columns: [],
      fields: [
        { name: 'Title', type: 'text', visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
      ],
      cards: [],
      orphanBodies: [],
      views: [],
      activeView: 'kanban',
    });
  });
});

describe('parseBoardSource — start attributes', () => {
  it('parses name, columns, column-colors, field-types, hidden-fields', () => {
    const source = [
      `<!-- board:start`,
      `     id="b-a3f2"`,
      `     name="Sprint 12"`,
      `     columns="Todo|Doing|Done"`,
      `     column-colors="blue|amber|emerald"`,
      `     field-types="Title=text,Status=status,Owner=person,Due=date,Tags=tags"`,
      `     hidden-fields="id" -->`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');

    const board = parseBoardSource(source);

    expect(board.id).toBe('b-a3f2');
    expect(board.name).toBe('Sprint 12');
    expect(board.columns).toEqual([
      { name: 'Todo',  color: 'blue' },
      { name: 'Doing', color: 'amber' },
      { name: 'Done',  color: 'emerald' },
    ]);
    expect(board.fields).toEqual([
      { name: 'Title',  type: 'text',   visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Owner',  type: 'person', visibleOnCard: true },
      { name: 'Due',    type: 'date',   visibleOnCard: true },
      { name: 'Tags',   type: 'tags',   visibleOnCard: true },
    ]);
  });

  it('auto-colors columns when column-colors is absent', () => {
    const source = `<!-- board:start id="b1" columns="A|B" -->\n\n<!-- board:end -->`;
    const board = parseBoardSource(source);
    expect(board.columns).toHaveLength(2);
    // Auto-color is deterministic, but we only assert it's a valid token here.
    const tokens: string[] = ['gray', 'blue', 'amber', 'emerald', 'red', 'purple', 'orange', 'teal', 'indigo', 'pink'];
    expect(tokens).toContain(board.columns[0].color);
    expect(tokens).toContain(board.columns[1].color);
  });

  it('hidden-fields adds id field (hidden) when present in attrs', () => {
    const source =
      `<!-- board:start id="b1" hidden-fields="id" -->\n\n<!-- board:end -->`;
    const board = parseBoardSource(source);
    const idField = board.fields.find((f) => f.name === 'id');
    expect(idField).toEqual({ name: 'id', type: 'text', visibleOnCard: false });
  });
});

describe('parseBoardSource — table rows', () => {
  const source = [
    `<!-- board:start id="b1" columns="Todo|Doing|Done"`,
    `     field-types="Title=text,Status=status,Owner=person,Due=date,Tags=tags"`,
    `     hidden-fields="id" -->`,
    ``,
    `| id | Title       | Status | Owner   | Due        | Tags         |`,
    `|----|-------------|--------|---------|------------|--------------|`,
    `| c1 | First card  | Doing  | @aviran | 2026-06-01 | feature, ui  |`,
    `| c2 | Second card | Todo   |         |            |              |`,
    ``,
    `<!-- board:end -->`,
  ].join('\n');

  it('parses two cards with field values', () => {
    const board = parseBoardSource(source);
    expect(board.cards).toEqual([
      {
        id: 'C1',
        values: {
          id: 'C1',
          Title: 'First card',
          Status: 'Doing',
          Owner: '@aviran',
          Due: '2026-06-01',
          Tags: 'feature, ui',
        },
        body: '',
      },
      {
        id: 'C2',
        values: {
          id: 'C2',
          Title: 'Second card',
          Status: 'Todo',
          Owner: '',
          Due: '',
          Tags: '',
        },
        body: '',
      },
    ]);
  });

  it('unescapes pipe characters in cell content', () => {
    const src = [
      `<!-- board:start id="b1" -->`,
      ``,
      `| id | Title              |`,
      `|----|--------------------|`,
      `| c1 | a \\| b \\| c        |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const board = parseBoardSource(src);
    expect(board.cards[0].values.Title).toBe('a | b | c');
  });

  it('converts <br> in cells back to newlines', () => {
    const src = [
      `<!-- board:start id="b1" -->`,
      ``,
      `| id | Title           |`,
      `|----|-----------------|`,
      `| c1 | line1<br>line2  |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const board = parseBoardSource(src);
    expect(board.cards[0].values.Title).toBe('line1\nline2');
  });
});

describe('parseBoardSource — bodies', () => {
  it('associates each body block with its card by id', () => {
    const source = [
      `<!-- board:start id="b1" -->`,
      ``,
      `| id | Title       |`,
      `|----|-------------|`,
      `| c1 | First card  |`,
      `| c2 | Second card |`,
      ``,
      `<!-- board:body id="c1" -->`,
      ``,
      `## Goal`,
      `Body for c1`,
      ``,
      `<!-- board:body id="c2" -->`,
      ``,
      `Brief body for c2.`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');

    const board = parseBoardSource(source);
    expect(board.cards[0].body.trim()).toBe('## Goal\nBody for c1');
    expect(board.cards[1].body.trim()).toBe('Brief body for c2.');
  });

  it('leaves body empty for cards without a board:body block', () => {
    const source = [
      `<!-- board:start id="b1" -->`,
      ``,
      `| id | Title |`,
      `|----|-------|`,
      `| c1 | Hi    |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const board = parseBoardSource(source);
    expect(board.cards[0].body).toBe('');
  });
});

describe('parseBoardSource — board:view markers', () => {
  it('parses a board:view section into the views array', () => {
    const md = [
      '<!-- board:start id="b1" name="X"',
      '     columns="Todo|Doing"',
      '     field-types="Title=text,Status=status,Owner=person"',
      '     active-view="table" -->',
      '<!-- board:view name="table"',
      '     columns="Title,Status,Owner"',
      '     hidden="id"',
      '     sort="Owner,desc"',
      '     group="Status"',
      '     widths="Title=240,Status=120" -->',
      '',
      '| id | Title | Status | Owner |',
      '|----|-------|--------|-------|',
      '| c1 | A     | Todo   |       |',
      '',
      '<!-- board:end -->',
    ].join('\n');

    const b = parseBoardSource(md);
    expect(b.activeView).toBe('table');
    expect(b.views).toHaveLength(1);
    const v = b.views[0];
    expect(v.name).toBe('table');
    expect(v.columns).toEqual(['Title', 'Status', 'Owner']);
    expect(v.hidden).toEqual(['id']);
    expect(v.sort).toEqual({ field: 'Owner', dir: 'desc' });
    expect(v.groupBy).toBe('Status');
    expect(v.widths).toEqual({ Title: 240, Status: 120 });
  });

  it('returns empty views array when no board:view sections present', () => {
    const md = [
      '<!-- board:start id="b1" name="X" columns="Todo" field-types="Title=text,Status=status" -->',
      '| id | Title | Status |',
      '|----|-------|--------|',
      '| c1 | A     | Todo   |',
      '<!-- board:end -->',
    ].join('\n');
    const b = parseBoardSource(md);
    expect(b.views).toEqual([]);
    expect(b.activeView).toBe('kanban');
  });

  it('preserves unknown board:view attributes in extras', () => {
    const md = [
      '<!-- board:start id="b1" name="X" columns="Todo" field-types="Title=text,Status=status" -->',
      '<!-- board:view name="table" mystery="future-attr" -->',
      '| id | Title | Status |',
      '|----|-------|--------|',
      '| c1 | A     | Todo   |',
      '<!-- board:end -->',
    ].join('\n');
    const b = parseBoardSource(md);
    expect(b.views[0].extras).toEqual({ mystery: 'future-attr' });
  });
});
