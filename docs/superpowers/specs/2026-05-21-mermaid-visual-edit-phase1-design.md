# Mermaid visual edit — Phase 1 design

Turn the mermaid block from a static SVG preview into an interactive editing surface. Phase 1 ships rename / add / delete / connect — every operation a user can do in mermaid.chart short of drag-to-reposition. Mermaid still owns auto-layout; markdown stays vanilla.

## Goal

You open a `.md` file, see a rendered mermaid diagram, double-click it, and start building. Click a node to rename. Drop a shape from the toolbar. Drag from one node to another to add an arrow. Delete what you don't want. Esc to step back into preview. The fenced ` ```mermaid ` source updates as you go, so the file on disk stays the source of truth.

This is the first of three planned phases:

- **Phase 1** (this spec): visual editing without positioning.
- **Phase 2** (separate spec, later): drag-to-reposition with `layout: fixed` and per-node `@{ x, y }` coords.
- **Phase 3** (separate spec, later): alignment guides, snap-to-grid, keyboard nudge, cross-block paste.

AI assistance and a generic Miro-like canvas are explicitly **not** in this roadmap; both are parked.

## State model

Today a mermaid block has two states (Preview, Source). Phase 1 adds Visual Edit between them.

```
Preview  ──double-click──►  Visual Edit  ──Esc / outside click──►  Preview
   │                               │
   │  Edit toggle on               │  Edit toggle on
   ▼                               ▼
 Source  ◄──Edit toggle off──   Source
```

- **Preview** — unchanged. Static SVG. Hover does nothing.
- **Visual Edit** — new state. SVG stays rendered (same renderer call), but selection / toolbar / context tip overlays mount on top. The block container picks up a soft 2px accent ring to telegraph "you are in it now."
- **Source** — unchanged. Edit toggle is the only entry. Closing source re-renders the diagram.

Double-click no longer routes to Source; it routes to Visual Edit. The Edit toggle still exists, still routes to Source. If the user wants the old "double-click for source" behaviour they use the toggle.

Existing snackbar wording on entry is unchanged for Source; in Visual Edit the snackbar reads *"Visual editing · press Esc to preview"* and dismisses after ~1800 ms like today.

If the source can't be parsed by our in-memory parser (see Persistence below), Visual Edit refuses to activate — double-click falls back to Source. No risk of corrupting exotic hand-written diagrams.

## Visual Edit affordances

### Toolbar

A floating chrome at the top of the block, only visible in Visual Edit. Left to right:

- **Select** (default, arrow icon) — pointer mode. Clicking nodes selects; clicking blank canvas starts a marquee.
- **Rectangle**, **Pill** (stadium), **Circle**, **Diamond** — the four common mermaid node shapes. Pick one, click an empty spot on the canvas, and a new node with placeholder label `Untitled` is dropped at that position. Mermaid's auto-layout decides actual position on next render.
- **Arrow** — special tool. Click one node, click another, an edge is created.
- **Text** — drops a label-only node (mermaid renders as `id["label"]` with no shape).

Active tool is highlighted (filled background, accent color). After dropping a shape, the toolbar returns to Select. Hover shows a tooltip with the keyboard shortcut.

Keyboard shortcuts (only active while the block has visual-edit focus): `V` Select, `R` Rect, `P` Pill, `C` Circle, `D` Diamond, `A` Arrow, `T` Text.

### Selection

Single-click on a node toggles it selected. Selection is shown by:

- A 1.5 px dashed ring 4 px outside the node, accent color.
- A small **context tip** that floats just below the node: `[● Color] · [Shape ▾] · [Link] · [×]`. Each item is a small inline button.
  - Color opens a 6-swatch palette popover (default, indigo, cyan, emerald, amber, rose).
  - Shape opens a 4-option popover (rect / pill / circle / diamond).
  - Link opens an inline input — populates mermaid's `click <id> "url"` line.
  - `×` deletes the node and any incident edges.

For an edge: dashed ring along the edge path; context tip floats at edge midpoint: `[Style ▾] · [Cap ▾] · [Label] · [×]`. Style = solid / dashed / dotted. Cap = arrow / open / dot / none. Label opens an inline input that writes mermaid's `--|"label"|-->` syntax.

### Rename

Two equivalent gestures:

- Click a node when it's already selected, OR
- Press `Enter` while a node is selected.

An inline contenteditable input overlays the node, label preselected. Enter commits, Esc cancels. While the input is open, all toolbar buttons are disabled. Clicking another node commits + selects the new node.

