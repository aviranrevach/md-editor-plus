# Plain table block, table→board conversion, AI in dragger Turn-into

**Date:** 2026-06-18
**Cards:** c31, c32, c33 (Bundle 2 — the "+" / "Turn into" menu)
**Branch:** `feature/table-board-turn-into-c31-c32-c33`

## Problem

Three related gaps live in the block-insertion ("+") menu and the "Turn into" menus:

- **c32 — No plain Markdown table.** A plain Markdown table has never been
  exposed in the "+" menu or the dragger "Turn into" menu. Git history shows the
  only table-ish entries ever added are `board-kanban` and `board-table`
  (commit `874bad5`). Because `board-table` carries the alias `table`, typing
  "table" in the "+" menu surfaces only **Board: Table**, which reads as "the
  regular table disappeared."
- **c31 — Can't convert a table into a board.** Board blocks (`board-kanban`,
  `board-table`) define only an `insert` method, never a `convert` method, and
  no table↔board mapping logic exists. So nothing in the document can be turned
  into a board.
- **c33 — No AI option in the dragger "Turn into".** The text-selection bubble
  menu already shows a "✨ Using AI" section
  (`bubbleMenu.ts` ~line 212), but the dragger ⠿ "Turn into" drill-down
  (`blockPicker.ts` `renderTurnInto`, ~line 626) lists only regular block
  targets — no AI section.

Kanban ↔ Table is **already solved** as an `activeView` toggle on the same board
block (`boardChrome.ts` ~lines 235–240) and is explicitly out of scope.

## Approach

Approach A (minimal & mechanical). Slot the three fixes into the three existing
menu systems without new abstractions, reusing the board serializer, the AI
transform panel, and the existing Tiptap table extensions. The only extracted
unit is a small, tested `tableToBoard()` mapping helper.

## Component 1 — Plain table block (c32)

Add one entry to `BLOCK_DEFS` in `src/webview/blockPicker.ts`, near the board
entries.

- **`insert`** (from "+" / slash): insert a **3×3 starter table with a header
  row**. Tiptap's `Table`/`TableRow`/`TableHeader`/`TableCell` extensions are
  already registered (`editor.ts` ~line 140) and serialize to GFM `| col |`
  markdown.
- **`convert`** (from "Turn into"): wrap the current block into a table,
  carrying the block's existing inline text into the first cell so no content is
  lost.
- **Aliases:** `table`, `grid`, `markdown table`.
- **Disambiguation:** remove the `table` alias from the `board-table` entry (or
  retarget it) so typing "table" cleanly surfaces **both** "Table" (plain) and
  "Board: Table", instead of only the board.

### Open decisions (resolved)

- Starter table size: **3×3** with a header row.
- `convert`: existing block text goes into the **first cell**; remaining cells
  start empty.
- The new plain table is its **own block** — never auto-upgraded to a board.

## Component 2 — Plain table → Board conversion (c31)

Give the `board-table` `BlockDef` a `convert` method, backed by a small pure
helper `tableToBoard()` (new file `src/webview/tableToBoard.ts`, unit-tested).

Mapping rules:

- **Header row → board columns.** The first column becomes the `Title` field;
  every other column defaults to a `text` field type. No auto-detection of
  Status/typed fields — keeps the conversion lossless and predictable. The user
  can retype a column as Status in the board afterward.
- **Each body row → one card**, cells mapped to the corresponding fields.
- Output is a board **source string** built via the existing serializer path
  (`freshBoardSource` / `boardModel` serialize), landing in **Table view**
  (`active-view="table"`). The existing view toggle then flips to Kanban.
- **Fallback:** an empty or malformed table converts to a fresh starter board
  rather than throwing.

`convert` replaces the table node at the block position with a `board` node
whose `source` attribute is the mapped string, following the existing
node-replacement pattern used by other `convert` methods.

## Component 3 — AI in the dragger "Turn into" (c33)

Add an **"✨ Using AI"** sublabel plus the `AI_TRANSFORMS` rows to
`renderTurnInto` in `blockPicker.ts`, mirroring the bubble menu's
`aiListHtml('ai-into')` block.

The AI transform panel (`aiTransformPanel.open(...)`) operates on a **text
range** (start/end anchors + line numbers), whereas the dragger menu operates on
a **block** (`context.activeBlock.blockPos`). So when an AI target is chosen in
the dragger "Turn into":

1. Select the active block's content to produce a range.
2. Derive the same anchors/line data the bubble menu computes
   (`getMarkdown()` + `locateAnchors`).
3. Call the existing `aiTransformPanel.open(...)` with the chosen target.

No new AI logic — only new wiring from the block context into the existing
panel.

## Data flow

```
"+" / slash menu ──insert──> Tiptap table node ──serialize──> GFM markdown table
dragger "Turn into":
  plain target ──convert──> replace block (e.g. paragraph → table)
  Board: Table ──convert──> tableToBoard() → board source → replace table w/ board node
  ✨ AI target ──select block range → aiTransformPanel.open(target, anchors)
```

## Error handling

- `tableToBoard()` on empty/malformed input → fresh starter board (no throw).
- `convert` to table on a block with no inline content → empty 3×3 starter.
- AI path: if the active block can't be resolved, the menu closes without error
  (matches existing `convertActive` no-op behaviour).

## Testing

- **Unit (`tableToBoard`)**: header→columns; first-col→Title; other cols→text;
  rows→cards; empty/malformed → starter board fallback.
- **Round-trip**: insert plain table → serialize → reparse stays a markdown
  table (guards against plain-table/board confusion).
- **Regression**: existing board view-switch tests and `syncGuard.test.ts` stay
  green.

## Out of scope

- Reverse conversion (Board → plain table).
- Kanban ↔ Table view switching (already implemented).
- Auto-detecting typed fields (Status, Tags) during table→board conversion.
