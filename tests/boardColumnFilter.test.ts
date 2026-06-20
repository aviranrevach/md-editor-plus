/** @jest-environment jsdom */
import { buildFieldFilterRow, filterableFields } from '../src/webview/boardFilterPanel';
import type { BoardRendererCtx } from '../src/webview/boardBlock';
import type { Board } from '../src/webview/boardModel';
import type { FilterState } from '../src/webview/boardFilter';

function makeBoard(): Board {
  return {
    id: 'b1', name: 'B',
    columns: [
      { name: 'Todo', color: 'blue' },
      { name: 'Done', color: 'emerald' },
    ],
    fields: [{ name: 'Status', type: 'status', visibleOnCard: true }],
    cards: [
      { id: 'c1', values: { Status: 'Todo' }, body: '' },
      { id: 'c2', values: { Status: 'Done' }, body: '' },
    ],
    orphanBodies: [], views: [], activeView: 'table',
  };
}

function makeCtx(board: Board): BoardRendererCtx {
  let filter = {};
  return {
    root: document.createElement('div'),
    getBoard: () => board,
    mutate: () => {},
    openSidePanel: () => {},
    requestDelete: () => {},
    readonly: false,
    getFilter: () => filter,
    setFilter: (next: FilterState) => { filter = next; },
  } as unknown as BoardRendererCtx;
}

describe('buildFieldFilterRow', () => {
  it('renders one chip per status option plus an (Empty) chip', () => {
    const board = makeBoard();
    const f = filterableFields(board)[0];
    const row = buildFieldFilterRow(makeCtx(board), f, () => {});
    const chips = row.querySelectorAll('.bd-filter-chip');
    // Todo + Done + (Empty)
    expect(chips.length).toBe(3);
    expect(row.querySelector('.bd-filter-field-label')!.textContent).toBe('Status');
  });

  it('clicking a selected chip turns its value off in the shared filter', () => {
    const board = makeBoard();
    const ctx = makeCtx(board);
    const f = filterableFields(board)[0];
    let changed = 0;
    const row = buildFieldFilterRow(ctx, f, () => { changed++; });
    // first chip = "Todo", on by default → click turns it off
    (row.querySelector('.bd-filter-chip') as HTMLButtonElement).click();
    expect(changed).toBe(1);
    expect(ctx.getFilter().Status).not.toContain('Todo');
    expect(ctx.getFilter().Status).toContain('Done');
  });
});
