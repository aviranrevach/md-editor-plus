/** @jest-environment jsdom */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Markdown } from 'tiptap-markdown';
import SearchExtension, { getMatches } from '../src/webview/searchExtension';
import { selectionHTML, selectionPlainText } from '../src/webview/copySelection';
import { buildHtmlExport } from '../src/webview/exportHtml';
import {
  BlockMath,
  InlineMath,
  MathShortcuts,
  insertBlockMath,
  insertInlineMath,
} from '../src/webview/extensions/math';

function createEditor(content: string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      InlineMath,
      BlockMath,
      Markdown.configure({ transformCopiedText: true }),
      MathShortcuts,
      SearchExtension,
    ],
    content,
  });
}

function mathNodes(editor: Editor): Array<{ type: string; attrs: Record<string, string> }> {
  const nodes: Array<{ type: string; attrs: Record<string, string> }> = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'inlineMath' || node.type.name === 'blockMath') {
      nodes.push({ type: node.type.name, attrs: node.attrs as Record<string, string> });
    }
  });
  return nodes;
}

describe('math markdown parsing and round-trip', () => {
  test.each([
    ['before $x^2$ after', '$', 'x^2'],
    ['before $$x+1$$ after', '$$', 'x+1'],
    ['before \\(x+y\\) after', '\\(', 'x+y'],
  ])('parses inline source %s', (source, delimiter, latex) => {
    const editor = createEditor(source);
    expect(mathNodes(editor)).toEqual([{ type: 'inlineMath', attrs: { latex, delimiter } }]);
    expect(editor.storage.markdown.getMarkdown()).toContain(source);
    editor.destroy();
  });

  test.each([
    ['$$\n\\frac{a}{b}\n$$', '$$', '\\frac{a}{b}'],
    ['\\[\nE = mc^2\n\\]', '\\[', 'E = mc^2'],
  ])('parses block source and keeps its delimiter', (source, delimiter, latex) => {
    const editor = createEditor(source);
    expect(mathNodes(editor)).toEqual([{
      type: 'blockMath',
      attrs: { latex, delimiter, equationNumber: '' },
    }]);
    const once = editor.storage.markdown.getMarkdown() as string;
    editor.destroy();
    const again = createEditor(once);
    expect(again.storage.markdown.getMarkdown()).toBe(once);
    expect(mathNodes(again)[0].attrs.delimiter).toBe(delimiter);
    again.destroy();
  });

  test('does not parse math delimiters inside inline or fenced code', () => {
    const source = ['`$inline$`', '', '```text', '$fenced$', '```'].join('\n');
    const editor = createEditor(source);
    expect(mathNodes(editor)).toHaveLength(0);
    editor.destroy();
  });

  test('renders mhchem commands locally through KaTeX', () => {
    const editor = createEditor('Chemistry: $\\ce{H2O}$ and $\\pu{1.23 kg}$');
    expect(editor.view.dom.querySelectorAll('.katex')).toHaveLength(2);
    expect(editor.view.dom.querySelectorAll('.math-render-error')).toHaveLength(0);
    expect(editor.view.dom.textContent).toContain('H');
    editor.destroy();
  });

  test('keeps KaTeX trust disabled for document-provided commands', () => {
    const editor = createEditor('$\\href{javascript:alert(1)}{unsafe}$');
    expect(editor.view.dom.querySelector('a[href^="javascript:"]')).toBeNull();
    editor.destroy();
  });
});

describe('inline equation insertion', () => {
  test('turns a typed $$...$$ shortcut into an inline equation', () => {
    const editor = createEditor('');
    const pos = editor.state.selection.from;
    const handled = editor.view.someProp('handleTextInput', (handler) =>
      handler(editor.view, pos, pos, '$$x + y$$', () => editor.state.tr.insertText('$$x + y$$', pos)),
    );
    expect(handled).toBe(true);
    expect(mathNodes(editor)[0]).toEqual({
      type: 'inlineMath',
      attrs: { latex: 'x + y', delimiter: '$$' },
    });
    editor.destroy();
  });

  test('converts selected text and serializes it as markdown', () => {
    const editor = createEditor('alpha + beta');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
    expect(insertInlineMath(editor)).toBe(true);
    expect(mathNodes(editor)[0]).toEqual({
      type: 'inlineMath',
      attrs: { latex: 'alpha', delimiter: '$' },
    });
    expect(editor.storage.markdown.getMarkdown()).toContain('$alpha$');
    editor.destroy();
  });

  test('converts an inline equation into a block without losing surrounding text', () => {
    const editor = createEditor('before $x$ after');
    const button = Array.from(editor.view.dom.querySelectorAll<HTMLButtonElement>('.math-inline-actions button'))
      .find((item) => item.textContent === 'Make block')!;
    button.click();
    expect(Array.from({ length: editor.state.doc.childCount }, (_, i) => editor.state.doc.child(i).type.name))
      .toEqual(['paragraph', 'blockMath', 'paragraph']);
    expect(editor.state.doc.child(0).textContent).toBe('before ');
    expect(editor.state.doc.child(2).textContent).toBe(' after');
    editor.destroy();
  });
});

describe('block equation insertion', () => {
  test('replaces an empty slash-command paragraph with a block equation', () => {
    const editor = createEditor('');
    expect(insertBlockMath(editor, editor.state.selection.from, 'x = 1')).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.type.name).toBe('blockMath');
    expect(editor.storage.markdown.getMarkdown()).toContain('x = 1');
    editor.destroy();
  });
});

describe('equation search', () => {
  test('finds LaTeX stored in math atom attributes', () => {
    const editor = createEditor('$$\n\\frac{alpha}{beta}\n$$');
    editor.commands.setSearchTerm('alpha');
    const matches = getMatches(editor.state);
    expect(matches).toHaveLength(1);
    expect(matches[0].node).toBe(true);
    expect(editor.view.dom.querySelector('.math-block.search-match')).not.toBeNull();
    editor.destroy();
  });
});

describe('equation copy, export, and read-only rendering', () => {
  test('copies an inline atom as source text and rendered KaTeX HTML', () => {
    const editor = createEditor('before $x^2$ after');
    let mathPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'inlineMath') mathPos = pos;
    });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, mathPos)));
    expect(selectionPlainText(editor)).toBe('$x^2$');
    expect(selectionHTML(editor)).toContain('class="katex"');
    editor.destroy();
  });

  test('exports rendered math without its editing controls', () => {
    const editor = createEditor('$$\nE = mc^2\n$$');
    const html = buildHtmlExport(editor.view.dom as HTMLElement, {
      filename: 'math.md',
      themeClasses: [],
      editorClasses: [],
      pageWidthPx: 800,
      fullWidth: false,
    });
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('math-block-source');
    expect(html).not.toContain('<textarea');
    editor.destroy();
  });

  test('does not open the source editor in read-only mode', () => {
    const editor = createEditor('$x$');
    editor.setEditable(false);
    const preview = editor.view.dom.querySelector<HTMLElement>('.math-inline-preview')!;
    preview.dispatchEvent(new MouseEvent('mousedown'));
    expect(editor.view.dom.querySelector('.math-inline')?.classList.contains('math-editing')).toBe(false);
    editor.destroy();
  });
});
