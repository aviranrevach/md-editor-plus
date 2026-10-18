# c46 — Notion-style row handle for regular markdown tables

**Date:** 2026-06-20
**Status:** Design, ready for implementation plan
**Scope:** Regular markdown tables (stock TipTap `Table`/`TableRow`/`TableHeader`/`TableCell`). Board tables already have this (c36) — out of scope here.

## Problem

Regular markdown tables in the editor have **no row affordance at all**. There is no way to reorder rows, insert a row at a specific spot, duplicate, or delete a row without manually editing cells. Board tables got this in c36; plain tables were explicitly deferred to c46. This adds the same Notion-style row handle to plain tables.

## Goal

Hovering a regular-table row reveals a grip (⠿) in a left gutter. That grip is the single affordance for everything you do *to a row*:

- **Drag** (movement past threshold) → reorder the row within the table.
- **Click** (no movement) → opens a row-actions menu (Insert above / Insert below / Duplicate / Delete).

## Why a plugin + floating handle, NOT a NodeView

Board tables (c36) are custom-rendered DOM, so c36's renderer cannot be reused — only its *menu component* and interaction model can. For plain tables we have two options:

1. **Replace the Table NodeView** — full control, but it changes how the table renders and touches the content model. Given this repo's repeated board/table round-trip data-loss incidents (c35, c37, c48), changing table rendering is high-risk.
2. **A ProseMirror plugin + single floating handle** — mirrors the proven `GlobalDragHandle`/`createBlockHandle` pattern (one floating `.drag-handle` positioned next to the hovered block) and the code-block gutter's manual-drag mechanics (`codeBlock.ts`). It never changes how the table renders; it only reads row geometry from the DOM and mutates via transactions. **Chosen** — lowest round-trip risk.

The handle is one reused DOM element on `document.body`, positioned per hovered row (same lifecycle idea as the block handle and the c36 single-instance row menu).

## Interaction model

### Click vs. drag disambiguation

Manual mouse drag (mousedown → mousemove → mouseup), because ProseMirror intercepts HTML5 `dragstart` (see memory: *Manual mouse drag for board popovers*, and the code-block gutter which already does exactly this). A release with no movement past the threshold is a **click → open menu**; any movement past threshold is a **drag → reorder** and the trailing click is swallowed.

### The drop indicator

A separate horizontal blue line between rows (reuse the `.cb-drop-line` style / a `.tbl-drop-line` twin), attached to `document.body` so the mutation is **outside** the ProseMirror DOM and does not tear down the drag mid-flight (the exact reason `codeBlock.ts` appends its drop line to `document.body`). Never a row outline — consistent with memory: *Drop indicator: separate blue line, never row strokes*.

### Coexistence with the global block handle

A regular table is itself one top-level block, so `GlobalDragHandle` shows its whole-table `.drag-handle` in the same left margin. To avoid two overlapping grips, **while the pointer is over a regular-table row the global block handle is suppressed** — same approach the code block already uses (`.drag-handle.hide-cb`). Implemented decoupled: the row-handle module toggles a `body.tbl-row-active` class and CSS hides `.drag-handle` under it. Whole-table drag remains reachable by hovering the table's outer margin (not a cell). *(Review point: confirm this trade-off feels right; the alternative is showing both grips at different x-offsets.)*

### Floating panels coexistence

Opening the row menu dismisses any other open floating panel via the shared popover registry's `closeAll` behavior (memory: *Floating panels must not overlap*). The menu is built with the shared `createMenu` and positioned by `placeFloating` (flip → clamp → scroll), so it never clips off-screen (memory: *Menu positioning helper c34*).

## The header row

Markdown tables **must** have exactly one header row, and it **must** be first. The header row is the first `tr`, whose cells are `th` (TipTap renders header cells as `tableHeader`). To keep every mutation round-trip-safe:

| Action | Body row | Header row |
|---|---|---|
| Drag to reorder | ✅ within body | ❌ header stays first |
| Drop a body row above the header | ❌ clamped to below header | — |
| Insert row above | ✅ | ❌ hidden (would push a row above the header) |
| Insert row below | ✅ | ✅ |
| Duplicate | ✅ | ❌ hidden (a duplicated header serializes as a body row — confusing) |
| Delete | ✅ | ❌ hidden (a table with no header is invalid markdown) |

