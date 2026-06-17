import { selectionPlainText, copySelectionAsPlainText } from '../src/webview/copyPlainText';
import type { Editor } from '@tiptap/core';

// Minimal mock editor exposing only what the helper touches:
//   editor.state.selection.{from,to}
//   editor.state.doc.textBetween(from, to, blockSep, leafSep)
function mockEditor(opts: {
  from: number;
  to: number;
  textBetween?: jest.Mock;
}): { editor: Editor; textBetween: jest.Mock } {
  const textBetween = opts.textBetween ?? jest.fn(() => 'clean text');
  const editor = {
    state: {
      selection: { from: opts.from, to: opts.to },
      doc: { textBetween },
    },
  } as unknown as Editor;
  return { editor, textBetween };
}

describe('selectionPlainText', () => {
  it('returns textBetween output using paragraph + leaf separators', () => {
    const { editor, textBetween } = mockEditor({ from: 3, to: 17 });
    const result = selectionPlainText(editor);
    expect(result).toBe('clean text');
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
