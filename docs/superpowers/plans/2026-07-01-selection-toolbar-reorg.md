# Selection Toolbar Reorg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the selection bubble menu to two tidy rows by moving AI and the two Copy actions into the ⋯ menu.

**Architecture:** The visible bar loses the standalone ✦ AI button and the Copy / Copy-as-plain buttons. The ⋯ ("more") button, which today opens the "Turn into" panel directly, instead opens a small 4-row action menu: **Turn into**, **Turn into using AI** (both open the existing sub-panels), **Copy**, **Copy as plain text** (both call the existing `copySelection.ts` helpers). A tiny new `moreMenu.ts` module holds the menu's item list + action-dispatch so it can be unit-tested; `bubbleMenu.ts` renders and wires it.

**Tech Stack:** TypeScript, ProseMirror/tiptap, esbuild webview bundle, Jest (ts-jest).

## Global Constraints

- Work in the worktree `.worktrees/c23-copy-buttons` on branch `feat/copy-buttons-c23` (this reorg moves the c23 buttons, so it builds on that branch — do NOT branch off clean `main`).
- `node_modules` in the worktree is a symlink to the main checkout; it already exists.
- Jest ignores `/.worktrees/` (see `package.json` jest config), and we run *inside* a worktree, so every jest command must override it: append `--testPathIgnorePatterns "/node_modules/"`.
- Type-check with `npx tsc -p tsconfig.json --noEmit`; bundle with `node esbuild.config.js`.
- Icons are Phosphor **bold** weight, rendered via the existing `svg(path, size)` helper (viewBox 256, `fill="currentColor"`). Match the surrounding toolbar icons.
- Only one floating panel open at a time (swatches / link row / Turn-into / AI / the new menu are mutually exclusive) — the "floating panel coexistence" convention.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

## File Structure

- **Create** `src/webview/moreMenu.ts` — the ⋯ menu's item list (`MORE_MENU_ITEMS`) and pure action dispatch (`runMoreMenuAction`). No DOM, no editor — trivially testable.
- **Create** `tests/moreMenu.test.ts` — unit tests for the above (node env, no jsdom).
- **Modify** `src/webview/bubbleMenu.ts` — remove 3 buttons from the bar; render the ⋯ menu panel from `MORE_MENU_ITEMS`; add `closeMenu`, `openInto`, `openAi`, `postToHost` helpers; rewire the `more` case; delete the `ai` / `copy` / `copy-plain` cases; add `[data-menu]` click handling; drop the now-dead `aiBtn`.
- **Modify** `src/webview/styles/editor.css` — styling for the menu rows (leading icon + trailing chevron).
- **Modify** `CHANGELOG.md` — Unreleased entry.

---

## Task 1: `moreMenu.ts` — item list + action dispatch (with tests)

**Files:**
- Create: `src/webview/moreMenu.ts`
- Test: `tests/moreMenu.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type MoreMenuId = 'turn-into' | 'turn-into-ai' | 'copy' | 'copy-plain'`
  - `interface MoreMenuItem { id: MoreMenuId; label: string; chevron: boolean }`
  - `const MORE_MENU_ITEMS: readonly MoreMenuItem[]`
  - `interface MoreMenuDeps { openTurnInto: () => void; openTurnIntoAi: () => void; copyRich: () => void; copyPlain: () => void }`
  - `function runMoreMenuAction(id: string, deps: MoreMenuDeps): void`

- [ ] **Step 1: Write the failing test**

Create `tests/moreMenu.test.ts`:

