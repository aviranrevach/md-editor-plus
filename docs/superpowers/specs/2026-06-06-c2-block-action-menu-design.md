# C2 — Block dragger action menu (Notion-style)

**Date:** 2026-06-06
**Branch:** `feat/c2-block-action-menu`
**TODO item:** C2 — "In some block types, clicking the dragger doesn't let you reach 'Turn into', 'Delete', 'Duplicate', etc."

## Problem

Clicking the block dragger (the `⠿` handle) opens the block picker. Today that picker, in "convert mode," shows the full block-type list with a `Delete` pinned at the bottom — and it special-cases some block types in ways that trap the user:

- **Callouts auto-drill.** Opening the dragger on a callout jumps straight into the callout sub-list (Note / Tip / Warning / …). While drilled in, the `Delete` row is suppressed (`if (!drillParent && context.activeBlock)`), so on a callout you **cannot reach Delete at all**, and turning it into a *non-callout* type is buried behind Escape.
- **No Duplicate.** There is no duplicate action anywhere in the product.
- **Silent no-op convert.** Picking a block type that has no `convert()` (Toggle, Divider, Boards, Whiteboard) falls through to `insert` below, so "turning into" them silently adds a *new* block instead.

The user's report, in their words: *"some blocks — like callout — bring up specific options for that item, but you can't go back and turn it into something else, and you don't have basic options like delete/duplicate."*

## Goal

One **consistent, Notion-style action menu** for the dragger, identical for every block type. Lead with the basic actions; never trap the user inside a block's own options.

## Design

### Two distinct picker modes

The block picker already serves two callers; we make the distinction explicit:

| Trigger | Mode | Behavior |
|---|---|---|
| `+` button, `⌘/` | **Insert** | Unchanged. Full block list to insert a new block below. |
| `⠿` dragger over a block | **Action** | New action-first menu (below). |

`Insert` mode is unchanged. All new behavior lives in `Action` mode (when `context.activeBlock` is set).

### Action menu (Action mode, empty search)

```
🔍  Search actions…
─────────────────────
⤿  Turn into       ›
⧉  Duplicate
🗑  Delete
```

Three actions only. Grouped list shown when the search box is empty. Keyboard arrows + Enter move/activate; Escape closes.

**Scope:** only Turn into / Duplicate / Delete. Notion's fuller menu (Color, Copy link, Move to, Comment, Ask AI, …) is explicitly out of scope for C2 and can be added later as additional action items.

### Unified search

The search box filters **everything at once** — actions *and* turn-into targets — flattened into one result list. This preserves the fast type-and-convert flow that exists today.

- Empty → grouped action menu above.
- `dup` → **Duplicate**.
- `del` → **Delete**.
- `h1` / `heading` → the **turn-into targets** surface directly as flat rows (Heading 1, etc.), convert in one keystroke, no drilling.
- `warning` → the **callout types** surface flattened (Warning callout, etc.), jump straight in.

Implementation: searching builds a flat candidate list from `[Turn into action, Duplicate, Delete] + convertibleTargets (flattened, incl. callout sub-types)` and runs the existing `filterBlocks`-style matching over labels/aliases.

### Turn into ›

Drilling into `Turn into` (or clicking it with empty search) shows the type list **with search** and the current block type **checkmarked**.

- Lists **only convertible targets** — block defs that have a `convert()` function: Paragraph, Heading 1–3, Blockquote, Code block, Bullet/Numbered/Task list, and the 5 callout types (via the normal `Callout ›` drilldown, or flattened when searching).
- Block types **without** `convert()` (Toggle, Divider, Board: Kanban, Board: Table, Whiteboard, Image) do **not** appear as turn-into targets. This removes the silent "insert a new block instead of converting" bug. Converting a paragraph *into* a toggle/board is rare and is an explicit non-goal here (easy follow-up).
- **Removes the callout auto-drill** in `open()`. A callout now opens the same action menu as every other block, so Duplicate, Delete, and "turn into anything convertible" are all reachable.

