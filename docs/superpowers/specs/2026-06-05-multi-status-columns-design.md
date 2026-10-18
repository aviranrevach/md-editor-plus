# Multiple status columns — design

**Date:** 2026-06-05
**Status:** Approved design, pending implementation plan

## Problem

A board can have only one working status column. The built-in **Status** field
stores its option pills (Todo / Doing / Done) in a single board-level list,
`board.columns`, which the Kanban view also uses as its columns. Any *additional*
status-type column the user creates has nowhere to store its own options and no
way to write to its own value:

- **Clicking an option does nothing useful.** The status dropdown click handler is
  hardcoded to write `card.values.Status` ([boardTableRender.ts:1109](../../../src/webview/boardTableRender.ts#L1109),
  [boardSidePanel.ts:440](../../../src/webview/boardSidePanel.ts#L440)). Clicking a pill in
  a second status column ("Impact") silently sets the *Status* field instead.
- **No way to edit the states.** `FieldDef` has no `options` field
  ([boardModel.ts:6](../../../src/webview/boardModel.ts#L6)), and the field action menu
  ([boardProperties.ts:242](../../../src/webview/boardProperties.ts#L242)) has no "edit options" entry.
  Options can only be edited for the built-in Status field via the Kanban column chrome.

The other column types (Text, Date, Person, Tags) are **not affected** — they already
write to their own column via `card.values[field.name]`. Status is the only broken type.

## Goal

Make every status column a first-class, self-contained column: it owns its own set of
states, clicking sets the correct field, and its states can be added / renamed /
recolored / deleted from three entry points. Also widen the color palette from 6 to 10.

This is deliberately scoped to **Status** and sets up the upcoming **grouping** work
cleanly (grouping by any status field just reads that field's own options).

## Out of scope (captured as follow-up tasks)

- **Tags auto-colors** — render free-text tags with stable hash-based colors (Airtable-style).
- **Tags defined/reusable options** — give Tags its own configurable option set with colors,
  like Status. Tags stays free-text in this task.
- **Grouping method** — the next task after this one.
- Unifying `board.columns` into the Status field's `options` (see "Status field storage" below) —
  may be folded into the grouping task.

## Design

### 1. Data model (`boardModel.ts`)

**Expand the palette to 10 colors.** Add four tokens; the existing six are unchanged.

```ts
export type ColorToken =
  | 'gray' | 'blue' | 'amber' | 'emerald' | 'red' | 'purple'   // existing — unchanged
  | 'orange' | 'teal' | 'indigo' | 'pink';                     // new
```

Update `COLOR_TOKENS` to include all ten (drives `autoColor`, `nextColor`, and parse
validation). Add matching chip/column CSS classes in `board.css` for the four new tokens.

**Add per-field options.**

```ts
export interface FieldDef {
  name: string;
  type: FieldType;
  visibleOnCard: boolean;
  options?: ColumnDef[];   // states for status fields (other than built-in Status)
}
```

**Status field storage (back-compat decision).** The built-in **Status** field keeps using
the existing board-level `board.columns` as its option list — unchanged on disk, so all
existing boards open exactly as before and the Kanban view is untouched. *Additional* status
fields store their states in `FieldDef.options`. A single accessor centralizes the branch:

```ts
// Read the option list for any status field.
export function getStatusOptions(board: Board, fieldName: string): ColumnDef[] {
  if (fieldName === 'Status') return board.columns;
  return board.fields.find(f => f.name === fieldName)?.options ?? [];
}

// Produce a new Board with the option list for a status field replaced.
export function setStatusOptions(board: Board, fieldName: string, options: ColumnDef[]): Board { … }
```

All status rendering, the dropdown, and the options editor go through these helpers, so no
caller special-cases "Status" itself. (A future task may migrate `board.columns` into
`Status.options` to remove the branch entirely; not needed now.)

### 2. Serialization (`boardModel.ts`)

Existing `columns="…"` / `column-colors="…"` on the `board:start` marker continue to hold
the **Status** field's options — no format change there.

Additional status fields' options serialize into one new `board:start` attribute:

```
field-options="Impact=Low:orange|Medium:amber|High:red;Priority=P1:red|P2:amber"
```

- Fields separated by `;`
- Within a field: `FieldName=state:color|state:color`
- State name and color joined by `:`

**Constraint (documented, matches the existing `columns` limitation):** state names and field
names cannot contain `; | : =`. Realistic status labels don't. Field names with spaces are fine
(they sit in the attribute *value*, not the key).

Parsing: after building `fields`, read `field-options`, validate colors against `COLOR_TOKENS`,
and attach `options` to the matching status fields. Serializing: emit `field-options` for every
status field except `Status` that has options. The attribute is additive — existing parsers
ignore unknown `board:start` attributes, so this is round-trip safe and does not interact with
the pending board-parse fix.

### 3. Click + render fixes

- **`boardTableRender.ts`** — the `status` case reads options via `getStatusOptions(board, field.name)`;
  `openStatusDropdown` takes the `field` and writes `{ [field.name]: col.name }` (not hardcoded `Status`).
  Chip color resolves from that field's options.
- **`boardSidePanel.ts`** — `renderStatusChipTrigger` and `openStatusDropdown` use the field being
  rendered: read its options, show its current value (`card.values[field.name]`), write to `field.name`.

### 4. Options editor (new reusable component)

A single popover, `openStatusOptionsEditor(anchor, board, fieldName, onChange)`. Each row is one state:

- **Color swatch** (left) → opens the 10-color palette (5 × 2) to recolor.
- **Editable name** → rename inline; renaming migrates existing card values from the old name to the
  new one (same migration the Kanban column rename already does, [boardKanbanRender.ts:206](../../../src/webview/boardKanbanRender.ts#L206)).
- **× delete** → removes the state (and clears that value from cards holding it).
- **+ Add** → appends a new state seeded with `nextColor`.

Reads/writes via `getStatusOptions` / `setStatusOptions`, so it works identically for the built-in
Status field (mutates `board.columns`) and additional status fields (mutates `field.options`).

### 5. Three entry points

1. **+ New column popover** (`promptNewField`, [boardProperties.ts:604](../../../src/webview/boardProperties.ts#L604)) —
   picking **Status** reveals an inline **States** section (seeded with sensible defaults, editable)
   plus a **Create** button, instead of committing immediately. Other types commit immediately as today.
   The created status field carries its seeded `options`.
2. **Column-header ⋯** (table column header / Kanban) — add an **Edit options** item for status fields
   that opens the editor. Kanban's existing Status column chrome (rename/recolor/delete column) already
   edits the Status options and is left in place.
3. **Per-property ⋯** in the More panel (`openFieldActionMenu`) — add an **Edit options** item, shown only
   when `field.type === 'status'`. Note: this item is **enabled for the built-in Status field** even though
   Status is otherwise `isLocked` (rename/delete stay locked; editing its states is allowed).

## Components & boundaries

| Unit | Responsibility |
|------|----------------|
| `boardModel.ts` | palette tokens, `FieldDef.options`, `getStatusOptions`/`setStatusOptions`, `field-options` parse/serialize |
| `openStatusOptionsEditor` (new) | the add/rename/recolor/delete states popover; type-agnostic via helpers |
| `boardTableRender.ts` | status cell render + dropdown keyed to the actual field |
| `boardSidePanel.ts` | status trigger + dropdown keyed to the actual field |
| `boardProperties.ts` | "Edit options" entry in field action menu; inline States in new-column popover |
| `board.css` | four new color-token classes |

## Testing

- **Model round-trip:** parse → serialize → parse for a board with two status fields preserves both
  option sets, colors, and per-card values. Include a new color token. Include a field name with a space.
- **Back-compat:** an existing board (only `columns`/`column-colors`, no `field-options`) parses unchanged
  and re-serializes identically.
- **Click targeting:** setting a value in a second status field writes that field, leaves `Status` untouched.
- **Rename migration:** renaming a state updates all cards holding the old value.
- **Delete:** deleting a state clears it from cards.
- Run the existing board model test suite; the pre-existing `toggle.test.ts` failure is unrelated.

## Risks

- **Round-trip / parse** — the codebase has a known pending board-parse bug; this change is purely additive
  to `board:start` attributes and must not regress round-trip. Covered by the round-trip tests above.
- **`promptNewField` flow change** — moving Status from "commit on type click" to "reveal states + Create"
  is the most involved UI change; other types keep their immediate-commit behavior.
