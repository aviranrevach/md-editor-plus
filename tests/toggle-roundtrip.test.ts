/**
 * @jest-environment jsdom
 *
 * Full markdown round-trip tests for toggles (<details>/<summary>).
 *
 * These exercise the real tiptap-markdown pipeline (markdown-it -> DOM ->
 * ProseMirror -> markdown) the same way the editor does, rather than the
 * pure-function helpers in toggle.test.ts. They guard the round-trip-stability
 * bugs that corrupted demo-tester.md:
 *   1. <summary> text leaking into the toggle body ("ToggleToggleToggle…")
 *   2. a trailing `---` getting absorbed into the toggle's HTML block and
 *      backslash-escaped, doubling every save (\\\\---)
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import Toggle from '../src/webview/extensions/toggle';

function roundTrip(markdown: string): string {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Markdown.configure({ transformCopiedText: true }),
      Toggle,
    ],
    content: markdown,
  });
  const out = editor.storage.markdown.getMarkdown() as string;
  editor.destroy();
  return out;
}

const TOGGLE = [
  '<details>',
  '<summary>Toggle</summary>',
  '',
  'How does the bubble menu decide where to appear?',
  '',
  '</details>',
].join('\n');

describe('toggle markdown round-trip', () => {
  it('does not leak the summary text into the body', () => {
    const once = roundTrip(TOGGLE);
    // The body must keep its real text and must NOT be prefixed with the
    // summary label.
    expect(once).toContain('How does the bubble menu decide where to appear?');
    expect(once).not.toMatch(/ToggleToggle/);
  });

  it('is idempotent across repeated saves (no summary growth)', () => {
    let md = TOGGLE;
    for (let i = 0; i < 5; i++) md = roundTrip(md);
    expect(md).not.toMatch(/ToggleToggle/);
    // Exactly one summary survives.
    const summaries = md.match(/<summary>/g) ?? [];
    expect(summaries).toHaveLength(1);
  });

  it('does not accumulate backslashes on a following horizontal rule', () => {
    let md = [TOGGLE, '', '---', ''].join('\n');
    for (let i = 0; i < 5; i++) md = roundTrip(md);
    // No runaway backslash wall.
    expect(md).not.toMatch(/\\\\/);
    // The horizontal rule still round-trips as a rule, not escaped text.
    expect(md).toMatch(/^(---|\*\*\*|___)$/m);
  });
});