### Edge creation

- Hover any selected node → a small `+` handle appears mid-edge on each of its four sides (N / E / S / W).
- Mousedown on the handle → drag. A live ghost arrow follows the cursor.
- Release over another node → edge created. Release on empty canvas → arrow cancelled.
- This is the only edge-creation gesture in Phase 1. The toolbar's Arrow tool is an alternative (click two nodes).

### Multi-select

- Shift-click adds to / removes from selection.
- Drag on empty canvas with Select tool → marquee.
- Cmd/Ctrl + A → select all nodes (not edges).
- Multi-selected nodes show all rings; context tip merges into a single chip (`× N selected · [Delete]`).
- Delete or Backspace removes every selected node + all incident edges. Single undo entry.

### Keyboard summary

- `Esc` — exit visual edit (back to Preview)
- `Enter` — rename selected node
- `Delete` / `Backspace` — delete selection
- `Cmd/Ctrl + A` — select all nodes
- `Cmd/Ctrl + Z` — undo (block-local)
- `Cmd/Ctrl + Shift + Z` — redo
- `V R P C D A T` — toolbar tool shortcuts

## Markdown persistence

Phase 1 only mutates node and edge syntax — no positions, no `layout: fixed`. The source stays minimal and hand-readable.

### Parsing strategy

A small **lossy-but-safe** mermaid parser, scoped to `flowchart` and `graph` blocks. It recognizes:

- The header line: `flowchart TB`, `flowchart LR`, `graph TD`, etc.
- Node declarations: `id["Label"]`, `id(Label)`, `id((Label))`, `id{Label}`, `id["text"]:::className`.
- Edge declarations: `a --> b`, `a -- "label" --> b`, `a ==> b`, `a -.-> b`, `a --x b`, `a --o b`.
- Click bindings: `click a "url"`.

It does NOT understand: `subgraph` blocks, `classDef`, `style`, frontmatter / `---` config blocks, `linkStyle`, custom CSS classes beyond `:::name`. These lines are kept verbatim and re-emitted untouched in the same relative position.

The parser builds an AST: `{ header, nodes: Map<id, {id, label, shape, color?, link?, raw?}>, edges: Edge[], passthrough: PassthroughLine[] }`. Every visual edit mutates this AST; serialization re-emits the source.

### Re-serialization rules

- Node order in the emitted source matches the AST's insertion order.
- Edge order matches AST order (new edges are appended).
- Passthrough lines stay anchored to their original neighbors as much as possible (each passthrough line stores the index of its preceding node/edge declaration).
- New node ids are auto-generated: `n1`, `n2`, … (skipping ids already used).
- Re-emit uses canonical whitespace (single space around `-->`, two-space indentation under the header). Existing hand-formatted blocks are normalized on first edit.

### Parse failure → fallback

If the parser can't make sense of the source (e.g., diagram kind we don't handle, unfamiliar syntax, etc.), the block:

1. Refuses to enter Visual Edit. Double-click goes to Source instead.
2. Adds a small `Visual edit unavailable` tooltip to the block header (hover for "This diagram uses syntax we can't yet edit visually — open Source to edit").

No partial edits are ever written back. Either the AST round-trips cleanly or we don't touch it.

## Undo / redo

- Block-local undo stack, 50 entries deep.
- Each user-visible operation is one entry: rename, add node, add edge, delete (single or multi), color change, shape change, link change.
- Stack persists across Visual Edit ↔ Preview transitions within the same session. Cleared on file reload or block destroy.
- Cmd/Ctrl + Z and Cmd/Ctrl + Shift + Z only fire when the block has visual-edit focus. ProseMirror's editor-wide undo is unaffected and operates on block-level changes (the block becoming dirty after any visual edit goes through ProseMirror as a single text update).

This means there are two undo stacks — ProseMirror's at the doc level (which sees every visual edit as one text replacement) and ours at the block level (which sees the granular steps). They don't try to integrate. Esc out of Visual Edit and ProseMirror's Cmd+Z reverts the whole block to its pre-Visual-Edit content.

## Scope guardrails

