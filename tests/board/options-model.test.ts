import { parseBoardSource, serializeBoard, getStatusOptions, setStatusOptions, renameStatusOption, deleteStatusOption, addStatusOption } from '../../src/webview/boardModel';
import type { Board } from '../../src/webview/boardModel';

describe('10-color palette', () => {
  it('parses and preserves a new color token (teal) on a column', () => {
    const src = `<!-- board:start id="b1" columns="A|B" column-colors="teal|indigo" field-types="Title=text,Status=status" -->\n\n<!-- board:end -->`;
    const board = parseBoardSource(src);
    expect(board.columns).toEqual([
      { name: 'A', color: 'teal' },
      { name: 'B', color: 'indigo' },
    ]);
    expect(serializeBoard(board)).toContain('column-colors="teal|indigo"');
  });
});

function makeBoard(): Board {
  return {
    id: 'b1', name: '',
    columns: [{ name: 'Todo', color: 'blue' }, { name: 'Done', color: 'emerald' }],
    fields: [
      { name: 'Title',  type: 'text',   visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Impact', type: 'status', visibleOnCard: true, options: [{ name: 'Low', color: 'gray' }] },
    ],
    cards: [{ id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo', Impact: 'Low' }, body: '' }],
    orphanBodies: [], views: [], activeView: 'kanban',
  };
}

describe('status-option accessors', () => {
  it('getStatusOptions returns board.columns for the built-in Status field', () => {
    expect(getStatusOptions(makeBoard(), 'Status')).toEqual([
      { name: 'Todo', color: 'blue' }, { name: 'Done', color: 'emerald' },
    ]);
  });
  it('getStatusOptions returns field.options for additional status fields', () => {
    expect(getStatusOptions(makeBoard(), 'Impact')).toEqual([{ name: 'Low', color: 'gray' }]);
  });
  it('getStatusOptions returns [] for a status field with no options', () => {
    const b = makeBoard();
    b.fields.push({ name: 'Risk', type: 'status', visibleOnCard: true });
    expect(getStatusOptions(b, 'Risk')).toEqual([]);
  });
  it('setStatusOptions writes board.columns for Status, immutably', () => {
    const b = makeBoard();
    const next = setStatusOptions(b, 'Status', [{ name: 'X', color: 'red' }]);
    expect(next.columns).toEqual([{ name: 'X', color: 'red' }]);
    expect(b.columns).toHaveLength(2);
  });
  it('setStatusOptions writes field.options for additional status fields, immutably', () => {
    const b = makeBoard();
    const next = setStatusOptions(b, 'Impact', [{ name: 'High', color: 'red' }]);
    expect(next.fields.find(f => f.name === 'Impact')!.options).toEqual([{ name: 'High', color: 'red' }]);
    expect(b.fields.find(f => f.name === 'Impact')!.options).toEqual([{ name: 'Low', color: 'gray' }]);
  });
});

describe('status-option mutations migrate card values', () => {
  it('renameStatusOption renames the option and updates cards holding it (Status)', () => {
    const next = renameStatusOption(makeBoard(), 'Status', 'Todo', 'Backlog');
    expect(next.columns[0]).toEqual({ name: 'Backlog', color: 'blue' });
    expect(next.cards[0].values.Status).toBe('Backlog');
  });
  it('renameStatusOption works on an additional field and leaves other fields alone', () => {
    const next = renameStatusOption(makeBoard(), 'Impact', 'Low', 'Minor');
    expect(next.fields.find(f => f.name === 'Impact')!.options).toEqual([{ name: 'Minor', color: 'gray' }]);
    expect(next.cards[0].values.Impact).toBe('Minor');
    expect(next.cards[0].values.Status).toBe('Todo');
  });
  it('deleteStatusOption removes the option and clears matching card values', () => {
    const next = deleteStatusOption(makeBoard(), 'Impact', 'Low');
    expect(next.fields.find(f => f.name === 'Impact')!.options).toEqual([]);
    expect(next.cards[0].values.Impact).toBe('');
  });
  it('addStatusOption appends an option with a distinct color', () => {
    const next = addStatusOption(makeBoard(), 'Impact', 'High');
    const opts = next.fields.find(f => f.name === 'Impact')!.options!;
    expect(opts.map(o => o.name)).toEqual(['Low', 'High']);
    expect(opts[1].color).not.toBe(opts[0].color);
  });
});

describe('field-options round-trip', () => {
  const src = [
    `<!-- board:start id="b1" columns="Todo|Done" column-colors="blue|emerald" field-types="Title=text,Status=status,Impact=status,Risk Level=status" field-options="Impact=Low:gray|High:red;Risk Level=R1:orange|R2:teal" -->`,
    ``,
    `| Title | Status | Impact | Risk Level |`,
    `|---|---|---|---|`,
    `| A | Todo | Low | R1 |`,
    ``,
    `<!-- board:end -->`,
  ].join('\n');

  it('parses per-field options, including a field name with a space and new color tokens', () => {
    const b = parseBoardSource(src);
    expect(b.fields.find(f => f.name === 'Impact')!.options).toEqual([
      { name: 'Low', color: 'gray' }, { name: 'High', color: 'red' },
    ]);
    expect(b.fields.find(f => f.name === 'Risk Level')!.options).toEqual([
      { name: 'R1', color: 'orange' }, { name: 'R2', color: 'teal' },
    ]);
    expect(b.fields.find(f => f.name === 'Status')!.options).toBeUndefined();
  });

  it('serialize -> parse is stable (deep-equal)', () => {
    const a = parseBoardSource(src);
    const round = parseBoardSource(serializeBoard(a));
    expect(round).toEqual(a);
  });

  it('a board with no additional status fields emits no field-options attribute', () => {
    const plain = `<!-- board:start id="b1" columns="Todo" column-colors="blue" field-types="Title=text,Status=status" -->\n\n| Title | Status |\n|---|---|\n\n<!-- board:end -->`;
    const out = serializeBoard(parseBoardSource(plain));
    expect(out).not.toContain('field-options');
  });
});
