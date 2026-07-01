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
    isReadonly: () => false,
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

import { openColumnFilter } from '../src/webview/boardFilterPanel';

describe('openColumnFilter', () => {
  it('renders header (field name + Clear), the chip row, and an All filters… footer', () => {
    const board = makeBoard();
    const ctx = makeCtx(board);
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    openColumnFilter(anchor, ctx, 'Status');

    const panel = document.querySelector('.bd-col-filter-panel')!;
    expect(panel).toBeTruthy();
    expect(panel.querySelector('.bd-filter-title')!.textContent).toBe('Status');
    expect(panel.querySelectorAll('.bd-filter-chip').length).toBe(3);
    expect(panel.querySelector('.bd-col-filter-foot')!.textContent).toContain('All filters');
  });

  it('Clear resets only this field', () => {
    const board = makeBoard();
    const ctx = makeCtx(board);
    ctx.setFilter({ Status: ['Todo'] });
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    openColumnFilter(anchor, ctx, 'Status');
    (document.querySelector('.bd-filter-clear') as HTMLButtonElement).click();
    expect(ctx.getFilter().Status).toBeUndefined();
  });

  it('All filters… calls ctx.openFilterPanel', () => {
    const board = makeBoard();
    const ctx = makeCtx(board);
    let opened = 0;
    ctx.openFilterPanel = () => { opened++; };
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    openColumnFilter(anchor, ctx, 'Status');
    (document.querySelector('.bd-col-filter-foot') as HTMLButtonElement).click();
    expect(opened).toBe(1);
  });
});
