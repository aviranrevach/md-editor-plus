/**
 * @jest-environment jsdom
 *
 * c46 — the regular-table NodeView (rail + reachable row grip + cell selection).
 * Mounts the real Table* + tiptap-markdown pipeline, like toggle-roundtrip.test.ts.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { TableWithRail } from '../src/webview/tableNodeView';
import { ROW_MENU_LABEL } from '../src/webview/tableRowOps';
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

describe('TableWithRail NodeView (c46)', () => {
  it('renders the table inside a .mp-table wrapper with a rail and keeps the rows', () => {
    const { editor, host } = makeEditor();
    const wrap = host.querySelector('.mp-table');
    expect(wrap).toBeTruthy();
    expect(wrap!.querySelector('.mp-table-rail')).toBeTruthy();
    expect(wrap!.querySelectorAll('table tbody tr').length).toBe(3); // header + 2 body
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

describe('TableWithRail grip hover (c46)', () => {
  function grip(host: HTMLElement): HTMLElement { return host.querySelector('.mp-table-rail-grip') as HTMLElement; }

  it('reveals the grip when a row is hovered', () => {
    const { editor, host } = makeEditor();
    const cell = host.querySelector('table tbody tr td')!;
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    expect(grip(host).style.display).toBe('flex');
    editor.destroy(); host.remove();
  });

  it('keeps the grip hidden in read-only documents', () => {
    const { editor, host } = makeEditor();
    editor.setEditable(false);
    const cell = host.querySelector('table tbody tr td')!;
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    expect(grip(host).style.display).toBe('none');
    editor.destroy(); host.remove();
  });
});

describe('TableWithRail row menu (c46)', () => {
  function clickGripOnRow(host: HTMLElement, rowIdx: number): void {
    const rows = host.querySelectorAll('table tbody tr');
    const cell = rows[rowIdx].querySelector('th, td')!;
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    const grip = host.querySelector('.mp-table-rail-grip')!;
    grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 5, clientY: 5 }));
  }
  function labels(): (string | null)[] {
    return Array.from(document.querySelectorAll('.mp-menu .mp-menu-label')).map(el => el.textContent);
  }
  afterEach(() => { __closeAllForTest(); document.querySelectorAll('.mp-menu').forEach(e => e.remove()); });

  it('opens the full menu on a body row', () => {
    const { editor, host } = makeEditor();
    clickGripOnRow(host, 1);
    expect(labels()).toEqual([
      ROW_MENU_LABEL['insert-above'], ROW_MENU_LABEL['insert-below'],
      ROW_MENU_LABEL['duplicate'], ROW_MENU_LABEL['delete'],
    ]);
    editor.destroy(); host.remove();
  });

  it('restricts the header row menu to Insert row below', () => {
    const { editor, host } = makeEditor();
    clickGripOnRow(host, 0);
    expect(labels()).toEqual([ROW_MENU_LABEL['insert-below']]);
    editor.destroy(); host.remove();
  });

  it('Delete row removes the row', () => {
    const { editor, host } = makeEditor();
    const before = host.querySelectorAll('table tbody tr').length;
    clickGripOnRow(host, 1);
    const del = Array.from(document.querySelectorAll('.mp-menu .mp-menu-item'))
      .find(el => el.textContent?.includes(ROW_MENU_LABEL['delete']))!;
    del.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(host.querySelectorAll('table tbody tr').length).toBe(before - 1);
    editor.destroy(); host.remove();
  });

  it('Duplicate row clones it directly below', () => {
    const { editor, host } = makeEditor();
    clickGripOnRow(host, 1);
    const dup = Array.from(document.querySelectorAll('.mp-menu .mp-menu-item'))
      .find(el => el.textContent?.includes(ROW_MENU_LABEL['duplicate']))!;
    dup.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const firsts = Array.from(host.querySelectorAll('table tbody tr'))
      .map(tr => tr.querySelector('th,td')?.textContent);
    expect(firsts).toEqual(['H1', 'a1', 'a1', 'b1']);
    editor.destroy(); host.remove();
  });
});
