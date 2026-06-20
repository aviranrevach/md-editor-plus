/**
 * @jest-environment jsdom
 *
 * c46 — DOM tests for the regular-table row handle. Mounts a real editor with
 * the table extensions, wires createTableRowHandle, then drives the grip with
 * mouse events (like menu.test.ts / the c36 table grip tests).
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { createTableRowHandle } from '../src/webview/tableRowHandle';
import { ROW_MENU_LABEL } from '../src/webview/tableRowOps';
import { __closeAllForTest } from '../src/webview/popover';

const TABLE_MD = [
  '| H1 | H2 |',
  '| --- | --- |',
  '| a1 | a2 |',
  '| b1 | b2 |',
].join('\n');

let editor: Editor;
let dispose: () => void;
let host: HTMLElement;

function mount(md = TABLE_MD): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ transformCopiedText: true }),
    ],
    content: md,
  });
  dispose = createTableRowHandle(editor);
}

afterEach(() => {
  __closeAllForTest();
  dispose?.();
  editor?.destroy();
  host?.remove();
  document.querySelectorAll('.tbl-row-handle, .mp-menu, .tbl-drop-line').forEach(el => el.remove());
});

/** Hover a cell so the handle adopts that row, then click the grip with no movement. */
function clickGripOnRow(rowIdx: number): void {
  const rows = host.querySelectorAll('.ProseMirror table tr');
  const cell = rows[rowIdx].querySelector('th, td')!;
  cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
  const grip = document.querySelector('.tbl-row-handle')!;
  grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 5, clientY: 5 }));
}

function menuLabels(): (string | null)[] {
  return Array.from(document.querySelectorAll('.mp-menu .mp-menu-label')).map(el => el.textContent);
}

describe('table row handle (c46)', () => {
  beforeEach(() => mount());

  it('shows the grip when hovering a regular-table row', () => {
    const cell = host.querySelector('.ProseMirror table td')!;
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const grip = document.querySelector('.tbl-row-handle') as HTMLElement;
    expect(grip).toBeTruthy();
    expect(grip.style.display).toBe('flex');
  });

  it('opens the full action menu on a body row', () => {
    clickGripOnRow(1); // first body row (a)
    expect(menuLabels()).toEqual([
      ROW_MENU_LABEL['insert-above'],
      ROW_MENU_LABEL['insert-below'],
      ROW_MENU_LABEL['duplicate'],
      ROW_MENU_LABEL['delete'],
    ]);
  });

  it('restricts the header row menu to Insert row below', () => {
    clickGripOnRow(0); // header
    expect(menuLabels()).toEqual([ROW_MENU_LABEL['insert-below']]);
  });

  it('Delete row removes the row', () => {
    const before = host.querySelectorAll('.ProseMirror table tr').length;
    clickGripOnRow(1);
    const del = Array.from(document.querySelectorAll('.mp-menu .mp-menu-item'))
      .find(el => el.textContent?.includes(ROW_MENU_LABEL['delete']))!;
    del.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const after = host.querySelectorAll('.ProseMirror table tr').length;
    expect(after).toBe(before - 1);
  });

  it('hides the grip in read-only documents', () => {
    editor.setEditable(false);
    const cell = host.querySelector('.ProseMirror table td')!;
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const grip = document.querySelector('.tbl-row-handle') as HTMLElement;
    expect(grip.style.display).toBe('none');
  });
});
