/** @jest-environment jsdom */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import { Markdown } from 'tiptap-markdown';
import { createBlockPicker } from '../src/webview/blockPicker';
import {
  BlockMath,
  InlineMath,
  MathShortcuts,
} from '../src/webview/extensions/math';

function createEditor(content: string): Editor {
  const element = document.body.appendChild(document.createElement('div'));
  return new Editor({
    element,
    extensions: [
      StarterKit,
      InlineMath,
      BlockMath,
      Markdown.configure({ transformCopiedText: true }),
      MathShortcuts,
    ],
    content,
  });
}

function openMathSearch(editor: Editor, query = 'math') {
  const picker = createBlockPicker(editor);
  const anchor = document.body.appendChild(document.createElement('div'));
  picker.open(anchor, editor.state.selection.from);
  const el = Array.from(document.querySelectorAll<HTMLElement>('.block-picker')).pop()!;
  const input = el.querySelector<HTMLInputElement>('.block-picker-input')!;
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return { picker, anchor, el };
}

function rowByText(el: Element, text: string): HTMLElement {
  return Array.from(el.querySelectorAll<HTMLElement>('.block-picker-item'))
    .find((row) => (row.textContent ?? '').includes(text))!;
}

describe('Notion-style math slash commands', () => {
  test('shows block, inline, and turn-into commands with a rendered preview', () => {
    const editor = createEditor('');
    const { picker, anchor, el } = openMathSearch(editor, '公式');

    const labels = Array.from(el.querySelectorAll<HTMLElement>('.block-picker-label'))
      .map((label) => label.textContent?.replace(/\s+/g, ' ').trim());
    expect(labels).toEqual([
      'Block equation',
      'Inline equation',
      'Block equation · Turn into',
    ]);
    const preview = el.querySelector<HTMLElement>('.block-picker-math-preview')!;
    expect(preview.style.display).not.toBe('none');
    expect(preview.querySelector('.katex')).not.toBeNull();

    picker.close();
    anchor.remove();
    editor.destroy();
  });

  test('inserts an inline equation from selected text', () => {
    const editor = createEditor('alpha beta');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
    const { anchor, el } = openMathSearch(editor);

    rowByText(el, 'Inline equation')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(editor.state.doc.firstChild?.child(0).type.name).toBe('inlineMath');
    expect(editor.state.doc.firstChild?.child(0).attrs.latex).toBe('alpha');
    anchor.remove();
    editor.destroy();
  });

  test('turns the current text block into a block equation without losing its text', () => {
    const editor = createEditor('x^2 + y^2');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));
    const { anchor, el } = openMathSearch(editor, 'latex');

    rowByText(el, 'Turn into')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(editor.state.doc.firstChild?.type.name).toBe('blockMath');
    expect(editor.state.doc.firstChild?.attrs.latex).toBe('x^2 + y^2');
    anchor.remove();
    editor.destroy();
  });
});