- **Only `flowchart` and `graph`** activate Visual Edit. Other diagram kinds (`sequenceDiagram`, `stateDiagram`, `gantt`, `erDiagram`, etc.) stay preview-only; double-click on those routes to Source as today.
- **No positions** — auto-layout owns it. Phase 2 adds drag.
- **No AI** — parked.
- **No mobile / touch** — desktop pointer events only. Touch input falls through to Preview.
- **No collaboration** — single-user editor.
- **No subgraph editing** — subgraph lines pass through untouched. Visual edits inside a subgraph are allowed (rename, etc.) but creating new subgraphs or moving nodes between subgraphs is out of scope.

## Architecture

Three new units; everything stays inside the webview.

### `src/webview/mermaidVisualEdit.ts` — the editor module

Single export: `createVisualEditor(block, source, onSourceChange)`. Inputs:

- `block` — the host `<div>` for overlays (toolbar, selection rings, context tip, marquee).
- `source` — the current mermaid source string.
- `onSourceChange(newSource)` — callback that writes the new source back to ProseMirror.

Owns:

- The lossy mermaid parser + serializer.
- The in-memory AST.
- The undo stack.
- All DOM overlays.

Exposes:

- `activate()` / `deactivate()` — switch in / out of Visual Edit.
- `canEdit(source): boolean` — quick parse check, used by `mermaidBlock` to decide whether to allow double-click to enter.

Knows nothing about ProseMirror or mermaid the library.

### `src/webview/mermaidVisualEditDom.ts` — pure DOM helpers

Selection ring, context tip, toolbar, edge-create handles, marquee. Each is a small builder function returning `{ el, update, destroy }`. Pure DOM — same pattern as `mermaidFullscreen.ts`.

### `src/webview/extensions/mermaidBlock.ts` — wires it up

- New state-machine internal: `preview | visual | source`.
- Double-click → calls `createVisualEditor(...)` if `canEdit(source)` else routes to Source.
- Esc, outside-click, or Edit toggle handle exit.
- The existing `mermaidRenderer` is unchanged — Visual Edit re-renders on every source change via the same path Preview uses.

## Files changed

- **New**: `src/webview/mermaidVisualEdit.ts` (parser + AST + serializer + undo + tool logic).
- **New**: `src/webview/mermaidVisualEditDom.ts` (toolbar / selection / tip / marquee builders).
- **Modified**: `src/webview/extensions/mermaidBlock.ts` (state machine, double-click routing, callbacks).
- **Modified**: `src/webview/styles/editor.css` (toolbar chrome, selection rings, context tip, marquee, accent ring on the block in Visual Edit). Estimated ~250 lines.

## Performance

- Parser runs once per Visual Edit activation and once per edit. Single-block flowchart parses are microseconds — no concern.
- Selection / drag handlers use rAF batching for ring updates.
- Re-render via `mermaidRenderer` is debounced 80 ms during multi-step operations (rare but possible — e.g., paste in Phase 3).

## Accessibility

- Toolbar buttons have `role="button"` and `aria-label`s, focusable via Tab.
- Selected nodes get `aria-selected="true"` on a wrapping element.
- The context tip is `role="group"` with each button labelled.
- Inline rename input has `aria-label="Rename node"`.
- All keyboard shortcuts work without a mouse. Tab cycles through nodes when no mouse selection exists.
- Color / shape popovers trap focus while open; Esc closes.

## Testing

- **Unit** (jest): parser round-trip on a fixture set of 30 representative mermaid blocks. AST mutations (add node, rename, add edge, delete, etc.) verified to produce the expected source string.
- **Unit**: `canEdit` returns `false` for sequence/state/gantt and for blocks with unknown syntax.
- **DOM** (jest + jsdom): toolbar tool switching, selection ring placement, context-tip click handlers, undo stack ordering.
- **Manual smoke** before merge:
  - Open `mermaid-test.md`. Double-click the flowchart. Toolbar appears.
  - Drop a rectangle. Rename it. Connect it to "Start". Save and reopen — diagram preserves.
  - Multi-select two nodes, delete. Undo restores both. Redo removes both.
  - Esc returns to Preview. Edit toggle still goes to Source.
  - State diagram in the same file: double-click stays in Preview (or routes to Source), toolbar never appears.

## Open questions for Phase 2 (not this spec)

- Where positions live in the source: `n1@{ x: 100, y: 200 }` syntax is mermaid v11+ — verify it round-trips through our parser.
- Whether resetting positions deletes the `layout: fixed` config header too, or just the `@{ x, y }` attrs.
- Whether resize handles ship in Phase 2 or stay deferred to Phase 3.

These are deliberately open. Phase 1 doesn't constrain them.
