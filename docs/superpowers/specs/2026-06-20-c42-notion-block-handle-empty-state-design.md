# c42 — Notion-style block handle, first-line alignment, and empty-state hint

**Date:** 2026-06-20
**Status:** Design approved, ready for implementation plan
**Related:** c43 (Notion-style menu redesign, in progress on a separate branch). c42 touches the block gutter handle; c43 touches menus. No file overlap expected beyond shared CSS conventions.

## Problem

The block gutter handle (the hover-revealed `＋` and drag grip to the left of each block) feels unpolished compared to Notion:

1. **Icons are too small for their space.** The `＋` is an 18px text glyph and the drag grip is a 12px braille character `⠿` in a faint `#ccc`. They look lost in the gutter and disconnected from the block's hover background.
2. **Handle floats to the vertical middle** of tall blocks (multi-line paragraphs, headings) instead of lining up with the first line where the text begins.
3. **No empty-state hint.** A blank document or empty block shows nothing, so a new user has no cue that they can start typing or open the command menu. There is no Placeholder extension installed.

## Constraints

- **No new npm packages.** `@tiptap/extension-placeholder` and `@tiptap/extension-suggestion` are not installed and cannot be added. The empty-state hint and the `/` trigger must be implemented with the libraries already present (`@tiptap/core`, ProseMirror, and the existing `tiptap-extension-global-drag-handle@0.1.18`).
- Follow existing patterns in [src/webview/blockHandle.ts](../../../src/webview/blockHandle.ts) and the handle styles in [src/webview/styles/editor.css](../../../src/webview/styles/editor.css) (`.drag-handle`, `.block-handle-plus`, `.block-handle-drag`).
- Must respect read-only mode (the handle is already hidden via `html.read-only .global-drag-handle` / `.block-handle`).

## Design

### Part 1 — Notion-style gutter handle (visual)

Replace the two glyphs in [blockHandle.ts](../../../src/webview/blockHandle.ts) (`plusBtn.textContent = '+'` and `dragIcon.textContent = '⠿'`) with inline SVGs, and restyle in `editor.css`.

**Plus button (`.block-handle-plus`)**
- SVG plus, 16px icon centered in a 20×20 button.
- Resting: `background: transparent`, `color: #9b9a97`.
- Hover: `background: rgba(55,53,47,0.08)`, `color: #37352f`, `border-radius: 5px`.

**Drag grip (`.block-handle-drag`)**
- SVG with a 2×3 dot grid (six `<circle>`s), drawn in an ~11×17 viewbox so the grid is taller than wide.
- Resting: `background: transparent`, `color: #b3b2af` — **dots only, no box.**
- Hover: snug rounded background `rgba(55,53,47,0.09)`, `color: #5f5e5b`, `border-radius: 4px`. The grip box is ≈15×22 — it **hugs the dots** with no extra side padding (taller than wide, matching Notion).

Both backgrounds appear **on hover only**. The existing tooltip, click-to-open-menu, and drag behaviors are unchanged.

### Part 2 — First-line alignment

The handle must anchor to the **first line** of the block it controls (vertically centered within that first line-box), for paragraphs and headings alike — not the vertical middle of the whole block.

`tiptap-extension-global-drag-handle` already sets the handle's `top` from the hovered node's bounding rect. Implementation should ensure our handle/gutter is top-anchored (fixed small height aligned to the first line) rather than stretching to the block's full height. This is a CSS/offset adjustment to `.drag-handle` and the icon container, not a library change. **Verify** against a 3-line paragraph and an H1/H2/H3 that the icons sit on the first line.

### Part 3 — Empty-state hint + `/` trigger

**Placeholder hint (decoration, no new package)**
- A small ProseMirror plugin adds a `data-placeholder` attribute (or a widget/inline decoration) to empty text blocks.
- CSS renders the text via `::before` in placeholder grey (`#c4c3c0`), `pointer-events: none`, disappearing the moment the block has content.
- Copy: **"Start writing, or press / for commands"**
- Shown on:
  1. The **focused empty block** (follows the cursor onto any empty line; quiet elsewhere).
  2. The **first line of a brand-new empty document** (visible before the user clicks in).

**`/` trigger**
- On `/` keydown, if the current text block is **empty** (collapsed selection, no text before the cursor in the block), `preventDefault()` and open the block picker at the cursor — reusing the existing picker-open logic that backs `⌘/` in [blockHandle.ts:181-198](../../../src/webview/blockHandle.ts#L181-L198).
- If the block is **not** empty (e.g. typing "and/or", a path, or a date), `/` types normally — never hijacked mid-text.
- `⌘/` continues to work everywhere, unchanged.

## Out of scope

- A full slash-command **filter-as-you-type** menu (Notion inserts `/query` and filters). Here `/` simply opens the existing picker on an empty block. Filtering can be a later follow-up.
- Any changes to menu styling/grouping — that is c43, on its own branch.
- Drag-and-drop reorder behavior (already works).

## Testing / verification

- **Unit/DOM:** the empty-block decoration appears on an empty paragraph and is removed once text is typed; appears on a fresh empty doc.
- **`/` trigger:** opens the picker on an empty block; does NOT open when `/` is typed after existing text.
- **Visual (manual, F5):** hover handle shows resized SVG `＋` and dot grip with hover-only backgrounds; grip background hugs the dots; handle aligns to the first line of a tall paragraph and of an H1/H2/H3; placeholder copy reads correctly; read-only mode still hides the handle.
- Existing `npm test` suites continue to pass (note: the pre-existing toggle.ts type-check failure is unrelated).

## Files likely touched

- [src/webview/blockHandle.ts](../../../src/webview/blockHandle.ts) — SVG icons, `/` trigger on empty block.
- [src/webview/styles/editor.css](../../../src/webview/styles/editor.css) — `.block-handle-plus`, `.block-handle-drag`, first-line alignment, placeholder `::before`.
- [src/webview/editor.ts](../../../src/webview/editor.ts) — register the empty-state decoration plugin.
- A new small module for the placeholder decoration plugin (e.g. `src/webview/emptyPlaceholder.ts`).
