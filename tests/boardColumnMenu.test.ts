/**
 * @jest-environment jsdom
 *
 * Column header three-dot menu: the Sort dropdown (c4) and Delete property (c3).
 */

import { mountTable } from '../src/webview/boardTableRender';
import type { Board } from '../src/webview/boardModel';
import type { BoardRendererCtx } from '../src/webview/boardBlock';

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
      { name: 'Notes',  type: 'text',   visibleOnCard: true },
    ],
    cards: [
      { id: 'c1', values: { Title: 'Alpha', Status: 'Todo',  Owner: 'Alice' }, body: '' },
      { id: 'c2', values: { Title: 'Beta',  Status: 'Doing', Owner: 'Bob'   }, body: '' },
    ],
    orphanBodies: [],
    views: [],
    activeView: 'table',
    ...overrides,
  };
}

function mount(board: Board): { boardRef: { current: Board }; ctx: BoardRendererCtx } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const boardRef = { current: board };
  const ctx: BoardRendererCtx = {
    root,
    getBoard: () => boardRef.current,
    mutate: (next: Board) => { boardRef.current = next; },
    openSidePanel: () => { /* no-op */ },
    requestDelete: () => { /* no-op */ },
    readonly: false,
    isReadonly: () => false,
    getFilter: () => ({}),
    setFilter: () => { /* no-op */ },
  } as unknown as BoardRendererCtx;
  mountTable(ctx).update(board);
  return { boardRef, ctx };
}

/** Open the ⋯ menu for a column header and return the live menu element. */
function openColMenu(field: string): HTMLElement {
  const th = document.querySelector(`th[data-field="${field}"]`) as HTMLElement;
  (th.querySelector('.bd-col-menu-btn') as HTMLButtonElement).click();
  return document.querySelector('.bd-col-menu') as HTMLElement;
}

function rows(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll('.mp-menu-item'));
}

function rowFor(menu: HTMLElement, label: string): HTMLElement {
  const found = rows(menu).find(r => r.querySelector('.mp-menu-label')?.textContent === label);
  if (!found) throw new Error(`no menu row labelled "${label}"`);
  return found;
}

/** Menu rows act on mousedown, not click. */
function press(row: HTMLElement): void {
  row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
}

afterEach(() => { document.body.innerHTML = ''; });

describe('Sort dropdown (c4)', () => {
  it('shows None on an unsorted column and the direction on the sorted one', () => {
    mount(makeBoard({ views: [{ name: 'table', sort: { field: 'Owner', dir: 'desc' } }] }));

    expect(rowFor(openColMenu('Owner'), 'Sort').querySelector('.mp-menu-value')!.textContent)
      .toBe('Descending');
    expect(rowFor(openColMenu('Title'), 'Sort').querySelector('.mp-menu-value')!.textContent)
      .toBe('None');
  });

  it('offers exactly None / Ascending / Descending, ticking the active one', () => {
    mount(makeBoard({ views: [{ name: 'table', sort: { field: 'Owner', dir: 'asc' } }] }));

    const menu = openColMenu('Owner');
    press(rowFor(menu, 'Sort'));

    const labels = rows(menu)
      .map(r => r.querySelector('.mp-menu-label')!.textContent)
      .filter(l => l !== 'Back');
    expect(labels).toEqual(['None', 'Ascending', 'Descending']);
    expect(rowFor(menu, 'Ascending').querySelector('.mp-menu-check')).toBeTruthy();
    expect(rowFor(menu, 'None').querySelector('.mp-menu-check')).toBeFalsy();
  });

  it('picking a direction sorts the table view by that column', () => {
    const { boardRef } = mount(makeBoard());

    const menu = openColMenu('Owner');
    press(rowFor(menu, 'Sort'));
    press(rowFor(menu, 'Descending'));

    expect(boardRef.current.views.find(v => v.name === 'table')?.sort)
      .toEqual({ field: 'Owner', dir: 'desc' });
  });

  it('picking None clears the sort this column owns', () => {
    const { boardRef } = mount(makeBoard({
      views: [{ name: 'table', sort: { field: 'Owner', dir: 'asc' } }],
    }));

    const menu = openColMenu('Owner');
    press(rowFor(menu, 'Sort'));
    press(rowFor(menu, 'None'));

    expect(boardRef.current.views.find(v => v.name === 'table')?.sort).toBeUndefined();
  });

  it('picking None on a different column leaves the existing sort alone', () => {
    const { boardRef } = mount(makeBoard({
      views: [{ name: 'table', sort: { field: 'Owner', dir: 'asc' } }],
    }));

    const menu = openColMenu('Title');
    press(rowFor(menu, 'Sort'));
    press(rowFor(menu, 'None'));

    expect(boardRef.current.views.find(v => v.name === 'table')?.sort)
      .toEqual({ field: 'Owner', dir: 'asc' });
  });
});

describe('Delete property (c3)', () => {
  it('is disabled for the system fields and enabled for custom ones', () => {
    mount(makeBoard());

    expect((rowFor(openColMenu('Title'),  'Delete property') as HTMLButtonElement).disabled).toBe(true);
    expect((rowFor(openColMenu('Status'), 'Delete property') as HTMLButtonElement).disabled).toBe(true);
    expect((rowFor(openColMenu('Owner'),  'Delete property') as HTMLButtonElement).disabled).toBe(false);
  });

  it('deletes an empty property outright — no confirm, no leftover values', () => {
    const { boardRef } = mount(makeBoard());

    press(rowFor(openColMenu('Notes'), 'Delete property'));

    expect(document.querySelector('.board-confirm-overlay')).toBeNull();
    expect(boardRef.current.fields.map(f => f.name)).not.toContain('Notes');
  });

  it('confirms first when cards hold data, and only deletes on confirm', () => {
    const { boardRef } = mount(makeBoard());

    press(rowFor(openColMenu('Owner'), 'Delete property'));

    const overlay = document.querySelector('.board-confirm-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.querySelector('.board-confirm-title')!.textContent).toContain('Owner');
    // Still there until the user says yes.
    expect(boardRef.current.fields.map(f => f.name)).toContain('Owner');

    (overlay.querySelector('.board-confirm-confirm') as HTMLButtonElement).click();

    expect(boardRef.current.fields.map(f => f.name)).not.toContain('Owner');
    expect(boardRef.current.cards.every(c => !('Owner' in c.values))).toBe(true);
  });

  it('cancelling keeps the property', () => {
    const { boardRef } = mount(makeBoard());

    press(rowFor(openColMenu('Owner'), 'Delete property'));
    (document.querySelector('.board-confirm-cancel') as HTMLButtonElement).click();

    expect(boardRef.current.fields.map(f => f.name)).toContain('Owner');
  });

  it('drops the sort / grouping / width the deleted column owned', () => {
    const { boardRef } = mount(makeBoard({
      views: [{
        name: 'table',
        sort: { field: 'Notes', dir: 'asc' },
        groupBy: 'Notes',
        widths: { Notes: 200, Title: 160 },
      }],
    }));

    press(rowFor(openColMenu('Notes'), 'Delete property'));

    const view = boardRef.current.views.find(v => v.name === 'table');
    expect(view?.sort).toBeUndefined();
    expect(view?.groupBy).toBeUndefined();
    expect(view?.widths?.Notes).toBeUndefined();
    expect(view?.widths?.Title).toBe(160);
  });
});
