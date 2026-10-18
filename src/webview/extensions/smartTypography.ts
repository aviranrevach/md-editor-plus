import { Extension, InputRule } from '@tiptap/core';

// Smart typography: Notion-style replacements as you type.
//
// Rule order matters. ProseMirror runs input rules in array order and applies
// the FIRST match, so any multi-character trigger that ends in the same
// character as a shorter trigger must come first:
//   - `<=>` before `=>`  (both complete on `>`)
//   - `<->` before `->`  (literal "<->" ends in "->")
// `<-` auto-converts to ← the instant `-` is typed, before the closing `>` can
// be entered. So `<->` typed live arrives as "←>" — the `←>` rule completes it
// to ↔. (The literal `<->` rule is kept as a belt-and-suspenders for buffers
// that arrive whole, e.g. programmatic input.)
export interface SmartTypographyRule {
  find: RegExp;
  replace: string;
}

export const SMART_TYPOGRAPHY_RULES: SmartTypographyRule[] = [
  { find: /<=>$/, replace: '⇔' },
  { find: /<->$/, replace: '↔' },
  { find: /←>$/,  replace: '↔' },
  { find: /->$/,  replace: '→' },
  { find: /<-$/,  replace: '←' },
  { find: /=>$/,  replace: '⇒' },
  { find: /--$/,  replace: '—' },
  { find: /\.\.\.$/, replace: '…' },
  // Symbol shortcuts. Anchored at end only (no word boundary) — intentional:
  // mid-token like "foo(r)" → "foo®" is desired and reversible via Backspace.
  { find: /\(c\)$/i,  replace: '©' },
  { find: /\(r\)$/i,  replace: '®' },
  { find: /\(tm\)$/i, replace: '™' },
];

export interface SmartTypographyMatch {
  matchLength: number;
  replacement: string;
}

/**
 * Given the text immediately before the cursor, return the first matching
 * smart-typography replacement, or null. Pure — no editor/DOM dependency.
 */
export function findSmartTypographyMatch(textBefore: string): SmartTypographyMatch | null {
  for (const rule of SMART_TYPOGRAPHY_RULES) {
    const m = rule.find.exec(textBefore);
    if (m) return { matchLength: m[0].length, replacement: rule.replace };
  }
  return null;
}

// Module-level flag so the Visual-settings toggle can enable/disable replacement
// at runtime without re-creating the editor. When off, every rule no-ops.
let smartTypographyEnabled = true;

export function setSmartTypographyEnabled(on: boolean): void {
  smartTypographyEnabled = on;
}

// ---------------------------------------------------------------------------
// Plain-DOM surfaces (board table cells, card titles, field rename, etc.)
//
// These are <input>/<textarea> or bare contenteditable elements — NOT Tiptap
// editors — so the InputRule above never fires there. attachSmartTypography
// reuses the same rules on a plain element by listening for `input` and
// rewriting the text just before the caret. Returns a detach function.
// ---------------------------------------------------------------------------

function applyToInput(el: HTMLInputElement | HTMLTextAreaElement): void {
  const caret = el.selectionStart;
  // Only act on a collapsed caret (no selection range to clobber).
  if (caret === null || caret !== el.selectionEnd) return;
  const match = findSmartTypographyMatch(el.value.slice(0, caret));
  if (!match) return;
  const start = caret - match.matchLength;
  el.value = el.value.slice(0, start) + match.replacement + el.value.slice(caret);
  const pos = start + match.replacement.length;
  el.setSelectionRange(pos, pos);
}

function applyToContentEditable(root: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
  const node = sel.focusNode;
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return;
  const offset = sel.focusOffset;
  const text = node.textContent ?? '';
  const match = findSmartTypographyMatch(text.slice(0, offset));
  if (!match) return;
  const start = offset - match.matchLength;
  node.textContent = text.slice(0, start) + match.replacement + text.slice(offset);
  const pos = start + match.replacement.length;
  const range = document.createRange();
  range.setStart(node, pos);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function attachSmartTypography(el: HTMLElement): () => void {
  const handler = (): void => {
    if (!smartTypographyEnabled) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      applyToInput(el);
    } else {
      applyToContentEditable(el);
    }
  };
  el.addEventListener('input', handler);
  return () => el.removeEventListener('input', handler);
}

export const SmartTypography = Extension.create({
  name: 'smartTypography',

  addInputRules() {
    // Code BLOCKS are skipped automatically: ProseMirror's inputRules plugin
    // bails when the cursor's parent node spec has `code: true`. Inline `code`
    // is a MARK (parent is still a paragraph), so we guard that case manually.
    return SMART_TYPOGRAPHY_RULES.map(
      (rule) =>
        new InputRule({
          find: rule.find,
          handler: ({ state, range }) => {
            // Return null (not bare return) so Tiptap treats this as a no-op and does not dispatch.
            if (!smartTypographyEnabled) return null;

            const codeMark = state.schema.marks.code;
            if (codeMark) {
              const $from = state.doc.resolve(range.from);
              const marksHere = state.storedMarks ?? $from.marks();
              // Return null (not bare return) so Tiptap treats this as a no-op and does not dispatch.
              if (codeMark.isInSet(marksHere)) return null;
            }

            state.tr.insertText(rule.replace, range.from, range.to);
            return undefined;
          },
        }),
    );
  },
});

export default SmartTypography;
