# Board tags — managed, colored multi-select

**Date:** 2026-06-05
**Status:** Approved design, pending implementation plan
**Branch:** `feat/board-tags`

## Problem

Tag columns are free-text today: the cell stores a comma-separated string, the editor is a contenteditable/free-text input, and every chip renders the same **gray** (`.bd-tag` [boardTableRender.ts:1482](../../../src/webview/styles/board.css#L1482); `.board-tag-chip` in the side panel). There's no defined set, no colors, and no way to rename/recolor a tag across cards. The grouping work already colors tag *group bands* (via `autoColorPublic`), but the chips themselves stay gray.

## Goal

Make a tags column a **managed multi-select set with colors**, mirroring the Status options model:
- Each tag has a color. New tags default to a stable name-hash color (`autoColorPublic`); the color is editable afterward.
- The cell becomes a **multi-select picker**: a checklist of existing tags (colored), toggling each on/off, plus "+ Create '…'" to add a new tag by typing.
- Tags are editable as a set (rename / recolor / delete) from the existing "Edit options" entry, with rename/delete migrating across every card's comma-list.
- Tag chips render in their color everywhere (table cells, side panel). Existing boards light up immediately by deriving the set from tags already present.

## Design

### 1. Data model (`boardModel.ts`)

A tags field reuses the existing `FieldDef.options?: ColumnDef[]` (added for status) as its **defined tag set** (name + color). The card value stays the comma-separated list of tag *names*; a tag's color is resolved from the field's `options`.

Reuse the existing `getStatusOptions(board, fieldName)` accessor for reading a field's options (it already returns `field.options ?? []` for any non-`Status` field) — optionally alias it `getFieldOptions` for clarity, but no behavior change.

**Tag-list-aware mutation helpers** (tags store comma-lists, unlike status's whole-value, so these differ from the status helpers):
```ts
export function addTagOption(board, field, name): Board;        // append to options w/ autoColorPublic(name) default; no-op if exists
export function renameTagOption(board, field, oldName, newName): Board; // rename in options + remap within every card's comma-list (dedupe)
export function deleteTagOption(board, field, name): Board;     // remove from options + strip from every card's list
export function recolorTagOption(board, field, name, color): Board; // options only (reuse recolor logic)
export function toggleTagOnCard(board, field, cardId, name): Board;  // add/remove a tag in one card's comma-list
```
A shared internal `splitTags`/`joinTags` (trim, drop empty, dedupe) keeps list handling consistent.

### 2. Derive-on-load + serialization (`boardModel.ts`)

- **Serialization:** extend the existing `field-options` emit/parse to include **tags** fields (today it guards `f.type === 'status' && f.name !== 'Status'`; broaden to also emit for `f.type === 'tags'`). Parsing already attaches `options` to a field by name — broaden the attach loop to tags fields too. Format is unchanged (`Field=name:color|...`).
- **Derive-on-load:** after parsing, for every tags field, walk all card values and append any tag not already in `options` as a new option colored by `autoColorPublic(name)`. This makes existing boards (which have tags but no stored options) immediately managed + colored, and keeps the set complete if a card references a tag not yet in the stored set. Stored options (with possibly-edited colors) take precedence over derived ones.

### 3. Cell picker (new component)

Clicking a tags cell opens a **multi-select picker** popover (replacing `openTagsEditor`'s contenteditable):
- Lists the field's options as colored chips, each a toggle showing a check when the card has it.
- A text input filters the list and offers **"+ Create '<typed>'"** — creating adds the tag to the field options (auto-colored) and toggles it on for the card.
- Toggling calls `toggleTagOnCard`. Closes on outside click.
- The same picker renders in the side panel (replacing the current free-text `renderTagsEditor`).

This is distinct from the status dropdown (single-select); it's a checklist. It can share small pieces (chip building, the create row) but is its own function, e.g. `openTagsPicker(anchor, card, field, ctx)`.

### 4. Editing the set ("Edit options" → tags)

The existing "Edit options" entry in the column ⋯ ([boardTableRender.ts](../../../src/webview/boardTableRender.ts)) and the properties ⋯ ([boardProperties.ts](../../../src/webview/boardProperties.ts)) currently shows only for `field.type === 'status'`. Extend it to `field.type === 'tags'`. The editor reuses `buildOptionsEditor` (add/rename/recolor/delete rows) via a wrapper that dispatches to the **tag** helpers (comma-list-aware) instead of the status helpers. New tags added from this editor default to `autoColorPublic`.

### 5. Colored chips (render)

- Table cell `case 'tags'` ([boardTableRender.ts:1014](../../../src/webview/boardTableRender.ts#L1014)): each `.bd-tag` chip gets the `color-<token>` class for its tag's option color (fallback `autoColorPublic` if somehow absent).
- Side panel `renderTagsEditor` chips (`.board-tag-chip`): same coloring.
- CSS: make `.bd-tag.color-<token>` / `.board-tag-chip.color-<token>` use the existing `--board-chip-<token>-bg/-fg` variables (the same 10-token system).

## Components & boundaries

| Unit | Responsibility |
|------|----------------|
| `boardModel.ts` | tag set in `field.options`; `splitTags/joinTags`; `addTagOption/renameTagOption/deleteTagOption/recolorTagOption/toggleTagOnCard`; derive-on-load; `field-options` covers tags |
| tags picker (new, e.g. `boardTagsPicker.ts` or in `boardStatusOptions.ts`) | multi-select checklist + create-by-typing |
| `boardStatusOptions.ts` | "Edit options" wrapper dispatches status vs tag helpers |
| `boardTableRender.ts` / `boardSidePanel.ts` | open the picker; render colored chips; show "Edit options" for tags |
| `boardProperties.ts` | "Edit options" menu item for tags |
| `board.css` | colored `.bd-tag` / `.board-tag-chip` |

## Testing

`tests/board/` (model unit + jsdom). Add:
- **Serialization round-trip** for a tags field with options/colors (incl. a name with a space, a new color token).
- **Derive-on-load:** a board whose tags field has no stored options ends up with one option per distinct tag, auto-colored; deterministic colors.
- **Helpers:** `addTagOption` (default auto-color, no dup), `renameTagOption` (migrates `"backend, urgent"` → `"infra, urgent"` when backend→infra; dedupes), `deleteTagOption` (strips from lists), `toggleTagOnCard` (adds/removes; preserves order/dedupe).
- **Picker (jsdom):** clicking a tags cell opens the checklist; toggling a tag updates the card value; "+ Create" adds an auto-colored option and toggles it on; multi-select keeps multiple tags.
- **Chip color:** a tag's cell chip carries the `color-<token>` class of its option.
- **Edit options for tags:** menu item appears; rename via the editor migrates card values.

## Risks / out of scope

- **Migration correctness across comma-lists** is the main risk — rename/delete must respect existing list membership, ordering, and dedupe. Covered by helper unit tests.
- Out of scope: tag reordering within the set (keep stored/derived order); per-card tag ordering UI; tag autocomplete ranking beyond simple filter; kanban grouping by tags (table grouping already handles tags).
- The built-in Status field is untouched; this only affects `tags`-type fields.
