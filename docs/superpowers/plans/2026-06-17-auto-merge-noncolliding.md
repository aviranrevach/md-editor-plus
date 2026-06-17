# Auto-merge Non-Colliding External Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the editor has unsaved edits and the file changes on disk, silently merge the two if they touch different lines (3-way line merge); only show the conflict banner when they truly overlap.

**Architecture:** A pure, DOM-free `merge3(base, ours, theirs): string | null` (LCS hunk diff; disjoint → merged text, overlap/same-start/ambiguous → `null`). The webview's `'update'` conflict branch tries `merge3` first (base = `lastSent`); on success it applies the merge silently and re-sends; on `null` it shows the banner exactly as today.

**Tech Stack:** TypeScript, Jest (ts-jest). No new dependencies. No vscode import in `merge3.ts`.

## Global Constraints

- `src/webview/merge3.ts` MUST NOT import vscode (pure, unit-testable).
- Safety: merge ONLY when provably non-overlapping; any overlap, same-start, or missing base → `null` → conflict banner. Never fabricate.
- Pre-existing failures unrelated to this work — do NOT fix, do NOT count as regressions: `tests/toggle.test.ts`, `tests/board/grouping.test.ts`.
- Run all commands from the worktree root: `/Users/aviranrevach/AI Projects Aviran/MD viewer mscode/.claude/worktrees/feat+auto-merge-noncolliding-c28b` (`node_modules` symlinked; `npx jest`/`npx tsc`/`node esbuild.config.js` work).

---

## File Structure

- `src/webview/merge3.ts` — CREATE. Pure 3-way line merge + internal LCS hunk diff.
- `tests/merge3.test.ts` — CREATE.
- `src/webview/index.ts` — MODIFY. Import `merge3`; attempt it in the conflict branch before the banner.

---

### Task 1: Pure 3-way line merge

**Files:**
- Create: `src/webview/merge3.ts`
- Test: `tests/merge3.test.ts`

**Interfaces:**
- Produces: `merge3(base: string, ours: string, theirs: string): string | null` — merged text, or `null` when a safe merge isn't possible.

- [ ] **Step 1: Write the failing tests**

```ts
import { merge3 } from '../src/webview/merge3';

describe('merge3', () => {
  it('returns the text when ours === theirs', () => {
    expect(merge3('a\nb', 'a\nX', 'a\nX')).toBe('a\nX');
  });

  it('takes theirs when only theirs changed (base === ours)', () => {
    expect(merge3('a\nb\nc', 'a\nb\nc', 'a\nB\nc')).toBe('a\nB\nc');
  });

  it('takes ours when only ours changed (base === theirs)', () => {
    expect(merge3('a\nb\nc', 'a\nB\nc', 'a\nb\nc')).toBe('a\nB\nc');
  });

  it('merges disjoint edits (ours edits first line, theirs edits last line)', () => {
    expect(merge3('a\nb\nc', 'A\nb\nc', 'a\nb\nC')).toBe('A\nb\nC');
  });

  it('merges a top insertion (ours) with a bottom insertion (theirs)', () => {
    expect(merge3('a\nb', 'top\na\nb', 'a\nb\nbot')).toBe('top\na\nb\nbot');
  });

  it('returns null when both edit the same line differently', () => {
    expect(merge3('a\nb\nc', 'a\nOURS\nc', 'a\nTHEIRS\nc')).toBeNull();
  });

  it('returns null when the changed ranges overlap', () => {
    // ours replaces lines 2-3, theirs replaces lines 3-4 → overlap at line 3
    expect(merge3('a\nb\nc\nd', 'a\nX\nY\nd', 'a\nb\nP\nQ')).toBeNull();
  });

  it('returns null for two insertions at the same point', () => {
    expect(merge3('a\nb', 'a\nMINE\nb', 'a\nTHEIRS\nb')).toBeNull();
  });

  it('merges edits to different board rows (realistic)', () => {
    const base = '| A | Todo | c1 |\n| B | Todo | c2 |\n| C | Todo | c3 |';
    const ours = '| A | Done | c1 |\n| B | Todo | c2 |\n| C | Todo | c3 |';   // edited row A
    const theirs = '| A | Todo | c1 |\n| B | Todo | c2 |\n| C | Done | c3 |'; // edited row C
    expect(merge3(base, ours, theirs)).toBe('| A | Done | c1 |\n| B | Todo | c2 |\n| C | Done | c3 |');
  });

  it('handles an empty base without crashing', () => {
    expect(merge3('', 'a', 'a')).toBe('a');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/merge3.test.ts`
Expected: FAIL — `Cannot find module '../src/webview/merge3'`.

- [ ] **Step 3: Implement `src/webview/merge3.ts`**

