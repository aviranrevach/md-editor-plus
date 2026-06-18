# Copy as Plain Text (C23) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Copy as plain text" button to the selection bubble toolbar that copies the highlighted text as pure visible words — no color spans, no markdown markers, no tags.

**Architecture:** A small pure helper (`copyPlainText.ts`) extracts the selection's visible text via ProseMirror's `doc.textBetween` and posts a `copyText` message to the extension host, which writes it to the system clipboard. The bubble menu (`bubbleMenu.ts`) gets one new button wired to that helper. The host's existing `copyText` handler is generalized so its confirmation toast is caller-supplied.

**Tech Stack:** TypeScript, tiptap/ProseMirror, VS Code webview ↔ extension messaging, Jest + ts-jest (jsdom), esbuild.

## Global Constraints

- Work in the worktree at `.claude/worktrees/feat+copy-as-plain-text-c23/` on branch `feat/copy-as-plain-text-c23`. All paths below are relative to that worktree root.
- Default copy behavior (native Cmd/Ctrl+C) MUST remain unchanged.
- Plain text means **visible characters only** — no marks, no `**`/`_` markdown, no HTML.
- Block separator `'\n\n'`, leaf separator `'\n'` for `textBetween`.
- Button placement: **top row** of the bubble menu, immediately after the inline-code button.
- Toast on success: exact string **`Copied as plain text`**.
- The real tiptap `Editor` is NOT loadable under Jest (lowlight is ESM-only). Tests use hand-built mock editors, matching `tests/mermaid/whiteboard-insert.test.ts`.
- Reuse the webview→host messaging global `window.__mdViewerVscode.postMessage` (see `bubbleMenu.ts:563-567`).

---

### Task 1: Plain-text extraction helper + copy dispatch

**Files:**
- Create: `src/webview/copyPlainText.ts`
- Test: `tests/copyPlainText.test.ts`

**Interfaces:**
- Consumes: a tiptap `Editor` (only `editor.state.selection.{from,to}` and `editor.state.doc.textBetween`), and a `Poster` callback `(msg: unknown) => void`.
- Produces:
  - `selectionPlainText(editor: Editor): string` — visible text of the current selection; `''` when the selection is empty.
  - `copySelectionAsPlainText(editor: Editor, post: Poster): void` — extracts the text and, if non-empty, calls `post({ type: 'copyText', text, toast: 'Copied as plain text' })`. No-op on empty selection.
  - `type Poster = (msg: unknown) => void`

- [ ] **Step 1: Write the failing test**

