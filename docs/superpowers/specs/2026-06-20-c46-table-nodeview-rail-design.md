# c46 (revised) — Table NodeView with attached row rail + cell selection

**Date:** 2026-06-20
**Status:** Design approved, ready for implementation plan
**Supersedes:** `2026-06-20-c46-table-row-handle-design.md` (the floating-grip approach — the grip floated in the margin with a gap from the table and only appeared while hovering inside a row, so it was unreachable; commit `a795653`). This spec replaces the DOM layer; the tested pure logic and transactions are kept.
**Scope:** Regular markdown tables (stock TipTap `Table`/`TableRow`/`TableHeader`/`TableCell`). **Rows phase only** — column handles are a designed-for fast follow, explicitly out of scope here. Board tables (c36) are unaffected.

## Problem

The shipped floating-grip handle is unreachable: it renders in the left margin a few px clear of the table, but only appears while the pointer is over a `tr` (inside the table). Moving toward the grip leaves the row, the grip hides, and it can never be clicked — so none of the row actions are usable. Regular tables also have **no visible cell-selection state**, unlike the board table.

## Goal

A Notion-style table affordance for regular tables:

- A thin **rail** hugs the table's left edge (no gap). Hovering a row **or** the rail reveals a `⠿` grip aligned to that row. The rail + table form one continuous hover zone, so the grip is always reachable.
- **Click** the grip → select the whole row (cells highlight) and open the row menu: **Insert row above / below**, **Duplicate row**, **Delete row**.
- **Drag** the grip → reorder the row (blue drop line between rows; clamped below the header).
- A visible **cell-selection state**: the active cell is outlined; **drag across cells / shift-click** selects a rectangular block (ProseMirror's native `CellSelection`, styled).
- The existing margin **block handle (`＋ ⠿`) stays** and moves the *whole table* — the two coexist (margin = whole table, rail grip = one row).

## Why a NodeView (chosen approach)

A ProseMirror **NodeView** on the Table extension whose `contentDOM` is the real table. Wrapping the table lets the rail be a sibling that sits flush to the edge and moves with the table on scroll/resize/edit — fixing reachability structurally rather than chasing geometry. The node's content is never changed, so markdown serialization is untouched (the c37/c48 round-trip guard holds). The same wrapper grows a top rail for columns in phase 2 with no rework.

Rejected: (1) a floating overlay rail positioned from the table's bounding rect — brittle, drifts on scroll/resize/content change; (2) re-rendering the whole table ourselves like `boardTableRender` — large surface and reintroduces round-trip data-loss risk.

## Architecture

```
.mp-table (wrapper, NodeView dom, contenteditable=false on chrome only)
├─ .mp-table-rail            (left strip, always present, subtle; the hover-keep zone)
│   └─ .mp-table-rail-grip   (one reused ⠿ grip, positioned at the hovered row's Y)
├─ <table>                   (the real table)
│   └─ <tbody> = contentDOM  (rows render here, untouched content model)
└─ (drop line is parented to document.body during a drag — not inside the NodeView)
```

- **`src/webview/tableNodeView.ts`** (new) — `tableNodeViewPlugin` / the NodeView factory. Builds the wrapper + rail, tracks the hovered row, drives the grip (drag vs click), opens the row menu, and creates the row CellSelection on grip click. Reuses `createGripIcon`, `createMenu`, `placeFloating`, and the code-block manual-drag mechanics (PM intercepts native dragstart; the drop line lives on `document.body` so a mutation inside the NodeView doesn't tear the drag down).
- **`src/webview/tableRowOps.ts`** (keep, unchanged) — `reorderRows`, `clampInsertIndex`, `rowMenuModel`, `canDragRow`, `ROW_MENU_LABEL`. Already unit-tested.
- **`src/webview/tableRowTx.ts`** (keep, unchanged) — `findTableAround`, `findFirstTable`, `isHeaderRow`, `moveRow`, `duplicateRow`, `insertRowRelative`, `deleteRowAt`. Already round-trip tested.
- **`src/webview/editor.ts`** — swap `Table.configure({ resizable: false })` for the NodeView-extended table; **remove** the `createTableRowHandle` import/wiring and the `_tableRowHandleDispose` lifecycle (the NodeView ships with the extension, so no separate document-level wiring).
- **Delete `src/webview/tableRowHandle.ts`** and `tests/tableRowHandle.test.ts` (the floating-grip DOM layer and its tests) — replaced by the NodeView + its DOM tests.
- **`src/webview/styles/editor.css`** — rail, grip, drop line, `.selectedCell` range style, active-cell outline. Remove the now-dead `.tbl-row-handle` / `body.tbl-row-active` rules. Hidden under `.is-printing`.

## Interaction details

### The rail and grip
- The rail is always rendered but visually near-invisible until hovered (a faint hover tint, Notion-like). It spans the full table height and is a few px wide, flush against the table's left border (zero gap).
- On `mousemove` over the wrapper, the row under the pointer is resolved (by hit-testing `tr` rects against `clientY` — works whether the pointer is over a cell or over the rail). The single grip is positioned at that row's vertical center inside the rail and shown.
- Read-only (`!editor.isEditable`) → the rail/grip never show (the menu is therefore unreachable; no extra guard).

### Click vs. drag (manual mouse drag)
- `mousedown` on the grip starts tracking. Past the `DRAG_THRESHOLD_PX` it's a **drag**; release with no movement is a **click**.
- **Click** → set a `CellSelection` spanning the whole row (cells highlight) and open the row menu anchored to the grip via `placeFloating` (flip → clamp → scroll; opening it dismisses other floating panels via the popover registry).
- **Drag** → blue drop line (`document.body`-parented) between rows, clamped so nothing lands above the header; on release, `moveRow`.
- The header row: grip shows, but it isn't draggable and its menu is **Insert row below only** (enforced by `rowMenuModel` + `tableRowTx` guards) so the table always keeps a valid header.

### Cell selection
- TipTap's Table bundles the `tableEditing` plugin, which already provides `CellSelection` (drag-select, shift-click) and decorates selected cells with the `selectedCell` class. This phase adds the **styling**: a blue range fill on `.selectedCell` and a clear outline on the active cell (the cell containing the cursor). No new selection logic beyond the row-select created on grip click (`CellSelection` across the row).

### Coexistence with the block handle
- `GlobalDragHandle`'s margin `＋ ⠿` is **no longer suppressed** over tables (the c46-v1 `body.tbl-row-active` rule is removed). The margin handle (whole table) sits further left than the rail grip (table edge), so they read as distinct affordances. Final spacing verified on F5.

## Edge cases
- **Single-row (header-only) table:** grip on the header, menu = Insert row below only, no drag.
- **Re-render / typing during drag:** drop line is on `document.body`; the NodeView's `ignoreMutation` keeps rail/grip mutations out of PM; `destroy()` tears down listeners and the drop line.
- **Multiple tables:** each table is its own NodeView, so rails/selection are independent.
- **Board / code tables:** unaffected — this NodeView is only the regular Table node; board tables render their own grips, code blocks their own gutter.
- **Markdown round-trip:** `contentDOM` is the real table; the content model is never mutated by the chrome, so `getMarkdown()` is unchanged (covered by a new NodeView round-trip test + the existing `tableRowTx` tests).

## Testing
- **Keep:** `tests/tableRowOps.test.ts`, `tests/tableRowTx.test.ts` (logic + lossless transactions).
- **New `tests/tableNodeView.test.ts`** (real editor, jsdom):
  - The NodeView renders a `.mp-table` wrapper with a `.mp-table-rail` and the table's rows inside the contentDOM; the table serializes losslessly (round-trip sanity).
  - Hovering a row shows the grip; a no-movement grip click opens the menu with labels from `rowMenuModel` (full set for a body row, Insert-below-only for the header).
  - Clicking **Delete row** removes the row; **Duplicate** clones it below.
  - Read-only hides the grip.
- **F5 (visual, not jsdom-testable):** rail tint/placement flush to the edge, grip reachability, drop-line alignment, `.selectedCell` range fill, active-cell outline, drag-select across cells, and that the margin block handle still moves the whole table.

## Out of scope (this phase)
- **Column handles + top rail** (phase 2 — the wrapper is built to accept them).
- Whole-table drag changes (still the block handle).
- Cross-table cell selection or row moves.
- Multi-row bulk actions beyond what range selection gives for free.
