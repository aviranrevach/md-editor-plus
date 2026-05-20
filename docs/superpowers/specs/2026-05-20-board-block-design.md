# Board block — design

A Notion-style kanban board stored inline in any markdown file as a real, portable markdown table plus per-card body blocks. Designed so additional views (table, timeline, calendar) can be added later without changing the file format.

## Goal

Let users add a kanban board anywhere in a `.md` file — with columns, drag-droppable cards, and rich per-card details — while keeping the file readable in any standard markdown viewer. v1 ships kanban only; the data model is designed for additional views in later phases.

## Storage format

A board is a region of the document delimited by HTML comment markers. Inside, a markdown table describes the structured fields of each card; optional `board:body` sections describe rich card content. Every piece of board state is plain markdown — there is no JSON or YAML blob in the source.

### Example

~~~markdown
<!-- board:start
     id="b-a3f2"
     name="Sprint 12"
     columns="Todo|Doing|Done"
     column-colors="blue|amber|emerald"
     field-types="Title=text,Status=status,Owner=person,Due=date,Tags=tags"
     hidden-fields="id" -->

| id | Title                  | Status | Owner   | Due        | Tags            |
|----|------------------------|--------|---------|------------|-----------------|
| c1 | Build the kanban block | Doing  | @aviran | 2026-06-01 | feature, editor |
| c2 | Write round-trip tests | Todo   |         |            | tests           |

<!-- board:body id="c1" -->

## Goal
Add the table + comment parser, render the board view, support drag-drop.

- subtask 1
- subtask 2

<!-- board:body id="c2" -->

Brief notes for c2.

<!-- board:end -->
~~~

### Marker grammar

**`board:start`** attributes:
- `id` (required) — short slug, unique per file. Used by drag-drop, body linking, and disambiguation across multiple boards.
- `name` — user-visible board name shown in the board chrome. Free text. Optional in the source; on new boards the UI defaults it to "Untitled board" and an empty `name=""` is treated as "Untitled board" at render time.
- `columns` — pipe-separated status option names, in display order. Renaming an option here also renames the value in every card row at save time.
- `column-colors` — pipe-separated color tokens, index-aligned with `columns`. Tokens: `gray | blue | amber | emerald | red | purple` (same palette as callouts). Missing entries fall back to a deterministic auto-color (hash of column name).
- `field-types` — comma-separated `Name=type` pairs. Valid types: `text`, `status`, `date`, `person`, `tags`. Defaults: `Title=text`, `Status=status`; any field without an explicit type defaults to `text`.
- `hidden-fields` — comma-separated field names that are kept as columns in the table but not rendered on the card face or in the board chrome. Defaults to `id`.

**`board:body`** attributes:
- `id` (required) — must match a card row's `id` value. Bodies whose `id` has no matching row are preserved on round-trip but not rendered (logged to the webview console).

**`board:end`** — closes the region.

Whitespace, line breaks, and attribute order inside the comments are not significant; the parser is tolerant.

### Data model

```ts
type ColorToken = 'gray' | 'blue' | 'amber' | 'emerald' | 'red' | 'purple';
type FieldType = 'text' | 'status' | 'date' | 'person' | 'tags';

interface FieldDef {
  name: string;
  type: FieldType;
  visibleOnCard: boolean;
}

interface ColumnDef {
  name: string;
  color: ColorToken;
}

interface Card {
  id: string;                      // matches the table's id cell
  values: Record<string, string>;  // keyed by field name, raw cell text
  body: string;                    // raw markdown body, '' if none
}

interface Board {
  id: string;
  name: string;                    // '' means render as 'Untitled board'
  columns: ColumnDef[];
  fields: FieldDef[];              // includes Title (first) and Status; always present
  cards: Card[];
}
```

### Round-trip rules

- Card order within a status column is preserved by row order in the table.
- Columns with no cards still appear in the rendered board as long as they are listed in `columns`.
- Orphan `board:body` blocks (no matching row) are preserved on save but not rendered.
- A card row missing an `id` cell gets one assigned on the next save. This is the only write that happens without an explicit user action.
- Field types not present in `field-types` default to `text`. Saving rewrites the line with the explicit type when a field is added via the UI.
- Cell content is escaped on serialize: `|` → `\|`, newlines → `<br>`. Empty cells render as empty strings, not the literal text "empty".
- `tags` cells are stored as comma-separated values; surrounding whitespace is trimmed on parse. Commas inside a tag name are not allowed and are stripped from user input.
- The id auto-suffix rule on conflict is to append `-N` with the smallest unused positive integer (`-2`, then `-3`, etc.).
- `Title` and `Status` are required fields and cannot be hidden or deleted. The UI prevents removing them.

