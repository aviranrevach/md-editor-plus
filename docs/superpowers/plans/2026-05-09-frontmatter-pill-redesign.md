# Frontmatter Indicator Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prominent `FRONTMATTER · N lines` pill above the document body with a small numeric badge on the Code segment of the Preview/Code view toggle.

**Architecture:** Frontmatter parsing/round-trip is already done by [src/webview/frontmatter.ts](../../../src/webview/frontmatter.ts) and is unchanged. The editor module ([src/webview/editor.ts](../../../src/webview/editor.ts)) currently mounts a DOM pill from inside its module; we replace that with a small public API (`getFrontmatterInfo` + a change listener) that the toolbar wiring in [src/webview/index.ts](../../../src/webview/index.ts) consumes to update a badge defined in the toolbar HTML at [src/mdEditorPlusProvider.ts](../../../src/mdEditorPlusProvider.ts).

**Tech Stack:** TypeScript, esbuild webview bundle, Tiptap editor, Jest+ts-jest (node env, no jsdom).

**Spec:** [docs/superpowers/specs/2026-05-09-frontmatter-pill-redesign-design.md](../specs/2026-05-09-frontmatter-pill-redesign-design.md)

---

## File Map

- **Modify:** `src/webview/frontmatter.ts` — add `frontmatterInfo(md)` pure helper that returns `{ lines, kind }`.
- **Create:** `tests/frontmatter.test.ts` — unit tests for the new helper plus regression coverage for `splitFrontmatter` / `countFrontmatterLines` since we now rely on `kind`.
- **Modify:** `src/webview/editor.ts` — drop the pill DOM (`_fmIndicator`, `_fmHostEl`, `_onSwitchToSource`, `setSourceViewSwitcher`, `refreshFrontmatterIndicator`). Add `getFrontmatterInfo()` + `setFrontmatterChangeListener()` public API. Notify the listener on `createEditor` and `updateContent`.
- **Modify:** `src/mdEditorPlusProvider.ts` — add `<span class="fm-badge hidden" id="fm-badge" aria-hidden="true"></span>` inside the Code button on the toolbar.
- **Modify:** `src/webview/index.ts` — drop the `setSourceViewSwitcher` import + the call that wired it. Subscribe to the editor's frontmatter listener; toggle `.hidden` on the badge, set its text, swap the Code button's `data-tip`.
- **Modify:** `src/webview/styles/editor.css` — delete the `.fm-indicator` block. Add `.fm-badge`.
- **Modify:** `demo.md` — remove the YAML frontmatter block and the Tip callout that mentions the pill.

No test infrastructure exists for the WYSIWYG DOM (jest is on `testEnvironment: node`). The pure helper in `frontmatter.ts` is the right testable seam; the toolbar wiring is verified by manual extension run.

---

## Task 1: Add the `frontmatterInfo` pure helper (TDD)

**Files:**
- Create: `tests/frontmatter.test.ts`
- Modify: `src/webview/frontmatter.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/frontmatter.test.ts`:

```ts
import {
  splitFrontmatter,
  countFrontmatterLines,
  frontmatterInfo,
} from '../src/webview/frontmatter';

describe('splitFrontmatter', () => {
  it('returns kind=none for plain markdown', () => {
    const r = splitFrontmatter('# Hello\n\nNo frontmatter here.');
    expect(r.kind).toBe('none');
    expect(r.frontmatter).toBe('');
    expect(r.body).toBe('# Hello\n\nNo frontmatter here.');
  });

  it('returns kind=yaml and strips a leading YAML block', () => {
    const md = '---\ntitle: A\ntags: [x]\n---\n\n# Body\n';
    const r = splitFrontmatter(md);
    expect(r.kind).toBe('yaml');
    expect(r.frontmatter).toBe('---\ntitle: A\ntags: [x]\n---\n');
    expect(r.body).toBe('\n# Body\n');
  });

  it('returns kind=toml and strips a leading TOML block', () => {
    const md = '+++\ntitle = "A"\n+++\n# Body\n';
    const r = splitFrontmatter(md);
    expect(r.kind).toBe('toml');
    expect(r.frontmatter).toBe('+++\ntitle = "A"\n+++\n');
    expect(r.body).toBe('# Body\n');
  });
});

describe('countFrontmatterLines', () => {
  it('returns 0 for empty input', () => {
    expect(countFrontmatterLines('')).toBe(0);
  });

  it('counts the inner lines of a YAML block', () => {
    expect(countFrontmatterLines('---\ntitle: A\ntags: [x]\n---\n')).toBe(2);
  });

  it('counts a single-line YAML block as 1', () => {
    expect(countFrontmatterLines('---\ntitle: A\n---\n')).toBe(1);
  });

  it('counts the inner lines of a TOML block', () => {
    expect(countFrontmatterLines('+++\ntitle = "A"\nauthor = "B"\n+++\n')).toBe(2);
  });
});

describe('frontmatterInfo', () => {
  it('reports kind=none and lines=0 for plain markdown', () => {
    expect(frontmatterInfo('# Hello\n')).toEqual({ kind: 'none', lines: 0 });
  });

  it('reports kind=yaml and the inner line count', () => {
    const md = '---\ntitle: A\ntags: [x]\ndate: 2026-05-09\n---\n\n# Body';
    expect(frontmatterInfo(md)).toEqual({ kind: 'yaml', lines: 3 });
  });

  it('reports kind=toml and the inner line count', () => {
    const md = '+++\ntitle = "A"\n+++\n# Body';
    expect(frontmatterInfo(md)).toEqual({ kind: 'toml', lines: 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/frontmatter.test.ts -v`
