/**
 * @jest-environment jsdom
 *
 * DOM-level tests for the table renderer (mountTable).
 * Requires jsdom because it exercises real DOM APIs: click events,
 * contenteditable, status dropdowns, etc.
 */

import { mountTable } from '../../src/webview/boardTableRender';
import type { Board } from '../../src/webview/boardModel';
import type { BoardRendererCtx } from '../../src/webview/boardBlock';

// ---------------------------------------------------------------------------
// Minimal fixture factory
// ---------------------------------------------------------------------------

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: 'b1',
    name: 'Test Board',
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
      { id: 'c1', values: { id: 'c1', Title: 'Alpha', Status: 'Todo',  Owner: 'Alice' }, body: '' },
      { id: 'c2', values: { id: 'c2', Title: 'Beta',  Status: 'Doing', Owner: 'Bob'   }, body: '' },
    ],
    orphanBodies: [],
    views: [],
    activeView: 'table',
    ...overrides,
  };
}

/** Build a minimal BoardRendererCtx backed by a live mutable board ref. */
function makeCtx(
  board: Board,
  overrides: Partial<BoardRendererCtx> = {},
): { ctx: BoardRendererCtx; boardRef: { current: Board } } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const boardRef = { current: board };
  const ctx: BoardRendererCtx = {
    root,
    getBoard: () => boardRef.current,
    mutate: (next: Board) => { boardRef.current = next; },
    openSidePanel: (_id: string) => { /* no-op */ },
    readonly: false,
    ...overrides,
  };
  return { ctx, boardRef };
}

