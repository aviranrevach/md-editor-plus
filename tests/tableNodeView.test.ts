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