## UI

### Board chrome (block view)

- A board renders as a self-contained block inside the editor — paragraphs above and below it are unaffected.
- Header row: **Board name** on the left (16 px, semibold; inline-editable on click; placeholder text "Untitled board" when empty, dimmed). **Properties** button on the right.
- Columns laid out horizontally inside a horizontally-scrollable container. Each column has:
  - Color dot + name + count chip + `⋯` menu (rename, change color, delete, sort cards by…)
  - Stacked cards (vertically scrollable inside the column when overflow)
  - **+ Add card** button at the bottom (the only way to add a card; this disambiguates which column receives it)
- A trailing **+** column at the end of the row adds a new status option.

### Card face

- Title (13 px, semibold, 2-line clamp)
- Body preview (12 px, dimmed) — the body rendered as plain text (markdown formatting stripped), with the first non-empty line shown, ellipsised at line 2. Auto-derived, not stored.
- Field chips for visible fields:
  - `Status` is never shown on the card face (the column already implies it).
  - `Owner` (`person`) renders as a small avatar bubble with the first letter, full text on hover tooltip.
  - `Due` (`date`) renders as a pill (`Jun 1`). Past dates render in red with an `· overdue` suffix.
  - `Tags` (`tags`) renders one small chip per tag.
  - `Text` fields render as a single inline-truncated string.
- Hover gives the card a subtle elevation. No multi-select in v1.

### Side panel (open card)

- Slides in from the right of the webview, ~420 px wide, full webview height.
- Dismissed by close button, outside-click, or `Esc`. Saves are live — there is no explicit "Save" button.
- Sections, top to bottom:
  1. **Title** — inline editable input, 18 px.
  2. **Fields** — list of `label | editor` pairs, one per non-hidden field (excluding Title). Editors per type:
     - `text` — contenteditable single line
     - `status` — chip dropdown of available columns
     - `date` — native `<input type="date">`
     - `person` — contenteditable single line (free text in v1; no member list)
     - `tags` — chip multi-select with free-form add
  3. **+ Add field** — opens a small popover: pick type, type name. Adds the field as a column to the table and a row to the panel.
  4. **Body** — nested Tiptap editor instance with the same `StarterKit` + `tiptap-markdown` setup as the main editor. The existing bubble menu shows on selection.

### Properties menu

- Opens from the **Properties** button on the board chrome.
- Lists every field with: drag handle (reorder columns in the table), name, type pill, "show on card" toggle, `⋯` menu (rename / delete).
- **+ Add field** at the bottom.
- `Title` and `Status` are listed but their type, name, and delete action are disabled.

### Slash command and block picker

- `/board` inserts an empty board: name "Untitled board", 3 columns (Todo, Doing, Done) with auto colors, fields = `[Title, Status]`, one placeholder card titled "New card" in Todo. The name input is focused on insert so the user can rename immediately.
- The same entry appears in the existing block picker alongside `/callout`, `/toggle`.

### Read-only mode

- Cards are not draggable; the drag handle is hidden.
- The board name is not editable.
- Fields in the side panel render as static text; the **Add card**, **Add field**, **+** column, and `⋯` menus are hidden.
- The board chrome still allows scrolling and opening the side panel for read access.

## Behavior

### Parsing

- A regex finds every `<!-- board:start ... -->` / `<!-- board:end -->` pair in the document text.
- Inside each pair, parser splits the slice on `<!-- board:body id="X" -->` to separate the table from each body section.
- The table is parsed by reusing the markdown table parser the editor already uses (Tiptap-markdown via `tiptap-extension`-driven pipeline).
- Each table row becomes a `Card`. Bodies are stored as raw markdown strings.
- Unknown attributes on the marker comments are preserved verbatim on round-trip so future extensions don't strip data.

### Serialization

