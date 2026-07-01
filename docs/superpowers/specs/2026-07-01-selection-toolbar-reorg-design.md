# Selection toolbar (bubble menu) reorganization — design

**Date:** 2026-07-01
**Status:** Approved (brainstorm), pending spec review
**Depends on:** the c23 copy work (`feat/copy-buttons-c23`) — this design *moves* the Copy / Copy-as-plain buttons that branch added, so it must build on top of it.

## Problem

The floating selection toolbar (`src/webview/bubbleMenu.ts`) has grown to ~13 buttons across two rows. Two complaints:

1. **Grouping feels arbitrary** — Copy sits next to Inline code; the standalone ✦ AI button duplicates the "✨ Using AI" section already inside the ⋯ "Turn into" panel.
2. **Too wide / too tall** — the panel covers more of the text under it than it needs to.

## Goal

A smaller, calmer bar whose rows each have one clear purpose, achieved by moving the less-frequent actions (AI, Copy, Copy-as-plain) into the ⋯ menu rather than by shrinking spacing or deleting features.

## Design

### Visible bar — two rows (~13 → 10 buttons)

- **Row 1 · Marks:** Bold · Italic · Underline · Strikethrough │ Inline code
- **Row 2 · Apply + more:** Link · Text color · Highlight · Emoji │ **⋯**

Removed from the visible bar:

- The standalone **✦ AI** button
- The **Copy** and **Copy as plain text** buttons (added by c23)

Everything on the bar stays a **single click**: bold, link, color, highlight, emoji all behave exactly as today.

### The ⋯ menu — a clean action list

Clicking ⋯ opens a short, scannable menu (not the current search-first "Turn into" panel opened directly):

```
┌───────────────────────┐
│ ⊞  Turn into         ▸ │   → existing into-panel (block types + "✨ Using AI")
│ ✦  Turn into using AI▸ │   → existing ai-panel (AI transforms only)
├───────────────────────┤
│ ⧉  Copy                │   → copySelectionRich()
│ ⊟  Copy as plain text  │   → copySelectionAsPlainText()
└───────────────────────┘
```

- **Turn into ▸** opens the existing `#bm-into` panel unchanged (block types followed by the "✨ Using AI" section).
- **Turn into using AI ▸** opens the existing `#bm-ai` panel unchanged (the AI transform list — the old ✦ shortcut, now a menu row).
- **Copy** / **Copy as plain text** call the c23 helpers (`copySelectionRich`, `copySelectionAsPlainText`) already in `copySelection.ts`.

### Reuse, not rebuild

Nothing about the panels or the copy/AI behavior changes — this is almost entirely **re-wiring**:

- The ⋯ ("more") button today opens `#bm-into` directly. It will instead open a new small action menu; that menu's two "Turn into…" rows open `#bm-into` / `#bm-ai` respectively.
- Copy rows call the existing `copySelection.ts` functions.
- Build the menu with the project's shared menu/popover component **if it is present on the base branch**; otherwise follow the existing floating-panel pattern already used by the swatch panels and the into-panel (`placeFloating`, `closeAll`-style dismissal). Decide during planning after checking what exists on the base branch.
- Respect the existing "only one floating panel open at a time" rule (see the floating-panel coexistence convention) — opening the ⋯ menu closes swatches/link row, and vice versa.

## Tradeoff (accepted)

Turn into, AI, and Copy each go from **1 click → 2 clicks** (open ⋯, then pick). This is the deliberate cost of a smaller, less arbitrary bar. Everyday character formatting stays one click.

## Out of scope

- No spacing/padding changes, no icon restyling.
- No change to the AI panels, block-type picker, swatches, or copy behavior themselves.
- Emoji stays on the bar (not moved into the menu).

## Testing

- Unit: menu builds with the four expected rows; each row dispatches the correct action (open into-panel / open ai-panel / rich copy / plain copy). Follow the existing `copySelection.test.ts` mock-poster style.
- Manual (F5): select text → bar shows two tidy rows, no ✦/Copy on the bar; ⋯ opens the 4-row menu; each row does the right thing; opening ⋯ dismisses any open swatch and vice versa.

## Branching note

Because this moves the c23 buttons, implement it on top of `feat/copy-buttons-c23` (either continue that branch or branch off it), not off a clean `main`. Confirm at planning time.
