import { serializeBoard } from '../../src/webview/boardModel';
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
    };
    const out = serializeBoard(board);
    expect(out).toMatch(/\|\s*A\s*\|\s*\|\s*c1\s*\|/);
    expect(out).toMatch(/\|\s*B\s*\|\s*\|\s*c1-2\s*\|/);
    expect(out).toMatch(/\|\s*C\s*\|\s*\|\s*c1-3\s*\|/);
  });
});
