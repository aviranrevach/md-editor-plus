import type { Editor } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';

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
 * HTML of the current selection, with marks (bold, links, colour…) preserved.
 * Returns '' for an empty selection or when the schema can't be serialised.
 */
export function selectionHTML(editor: Editor): string {
  const { state } = editor;
  const { from, to } = state.selection;
  if (from === to || !state.schema) return '';
  try {
    const slice = state.doc.slice(from, to);
    const fragment = DOMSerializer.fromSchema(state.schema).serializeFragment(slice.content);
    const div = document.createElement('div');
    div.appendChild(fragment);
    return div.innerHTML;
  } catch {
    return '';
  }
}

/**
 * Copy the current selection as plain text via the host clipboard.
 * No-op when the selection is empty.
 */
export function copySelectionAsPlainText(editor: Editor, post: Poster): void {
  const text = selectionPlainText(editor);
  if (!text) return;
  post({ type: 'copyText', text, toast: 'Copied as plain text' });
}

/** Write rich + plain flavours to the clipboard from the webview. */
async function writeRich(html: string, text: string): Promise<boolean> {
  try {
    const clip = navigator.clipboard as Clipboard | undefined;
    if (clip && typeof clip.write === 'function' && typeof ClipboardItem !== 'undefined') {
      await clip.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch { /* fall through to plain-text copy */ }
  return false;
}

/**
 * Copy the current selection with its formatting preserved, so rich targets
 * (docs, mail) keep bold, links and colours. Falls back to a plain-text copy
 * through the host if the browser can't write rich clipboard data.
 * No-op when the selection is empty.
 */
export async function copySelectionRich(editor: Editor, post: Poster): Promise<void> {
  const text = selectionPlainText(editor);
  if (!text) return;
  const html = selectionHTML(editor);
  const ok = await writeRich(html, text);
  if (ok) post({ type: 'toast', text: 'Copied with formatting' });
  else post({ type: 'copyText', text, toast: 'Copied' });
}
