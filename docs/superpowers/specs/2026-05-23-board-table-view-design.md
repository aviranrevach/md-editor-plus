# Board — table view (v1)

A second view of the board block: same cards, same fields, presented as an editable table with inline cells, sort, group, resizable column widths, and row reordering. Kanban remains the default view; per-board view choice persists in the markdown source.

## Goal

Let users see and edit board cards as a dense table — Notion-style — without losing the existing kanban view or the file-format guarantees from the board v1 spec (`2026-05-20-board-block-design.md`).

The data model is shared; only the rendering and a small set of per-view settings change.

## Storage

A board can declare any number of view-config blocks inside its region. The active view is named on `board:start`.

```markdown
<!-- board:start id="b-a3f2" name="Sprint 12"
     columns="Todo|Doing|Done"
     column-colors="blue|amber|emerald"
     field-types="Title=text,Status=status,Owner=person,Due=date,Tags=tags"
     hidden-fields="id"
     active-view="table" -->

<!-- board:view name="kanban" hidden="id" -->
<!-- board:view name="table"
     columns="Title,Status,Owner,Due,Tags"
     hidden="id"
     sort="Due,asc"
     group="Status"
     widths="Title=240,Status=120,Owner=140,Due=110,Tags=200" -->

| id | Title                  | Status | Owner   | Due        | Tags            |
|----|------------------------|--------|---------|------------|-----------------|
| c1 | Build the kanban block | Doing  | @aviran | 2026-06-01 | feature, editor |

<!-- board:end -->
```

### `board:view` attributes

- `name` (required) — `kanban` or `table`. Free-form string for forward compatibility (`calendar`, `timeline`, …).
- `columns` — comma-separated field names in display order. Missing → use the order from `field-types`.
- `hidden` — comma-separated field names hidden in this view only. Missing → use the board-level `hidden-fields`.
- `sort` — `<field>,<asc|desc>`. Missing → no sort.
- `group` — single field name to group by. Missing → flat.
- `widths` — `Field=px,Field=px` per-column width overrides. Missing entries default to 160 px.

Unknown attributes on `board:view` are preserved verbatim on round-trip (same convention `board:start` uses) so future view-specific knobs don't get stripped.

### Round-trip invariant

A kanban-only board with no `board:view` block parses to `views: [{ name: 'kanban' }], activeView: 'kanban'` and serializes back **without adding any `board:view` block** — no spurious diff. The first time a user changes a view setting, the relevant section appears.

## Data model

```ts
interface ViewDef {
  name: string;                            // 'kanban' | 'table' (extensible)
  // table-only (kanban ignores):
  columns?:  string[];
  hidden?:   string[];
  sort?:     { field: string; dir: 'asc' | 'desc' };
  groupBy?:  string;
  widths?:   Record<string, number>;
}

interface Board {
  id: string;
  name: string;
  columns: ColumnDef[];
  fields:  FieldDef[];
  cards:   Card[];
  views:   ViewDef[];          // NEW
  activeView: string;          // NEW (defaults to 'kanban')
}
```

`Card`, `FieldDef`, `ColumnDef` are unchanged from the kanban spec.

## UI

### View switcher

There is no permanent tab strip in the board chrome. The board's chrome is:

- Left: board name (inline-editable, as before)
- Right: **⋯ three-dots menu** (replaces the standalone "Properties" button)

⋯ menu contents (top to bottom):