afterEach(() => {
  // Clean up all nodes appended to body by the renderer or tests.
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// 1. Skeleton: thead, tbody, and destroy()
// ---------------------------------------------------------------------------

describe('mountTable skeleton', () => {
  it('renders a thead with one <th> per visible field plus a gutter <th>', () => {
    const { ctx } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    const ths = ctx.root.querySelectorAll('thead tr th');
    // gutter + Title + Status + Owner + Description = 5
    // (Description is the synthetic column always appended)
    expect(ths.length).toBeGreaterThanOrEqual(4); // gutter + at least 3 user fields
    // gutter has no data-field; field ths do
    const fieldThs = Array.from(ths).filter(th => (th as HTMLElement).dataset.field);
    expect(fieldThs.length).toBeGreaterThanOrEqual(3);

    ops.destroy();
  });

  it('renders a tbody with one row per card', () => {
    const { ctx } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    const rows = ctx.root.querySelectorAll('tbody tr.bd-table-row');
    expect(rows.length).toBe(2);

    ops.destroy();
  });

  it('destroy() clears the host element and removes bd-table-host class', () => {
    const { ctx } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    ops.destroy();

    expect(ctx.root.innerHTML).toBe('');
    expect(ctx.root.classList.contains('bd-table-host')).toBe(false);
  });

  it('writable board with zero cards still renders the add-row (not the readonly empty-state)', () => {
    const b = makeBoard({ cards: [] });
    const { ctx } = makeCtx(b);
    const ops = mountTable(ctx);

    // Should have the add-row, not the readonly empty state message
    const addRow = ctx.root.querySelector('.bd-table-addrow');
    const emptyState = ctx.root.querySelector('.bd-table-empty');
    expect(addRow).not.toBeNull();
    expect(emptyState).toBeNull();

    ops.destroy();
  });

  it('readonly board with zero cards renders the empty-state div', () => {
    const b = makeBoard({ cards: [] });
    const { ctx } = makeCtx(b, { readonly: true });
    const ops = mountTable(ctx);

    const emptyState = ctx.root.querySelector('.bd-table-empty');
    expect(emptyState).not.toBeNull();

    ops.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. Inline text / person editor
// ---------------------------------------------------------------------------

describe('inline text/person editor', () => {
  it('clicking a text cell sets it to contenteditable="true"', () => {
    const { ctx } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    const titleCell = ctx.root.querySelector(
      'td.bd-table-cell[data-field="Title"]',
    ) as HTMLElement;
    expect(titleCell).not.toBeNull();

    titleCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(titleCell.getAttribute('contenteditable')).toBe('true');

    ops.destroy();
  });

  it('pressing Enter in an edited text cell mutates the board and updates card value', () => {
    const { ctx, boardRef } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    const titleCell = ctx.root.querySelector(
      'td.bd-table-cell[data-field="Title"]',
    ) as HTMLElement;

    // Activate inline edit
    titleCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Simulate typing a new value
    titleCell.textContent = 'NewTitle';

    // Press Enter to commit
    titleCell.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    // The mutate call should have updated the first card's Title
    expect(boardRef.current.cards[0].values.Title).toBe('NewTitle');

    ops.destroy();
  });

  it('pressing Escape in an edited text cell reverts without mutating', () => {
    const { ctx, boardRef } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    const originalTitle = boardRef.current.cards[0].values.Title;

    const titleCell = ctx.root.querySelector(
      'td.bd-table-cell[data-field="Title"]',
    ) as HTMLElement;

    titleCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    titleCell.textContent = 'ShouldNotCommit';
    titleCell.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    // Board should be unchanged
    expect(boardRef.current.cards[0].values.Title).toBe(originalTitle);

    ops.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. Status chip + dropdown
// ---------------------------------------------------------------------------

describe('status chip + dropdown', () => {
  it('status cell renders a chip element with the matching column color class', () => {
    const { ctx } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    const statusCell = ctx.root.querySelector(
      'td.bd-table-cell[data-field="Status"]',
    ) as HTMLElement;
    expect(statusCell).not.toBeNull();

    // The chip should carry the column's color class (Todo = blue)
    const chip = statusCell.querySelector('.board-column-chip');
    expect(chip).not.toBeNull();
    expect(chip!.classList.contains('color-blue')).toBe(true);

    ops.destroy();
  });

  it('clicking a status cell opens a dropdown with one option per column', () => {
    const { ctx } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    const statusCell = ctx.root.querySelector(
      'td.bd-table-cell[data-field="Status"]',
    ) as HTMLElement;

    statusCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const dropdown = document.querySelector('.board-status-dropdown');
    expect(dropdown).not.toBeNull();

    const options = dropdown!.querySelectorAll('.board-status-option');
    // Board has 2 columns (Todo, Doing)
    expect(options.length).toBe(2);

    ops.destroy();
  });

  it('clicking a column option mutates Status on the card', () => {
    const { ctx, boardRef } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    // Click the first status cell (card c1, Status = Todo)
    const statusCell = ctx.root.querySelector(
      'td.bd-table-cell[data-field="Status"]',
    ) as HTMLElement;
    statusCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Click the second option (Doing)
    const dropdown = document.querySelector('.board-status-dropdown')!;
    const options = dropdown.querySelectorAll('.board-status-option');
    (options[1] as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(boardRef.current.cards[0].values.Status).toBe('Doing');

    ops.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. Date cell
// ---------------------------------------------------------------------------

describe('date cell', () => {
  it('past date renders with bd-date-overdue class', () => {
    const b = makeBoard({
      fields: [
        { name: 'Title',   type: 'text',   visibleOnCard: true },
        { name: 'Status',  type: 'status', visibleOnCard: true },
        { name: 'Due',     type: 'date',   visibleOnCard: true },
      ],
      cards: [
        {
          id: 'c1',
          values: { id: 'c1', Title: 'A', Status: 'Todo', Due: '2000-01-01' },
          body: '',
        },
      ],
    });
    const { ctx } = makeCtx(b);
    const ops = mountTable(ctx);

    const datePill = ctx.root.querySelector('.bd-date');
    expect(datePill).not.toBeNull();
    expect(datePill!.classList.contains('bd-date-overdue')).toBe(true);

    ops.destroy();
  });

  it('empty date renders the bd-cell-empty placeholder', () => {
    const b = makeBoard({
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Due',    type: 'date',   visibleOnCard: true },
      ],
      cards: [
        {
          id: 'c1',
          values: { id: 'c1', Title: 'A', Status: 'Todo', Due: '' },
          body: '',
        },
      ],
    });
    const { ctx } = makeCtx(b);
    const ops = mountTable(ctx);

    const dueCells = ctx.root.querySelectorAll('td.bd-table-cell[data-field="Due"]');
    expect(dueCells.length).toBeGreaterThan(0);
    const placeholder = dueCells[0].querySelector('.bd-cell-empty');
    expect(placeholder).not.toBeNull();

    ops.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. Tags cell
// ---------------------------------------------------------------------------

describe('tags cell', () => {
  it('renders one .bd-tag per comma-separated tag', () => {
    const b = makeBoard({
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Labels', type: 'tags',   visibleOnCard: true },
      ],
      cards: [
        {
          id: 'c1',
          values: { id: 'c1', Title: 'A', Status: 'Todo', Labels: 'bug, feature, urgent' },
          body: '',
        },
      ],
    });
    const { ctx } = makeCtx(b);
    const ops = mountTable(ctx);

    const tagCell = ctx.root.querySelector('td.bd-table-cell[data-field="Labels"]') as HTMLElement;
    expect(tagCell).not.toBeNull();

    const tags = tagCell.querySelectorAll('.bd-tag');
    expect(tags.length).toBe(3);

    ops.destroy();
  });

  it('empty tags value renders the bd-cell-empty placeholder', () => {
    const b = makeBoard({
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Labels', type: 'tags',   visibleOnCard: true },
      ],
      cards: [
        {
          id: 'c1',
          values: { id: 'c1', Title: 'A', Status: 'Todo', Labels: '' },
          body: '',
        },
      ],
    });
    const { ctx } = makeCtx(b);
    const ops = mountTable(ctx);

    const tagCell = ctx.root.querySelector('td.bd-table-cell[data-field="Labels"]') as HTMLElement;
    const placeholder = tagCell.querySelector('.bd-cell-empty');
    expect(placeholder).not.toBeNull();

    ops.destroy();
  });
});

// ---------------------------------------------------------------------------
// 6. Sort cycle
// ---------------------------------------------------------------------------

describe('sort cycle', () => {
  it('clicking a header cycles unsorted -> asc -> desc -> unsorted', () => {
    const b = makeBoard();
    const { ctx, boardRef } = makeCtx(b);
    const ops = mountTable(ctx);

    const titleTh = ctx.root.querySelector('th[data-field="Title"]') as HTMLElement;

    // First click: no sort → asc
    titleTh.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(boardRef.current.views.find(v => v.name === 'table')?.sort).toEqual(
      { field: 'Title', dir: 'asc' },
    );

    // Re-render to sync DOM
    ops.update(boardRef.current);

    // Second click: asc → desc
    const titleTh2 = ctx.root.querySelector('th[data-field="Title"]') as HTMLElement;
    titleTh2.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(boardRef.current.views.find(v => v.name === 'table')?.sort).toEqual(
      { field: 'Title', dir: 'desc' },
    );

    ops.update(boardRef.current);

    // Third click: desc → null
    const titleTh3 = ctx.root.querySelector('th[data-field="Title"]') as HTMLElement;
    titleTh3.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(boardRef.current.views.find(v => v.name === 'table')?.sort).toBeUndefined();

    ops.destroy();
  });

  it('rows render in sorted (asc) order when view.sort is set on Title', () => {
    const b = makeBoard({
      views: [{ name: 'table', sort: { field: 'Title', dir: 'asc' } }],
    });
    const { ctx } = makeCtx(b);
    const ops = mountTable(ctx);

    const rows = Array.from(ctx.root.querySelectorAll('tr.bd-table-row'));
    const titles = rows.map(r =>
      (r.querySelector('td[data-field="Title"]') as HTMLElement)?.textContent ?? '',
    );

    expect(titles).toEqual([...titles].sort((a, c) => a.localeCompare(c, undefined, { sensitivity: 'base' })));

    ops.destroy();
  });
});

// ---------------------------------------------------------------------------
// 7. Group-by
// ---------------------------------------------------------------------------

describe('group-by', () => {
  it('groupBy:Status renders group headers matching board.columns order', () => {
    const b = makeBoard({
      views: [{ name: 'table', groupBy: 'Status' }],
    });
    const { ctx } = makeCtx(b);
    const ops = mountTable(ctx);

    const groupHeaders = ctx.root.querySelectorAll('tr.bd-table-group');
    // There should be at least 2 groups (Todo, Doing)
    expect(groupHeaders.length).toBeGreaterThanOrEqual(2);

    // First group header should show 'Todo' (board.columns order)
    const firstChipName = groupHeaders[0].querySelector('.board-column-name');
    expect(firstChipName?.textContent).toBe('Todo');

    ops.destroy();
  });

  it('cards with an invalid Status go into Uncategorized group at the end', () => {
    const b = makeBoard({
      cards: [
        { id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo',    Owner: '' }, body: '' },
        { id: 'c2', values: { id: 'c2', Title: 'B', Status: 'Unknown', Owner: '' }, body: '' },
      ],
      views: [{ name: 'table', groupBy: 'Status' }],
    });
    const { ctx } = makeCtx(b);
    const ops = mountTable(ctx);

    const groupHeaders = Array.from(ctx.root.querySelectorAll('tr.bd-table-group'));
    const names = groupHeaders.map(h => h.querySelector('.board-column-name')?.textContent ?? '');

    // Uncategorized should be last
    expect(names[names.length - 1]).toBe('Uncategorized');

    ops.destroy();
  });
});

// ---------------------------------------------------------------------------
// 8. Add-card (inline-edit flow)
// ---------------------------------------------------------------------------

describe('add card (inline-edit flow)', () => {
  it('flat mode: clicking the addrow activates contenteditable on the placeholder cell', () => {
    const { ctx } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    const placeholder = ctx.root.querySelector('.bd-addrow-placeholder') as HTMLElement;
    expect(placeholder).not.toBeNull();

    // The add-row click listener calls beginAdd which sets contenteditable.
    const addRow = ctx.root.querySelector('.bd-table-addrow') as HTMLElement;
    addRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(placeholder.getAttribute('contenteditable')).toBe('true');

    ops.destroy();
  });

  it('flat mode: pressing Enter with content commits a new card via mutate', () => {
    const { ctx, boardRef } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    // Activate add-row by clicking the addrow row
    const addRow = ctx.root.querySelector('.bd-table-addrow') as HTMLElement;
    addRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // After the click, the placeholder cell should be contenteditable
    const placeholder = ctx.root.querySelector(
      '.bd-table-addrow td[contenteditable="true"]',
    ) as HTMLElement;
    expect(placeholder).not.toBeNull();

    placeholder.textContent = 'New Card Title';
    placeholder.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(boardRef.current.cards.length).toBe(3);
    expect(boardRef.current.cards[2].values.Title).toBe('New Card Title');

    ops.destroy();
  });

  it('grouped mode: clicking "+ Add row" sets the new card groupBy field to the group key', () => {
    const b = makeBoard({
      views: [{ name: 'table', groupBy: 'Status' }],
    });
    const { ctx, boardRef } = makeCtx(b);
    const ops = mountTable(ctx);

    // Find the "+ Add row" button inside the first group (Todo)
    const addBtns = ctx.root.querySelectorAll('.bd-group-add');
    expect(addBtns.length).toBeGreaterThan(0);

    (addBtns[0] as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    // A new card should have been added with Status = 'Todo'
    const newCard = boardRef.current.cards.find(c => !['c1', 'c2'].includes(c.id));
    expect(newCard).toBeDefined();
    expect(newCard!.values.Status).toBe('Todo');

    ops.destroy();
  });
});

// ---------------------------------------------------------------------------
// 9. Column resize — delegated mousedown path
// ---------------------------------------------------------------------------

describe('column resize', () => {
  it('mousedown on a .bd-col-resizer updates the column width via setViewWidth on mouseup', () => {
    const { ctx, boardRef } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    const resizer = ctx.root.querySelector('.bd-col-resizer') as HTMLElement;
    expect(resizer).not.toBeNull();

    // The resizer is inside the host which is inside document.body.
    // The delegated capture listener fires on mousedown on any element
    // inside the host.
    resizer.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 10,
      }),
    );

    // Simulate mouse move 40px to the right
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: false,
        cancelable: true,
        clientX: 240,
        clientY: 10,
      }),
    );

    // Simulate mouseup
    document.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: false,
        cancelable: true,
        clientX: 240,
        clientY: 10,
      }),
    );

    // A setViewWidth mutate should have fired and stored the new width
    const tableView = boardRef.current.views.find(v => v.name === 'table');
    expect(tableView?.widths).toBeDefined();

    ops.destroy();
  });
});

// ---------------------------------------------------------------------------
// 10. Row reorder grip + drag indicator
// ---------------------------------------------------------------------------

describe('row reorder — drag indicator', () => {
  it('renders .bd-row-grip elements for each card row in writable mode', () => {
    const { ctx } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    const grips = ctx.root.querySelectorAll('.bd-row-grip');
    // One grip per card row
    expect(grips.length).toBe(2);

    ops.destroy();
  });

  it('grip has data-board-drag attribute (wires to delegated mousedown)', () => {
    const { ctx } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    const grip = ctx.root.querySelector('.bd-row-grip') as HTMLElement;
    expect(grip.hasAttribute('data-board-drag')).toBe(true);

    ops.destroy();
  });

  it('mousedown on a grip synchronously adds bd-tr-dragging to the card row', () => {
    // jsdom does not implement document.elementFromPoint, which is called by the
    // row-drag onMove handler. We stub it so the drag move path does not throw.
    // The class is added synchronously on mousedown (before any move event).
    const origElementFromPoint = document.elementFromPoint;
    (document as any).elementFromPoint = () => null;

    const { ctx } = makeCtx(makeBoard());
    const ops = mountTable(ctx);

    const grip = ctx.root.querySelector('.bd-row-grip') as HTMLElement;
    const tr = grip.closest('tr.bd-table-row') as HTMLElement;

    grip.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 50,
      }),
    );

    // bd-tr-dragging is added synchronously in onDocMousedown — no move needed.
    expect(tr.classList.contains('bd-tr-dragging')).toBe(true);

    // Clean up: fire mouseup so drag listeners are removed
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: false, clientX: 10, clientY: 60 }));

    // Restore
    (document as any).elementFromPoint = origElementFromPoint;

    ops.destroy();
  });
});

// ---------------------------------------------------------------------------
// 11. Readonly mode
// ---------------------------------------------------------------------------

describe('readonly mode', () => {
  it('does not render .bd-row-grip, .bd-table-addrow, .bd-col-resizer, or .bd-col-menu-btn', () => {
    const { ctx } = makeCtx(makeBoard(), { readonly: true });
    const ops = mountTable(ctx);

    expect(ctx.root.querySelector('.bd-row-grip')).toBeNull();
    expect(ctx.root.querySelector('.bd-table-addrow')).toBeNull();
    expect(ctx.root.querySelector('.bd-col-resizer')).toBeNull();
    expect(ctx.root.querySelector('.bd-col-menu-btn')).toBeNull();

    ops.destroy();
  });

  it('clicking a Title cell in readonly mode does NOT enter contenteditable', () => {
    const { ctx } = makeCtx(makeBoard(), { readonly: true });
    const ops = mountTable(ctx);

    const titleCell = ctx.root.querySelector(
      'td.bd-table-cell[data-field="Title"]',
    ) as HTMLElement;

    titleCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(titleCell.getAttribute('contenteditable')).not.toBe('true');

    ops.destroy();
  });
});
