# c43 — Notion-style block picker menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the block / slash picker to read like Notion's slash menu — borderless flat icons, tighter rows, less padding, a caption-sized navigation-hint footer, and right-aligned markdown shortcut hints.

**Architecture:** Pure-CSS restyle of `.block-picker` in [editor.css](src/webview/styles/editor.css), plus two small DOM additions in [blockPicker.ts](src/webview/blockPicker.ts) (a footer element and a per-row shortcut span). The two bits of logic — the footer's close/back verb and the block→shortcut map — are extracted as pure exported functions so they're unit-testable; everything else is CSS verified by running the app (F5).

**Tech Stack:** TypeScript, plain DOM (no framework in the webview), CSS custom properties for theming, Jest for unit tests.

## Global Constraints

- **Scope: block picker only.** Touch `.block-picker*` styles in [editor.css:1994-2231](src/webview/styles/editor.css#L1994-L2231) and [blockPicker.ts](src/webview/blockPicker.ts). Do **not** touch `.mp-menu*` in [board.css](src/webview/styles/board.css) — the shared action menus are out of scope.
- **Theme via tokens only.** All colors use existing CSS vars (`var(--border)`, `var(--text-secondary)`, `var(--text-primary)`, `var(--link)`, `var(--block-hover)`, `var(--bg)`) so dark mode follows automatically. No hard-coded hex except the pre-existing delete-red `#e5484d`.
- **No behavior change.** Block ordering, filtering, which blocks appear, drill-down, insert/convert handlers — all unchanged. This is presentation only (plus shortcut labels).
- **Footer text is caption-sized:** verbs `11px`, keys `10px` — smaller than Notion's ~14px (explicit c43 requirement).
- **Test runner:** `npm test` (Jest). Keep the suite green. The one pre-existing failing suite is `toggle.test.ts` (a known type-check issue, unrelated to this work) — do not try to "fix" it here.

---

### Task 1: Borderless icons, tighter rows, calmer section labels (CSS)

The headline change. Today each icon sits in a 36px bordered box and rows are roomy. This task makes icons borderless 24px, tightens rows, and softens the section labels — and adapts the active/current affordance since it can no longer rely on the icon border.

**Files:**
- Modify: `src/webview/styles/editor.css` (the `.block-picker*` rules, lines ~2090-2175)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: the restyled `.block-picker-item`, `.block-picker-icon`, `.block-picker-label`, `.block-picker-section-label` classes that later tasks' new elements sit beside.

- [ ] **Step 1: Restyle the row — `.block-picker-item`**

Find this rule (around line 2090) and change `gap` and `padding`:

```css
.block-picker-item {
  display: flex;
  align-items: center;
  gap: 10px;            /* was 12px */
  padding: 4px 12px;    /* was 6px 8px */
  border-radius: 6px;   /* was 7px */
  cursor: pointer;
  background: transparent;
  color: var(--text-primary);
  transition: background 0.08s, color 0.08s;
}
```

- [ ] **Step 2: Make the icon borderless — `.block-picker-icon`**

Find this rule (around line 2117) and replace it:

```css
.block-picker-icon {
  width: 24px;              /* was 36px */
  height: 24px;             /* was 36px */
  border: 0;                /* was 1px solid var(--border) */
  border-radius: 4px;       /* was 7px */
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;  /* was var(--bg) */
  flex-shrink: 0;
  color: var(--text-secondary);  /* was var(--text-primary) */
  font-size: 15px;          /* new — sizes the glyph in the smaller box */
}
```

- [ ] **Step 3: Adapt active/current state for the missing border**

The selected affordances currently turn the icon's **border** to `var(--link)`. With no border, drop those two `border-color` lines (keep the text-color tint). Find and edit:

```css
.block-picker-item.active .block-picker-icon {
  color: var(--link);   /* removed: border-color: var(--link); */
}
```

```css
.block-picker-item.current .block-picker-icon {
  color: var(--link);   /* removed: border-color: var(--link); */
}
```

Leave `.block-picker-item.current` (the link-tinted row background), `.block-picker-item.current .block-picker-label`, and `.block-picker-current-mark` (the ✓) exactly as they are — those still carry the "current block" signal.

- [ ] **Step 4: Bump the label — `.block-picker-label`**

```css
.block-picker-label {
  font-size: 14px;   /* was 13px */
  line-height: 1.3;
  flex: 1;
}
```

- [ ] **Step 5: Soften the section labels — `.block-picker-section-label`**

Notion uses calm sentence-case labels, not heavy uppercase:

```css
.block-picker-section-label {
  font-size: 11px;          /* was 10px */
  font-weight: 600;         /* was 700 */
  text-transform: none;     /* was uppercase */
  letter-spacing: .01em;    /* was .08em */
  color: var(--text-secondary);
  padding: 8px 12px 4px;    /* was 8px 10px 4px */
}
```

- [ ] **Step 6: Verify in the app (light + dark)**

Run the extension (F5), open a note, and trigger the picker four ways:
1. Type `/` in an empty paragraph (slash menu)
2. The `+` insert button in the block gutter
3. A block's dragger → "Turn into" (drill-down view)
4. The dragger → convert/delete menu (red Delete row)

Confirm in **both** light and dark theme:
- Icons are borderless 24px, sitting flush — no boxes.
- Rows are visibly tighter than before.
- Section labels read "Text", "Lists", "Media & blocks" in calm sentence case (not SHOUTING CAPS).
- The active (keyboard-highlighted) row and the current-block row are still obviously distinguishable via row background + ✓ + label color.
- The red Delete row still reads as destructive.

- [ ] **Step 7: Run the test suite**

Run: `npm test`
Expected: same result as before this task (the only failing suite is the pre-existing `toggle.test.ts`). No CSS file is imported by tests, so nothing new should break.

- [ ] **Step 8: Commit**

```bash
git add src/webview/styles/editor.css
git commit -m "feat(c43): borderless 24px icons + tighter block-picker rows"
```

---

### Task 2: Caption-sized navigation footer

Add a footer pinned at the bottom of the picker that reads `↑↓ Navigate · ↵ Select · esc Close`, in caption-sized text. Inside a drill-down (where Esc goes back, not closes) the verb flips to "Back". The verb choice is extracted as a pure function so it's testable; the markup and CSS are verified by running the app.

**Files:**
- Modify: `src/webview/blockPicker.ts` (the `el.innerHTML` template ~line 590, and `renderList` ~line 605)
- Modify: `src/webview/styles/editor.css` (add `.block-picker-footer` rules near the other `.block-picker*` rules)
- Test: `tests/blockPicker.test.ts`

**Interfaces:**
- Consumes: the restyled `.block-picker*` classes from Task 1.
- Produces: exported `footerCloseVerb(isDrilled: boolean): 'Close' | 'Back'`, and a `.block-picker-footer` DOM element present in every picker instance.

- [ ] **Step 1: Write the failing test for the verb helper**

Add to `tests/blockPicker.test.ts`:

```typescript
import { filterBlocks, BLOCK_DEFS, footerCloseVerb } from '../src/webview/blockPicker';

describe('footerCloseVerb', () => {
  it('says "Close" at the root list', () => {
    expect(footerCloseVerb(false)).toBe('Close');
  });

  it('says "Back" inside a drill-down', () => {
    expect(footerCloseVerb(true)).toBe('Back');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- blockPicker`
Expected: FAIL — `footerCloseVerb is not a function` / no matching export.

- [ ] **Step 3: Implement the pure helper**

Near the top-level exports in `src/webview/blockPicker.ts` (next to `filterBlocks`), add:

```typescript
// Footer hint: Esc closes the root menu, but inside a drilled-down sub-list
// Esc goes back one level. The footer verb reflects that.
export function footerCloseVerb(isDrilled: boolean): 'Close' | 'Back' {
  return isDrilled ? 'Back' : 'Close';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- blockPicker`
Expected: PASS.

- [ ] **Step 5: Add the footer element to the picker template**

In the `el.innerHTML` assignment (~line 590), add the footer after the list:

```typescript
el.innerHTML = `
    <div class="block-picker-search">
      <input class="block-picker-input" placeholder="Filter blocks…" autocomplete="off" spellcheck="false" />
    </div>
    <div class="block-picker-list"></div>
    <div class="block-picker-footer">
      <span class="block-picker-foot-hints"><span class="bp-key">↑↓</span> Navigate&nbsp;&nbsp;<span class="bp-key">↵</span> Select</span>
      <span class="block-picker-foot-close"><span class="bp-key">esc</span> <span class="bp-foot-verb">Close</span></span>
    </div>
  `;
```

Then grab the verb node alongside the existing `input`/`list`/`searchEl` queries (~line 597):

```typescript
const footVerb = el.querySelector<HTMLElement>('.bp-foot-verb')!;
```

- [ ] **Step 6: Flip the verb when drilling in/out**

`renderList` already runs on every view change (root, drill-in, drill-out). At the end of `renderList` (after `updateActive();`, ~line 652) add:

```typescript
    footVerb.textContent = footerCloseVerb(!!drillParent);
```

- [ ] **Step 7: Add the footer CSS**

In `src/webview/styles/editor.css`, after the `.block-picker-back*` rules (~line 2201), add:

```css
.block-picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px 5px;
  margin-top: 2px;
  border-top: 1px solid var(--border);
  font-size: 11px;            /* caption — smaller than Notion */
  color: var(--text-secondary);
}
.block-picker-footer .bp-key {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.85;
}
```

- [ ] **Step 8: Verify in the app**

Run the extension (F5). Open the slash menu: a footer sits at the bottom reading `↑↓ Navigate  ↵ Select` on the left and `esc Close` on the right, in small caption text. Drill into "Turn into" → the right side now reads `esc Back`. Press Esc → goes back one level (not closed). Back at root, Esc closes. Check both light and dark theme.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: `blockPicker` suite green (including the two new `footerCloseVerb` cases); overall result unchanged except for the new passing tests.

- [ ] **Step 10: Commit**

```bash
git add src/webview/blockPicker.ts src/webview/styles/editor.css tests/blockPicker.test.ts
git commit -m "feat(c43): caption-sized navigation footer with esc Close/Back"
```

---

### Task 3: Markdown shortcut hints (optional per spec — keep or drop at review)

Right-aligned markdown shortcut per row (`Heading 1 → #`, `Bullet list → -`, …), matching the reference. This is the one piece beyond c43's literal wording; it's cheap and isolated, so it lands last and is trivial to drop. A pure exported map function carries the logic and is unit-tested; `renderRow` renders the span when a shortcut exists.

**Files:**
- Modify: `src/webview/blockPicker.ts` (add `shortcutForBlock`, render it in `renderRow` ~line 840)
- Modify: `src/webview/styles/editor.css` (add `.block-picker-shortcut`)
- Test: `tests/blockPicker.test.ts`

**Interfaces:**
- Consumes: `BlockDef.id` values (`heading1`, `heading2`, `heading3`, `bulletList`, `orderedList`, `taskList`, `blockquote`, `codeBlock`), the restyled rows from Task 1, and the footer from Task 2 (independent — only shares the file).
- Produces: exported `shortcutForBlock(id: string): string | undefined`.

- [ ] **Step 1: Write the failing test**

Add to `tests/blockPicker.test.ts`:

```typescript
import { shortcutForBlock } from '../src/webview/blockPicker';

describe('shortcutForBlock', () => {
  it('maps headings to hash shortcuts', () => {
    expect(shortcutForBlock('heading1')).toBe('#');
    expect(shortcutForBlock('heading2')).toBe('##');
    expect(shortcutForBlock('heading3')).toBe('###');
  });

  it('maps lists, quote, and code', () => {
    expect(shortcutForBlock('bulletList')).toBe('-');
    expect(shortcutForBlock('orderedList')).toBe('1.');
    expect(shortcutForBlock('taskList')).toBe('[]');
    expect(shortcutForBlock('blockquote')).toBe('"');
    expect(shortcutForBlock('codeBlock')).toBe('```');
  });

  it('returns undefined for blocks without a shortcut', () => {
    expect(shortcutForBlock('paragraph')).toBeUndefined();
    expect(shortcutForBlock('image')).toBeUndefined();
    expect(shortcutForBlock('zzznope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- blockPicker`
Expected: FAIL — `shortcutForBlock is not a function`.

- [ ] **Step 3: Implement the map**

Near `filterBlocks`/`footerCloseVerb` in `src/webview/blockPicker.ts`:

```typescript
// Markdown shortcut shown on the right of a picker row. Only blocks with a
// real markdown trigger get one; everything else returns undefined (no span).
const BLOCK_SHORTCUTS: Record<string, string> = {
  heading1: '#',
  heading2: '##',
  heading3: '###',
  bulletList: '-',
  orderedList: '1.',
  taskList: '[]',
  blockquote: '"',
  codeBlock: '```',
};

export function shortcutForBlock(id: string): string | undefined {
  return BLOCK_SHORTCUTS[id];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- blockPicker`
Expected: PASS.

- [ ] **Step 5: Render the shortcut span in `renderRow`**

In `renderRow` (~line 840), build the shortcut span and place it before the check/caret. Only root rows show it (drill-down sub-items have no markdown trigger), and never alongside a caret. Edit the `innerHTML` line:

```typescript
  function renderRow(block: BlockDef, idx: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'block-picker-item';
    if (isActiveItem(block)) row.classList.add('current');
    row.dataset.idx = String(idx);
    const drillCaret = block.subItems?.length ? '<span class="block-picker-caret">›</span>' : '';
    const checkMark = isActiveItem(block) ? '<span class="block-picker-current-mark">✓</span>' : '';
    const sc = block.subItems?.length ? undefined : shortcutForBlock(block.id);
    const shortcut = sc ? `<span class="block-picker-shortcut">${sc}</span>` : '';
    row.innerHTML = `<span class="block-picker-icon">${block.iconHtml}</span><span class="block-picker-label">${block.label}</span>${shortcut}${checkMark}${drillCaret}`;
    row.addEventListener('mousedown', (e) => { e.preventDefault(); select(block); });
    return row;
  }
```

(Note: ` ``` ` in `codeBlock` is plain text in a span — no HTML-escaping concern since these are static, controlled strings.)

- [ ] **Step 6: Add the shortcut CSS**

In `src/webview/styles/editor.css`, after `.block-picker-current-mark` (~line 2163):

```css
.block-picker-shortcut {
  color: var(--text-secondary);
  opacity: 0.6;
  font-size: 12px;
  line-height: 1;
  padding-left: 6px;
  font-feature-settings: "tnum";
}
```

- [ ] **Step 7: Verify in the app**

Run the extension (F5), open the slash menu. Confirm `#`, `##`, `###`, `-`, `1.`, `[]`, `"`, ` ``` ` appear right-aligned and muted on their respective rows; Text/Image/Table show nothing. Drill into "Turn into" → sub-rows show no shortcut. Check light + dark.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: `blockPicker` suite green with the new `shortcutForBlock` cases; overall unchanged otherwise.

- [ ] **Step 9: Commit**

```bash
git add src/webview/blockPicker.ts src/webview/styles/editor.css tests/blockPicker.test.ts
git commit -m "feat(c43): right-aligned markdown shortcut hints in block picker"
```

---

## After all tasks

- [ ] **Update docs before any push** (per project rule): add a c43 line to `CHANGELOG.md` and, if the README documents the slash menu, refresh it. Do this **before** pushing or bumping the extension version.
- [ ] **Mark c43 Done** in `TODO.md` (status column for the c43 row).

## Self-Review (completed during planning)

- **Spec coverage:** borderless icons (T1) ✓, tighter rows / less padding (T1) ✓, calmer section labels (T1) ✓, search stays on top (no change — confirmed) ✓, caption footer with nav hints + Back flip (T2) ✓, active/current affordance adapted for borderless icons (T1.3) ✓, shortcut hints flagged optional (T3) ✓, dark theme via tokens (global constraint) ✓, out-of-scope `.mp-menu` untouched (global constraint) ✓.
- **Placeholder scan:** none — every code/CSS step shows exact content.
- **Type consistency:** `footerCloseVerb(boolean)` and `shortcutForBlock(string)` signatures match between their definitions, tests, and call sites; new CSS classes (`.block-picker-footer`, `.bp-key`, `.bp-foot-verb`, `.block-picker-shortcut`) are consistent between the TS markup and the CSS rules.
