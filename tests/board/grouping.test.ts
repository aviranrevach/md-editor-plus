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
