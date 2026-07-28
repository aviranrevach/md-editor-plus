/**
 * @jest-environment jsdom
 */
import {
  selectionPlainText,
  copySelectionAsPlainText,
  copySelectionRich,
} from '../src/webview/copySelection';
import type { Editor } from '@tiptap/core';

// Minimal mock editor exposing only what the helpers touch:
//   editor.state.selection.{from,to}
//   editor.state.doc.textBetween(from, to, blockSep, leafSep)
//   editor.state.schema (omitted so selectionHTML bails to '')
function mockEditor(opts: {
  from: number;
  to: number;
  textBetween?: jest.Mock;
}): { editor: Editor; textBetween: jest.Mock } {
  const textBetween = opts.textBetween ?? jest.fn(() => 'clean text');
  const editor = {
    state: {
      selection: { from: opts.from, to: opts.to },
      doc: { textBetween, slice: jest.fn() },
      schema: undefined,
    },
  } as unknown as Editor;
  return { editor, textBetween };
}

describe('selectionPlainText', () => {
  it('returns textBetween output using paragraph + leaf separators', () => {
    const { editor, textBetween } = mockEditor({ from: 3, to: 17 });
    expect(selectionPlainText(editor)).toBe('clean text');
    expect(textBetween).toHaveBeenCalledWith(3, 17, '\n\n', '\n');
  });

  it('returns empty string for an empty selection without calling textBetween', () => {
    const { editor, textBetween } = mockEditor({ from: 5, to: 5 });
    expect(selectionPlainText(editor)).toBe('');
    expect(textBetween).not.toHaveBeenCalled();
  });
});

describe('copySelectionAsPlainText', () => {
  it('posts a copyText message with the extracted text and toast', () => {
    const { editor } = mockEditor({ from: 0, to: 4, textBetween: jest.fn(() => 'hello') });
    const post = jest.fn();
    copySelectionAsPlainText(editor, post);
    expect(post).toHaveBeenCalledWith({
      type: 'copyText',
      text: 'hello',
      toast: 'Copied as plain text',
    });
  });

  it('does not post when the selection is empty', () => {
    const { editor } = mockEditor({ from: 2, to: 2 });
    const post = jest.fn();
    copySelectionAsPlainText(editor, post);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('copySelectionRich', () => {
  const realClipboard = navigator.clipboard;

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: realClipboard,
      configurable: true,
    });
  });

  it('does not post when the selection is empty', async () => {
    const { editor } = mockEditor({ from: 2, to: 2 });
    const post = jest.fn();
    await copySelectionRich(editor, post);
    expect(post).not.toHaveBeenCalled();
  });

  it('posts a toast-only message when the rich clipboard write succeeds', async () => {
    (globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem =
      class { constructor(public items: unknown) {} };
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: jest.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const { editor } = mockEditor({ from: 0, to: 5, textBetween: jest.fn(() => 'hello') });
    const post = jest.fn();
    await copySelectionRich(editor, post);
    expect(post).toHaveBeenCalledWith({ type: 'toast', text: 'Copied with formatting' });
  });

  it('falls back to a plain-text copyText when rich writing is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const { editor } = mockEditor({ from: 0, to: 5, textBetween: jest.fn(() => 'hello') });
    const post = jest.fn();
    await copySelectionRich(editor, post);
    expect(post).toHaveBeenCalledWith({ type: 'copyText', text: 'hello', toast: 'Copied' });
  });

  it('falls back to plain-text copyText when the rich write rejects', async () => {
    (globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem =
      class { constructor(public items: unknown) {} };
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: jest.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    const { editor } = mockEditor({ from: 0, to: 5, textBetween: jest.fn(() => 'hello') });
    const post = jest.fn();
    await copySelectionRich(editor, post);
    expect(post).toHaveBeenCalledWith({ type: 'copyText', text: 'hello', toast: 'Copied' });
  });
});
