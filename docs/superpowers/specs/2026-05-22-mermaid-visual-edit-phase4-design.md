# Mermaid visual edit — Phase 4 design

Move from single-node selection to true multi-select, add connection
points for fluid edge drawing, and introduce a per-node lock state.

## Goal

The user can select multiple nodes (shift-click or marquee), move them
together, delete them together, and lock individual nodes so they don't
move. Edges can be created by dragging from any side of a selected node
to another node — the same gesture they see in Miro / Whimsical.

## Scope

1. Selection becomes `Set<string>` instead of `string | null`.
2. Marquee drag on empty canvas (in Select tool) → multi-select.
3. Shift-click toggles a node in/out of selection.
4. Cmd/Ctrl+A selects every node.
5. Connection points (4 small circles at N/E/S/W of selected node) →
   drag to another node to create an edge.
6. Lock state per node via a new `%% mb-locks: ["n1", "n2"]` sidecar.
   Locked nodes can't be dragged, deleted, or renamed; their selection
   ring shows a small padlock badge.
7. Multi-select drag → all selected nodes move together by the same delta.
8. Delete key → deletes every selected node and incident edges in one
   undo step.
9. Selection chrome refresh: solid light-blue ring with corner indicators.

## What does NOT ship in Phase 4

- Functional resize handles (the squares at corners). Mermaid auto-sizes
  nodes to their label; true resize requires storing per-node size and
  applying a transform-scale that distorts text. Deferred.
- Rich style context bar (Phase 5).
- Bottom-anchored toolbar redesign (Phase 6).

## Persistence

A new sidecar line, sibling to `mb-positions`:

```
flowchart TB
    %% mb-positions: {…}
    %% mb-locks: ["n1", "n3"]
    n1["A"]
    n2["B"]
    ...
```

The locks line is omitted when empty.

Parser additions:
- `tryParseLocksLine(trimmed)` → string[] | null
- `'locks'` line kind, holding `{ raw, ids: string[] }`
- `getLocks(ast)` accessor returning the set or null
- `setLocks(ast, ids)` and `toggleLock(ast, id)` mutations

## Multi-select state

In the visual editor:
- `selectedIds: Set<string>` replaces `selectedId: string | null`.
- A single helper `setSelected(id, mode)` where `mode = 'replace' | 'add' | 'remove' | 'toggle'`. Existing call sites use `'replace'`; shift-click uses `'toggle'`.
- Multiple selection rings are rendered, one per selected id, by a pool of `<div>` elements (recycled across renders).
- Context tip switches when |selection| > 1 → shows `× N selected · [Delete]` (no Shape).

## Connection points

When a single node is selected:
- Render 4 small circles (radius 5, fill white, stroke `--link`) at the
  midpoints of the node's bbox: N, E, S, W.
- Mousedown on a circle → start an "edge draft" gesture (different from
  drag-reposition).
- Mousemove → render a transient bezier from the source connection point
  toward the cursor.
- Mouseup on another node → `addEdge(ast, from, target)`.
- Mouseup elsewhere → cancel.

When |selection| > 1, connection points are hidden.

## Marquee

In Select tool, on mousedown on empty canvas (no node hit):
- Track `marquee = { startX, startY, x2, y2 }` in client coords.
- Render a translucent rect overlay over the previewPane while dragging.
- On mousemove, update the rect and recompute `selectedIds` = every node
  whose center falls inside the rect.
- On mouseup, finalize selection. (If marquee has zero area, clear
  selection — same as today's "click empty canvas to deselect".)

Shift-marquee adds to selection instead of replacing.

## Multi-drag

Today drag works on one node. With phase 4:
- mousedown on a node that's IN the current selection → drag ALL selected
  nodes (record each one's origin, apply delta to each on mousemove).
- mousedown on a node NOT in selection → replace selection with that node
  and start drag (single-node semantics).
- Locked nodes in the selection are skipped during the drag (their
  positions don't update).
- On commit, snapshot positions if needed (first-drag semantics), then
  `setPosition` for every moved node.

## Lock state

- Lock button in the existing context tip (next to ×) toggles
  `%% mb-locks` for the selected node(s).
- Locked nodes:
  - Show a small padlock icon at the top-right corner of their bbox.
  - Are skipped during drag.
  - Cannot be renamed (Enter / click-on-label is a no-op).
  - Cannot be deleted via Delete or × button — the action targets only
    unlocked selected nodes.
- The mb-locks sidecar is parsed by the existing `parseMermaid` pipeline
  and round-trips losslessly.

## Files changed

- **Modified**: `src/webview/mermaidVisualEdit.ts` — locks line kind +
  helpers.
- **Modified**: `src/webview/mermaidVisualEditDom.ts` — selection becomes
  a Set, marquee, connection points, lock UI, multi-drag.
- **Modified**: `src/webview/styles/editor.css` — connection-point dots,
  marquee rect, padlock badge, multi-select ring polish. ~80 lines.

## Risk

- Resize handle decision: we ship them as visual indicators only? No,
  better to skip entirely until Phase 4.5 — having handles that don't
  resize is worse than no handles.
- Multi-select on subgraph-heavy diagrams: marquee picks up only g.node
  elements; clusters aren't selectable. Acceptable.
