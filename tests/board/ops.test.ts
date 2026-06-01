import type { Board, ViewDef } from '../../src/webview/boardModel';
import * as ops from '../../src/webview/boardOps';

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: 'b1', name: 'X',
    columns: [
      { name: 'Todo',  color: 'blue' },
      { name: 'Doing', color: 'amber' },
    ],
    fields: [
      { name: 'Title',  type: 'text',   visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Owner',  type: 'person', visibleOnCard: true },
    ],
    cards: [
      { id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo',  Owner: 'X' }, body: '' },
      { id: 'c2', values: { id: 'c2', Title: 'B', Status: 'Doing', Owner: 'Y' }, body: '' },
    ],
    orphanBodies: [],
    views: [],
    activeView: 'kanban',
    ...overrides,
  };
}

describe('boardOps.setViewSort', () => {
  it('creates a view if missing and sets sort', () => {
    const b = makeBoard();
    ops.setViewSort(b, 'table', { field: 'Title', dir: 'asc' });
    expect(b.views).toHaveLength(1);
    expect(b.views[0]).toEqual({ name: 'table', sort: { field: 'Title', dir: 'asc' } });
  });
  it('clears sort when passed null', () => {
    const b = makeBoard({ views: [{ name: 'table', sort: { field: 'X', dir: 'asc' }, groupBy: 'Status' }] });
    ops.setViewSort(b, 'table', null);
    expect(b.views[0].sort).toBeUndefined();
    expect(b.views[0].groupBy).toBe('Status');   // view survived because groupBy is still set
  });
});

describe('boardOps.setViewGroup', () => {
  it('creates view + sets groupBy', () => {
    const b = makeBoard();
    ops.setViewGroup(b, 'table', 'Status');
    expect(b.views[0].groupBy).toBe('Status');
  });
  it('clears groupBy when passed null', () => {
    const b = makeBoard({ views: [{ name: 'table', groupBy: 'Status', sort: { field: 'X', dir: 'asc' } }] });
    ops.setViewGroup(b, 'table', null);
    expect(b.views[0].groupBy).toBeUndefined();
    expect(b.views[0].sort).toEqual({ field: 'X', dir: 'asc' });
  });
});

describe('boardOps.setViewWidth', () => {
  it('sets a width on the view', () => {
    const b = makeBoard();
    ops.setViewWidth(b, 'table', 'Title', 240);
    expect(b.views[0].widths).toEqual({ Title: 240 });
  });
  it('removes a width entry when passed null', () => {
    const b = makeBoard({ views: [{ name: 'table', widths: { Title: 240, Status: 100 } }] });
    ops.setViewWidth(b, 'table', 'Title', null);
    expect(b.views[0].widths).toEqual({ Status: 100 });
  });
});

describe('boardOps.hideFieldInView', () => {
  it('adds field to view.hidden', () => {
    const b = makeBoard();
    ops.hideFieldInView(b, 'table', 'Owner');
    expect(b.views[0].hidden).toEqual(['Owner']);
  });
});

describe('boardOps.deleteField', () => {
  it('removes field from fields and from every card values map', () => {
    const b = makeBoard();
    ops.deleteField(b, 'Owner');
    expect(b.fields.find(f => f.name === 'Owner')).toBeUndefined();
    expect(b.cards[0].values.Owner).toBeUndefined();
  });
  it('clears sort + group in every view that referenced it', () => {
    const b = makeBoard({
      views: [
        { name: 'table', sort: { field: 'Owner', dir: 'asc' }, groupBy: 'Owner', widths: { Owner: 100 } },
        { name: 'kanban' },
      ],
    });
    ops.deleteField(b, 'Owner');
    const tableView = b.views.find(v => v.name === 'table');
    expect(tableView?.sort).toBeUndefined();
    expect(tableView?.groupBy).toBeUndefined();
    expect(tableView?.widths?.Owner).toBeUndefined();
  });
});

describe('boardOps.deleteField — empty-container cleanup', () => {
  it('removes view that ends up with only an empty columns array', () => {
    const b = makeBoard({
      views: [{ name: 'table', columns: ['Owner'] }],
    });
    ops.deleteField(b, 'Owner');
    expect(b.views).toHaveLength(0);
  });
  it('removes view that ends up with only an empty widths object', () => {
    const b = makeBoard({
      views: [{ name: 'table', widths: { Owner: 200 } }],
    });
    ops.deleteField(b, 'Owner');
    expect(b.views).toHaveLength(0);
  });
});

describe('boardOps.moveCard', () => {
  it('reorders cards array to put fromId at the position before beforeId', () => {
    const b = makeBoard();   // cards: c1, c2
    // Add a 3rd:
    b.cards.push({ id: 'c3', values: { id: 'c3', Title: 'C', Status: 'Todo', Owner: '' }, body: '' });
    ops.moveCard(b, 'c3', 'c2');  // put c3 before c2
    expect(b.cards.map(c => c.id)).toEqual(['c1', 'c3', 'c2']);
  });
  it('null beforeId moves to end', () => {
    const b = makeBoard();
    ops.moveCard(b, 'c1', null);
    expect(b.cards.map(c => c.id)).toEqual(['c2', 'c1']);
  });
});

describe('boardOps.setViewColumns', () => {
  it('persists column order on the view', () => {
    const b = makeBoard();
    ops.setViewColumns(b, 'table', ['Owner', 'Title', 'Status']);
    expect(b.views[0].columns).toEqual(['Owner', 'Title', 'Status']);
  });
});

describe('boardOps.addCard', () => {
  it('appends a card with empty values + auto Status', () => {
    const b = makeBoard();
    const id = ops.addCard(b);
    expect(b.cards.length).toBe(3);
    expect(b.cards[2].id).toBe(id);
    expect(b.cards[2].values.Status).toBe('Todo');
  });
  it('honors presets', () => {
    const b = makeBoard();
    ops.addCard(b, { Status: 'Doing', Title: 'X' });
    expect(b.cards[2].values.Status).toBe('Doing');
    expect(b.cards[2].values.Title).toBe('X');
  });
  it('explicit empty Status preset stays empty (not auto-defaulted)', () => {
    const b = makeBoard();
    ops.addCard(b, { Status: '' });
    expect(b.cards[2].values.Status).toBe('');
  });
});

describe('boardOps.hideFieldInView — auto-clear sort/group', () => {
  it('clears sort if it referenced the hidden field', () => {
    const b = makeBoard({
      views: [{ name: 'table', sort: { field: 'Owner', dir: 'asc' } }],
    });
    ops.hideFieldInView(b, 'table', 'Owner');
    expect(b.views[0].sort).toBeUndefined();
  });
  it('clears groupBy if it referenced the hidden field', () => {
    const b = makeBoard({
      views: [{ name: 'table', groupBy: 'Owner' }],
    });
    ops.hideFieldInView(b, 'table', 'Owner');
    expect(b.views[0].groupBy).toBeUndefined();
  });
});