```ts
// Pure line-level 3-way merge. No DOM, no vscode — unit-testable.
//
// Returns the merged text when ours and theirs change DISJOINT line-ranges of
// base; returns null (→ caller asks the user) on any overlap, same-start edit,
// or ambiguity. Never fabricates content or an ordering.

interface Hunk { start: number; end: number; lines: string[]; } // base[start,end) -> lines

function splitLines(s: string): string[] {
  return s === '' ? [] : s.split('\n');
}

// LCS of two line arrays → ordered hunks describing how to turn `base` into `other`.
function diffHunks(base: string[], other: string[]): Hunk[] {
  const n = base.length;
  const m = other.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = base[i] === other[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  // Accumulate a run of non-matching lines into one hunk.
  let runStart = -1;
  let runLines: string[] = [];
  const flush = (endBase: number) => {
    if (runStart >= 0) { hunks.push({ start: runStart, end: endBase, lines: runLines }); runStart = -1; runLines = []; }
  };
  while (i < n && j < m) {
    if (base[i] === other[j]) {
      flush(i);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      // delete base[i]
      if (runStart < 0) runStart = i;
      i++;
    } else {
      // insert other[j]
      if (runStart < 0) runStart = i;
      runLines.push(other[j]);
      j++;
    }
  }
  // tail
  if (i < n || j < m) {
    if (runStart < 0) runStart = i;
    while (j < m) { runLines.push(other[j]); j++; }
    i = n;
  }
  flush(i);
  return hunks;
}

export function merge3(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours;
  if (base === ours) return theirs;
  if (base === theirs) return ours;

  const b = splitLines(base);
  const oh = diffHunks(b, splitLines(ours));
  const th = diffHunks(b, splitLines(theirs));

  // Conflict if any base ranges overlap, or two hunks start at the same base line
  // (catches same-point insertions and same-start replacements).
  for (const a of oh) {
    for (const c of th) {
      if (a.start === c.start) return null;
      if (a.start < c.end && c.start < a.end) return null;
    }
  }

  // Disjoint: apply both hunk sets to base in order.
  const all = [...oh, ...th].sort((x, y) => x.start - y.start || x.end - y.end);
  const out: string[] = [];
  let pos = 0;
  for (const h of all) {
    if (h.start < pos) return null; // residual overlap guard
    for (let k = pos; k < h.start; k++) out.push(b[k]);
    for (const ln of h.lines) out.push(ln);
    pos = h.end;
  }
  for (let k = pos; k < b.length; k++) out.push(b[k]);
  return out.join('\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/merge3.test.ts`
Expected: PASS (10 tests). If the realistic-board or disjoint test fails, the hunk boundaries need checking — do not loosen the conflict test to pass; fix `diffHunks`.

- [ ] **Step 5: Commit**

```bash
git add src/webview/merge3.ts tests/merge3.test.ts
git commit -m "feat(sync): pure 3-way line merge for non-colliding changes (c28-part-2)"
```

---

### Task 2: Wire auto-merge into the conflict branch

**Files:**
- Modify: `src/webview/index.ts` (import near the other `./` imports; conflict branch ~line 1130)

**Interfaces:**
- Consumes: `merge3` from `./merge3`.

- [ ] **Step 1: Add the import**

In `src/webview/index.ts`, add near the existing sibling imports (e.g., right after the `decideExternalUpdate` import line):

```ts
import { merge3 } from './merge3';
```

- [ ] **Step 2: Attempt the merge before the banner**

Find the conflict branch:

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

Replace it with:

```ts
      if (decision === 'conflict') {
        // c28-part-2: if our unsent edits and the external change touch DISJOINT
        // lines, merge them silently (base = last-sent = the common ancestor)
        // instead of interrupting. Any overlap / no base → merge3 returns null
        // and we fall back to the banner.
        const merged = lastSentMarkdown !== null
          ? merge3(lastSentMarkdown, normalizeMd(getCurrentMarkdown()), normalizeMd(msg.markdown))
          : null;
        if (merged !== null) {
          currentMarkdown = merged;
          lastSentMarkdown = normalizeMd(merged);
          updateContent(merged);
          if (sourceMode && sourceEditorReady) updateSourceContent(merged);
          vscode.postMessage({ type: 'edit', markdown: merged });
          return;
        }
        // True overlap — surface the banner so the user picks.
        pendingExternalMarkdown = msg.markdown;
        renderConflictPanel(getCurrentMarkdown(), msg.markdown);
        showConflictBanner();
        return;
      }
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "toggle.ts"`
Expected: no output.

Run: `node esbuild.config.js`
Expected: `Webview built.`

- [ ] **Step 4: Commit**

```bash
git add src/webview/index.ts
git commit -m "feat(sync): auto-merge non-colliding external changes before prompting (c28-part-2)"
```

---

### Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite — no new failures**

Run: `npx jest 2>&1 | tail -5`
Expected: only the two pre-existing failures (`tests/toggle.test.ts`, `tests/board/grouping.test.ts`); the new `merge3` suite (10) passes.

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "toggle.ts" | head`
Expected: no output.

- [ ] **Step 3: Confirm bundled**

Run: `grep -c "merge3" dist/webview.js`
Expected: non-zero.

- [ ] **Step 4: Manual smoke test (document for the human)**

In the Extension Development Host: open a markdown file in the board editor, make an edit to card A (don't wait for auto-save), then from a plain-text split edit a *different* card and save → the board should silently absorb both, no banner. Repeat editing the *same* card from both sides → the conflict banner appears.

---

## Notes for the implementer

- `merge3.ts` must not import `vscode` (its tests rely on that).
- `normalizeMd` already exists in `index.ts`; reuse it for `ours`/`theirs`. `lastSentMarkdown` is already normalized.
- Do not change `decideExternalUpdate` or the banner — only the conflict branch gains the merge attempt.
