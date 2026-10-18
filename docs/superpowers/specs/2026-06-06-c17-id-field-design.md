# c17 — ID field: read-only, auto-shown, compact, normalized to `C<n>`

**Date:** 2026-06-06
**Branch:** `feat/c17-id-readonly`
**TODO item:** c17 (Urgent!!) — "ID doesn't get added automatically when you unhide it. Maybe should be read-only."

## Problem

Every board card has a canonical ID stored on the card object (`card.id`). The board's
table view also keeps a parallel copy of that value inside `card.values['id']`, and the
table cell renders from that *copy*. The copy can be empty — for example, cards parsed
from markdown whose table never carried an `id` column, or older data — so unhiding the
`id` column shows blank cells even though the card genuinely has an ID.

On top of that, the `id` cell is rendered as an ordinary editable text field. The user can
type over it, which is dangerous: the ID is internal plumbing the board relies on to match
each card to its description body (`<!-- board:body id="..." -->`). Editing it silently
breaks that link.

Separately, the existing ID scheme is lowercase `c1`, `c2`, … which (a) is inconsistent
with how the user refers to and thinks about items and (b) doesn't read like a real
issue/task identifier.

## Goals

1. The `id` cell always shows the card's real ID — never blank.
2. The `id` cell is read-only: not editable, but its text can be selected and copied.
3. The `id` column has a compact default width so a short ID doesn't claim a wide column.
4. IDs use a `C`-prefixed, unpadded scheme (`C1`, `C2`, …), and existing lowercase
   `c<n>` IDs are migrated to uppercase `C<n>` — including their description anchors — so
   cards stay linked.

## Non-goals

- No general per-field "read-only" system. We special-case the single `id` field, which
  is internal plumbing. Every other text column stays fully editable.
- No zero-padding and no configurable prefix. The prefix is fixed as `C`.
- No change to the kanban view's behavior beyond what naturally follows from the shared
  card model (the `id` is not a user-facing kanban field).

## Design

### 1. Numbering scheme: `C<n>`, unpadded

New IDs are the literal character `C` followed by a plain integer with no zero-padding
(`C1`, `C2`, … `C103`). This follows the GitHub/Jira/Linear/Notion convention of an
unpadded number, so it never "breaks" as the list grows.

The generator (currently `nextCardId` in `boardModel.ts`/`boardOps.ts`, producing
`c${i}`) changes so that:

- It scans existing card IDs for the trailing integer of any ID matching `C<n>` or the
  legacy `c<n>` (case-insensitive), takes the maximum, and returns `C<max+1>`.
- "Continue from the highest number" semantics (rather than `cards.length + 1`) so the
  sequence is predictable even after deletions.

The serialize-time collision fallback that currently mints `c-<random>` is updated to
produce a `C`-prefixed value consistent with the scheme (e.g. `C<n>` derived from the
same max-scan, falling back to a `C`-prefixed random suffix only on genuine collision).

### 2. Migration: lowercase `c<n>` → uppercase `C<n>`

When a board is loaded, any card ID matching the legacy lowercase pattern `c<n>` is
normalized in-memory to `C<n>` (e.g. `c8` → `C8`, `c17` → `C17`). Because serialization
rebuilds both the table `id` column and every `board:body id="..."` anchor from
`card.id`, normalizing `card.id` at parse time means:

- The read-only id cell immediately displays the uppercase form during the session.
- The next save writes uppercase IDs to the table **and** rewrites the matching body
  anchors, keeping each card linked to its description.

Normalization is idempotent (already-uppercase IDs are untouched) and case-insensitively
dedup-safe: the existing duplicate-ID handling in `serializeBoard` continues to guard
against collisions if normalization ever produced two equal IDs.

Migration is intentionally visible to the user: items they refer to as `c8` / `c17` will
display and serialize as `C8` / `C17`.

### 3. Read-only, copyable `id` cell

In the table cell renderer (`boardTableRender.ts`), the text-cell path branches when the
field name is `id`:

- The cell displays `card.id` (the canonical value), not `card.values['id']`.
- If `card.id` is somehow empty, mint one via the generator above, assign it to the card,
  and display that — so the cell is never blank.
- No inline-edit click listener is attached, so clicking never enters edit mode and typing
  does nothing.
- The cell text remains selectable/copyable (default text selection is allowed; we do not
  set `user-select: none`).
- The cell carries a CSS class marking it as a locked/system field, rendered slightly
  muted so it visually reads as plumbing rather than user data.

This branch is independent of the board-level `readonly` flag; the `id` cell is read-only
even when the rest of the board is editable.

### 4. Compact default column width

Column widths are applied in the `<colgroup>` build in `boardTableRender.ts` via
`widths[f.name] ?? 160`. The fallback is changed so the `id` field defaults to a narrow
width (~64px) instead of 160px:

```
col.style.width = `${widths[f.name] ?? (f.name === 'id' ? 64 : 160)}px`;
```

Rationale for ~64px: it comfortably fits a short ID (`C103`) and sits just above the
60px resize floor, so the user can still drag it narrower-ish or wider. This is a
render-time default only — it is **not** written to `view.widths`, so the markdown stays
clean (no `widths="id=64,..."` noise). If the user manually resizes the column, that value
is persisted as usual and takes over the fallback.

## Affected files

- `src/webview/boardModel.ts` and/or `src/webview/boardOps.ts` — ID generator (`C<n>`,
  max-scan), serialize fallback, parse-time migration of legacy lowercase IDs.
- `src/webview/boardTableRender.ts` — read-only branch for the `id` text cell; narrow
  default width fallback for the `id` column.
- A board table stylesheet under `src/webview/styles/` — muted/locked appearance for the
  `id` cell.

## Verification

Manual checks in the running extension:

1. **Auto-show:** Open a board with existing cards, unhide the `id` column → every cell
   shows a real ID, no blanks.
2. **Read-only:** Click an `id` cell → no edit cursor appears; typing changes nothing.
3. **Copyable:** Select an `id` cell's text → it highlights and can be copied.
4. **Other columns unaffected:** Another text column (e.g. Area) → still editable as before.
5. **Compact width:** Newly shown `id` column is narrow (~64px), not 160px; can still be
   dragged wider/narrower.
6. **Migration round-trip:** Open a board whose markdown uses lowercase `c8` / `c17` with
   description bodies → IDs display as `C8` / `C17`; save → table `id` column and the
   `board:body id="..."` anchors are both uppercase, and each card still shows its
   correct description.
7. **New ID continuity:** Add a card to that board → it gets `C<highest+1>` (e.g. `C18`),
   uppercase and unpadded.

## Risks / notes

- The board's TODO.md is being edited in two tabs (c8 on another tab, c17 here). Migration
  writes uppercase IDs on save; concurrent saves from two tabs are a pre-existing
  general concern, not introduced by this change, but worth noting since IDs are changing.
- The `C` prefix originally connoted "card"; the user now thinks of items as issues/tasks.
  `C` is kept deliberately as the established convention — no semantic change intended.
