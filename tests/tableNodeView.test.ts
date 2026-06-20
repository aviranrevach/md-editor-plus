/**
 * @jest-environment jsdom
 *
 * c46 — the regular-table NodeView: cell-driven row + column edge handles
 * (thin stroke hint → grip emerges near the edge) and a cell-selection state.
 * Mounts the real Table* + tiptap-markdown pipeline.
 *
 * Note: jsdom has no layout (all rects are 0), so the forgiving-band geometry
 * is verified on F5. These tests drive the wiring with small coordinates (which
 * land "near the edge" against zero-sized rects) and identify the active
 * row/column from the hovered cell (target-based), which is layout-independent.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { TableWithRail } from '../src/webview/tableNodeView';
import { ROW_MENU_LABEL } from '../src/webview/tableRowOps';
import { COL_MENU_LABEL } from '../src/webview/tableColOps';
import { __closeAllForTest } from '../src/webview/popover';

const TABLE_MD = [
  '| H1 | H2 |',
  '| --- | --- |',
  '| a1 | a2 |',
  '| b1 | b2 |',
].join('\n');

function makeEditor(md = TABLE_MD): { editor: Editor; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      TableWithRail.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
      Markdown.configure({ transformCopiedText: true }),
    ],
    content: md,
  });
  return { editor, host };
}

function hoverCell(host: HTMLElement, rowIdx: number, colIdx = 0): void {
  const rows = host.querySelectorAll('table tbody tr');
  const cell = rows[rowIdx].querySelectorAll('th, td')[colIdx];
  cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
}
function clickGrip(host: HTMLElement, sel: string): void {
  const grip = host.querySelector(sel)!;
  grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 5, clientY: 5 }));
}
function labels(): (string | null)[] {
  return Array.from(document.querySelectorAll('.mp-menu .mp-menu-label')).map(el => el.textContent);
}

afterEach(() => { __closeAllForTest(); document.querySelectorAll('.mp-menu').forEach(e => e.remove()); });

describe('TableWithRail NodeView (c46)', () => {
  it('renders the table in a .mp-table wrapper with stroke + grip elements for both axes', () => {
    const { editor, host } = makeEditor();
    const wrap = host.querySelector('.mp-table')!;
    expect(wrap).toBeTruthy();
    expect(wrap.querySelector('.mp-table-row-stroke')).toBeTruthy();
    expect(wrap.querySelector('.mp-table-col-stroke')).toBeTruthy();
    expect(wrap.querySelector('.mp-table-row-grip')).toBeTruthy();
    expect(wrap.querySelector('.mp-table-col-grip')).toBeTruthy();
    expect(wrap.querySelectorAll('table tbody tr').length).toBe(3); // header + 2 body
    editor.destroy(); host.remove();
  });

  it('serializes the table losslessly through the NodeView', () => {
    const { editor, host } = makeEditor();
    const out = editor.storage.markdown.getMarkdown() as string;
    expect(out).toContain('H1');
    expect(out).toContain('a1');
    expect(out).toContain('b2');
    editor.destroy(); host.remove();
  });
});

describe('TableWithRail edge handles (c46)', () => {
  it('summons the row and column grip near a cell edge', () => {
    const { editor, host } = makeEditor();
    hoverCell(host, 1, 0);
    expect((host.querySelector('.mp-table-row-grip') as HTMLElement).style.display).toBe('grid');
    expect((host.querySelector('.mp-table-col-grip') as HTMLElement).style.display).toBe('grid');
    editor.destroy(); host.remove();
  });

  it('shows nothing in read-only documents', () => {
    const { editor, host } = makeEditor();
    editor.setEditable(false);
    hoverCell(host, 1, 0);
    expect((host.querySelector('.mp-table-row-grip') as HTMLElement).style.display).toBe('none');
    expect((host.querySelector('.mp-table-col-grip') as HTMLElement).style.display).toBe('none');
    editor.destroy(); host.remove();
  });
});

describe('TableWithRail selection box (c46)', () => {
  it('draws the outline box when the cursor is inside a cell', () => {
    const { editor, host } = makeEditor();
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (pos >= 0) return false;
      if (node.type.name === 'tableCell') { pos = p + 2; return false; }
      return true;
    });
    editor.commands.setTextSelection(pos);
    const box = host.querySelector('.mp-table-sel-box') as HTMLElement;
    expect(box).toBeTruthy();
    expect(box.style.display).toBe('block');
    editor.destroy(); host.remove();
  });

  it('selected cells carry no background fill (the box is the only indicator)', () => {
    const { editor, host } = makeEditor();
    hoverCell(host, 1, 0);
    clickGrip(host, '.mp-table-row-grip'); // selects the row (CellSelection)
    const selected = host.querySelectorAll('table .selectedCell');
    expect(selected.length).toBeGreaterThan(0);
    selected.forEach((c) => {
      // no inline fill applied by us; CSS sets it transparent
      expect((c as HTMLElement).style.background).toBe('');
    });
    editor.destroy(); host.remove();
  });
});

describe('TableWithRail row menu (c46)', () => {
  it('opens the full row menu on a body row', () => {
    const { editor, host } = makeEditor();
    hoverCell(host, 1, 0);
    clickGrip(host, '.mp-table-row-grip');
    expect(labels()).toEqual([
      ROW_MENU_LABEL['insert-above'], ROW_MENU_LABEL['insert-below'],
      ROW_MENU_LABEL['duplicate'], ROW_MENU_LABEL['delete'],
    ]);
    editor.destroy(); host.remove();
  });

  it('restricts the header row menu to Insert row below', () => {
    const { editor, host } = makeEditor();
    hoverCell(host, 0, 0);
    clickGrip(host, '.mp-table-row-grip');
    expect(labels()).toEqual([ROW_MENU_LABEL['insert-below']]);
    editor.destroy(); host.remove();
  });

  it('Delete row removes the row', () => {
    const { editor, host } = makeEditor();
    const before = host.querySelectorAll('table tbody tr').length;
    hoverCell(host, 1, 0);
    clickGrip(host, '.mp-table-row-grip');
    const del = Array.from(document.querySelectorAll('.mp-menu .mp-menu-item'))
      .find(el => el.textContent?.includes(ROW_MENU_LABEL['delete']))!;
    del.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(host.querySelectorAll('table tbody tr').length).toBe(before - 1);
    editor.destroy(); host.remove();
  });
});

describe('TableWithRail column menu (c46)', () => {
  it('opens the full column menu on a column grip click', () => {
    const { editor, host } = makeEditor();
    hoverCell(host, 1, 0);
    clickGrip(host, '.mp-table-col-grip');
    expect(labels()).toEqual([
      COL_MENU_LABEL['insert-left'], COL_MENU_LABEL['insert-right'],
      COL_MENU_LABEL['duplicate'], COL_MENU_LABEL['delete'],
    ]);
    editor.destroy(); host.remove();
  });

  it('Delete column removes the column', () => {
    const { editor, host } = makeEditor();
    const before = host.querySelectorAll('table tbody tr')[0].children.length;
    hoverCell(host, 1, 1); // second column
    clickGrip(host, '.mp-table-col-grip');
    const del = Array.from(document.querySelectorAll('.mp-menu .mp-menu-item'))
      .find(el => el.textContent?.includes(COL_MENU_LABEL['delete']))!;
    del.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(host.querySelectorAll('table tbody tr')[0].children.length).toBe(before - 1);
    editor.destroy(); host.remove();
  });
});
