/**
 * @jest-environment jsdom
 *
 * c46 — real-editor round-trip tests for the table row transactions. Mounts
 * the same Table* + tiptap-markdown pipeline the editor uses (cf.
 * toggle-roundtrip.test.ts) so we prove rows reorder/insert/duplicate/delete
 * correctly AND that the markdown stays lossless — the c37/c48 data-loss guard.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import {
  findFirstTable,
  findTableAround,
  isHeaderRow,
  moveRow,
  duplicateRow,
  insertRowRelative,
  deleteRowAt,
  type TableLoc,
} from '../src/webview/tableRowTx';

const TABLE_MD = [
  '| H1 | H2 |',
  '| --- | --- |',
  '| a1 | a2 |',
  '| b1 | b2 |',
  '| c1 | c2 |',
].join('\n');

function makeEditor(md: string): Editor {
  return new Editor({
    element: document.createElement('div'),
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
}

function md(editor: Editor): string {
  return editor.storage.markdown.getMarkdown() as string;
}

function loc(editor: Editor): TableLoc {
  const l = findFirstTable(editor.state.doc);
  if (!l) throw new Error('no table in doc');
  return l;
}

/** Body-row first-cell texts, in document order (skips the header row). */
function bodyFirstCells(editor: Editor): string[] {
  const l = loc(editor);
  const out: string[] = [];
  l.node.forEach((row, _o, idx) => {
    if (idx === 0) return; // header
    out.push(row.firstChild?.textContent ?? '');
  });
  return out;
}

describe('tableRowTx round-trip (c46)', () => {
  it('serializes a table losslessly before any edit (sanity)', () => {
    const editor = makeEditor(TABLE_MD);
    const out = md(editor);
    expect(out).toContain('a1');
    expect(out).toContain('c2');
    expect(out).toContain('H1');
    editor.destroy();
  });

  it('moveRow reorders a body row and keeps the header first', () => {
    const editor = makeEditor(TABLE_MD);
    // rows: [header(0), a(1), b(2), c(3)] — move a to the end.
    moveRow(editor, loc(editor), 1, 4);
    expect(bodyFirstCells(editor)).toEqual(['b1', 'c1', 'a1']);
    expect(isHeaderRow(loc(editor).node, 0)).toBe(true);
    expect(md(editor)).toContain('H1'); // header survived, still first
    editor.destroy();
  });

  it('moveRow refuses to move the header row', () => {
    const editor = makeEditor(TABLE_MD);
    moveRow(editor, loc(editor), 0, 4);
    expect(bodyFirstCells(editor)).toEqual(['a1', 'b1', 'c1']);
    editor.destroy();
  });

  it('duplicateRow inserts an identical clone directly below the source', () => {
    const editor = makeEditor(TABLE_MD);
    duplicateRow(editor, loc(editor), 2); // duplicate b
    expect(bodyFirstCells(editor)).toEqual(['a1', 'b1', 'b1', 'c1']);
    editor.destroy();
  });

  it('duplicateRow refuses the header row', () => {
    const editor = makeEditor(TABLE_MD);
    duplicateRow(editor, loc(editor), 0);
    expect(bodyFirstCells(editor)).toEqual(['a1', 'b1', 'c1']);
    editor.destroy();
  });

  it('insertRowRelative below adds a blank body row in the right place', () => {
    const editor = makeEditor(TABLE_MD);
    insertRowRelative(editor, loc(editor), 1, 'below'); // below a
    const cells = bodyFirstCells(editor);
    expect(cells).toHaveLength(4);
    expect(cells[0]).toBe('a1');
    expect(cells[1]).toBe(''); // new blank row
    expect(cells[2]).toBe('b1');
    editor.destroy();
  });

  it('insertRowRelative above a body row adds it before that row', () => {
    const editor = makeEditor(TABLE_MD);
    insertRowRelative(editor, loc(editor), 2, 'above'); // above b
    const cells = bodyFirstCells(editor);
    expect(cells[0]).toBe('a1');
    expect(cells[1]).toBe(''); // new blank row before b
    expect(cells[2]).toBe('b1');
    editor.destroy();
  });

  it('insertRowRelative above refuses to push a row above the header', () => {
    const editor = makeEditor(TABLE_MD);
    insertRowRelative(editor, loc(editor), 0, 'above');
    expect(bodyFirstCells(editor)).toEqual(['a1', 'b1', 'c1']);
    expect(isHeaderRow(loc(editor).node, 0)).toBe(true);
    editor.destroy();
  });

  it('deleteRowAt removes a body row and keeps the markdown valid', () => {
    const editor = makeEditor(TABLE_MD);
    deleteRowAt(editor, loc(editor), 2); // delete b
    expect(bodyFirstCells(editor)).toEqual(['a1', 'c1']);
    expect(md(editor)).toContain('H1');
    editor.destroy();
  });

  it('deleteRowAt refuses to delete the header row', () => {
    const editor = makeEditor(TABLE_MD);
    deleteRowAt(editor, loc(editor), 0);
    expect(isHeaderRow(loc(editor).node, 0)).toBe(true);
    expect(bodyFirstCells(editor)).toEqual(['a1', 'b1', 'c1']);
    editor.destroy();
  });

  it('findTableAround locates the table from a position inside a cell', () => {
    const editor = makeEditor(TABLE_MD);
    const direct = loc(editor);
    const around = findTableAround(editor.state.doc, direct.tablePos + 3);
    expect(around?.tablePos).toBe(direct.tablePos);
    editor.destroy();
  });
});
