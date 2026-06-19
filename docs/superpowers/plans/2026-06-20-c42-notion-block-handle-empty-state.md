# c42 — Notion-style Block Handle, First-line Alignment & Empty-state Hint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the block gutter handle (＋ and drag grip) look and behave like Notion, align it to each block's first line, and add an empty-state placeholder hint plus a plain-`/` trigger that opens the block picker.

**Architecture:** Three independent surfaces. (1) The handle is augmented imperatively in [src/webview/blockHandle.ts](../../../src/webview/blockHandle.ts) — we swap text glyphs for SVG icons and restyle in CSS. (2) First-line alignment is a CSS-only adjustment to `.drag-handle`. (3) The empty-state hint is a new TipTap `Extension` adding a ProseMirror node decoration (modeled on the existing [src/webview/extensions/blockDirection.ts](../../../src/webview/extensions/blockDirection.ts)), rendered via CSS `::before`; the `/` trigger extends the existing keydown handler in `blockHandle.ts`.

**Tech Stack:** TypeScript, TipTap v2 (`@tiptap/core`), ProseMirror (`@tiptap/pm/state`, `@tiptap/pm/view`, `@tiptap/pm/model`), Jest + ts-jest (jsdom opt-in via `@jest-environment jsdom` docblock). VS Code webview.

## Global Constraints

- **No new npm packages.** Use only what's installed: `@tiptap/core`, `@tiptap/pm/*`, `tiptap-extension-global-drag-handle@0.1.18`. (`@tiptap/extension-placeholder`/`-suggestion` are NOT available.)
- **Empty-state copy, verbatim:** `Start writing, or press / for commands`
- **Placeholder grey:** `#c4c3c0`. Handle resting colors: plus `#9b9a97`, grip `#b3b2af`. Hover backgrounds: plus `rgba(55,53,47,0.08)`, grip `rgba(55,53,47,0.09)`; hover text plus `#37352f`, grip `#5f5e5b`.
- **Backgrounds appear on hover only** for both ＋ and grip.
- **`/` must never be hijacked mid-text** — only opens the picker when the current block is empty and the selection is collapsed. `⌘/` keeps working everywhere, unchanged.
- Read-only mode must continue to hide the handle (existing rules `html.read-only .global-drag-handle`, `.block-handle` in editor.css).
- Run the full suite with `npm test` (note: a pre-existing toggle.ts type-check failure in one suite is unrelated to this work).

---

### Task 1: Plain-`/` opens the block picker on an empty block

**Files:**
- Create: `src/webview/slashTrigger.ts`
- Modify: `src/webview/blockHandle.ts` (the `keydown` listener near lines 181-198)
- Test: `tests/slashTrigger.test.ts`

**Interfaces:**
- Produces: `slashShouldOpenPicker(blockText: string, selectionEmpty: boolean): boolean` — returns `true` when `blockText === '' && selectionEmpty`.

- [ ] **Step 1: Write the failing test**

Create `tests/slashTrigger.test.ts`:

```ts
import { slashShouldOpenPicker } from '../src/webview/slashTrigger';

describe('slashShouldOpenPicker', () => {
  it('opens on an empty block with a collapsed selection', () => {
    expect(slashShouldOpenPicker('', true)).toBe(true);
  });

  it('does not open when the block already has text', () => {
    expect(slashShouldOpenPicker('and/or', true)).toBe(false);
  });

  it('does not open when the selection is a range (not collapsed)', () => {
    expect(slashShouldOpenPicker('', false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/slashTrigger.test.ts`
Expected: FAIL — "Cannot find module '../src/webview/slashTrigger'".

- [ ] **Step 3: Write minimal implementation**

Create `src/webview/slashTrigger.ts`:

```ts
/**
 * Decide whether a plain "/" keystroke should open the block picker.
 * True only on a completely empty text block with a collapsed selection,
 * so "/" typed mid-text (e.g. "and/or", paths, dates) is never hijacked.
 */
export function slashShouldOpenPicker(blockText: string, selectionEmpty: boolean): boolean {
  return blockText === '' && selectionEmpty;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/slashTrigger.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the trigger into the keydown handler**

In `src/webview/blockHandle.ts`, add the import at the top (after the existing imports):

```ts
import { slashShouldOpenPicker } from './slashTrigger';
```

Then, inside `createBlockHandle`, locate the existing keydown listener that handles `⌘/`:

```ts
  // ⌘/ keyboard shortcut — opens picker at current cursor position
  editor.view.dom.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
