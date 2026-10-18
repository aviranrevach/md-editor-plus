# Conflict-Banner Side-by-Side Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "What changed ▾" reveal to the extension's external-edit conflict banner that expands a row-aligned, side-by-side diff (Your version | On disk) of the changed lines, so the Reload-vs-Keep choice isn't blind.

**Architecture:** A pure, dependency-free `conflictDiff.ts` (line-level LCS → aligned `change`/`add`/`del` rows, changed-region-only, capped) feeds a small DOM builder `conflictDiffView.ts`; `index.ts` wires both into the existing conflict banner and computes the diff once per conflict. An inert `openFullDiff()` seam is the hook for the future c24 viewer.

**Tech Stack:** TypeScript, Jest (ts-jest, jsdom for DOM tests), no new dependencies.

Spec: `docs/superpowers/specs/2026-06-16-conflict-diff-banner-design.md`

**Run all commands from the worktree root:**
`/Users/aviranrevach/AI Projects Aviran/MD viewer mscode/.claude/worktrees/feat+conflict-diff-banner-c29`
(`node_modules` is a symlink here; `npx jest`/`npx tsc`/`node esbuild.config.js` all work.)

---

## File Structure

- `src/webview/conflictDiff.ts` — CREATE. Pure line-diff → aligned rows. No DOM.
- `src/webview/conflictDiffView.ts` — CREATE. Builds the panel DOM from a `ConflictDiff`.
- `tests/conflictDiff.test.ts` — CREATE. Unit tests for the pure diff.
- `tests/conflictDiffView.test.ts` — CREATE (jsdom). Tests the DOM builder.
- `src/webview/index.ts` — MODIFY. Banner markup, reveal toggle, compute-on-conflict, `openFullDiff()` seam, clear-on-hide, imports.
- `src/webview/styles/editor.css` — MODIFY. Restructure `.conflict-banner` to a column (bar + panel) and add panel styles (light + `.theme-dark`).

Pre-existing failures unrelated to this work (do NOT fix, do NOT count as regressions): `tests/toggle.test.ts` (type-check) and `tests/board/grouping.test.ts` ("group band color").

---

### Task 1: Pure line-diff module

**Files:**
- Create: `src/webview/conflictDiff.ts`
- Test: `tests/conflictDiff.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { computeConflictDiff } from '../src/webview/conflictDiff';

describe('computeConflictDiff', () => {
  it('returns no rows for identical input', () => {
    expect(computeConflictDiff('a\nb\nc', 'a\nb\nc')).toEqual({ rows: [], truncated: 0 });
  });

  it('pairs a single changed line as one change row', () => {
    const d = computeConflictDiff('a\nB\nc', 'a\nX\nc');
    expect(d.rows).toEqual([{ kind: 'change', yours: 'B', disk: 'X' }]);
  });

  it('reports a disk-only line as add (yours null)', () => {
    const d = computeConflictDiff('a\nc', 'a\nb\nc');
    expect(d.rows).toEqual([{ kind: 'add', yours: null, disk: 'b' }]);
  });

  it('reports a yours-only line as del (disk null)', () => {
    const d = computeConflictDiff('a\nb\nc', 'a\nc');
    expect(d.rows).toEqual([{ kind: 'del', yours: 'b', disk: null }]);
  });

  it('pairs an uneven hunk: changes first, then leftover adds', () => {
    // yours: X      disk: P Q R   -> change(X,P), add(Q), add(R)
    const d = computeConflictDiff('top\nX\nbot', 'top\nP\nQ\nR\nbot');
    expect(d.rows).toEqual([
      { kind: 'change', yours: 'X', disk: 'P' },
      { kind: 'add', yours: null, disk: 'Q' },
      { kind: 'add', yours: null, disk: 'R' },
    ]);
  });

  it('excludes unchanged lines between changes (changed-region-only)', () => {
    const d = computeConflictDiff('A1\nsame\nB1', 'A2\nsame\nB2');
    expect(d.rows).toEqual([
      { kind: 'change', yours: 'A1', disk: 'A2' },
      { kind: 'change', yours: 'B1', disk: 'B2' },
    ]);
  });

  it('caps rows at maxRows and reports the remainder as truncated', () => {
    const yours = Array.from({ length: 10 }, (_, i) => `y${i}`).join('\n');
    const disk = Array.from({ length: 10 }, (_, i) => `d${i}`).join('\n');
    const d = computeConflictDiff(yours, disk, 4);
    expect(d.rows).toHaveLength(4);
    expect(d.truncated).toBe(6);
  });

  it('normalizes CRLF and ignores trailing blank lines', () => {
    expect(computeConflictDiff('a\r\nb\r\n', 'a\nb')).toEqual({ rows: [], truncated: 0 });
  });

  it('handles a realistic board change (status flip + added row + your-only row)', () => {
    const yours = '| Export | Todo | c15 |\n| RTL | c26 |';
    const disk  = '| Export | Done | c15 |\n| Diff viewer | c24 |';
    const d = computeConflictDiff(yours, disk);
    expect(d.rows).toEqual([
      { kind: 'change', yours: '| Export | Todo | c15 |', disk: '| Export | Done | c15 |' },
      { kind: 'change', yours: '| RTL | c26 |', disk: '| Diff viewer | c24 |' },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/conflictDiff.test.ts`
