# Table Row Handle (c46) Implementation Plan

> Design: `docs/superpowers/specs/2026-06-20-c46-table-row-handle-design.md`

**Goal:** Notion-style row handle for regular markdown tables — hover shows a left-gutter grip; drag reorders the row; click opens Insert above/below · Duplicate · Delete. Header row stays first and always present.

**Architecture:** ProseMirror plugin + one floating handle (never a NodeView — no table-rendering changes → no round-trip risk). Pure logic in `tableRowOps.ts`, transactions in `tableRowTx.ts`, DOM glue in `tableRowHandle.ts` modeled on `blockHandle.ts` + `codeBlock.ts`. Reuse `createMenu`, `placeFloating`, `createGripIcon`.

**Stack:** TypeScript, jsdom + Jest, ProseMirror/TipTap. No new deps. Baseline `npm test` has pre-existing failing suites (`toggle.test.ts`, board `grouping.test.ts`) — don't fix here, just add no new failures.

---

## Task 1 — Pure row logic (`tableRowOps.ts`)

- [ ] **Tests first** (`tests/tableRowOps.test.ts`):
  - `reorderRows(['h','a','b','c'], 1, 3)` → `['h','b','a','c']`; moving to `from`/`from+1` is a no-op; an insert index of 0 (above header) clamps to 1.
  - `rowMenuModel({ isHeader:false })` → `['insert-above','insert-below','duplicate','delete']`; `{ isHeader:true }` → `['insert-below']`.
  - `clampInsertIndex(0,1,4)` → 1; `clampInsertIndex(4,1,4)` → 4.
- [ ] **Implement** `reorderRows`, `rowMenuModel`, `clampInsertIndex`, `canDragRow`. Index math mirrors `codeBlock.moveLine`.
- [ ] Run `npx jest tests/tableRowOps.test.ts` → green.

## Task 2 — Transaction helpers (`tableRowTx.ts`)

- [ ] **Tests first** (`tests/tableRowTx.test.ts`, real `new Editor` w/ Table* + Markdown, like `toggle-roundtrip.test.ts`). Helper `rowCount`/`getMarkdown` round-trip.
  - `moveRow`: a 3-body-row table, move body row 0→2; header still first; markdown lossless + reordered.
  - `duplicateRow`: body row count +1, clone identical, header untouched.
  - `insertRowRelative` above/below a body row: blank row appears in the right place.
  - `deleteRowAt`: row removed; markdown valid.
  - Invariants: helpers refuse to delete / insert-above the header (guarded by `tableRowOps`).
- [ ] **Implement.** `findTableAt(editor, pos)` → `{ tablePos, node }`. `moveRow`/`duplicateRow` rebuild the table content (clone `tableRow` nodes, `reorderRows`, `tr.replaceWith(tablePos, tablePos+node.nodeSize, newTable)`) — the code-block "replace whole node" approach. `insertRowRelative`/`deleteRowAt` set a `TextSelection` inside the target row's first cell, then run the editor's `addRowBefore`/`addRowAfter`/`deleteRow` commands.
- [ ] Run → green; **confirm no markdown loss** (the c37/c48 guard).

## Task 3 — DOM handle (`tableRowHandle.ts`)

- [ ] `createTableRowHandle(editor)`: one `.tbl-row-handle` grip on `document.body` (hidden). `document` mousemove → find `tr` under cursor inside `.ProseMirror table` (exclude board/`.bd-table`); position grip at row left edge, vertical center; set `body.tbl-row-active`; hide when `!editor.isEditable`, off-row, or over a board table. Track current `{ tr, tablePos, rowIdx, isHeader }` via `view.posAtDOM`.
- [ ] mousedown on grip → manual drag (threshold): drop line (`.tbl-drop-line` on `document.body`) between rows clamped below header; mouseup past threshold → `moveRow`; no movement → `openRowMenu`.
- [ ] `openRowMenu(grip, ctx)`: build sections from `rowMenuModel`, wire each kind to its `tableRowTx` helper, open shared `createMenu` instance.
- [ ] DOM test (`tests/tableRowHandle.test.ts`): grip click opens menu with labels matching `rowMenuModel`; header grip → Insert below only; Delete removes a row.

## Task 4 — Wire + CSS

- [ ] `editor.ts`: `createTableRowHandle(editor)` after `createBlockHandle(editor)` in `buildRichEditor`.
- [ ] `editor.css`: `.tbl-row-handle` (match `.block-handle-drag`), `.tbl-drop-line` (twin of `.cb-drop-line`), `body.tbl-row-active .drag-handle { display:none !important }`, drag-active cursor, `.is-printing` hide.

## Task 5 — Verify + docs

- [ ] `npx tsc --noEmit && npm test` — tsc clean, only the 2 pre-existing suites red, new tests green.
- [ ] Manual F5: hover plain table → grip; drag reorders; click → menu; header restricted; read-only → no grip; board/code tables unaffected.
- [ ] `CHANGELOG.md` + `README.md` (table feature list) before any push. Flip `TODO.md` c46 → Review.
- [ ] Commit on branch. **Do not push** (outward-facing — needs the user). Leave a summary.

## Self-review

Header invariants enforced in both `tableRowOps` (menu/clamp) and `tableRowTx` (refuse delete/insert-above header). Round-trip proven in Task 2. Reuse: `createMenu`/`placeFloating`/`createGripIcon`/`.cb-drop-line` style. Manual drag (PM intercepts dragstart). Drop line on `document.body`, separate blue line. Global handle suppressed via `body.tbl-row-active`. Read-only → no grip.
