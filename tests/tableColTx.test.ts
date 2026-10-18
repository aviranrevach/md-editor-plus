/**
 * @jest-environment jsdom
 *
 * c46 — real-editor round-trip tests for the column transactions (data-loss guard).
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { findFirstTable, type TableLoc } from '../src/webview/tableRowTx';
import {
  columnCount,
  duplicateColumn,
  insertColumnRelative,
  deleteColumnAt,
  moveColumn,
} from '../src/webview/tableColTx';

const TABLE_MD = [
  '| H1 | H2 | H3 |',
  '| --- | --- | --- |',
  '| a1 | a2 | a3 |',
  '| b1 | b2 | b3 |',
].join('\n');

function makeEditor(md: string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
      Markdown.configure({ transformCopiedText: true }),
    ],
    content: md,
  });
}

function loc(editor: Editor): TableLoc {
  const l = findFirstTable(editor.state.doc);
  if (!l) throw new Error('no table');
  return l;
}

/** The header cells, left→right. */
function headerCells(editor: Editor): string[] {
  const l = loc(editor);
  const header = l.node.child(0);
  const out: string[] = [];
  header.forEach((cell) => out.push(cell.textContent));
  return out;
}

describe('tableColTx round-trip (c46)', () => {
  it('reports the column count', () => {
    const editor = makeEditor(TABLE_MD);
    expect(columnCount(loc(editor).node)).toBe(3);
    editor.destroy();
  });

  it('moveColumn reorders a column across every row', () => {
    const editor = makeEditor(TABLE_MD);
    moveColumn(editor, loc(editor), 0, 3); // move col 0 (H1) to the end
    expect(headerCells(editor)).toEqual(['H2', 'H3', 'H1']);
    const md = editor.storage.markdown.getMarkdown() as string;
    expect(md).toContain('H1');
    expect(md).toContain('a1');
    editor.destroy();
  });

  it('duplicateColumn inserts a copy directly to the right', () => {
    const editor = makeEditor(TABLE_MD);
    duplicateColumn(editor, loc(editor), 1); // duplicate H2
    expect(headerCells(editor)).toEqual(['H1', 'H2', 'H2', 'H3']);
    expect(columnCount(loc(editor).node)).toBe(4);
    editor.destroy();
  });

  it('insertColumnRelative right adds a blank column after the target', () => {
    const editor = makeEditor(TABLE_MD);
    insertColumnRelative(editor, loc(editor), 0, 'right');
    const cells = headerCells(editor);
    expect(cells).toHaveLength(4);
    expect(cells[0]).toBe('H1');
    expect(cells[1]).toBe(''); // new blank column
    expect(cells[2]).toBe('H2');
    editor.destroy();
  });

  it('insertColumnRelative left adds a blank column before the target', () => {
    const editor = makeEditor(TABLE_MD);
    insertColumnRelative(editor, loc(editor), 1, 'left');
    const cells = headerCells(editor);
    expect(cells[0]).toBe('H1');
    expect(cells[1]).toBe(''); // new blank column before H2
    expect(cells[2]).toBe('H2');
    editor.destroy();
  });

  it('deleteColumnAt removes the column', () => {
    const editor = makeEditor(TABLE_MD);
    deleteColumnAt(editor, loc(editor), 1); // delete H2
    expect(headerCells(editor)).toEqual(['H1', 'H3']);
    editor.destroy();
  });

  it('deleteColumnAt refuses to remove the only column', () => {
    const editor = makeEditor(['| H1 |', '| --- |', '| a1 |'].join('\n'));
    deleteColumnAt(editor, loc(editor), 0);
    expect(columnCount(loc(editor).node)).toBe(1);
    editor.destroy();
  });
});