Expected: PASS for the existing `splitFrontmatter` / `countFrontmatterLines` cases; FAIL for the `frontmatterInfo` cases with `frontmatterInfo is not a function` (or import error).

- [ ] **Step 3: Add the helper to `src/webview/frontmatter.ts`**

Append to the file:

```ts
export function frontmatterInfo(md: string): {
  lines: number;
  kind: 'yaml' | 'toml' | 'none';
} {
  const split = splitFrontmatter(md);
  return {
    kind: split.kind,
    lines: countFrontmatterLines(split.frontmatter),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/frontmatter.test.ts -v`
Expected: All cases PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/frontmatter.test.ts src/webview/frontmatter.ts
git commit -m "test(frontmatter): cover splitter/counter and add frontmatterInfo helper"
```

---

## Task 2: Replace the editor's pill DOM with a public state API

**Files:**
- Modify: `src/webview/editor.ts`

- [ ] **Step 1: Replace module-level pill state with a kind/listener pair**

Open [src/webview/editor.ts](../../../src/webview/editor.ts).

Update the import at line 24 to bring in the new helper:

```ts
import { splitFrontmatter, frontmatterInfo } from './frontmatter';
```

(The `countFrontmatterLines` import is no longer needed in this file — remove it.)

Replace lines 30–33 (the four pill-related module-level vars) with:

```ts
let _frontmatter = '';
let _onFrontmatterChange: ((info: { lines: number; kind: 'yaml' | 'toml' | 'none' }) => void) | null = null;
```

`_frontmatter` is the only piece of state we keep — `getFrontmatterInfo()` re-derives `kind` and `lines` from it on each call, which is cheap (a single regex match on a short string).

- [ ] **Step 2: Delete the pill helpers**

Delete the `setSourceViewSwitcher` function (lines 61–63) entirely.

Delete the `refreshFrontmatterIndicator` function (lines 65–93) entirely.

- [ ] **Step 3: Add the new public API in their place**

In place of the deleted block, add:

```ts
export function getFrontmatterInfo(): {
  lines: number;
  kind: 'yaml' | 'toml' | 'none';
} {
  return frontmatterInfo(_frontmatter);
}

export function setFrontmatterChangeListener(
  fn: (info: { lines: number; kind: 'yaml' | 'toml' | 'none' }) => void,
): void {
  _onFrontmatterChange = fn;
}

function notifyFrontmatterChange(): void {
  _onFrontmatterChange?.(getFrontmatterInfo());
}
```

The toolbar registers the listener during `init()`, before the webview receives its `init` message and calls `createEditor`. `createEditor` (and any subsequent `updateContent`) fires `notifyFrontmatterChange()`, which is where the badge gets its initial and ongoing state. We do not fire on registration — initial markdown isn't loaded yet at that point.

- [ ] **Step 4: Update `createEditor` to notify**

In `createEditor` (around lines 97–152):

- Remove `_fmHostEl = element;` (line 102) — the editor no longer mounts any DOM at the host element other than tiptap itself.
- Lines 103–104 stay as they are (`splitFrontmatter` + assigning `_frontmatter`).
- Replace `refreshFrontmatterIndicator();` (line 150) with `notifyFrontmatterChange();`.

- [ ] **Step 5: Update `updateContent` likewise**

In `updateContent` (around lines 154–167):

- Lines 156–157 stay as they are (`splitFrontmatter` + assigning `_frontmatter`).
- Replace `refreshFrontmatterIndicator();` (line 166) with `notifyFrontmatterChange();`.

- [ ] **Step 6: Run the type check / build to verify no broken references**

Run: `npm run compile`
Expected: Build succeeds. (If anything still references `setSourceViewSwitcher` or pill internals, the TypeScript compile or esbuild step will fail — fix those callers in Task 3.)

> If the build fails on `setSourceViewSwitcher` not being exported from editor.ts, that is expected — Task 3 fixes the caller. Skip to Task 3 and re-run the build there.

- [ ] **Step 7: Commit**

```bash
git add src/webview/editor.ts
git commit -m "refactor(editor): replace frontmatter pill DOM with state listener API"
```

---

## Task 3: Add the badge HTML to the toolbar and wire it from index.ts

**Files:**
- Modify: `src/mdEditorPlusProvider.ts:214`
- Modify: `src/webview/index.ts`

- [ ] **Step 1: Add the badge `<span>` to the Code button**

Open [src/mdEditorPlusProvider.ts](../../../src/mdEditorPlusProvider.ts).

Replace line 214 with:

```ts
      <button class="seg-btn" data-view="source" data-tip="Source view — raw markdown">${iCode}<span class="seg-label">Code</span><span class="fm-badge hidden" id="fm-badge" aria-hidden="true"></span></button>