Expected: FAIL — `Cannot find module '../src/webview/conflictDiff'`.

- [ ] **Step 3: Implement the module**

Create `src/webview/conflictDiff.ts`:

```ts
// Pure, dependency-free line diff for the conflict banner. No DOM.
// Produces row-aligned side-by-side rows for ONLY the changed region.

export type DiffRowKind = 'change' | 'add' | 'del';
export interface DiffRow { kind: DiffRowKind; yours: string | null; disk: string | null; }
export interface ConflictDiff { rows: DiffRow[]; truncated: number; }

function splitLines(s: string): string[] {
  const t = s.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  return t === '' ? [] : t.split('\n');
}

type Op = { t: 'eq' | 'del' | 'add'; a?: string; b?: string };

// Classic LCS via DP, then backtrack into an ordered op list.
function lineOps(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: 'eq', a: a[i], b: b[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', a: a[i] }); i++; }
    else { ops.push({ t: 'add', b: b[j] }); j++; }
  }
  while (i < n) ops.push({ t: 'del', a: a[i++] });
  while (j < m) ops.push({ t: 'add', b: b[j++] });
  return ops;
}

export function computeConflictDiff(yours: string, disk: string, maxRows = 200): ConflictDiff {
  const ops = lineOps(splitLines(yours), splitLines(disk));
  const rows: DiffRow[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === 'eq') { k++; continue; }
    const dels: string[] = [];
    const adds: string[] = [];
    while (k < ops.length && ops[k].t !== 'eq') {
      if (ops[k].t === 'del') dels.push(ops[k].a as string);
      else adds.push(ops[k].b as string);
      k++;
    }
    const paired = Math.min(dels.length, adds.length);
    for (let p = 0; p < paired; p++) rows.push({ kind: 'change', yours: dels[p], disk: adds[p] });
    for (let p = paired; p < dels.length; p++) rows.push({ kind: 'del', yours: dels[p], disk: null });
    for (let p = paired; p < adds.length; p++) rows.push({ kind: 'add', yours: null, disk: adds[p] });
  }
  if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), truncated: rows.length - maxRows };
  return { rows, truncated: 0 };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/conflictDiff.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/conflictDiff.ts tests/conflictDiff.test.ts
git commit -m "feat(conflict): pure line-diff for the conflict banner (c29)"
```

---

### Task 2: Panel DOM builder

