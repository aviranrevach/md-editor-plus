# Board table grouping — design

**Date:** 2026-06-05
**Status:** Approved design, pending implementation plan
**Branch:** `feat/board-grouping`

## Problem

The table view can already "Group by this" on a column, but grouping only looks and behaves correctly for the built-in **Status** field:

- Group header chips render **gray** for every field except the built-in Status — including the new per-field status columns ([boardTableRender.ts:395-399](../../../src/webview/boardTableRender.ts#L395)).
- Group **ordering** for Status uses `board.columns`; custom status fields fall back to alphabetical, ignoring their own `options` order ([boardTableRender.ts:705-740](../../../src/webview/boardTableRender.ts#L705)).
- The status **sort** comparator is hardcoded to `board.columns` ([boardTableRender.ts:858-886](../../../src/webview/boardTableRender.ts#L886)), so sorting by a second status column is effectively unordered.
- Grouping by a **tag** column buckets by the *first tag only*, so a card tagged `backend, urgent` never appears under `urgent`.
- There is **no explicit "remove grouping"** control — you can only switch the grouped field.

The per-field status options added in the prior feature (`getStatusOptions(board, fieldName)`) make a proper fix straightforward.

## Goal

In **table view**, let the user group by any **status** or **tag** column. The table renders as stacked sections (one shared header on top; each group a full-width band tinted in the group's color), with tighter card rows. Grouping uses each field's real colors and order, and a multi-tag card appears in every matching group.

## Scope

In scope: table-view grouping for status + tag fields, colored group bands, multi-tag bucketing, options-order/colors, a "Remove grouping" control, and generalizing the status sort comparator to any status field.

Out of scope (follow-ups): Kanban "group by" (kanban keeps grouping by Status into columns); persisting collapse/expand state; full tag-chip auto-coloring in cells (only the group *band* gets a hashed color here — see [[project_tags_followup]]).

## Design

### 1. Grouping logic — `applyGroup` (`boardTableRender.ts`)

Generalize the existing `applyGroup(cards, v, b)` so it is field-type aware and no longer special-cases the literal `Status` field.

**Status-type field (built-in or custom):**
- Options come from `getStatusOptions(b, field)`.
- Bucket each card by `c.values[field]`. A value not in the options list goes to a trailing **"—"** (no value / unknown) group. Empty string → same "—" group.
- Group order = the options order; create empty groups for unused options (preserves the current Status behavior for all status fields); the "—" group, if non-empty, comes last.

**Tag field:**
- A card's tags = `c.values[field]` split on `,`, trimmed, non-empty.
- Each card is placed into **one bucket per tag** (multi-bucket — a card with N tags appears in N groups). A card with no tags goes to the "—" group.
- Group order = alphabetical (case-insensitive) by tag name; "—" last.
- Because the same card id appears in multiple buckets, edits propagate naturally (it is the same `Card`). The group header count is the number of cards in that bucket (overlaps across tag groups are expected).

**Other field types (text/date/person):** unchanged from today (exact-value buckets, alphabetical, "—" last). Only status + tag are the focus of this work.

A small helper resolves a group's color:
```ts
function groupColor(b: Board, field: string, key: string): ColorToken | null {
  const f = b.fields.find((x) => x.name === field);
  if (!f) return null;
  if (f.type === 'status') return getStatusOptions(b, field).find((o) => o.name === key)?.color ?? null;
  if (f.type === 'tags' && key !== '—') return autoColorPublic(key); // stable hash
  return null; // '—' and other types → neutral band
}
```
(`autoColor` is currently private in `boardModel.ts`; export a thin `autoColorPublic(name): ColorToken` or reuse `COLOR_TOKENS_PUBLIC` with the existing hash. The "—" group and non-status/tag fields get a neutral/gray band.)

### 2. Group band rendering (`boardTableRender.ts:375-453`)

Each group header row becomes a **full-width band tinted in the group's color**:
- Background = the group color's chip-background token, `var(--board-chip-<token>-bg)` (already defined for all 10 tokens); foreground text uses the matching `-fg`. The "—"/neutral band uses the existing default header background.
- The band keeps: collapse caret, the group label (as a chip for status, plain colored label for tags), the card count, and the "+ add row" affordance.
- **Tighter card rows:** reduce the data-row vertical padding (a CSS change to `.bd-table-cell` / the grouped row, matching the mockup — roughly `6px` top/bottom).

Card rows stay white (no per-row tint) — the band carries the color.

### 3. Sort comparator generalization (`boardTableRender.ts:~886`)

The status sort comparator currently orders by `board.columns` index. Generalize it: for a status-type sort field, order values by their index in `getStatusOptions(b, field)` (so sorting by any status column orders by its states). Non-status sorts are unchanged.

### 4. "Remove grouping" control

The column ⋯ menu keeps "Group by this". Add a sibling item:
- When the table is currently grouped (`view.groupBy` set), the ⋯ menu on the *currently grouping* field shows "**Remove grouping**" (calls `setViewGroup(board, 'table', null)`); on other fields it still shows "Group by this".
- Keep it simple: one extra menu item, gated on whether this field is the active group.

### 5. "+ Add row" within a group

Unchanged in spirit: pre-fills the grouping field with the group's value. For a tag group it pre-fills that single tag. For the "—" group it pre-fills empty.

## Components & boundaries

| Unit | Responsibility |
|------|----------------|
| `boardModel.ts` | export `autoColorPublic` (or equivalent) so tag bands can be colored by stable hash |
| `boardTableRender.ts` · `applyGroup` | field-type-aware bucketing + ordering (status options order; tag multi-bucket alphabetical; "—" last) |
| `boardTableRender.ts` · group header render | full-width band tinted via `--board-chip-<token>-bg`; tighter rows |
| `boardTableRender.ts` · sort comparator | status sort orders by `getStatusOptions` index for any status field |
| `boardTableRender.ts` · column ⋯ menu | add "Remove grouping" when this field is the active group |
| `board.css` | band tint rules + reduced row padding |

## Testing

`tests/board/table.test.ts` has a jsdom harness (`makeBoard`/`makeCtx`/`mountTable`). Add tests:
- **Status grouping by a custom status field:** groups appear in the field's `options` order with the correct color class on each band; unused options render as empty groups; unknown/empty values fall to a trailing "—" group.
- **Tag multi-bucket:** a board where one card has two tags → that card's row appears under *both* tag groups; group counts reflect per-bucket membership; a tagless card lands in "—".
- **Band color:** the group header for a status value carries the color token matching that option (assert the class / inline background derives from the right token).
- **Sort by a custom status field** orders rows by that field's options order (pure-ish: assert row order after mountTable).
- **Remove grouping:** invoking the menu item clears `view.groupBy` (assert via the mutated board).
- Model: if `autoColorPublic` is added, a small unit test that it returns a valid `ColorToken` deterministically.

Run: `npx jest tests/board`.

## Risks

- **Multi-bucket cards in the table:** row drag/reorder is scoped per group today; confirm dragging a card that appears in multiple tag groups behaves sanely (reorder stays within the group; the card isn't duplicated in data — it's one `Card` shown in multiple buckets). Keep drag scoped to the bucket as today; do not attempt cross-group tag mutation via drag in this task.
- **Counts overlap for tags** (sum of group counts > card count) — expected and intended (matches Notion); don't try to "fix" it.
- Keep the change additive to the existing grouping path; don't regress non-status/text/date grouping.
