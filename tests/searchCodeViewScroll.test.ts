/**
 * @jest-environment jsdom
 */
import { Editor } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import { Text } from '@tiptap/extension-text';
import { HardBreak } from '@tiptap/extension-hard-break';
import CodeBlock from '../src/webview/extensions/codeBlock';
import SearchExtension from '../src/webview/searchExtension';

// c58: find-in-page updates the match counter in Code view but never scrolls
// to the match. Code view's document is one giant codeBlock node (editor.ts
// buildSourceContent) reusing the CodeBlock NodeView. revealAndScroll()
// (searchExtension.ts) now defers its scrollIntoView() call to the next
// animation frame so it runs after the NodeView's gutter MutationObserver (a
// microtask queued by the decoration DOM update) has settled.
//
// The real `lowlight` package is ESM-only and Jest can't parse it (see
// tests/__mocks__/editorMock.js). Stub just enough of its interface for
// @tiptap/extension-code-block-lowlight to run with zero highlight decorations.
jest.mock('lowlight', () => ({
  common: {},
  createLowlight: () => ({
    listLanguages: () => ['markdown'],
    highlight: () => ({ children: [] }),
    highlightAuto: () => ({ children: [] }),
    registered: () => false,
  }),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createLowlight, common } = require('lowlight');

const lowlight = createLowlight(common);
const SourceDocument = Document.extend({ content: 'codeBlock' });

function flushRaf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('find-in-page scroll inside the Code view codeBlock (c58)', () => {
  it('scrolls the active match into view once the deferred frame runs', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const bigMarkdown = Array.from({ length: 200 }, (_, i) => `line ${i} needle-marker-here`).join('\n');

    const editor = new Editor({
      element: el,
      extensions: [
        SourceDocument,
        Text,
        HardBreak,
        CodeBlock.configure({ lowlight, defaultLanguage: 'markdown' }),
        SearchExtension,
      ],
      content: {
        type: 'doc',
        content: [{ type: 'codeBlock', attrs: { language: 'markdown' }, content: [{ type: 'text', text: bigMarkdown }] }],
      },
    });

    const scrollSpy = jest.fn();
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollSpy;

    editor.commands.setSearchTerm('needle-marker-here');
    editor.commands.setActiveMatch(3);

    // Not yet — the scroll is deferred to the next frame.
    expect(scrollSpy).not.toHaveBeenCalled();

    await flushRaf();

    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});
