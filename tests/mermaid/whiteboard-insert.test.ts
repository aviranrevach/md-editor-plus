/**
 * @jest-environment jsdom
 */
// Tests for the slash-menu Whiteboard insert action.
// Uses a hand-built mock editor — the real tiptap editor isn't loadable in jest
// because lowlight is ESM-only and editor.ts is stubbed via the editorMock.

import { insertWhiteboard, freshWhiteboardSource } from '../../src/webview/blockPicker';

type InsertedContent = ReadonlyArray<unknown>;

// Build a minimal mock editor exposing the surface insertWhiteboard touches:
//   editor.chain().focus().insertContentAt(pos, content).run()
//   editor.view.nodeDOM(pos)
function buildMockEditor(opts: { nodeDom?: HTMLElement | null } = {}) {
  const calls: { pos: number; content: InsertedContent }[] = [];
  const chain = {
    focus() { return this; },
    insertContentAt(pos: number, content: InsertedContent) {
      calls.push({ pos, content });
      return this;
    },
    run() { return true; },
  };
  const view = {
    nodeDOM: jest.fn((_pos: number) => opts.nodeDom ?? null),
  };
  return {
    editor: {
      chain: () => chain,
      view,
    } as unknown as import('@tiptap/core').Editor,
    calls,
    view,
  };
}

// Synchronously fire requestAnimationFrame so we don't need fake timers.
beforeEach(() => {
  (global as { requestAnimationFrame: (cb: FrameRequestCallback) => number })
    .requestAnimationFrame = (cb) => { cb(0); return 0; };
});

describe('insertWhiteboard', () => {
  it('inserts a codeBlock(mermaid) + paragraph at the given position', () => {
    const { editor, calls } = buildMockEditor();
    insertWhiteboard(editor, 42);
    expect(calls).toHaveLength(1);
    expect(calls[0].pos).toBe(42);
    expect(calls[0].content).toEqual([
      {
        type: 'codeBlock',
        attrs: { language: 'mermaid' },
        content: [{ type: 'text', text: freshWhiteboardSource() }],
      },
      { type: 'paragraph' },
    ]);
  });

  it('looks up the inserted block DOM via editor.view.nodeDOM(pos)', () => {
    const { editor, view } = buildMockEditor();
    insertWhiteboard(editor, 42);
    expect(view.nodeDOM).toHaveBeenCalledTimes(1);
    expect(view.nodeDOM).toHaveBeenCalledWith(42);
  });

  it('invokes __mbOpenVisualMode on the returned DOM element', () => {
    const open = jest.fn();
    const dom = Object.assign(document.createElement('div'), { __mbOpenVisualMode: open });
    const { editor } = buildMockEditor({ nodeDom: dom });
    insertWhiteboard(editor, 42);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('is a safe no-op when nodeDOM returns null (no throw)', () => {
    const { editor } = buildMockEditor({ nodeDom: null });
    expect(() => insertWhiteboard(editor, 42)).not.toThrow();
  });

  it('is a safe no-op when the DOM has no __mbOpenVisualMode hook (no throw)', () => {
    const dom = document.createElement('div');
    const { editor } = buildMockEditor({ nodeDom: dom });
    expect(() => insertWhiteboard(editor, 42)).not.toThrow();
  });
});