```

(Same line, only addition is the trailing `<span class="fm-badge hidden" id="fm-badge" aria-hidden="true"></span>`.)

- [ ] **Step 2: Update the editor import in `index.ts`**

Open [src/webview/index.ts](../../../src/webview/index.ts).

Replace line 4 with:

```ts
import { createEditor, updateContent, createSourceEditor, updateSourceContent, getSourceMarkdown, getCurrentMarkdown, setFrontmatterChangeListener, setMediaBaseUri } from './editor';
```

(Removed: `setSourceViewSwitcher`. Added: `setFrontmatterChangeListener`.)

- [ ] **Step 3: Replace the pill switcher wiring with badge wiring**

Find lines 262–263:

```ts
  // Let the editor module switch us to source view (used by the frontmatter pill).
  setSourceViewSwitcher(() => setView('source'));
```

Replace with:

```ts
  // Frontmatter badge on the Code view-toggle button. Surfaces that the file
  // has YAML/TOML frontmatter without putting chrome above the document body.
  const fmBadge = document.getElementById('fm-badge') as HTMLElement | null;
  const codeBtn = viewBtns.find(b => b.dataset.view === 'source') ?? null;
  setFrontmatterChangeListener(({ lines, kind }) => {
    const present = kind !== 'none' && lines > 0;
    if (fmBadge) {
      fmBadge.classList.toggle('hidden', !present);
      fmBadge.textContent = present ? String(lines) : '';
    }
    if (codeBtn) {
      codeBtn.dataset.tip = present
        ? `Source view — raw markdown · ${lines} ${lines === 1 ? 'line' : 'lines'} of frontmatter`
        : 'Source view — raw markdown';
    }
  });
```

- [ ] **Step 4: Run the type check / build**

Run: `npm run compile`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/mdEditorPlusProvider.ts src/webview/index.ts
git commit -m "feat(toolbar): show frontmatter badge on Code view-toggle button"
```

---

## Task 4: Style the badge and remove the old pill CSS

**Files:**
- Modify: `src/webview/styles/editor.css:290-312`

- [ ] **Step 1: Delete the `.fm-indicator` block**

Open [src/webview/styles/editor.css](../../../src/webview/styles/editor.css).

Delete lines 290–312 (the entire `/* Frontmatter indicator … */` comment and all `.fm-indicator` rules through the `#editor.width-full .fm-indicator` rule).

- [ ] **Step 2: Add the `.fm-badge` styles**

In place of the deleted block, add:

```css
/* Frontmatter badge — small numeric pill shown inside the Code segment of the
   view toggle when the document has YAML/TOML frontmatter. */
.fm-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  margin-left: 4px;
  border-radius: 7px;
  background: var(--link);
  color: #ffffff;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
}
.fm-badge.hidden { display: none; }
```

The badge is an inline flex child of `.seg-btn`, which already has `display: flex` and `overflow: hidden`. Inline placement avoids the clipping that absolute positioning would hit.

- [ ] **Step 3: Run the build**

Run: `npm run compile`
Expected: Build succeeds. The webview bundle now contains the new CSS and no `.fm-indicator` references.

- [ ] **Step 4: Commit**

```bash
git add src/webview/styles/editor.css
git commit -m "style(toolbar): add .fm-badge, drop .fm-indicator pill"
```

---

## Task 5: Clean up demo.md

**Files:**
- Modify: `demo.md`

- [ ] **Step 1: Remove the YAML block at the top of demo.md**

Open [demo.md](../../../demo.md) and delete lines 1–6 (the `---\ntitle: …\n…\n---\n\n` YAML block plus the trailing blank line). The file should now begin with:

```markdown
# MD Editor Plus
```

