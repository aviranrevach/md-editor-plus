# Split dragger menu — Turn-into flyout

**Date:** 2026-06-20
**Status:** Design — awaiting review
**Deferred from:** c43 (see `docs/superpowers/backlog.md`)

## Goal

Reshape the **dragger (⠿) action menu** to match Notion: the action list stays a single compact column, and **"Turn into" becomes one button that reveals its target list in a flyout panel to the right** — instead of today's in-place drill-down (Back button). The `+` / slash insert menu is unchanged (it shipped its restyle in c43); this is only the action menu (the `activeBlock` / actionMode path).

## Background — what exists today

In [blockPicker.ts](src/webview/blockPicker.ts), opening the dragger calls `picker.open(dragIcon, …, { activeBlock })`, which sets `actionMode` and runs `renderActionMenu()`:

- **Empty search:** rows for **Turn into ›**, **Duplicate**, **Delete**. Clicking **Turn into** runs `openTurnInto()` → `renderTurnInto()`, which *replaces* the list with a flat target list (a Back row, the convert targets, and a **✨ Using AI** section). `closeTurnInto()` returns.
- **Non-empty search:** `searchBlockActions()` returns matching actions + flattened convert targets in one column.

The picker is a single `Popover` ([popover.ts](src/webview/popover.ts)) positioned by `placeFloating` ([menuPosition.ts](src/webview/menuPosition.ts)). The popover registry already supports **parent/child** popovers (a child keeps its parent open; outside-click/Escape/scroll dismissal and stacking are handled centrally).

## Decisions (locked during brainstorm)

| Question | Decision |
| --- | --- |
| Reveal model | **Cascading flyout** — target panel appears to the right only when **Turn into** is highlighted (hover or keyboard) |
| "Turn into" | Stays **one button** with a `›` caret |
| Behavior on typing | **Collapse the split** — close the flyout, show today's flat filtered list (matching actions + targets) |
| Flyout content | Today's `renderTurnInto` targets (convert targets + **✨ Using AI**), minus the Back row |
| Scope | Dragger action menu only; the `+` / slash insert menu unchanged |

## Interaction design

**Empty search (split view):**
- Left panel = action list: **Turn into** (`›` caret), **Duplicate**, **Delete** (Delete keeps its red danger styling).
- Highlighting **Turn into** (mouse hover OR keyboard focus) opens the **target flyout** to its right, anchored to the Turn-into row: convert targets (Text, Heading 1–3, lists, Table, …) and the **✨ Using AI** section.
- Highlighting **Duplicate** or **Delete** closes the flyout. Menu returns to the compact single column.

**Keyboard:**
- `↑↓` move the highlight within the **active** panel.
- On **Turn into**: `→` enters the flyout (highlight its first row); `←` returns to the action panel (closes the flyout). 
- `Enter` activates the highlighted row (action or target).
- `esc`: if the flyout is focused, return to the action panel; otherwise close the whole menu.
- The action panel footer (from c43) reads `↑↓ Navigate · ↵ Select · esc Close`, flipping the verb to **Back** while the flyout is focused (reuse `footerCloseVerb`).

**Typing (collapsed view):**
- Any non-empty query closes the flyout and renders today's flat `renderActionMenu` result (matching actions + matching targets) in the single column. `h1` → Heading 1, etc. No flyout while filtering.

**Mouse:** hovering **Turn into** opens the flyout; hovering another action closes it. Clicking a target converts and closes. **Clicking "Turn into"** opens the flyout *and* moves focus into it (highlights its first row) — so click/touch users who never hovered still get in.

**Positioning & edges:** the flyout is anchored to the Turn-into row via `placeFloating` with `preferX: 'right'`. If there's no room on the right it **flips to the left** of the action panel; it height-caps and scrolls (the c43 `maxHeight: 440` cap) and clamps on-screen — all inherited, no new positioning logic.

## Architecture

**The flyout is a child popover.** Reuse the existing parent/child support:

- A second popover instance, created as a child of the action menu's popover: `createPopover({ className: 'block-picker block-picker-flyout', parent: <actionPopover>, preferX: 'right', maxHeight: 440 })`. Its `el` holds the target list. Opening it against the Turn-into row element positions it (right, flip-left, capped) and keeps the parent open via the registry; the registry's outside-click/Escape/stack logic dismisses both together.
- The action menu keeps its single `el` (search + list + footer). The flyout is a separate `el` appended by its own popover.

**Flyout unit.** Extract the flyout into a well-bounded function, e.g. `openTurnIntoFlyout(opts)`, living alongside the picker (or a small `turnIntoFlyout.ts` if blockPicker.ts grows further). Inputs: the active block, the anchor row element, and the convert/AI callbacks it should invoke. It owns: building the target rows (reusing `convertibleTargets` + the AI filtering already in `renderTurnInto`), its own `↑↓`/Enter handling while focused, and open/close. It does **not** duplicate `convertActive` / `convertActiveWithAi` — it calls them.

**Focus model.** A small piece of state on the action menu tracks which panel is active (`'actions' | 'flyout'`). `↑↓`/Enter route to the active panel; `→`/`←` and hover move it. This replaces the `turnIntoOpen` drill-down flag.

**Reused unchanged:** `searchBlockActions` (typed/flat path), `convertActive`, `convertActiveWithAi`, `convertibleTargets`, `AI_TRANSFORMS` filtering, the c43 footer + `footerCloseVerb`, `placeFloating`, the popover registry.

**Removed:** the drill-down path — `openTurnInto`, `closeTurnInto`, and `renderTurnInto`'s Back row. The target-building logic inside `renderTurnInto` moves into the flyout unit.

**Styling:** the flyout panel reuses `.block-picker` styling (borderless icons, rows, section labels, scroll). It carries **no footer** of its own — the action panel's footer is the single source of the keyboard hint and flips to "Back" when the flyout is focused. A `.block-picker-flyout` modifier covers any spacing tweaks (e.g. the 8px gap from the action panel).

## What this is NOT (scope guard)

- No change to the `+` / slash **insert** menu.
- No new actions (no Color / Move to / Comment — YAGNI; keep Turn into / Duplicate / Delete).
- No change to what any conversion does, or to which targets/AI transforms appear.
- No change to `placeFloating`'s algorithm (it already does right-placement, left-flip, cap, scroll).

## Testing

- **Unit (kept/extended):** the target list the flyout shows — `convertibleTargets(BLOCK_DEFS)` and the AI-dedupe (skip AI targets that have a deterministic converter) — stays asserted in `tests/blockPicker.test.ts`. `searchBlockActions` flat-path tests stay green.
- **Manual (F5):** open the dragger menu on various block types, light + dark theme. Verify: hover Turn into → flyout opens to the right with targets + ✨ Using AI; hover Duplicate/Delete → flyout closes; `→`/`←` and `↑↓`/Enter move correctly across panels; footer flips to **Back** in the flyout; typing collapses to the flat list; near the right screen edge the flyout flips left; a long target list scrolls with the footer pinned; Delete still reads as destructive; outside-click and Escape dismiss cleanly.

## Deferred (still in backlog)

- Footer **pinned-vs-scrolls** on the insert menu (separate c43 backlog item) — unaffected here.
