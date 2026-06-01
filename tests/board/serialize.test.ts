import { serializeBoard, parseBoardSource } from '../../src/webview/boardModel';
import type { Board } from '../../src/webview/boardModel';

describe('serializeBoard', () => {
  it('emits start marker, table, bodies, end marker for a typical board', () => {
    const board: Board = {
      id: 'b1',
      name: 'Sprint 12',
      columns: [
        { name: 'Todo',  color: 'blue' },
        { name: 'Doing', color: 'amber' },
      ],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'id',     type: 'text',   visibleOnCard: false },
      ],
      cards: [
        { id: 'c1', values: { id: 'c1', Title: 'First', Status: 'Doing' }, body: '## Goal\nDo it.' },
        { id: 'c2', values: { id: 'c2', Title: 'Second', Status: 'Todo'  }, body: '' },
      ],
      orphanBodies: [],
      views: [],
      activeView: 'kanban',
    };

    const out = serializeBoard(board);

    expect(out).toContain('<!-- board:start');
    expect(out).toContain('id="b1"');
    expect(out).toContain('name="Sprint 12"');
    expect(out).toContain('columns="Todo|Doing"');
    expect(out).toContain('column-colors="blue|amber"');
    expect(out).toContain('field-types="Title=text,Status=status,id=text"');
    expect(out).toContain('hidden-fields="id"');

    // Table contains both rows in order, with the id column.
    expect(out).toMatch(/\|\s*Title\s*\|\s*Status\s*\|\s*id\s*\|/);
    expect(out).toMatch(/\|\s*First\s*\|\s*Doing\s*\|\s*c1\s*\|/);
    expect(out).toMatch(/\|\s*Second\s*\|\s*Todo\s*\|\s*c2\s*\|/);

    // Body only for c1.
    expect(out).toContain('<!-- board:body id="c1" -->');
    expect(out).not.toContain('<!-- board:body id="c2" -->');
    expect(out).toContain('## Goal\nDo it.');

    expect(out).toMatch(/<!-- board:end -->\s*$/);
  });

  it('escapes pipes in cell content and replaces newlines with <br>', () => {
    const board: Board = {
      id: 'b1',
      name: '',
      columns: [],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
      ],
      cards: [
        { id: 'c1', values: { Title: 'a | b\nc', Status: 'Todo' }, body: '' },
      ],
      orphanBodies: [],
      views: [],
      activeView: 'kanban',
    };
    const out = serializeBoard(board);
    expect(out).toContain('a \\| b<br>c');
  });

  it('auto-suffixes duplicate ids on serialize', () => {
    const board: Board = {
      id: 'b1', name: '', columns: [],
      fields: [
        { name: 'Title', type: 'text', visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'id', type: 'text', visibleOnCard: false },
      ],
      cards: [
        { id: 'c1', values: { id: 'c1', Title: 'A', Status: '' }, body: '' },
        { id: 'c1', values: { id: 'c1', Title: 'B', Status: '' }, body: '' },
        { id: 'c1', values: { id: 'c1', Title: 'C', Status: '' }, body: '' },
      ],
      orphanBodies: [],
      views: [],
      activeView: 'kanban',
    };
    const out = serializeBoard(board);
    expect(out).toMatch(/\|\s*A\s*\|\s*\|\s*c1\s*\|/);
    expect(out).toMatch(/\|\s*B\s*\|\s*\|\s*c1-2\s*\|/);
    expect(out).toMatch(/\|\s*C\s*\|\s*\|\s*c1-3\s*\|/);
  });
});

describe('serializeBoard — views', () => {
  it('emits no board:view section when views array is empty (kanban-only)', () => {
    const b: Board = {
      id: 'b1', name: 'X',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
      ],
      cards: [{ id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo' }, body: '' }],
      orphanBodies: [],
      views: [],
      activeView: 'kanban',
    };
    const out = serializeBoard(b);
    expect(out).not.toContain('board:view');
    expect(out).not.toContain('active-view');
  });

  it('emits active-view on board:start when not the default', () => {
    const b: Board = {
      id: 'b1', name: 'X',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
      ],
      cards: [],
      orphanBodies: [],
      views: [],
      activeView: 'table',
    };
    const out = serializeBoard(b);
    expect(out).toContain('active-view="table"');
  });

  it('emits a board:view section with all populated fields', () => {
    const b: Board = {
      id: 'b1', name: 'X',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
      ],
      cards: [],
      orphanBodies: [],
      views: [{
        name: 'table',
        columns: ['Title', 'Status'],
        hidden: ['id'],
        sort: { field: 'Title', dir: 'asc' },
        groupBy: 'Status',
        widths: { Title: 200, Status: 100 },
      }],
      activeView: 'table',
    };
    const out = serializeBoard(b);
    expect(out).toContain('<!-- board:view name="table"');
    expect(out).toContain('columns="Title,Status"');
    expect(out).toContain('hidden="id"');
    expect(out).toContain('sort="Title,asc"');
    expect(out).toContain('group="Status"');
    expect(out).toContain('widths="Status=100,Title=200"');
  });

  it('preserves extras on round-trip', () => {
    const md = [
      '<!-- board:start id="b1" name="X" columns="Todo" field-types="Title=text,Status=status" -->',
      '<!-- board:view name="table" mystery="future" -->',
      '| id | Title | Status |',
      '|----|-------|--------|',
      '| c1 | A     | Todo   |',
      '<!-- board:end -->',
    ].join('\n');
    const b1 = parseBoardSource(md);
    const out = serializeBoard(b1);
    expect(out).toContain('mystery="future"');
    const b2 = parseBoardSource(out);
    expect(b2.views[0].extras).toEqual({ mystery: 'future' });
  });
});