**Files:**
- Create: `src/webview/conflictDiffView.ts`
- Test: `tests/conflictDiffView.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
/** @jest-environment jsdom */
import { buildConflictDiffPanel } from '../src/webview/conflictDiffView';
import type { ConflictDiff } from '../src/webview/conflictDiff';

const diff = (rows: ConflictDiff['rows'], truncated = 0): ConflictDiff => ({ rows, truncated });

describe('buildConflictDiffPanel', () => {
  it('renders one .conflict-pair per row with the right cell classes', () => {
    const el = buildConflictDiffPanel(diff([
      { kind: 'change', yours: 'B', disk: 'X' },
      { kind: 'del', yours: 'gone', disk: null },
      { kind: 'add', yours: null, disk: 'new' },
    ]));
    const pairs = el.querySelectorAll('.conflict-pair');
    expect(pairs).toHaveLength(3);
    expect(pairs[0].children[0].className).toContain('change');
    expect(pairs[0].children[1].className).toContain('change');
    expect(pairs[1].children[0].className).toContain('del');
    expect(pairs[1].children[1].className).toContain('empty');
    expect(pairs[2].children[0].className).toContain('empty');
    expect(pairs[2].children[1].className).toContain('add');
  });

  it('puts yours on the left cell and disk on the right cell', () => {
    const el = buildConflictDiffPanel(diff([{ kind: 'change', yours: 'L', disk: 'R' }]));
    const pair = el.querySelector('.conflict-pair')!;
    expect(pair.children[0].textContent).toBe('L');
    expect(pair.children[1].textContent).toBe('R');
  });

  it('shows a "no line differences" note when there are no rows', () => {
    const el = buildConflictDiffPanel(diff([]));
    expect(el.querySelectorAll('.conflict-pair')).toHaveLength(0);
    expect(el.textContent).toContain('No line differences');
  });

  it('reports the truncated count in the footer', () => {
    const el = buildConflictDiffPanel(diff([{ kind: 'add', yours: null, disk: 'x' }], 5));
    expect(el.querySelector('.conflict-foot')!.textContent).toContain('+5 more');
  });

  it('fires onOpenFullDiff when the "Open full diff" link is clicked', () => {
    const onOpenFullDiff = jest.fn();
    const el = buildConflictDiffPanel(diff([{ kind: 'add', yours: null, disk: 'x' }]), { onOpenFullDiff });
    el.querySelector<HTMLElement>('.conflict-openfull')!.click();
    expect(onOpenFullDiff).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/conflictDiffView.test.ts`
Expected: FAIL — `Cannot find module '../src/webview/conflictDiffView'`.

- [ ] **Step 3: Implement the builder**

Create `src/webview/conflictDiffView.ts`:

```ts
import type { ConflictDiff, DiffRow } from './conflictDiff';

export interface ConflictDiffPanelOptions { onOpenFullDiff?: () => void; }

function cell(kind: 'change' | 'add' | 'del' | 'empty', text: string): HTMLDivElement {
  const c = document.createElement('div');
  c.className = `conflict-cell ${kind}`;
  c.textContent = text;
  return c;
}

/** Builds the panel content (header + aligned grid + footer) from a diff. Pure DOM, no app deps. */
export function buildConflictDiffPanel(diff: ConflictDiff, opts: ConflictDiffPanelOptions = {}): HTMLElement {
  const wrap = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'conflict-panel-head';
  const hy = document.createElement('div'); hy.textContent = 'Your version';
  const hd = document.createElement('div'); hd.textContent = 'On disk';
  head.append(hy, hd);
  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'conflict-grid';
  for (const row of diff.rows) {
    const pair = document.createElement('div');
    pair.className = 'conflict-pair';
    let left: HTMLDivElement;
    let right: HTMLDivElement;
    if (row.kind === 'change') {
      left = cell('change', row.yours ?? '');
      right = cell('change', row.disk ?? '');
    } else if (row.kind === 'del') {
      left = cell('del', row.yours ?? '');
      right = cell('empty', '');
    } else {
      left = cell('empty', '');
      right = cell('add', row.disk ?? '');
    }
    pair.append(left, right);
    grid.appendChild(pair);
  }
  wrap.appendChild(grid);

  const foot = document.createElement('div');
  foot.className = 'conflict-foot';
  if (diff.rows.length === 0) {
    foot.textContent = 'No line differences.';
    wrap.appendChild(foot);
    return wrap;
  }
  const n = diff.rows.length;
  foot.append(document.createTextNode(
    `${n} changed line${n === 1 ? '' : 's'}${diff.truncated ? ` (+${diff.truncated} more)` : ''} · `,
  ));
  const link = document.createElement('span');
  link.className = 'conflict-openfull';
  link.textContent = 'Open full diff →';
  link.addEventListener('click', () => opts.onOpenFullDiff?.());
  foot.appendChild(link);
  wrap.appendChild(foot);
  return wrap;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/conflictDiffView.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/conflictDiffView.ts tests/conflictDiffView.test.ts
git commit -m "feat(conflict): panel DOM builder for the side-by-side diff (c29)"
```

