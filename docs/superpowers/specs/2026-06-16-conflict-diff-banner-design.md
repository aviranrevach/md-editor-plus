# Conflict-banner "What changed" side-by-side diff (c29)

Date: 2026-06-16
Status: Design approved (side-by-side, refined). Scope: the lightweight in-banner diff aid only.
The full diff viewer (c24 / "B") is a later, separate effort — this spec leaves a labeled hook for it.

## Problem

When the external-edit conflict banner appears ("This file was changed outside the editor
while you have unsaved changes" — Reload / Keep), the user must choose **blind**: there's no
indication of what actually differs between their unsaved version and the on-disk version.

Good news: this banner is the extension's own (`src/webview/index.ts:278`), not VS Code's
native UI, and at conflict time the webview already holds **both** versions —
`getCurrentMarkdown()` (yours) and `pendingExternalMarkdown` (disk). So a diff is feasible
with no new data plumbing.

## What we're building

A **"What changed ▾"** reveal on the conflict banner that expands a **full-width panel
below the banner** showing a **row-aligned, side-by-side** diff (Your version | On disk) of
**only the changed region**. Confirmed behaviors:

1. **Collapsed by default** — banner stays compact; clicking the reveal toggles the panel.
2. **Changed region only** — unchanged lines are hidden (no surrounding context lines).
3. **Row-aligned with gaps** — a line present on only one side shows a hatched blank on the
   other side, so corresponding lines stay paired.
4. **Capped height + scroll** — the panel never pushes the document too far down (max-height,
   internal scroll).
5. **c24 hook** — a subtle, inert "Open full diff →" affordance wired to a single
   `openFullDiff()` seam (no-op for now) that c24 will implement.

Line-level granularity (each markdown line is one diff unit). Board rows are one line each,
so row changes read clearly; prose changes read as changed lines. No board-specific logic.

## Architecture

Three small units:

### 1. `src/webview/conflictDiff.ts` (new) — pure, dependency-free
Computes the aligned side-by-side rows. No DOM, fully unit-testable.

```ts
export type DiffRowKind = 'change' | 'add' | 'del';
export interface DiffRow { kind: DiffRowKind; yours: string | null; disk: string | null; }
export interface ConflictDiff { rows: DiffRow[]; truncated: number; } // truncated = hidden-overflow count

export function computeConflictDiff(yours: string, disk: string, maxRows?: number): ConflictDiff;
```

Algorithm:
- Split both inputs into lines (normalize `\r\n`→`\n`, drop trailing blank lines as the rest
  of the app does via `normalizeMd`).
- Compute a line-level LCS to get an ordered op list: `equal(a,b)`, `del(a)`, `add(b)`.
- Walk ops, **dropping `equal` runs** (changed-region-only). For each maximal run of
  consecutive `del`/`add` (a "hunk"):
  - pair `del[i]` with `add[i]` → `{ kind:'change', yours, disk }` up to `min(dels,adds)`;
  - remaining `del`s → `{ kind:'del', yours, disk:null }`;
  - remaining `add`s → `{ kind:'add', yours:null, disk }`.
- Cap at `maxRows` (default ~200); set `truncated` to the count beyond the cap.
- Dependency-free LCS (standard DP or the classic O(ND) approach); inputs are a single file's
  lines so size is modest.

### 2. Banner panel UI — in `src/webview/index.ts`
Extend the existing banner (`conflictBanner`, ~line 281). Add the "What changed ▾" reveal
control and an (initially empty, hidden) panel element. A render function builds the
two-column aligned rows from a `ConflictDiff`. Toggle flips a `collapsed` class and the
caret (▾/▴). The panel is rebuilt each time the banner is shown (fresh diff).

### 3. Styles — in the existing injected CSS (`injectStyles`)
Classes for the panel, column headers, aligned `.pair` rows, and `.add`/`.del`/`.change`/
`.empty` (hatched gap) cells. Capped `max-height` with `overflow:auto`. Match the existing
conflict-banner visual language (the amber bar) and light/dark themes.

## Data flow

`decideExternalUpdate` → `'conflict'` (index.ts ~1073) already sets `pendingExternalMarkdown`
and calls `showConflictBanner()`. Change: at that point also compute
`computeConflictDiff(getCurrentMarkdown(), pendingExternalMarkdown)` and hand it to the
panel renderer (built collapsed). The reveal toggle only shows/hides — no recompute. On
Reload/Keep (existing handlers) the banner hides and the panel is cleared.

## Error handling / edges

- **No textual difference** (shouldn't occur — conflict only fires when they differ; but if a
  normalization makes them equal): render the panel with a quiet "No line differences" note and
  still let the user choose. Never crash the banner.
- **Large diff:** cap rows; show "+N more changed lines — Open full diff →" using the c24 hook.
- **Performance:** compute once per conflict (not on every keystroke); line-level keeps it cheap.

## Testing

- `tests/conflictDiff.test.ts` (pure, primary):
  - identical input → `rows: []`, `truncated: 0`.
  - one changed line → single `change` row with both sides.
  - added line(s) only → `add` rows with `yours:null`.
  - removed line(s) only → `del` rows with `disk:null`.
  - a hunk with unequal add/del counts → correct pairing then leftover add/del rows.
  - unchanged lines between changes are excluded (changed-region-only).
  - `maxRows` cap → `rows.length === maxRows`, `truncated` = remainder.
  - realistic board fixture (lowercase ids): a changed Status, a row added on disk, a row only
    in "yours" → expected aligned rows.
- UI wiring is thin; a light DOM test (jsdom) may assert the panel renders one `.pair` per row
  and the toggle flips collapsed state. Keep heavy logic in the pure module.

## Components touched

- Create: `src/webview/conflictDiff.ts`, `tests/conflictDiff.test.ts`
- Modify: `src/webview/index.ts` (banner markup + reveal toggle + panel render + compute on
  conflict; add an inert `openFullDiff()` seam), and the injected CSS block.

## Out of scope

- The full diff viewer / c24 ("B") — only the inert hook is added here.
- Word/character-level intra-line highlighting (line-level only for v1).
- Three-way merge or auto-merge (that's the separate c28-part-2 idea).
- Changing when conflicts fire (that logic — `decideExternalUpdate` — is unchanged).
