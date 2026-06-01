# Mermaid visual edit — Phase 8 design

Power-user actions: keyboard duplicate, cross-block clipboard,
align/distribute.

## What ships

- **Cmd/Ctrl+D** — duplicate every selected node (same as the
  Duplicate button in the context tip; same offset; selection
  follows to the new copies on next render).
- **Cmd/Ctrl+C** — serialize every selected node's `{ shape, label,
  position?, style? }` into a clipboard JSON payload (prefixed with
  the marker `__mb_clipboard__:` so we ignore unrelated text).
- **Cmd/Ctrl+V** — read clipboard, recognize the marker, and re-add
  each node with a new id, copying style and offsetting position by
  (30, 30). Pasted nodes become the new selection.
- **"⋯ More" button** in the single-node context tip → popover with
  Align Left / Center / Right / Top / Middle / Bottom + Distribute
  Horizontally / Vertically. Each item operates on the current
  selection (≥ 2 nodes; auto-pins positions if the block wasn't
  pinned yet).

## Files changed

- `mermaidVisualEditDom.ts` — Cmd+D/C/V handlers, duplicateSelected,
  copySelection, pasteSelection, alignSelected, More popover.
- `editor.css` — More popover styling.

## Limitations

- Pasted edges aren't copied — only node geometry. Wiring is left as
  a future enhancement.
- Distribute requires 3+ selected nodes to be meaningful; with 2 it
  is a no-op.