---

### Task 3: Wire into the banner + styles

**Files:**
- Modify: `src/webview/index.ts` (imports line 1-5 area; banner markup ~281-286; refs + toggle + render + seam near the existing banner handlers ~312-341; conflict block ~1073-1078; clear-on-hide ~318-323)
- Modify: `src/webview/styles/editor.css` (`.conflict-banner` block ~2756-2772; append panel styles)

- [ ] **Step 1: Add imports**

In `src/webview/index.ts`, directly after the existing editor import block (the import on line 5 ends with `} from './editor';`), add:

```ts
import { computeConflictDiff } from './conflictDiff';
import { buildConflictDiffPanel } from './conflictDiffView';
```

- [ ] **Step 2: Restructure the banner markup**

Replace the banner `innerHTML` assignment (currently lines ~281-286):

```ts
  conflictBanner.innerHTML = `
    <span class="conflict-banner-icon" aria-hidden="true">⚠</span>
    <span class="conflict-banner-text">This file was changed outside the editor while you have unsaved changes.</span>
    <button type="button" class="conflict-banner-btn primary" id="conflict-reload">Reload from disk</button>
    <button type="button" class="conflict-banner-btn" id="conflict-keep">Keep my version</button>
  `;
```

with:

```ts
  conflictBanner.innerHTML = `
    <div class="conflict-bar">
      <span class="conflict-banner-icon" aria-hidden="true">⚠</span>
      <span class="conflict-banner-text">This file was changed outside the editor while you have unsaved changes.</span>
      <button type="button" class="conflict-reveal" id="conflict-reveal" aria-expanded="false">What changed ▾</button>
      <button type="button" class="conflict-banner-btn primary" id="conflict-reload">Reload from disk</button>
      <button type="button" class="conflict-banner-btn" id="conflict-keep">Keep my version</button>
    </div>
    <div class="conflict-panel" id="conflict-panel" hidden></div>
  `;
```

- [ ] **Step 3: Add refs, the reveal toggle, the render helper, and the c24 seam**

Immediately after `document.body.appendChild(conflictBanner);` (line ~287), add:

```ts
  const conflictReveal = conflictBanner.querySelector<HTMLElement>('#conflict-reveal');
  const conflictPanel  = conflictBanner.querySelector<HTMLElement>('#conflict-panel');

  function setRevealOpen(open: boolean): void {
    if (!conflictPanel || !conflictReveal) return;
    if (open) conflictPanel.removeAttribute('hidden');
    else conflictPanel.setAttribute('hidden', '');
    conflictReveal.setAttribute('aria-expanded', String(open));
    conflictReveal.textContent = open ? 'What changed ▴' : 'What changed ▾';
  }

  // Build the (collapsed) diff panel for the current conflict. Computed once per
  // conflict — not on every keystroke. Both versions are in hand at conflict time.
  function renderConflictPanel(yours: string, disk: string): void {
    if (!conflictPanel) return;
    const diff = computeConflictDiff(normalizeMd(yours), normalizeMd(disk));
    conflictPanel.replaceChildren(buildConflictDiffPanel(diff, { onOpenFullDiff: openFullDiff }));
    setRevealOpen(false); // collapsed by default
  }

  // Seam for the future full diff viewer (c24). Intentionally inert for now.
  function openFullDiff(): void { /* c24: open the full side-by-side diff viewer here */ }

  conflictReveal?.addEventListener('click', () => {
    setRevealOpen(conflictPanel?.hasAttribute('hidden') ?? false);
  });
```

- [ ] **Step 4: Clear the panel when the banner hides**

In `hideConflictBanner()` (lines ~318-323), add panel teardown. Replace:

```ts
  function hideConflictBanner(): void {
    conflictBanner.classList.remove('visible');
    document.documentElement.classList.remove('conflict-active');
    applySaveEvent('conflictResolved');
    vscode.postMessage({ type: 'conflictPause', paused: false });
  }
```

with:

```ts
  function hideConflictBanner(): void {
    conflictBanner.classList.remove('visible');
    document.documentElement.classList.remove('conflict-active');
    conflictPanel?.replaceChildren();
    setRevealOpen(false);
    applySaveEvent('conflictResolved');
    vscode.postMessage({ type: 'conflictPause', paused: false });
  }
```

- [ ] **Step 5: Compute the diff when a conflict is detected**

In the inbound 'update' handler, the conflict branch (lines ~1073-1078) currently reads:

```ts
      if (decision === 'conflict') {
        // External content differs from unsent local edits — surface a banner
        // so the user picks, rather than silently overwriting either side.
        pendingExternalMarkdown = msg.markdown;
        showConflictBanner();
        return;
      }
```

Replace with (build the panel from both versions before showing):

```ts
      if (decision === 'conflict') {
        // External content differs from unsent local edits — surface a banner
        // so the user picks, rather than silently overwriting either side.
        pendingExternalMarkdown = msg.markdown;
        renderConflictPanel(getCurrentMarkdown(), msg.markdown);
        showConflictBanner();
        return;
      }
```

- [ ] **Step 6: Restructure the banner CSS to a column (bar + panel) and add panel styles**

In `src/webview/styles/editor.css`, replace the `.conflict-banner` rule and its `.visible` line (lines ~2756-2772) — change it from a centered flex row to a column, and move the row layout/padding onto a new `.conflict-bar`:

Replace:

```css
.conflict-banner {
  position: fixed;
  top: 48px;
  left: 0;
  right: 0;
  z-index: 49;
  display: none;
  align-items: center;
  gap: 12px;
  padding: 9px 16px;
  background: #fff4ce;
  border-bottom: 1px solid #e3c97a;
  color: #5a4814;
  font-size: 13px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.conflict-banner.visible { display: flex; }
```

with:

```css
.conflict-banner {
  position: fixed;
  top: 48px;
  left: 0;
  right: 0;
  z-index: 49;
  display: none;
  flex-direction: column;
  background: #fff4ce;
  border-bottom: 1px solid #e3c97a;
  color: #5a4814;
  font-size: 13px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.conflict-banner.visible { display: flex; }
.conflict-bar { display: flex; align-items: center; gap: 12px; padding: 9px 16px; }
```

Then append, at the end of the existing conflict-banner CSS group (right after the `.conflict-banner-btn.primary:hover` rule, ~line 2798), this block:

