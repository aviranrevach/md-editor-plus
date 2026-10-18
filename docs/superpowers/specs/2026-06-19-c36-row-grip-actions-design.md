# c36 — Make the board-table row grip fully useful

**Date:** 2026-06-19
**Status:** Approved, ready for implementation plan
**Scope:** Board table view only. Regular markdown tables are explicitly out of scope (tracked separately as c46).

## Problem

The ⠿ grip in each board-table row's gutter (`.bd-row-grip`) currently does exactly one thing: drag to reorder. Two gaps:

1. **No row actions.** There's no way to delete, duplicate, open, or insert a row from the grip. Notion's row handle both drags *and* opens a menu on click — we have the handle but only the drag half.
2. **Cross-group drag is silently rejected.** In a grouped view, dragging a row into a different group does nothing — the drop is rejected ([boardTableRender.ts:224-231](../../../src/webview/boardTableRender.ts#L224-L231)). Dragging "Doing → Done" should re-assign the row's group field, exactly like dragging a card across kanban columns.

## Goal

The grip becomes the single affordance for everything you do *to a row*:

- **Click** (no movement) → opens a row-actions menu.
- **Drag** (movement past threshold) → reorders within a group / moves between groups.

## Out of scope

- Regular markdown tables (stock TipTap `Table`/`TableRow`, no gutter or grip). Adding a row handle there is net-new affordance work → **c46**.
- Multi-row selection / bulk actions.
- Group-level drag (reordering whole groups) — that's the existing, separate c13.

## Interaction model

### Click vs. drag disambiguation

Reuse the existing `startDrag` + `suppressNextClick` pattern already used for block handles. A pointer release with no movement past the threshold is a **click** → open menu. Any movement past threshold is a **drag** → the drag completes and `suppressNextClick` swallows the trailing click so the menu does not open.

### Grip state by view

| View state | Drag | Click → menu | Grip appearance |
|---|---|---|---|
| Plain (no sort, no group) | reorder rows (today) | ✅ opens menu | normal |
| Sorted by a column | **off** (order is computed; reorder would snap back) | ✅ opens menu | normal (no longer "disabled"-styled) |
| Grouped by a field | reorder within group **and** drop into another group → re-assign field | ✅ opens menu | normal |

Today the grip is greyed out + `title="Clear sort to reorder rows"` when sorted. After c36 the grip is **never** purely disabled, because the menu is always available. When sorted, the grip is not `data-board-drag` (no drag) but is still clickable for the menu; tooltip becomes `Row actions` (or `Drag to reorder · click for actions` when drag is available).

### Cross-group drag (new)

In a grouped view, on drop into a row belonging to a different group:

- Set `card.values[view.groupBy] = targetGroup.key`, mapping the placeholder key `'—'` back to empty string (mirrors the `+ Add row` preset logic at [boardTableRender.ts:524-525](../../../src/webview/boardTableRender.ts#L524-L525) and kanban's `Status: col.name` at [boardKanbanRender.ts:314](../../../src/webview/boardKanbanRender.ts#L314)).
- Combine with positional `moveCard` so the row lands where it was dropped within the target group.
- This replaces the current `isReject` path for cross-group targets.

## The menu (option B — full)

Built with the shared `createMenu`/popover component (same one the column menu uses), anchored to the grip via the shared `placeFloating` helper (flip → clamp → scroll) so it never clips off-screen. Opening it dismisses any other open floating panel (existing `closeAll` pattern).

Items, in order:

1. **Open in side panel** — calls the existing card side-panel opener (`boardBlock.ts` card-panel API).
2. — divider —
3. **Duplicate** — deep-copy of the row's `values` + `body`, fresh minted id, inserted immediately below the source row. In a grouped view the copy keeps the same group value (it's a clone, so this is automatic).
4. **Insert row above** — inserts a blank row before this one. **Hidden when the view is sorted** (position is computed).
5. **Insert row below** — inserts a blank row after this one. **Hidden when the view is sorted.**
6. — divider —
7. **Delete row** — danger-styled. **Immediate, no confirmation** (single row; undo restores it).

In a grouped view, **Insert above/below** presets the new row's `view.groupBy` field to the current group's value, matching `+ Add row`'s behavior.

## boardOps additions

`addCard` and `moveCard` already exist. Add:

- `deleteCard(board, id)` — remove the card by id.
- `duplicateCard(board, id): string` — clone values (new id) + body, insert directly after source, return new id.
- `insertCardAt(board, beforeId | null, presets): string` — create a blank card (like `addCard`) and position it relative to an anchor row. `addCard` + `moveCard` can be composed, but a single op keeps the call site clean and the positioning atomic.

All operate on the shared `Board` model and go through the existing `ctx.mutate` flow so save/serialization is unchanged.

## Edge cases

- **Read-only:** no grip is rendered (today's behavior). The menu is therefore unreachable — no separate guard needed.
- **Sorted + grouped simultaneously:** within-group order is computed, so Insert above/below are hidden; cross-group drag still re-assigns the field; menu otherwise full.
- **Empty group / `'—'` group:** dropping into it sets the field to empty string.
- **Re-render during drag:** existing `cancelRowDrag` already cancels an in-flight drag before the DOM is wiped — unchanged.
- **Menu open during re-render:** popover registry/`closeAll` handles teardown (existing pattern).

## Testing

- `boardOps` unit tests: `deleteCard` removes the right card; `duplicateCard` produces a distinct id, copies values + body, lands directly below source; `insertCardAt` positions correctly for `beforeId` and `null`.
- Cross-group drag: dropping a row into another group sets `values[groupBy]` to the target group key (and `''` for the `'—'` group).
- Sorted view: Insert items absent from the menu; grip not draggable but menu opens.
- Round-trip: serialize after each mutation and confirm no data loss (guards against the board round-trip class of bugs).

## Files touched

- `src/webview/boardOps.ts` — new `deleteCard`, `duplicateCard`, `insertCardAt`.
- `src/webview/boardTableRender.ts` — grip click handler, menu construction, sorted-state grip change, cross-group drop logic.
- Reuse (no change): popover/`createMenu` component, `placeFloating`, card side-panel opener.
- Tests under `tests/` for the new `boardOps` functions and cross-group drop.
