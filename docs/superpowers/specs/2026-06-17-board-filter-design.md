# Board Filter (c20)

Date: 2026-06-17
Status: Design approved.

## Problem

The board has views (table/kanban), grouping (c12), and sort — but no way to **show/hide
items by status or tag**. A user with a long board can't focus on, say, only the `Urgent!!`
items or only the `Todo` column's worth of cards across a grouped table. Filter is the missing
third leg.

## Scope (deliberately lean — Low priority)

- Filter by **status-type and tag-type fields only** (the dropdown-style fields). No free-text
  / "contains" matching, no filtering by Title/Area text.
- The filter is **session-only**: it lives in webview memory per open board and is **never
  written to the markdown**. Closing/reopening the file clears it. This keeps the
  serialization round-trip untouched (a known source of past bugs) and removes any
  "where did my items go?" risk on reopen.

## The filter model

State (in-memory only):

```
type FilterState = Record<string, string[]>;   // fieldName -> allowed values ([] / absent = field inactive)
```

Matching — a card is **shown** iff it passes every active field:

- **AND across fields:** the card must pass each field that has a non-empty allowed-value list.
- **OR within a field:** the card passes a field if its value for that field is in the allowed
  set. For a **tag field** (multi-value), the card passes if **any** of its tags is in the set.
- **(Empty):** each field's value list may include the sentinel `(Empty)`; a card passes via it
  when it has no value for that field (status: blank; tags: no tags). This makes "show only
  cards with no Status" explicit and prevents accidental hiding.
- A field whose allowed list is empty / absent is **inactive** (does not constrain).
- An empty `FilterState` (no active fields) shows all cards.

Filtering changes **visibility only** — never card order, never card data. Cards keep their real
positions in the board source.

## The UI

- A **`Filter` pill** in the board toolbar, beside the view switch.
  - Inactive: outline style, label `Filter`.
  - Active: filled style, label `Filter · N` where **N = number of active fields**, plus a small
    secondary count **`· M hidden`** (M = cards hidden by the filter) so nothing feels lost.
  - The pill is **hidden entirely** when the board has no status/tag fields to filter on.
- Clicking the pill opens a small **popover panel**:
  - One row per filterable (status/tag) field. Clicking a field row expands its values as
    toggleable colored chips, reusing the existing status-color tokens (`statusColorToken` /
    the same chip styling used elsewhere). Each field also lists an `(Empty)` chip.
  - Selecting chips sets that field's allowed values; deselecting all collapses the field back to
    inactive.
  - A **Clear** link resets the whole filter.
  - Opening the panel **dismisses other floating popovers** (reuses the existing closeAll
    pattern); clicking outside closes it.
- Applies to **both table and kanban** views.

## Where it hooks in (components)

- **Create `src/webview/boardFilter.ts`** — pure, DOM-free:
  - `type FilterState = Record<string, string[]>`
  - `applyFilter(cards: Card[], filter: FilterState, board: Board): Card[]` — returns the visible
    subset in original order.
  - `EMPTY_VALUE` sentinel (the `(Empty)` token) and a helper to list a field's distinct values
    (reuse existing option/tag helpers from `boardModel` where possible).
  - `countHidden(total, visible)` is trivial; the renderer derives M as `all.length - visible.length`.
- **Create `src/webview/boardFilterPanel.ts`** — the pill + popover DOM. Mirrors how
  `boardChrome.ts` and the existing pickers build their controls. Exposes a factory returning
  `{ el, refresh }` and takes callbacks to read/update the in-memory `FilterState` and trigger a
  re-render.
- **Table render** (`boardTableRender.ts`): run `applyFilter(b.cards, filter, b)` to get the
  visible cards, then feed those into the existing `applySort` → `applyGroup` pipeline (filter
  runs **first**).
- **Kanban render** (`boardKanbanRender.ts`): run `applyFilter` before cards are distributed into
  columns.
- **State ownership:** the in-memory `FilterState` lives on the board view-state object that the
  renderers already receive (alongside the active view), so toggling the filter just re-renders.
  Toggling the filter **does not** post an `edit`/`save` message — it is not a document change.

## Interactions / edge cases

- **Search** (`boardSearch.ts`) is independent: it highlights; filter hides. Search highlights
  only what's visible after filtering — acceptable, no special handling.
- **Drag reorder while filtered:** stays enabled. Because filter is visibility-only and the source
  order is unchanged, a drop lands relative to the visible neighbor's real index. (Sort already
  disables row drag separately; that behavior is unchanged.)
- **A filtered value disappears** (e.g. the user renames/deletes a status that was in the allowed
  set): `applyFilter` simply stops matching it; the stale entry is harmless and the pill count
  reflects only fields that still constrain. The panel only ever shows values that currently exist.
- **View switch (table↔kanban):** the filter state persists across the switch within the session
  (it's board-level, not per-view).

## Components summary

- Create: `src/webview/boardFilter.ts` — pure `applyFilter` + `FilterState` + `EMPTY_VALUE`.
- Create: `tests/boardFilter.test.ts`.
- Create: `src/webview/boardFilterPanel.ts` — pill + popover DOM.
- Modify: `src/webview/boardTableRender.ts` — apply filter before sort/group; show hidden count.
- Modify: `src/webview/boardKanbanRender.ts` — apply filter before column distribution.
- Modify: wherever the board chrome/toolbar is assembled — mount the filter pill, own the
  in-memory `FilterState`, re-render on change.

## Testing

`tests/boardFilter.test.ts` (pure, thorough):

1. Empty `FilterState` → returns all cards, original order.
2. Single status field, one value → only matching cards.
3. Single status field, two values → OR within field (either matches).
4. Two fields active → AND across fields (must pass both).
5. Tag field, card has multiple tags → matches if any tag is in the allowed set.
6. `(Empty)` selected for a field → matches cards with no value for that field (and not others).
7. `(Empty)` + a real value selected → matches blanks OR that value.
8. A field with an empty allowed list is inactive (does not constrain).
9. Unknown field name in `FilterState` → ignored, does not hide anything.
10. Result preserves the input card order (visibility only, no reordering).

UI wiring (pill/panel) is thin and exercised manually in the Extension Development Host.

## Out of scope

- Free-text / "contains" filtering and filtering by Title/Area.
- Persisting the filter to the markdown (intentionally session-only).
- Filtering by date/number operators (no such field types here).
- Auto-ordering or any change to sort/group behavior.
- A per-column-header filter entry (chosen the single toolbar pill instead).
