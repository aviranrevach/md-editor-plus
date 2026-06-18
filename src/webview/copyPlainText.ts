import type { Editor } from '@tiptap/core';

export type Poster = (msg: unknown) => void;

/**
 * Visible text of the current selection — no marks, no markdown, no HTML.
 * Paragraph breaks between block nodes; single newline for leaf breaks.
 * Returns '' for an empty (collapsed) selection.
 */
export function selectionPlainText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  if (from === to) return '';
  return editor.state.doc.textBetween(from, to, '\n\n', '\n');
}

/**
 * Extract the current selection as plain text and ask the host to copy it.
 * No-op when the selection is empty.
 */
export function copySelectionAsPlainText(editor: Editor, post: Poster): void {
  const text = selectionPlainText(editor);
  if (!text) return;
  post({ type: 'copyText', text, toast: 'Copied as plain text' });
}
