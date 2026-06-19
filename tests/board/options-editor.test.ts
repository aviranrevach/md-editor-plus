/**
 * @jest-environment jsdom
 */
import { buildOptionsEditor } from '../../src/webview/boardStatusOptions';
import type { Board, ColumnDef } from '../../src/webview/boardModel';
import { openFieldActionMenu, promptNewField } from '../../src/webview/boardProperties';

function render(options: ColumnDef[], cb: any) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  buildOptionsEditor(host, {
    getOptions: () => options,
    onAdd: cb.onAdd ?? (() => {}),
    onRename: cb.onRename ?? (() => {}),
    onRecolor: cb.onRecolor ?? (() => {}),
    onDelete: cb.onDelete ?? (() => {}),
  });
  return host;
}

describe('buildOptionsEditor', () => {
  const opts: ColumnDef[] = [{ name: 'Low', color: 'gray' }, { name: 'High', color: 'red' }];

  it('renders one row per option plus an add control', () => {
    const host = render(opts, {});
    expect(host.querySelectorAll('.bd-opt-row')).toHaveLength(2);
    expect(host.querySelector('.bd-opt-add')).not.toBeNull();
  });

  it('clicking × calls onDelete with the option name', () => {
    const deleted: string[] = [];
    const host = render(opts, { onDelete: (n: string) => deleted.push(n) });
    (host.querySelectorAll('.bd-opt-delete')[1] as HTMLElement).click();
    expect(deleted).toEqual(['High']);
  });

  it('clicking + add calls onAdd', () => {
    let added = 0;
    const host = render(opts, { onAdd: () => { added++; } });
    (host.querySelector('.bd-opt-add') as HTMLElement).click();
    expect(added).toBe(1);
  });

  it('picking a palette swatch calls onRecolor with (name, token)', () => {
    const calls: any[] = [];
    const host = render(opts, { onRecolor: (n: string, c: string) => calls.push([n, c]) });
    (host.querySelectorAll('.bd-opt-swatch')[0] as HTMLElement).click();
    // palette is appended to document.body (via createPopover), not inside host
    const tealSwatch = document.querySelector('.bd-opt-palette .color-teal') as HTMLElement;
    tealSwatch.click();
    expect(calls).toEqual([['Low', 'teal']]);
  });
});

describe('buildOptionsEditor — rename', () => {
  const opts = () => [{ name: 'Low', color: 'gray' }, { name: 'High', color: 'red' }] as any;

  it('blurring a changed name calls onRename(old, new)', () => {
    const calls: any[] = [];
    const host = render(opts(), { onRename: (o: string, n: string) => calls.push([o, n]) });
    const input = host.querySelectorAll('.bd-opt-name')[0] as HTMLInputElement;
    input.focus(); input.value = 'Minor'; input.dispatchEvent(new Event('blur'));
    expect(calls).toEqual([['Low', 'Minor']]);
  });

  it('blurring an unchanged name does not call onRename', () => {
    const calls: any[] = [];
    const host = render(opts(), { onRename: (o: string, n: string) => calls.push([o, n]) });
    const input = host.querySelectorAll('.bd-opt-name')[0] as HTMLInputElement;
    input.focus(); input.dispatchEvent(new Event('blur'));
    expect(calls).toEqual([]);
  });

  it('emptying a name does not call onRename', () => {
    const calls: any[] = [];
    const host = render(opts(), { onRename: (o: string, n: string) => calls.push([o, n]) });
    const input = host.querySelectorAll('.bd-opt-name')[0] as HTMLInputElement;
    input.focus(); input.value = '   '; input.dispatchEvent(new Event('blur'));
    expect(calls).toEqual([]);
  });

  it("typing a new name then clicking another row's delete flushes the rename first (no loss)", () => {
    const renamed: any[] = []; const deleted: string[] = [];
    const host = render(opts(), {
      onRename: (o: string, n: string) => renamed.push([o, n]),
      onDelete: (n: string) => deleted.push(n),
    });
    const input0 = host.querySelectorAll('.bd-opt-name')[0] as HTMLInputElement;
    input0.focus(); input0.value = 'Minor';
    (host.querySelectorAll('.bd-opt-delete')[1] as HTMLElement).click();
    expect(renamed).toEqual([['Low', 'Minor']]);
    expect(deleted).toEqual(['High']);
  });
});