```ts
import { MORE_MENU_ITEMS, runMoreMenuAction, type MoreMenuDeps } from '../src/webview/moreMenu';

describe('MORE_MENU_ITEMS', () => {
  it('lists the four actions in order', () => {
    expect(MORE_MENU_ITEMS.map(i => i.id)).toEqual([
      'turn-into', 'turn-into-ai', 'copy', 'copy-plain',
    ]);
  });

  it('marks only the two turn-into rows with a chevron', () => {
    expect(MORE_MENU_ITEMS.filter(i => i.chevron).map(i => i.id)).toEqual([
      'turn-into', 'turn-into-ai',
    ]);
  });

  it('gives every row a non-empty label', () => {
    for (const item of MORE_MENU_ITEMS) expect(item.label.length).toBeGreaterThan(0);
  });
});

describe('runMoreMenuAction', () => {
  function deps(): MoreMenuDeps & { [k: string]: jest.Mock } {
    return {
      openTurnInto: jest.fn(),
      openTurnIntoAi: jest.fn(),
      copyRich: jest.fn(),
      copyPlain: jest.fn(),
    };
  }

  it.each([
    ['turn-into', 'openTurnInto'],
    ['turn-into-ai', 'openTurnIntoAi'],
    ['copy', 'copyRich'],
    ['copy-plain', 'copyPlain'],
  ])('routes %s to %s exactly once', (id, fn) => {
    const d = deps();
    runMoreMenuAction(id, d);
    expect(d[fn]).toHaveBeenCalledTimes(1);
    const others = ['openTurnInto', 'openTurnIntoAi', 'copyRich', 'copyPlain'].filter(k => k !== fn);
    for (const k of others) expect(d[k]).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown id', () => {
    const d = deps();
    runMoreMenuAction('nope', d);
    for (const k of ['openTurnInto', 'openTurnIntoAi', 'copyRich', 'copyPlain']) {
      expect(d[k]).not.toHaveBeenCalled();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest moreMenu --testPathIgnorePatterns "/node_modules/"`
Expected: FAIL — `Cannot find module '../src/webview/moreMenu'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/webview/moreMenu.ts`:

```ts
// The ⋯ ("more") menu in the selection bubble menu. Kept free of DOM and editor
// references so the item list and dispatch are unit-testable; bubbleMenu.ts
// renders MORE_MENU_ITEMS and supplies the callbacks in MoreMenuDeps.

export type MoreMenuId = 'turn-into' | 'turn-into-ai' | 'copy' | 'copy-plain';

export interface MoreMenuItem {
  id: MoreMenuId;
  label: string;
  /** true → the row opens a sub-panel (shown with a trailing chevron). */
  chevron: boolean;
}

export const MORE_MENU_ITEMS: readonly MoreMenuItem[] = [
  { id: 'turn-into',    label: 'Turn into',          chevron: true  },
  { id: 'turn-into-ai', label: 'Turn into using AI', chevron: true  },
  { id: 'copy',         label: 'Copy',               chevron: false },
  { id: 'copy-plain',   label: 'Copy as plain text', chevron: false },
];

export interface MoreMenuDeps {
  openTurnInto: () => void;
  openTurnIntoAi: () => void;
  copyRich: () => void;
  copyPlain: () => void;
}

/** Dispatch a click on a ⋯-menu row to the matching dependency. Unknown ids are ignored. */
export function runMoreMenuAction(id: string, deps: MoreMenuDeps): void {
  switch (id) {
    case 'turn-into':    deps.openTurnInto();   break;
    case 'turn-into-ai': deps.openTurnIntoAi(); break;
    case 'copy':         deps.copyRich();       break;
    case 'copy-plain':   deps.copyPlain();      break;
    default: /* ignore */ break;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest moreMenu --testPathIgnorePatterns "/node_modules/"`
Expected: PASS (3 + 5 assertions across the two suites).

- [ ] **Step 5: Commit**