So the header row's grip shows a reduced menu: **Insert row below only**, and is not draggable. Body rows get the full set. These rules live in pure, unit-tested decision functions.

## Read-only

When `!editor.isEditable` the handle is never shown (mirrors board grip + block handle behavior). No separate guard on the menu needed because it is unreachable.

## Architecture & files

- **`src/webview/tableRowOps.ts`** (new, pure / unit-testable):
  - `reorderRows<T>(rows: T[], fromIdx: number, insertIdx: number, headerCount = 1): T[]` — returns a new array with the row moved, clamped so it never lands above the header. Mirrors `codeBlock.moveLine`'s index math.
  - `rowMenuModel(ctx: { isHeader: boolean }): RowMenuItemKind[]` — ordered list of action kinds for the row (full set for body, `['insert-below']` for header).
  - `canDragRow(isHeader: boolean): boolean`, `clampInsertIndex(insertIdx, headerCount, rowCount)`.
- **`src/webview/tableRowTx.ts`** (new, ProseMirror transaction helpers, tested via a real editor):
  - `moveRow(editor, tablePos, fromIdx, toIdx)`, `duplicateRow(editor, tablePos, idx)`, `insertRowRelative(editor, tablePos, idx, 'above'|'below')`, `deleteRowAt(editor, tablePos, idx)`. Insert/delete set a selection inside the target row and reuse TipTap's `addRowBefore`/`addRowAfter`/`deleteRow` commands; move/duplicate rebuild the table content via `reorderRows` / node clone + `tr.replaceWith` (the code-block "replace the whole node" approach, which keeps serialization clean).
- **`src/webview/tableRowHandle.ts`** (new, DOM glue, modeled on `blockHandle.ts` + `codeBlock.ts`):
  - `createTableRowHandle(editor)` — one floating grip, mousemove positioning, manual drag, drop line, click → `createMenu`.
- **`src/webview/editor.ts`** — call `createTableRowHandle(editor)` in `buildRichEditor`, next to `createBlockHandle(editor)`.
- **`src/webview/styles/editor.css`** — `.tbl-row-handle`, `.tbl-drop-line`, `body.tbl-row-active .drag-handle { display:none }`, drag-active cursor. Match `.cb-line` / `.drag-handle` visual language. Hidden under `.is-printing` like the other handles.
- **`src/webview/handleIcons.ts`** — reuse `createGripIcon()`.

## Edge cases

- **Single-row table (header only):** grip shows on the header, menu offers only Insert row below; no drag.
- **Re-render / typing during drag:** mouseup listeners on `document`; if the table DOM is replaced mid-drag the drop line (on `document.body`) is removed on the next mousemove/up. Mirror code-block's teardown.
- **Cursor between rows:** drop line snaps to the nearest row boundary (above-half / below-half), clamped below the header.
- **Multi-table doc:** the handle resolves the row → its enclosing `table` via `posAtDOM`, so each table acts independently.
- **Board / code tables:** excluded — a `tr` inside `.bd-table` or any element with the board container, and code blocks (no `tr`), never get the handle.

## Testing

- **`tests/tableRowOps.test.ts`** (pure): `reorderRows` index math incl. clamping above header, no-op when insert==from / from+1; `rowMenuModel` full vs header-only; `clampInsertIndex`.
- **`tests/tableRowTx.test.ts`** (real `new Editor`, like `toggle-roundtrip.test.ts`): build a markdown table, run move / duplicate / insert / delete, serialize with `getMarkdown()`, assert correct + lossless markdown (the data-loss guard). Header invariants: header stays first after any body reorder; delete/insert-above never run on the header.
- **`tests/tableRowHandle.test.ts`** (jsdom DOM, like `menu.test.ts`): clicking the grip opens a menu whose labels match `rowMenuModel`; header-row grip shows only Insert below; clicking Delete removes the row.

## Out of scope

- Whole-table drag changes (still handled by the global block handle).
- Column handles / column reorder (separate, not requested).
- Multi-row selection / bulk actions.
- Cross-table row moves.
