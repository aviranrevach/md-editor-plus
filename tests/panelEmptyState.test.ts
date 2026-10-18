/**
 * @jest-environment jsdom
 *
 * c25 — the card side panel drew TWO empty-state hints in the same blank space:
 * its own "Add a description to this card…" overlay PLUS the editor's generic
 * "Start writing, or press / for commands", stacked on top of each other.
 *
 * c50 fixed this once by suppressing `EmptyPlaceholder` for the panel's detached
 * editor. c51 then added ClickBelowContent, which renders the SAME
 * PLACEHOLDER_TEXT as a hover ghost and was NOT covered by that suppression —
 * so the clash came back through a second door. The click-to-add-a-block
 * behaviour must stay on in the panel; only its hint is dropped.
 */
jest.mock('lowlight', () => ({
  common: {},
  createLowlight: () => ({
    listLanguages: () => ['markdown'],
    highlight: () => ({ children: [] }),
    highlightAuto: () => ({ children: [] }),
    registered: () => false,
  }),
}));
jest.mock('mermaid', () => ({ default: {}, initialize: () => {}, render: async () => ({ svg: '' }) }));

import { createDetachedEditor, createEditor, destroyEditor, getEditor } from '../src/webview/editor';
import { PLACEHOLDER_TEXT } from '../src/webview/extensions/emptyPlaceholder';

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function hintOption(editor: { extensionManager: { extensions: { name: string; options?: unknown }[] } }): unknown {
  const ext = editor.extensionManager.extensions.find((e) => e.name === 'clickBelowContent');
  return (ext?.options as { showHint?: boolean } | undefined)?.showHint;
}

afterEach(() => {
  destroyEditor();
  document.body.innerHTML = '';
});

describe('card panel description editor — one empty state only (c25)', () => {
  it('renders NO generic placeholder text for an empty description', () => {
    const el = host();
    const sub = createDetachedEditor(el, '', () => {});
    expect(el.innerHTML).not.toContain(PLACEHOLDER_TEXT);
    expect(el.querySelector('[data-placeholder]')).toBeNull();
    expect(el.querySelector('.pm-below-hint')).toBeNull();
    sub.destroy();
  });

  it('drops the EmptyPlaceholder extension entirely (c50)', () => {
    const el = host();
    const sub = createDetachedEditor(el, '', () => {});
    const names = sub.editor.extensionManager.extensions.map((e) => e.name);
    expect(names).not.toContain('emptyPlaceholder');
    sub.destroy();
  });

  it('KEEPS click-below-to-add-a-block, with only its hint turned off (c25)', () => {
    const el = host();
    const sub = createDetachedEditor(el, '', () => {});
    const names = sub.editor.extensionManager.extensions.map((e) => e.name);
    expect(names).toContain('clickBelowContent');   // behaviour stays
    expect(hintOption(sub.editor)).toBe(false);      // ghost text does not
    sub.destroy();
  });
});

describe('main document editor — keeps its empty state', () => {
  it('still shows the generic placeholder on an empty doc', () => {
    const el = host();
    createEditor(el, '', () => {});
    expect(el.querySelector('[data-placeholder]')?.getAttribute('data-placeholder')).toBe(PLACEHOLDER_TEXT);
  });

  it('still has EmptyPlaceholder and an ENABLED below-content hint', () => {
    const el = host();
    createEditor(el, '', () => {});
    const editor = getEditor()!;
    const names = editor.extensionManager.extensions.map((e) => e.name);
    expect(names).toContain('emptyPlaceholder');
    expect(hintOption(editor)).toBe(true);
  });
});