```bash
git add src/webview/moreMenu.ts tests/moreMenu.test.ts
git commit -m "feat(toolbar): moreMenu item list + action dispatch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire the ⋯ menu into `bubbleMenu.ts` + styling

This task has no new unit test (the bubble menu is DOM+editor-coupled and covered by manual F5); its gates are type-check, bundle, the existing suites, and the manual check at the end. Task 1's `moreMenu.test.ts` guards the data/dispatch that this task renders.

**Files:**
- Modify: `src/webview/bubbleMenu.ts`
- Modify: `src/webview/styles/editor.css`

**Interfaces:**
- Consumes from Task 1: `MORE_MENU_ITEMS`, `runMoreMenuAction`, `MoreMenuId`.
- Consumes existing: `copySelectionRich`, `copySelectionAsPlainText` (from `./copySelection`).

- [ ] **Step 1: Add the import and the two menu icons**

At the top of `src/webview/bubbleMenu.ts`, the copySelection import already exists:

```ts
import { copySelectionAsPlainText, copySelectionRich } from './copySelection';
```

Add directly below it:

```ts
import { MORE_MENU_ITEMS, runMoreMenuAction, type MoreMenuId } from './moreMenu';
```

In the `P` icon map, the `copy` and `subtractSquare` entries already exist (from c23). Add three more entries just after `subtractSquare` (keep the closing `} as const;` line):

```ts
  squaresFour:   'M100,36H56A20,20,0,0,0,36,56v44a20,20,0,0,0,20,20h44a20,20,0,0,0,20-20V56A20,20,0,0,0,100,36ZM96,96H60V60H96ZM200,36H156a20,20,0,0,0-20,20v44a20,20,0,0,0,20,20h44a20,20,0,0,0,20-20V56A20,20,0,0,0,200,36Zm-4,60H160V60h36Zm-96,40H56a20,20,0,0,0-20,20v44a20,20,0,0,0,20,20h44a20,20,0,0,0,20-20V156A20,20,0,0,0,100,136Zm-4,60H60V160H96Zm104-60H156a20,20,0,0,0-20,20v44a20,20,0,0,0,20,20h44a20,20,0,0,0,20-20V156A20,20,0,0,0,200,136Zm-4,60H160V160h36Z',
  sparkle:       'M128 24 L150 106 L232 128 L150 150 L128 232 L106 150 L24 128 L106 106 Z',
  caretRight:    'M181,133.66l-80,80A8,8,0,0,1,89,202.34L163.31,128,89,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181,133.66Z',
```

- [ ] **Step 2: Add the `moreMenuHtml()` builder at module scope**

Immediately after the `svg()` helper function (the `function svg(path, size = 20) {...}` block near the top), add:

```ts
const MENU_ICONS: Record<MoreMenuId, string> = {
  'turn-into':    P.squaresFour,
  'turn-into-ai': P.sparkle,
  'copy':         P.copy,
  'copy-plain':   P.subtractSquare,
};

// Rows for the ⋯ menu, rendered from the shared MORE_MENU_ITEMS list. A divider
// is inserted before the first non-chevron (Copy) row.
function moreMenuHtml(): string {
  let html = '';
  let dividerDone = false;
  for (const item of MORE_MENU_ITEMS) {
    if (!item.chevron && !dividerDone) {
      html += `<div class="bm-into-divider"></div>`;
      dividerDone = true;
    }
    const chev = item.chevron
      ? `<span class="bm-menu-chevron">${svg(P.caretRight, 16)}</span>`
      : '';
    html += `<button class="bm-into-item bm-menu-item" data-menu="${item.id}">`
      + `<span class="bm-menu-ic">${svg(MENU_ICONS[item.id], 18)}</span>`
      + `<span class="bm-menu-label">${item.label}</span>${chev}</button>`;
  }
  return html;
}
```

- [ ] **Step 3: Remove the 3 buttons from the bar and add the menu panel**

In `buildEl()`, the row-1 tail currently reads:

```ts
      <button class="bm-btn" data-action="code" data-tip-html="Inline code<kbd>⌘E</kbd>">${svg(P.code)}</button>
      ${DIV}
      <button class="bm-btn" data-action="copy" data-tip="Copy">${svg(P.copy)}</button>
      <button class="bm-btn" data-action="copy-plain" data-tip="Copy as plain text">${svg(P.subtractSquare)}</button>
    </div>
```

Replace it with (drop the divider + both copy buttons):

```ts
      <button class="bm-btn" data-action="code" data-tip-html="Inline code<kbd>⌘E</kbd>">${svg(P.code)}</button>
    </div>
```

In row 2, the tail currently reads:

```ts
      <button class="bm-btn" data-action="more" data-tip="Turn into another block">${svg(P.dotsThree, 22)}</button>
      <button class="bm-btn bm-ai-btn" data-action="ai" data-tip="Turn into… using AI">${svg('M128 24 L150 106 L232 128 L150 150 L128 232 L106 150 L24 128 L106 106 Z', 20)}</button>
    </div>
```

Replace it with (drop the AI button; retip ⋯ to "More"):

```ts
      <button class="bm-btn" data-action="more" data-tip="More">${svg(P.dotsThree, 22)}</button>
    </div>