### Duplicate

Inserts a copy of the captured block immediately below it (`activeBlock.blockEnd`).

- **Normal blocks** (paragraph, heading, blockquote, code, lists, callout, toggle, image, mermaid): the node is copied verbatim. None of these carry document-unique IDs, so no collision.
- **Boards** (kanban + table): the node is deep-copied with a **fresh board id** and **freshly minted card ids**, so the duplicate is independent and round-trips to markdown without colliding `<!-- board:start id -->` / `<!-- board:body id -->` markers. This sits next to the known board-parse fragility, so it must be handled deliberately, not copied raw.
  - New board id: same scheme as creation — `b-${Math.random().toString(36).slice(2, 6)}`, checked for uniqueness against existing board ids in the doc.
  - Card ids: re-minted via `mintCardId()` (`boardModel.ts`), iterating so each new card id is unique within the duplicated board. Card body associations are rewritten to the new ids.

### Navigation

- Arrow Up/Down + Enter operate on whatever list is currently shown (action menu, flat search results, or turn-into list).
- **Escape:** inside Turn into → back to the action menu; on the action menu → close.
- Clicking outside → close (existing behavior).
- Selection/scroll-into-view on open is unchanged (`setTextSelection(blockPos + 1)`, guarded for atoms).

## Components & boundaries

- **`src/webview/blockPicker.ts`** — the bulk of the work:
  - Add Action-mode rendering: search box + grouped `Turn into › / Duplicate / Delete`.
  - Unified flat search across actions + convertible targets.
  - `Turn into` drill state (separate from the existing `subItems` drill used by Callout/Image in insert mode).
  - `duplicateActiveBlock()` alongside the existing `deleteActiveBlock()`.
  - Remove the callout auto-drill branch in `open()`.
  - Filter turn-into targets to defs with a `convert()`.
- **`src/webview/boardModel.ts` / `src/webview/boardOps.ts`** — a pure helper that, given a board node's data, returns a deep clone with a fresh board id and re-minted card ids. The most testable unit; reuses `mintCardId()`.
- **`src/webview/blockHandle.ts`** — likely unchanged; it already passes `activeBlock` into `picker.open()`.
- **Styles** (`board.css` / editor styles) — action-row styling, search box, separators, checkmark on current type.

## Error handling / edge cases

- **Atom nodes (boards):** `activeBlock.blockPos` is captured at open time (reliable for atoms); Duplicate and Delete re-read the node at that pos before acting (mirrors existing `deleteActiveBlock`).
- **Already-current type:** selecting the block's current type in Turn into is a no-op + close (existing `isActiveItem` guard).
- **Board with no card ids / malformed board:** duplicate helper falls back to copying verbatim only if id re-minting fails, and logs — never throws into the editor chain.
- **Search with no matches:** show an empty/"no results" state, Enter does nothing.

## Testing

- **Unit (Vitest, existing infra):**
  - Board duplicate helper: fresh board id differs from source and from all existing board ids; every card id is re-minted and unique; body associations point to new ids; markdown round-trips.
  - Turn-into target filtering: only defs with `convert()` are offered; current type is marked.
  - Unified search matching: `h1`→heading target, `dup`→Duplicate, `warning`→warning callout, empty→grouped menu.
- **Manual smoke (per persona):** dragger on callout, board (kanban + table), toggle, image, paragraph — confirm Turn into / Duplicate / Delete all reachable; duplicated board edits independently of the original after save+reopen.

## Out of scope (possible follow-ups)

- Notion's other actions (Color, Copy link to block, Move to, Comment, Ask AI).
- Converting *into* Toggle / Board / Whiteboard (would need new `convert()` functions).
- Keyboard accelerators (`⌘D` duplicate, `Del` delete) shown in Notion's menu.