- [ ] **Step 2: Remove the Tip callout that mentions the pill**

Find the callout that reads:

```markdown
> [!TIP]
> The pill at the very top says **FRONTMATTER · 5 lines** — click it to jump straight into the YAML block in Code view.
```

Delete those two lines. If a stray blank line remains adjacent, collapse to a single blank line so paragraph spacing matches the rest of the file.

- [ ] **Step 3: Verify the file still parses cleanly**

Run: `head -20 demo.md`
Expected: First non-blank line is `# MD Editor Plus`. No `---` fence at the top. No mention of "FRONTMATTER · 5 lines".

- [ ] **Step 4: Commit**

```bash
git add demo.md
git commit -m "docs(demo): drop frontmatter block and pill mention"
```

---

## Task 6: Manual verification + final type check

This task validates the full acceptance criteria from the spec since the wiring crosses TypeScript, HTML, CSS, and the live VS Code webview, which has no automated test coverage.

- [ ] **Step 1: Type check + build**

Run: `npm run compile`
Expected: PASS, no errors, no warnings about unused exports.

- [ ] **Step 2: Search for any leftover pill references**

Run: `grep -rn "fm-indicator\|setSourceViewSwitcher\|refreshFrontmatterIndicator\|FRONTMATTER · " src/ demo.md`
Expected: No matches.

Run: `grep -rn "_fmIndicator\|_fmHostEl\|_onSwitchToSource" src/`
Expected: No matches.

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: All tests pass, including the new `tests/frontmatter.test.ts`.

- [ ] **Step 4: Launch the extension in VS Code Extension Host**

Open the project in VS Code and press F5 (this uses the `.vscode/launch.json` already configured). A second VS Code window opens with the extension loaded.

In the new window:

- [ ] **Step 5: Verify badge hidden on demo.md**

Open `demo.md`. Confirm:
- No pill above the H1.
- The Code button shows no badge (only the `<>` icon, no number).
- Hover the Code button: tooltip reads `Source view — raw markdown` (no frontmatter clause).
- The H1 `# MD Editor Plus` is the first visible content.

- [ ] **Step 6: Verify badge appears on a file with YAML frontmatter**

Create a temporary file `/tmp/fm-test.md` with:

```markdown
---
title: Test
author: A
date: 2026-05-09
---

# Hello
```

Open it in the extension. Confirm:
- A small numeric badge `3` appears on the Code button.
- Hover tooltip on Code reads `Source view — raw markdown · 3 lines of frontmatter`.
- No pill above the H1.

- [ ] **Step 7: Verify badge updates when toggling to/from Source view**

While `/tmp/fm-test.md` is open:
- Click Code. Source view shows the YAML at the top of the document.
- Add a fourth line `tags: [x]` inside the `---` block. Click Preview.
- Confirm the badge now reads `4` and the tooltip now says `… · 4 lines of frontmatter`.

- [ ] **Step 8: Verify badge disappears when frontmatter is removed**

While in Source view, delete the entire `---` block (including both fences). Click Preview.
- Confirm the badge is hidden and the tooltip is back to `Source view — raw markdown`.

- [ ] **Step 9: Verify TOML frontmatter works**

Create `/tmp/fm-toml.md`:

```markdown
+++
title = "Test"
+++

# Hello
```

Open it. Confirm the badge reads `1` and the tooltip says `… · 1 line of frontmatter` (singular).

- [ ] **Step 10: Push**

If all manual checks pass:

```bash
git push
```

---

## Notes for the implementer

- The toolbar HTML lives inside a template literal in [src/mdEditorPlusProvider.ts:200-220](../../../src/mdEditorPlusProvider.ts#L200-L220); the icons (`iCode`, `iEye`, `iAa`, `iDots`) are imported from a separate icons module. Don't replace `${iCode}` — only add the badge span after `<span class="seg-label">Code</span>`.
- The webview is bundled with esbuild (see `npm run compile`); CSS is imported via `import editorCss from './styles/editor.css'` at the top of `index.ts` and concatenated into a `<style>` tag at runtime. There is no separate CSS build step.
- `setFrontmatterChangeListener` does **not** fire the callback on registration; the toolbar gets initial state from the `notifyFrontmatterChange` call inside `createEditor`. Order is guaranteed because the toolbar wiring runs synchronously inside `init()` (line ~263) and `createEditor` runs later inside the async `init`-message handler (line ~624).
- The `.seg-btn .seg-label` rule uses `max-width: 0; opacity: 0` to hide the label on inactive segments. The badge is a sibling of `.seg-label` (not inside it), so it remains visible whether the Code button is active or inactive — which is what we want, since the badge's job is to advertise frontmatter while the user is in Preview view.
