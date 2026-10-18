# c19 — Status management fix (design)

**Date:** 2026-06-30
**Branch:** `feature/c19-status-management`
**TODO row:** c19 (Boards, High) — "Status is broken on boards"

## Problem

The status-option editor on boards has three reported failures:

1. **Synced statuses** — adding/editing a status can silently change a
   *different* status. Editing one ends up mutating its twin.
2. **No reordering** — you cannot change the order of status options
   (which drives kanban column order and table sort order).
3. **"Main three-dot menu" editing blocked** — reported as unable to edit
   statuses from the document menu at all.

## Root cause

Status options are identified by **name** (string equality). Every model
operation matches with `option.name === x`
(`renameStatusOption`, `recolorStatusOption`, `deleteStatusOption`,
`addStatusOption` in `src/webview/boardModel.ts`). Cards also store their
status as the **name string** (`card.values['Status'] = 'Todo'`).

The moment two options share a name, they become *linked*: a rename,
recolor, or delete that matches that name hits **both**. The add button
auto-dedupes ("New" → "New 2"), but **rename has no uniqueness guard**, so
duplicates — and thus the "synced" bug — are easy to create. Duplicate
names are also fundamentally ambiguous for cards, which only know the name.

There is **no reorder** capability anywhere in the options editor
(`src/webview/boardStatusOptions.ts`) or model — it only adds, renames,
recolors, deletes.

For #3: the document `⋯` menu → **Properties** → per-field `⋮` → **Edit
options** path is in fact already wired
(`boardChrome.ts` → `boardProperties.ts:298-313` →
`openStatusOptionsEditor`). Both that menu and the table column header call
the **same** `openStatusOptionsEditor`. So #3 is largely stale; it becomes a
verification item rather than new code.

## Single chokepoint

All status-option edits flow through one place:

- UI: `buildOptionsEditor` / `openStatusOptionsEditor`
  (`src/webview/boardStatusOptions.ts`)
- Model: the option helpers in `src/webview/boardModel.ts`
  (`getStatusOptions` / `setStatusOptions` and friends)

Both entry points (table column header `boardTableRender.ts:1058`,
Properties menu `boardProperties.ts:305`) and both field kinds (built-in
**Status**, which stores options in `board.columns`, and custom
status/tags fields, which store them in `field.options`) go through this
chokepoint. `setStatusOptions` already routes `Status` → `board.columns`
transparently. **Fix the chokepoint once and every path is covered.**

## Design

### #1 — Enforce unique names (kills the "synced" bug)

Make it impossible for two options on the same field to share a name, so
name-as-identity is safe and cards stay unambiguous.

- **Add:** keep the current auto-suffix behavior ("New", "New 2", …).
- **Rename:** reject a name that collides with another option on the same
  field. Comparison is **trimmed and case-insensitive**. On collision,
  revert the input to the previous name and give subtle inline feedback
  (brief red outline / shake on the row input) — no dialog, no toast.
  Renaming an option to its own current name (no-op) is allowed.
- **No disk-format change.** Options still serialize as `name:color`.

This is intentionally chosen over introducing stable per-option IDs:
cards, serialization, kanban grouping, and filters all reference options by
name today, so IDs would require migrating the entire board model for no
user-visible gain. Unique names give the same guarantee with a tiny surface.

### #2 — Drag-to-reorder

Add drag-to-reorder to the options list in the editor popover.

- Hover a row → a `⠿` grip affordance appears.
- Drag a row up/down. Show a **separate blue drop-line indicator**
  between rows — never a row-stroke/box highlight (consistent with every
  other drag surface in the board).
- Use **manual mouse drag** (mousedown / mousemove / mouseup), not the
  HTML5 drag API — ProseMirror intercepts `dragstart` in this webview.
- Persist as plain array order via a new model helper
  (`reorderStatusOption` / `moveStatusOption`) built on `setStatusOptions`.
- For the built-in **Status** field this reorders `board.columns`, so the
  **kanban column order updates for free** through the same path.

### #3 — Verify, don't rebuild

No new code expected. Confirm end-to-end:

- `⋯` → Properties → per-field `⋮` → **Edit options** opens the editor for
  the built-in Status field *and* for custom status/tags fields.
- Unique-name rejection and drag-reorder behave identically whether the
  editor was opened from the Properties menu or the table column header
  (they share `openStatusOptionsEditor`, so this is a test, not a fix).
- If a genuine gap surfaces during verification, fold the minimal fix in
  and note it here.

## Testing

**Model unit tests (`boardModel`):**

- Rename to a name used by another option on the same field is rejected
  (board returns unchanged, or the helper signals rejection — see Open
  questions); rename to a brand-new unique name succeeds and migrates card
  values as today.
- Rename comparison is trimmed + case-insensitive (`"todo"` collides with
  `"Todo "`).
- Reorder produces the expected array order and **survives a
  serialize → parse round-trip** (`field-options` order preserved).
- Reordering the built-in **Status** field rewrites `board.columns` in the
  new order.
- Adding still auto-suffixes against the (now strictly unique) name set.

**DOM / interaction checks (lighter):**

- Drag shows the separate blue drop-line and reorders on drop.
- Rename-to-duplicate reverts the input and flashes the inline feedback.

## Open questions (resolve during writing-plans)

- **Where uniqueness is enforced:** in the model helper
  (`renameStatusOption` returns the board unchanged on collision) vs. in
  the editor UI (validate before calling the helper). Leaning **model-level
  guard + UI feedback** so the invariant holds no matter the caller.
- Exact inline-feedback styling for the rejected rename (reuse an existing
  shake/error class if one exists).

## Out of scope (YAGNI)

- Stable per-option IDs / migrating card values off name references.
- Merging two statuses into one.
- Bulk status operations.
