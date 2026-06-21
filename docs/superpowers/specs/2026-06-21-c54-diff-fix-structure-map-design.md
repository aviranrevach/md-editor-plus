# c54 — Diff fix + structure-map navigation

**Date:** 2026-06-21
**Status:** Design approved, ready for implementation plan
**Priority:** Urgent

c54 bundles two independent pieces of work that ship under one label:

1. **Bug** — adding a new section to the document doesn't appear in the full diff.
2. **Feature** — a VS Code-style navigation map (a "structure map") for the editor.

They share no code. This spec covers both, but each gets its own implementation
section and can be built/tested in isolation.

---

## Part 1 — Diff bug: new sections don't show as a diff

### Root cause

The editor debounces edits into VS Code's underlying `TextDocument` by 500ms
(`_editDebounce` in `src/webview/editor.ts`). The **Show Diff** button posts a
bare `openFullDiff` message with no content (`src/webview/index.ts:304`). The
provider's handler (`src/mdEditorPlusProvider.ts:259`) then opens
`vscode.diff` with the **live document** on the right side
(`src/diffViewer.ts:33` → `openFullDiff`).

When a user types a new section and clicks Show Diff before the 500ms debounce
fires, the new text is still sitting in the webview's ProseMirror editor and has
**not been flushed into the `TextDocument`**. The diff reads a stale document, so
the new section is invisible. (Confirmed repro: unsaved edit, immediate diff.)

This is the same flush-gap family as the c26 "save says saved but lies" issue.

### Fix

Flush before diffing, and make the ordering race-free by carrying the content in
the message itself:

1. **Webview** (`src/webview/index.ts`, diff-btn handler): instead of posting a
   bare `openFullDiff`, send the editor's current markdown with it —
   `vscode.postMessage({ type: 'openFullDiff', markdown: getCurrentMarkdown() })`.
   This reuses the existing `markdown`-in-message pattern already used at
   `index.ts:157`, `166`, and `422`.
2. **Provider** (`src/mdEditorPlusProvider.ts`, `openFullDiff` case): if the
   message carries `markdown`, `await this._applyEdit(document, markdown)`
   **before** calling `openFullDiff`. A single awaited handler guarantees the
   document is current before the diff base is resolved against it — no
   two-message (`'edit'` then `'openFullDiff'`) interleave race.
3. The conflict-banner path that already passes `baseContent`
   (`index.ts:360`) is unchanged; it should also carry the current markdown so
   the right side is current there too.

Base resolution (explicit base → git HEAD → on-disk → open-snapshot) in
`src/diffBase.ts` / `src/diffViewer.ts` stays exactly as-is.

### Testing

Unit test on the `openFullDiff` provider handler (or an extracted helper): given
a message with an unflushed `markdown` payload, assert `_applyEdit` (document
update) runs and completes **before** the diff base is resolved against the
document. Existing `diffBase` tests stay green.

---

## Part 2 — Structure map (navigation map)

### Decision

Not a pixel-accurate minimap (VS Code/Monaco style). The editor renders a rich
document (headings, tables, boards, callouts, Mermaid), so a literal pixel
minimap is expensive and not useful. Instead: a **structure map** — a slim rail
of heading ticks with a draggable viewport box. It reflects document structure
and works regardless of block type.

### Placement

- A fixed rail pinned to the right edge of the window
  (`position: fixed; right: 0`), spanning from just under the toolbar to the
  bottom.
- The page scrolls on `window` (`editor.ts` uses `window.scrollY` /
  `window.scrollTo`), and `#editor` is centered at ~800px max-width, so the rail
  sits in the empty right gutter without overlapping text on normal windows.
- Owned by a new module: `src/webview/structureMap.ts`.

### What it draws

- **Heading ticks** — enumerate `#editor .ProseMirror :is(h1,h2,h3,h4,h5,h6)`.
  Each heading becomes a horizontal tick at vertical position
  `heading.offsetTop / docHeight`. Heading level drives the tick's **width and
  opacity**: H1 widest/boldest → H6 shortest/faintest, so the rail reads as the
  document's shape.
- **Viewport box** — a translucent rectangle:
  `top = scrollY / docHeight`, `height = innerHeight / docHeight`. Shows the
  current view at a glance.

### Interactions

- Click a tick → smooth `scrollIntoView` to that heading.
- Click empty rail → jump to that proportion of the document.
- Drag the viewport box → scroll proportionally. Use manual mouse
  (mousedown/mousemove/mouseup) drag — consistent with custom-chrome dragging
  elsewhere in the app.
- Hover a tick → tooltip with the heading text, reusing the existing
  `.app-tooltip` component.

### Lifecycle & performance

- Rebuild ticks on document change (debounced, piggy-backing the existing edit
  signal) and on `window` `resize`.
- On `scroll`, update **only** the viewport box, throttled with
  `requestAnimationFrame`. No tick rebuild on scroll.

### Visibility & control

- Default-on but discreet: a narrow rail that **widens and reveals heading
  labels on hover**. Consistent with the project's scrollbar rule — never show
  the OS default scrollbar; hide-until-hover styling.
- A toolbar toggle button turns the map on/off. Phosphor icon, regular weight,
  matching the existing toolbar icons. The on/off choice persists like other
  view settings (e.g. word-wrap, width).
- Hidden automatically in Code/source view and when a board view is active —
  those have their own navigation affordances.

### Testing

Extract the math into a pure, testable core:

```
computeMap(headings, docHeight, scrollY, viewportHeight)
  → { ticks: [{ top, level }], viewport: { top, height } }
```

Unit-test that function directly (positions, clamping, empty-document and
single-heading edge cases). The DOM wiring (querying headings, building
elements, event listeners) stays a thin shell around it.

---

## Out of scope

- Pixel-accurate minimap rendering.
- An outline tree panel (the rejected "Outline panel" option).
- The c26 "stuck on unsaved / save says saved but lies" save-flush bug — related
  root cause family, tracked separately.
- Multi-document / split-view map syncing.
