/**
 * @jest-environment jsdom
 */
import { autoColorPublic, COLOR_TOKENS_PUBLIC } from '../../src/webview/boardModel';
import { mountTable } from '../../src/webview/boardTableRender';
import type { Board } from '../../src/webview/boardModel';
import type { BoardRendererCtx } from '../../src/webview/boardBlock';

describe('autoColorPublic', () => {
  it('returns a valid palette token, deterministically', () => {
    const a = autoColorPublic('backend');
    const b = autoColorPublic('backend');
    expect(a).toBe(b);
    expect(COLOR_TOKENS_PUBLIC).toContain(a);
  });
  it('different names can map to different tokens', () => {
    const names = ['a','b','c','d','e','f','g','h','i','j','k'];
    const uniq = new Set(names.map(autoColorPublic));
    expect(uniq.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Helpers for mountTable-based grouping tests
// ---------------------------------------------------------------------------

function makeCtx(board: Board): { ctx: BoardRendererCtx; boardRef: { current: Board } } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const boardRef = { current: board };
  const ctx: BoardRendererCtx = {
    root,
    getBoard: () => boardRef.current,
    mutate: (next: Board) => { boardRef.current = next; },
    openSidePanel: (_id: string) => { /* no-op */ },
    requestDelete: () => { /* no-op */ },
    readonly: false,
  };
  return { ctx, boardRef };
}

const groupLabels = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('.bd-table-group .board-column-name'))
    .map((n) => n.textContent);

afterEach(() => {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// applyGroup via mountTable
// ---------------------------------------------------------------------------

describe('applyGroup via mountTable', () => {
  it('groups by a custom status field in its options order, with empty + unknown handling', () => {
    const board: Board = {
      id: 'b1', name: '',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Impact', type: 'status', visibleOnCard: true,
          options: [{ name: 'Low', color: 'teal' }, { name: 'High', color: 'red' }] },
      ],
      cards: [
        { id: 'c1', values: { id:'c1', Title:'A', Status:'Todo', Impact:'High'  }, body:'' },
        { id: 'c2', values: { id:'c2', Title:'B', Status:'Todo', Impact:'Low'   }, body:'' },
        { id: 'c3', values: { id:'c3', Title:'C', Status:'Todo', Impact:'Weird' }, body:'' },
        { id: 'c4', values: { id:'c4', Title:'D', Status:'Todo', Impact:''      }, body:'' },
      ],
      orphanBodies: [], views: [{ name: 'table', groupBy: 'Impact' }], activeView: 'table',
    };
    const { ctx } = makeCtx(board);
    mountTable(ctx);
    expect(groupLabels(ctx.root)).toEqual(['Low', 'High', 'Uncategorized']);
  });

  it('groups by tags with a multi-tag card appearing in every matching group', () => {
    const board: Board = {
      id: 'b1', name: '',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Tags',   type: 'tags',   visibleOnCard: true },
      ],
      cards: [
        { id: 'c1', values: { id:'c1', Title:'Onboard', Status:'Todo', Tags:'backend, urgent' }, body:'' },
        { id: 'c2', values: { id:'c2', Title:'Patch',   Status:'Todo', Tags:'backend'          }, body:'' },
        { id: 'c3', values: { id:'c3', Title:'Alert',   Status:'Todo', Tags:'urgent'           }, body:'' },
      ],
      orphanBodies: [], views: [{ name: 'table', groupBy: 'Tags' }], activeView: 'table',
    };
    const { ctx } = makeCtx(board);
    mountTable(ctx);
    expect(groupLabels(ctx.root)).toEqual(['backend', 'urgent']);
    const titles = Array.from(ctx.root.querySelectorAll('.bd-table-row'))
      .map((r) => (r.querySelector('td[data-field="Title"]') as HTMLElement)?.textContent ?? '');
    expect(titles.filter((t) => t === 'Onboard').length).toBe(2);
  });
});

describe('group band color', () => {
  it('tints the band by the status option color and colors the chip', () => {
    const board: Board = {
      id: 'b1', name: '',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Impact', type: 'status', visibleOnCard: true,
          options: [{ name: 'Low', color: 'teal' }, { name: 'High', color: 'red' }] },
      ],
      cards: [{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Impact:'High' }, body:'' }],
      orphanBodies: [], views: [{ name: 'table', groupBy: 'Impact' }], activeView: 'table',
    };
    const { ctx } = makeCtx(board);
    mountTable(ctx);
    const highRow = Array.from(ctx.root.querySelectorAll('.bd-group-row'))
      .find((r) => /High/.test(r.textContent || ''))!;
    expect(highRow.classList.contains('bd-group-band')).toBe(true);
    expect(highRow.classList.contains('color-red')).toBe(true);
    const chip = highRow.querySelector('.bd-group-chip')!;
    expect(chip.classList.contains('color-red')).toBe(true);
  });

  it('uses a neutral band (no color class) for the Uncategorized group', () => {
    const board: Board = {
      id: 'b1', name: '',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title', type: 'text', visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Impact', type: 'status', visibleOnCard: true, options: [{ name: 'Low', color: 'teal' }] },
      ],
      cards: [{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Impact:'??' }, body:'' }],
      orphanBodies: [], views: [{ name: 'table', groupBy: 'Impact' }], activeView: 'table',
    };
    const { ctx } = makeCtx(board);
    mountTable(ctx);
    const uncat = Array.from(ctx.root.querySelectorAll('.bd-group-row'))
      .find((r) => /Uncategorized/.test(r.textContent || ''))!;
    expect(uncat.classList.contains('bd-group-band')).toBe(false);
  });
});