```

Then find the AI panel block:

```ts
    <div class="bubble-ai hidden" id="bm-ai">
      <div class="bubble-into-title">Turn selection into — using AI</div>
      <div class="bubble-into-list">${aiListHtml()}</div>
    </div>
```

Add the new menu panel immediately after that closing `</div>`:

```ts
    <div class="bubble-into bm-menu hidden" id="bm-menu">
      <div class="bubble-into-list">${moreMenuHtml()}</div>
    </div>
```

- [ ] **Step 4: Replace the `aiBtn` element handle with the menu handle**

In `createBubbleMenu`, find:

```ts
  const aiBtn        = el.querySelector<HTMLElement>('[data-action="ai"]')!;
```

Replace with:

```ts
  const menuPanel    = el.querySelector<HTMLElement>('#bm-menu')!;
```

- [ ] **Step 5: Add `postToHost`, `closeMenu`, `openInto`, `openAi`; fix `closeInto`/`closeAi`**

Find the existing close helpers:

```ts
  function closeInto(): void {
    intoPanel.classList.add('hidden');
    moreBtn.classList.remove('active');
    unhighlightBlock();
  }

  function closeAi(): void {
    aiPanel.classList.add('hidden');
    aiBtn.classList.remove('active');
  }
```

Replace both with (the `moreBtn.active` state now tracks the menu, not the Turn-into panel; `aiBtn` no longer exists):

```ts
  function closeInto(): void {
    intoPanel.classList.add('hidden');
    unhighlightBlock();
  }

  function closeAi(): void {
    aiPanel.classList.add('hidden');
  }

  function closeMenu(): void {
    menuPanel.classList.add('hidden');
    moreBtn.classList.remove('active');
  }

  function postToHost(msg: unknown): void {
    const vs = (window as unknown as {
      __mdViewerVscode?: { postMessage: (m: unknown) => void };
    }).__mdViewerVscode;
    vs?.postMessage(msg);
  }

  // Open the "Turn into" panel (block types + "✨ Using AI"). Was inline in the
  // old 'more' case; now reached from the ⋯ menu.
  function openInto(): void {
    closeSwatch();
    closeAi();
    closeMenu();
    highlightBlock();
    intoInput.value = '';
    filterInto('');
    intoPanel.classList.remove('hidden');
    setTimeout(() => intoInput.focus({ preventScroll: true }), 30);
  }

  // Open the AI transform list. Was the old ✦ button's job.
  function openAi(): void {
    closeSwatch();
    closeInto();
    closeMenu();
    aiPanel.classList.remove('hidden');
  }