1. **View** — Kanban/Table segmented control (macOS-style pill, same component as the mermaid header's eye/code toggle). Clicking a tab switches view and closes the menu.
2. Separator.
3. **Properties** — the existing field list (drag handle, name, type pill, show-on-card toggle, ⋯ per-field menu, + Add field). The Properties section is **view-aware**: hide / reorder writes to the active view's `hidden` / `columns`, not the board-level defaults.
4. Separator.
5. *(Reserved for later: Copy as markdown, Export CSV.)*

### Slash menu

Two insert entries replace the existing single `/board`:

- `/board kanban` — empty board, `active-view="kanban"`, default 3 columns (Todo, Doing, Done), one placeholder card in Todo.
- `/board table` — same defaults plus a `<!-- board:view name="table" -->` block; `active-view="table"`.

### Table layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Sprint 12                                                       [⋯]    │
├─────────────────────────────────────────────────────────────────────────┤
│      TITLE                STATUS    OWNER     DUE ▲     TAGS            │
├─────────────────────────────────────────────────────────────────────────┤
│ ▾ Doing (2)                                              [+ Add card]   │
│ ⋮ ▸ Build the kanban…  📄  ●Doing   @aviran   Jun 1     feature editor  │
│ ⋮ ▸ Write round-trip…       ●Doing   @j        Jun 3     tests          │
│ ▾ Todo (1)                                               [+ Add card]   │
│ ⋮ ▸ Hook up calendar        ●Todo                                       │
│ ▾ Done (0)                                               [+ Add card]   │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Header row

- One cell per visible field, in `view.columns` order.
- Cell shows: 10.5 px uppercase field name (dimmed), sort caret only on the actively-sorted column.
- Hover reveals a column ⋯ menu on the right edge: sort asc, sort desc, hide column, group by this, reset column width.
- The right 4 px of each header cell is a resize handle (`cursor: col-resize`).

#### Body row

- Left gutter (36 px wide) holds, on row hover:
  - `⋮` drag handle for row reorder (hidden while sort is active).
  - `▸` expand button that opens the side panel for that card.
- Then one cell per visible field. Each cell is click-to-edit.
- The Title cell shows a small 📄 indicator after the text when the card has a non-empty body.

#### Cell rendering and inline editors

| Type | View | Editor |
|---|---|---|
| `text` | Plain text, single line, ellipsis on overflow | `contenteditable` inline. Enter / Tab / blur commits; Esc cancels. |
| `status` | Color chip with column color + name | Dropdown of column options (reuses the side-panel status picker). |
| `date` | `Jun 1` pill; past dates render red with a "· overdue" suffix (matches the kanban card-face convention) | Native `<input type="date">` opened in a small popover. |
| `person` | Plain text (no avatar in the table — too cramped) | `contenteditable` inline (free text in v1). |
| `tags` | Small chips, comma-wrap to next line on overflow | Chip multi-select popover (reuses the side-panel tags picker). |

Status is never hidden by default in table view (so grouping by status remains coherent). The user can hide it explicitly.

#### Group headers (only when `view.groupBy` is set)

- Full-width row between groups: `▾`/`▸` collapse caret, group value chip / text, count, `+ Add card` button on the right.
- Group order:
  - `groupBy === 'Status'` → uses `board.columns` order.
  - Otherwise → sorted alphabetically by group value, with empty / missing values in a "—" group at the end.
- Collapse state is in-memory only (resets on reload), keeping the markdown source clean.
- Empty groups still render their header so the user can add a card directly into them.

#### Add card

- Flat (no group): one `+ Add card` row pinned at the bottom of the table.
- Grouped: each group header has a `+ Add card` button on its right. New card inherits the group's value automatically; if grouped by anything other than Status, Status defaults to the first column.
- New card focuses the Title cell in edit mode immediately.

#### Empty state

No cards at all → centered placeholder: *"No cards. Click + Add card to get started."*

### Read-only mode

- No drag handles, no inline edit, no resize, no column ⋯ menu, no `+ Add card`.
- Sort caret renders but is not interactive.
- Row click opens the side panel in read-only mode.

## Mechanics

### Sort

- Click a column header → cycles unsorted → asc → desc → unsorted. Persists to `view.sort`.
- Single-column sort only.
- Render-time sort: the markdown table row order is the canonical order; the rendered table presents rows sorted. Kanban view always uses the canonical order; sort never mutates row positions in the source.
- Per-type comparators: text/person → alphabetical case-insensitive; date → chronological (empty last); status → by `board.columns` index; tags → first tag alphabetical (empty last).
- Row drag is disabled while sort is active. The gutter drag handle is hidden, with a "clear sort to reorder" tooltip on hover of the gutter area.

### Group

- Set via the column ⋯ menu's "Group by this field". Persists to `view.groupBy`.
- Within a group, rows follow either the active sort (if set) or the canonical row order.
- Cross-group drop on row drag is rejected — the drop indicator flashes red. Changing a row's group is done by editing the cell, not by dragging.
- Group by `tags`: a multi-tag card appears in the group of its first tag only. The other tags still render in the row's tag cell.
- Group by `date`: buckets by exact date value (e.g. `Jun 1`, `Jun 2`). No smart week / month bucketing in v1.

### Column widths

- Drag the 4-px right edge of a header → resize. Min 60 px, no max.
- Persists to `view.widths[fieldName]`. The "Reset column width" menu item removes the entry.
- Total table width = sum of column widths + gutter. The container is horizontally scrollable beyond its own width.

### Row reorder

- Drag the `⋮` gutter handle. Drop indicator is a separate blue line between rows — never an outline on the rows themselves (matches the existing board drop-indicator convention used everywhere else in the board).
- Reorders the underlying markdown table row position, which also reorders the kanban view's card stacks.
- Within-group only when grouped.

### Column reorder

- Drag a header cell (excluding the resize edge). Drop indicator: blue line between columns.
- Persists to `view.columns`. Title can move freely in table view.

### View switch

- ⋯ menu → click the Table or Kanban segment.
- Active editor commits before unmount.
- The current renderer is destroyed, `board.activeView` is mutated (debounced serialize fires), the new renderer mounts.

### Active editor commit semantics

- Enter / Tab / blur commits.
- Esc cancels.
- View switch, side-panel open, mutation from another control → commit-then-act.

## Edge cases

- **Sort key hidden** → auto-clear `view.sort`. The source attr is stripped.
- **Group key hidden** → auto-clear `view.groupBy`. Source attr stripped.
- **Field deleted** → clear sort / group / widths entries referencing it across every view.
- **`view.columns` references missing field** → silently dropped on parse.
- **`view.columns` missing an existing field** → that field is hidden in this view; Properties popover shows it as available to toggle on.
- **`view.widths` references a hidden field** → preserved (toggling back keeps the width). Widths for truly-deleted fields are stripped on save.
- **`groupBy === 'Status'` and a card has invalid status** → card goes into a synthetic "Uncategorized" group (same convention kanban uses).
- **Hide all fields** → degenerate but allowed. Table renders just the gutter + "+ Add card".
- **Try to drag a row while sort is active** → drag handle hidden, no-op.
- **Add card while sorted / grouped** → appended to the markdown table; rendered at its sort position. Grouped: card inherits group value, Title focused.
- **Two boards in one file, both with table views** → no special handling needed — each board's `board:view` blocks are scoped to its own region.

## File layout

```
src/webview/boardBlock.ts            — controller / Tiptap node (slimmed to ~400 lines)
src/webview/boardKanbanRender.ts     — kanban renderer (extracted from boardBlock)
src/webview/boardTableRender.ts      — NEW table renderer
src/webview/boardSidePanel.ts        — unchanged (shared)
src/webview/boardProperties.ts       — view-aware (small changes)
src/webview/boardOps.ts              — NEW; pure mutations on Board state
src/webview/boardDragShared.ts       — NEW; manual mousedown/move/up + blue-line drop indicator helpers
src/webview/boardModel.ts            — extended with ViewDef + board:view marker parse/serialize
src/webview/styles/board.css         — extended with table styles
tests/board/parse.test.ts            — extended with board:view fixtures
tests/board/serialize.test.ts        — extended with round-trip for views
tests/board/table.test.ts            — NEW; table-specific interactions (sort, group, widths, reorder)
```

### Renderer contract

```ts
interface BoardRendererCtx {
  root:           HTMLElement;
  getBoard:       () => Board;
  mutate:         (fn: (b: Board) => void) => void;
  openSidePanel:  (cardId: string) => void;
  openProperties: () => void;
  readonly:       boolean;
}
interface BoardRendererOps {
  update:  (next: Board) => void;
  destroy: () => void;
}
function mountKanban(ctx: BoardRendererCtx): BoardRendererOps;
function mountTable (ctx: BoardRendererCtx): BoardRendererOps;
```

### View-switch flow

1. `boardBlock.ts` on mount: parses source, builds chrome (name + ⋯ menu), mounts the renderer for `board.activeView`.
2. User clicks the other view in ⋯ menu → controller calls `renderer.destroy()`, mutates `board.activeView`, mounts the new renderer.
3. User edits a cell → renderer calls `ctx.mutate(b => updateCell(b, ...))` → controller re-serializes (debounced ~100 ms) → `renderer.update(newBoard)` for any non-local re-renders (e.g. sort moved a row).

## Out of scope (v1)

These are tracked in `docs/superpowers/backlog.md` under "Board — table view":

- Multi-column sort
- Smart "by week / month" bucketing for date group-by
- Multi-group membership when grouping by `tags`
- Frozen / sticky first column on horizontal scroll
- Filter / search bar inside the table
- Aggregations in the group header (count, sum, avg)
- Conditional formatting (cell color by value)
- Bulk-select rows + bulk edit
- CSV / markdown export of the table
- Per-view saved presets (e.g. "Show overdue only")
- Persisted group-collapse state

Other deferred items (calendar view, timeline view, kanban v1 carry-overs, mermaid a11y) are also captured in `backlog.md`.