Create `tests/copyPlainText.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/copyPlainText.test.ts`
Expected: FAIL — `Cannot find module '../src/webview/copyPlainText'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/webview/copyPlainText.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/copyPlainText.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/webview/copyPlainText.ts tests/copyPlainText.test.ts
git commit -m "feat(c23): plain-text selection extraction + copy dispatch helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Caller-supplied toast on the host copyText handler

**Files:**
- Modify: `src/mdEditorPlusProvider.ts:373-378`

**Interfaces:**
- Consumes: `copyText` messages now optionally carrying `toast?: string`.
- Produces: the host writes `msg.text` to the clipboard and shows `msg.toast ?? 'Copied to clipboard'`. (The AI-prompt caller currently relies on the old hardcoded message; this task updates that caller to keep its wording — see Step 3.)

- [ ] **Step 1: Read the current handler**

Run: `sed -n '373,379p' src/mdEditorPlusProvider.ts`
Expected: shows the `copyText` branch writing `text` and showing the hardcoded `'AI prompt copied to clipboard'`.

- [ ] **Step 2: Generalize the toast**

Replace the body of the `copyText` branch (currently lines ~373-378):

```ts
      if (msg.type === 'copyText') {
        const text = (msg as unknown as { text?: unknown }).text;
        if (typeof text !== 'string') return;
        await vscode.env.clipboard.writeText(text);
        await vscode.window.showInformationMessage('AI prompt copied to clipboard');
        return;
```

with:

```ts
      if (msg.type === 'copyText') {
        const { text, toast } = msg as unknown as { text?: unknown; toast?: unknown };
        if (typeof text !== 'string') return;
        await vscode.env.clipboard.writeText(text);
        const note = typeof toast === 'string' && toast.length > 0 ? toast : 'Copied to clipboard';
        await vscode.window.showInformationMessage(note);
        return;
```

- [ ] **Step 3: Preserve the AI-prompt caller's wording**

The existing AI-prompt copy caller must keep saying "AI prompt copied to clipboard". Find who posts `copyText` today:

Run: `grep -rn "type: 'copyText'\|type:\"copyText\"" src/webview`
Expected: one caller (the AI prompt copy path).

Edit that caller to pass an explicit toast so its message is unchanged. Change its payload from:

```ts
{ type: 'copyText', text: <existingText> }
```

to:

```ts
{ type: 'copyText', text: <existingText>, toast: 'AI prompt copied to clipboard' }
```

(Use the caller's existing text expression verbatim — only add the `toast` field.)

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no new errors from `mdEditorPlusProvider.ts` or the edited caller.

- [ ] **Step 5: Commit**

```bash
git add src/mdEditorPlusProvider.ts src/webview
git commit -m "feat(c23): caller-supplied toast on host copyText handler

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire the "Copy as plain text" button into the bubble menu

**Files:**
- Modify: `src/webview/extensions/codeBlock.ts:10` (export the existing copy icon)
- Modify: `src/webview/bubbleMenu.ts` (import helper + icon, add button, add dispatch case)

**Interfaces:**
- Consumes: `copySelectionAsPlainText` and `Poster` from `./copyPlainText` (Task 1); `COPY_ICON_SVG` from `./extensions/codeBlock`.
- Produces: a clickable `[data-action="copy-plain"]` button on the bubble menu's first row.

- [ ] **Step 1: Export the existing copy icon for reuse**

In `src/webview/extensions/codeBlock.ts`, the icon is currently declared as a module-local const at line 10:

```ts
const COPY_ICON_SVG = `<svg ...>...</svg>`;
```

Add the `export` keyword:

```ts
export const COPY_ICON_SVG = `<svg ...>...</svg>`;
```

(Leave the rest of the line — the SVG markup — exactly as-is.)

- [ ] **Step 2: Import the helper and icon in `bubbleMenu.ts`**

At the top of `src/webview/bubbleMenu.ts`, alongside the existing imports (after `import { getDocumentPath } from './docContext';`), add:

```ts
import { copySelectionAsPlainText } from './copyPlainText';
import { COPY_ICON_SVG } from './extensions/codeBlock';
```

- [ ] **Step 3: Add the button to the first bubble row**

In `buildEl()`, the first `.bubble-row` currently ends with the code button (around line 191):

```ts
      <button class="bm-btn" data-action="code" data-tip-html="Inline code<kbd>⌘E</kbd>">${svg(P.code)}</button>
    </div>
```

Add the new button immediately after the code button, before the row's closing `</div>`:

```ts
      <button class="bm-btn" data-action="code" data-tip-html="Inline code<kbd>⌘E</kbd>">${svg(P.code)}</button>
      <button class="bm-btn bm-copy-plain" data-action="copy-plain" data-tip="Copy as plain text">${COPY_ICON_SVG}</button>
    </div>
```

Note: `COPY_ICON_SVG` is a stroke-style icon (`fill="none" stroke="currentColor"`). The bubble menu's `.bm-btn svg { fill: currentColor }` rule would override the `fill="none"` attribute and fill the shape. Prevent that with a scoped inline style on the button's svg by adding this CSS next to the other bubble-menu rules (search for the selector `.bm-btn svg` and add immediately after it):

```css
.bm-copy-plain svg { fill: none; stroke: currentColor; }
```

If the `.bm-btn svg` rule lives in a `.ts`-embedded style string, add the override in the same block. Run `grep -rn "\.bm-btn svg" src/webview` to locate it.

- [ ] **Step 4: Add the dispatch case**

In the main `mousedown` action switch (around line 691, `switch (btn.dataset.action) { ... }`), add a new case after `case 'code':`:

```ts
      case 'code':      editor.chain().focus().toggleCode().run();      break;
      case 'copy-plain': {
        const vs = (window as unknown as {
          __mdViewerVscode?: { postMessage: (m: unknown) => void };
        }).__mdViewerVscode;
        if (vs) copySelectionAsPlainText(editor, (m) => vs.postMessage(m));
        break;
      }
```

- [ ] **Step 5: Type-check and run the full webview test suite**

Run: `npx tsc -p tsconfig.json --noEmit && npx jest tests/copyPlainText.test.ts`
Expected: no new type errors; copyPlainText tests still PASS.

- [ ] **Step 6: Build the webview bundle**

Run: `npm run compile`
Expected: `tsc` clean and esbuild completes without errors.

- [ ] **Step 7: Commit**

```bash
git add src/webview/bubbleMenu.ts src/webview/extensions/codeBlock.ts
git commit -m "feat(c23): add Copy as plain text button to selection toolbar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Manual verification in the real app

**Files:** none (manual).

- [ ] **Step 1: Launch the extension**

Open the worktree in VS Code and run the extension (F5 / Extension Development Host), or follow the project's run skill.

- [ ] **Step 2: Verify clean plain-text copy**

In a markdown doc, apply a text color to some words, then highlight that text. The bubble toolbar appears. Click the new clipboard button on the top row (tooltip "Copy as plain text"). Paste into a plain destination (e.g. a terminal or a plain text field).
Expected: only the visible characters appear — NO `<span style="color: …">` tags, NO `**`/`_` markers. A toast reads **"Copied as plain text"**.

- [ ] **Step 3: Verify multi-paragraph separators**

Select across two paragraphs and copy as plain text. Paste.
Expected: the two paragraphs are separated by a blank line, no markup.

- [ ] **Step 4: Verify default copy is unchanged**

Select styled text and press Cmd/Ctrl+C (native copy), paste into a rich editor.
Expected: formatting preserved as before — this feature did not change native copy.

- [ ] **Step 5: Confirm done**

All four checks pass → C23 is complete.

---

## Self-Review

**Spec coverage:**
- "Copy as plain text" button in selection toolbar → Task 3.
- Top-row placement after Code → Task 3 Step 3 + Global Constraints.
- Extract visible text via `textBetween('\n\n','\n')` → Task 1.
- Empty-selection guard (no-op) → Task 1 (`selectionPlainText` returns `''`, copy is no-op).
- Reuse existing `copyText` clipboard path → Task 1 payload + Task 2 host handler.
- Parameterized toast "Copied as plain text" → Task 1 + Task 2.
- Default copy untouched → no native-copy code modified; verified in Task 4 Step 4.
- Icon (open item) → reused `COPY_ICON_SVG`; tooltip "Copy as plain text".
- Tests → Task 1 (`tests/copyPlainText.test.ts`) + Task 4 manual.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows full code. Icon glyph resolved by reusing `COPY_ICON_SVG`. The one open spec item (menu stays open vs. dismiss after copy) is intentionally left as the current behavior: the `copy-plain` case does not open any panel and `updateActive()` runs as for other buttons, so the menu behaves like the formatting buttons — no extra handling needed.

**Type consistency:** `selectionPlainText` / `copySelectionAsPlainText` / `Poster` names and signatures match between Task 1 definition and Task 3 usage. The `copyText` payload shape (`{ type, text, toast }`) matches between Task 1 (producer) and Task 2 (consumer).