```

- [ ] **Step 6: Add `closeMenu()` to the other panel-opening paths**

In `openLinkRow`, find:

```ts
  function openLinkRow(): void {
    closeSwatch();
    closeInto();
```

Replace with:

```ts
  function openLinkRow(): void {
    closeSwatch();
    closeInto();
    closeMenu();
```

In the click `switch`, the color / highlight / emoji cases currently read:

```ts
      case 'color':     colorSwatch.classList.toggle('open'); hlSwatch.classList.remove('open'); emojiSwatch.classList.remove('open'); closeInto(); closeAi(); break;
      case 'highlight': hlSwatch.classList.toggle('open');    colorSwatch.classList.remove('open'); emojiSwatch.classList.remove('open'); closeInto(); closeAi(); break;
      case 'emoji':     emojiSwatch.classList.toggle('open'); colorSwatch.classList.remove('open'); hlSwatch.classList.remove('open'); closeInto(); closeAi(); break;
```

Replace with (append `closeMenu();` to each):

```ts
      case 'color':     colorSwatch.classList.toggle('open'); hlSwatch.classList.remove('open'); emojiSwatch.classList.remove('open'); closeInto(); closeAi(); closeMenu(); break;
      case 'highlight': hlSwatch.classList.toggle('open');    colorSwatch.classList.remove('open'); emojiSwatch.classList.remove('open'); closeInto(); closeAi(); closeMenu(); break;
      case 'emoji':     emojiSwatch.classList.toggle('open'); colorSwatch.classList.remove('open'); hlSwatch.classList.remove('open'); closeInto(); closeAi(); closeMenu(); break;
```

- [ ] **Step 7: Replace the `ai` and `more` cases; delete `copy` / `copy-plain` cases**

The current cases (added by c23 + existing) read:

```ts
      case 'copy': {
        const vs = (window as unknown as {
          __mdViewerVscode?: { postMessage: (m: unknown) => void };
        }).__mdViewerVscode;
        if (vs) void copySelectionRich(editor, (m) => vs.postMessage(m));
        break;
      }
      case 'copy-plain': {
        const vs = (window as unknown as {
          __mdViewerVscode?: { postMessage: (m: unknown) => void };
        }).__mdViewerVscode;
        if (vs) copySelectionAsPlainText(editor, (m) => vs.postMessage(m));
        break;
      }
```

Delete both of those cases entirely (Copy is now menu-driven).

The `ai` and `more` cases currently read:

```ts
      case 'ai': {
        closeSwatch();
        closeInto();
        const open = !aiPanel.classList.contains('hidden');
        if (!open) { aiPanel.classList.remove('hidden'); aiBtn.classList.add('active'); }
        else closeAi();
        break;
      }
      case 'more': {
        closeSwatch();
        closeAi();
        const isOpen = !intoPanel.classList.contains('hidden');
        if (!isOpen) {
          // Opening: highlight the target block, reset filter, focus input
          highlightBlock();
          intoInput.value = '';
          filterInto('');
          intoPanel.classList.remove('hidden');
          moreBtn.classList.add('active');
          setTimeout(() => intoInput.focus({ preventScroll: true }), 30);
        } else {
          closeInto();
        }
        break;
      }
```

Delete the `ai` case entirely, and replace the `more` case with one that toggles the new menu:

```ts
      case 'more': {
        closeSwatch();
        closeInto();
        closeAi();
        const isOpen = !menuPanel.classList.contains('hidden');
        if (!isOpen) { menuPanel.classList.remove('hidden'); moreBtn.classList.add('active'); }
        else closeMenu();
        break;
      }
```

- [ ] **Step 8: Handle clicks on the menu rows**

Find the top of the `el.addEventListener('click', ...)` handler where the AI/Turn-into items are handled:

```ts
    // AI turn-into item clicked? (from either the ✨ panel or the "Using AI" group)
    const aiItem = target.closest<HTMLElement>('[data-ai], [data-ai-into]');
```

Insert this block immediately **before** that `const aiItem` line:

```ts
    // ⋯ menu row clicked?
    const menuItem = target.closest<HTMLElement>('[data-menu]');
    if (menuItem) {
      e.stopPropagation();
      runMoreMenuAction(menuItem.dataset.menu!, {
        openTurnInto:   openInto,
        openTurnIntoAi: openAi,
        copyRich:  () => { void copySelectionRich(editor, postToHost); closeMenu(); },
        copyPlain: () => { copySelectionAsPlainText(editor, postToHost); closeMenu(); },
      });
      return;
    }

```

- [ ] **Step 9: Add the menu-row CSS**

In `src/webview/styles/editor.css`, find the `.bm-into-item.active { ... }` rule (ends around line 1854, just before `.bm-into-icon {`). Insert after that rule's closing brace:

```css
/* ⋯ menu rows: left-aligned, small leading icon, optional trailing chevron
   (they reuse .bm-into-item for padding/hover but not the boxed .bm-into-icon). */
.bm-menu-item { justify-content: flex-start; }
.bm-menu-ic {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  color: var(--text-secondary);
}
.bm-menu-ic svg { width: 18px; height: 18px; }
.bm-menu-label { flex: 1 1 auto; }
.bm-menu-chevron {
  display: flex;
  align-items: center;
  margin-left: auto;
  color: var(--text-secondary);
}
.bm-menu-chevron svg { width: 16px; height: 16px; }
```

- [ ] **Step 10: Type-check and bundle**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0, no output. (If it complains about an unused `aiBtn`, `copySelectionRich`, `copySelectionAsPlainText`, `MoreMenuId`, or `P.dotsThree`, re-check Steps 1/4/7 — all five must still be referenced.)

Run: `node esbuild.config.js`
Expected: `Webview + diff pane built.`

- [ ] **Step 11: Run the existing suites (no regressions)**

Run: `npx jest --testPathIgnorePatterns "/node_modules/"`
Expected: all suites pass except the pre-existing `tests/board/grouping.test.ts` compile failure (unrelated). `moreMenu` and `copySelection` suites green.

- [ ] **Step 12: Manual check (F5)**

Launch the Extension Development Host on the worktree folder, open a markdown file, and select text:
- The bar shows **two rows**: row 1 = Bold/Italic/Underline/Strike │ Inline code; row 2 = Link/Color/Highlight/Emoji │ ⋯. No ✦ or Copy buttons on the bar.
- Click **⋯** → a 4-row menu appears: Turn into ▸, Turn into using AI ▸, ──, Copy, Copy as plain text.
- **Turn into** opens the block-type panel (with the "✨ Using AI" section); **Turn into using AI** opens the AI list; **Copy** and **Copy as plain text** copy the selection and toast.
- Opening a swatch (color/highlight/emoji) or the link row while the ⋯ menu is open **closes the menu**, and opening ⋯ closes any open swatch.

- [ ] **Step 13: Commit**

```bash
git add src/webview/bubbleMenu.ts src/webview/styles/editor.css
git commit -m "feat(toolbar): move AI + Copy into the ⋯ menu; two-row bar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Changelog + final verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the Unreleased entry**

In `CHANGELOG.md`, under the existing `## [Unreleased]` heading there is already an `### Added` block (the c23 copy entry). Replace the c23 `### Added` line's surrounding block so Unreleased reads:

```markdown
## [Unreleased]

### Added

- **Copy & Copy as plain text (c23)** — the selection toolbar can copy your selection with formatting intact (**Copy**) or as clean unformatted text (**Copy as plain text**), fixing selections that used to paste in with the wrong styling. Both live in the ⋯ menu (see below). (c23)

### Changed

- **Slimmer selection toolbar** — the floating text toolbar is now two tidy rows: character formatting on top (Bold, Italic, Underline, Strikethrough, Inline code), and Link, Text color, Highlight, Emoji plus a **⋯** menu below. The standalone AI button and the two Copy buttons moved into that **⋯** menu (**Turn into**, **Turn into using AI**, **Copy**, **Copy as plain text**), so the bar covers less of your text.
```

(Keep the `## [0.9.0] - 2026-07-01` section and everything below unchanged. Order stays Added → Changed → Fixed.)

- [ ] **Step 2: Full verification**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0.

Run: `node esbuild.config.js`
Expected: `Webview + diff pane built.`

Run: `npx jest --testPathIgnorePatterns "/node_modules/"`
Expected: only the pre-existing `tests/board/grouping.test.ts` failure; everything else green.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for selection-toolbar reorg

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Two-row bar (marks / apply+more) → Task 2 Steps 3, 12.
- Remove ✦ AI + both Copy buttons from bar → Task 2 Step 3.
- ⋯ opens a clean 4-row action menu → Task 1 (data) + Task 2 Steps 2, 3, 7, 8.
- Turn into / Turn into using AI reuse existing panels → Task 2 Step 5 (`openInto`/`openAi`).
- Copy / Copy-plain reuse `copySelection.ts` → Task 2 Step 8.
- One-panel-at-a-time coexistence → Task 2 Steps 5, 6, 7 (`closeMenu` wired everywhere).
- Menu built with existing floating-panel pattern (popover component not on this branch) → uses `.bubble-into` styling, Task 2 Steps 3, 9.
- Tradeoff (1→2 clicks) → inherent in the design; no code owed.
- Testing (unit for menu data/dispatch; manual F5) → Task 1 tests, Task 2 Step 12.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output.

**Type consistency:** `MoreMenuId`, `MORE_MENU_ITEMS`, `runMoreMenuAction`, `MoreMenuDeps` names match between Task 1 and Task 2. `openInto`/`openAi`/`closeMenu`/`postToHost` are defined (Step 5) before use (Steps 6–8). `MENU_ICONS` keys are the four `MoreMenuId` values. `P.squaresFour`/`P.sparkle`/`P.caretRight` added (Step 1) before use (Step 2).