describe('Remove grouping menu item', () => {
  const colMenuLabels = (root: HTMLElement, fieldName: string) => {
    // Close any existing menu first
    document.querySelector('.bd-col-menu')?.remove();
    const th = Array.from(root.querySelectorAll('th'))
      .find((h) => (h.textContent || '').includes(fieldName))!;
    (th.querySelector('.bd-col-menu-btn') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return Array.from(document.querySelectorAll('.bd-col-menu-label')).map((n) => n.textContent);
  };
  const baseBoard = (groupBy?: string): Board => ({
    id: 'b1', name: '',
    columns: [{ name: 'Todo', color: 'blue' }],
    fields: [
      { name: 'Title', type: 'text', visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Impact', type: 'status', visibleOnCard: true, options: [{ name: 'Low', color: 'teal' }] },
    ],
    cards: [{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Impact:'Low' }, body:'' }],
    orphanBodies: [], views: [{ name: 'table', ...(groupBy ? { groupBy } : {}) }], activeView: 'table',
  });

  it('shows "Remove grouping" on the actively-grouped column', () => {
    const { ctx } = makeCtx(baseBoard('Impact'));
    mountTable(ctx);
    expect(colMenuLabels(ctx.root, 'Impact')).toContain('Remove grouping');
  });

  it('shows "Group by this" on a column that is not the active group', () => {
    const { ctx } = makeCtx(baseBoard('Impact'));
    mountTable(ctx);
    expect(colMenuLabels(ctx.root, 'Status')).toContain('Group by this');
  });

  it('clicking "Remove grouping" clears view.groupBy', () => {
    const { ctx, boardRef } = makeCtx(baseBoard('Impact'));
    mountTable(ctx);
    colMenuLabels(ctx.root, 'Impact'); // open menu
    const item = Array.from(document.querySelectorAll('.bd-col-menu-item'))
      .find((n) => /Remove grouping/.test(n.textContent || '')) as HTMLElement;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(boardRef.current.views.find(v => v.name === 'table')?.groupBy).toBeUndefined();
  });
});

describe('status sort uses the field options order (any status field)', () => {
  it('sorts a custom status field by its options order, not alphabetical', () => {
    const board: Board = {
      id: 'b1', name: '',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Impact', type: 'status', visibleOnCard: true,
          options: [{ name: 'Low', color: 'teal' }, { name: 'High', color: 'red' }] },
      ],
      cards: [
        { id: 'c1', values: { id:'c1', Title:'A', Status:'Todo', Impact:'High' }, body:'' },
        { id: 'c2', values: { id:'c2', Title:'B', Status:'Todo', Impact:'Low'  }, body:'' },
      ],
      orphanBodies: [], views: [{ name: 'table', sort: { field: 'Impact', dir: 'asc' } }], activeView: 'table',
    };
    const { ctx } = makeCtx(board);
    mountTable(ctx);
    const titles = Array.from(ctx.root.querySelectorAll('.bd-table-row'))
      .map((r) => r.querySelector('td[data-field="Title"]')?.textContent ?? '');
    expect(titles).toEqual(['B', 'A']); // Low(0) before High(1)
  });
});
