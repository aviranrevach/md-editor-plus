# Outline panel — design

A Google Docs-style live outline that helps users orient and navigate inside long Markdown documents.

## Goal

Give users a clickable, indented list of all H1/H2/H3 headings in the current document. Click a heading to scroll to it. Open as a floating popover by default; offer a "pin" affordance to convert it into a docked left sidebar that persists across files.

## UI

### Toolbar trigger
- New icon (list-with-bars), placed in the toolbar between **Aa** (settings) and **⋯** (actions).
- Element id `#outline-btn`. Tooltip: "Outline (⌘⇧O)".
- Hidden when the source view is active.
- Optional keyboard shortcut `⌘⇧O` / `Ctrl+Shift+O` toggles the panel.

### Floating mode (default)
- Anchored under the toolbar icon, ~280 px wide, max-height ≈ 60% of the viewport.
- Same visual treatment as the actions menu (bg, border, radius, shadow).
- Closes on Esc, outside-click, or icon re-click.

### Docked mode
- Triggered by a small pin button in the panel's top-right.
- Slides to `position: fixed; left: 0` and reduces the editor's content width via a `body.outline-docked` class.
- Persisted in setting `mdEditorPlus.outlinePinned` (boolean, global, default false).
- Unpinning returns to floating.

### Panel contents
- Each row: heading text, left padding scaled by level (0 / 12 / 24 px for H1/H2/H3).
- Long heading text truncates with ellipsis; native `title` attribute carries the full text.
- Each H1 and H2 with children has a leading caret (`▸` / `▾`) that toggles collapsing of its subordinate headings.
- Hovered row gets a `var(--block-hover)` background. Active row not styled in v1 (no scroll-spy).

### Empty state
- When the doc has zero H1/H2/H3 headings: centered low-contrast message *"Add a heading to see the outline."*

## Behavior

### Outline derivation
- TipTap extension `BlockOutline` (file `src/webview/extensions/outline.ts`) maintains an in-memory `OutlineEntry[]` indexed by ProseMirror position:
  ```ts
  interface OutlineEntry { pos: number; level: 1 | 2 | 3; text: string; }
  ```
- ProseMirror plugin pattern (same as `BlockDirection`): `state.init` walks the doc; `state.apply` re-walks only when `tr.docChanged`.
- On each update, dispatches a custom `outline:changed` event on `editor.view.dom` with `detail: OutlineEntry[]`. The panel subscribes.

### Click → scroll
- Resolve the position to viewport coords via `editor.view.coordsAtPos(entry.pos)`.
- `window.scrollTo({ top: top - 80, behavior: 'smooth' })` (80 px offset clears the sticky toolbar).
- Does not move the editor's text cursor or shift focus.

### Collapse state
- Held in the panel's local JS state, keyed by **position** (not text) so renaming a heading doesn't break collapsed sections.
- Starts fully expanded on each document load. Not persisted to disk.
- Each toggle re-renders only the affected siblings.

### Dock persistence
- Pin/unpin posts `{ type: 'saveOutlinePinned', value: boolean }` to the extension host.
- Provider updates `mdEditorPlus.outlinePinned` at `ConfigurationTarget.Global` and broadcasts.

## File layout

```
src/webview/extensions/outline.ts       — TipTap extension + ProseMirror plugin
src/webview/outlinePanel.ts             — DOM build, render, click/collapse/pin handlers
src/webview/styles/editor.css           — panel, row, indent, caret, dock, empty-state styles
src/webview/index.ts                    — wire button, keyboard shortcut, panel lifecycle
src/mdEditorPlusProvider.ts             — toolbar icon, panel DOM, saveOutlinePinned handler
package.json                            — add mdEditorPlus.outlinePinned setting
```

## Out of scope (v1)

- Scroll-spy active-section highlight
- Search / filter input
- H4–H6 (rare in this editor; block picker only offers H1–H3)
- Drag-to-reorder headings (different feature: structural editing)
- Resize handle on the docked panel (fixed width is acceptable)
- Persisting collapse state across reloads
- RTL flipping the panel chrome (panel stays LTR like other chrome)

## Open questions

- None blocking v1. Settings persistence for the pin is the only one that touches the extension host; the rest is webview-local.