```

Replace that `if` condition's body trigger so plain `/` on an empty block also opens the picker. Change the guard to:

```ts
  // ⌘/ anywhere, or plain "/" on an empty block — opens picker at the cursor.
  editor.view.dom.addEventListener('keydown', (e: KeyboardEvent) => {
    const metaSlash = e.key === '/' && (e.metaKey || e.ctrlKey);
    const sel = editor.state.selection;
    const plainSlash =
      e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey &&
      slashShouldOpenPicker(sel.$from.parent.textContent, sel.empty);
    if (metaSlash || plainSlash) {
```

The remainder of the handler body (computing `insertPos`, the fixed anchor, `picker.open`, `anchor.remove()`) stays exactly as-is — `e.preventDefault()` already runs there, which suppresses the literal "/" character.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from `blockHandle.ts` or `slashTrigger.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/webview/slashTrigger.ts src/webview/blockHandle.ts tests/slashTrigger.test.ts
git commit -m "feat(c42): plain / opens block picker on an empty block"
```

---

### Task 2: Notion-style SVG icons for the handle

**Files:**
- Create: `src/webview/handleIcons.ts`
- Modify: `src/webview/blockHandle.ts` (the handle-augmentation block, lines 99-112)
- Modify: `src/webview/styles/editor.css` (`.block-handle-plus` ~1924, `.block-handle-drag` ~1950)
- Test: `tests/handleIcons.test.ts`

**Interfaces:**
- Produces: `createPlusIcon(): SVGSVGElement` — a 16-viewbox plus icon. `createGripIcon(): SVGSVGElement` — a 2×3 dot grid (six `<circle>` elements) in a taller-than-wide viewbox.

- [ ] **Step 1: Write the failing test**

Create `tests/handleIcons.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { createPlusIcon, createGripIcon } from '../src/webview/handleIcons';

describe('handle icons', () => {
  it('createPlusIcon returns an <svg> with two stroke paths/lines', () => {
    const svg = createPlusIcon();
    expect(svg.tagName.toLowerCase()).toBe('svg');
    // one <path> drawing the plus cross
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(1);
  });

  it('createGripIcon returns an <svg> with six dots', () => {
    const svg = createGripIcon();
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelectorAll('circle').length).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/handleIcons.test.ts`
Expected: FAIL — "Cannot find module '../src/webview/handleIcons'".

- [ ] **Step 3: Write minimal implementation**

Create `src/webview/handleIcons.ts`:

```ts
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(viewBox: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('fill', 'none');
  return svg;
}

/** Crisp plus glyph, 16×16 viewbox. */
export function createPlusIcon(): SVGSVGElement {
  const svg = svgEl('0 0 16 16');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M8 3v10M3 8h10');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  return svg;
}

/** 2×3 dot grid in a taller-than-wide viewbox so the grip reads vertical. */
export function createGripIcon(): SVGSVGElement {
  const svg = svgEl('0 0 12 18');
  svg.setAttribute('fill', 'currentColor');
  const cols = [3.5, 8.5];
  const rows = [4, 9, 14];
  for (const cy of rows) {
    for (const cx of cols) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', String(cx));
      c.setAttribute('cy', String(cy));
      c.setAttribute('r', '1.5');
      svg.appendChild(c);
    }
  }
  return svg;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/handleIcons.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Use the icons in the handle**

In `src/webview/blockHandle.ts`, add the import:

```ts
import { createPlusIcon, createGripIcon } from './handleIcons';
```

Replace the plus-glyph line:

```ts
    plusBtn.textContent = '+';
```

with:

```ts
    plusBtn.appendChild(createPlusIcon());
```

Replace the drag-icon glyph line:

```ts
    dragIcon.textContent = '⠿';
```

with:

```ts
    dragIcon.appendChild(createGripIcon());
```

- [ ] **Step 6: Restyle the handle in CSS (hover-only backgrounds, tight grip)**

In `src/webview/styles/editor.css`, replace the `.block-handle-plus`, `.block-handle-plus:hover`, `.block-handle-drag`, and `.block-handle-drag:hover` rules (currently ~lines 1924-1966) with:

```css
/* + button — SVG plus, transparent at rest, soft rounded bg on hover only */
.block-handle-plus {
  background: transparent;
  border: none;
  color: #9b9a97;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  cursor: pointer;
  padding: 0;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}
.block-handle-plus svg { width: 16px; height: 16px; display: block; }

.block-handle-plus:hover {
  background: rgba(55, 53, 47, 0.08);
  color: #37352f;
}

/* Drag grip — 6-dot SVG, no box at rest; snug rounded bg hugging the dots on hover */
.block-handle-drag {
  background: transparent;
  color: #b3b2af;
  width: 15px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: grab;
  transition: background 0.1s, color 0.1s;
}
.block-handle-drag svg { width: 11px; height: 17px; display: block; }

.block-handle-drag:hover {
  background: rgba(55, 53, 47, 0.09);
  color: #5f5e5b;
}
```

- [ ] **Step 7: Type-check + full test run**

Run: `npx tsc --noEmit && npm test`
Expected: no new type errors; all suites pass except the pre-existing unrelated toggle.ts failure.

- [ ] **Step 8: Commit**

```bash
git add src/webview/handleIcons.ts src/webview/blockHandle.ts src/webview/styles/editor.css tests/handleIcons.test.ts
git commit -m "feat(c42): Notion-style SVG plus + 6-dot grip with hover-only backgrounds"
```

---

### Task 3: Align the handle to the block's first line

**Files:**
- Modify: `src/webview/styles/editor.css` (`.drag-handle` ~line 1889)

**Interfaces:** none (CSS only).

This task is visual; it has no unit test. Verify manually in Step 3.

- [ ] **Step 1: Anchor the handle row to the top (first line)**

In `src/webview/styles/editor.css`, in the `.drag-handle` rule (~1889-1905), change `align-items: center;` to `align-items: flex-start;` and add a top offset so the icons sit centered on the first text line rather than the block's vertical middle. The rule should read:

```css
.drag-handle {
  position: fixed;
  z-index: 998;
  display: flex;
  align-items: flex-start;   /* anchor icons to the block's first line */
  gap: 2px;
  padding-top: 1px;          /* nudge onto the first line's optical center */
  padding-right: 4px;
  cursor: grab;
  opacity: 1;
  pointer-events: auto;
  padding-left: 12px;
  margin-left: -12px;
  transition: opacity 0.12s 0.6s;
}
```

(Keep every other declaration in the rule unchanged — only `align-items` changes and `padding-top` is added.)

- [ ] **Step 2: Build the webview bundle**

Run: `npm run compile` (or the project's build script — check `package.json` "scripts"; use the one that bundles the webview).
Expected: build succeeds.

- [ ] **Step 3: Manual verification (F5)**

Launch the extension (F5 → open a markdown file). Hover, in turn:
- a 3-line paragraph,
- an H1, an H2, an H3.

Expected: in every case the ＋ and grip sit aligned with the **first line** of the block, not floating to its vertical middle. The grip background (on hover) hugs the dots.

- [ ] **Step 4: Commit**

```bash
git add src/webview/styles/editor.css
git commit -m "style(c42): align block handle to the block's first line"
```

---

### Task 4: Empty-state placeholder hint

**Files:**
- Create: `src/webview/extensions/emptyPlaceholder.ts`
- Modify: `src/webview/editor.ts` (import + add to the `extensions` array near line 159)
- Modify: `src/webview/styles/editor.css` (append a placeholder `::before` rule)
- Test: `tests/emptyPlaceholder.test.ts`

**Interfaces:**
- Produces: `shouldShowPlaceholder(flags: { isEmpty: boolean; isFocused: boolean; isFirstBlock: boolean; docIsEmpty: boolean }): boolean` — `isEmpty && (isFocused || (isFirstBlock && docIsEmpty))`.
- Produces: `EmptyPlaceholder` (a TipTap `Extension`) and `PLACEHOLDER_TEXT` constant.

- [ ] **Step 1: Write the failing test**

Create `tests/emptyPlaceholder.test.ts`:

```ts
import { shouldShowPlaceholder, PLACEHOLDER_TEXT } from '../src/webview/extensions/emptyPlaceholder';

describe('shouldShowPlaceholder', () => {
  it('shows on the focused empty block', () => {
    expect(shouldShowPlaceholder({ isEmpty: true, isFocused: true, isFirstBlock: false, docIsEmpty: false })).toBe(true);
  });

  it('shows on the first block of a brand-new empty document even when unfocused', () => {
    expect(shouldShowPlaceholder({ isEmpty: true, isFocused: false, isFirstBlock: true, docIsEmpty: true })).toBe(true);
  });

  it('hides on a non-empty block', () => {
    expect(shouldShowPlaceholder({ isEmpty: false, isFocused: true, isFirstBlock: true, docIsEmpty: false })).toBe(false);
  });

  it('hides on an unfocused empty block that is not the first line of an empty doc', () => {
    expect(shouldShowPlaceholder({ isEmpty: true, isFocused: false, isFirstBlock: false, docIsEmpty: false })).toBe(false);
  });

  it('exposes the approved copy', () => {
    expect(PLACEHOLDER_TEXT).toBe('Start writing, or press / for commands');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/emptyPlaceholder.test.ts`
Expected: FAIL — "Cannot find module '.../emptyPlaceholder'".

- [ ] **Step 3: Write the extension**

Create `src/webview/extensions/emptyPlaceholder.ts` (mirrors the decoration pattern in `blockDirection.ts`, but recomputes on selection change too):

```ts
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';

export const PLACEHOLDER_TEXT = 'Start writing, or press / for commands';

export function shouldShowPlaceholder(flags: {
  isEmpty: boolean;
  isFocused: boolean;
  isFirstBlock: boolean;
  docIsEmpty: boolean;
}): boolean {
  return flags.isEmpty && (flags.isFocused || (flags.isFirstBlock && flags.docIsEmpty));
}

function buildDecorations(state: EditorState): DecorationSet {
  const { doc, selection } = state;
  const decos: Decoration[] = [];
  const docIsEmpty = doc.textContent === '';
  let topIndex = -1;
  doc.forEach((node, pos) => {
    topIndex++;
    // Only plain text blocks get the hint (paragraph / heading).
    if (!node.isTextblock) return;
    const isEmpty = node.content.size === 0;
    const isFocused = selection.empty && selection.$from.parent === node;
    const isFirstBlock = topIndex === 0;
    if (shouldShowPlaceholder({ isEmpty, isFocused, isFirstBlock, docIsEmpty })) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, {
        'data-placeholder': PLACEHOLDER_TEXT,
        class: 'is-empty-block',
      }));
    }
  });
  return DecorationSet.create(doc, decos);
}

const emptyPlaceholderKey = new PluginKey<DecorationSet>('emptyPlaceholder');

export const EmptyPlaceholder = Extension.create({
  name: 'emptyPlaceholder',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: emptyPlaceholderKey,
        props: {
          // Recompute every render: placeholder visibility depends on selection,
          // not just doc content.
          decorations(state) {
            return buildDecorations(state);
          },
        },
      }),
    ];
  },
});

export default EmptyPlaceholder;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/emptyPlaceholder.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Register the extension**

In `src/webview/editor.ts`, add the import alongside the other extension imports (near line 18):

```ts
import { EmptyPlaceholder } from './extensions/emptyPlaceholder';
```

Then add it to the `extensions` array (right after `GlobalDragHandle.configure({ dragHandleWidth: 48 }),` at line 159):

```ts
      GlobalDragHandle.configure({ dragHandleWidth: 48 }),
      EmptyPlaceholder,
```

- [ ] **Step 6: Add the placeholder CSS**

Append to `src/webview/styles/editor.css` (near the other `.ProseMirror` block rules):

```css
/* Empty-state hint — shown on the focused empty block and on a brand-new
   empty document's first line. The float/height:0 trick avoids needing the
   block to be positioned. */
.ProseMirror .is-empty-block::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  color: #c4c3c0;
}
```

- [ ] **Step 7: Type-check + full test run**

Run: `npx tsc --noEmit && npm test`
Expected: no new type errors; all suites pass except the pre-existing unrelated toggle.ts failure.

- [ ] **Step 8: Build + manual verification (F5)**

Run: `npm run compile`, then F5. Verify:
- A brand-new/empty file shows the hint on the first line before clicking in.
- Clicking into any empty line shows the hint; typing makes it vanish; deleting back to empty brings it back.
- A line with text never shows the hint.

- [ ] **Step 9: Commit**

```bash
git add src/webview/extensions/emptyPlaceholder.ts src/webview/editor.ts src/webview/styles/editor.css tests/emptyPlaceholder.test.ts
git commit -m "feat(c42): empty-state placeholder hint on empty blocks"
```

---

### Task 5: Docs (README + CHANGELOG)

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md` (if it documents editor/block interactions)

**Interfaces:** none.

Per project convention, docs are updated **before** any push/merge.

- [ ] **Step 1: Add a CHANGELOG entry**

Add an entry under the current unreleased/next-version heading in `CHANGELOG.md`:

```markdown
- Notion-style block handle: larger SVG ＋ and a 6-dot drag grip with hover-only backgrounds, aligned to each block's first line.
- Empty blocks now show a "Start writing, or press / for commands" hint, and plain `/` on an empty block opens the block picker (⌘/ still works everywhere).
```

- [ ] **Step 2: Update README if applicable**

Open `README.md`. If it has a section describing block editing / the gutter handle / keyboard shortcuts, add a line noting the `/` shortcut and the empty-state hint. If no such section exists, skip — do not invent one.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs(c42): changelog + readme for Notion-style handle and empty-state hint"
```

---

## Final verification (before the merge pause)

- [ ] `npx tsc --noEmit` — no new errors.
- [ ] `npm test` — green except the known pre-existing toggle.ts suite.
- [ ] `npm run compile` succeeds.
- [ ] F5 manual pass covering: handle SVGs + hover-only backgrounds, grip hugging the dots, first-line alignment on tall paragraph + H1/H2/H3, empty-state hint behavior, plain `/` opens picker on empty block (and does NOT on a block with text), `⌘/` still works, read-only mode still hides the handle.
- [ ] **STOP — do not merge.** Hand back to the user to confirm the c43 tab is idle before merging `c42-notion-block-handle` into `main`.