function fieldMenuBoard(): Board {
  return {
    id: 'b1', name: '',
    columns: [{ name: 'Todo', color: 'blue' }],
    fields: [
      { name: 'Title',  type: 'text',   visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Notes',  type: 'text',   visibleOnCard: true },
    ],
    cards: [], orphanBodies: [], views: [], activeView: 'kanban',
  };
}

describe('field action menu — Edit options', () => {
  const anchor = () => { const a = document.createElement('button'); document.body.appendChild(a); return a; };
  const labels = () =>
    Array.from(document.querySelectorAll('.board-field-action-label')).map((n) => n.textContent);

  it('shows "Edit options" for a status field', () => {
    const b = fieldMenuBoard();
    openFieldActionMenu(anchor(), b, b.fields[1], () => {});
    expect(labels()).toContain('Edit options');
  });

  it('does NOT show "Edit options" for a non-status field', () => {
    const b = fieldMenuBoard();
    openFieldActionMenu(anchor(), b, b.fields[2], () => {});
    expect(labels()).not.toContain('Edit options');
  });
});

describe('field action menu — Edit options: sequential edits compose (no stale snapshot)', () => {
  beforeEach(() => {
    // Remove any leftover menus/editors from previous tests in this file.
    document.querySelectorAll('.board-field-action-menu, .bd-opt-editor, .bd-opt-popover').forEach((n) => n.remove());
  });

  it('multiple edits via the properties-menu Edit options compose (no stale snapshot)', () => {
    const b = fieldMenuBoard(); // Status field has 1 column: Todo
    let latest: any = null;
    const a = document.createElement('button'); document.body.appendChild(a);

    openFieldActionMenu(a, b, b.fields[1], (next) => { latest = next; });

    const editBtn = Array.from(document.querySelectorAll('.board-field-action-item'))
      .find((n) => /edit options/i.test(n.textContent || '')) as HTMLElement;
    expect(editBtn).not.toBeNull();
    editBtn.click(); // opens editor (appended to body); also closes the action menu

    // buildOptionsEditor sets host.className = 'bd-opt-editor', so the popover
    // element's class is 'bd-opt-editor'. Query the add button directly.
    const addBtn = () => document.querySelector('.bd-opt-editor .bd-opt-add') as HTMLElement;
    expect(addBtn()).not.toBeNull();

    addBtn().click(); // first add — latest now has 2 columns
    addBtn().click(); // second add — should compose on top of first add → 3 columns total

    expect(latest).not.toBeNull();
    expect(latest.columns.length).toBe(3); // started with 1 + two adds
  });
});

describe('new-column popover — status seeds + creates with options', () => {
  it('picking Status reveals a States editor and Create button; Create adds a status field with options', () => {
    const board = fieldMenuBoard();
    let created: { board: Board; name: string } | null = null;
    const a = document.createElement('button'); document.body.appendChild(a);

    promptNewField(a, board, (next, name) => { created = { board: next, name }; });

    const rows = Array.from(document.querySelectorAll('.board-add-field-type-row')) as HTMLElement[];
    const statusRow = rows.find((r) => /status/i.test(r.textContent || ''))!;
    statusRow.click();

    expect(document.querySelector('.bd-opt-editor')).not.toBeNull();
    expect(created).toBeNull();

    const createBtn = document.querySelector('.board-add-field-create') as HTMLElement;
    expect(createBtn).not.toBeNull();
    createBtn.click();

    expect(created).not.toBeNull();
    const field = created!.board.fields.find((f) => f.name === created!.name)!;
    expect(field.type).toBe('status');
    expect((field.options ?? []).length).toBeGreaterThan(0);
  });
});