```css
/* "What changed" reveal + side-by-side diff panel (c29) */
.conflict-reveal {
  padding: 4px 10px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.conflict-reveal:hover { background: rgba(0, 0, 0, 0.06); }
.theme-dark .conflict-reveal:hover { background: rgba(255, 255, 255, 0.08); }

.conflict-panel { border-top: 1px solid #e3c97a; background: rgba(255, 255, 255, 0.45); }
.theme-dark .conflict-panel { border-top-color: #7a6532; background: rgba(0, 0, 0, 0.15); }
.conflict-panel[hidden] { display: none; }

.conflict-panel-head { display: flex; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; }
.conflict-panel-head div { flex: 1; padding: 6px 16px; }
.conflict-panel-head div:first-child { border-right: 1px solid #e3c97a; }
.theme-dark .conflict-panel-head div:first-child { border-right-color: #7a6532; }

.conflict-grid { max-height: 38vh; overflow: auto; }
.conflict-pair { display: flex; }
.conflict-cell {
  flex: 1;
  min-width: 0;
  padding: 3px 16px;
  font-family: ui-monospace, Menlo, Monaco, monospace;
  font-size: 11.5px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conflict-cell:first-child { border-right: 1px solid #e3c97a; }
.theme-dark .conflict-cell:first-child { border-right-color: #7a6532; }
.conflict-cell.add { background: rgba(34, 197, 94, 0.18); }
.conflict-cell.del { background: rgba(239, 68, 68, 0.16); }
.conflict-cell.change { background: rgba(234, 179, 8, 0.2); }
.conflict-cell.empty {
  background: repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(0, 0, 0, 0.045) 6px, rgba(0, 0, 0, 0.045) 12px);
}
.theme-dark .conflict-cell.empty {
  background: repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(255, 255, 255, 0.05) 6px, rgba(255, 255, 255, 0.05) 12px);
}
.conflict-foot { padding: 6px 16px; font-size: 11px; opacity: 0.7; border-top: 1px solid #e3c97a; }
.theme-dark .conflict-foot { border-top-color: #7a6532; }
.conflict-openfull { color: var(--link); cursor: pointer; }
.conflict-openfull:hover { text-decoration: underline; }
```

- [ ] **Step 7: Type-check and build**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "toggle.ts"`
Expected: no output (no new type errors; pre-existing toggle.ts excluded).

Run: `node esbuild.config.js`
Expected: `Webview built.`

- [ ] **Step 8: Commit**

```bash
git add src/webview/index.ts src/webview/styles/editor.css
git commit -m "feat(conflict): wire side-by-side diff panel into the conflict banner (c29)"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite — no new failures**

Run: `npx jest 2>&1 | tail -5`
Expected: only the two pre-existing failures remain (`tests/toggle.test.ts`, `tests/board/grouping.test.ts`); the new `conflictDiff` (9) and `conflictDiffView` (5) suites pass.

- [ ] **Step 2: Confirm the build bundle contains the feature**

Run: `grep -c "conflict-panel\|computeConflictDiff\|What changed" dist/webview.js`
Expected: a non-zero count (the feature is bundled).

- [ ] **Step 3: Commit any remaining cleanup (if needed)**

```bash
git status --short
git add -A 2>/dev/null && git commit -m "chore(conflict): c29 verification" 2>/dev/null || echo "nothing to commit"
```

---

## Notes for the implementer

- Keep all diff logic in `conflictDiff.ts` (pure) and DOM in `conflictDiffView.ts`; `index.ts` only wires them. This keeps the heavy logic unit-tested.
- `normalizeMd` already exists in `index.ts` — reuse it (don't reimplement) when calling `computeConflictDiff`.
- The panel is collapsed by default; the diff is computed once per conflict in `renderConflictPanel`, not on reveal-toggle and not per keystroke.
- `openFullDiff()` is intentionally empty — it's the labeled seam for c24. Do not build the full viewer here.
- Manual smoke test (optional, not required to pass the plan): in the Extension Development Host, open the same file in the board editor and a text split, edit + save the text side, then add a row in the board side to trigger the banner; click "What changed" and confirm the aligned diff renders.
