# c39 — Column-menu filter shortcut (scoped mini-filter)

**Date:** 2026-06-20
**TODO ref:** c39 — *"Redesign column menu for the same look and feel, icons, and grouping as the other menus. Allow filtering shortcut (that opens the regular filter)."*

## Status of the parent task

The **column-menu redesign** (shared `createMenu`, Phosphor icons, grouping) already shipped — the TODO screenshot ([TODO.assets/image-8.webp](../../../TODO.assets/image-8.webp)) shows the old look. The code at [boardTableRender.ts:985](../../../src/webview/boardTableRender.ts#L985) already uses `createMenu` + `COL_MENU_ICONS`.

This spec covers the **remaining piece: the filter shortcut**, plus a small reorder of the column menu agreed during brainstorming.

## Goal

Add a **Filter** entry to a column's `⋯` menu (status/tags columns only) that opens a **scoped mini-filter** for that single field, editing the same session-only `FilterState` the toolbar funnel already uses. Reorder the column menu so the "shape what you see" actions lead, and collapse the three sort actions into one **Sort ›** flyout.

## Behavior

### Column menu — new order

Main menu:

1. **Filter** *(status/tags fields only)*
2. **Group by this** / **Remove grouping**
3. **Sort ›** — drills into a submenu: **Ascending · Descending · Clear sort**
4. *divider*
5. **Rename** *(disabled for locked system fields: Title / Status / Description)*
6. **Edit options** *(status/tags only)*
7. **Reset column width**
8. **Hide column**

`Sort ›` uses the existing `MenuItem.submenu` drill-down ([menu.ts:9](../../../src/webview/menu.ts#L9)) — same pattern as the "Turn into" flyout.

### Scoped mini-filter popover

Opened from the **Filter** item, anchored to the column header. Contents top-to-bottom:

- **Header row:** field name (left) + **Clear** (right). Clear resets only this field's filter.
- **Value chips:** this field's chips, reusing the existing chip rendering (`board-column-chip` — solid `is-selected` = on, hollow = off; plus the `(Empty)` chip). Same toggle semantics as the global panel (all-on → field cleared; all-off → `NONE_ON` sentinel).
- **Footer:** **All filters…** — closes the mini-filter and opens the global toolbar funnel.

It calls `ctx.setFilter(...)`, so the table/kanban bodies, the funnel pill's count badge, and the funnel panel all stay in sync. Nothing new is serialized.

### Constraints

- **Filter item appears only for `status`/`tags` fields** — the only types `applyFilter` understands. Text/ID columns omit it entirely.
- **Phosphor icon, matching weight:** the Filter item uses **Phosphor Funnel (regular)** — `viewBox="0 0 256 256"`, `fill="currentColor"`, 16×16 — to match the other `COL_MENU_ICONS`, *not* the stroke-based 24×24 `FUNNEL_SVG` used by the toolbar pill.

## Architecture / units

### 1. Extract shared filter logic (`boardFilterPanel.ts`)

Today the on-set math and chip rendering live inside `createFilterPill`'s closure. Lift them to reusable, testable units:

- `onSetOf(filter, field)`, `toggleValue`-style helper, `allValuesOf`, and the `NONE_ON` sentinel → module-level pure functions (no DOM).
- `buildFieldFilterRow(ctx, field): HTMLElement` → renders one field's chip row (label + chips + toggle wiring). Consumed by **both** the global panel and the mini-filter — one source of truth for chip look and toggle rules.

The global `createFilterPill.buildPanel()` is refactored to call `buildFieldFilterRow` per field, so existing behavior is unchanged.

### 2. `openColumnFilter(anchor, field, ctx)` (new, in `boardFilterPanel.ts`)

- Creates the mini-filter via `createPopover` (consistent with the existing panel and the popover registry, so opening it dismisses other floating panels per the floating-panel rule).
- Builds: header (field name + Clear), `buildFieldFilterRow(ctx, field)`, and the **All filters…** footer.
- **All filters…** calls `ctx.openFilterPanel?.()` (see unit 4), then closes itself.

### 3. Column-menu item (`boardTableRender.ts`)

- Add Phosphor Funnel to `COL_MENU_ICONS`.
- In `openColumnMenu`, prepend the **Filter** item (status/tags only) and **Group by this**, then a **Sort** item with `submenu: () => [...]` returning Ascending / Descending / Clear sort. Reorder the remaining items and divider per the order above. Reuse the existing `setViewSort` / `setViewGroup` calls.

### 4. "All filters…" wiring (`boardBlock.ts` + `boardChrome.ts`)

- `createFilterPill` exposes an `open()` on its returned `FilterPill`.
- Add optional `openFilterPanel?: () => void` to `BoardRendererCtx` ([boardBlock.ts:31](../../../src/webview/boardBlock.ts#L31)).
- `boardChrome` wires `ctx.openFilterPanel = () => filterPill.open()` after creating the pill. Scoped per board instance (no global DOM selector), so multiple boards in one document each open their own funnel.

## Testing

- **Unit:** the extracted pure helpers — `onSetOf` defaults to all-on; toggling to all-on clears the field; toggling to all-off stores `[NONE_ON]`; partial selections store the on-set. (Co-locate with any existing `boardFilter` tests.)
- **Shared rendering:** mini-filter and global panel both use `buildFieldFilterRow`, so a chip/toggle regression surfaces in both surfaces.
- **Manual (F5):** open a status column's Filter → toggle a value → table hides rows and the toolbar funnel count updates; Clear resets only that field; All filters… opens the full funnel; Filter item absent on text/ID columns; Sort flyout asc/desc/clear all work.

## Out of scope (YAGNI)

- No new filterable field types (text/number filtering) — status/tags only, as today.
- No persistence of filters (still session-only).
- No changes to kanban chrome beyond what the shared `ctx.openFilterPanel` hook touches.