- The board's in-memory state is the source of truth while it's mounted; edits update the state and then re-serialize the entire region back to markdown.
- Re-serialization happens on every accepted edit, debounced ~100 ms, and is written into the Tiptap node's text content. The existing markdown sync pipeline (Tiptap → document buffer → file) takes it from there.
- Round-trip is property-tested: `parse(serialize(parse(md))) === parse(md)` for every test fixture.

### Drag-drop

- HTML5 drag-and-drop. Each card element has `draggable="true"`.
- Drop targets: each column body, and the gaps between cards (insertion line shows where the card would land).
- Dragging a card to a new column updates that card's `Status` value to the column name. Reordering within a column moves the row to the new position in the table.
- Drag column headers to reorder columns. Updates `columns` (and `column-colors`) in the start marker.
- All drag interactions respect read-only mode (hidden when read-only is on).

### Field management

- Add field — opens a popover: type picker, name input. Adds a column to the table (empty cells for existing cards), adds an entry to `field-types`, adds the field to the side panel.
- Delete field — confirms once, then removes the column and the value from every card. Removes the entry from `field-types` and any `hidden-fields` listing.
- Rename field — updates the table header cell and the entry in `field-types`. Values are unchanged.
- Reorder field — moves the table column. Does not affect data.
- Toggle "show on card" — updates `hidden-fields` in the start marker.

### Column management

- Add column — appends to `columns` (and to `column-colors` with the next auto-color). No card values change.
- Rename column — updates `columns`, and updates the `Status` value of every card that referenced the old name.
- Delete column — if cards exist with that status, prompts: "Move cards to (column dropdown)" or "Delete cards". After resolution, removes the column from `columns` and `column-colors`.
- Change color — updates the corresponding entry in `column-colors`.

### Conflict & sync

- The board reads from and writes to the same document buffer as the rest of the editor. The existing conflict banner, refresh, and read-only behaviors (see `c8c8ac6 feat(sync)`) apply.
- External edits to the markdown source (e.g., edited in another tool) trigger a reparse and re-render of every board in the file.

### Edge cases

- **Invalid status value** — A card whose `Status` cell does not match any column appears in a synthetic "Uncategorized" column with a warning chip. The column is hidden when empty. Dragging the card into a real column sets the value.
- **Duplicate `id`** — The first occurrence wins; later rows get fresh ids on next save, with a console warning.
- **Missing `id`** — Generated on next save.
- **Body for nonexistent card** — Preserved verbatim in the source on round-trip; not rendered. Console warning.
- **Empty board** — Renders an empty 3-column scaffold with the placeholder card. The block is removed only the way any other block is removed (delete the whole block; emptying it does not auto-delete).
- **Two boards in one file with the same `id`** — Second board's id is auto-suffixed on next save (`b-a3f2-2`). Console warning.

## File layout

```
src/webview/extensions/board.ts         — Tiptap node extension; parse/serialize glue
src/webview/boardBlock.ts               — DOM render, drag-drop, column ops, add-card
src/webview/boardSidePanel.ts           — side panel; nested Tiptap editor for body
src/webview/boardProperties.ts          — properties menu (add/hide/reorder/delete fields)
src/webview/boardModel.ts               — types, parse(md → Board), serialize(Board → md)
src/webview/styles/board.css            — board, column, card, side-panel, properties styles
src/webview/blockPicker.ts              — add /board entry
src/webview/index.ts                    — wire side-panel lifecycle, slash command
tests/board/parse.test.ts               — parse fixtures + round-trip property tests
tests/board/serialize.test.ts           — escape rules, order preservation
tests/board/interactions.test.ts        — drag, column ops, field ops on a JSDOM mount
```

No host-side changes are expected in `src/mdEditorPlusProvider.ts` or `package.json` for v1.

## Out of scope (v1)

- Table view, calendar view, timeline view — designed-for but not built.
- Saved filters or search within a board.
- Card relations (link a card to another card).
- Templates (preset boards).
- Formulas, rollups, aggregates.
- Comments / activity log on cards.
- `@`-mention auto-complete from a member list (free text only in v1).
- Auto-promotion of existing markdown task lists into a board.
- Multi-card selection / bulk move.
- Per-board color theming beyond status colors.
- Export to CSV / JSON.
- Pinning / docking the side panel.

## Open questions

- **Side panel width** — Fixed 420 px in v1. If users frequently write long card bodies, a resize handle (similar to the outline panel's pin behavior) is a natural follow-up.
