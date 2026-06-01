# Mermaid visual edit — Phase 2 design

Add drag-to-reposition to the visual mermaid editor. Positions are stored in
a hidden `%%` comment line inside the mermaid block so markdown round-trip
stays clean. Mermaid keeps owning auto-layout when no positions are set;
once the user drags, the block pins all nodes' positions and we override
SVG transforms post-render.

## Goal

In a flowchart block, after entering Visual Edit, the user can drag any
node anywhere on the canvas. The diagram remembers the layout across saves
and reloads. A "Reset layout" button restores auto-layout.

## What ships in Phase 2

1. **Drag** — single-click selects a node (Phase 1 behavior); subsequent
   mousedown-and-drag on the same node moves it. Releases commit a new
   position to the sidecar.
2. **Persistence** — a single comment line `%% mb-positions: {…JSON…}` lives
   at the top of the block (right under the diagram-kind header). When
   present, our overlay applies positions; otherwise mermaid owns layout.
3. **First-drag snapshot** — the first drag on a previously un-pinned block
   captures mermaid's current auto-layout for *every* node into the sidecar.
   That keeps edges visually coherent (all endpoints are pinned at once).
4. **Edge re-routing** — after each render with `mb-positions`, we walk
   every `g.edgePath` and replace its path with a fresh cubic bezier from
   one node center to the other. Arrow markers (mermaid's existing defs)
   are reused.
5. **Reset layout** — new toolbar button (rotate-counterclockwise icon)
   between Arrow and Text. Click → confirmation dialog → deletes the
   `mb-positions` line → re-renders with auto-layout. Cmd+Z still works.

## What does NOT ship in Phase 2

- Resize handles
- Alignment guides
- Snap-to-grid
- Keyboard nudge (arrow keys)
- Multi-select drag
- Cross-block paste

These all stay in Phase 3.

## Persistence format

```
flowchart TB
    %% mb-positions: {"n1":[120,80],"n2":[260,80],"n3":[180,180]}
    Disk[("file")]
    Disk --> n2
```

- Single JSON object on one line. Keys are mermaid node ids; values are
  `[x, y]` tuples (numbers, rounded to 0 decimals).
- The line is always indented 4 spaces, always sits as the FIRST non-empty
  line after the header.
- Coordinates are in the same SVG coordinate space mermaid uses (units of
  the rendered SVG's viewBox). No transformation applied.
- Block-level scope: subgraphs are still mermaid-laid-out (we do not
  attempt to position cluster boxes). User can reposition the nodes
  *inside* subgraphs; the subgraph box's position is recomputed to enclose
  them.

### Parser changes

`mermaidVisualEdit.ts` gains:

- A new line kind `'positions'` with shape `{ kind: 'positions'; raw: string; map: Record<string, [number, number]> }`.
- `tryParsePositionsLine(trimmed)` — matches `%% mb-positions: <json>` and
  returns the parsed map, or null.
- `ast.positions` accessor — convenience getter returning the map or null.
- Mutations: `setPosition(ast, id, x, y)` and `setAllPositions(ast, map)`
  and `clearPositions(ast)`. Each mutation rewrites the single positions
  line (or inserts/removes it).
- Re-serializer emits positions line BEFORE the first node line.

## Render pipeline

```
source → mermaidRenderer.renderMermaid(source) → SVG string
                                                    │
                                                    ▼
                       svgHost.innerHTML = svg (existing flow)
                                                    │
                                                    ▼
                  applyPositionsOverlay(ast, svgHost)   ← new in Phase 2
                       1. read ast.positions; if none, exit
                       2. snapshot mermaid's current node positions
                          (used as fallback for any id not in
                          the sidecar)
                       3. for each g.node: set transform
                          translate(x, y) — overrides mermaid's
                          own transform
                       4. for each g.edgePath: compute new bezier
                          from from-node center to to-node center;
                          rewrite the path's d attribute
                       5. recompute subgraph cluster boxes by
                          enclosing their contained nodes' bboxes
```

This runs every time the preview re-renders, so any edit (rename, add,
drag) re-applies the overlay.

## Drag UX

- **Idle**: hovering a node shows a subtle "grab" cursor on the selection
  ring (only while the node is selected).
- **Mousedown on selected node**: start drag. Cursor becomes "grabbing".
  Ring follows the node in real time via CSS transform on the overlay
  (we don't wait for re-render — that would be janky).
- **Mousemove**: live-update node position via transient transform on the
  `g.node` group. Do NOT mutate the source on every mousemove; that would
  thrash mermaid.
- **Mouseup**: commit. Read the final position, write it back via
  `setPosition`, which calls onSourceChange and triggers a re-render. At
  that point the overlay re-applies and we're back in sync.
- **Esc mid-drag**: cancel. Restore original transform, exit drag.
- **First drag** on an unpinned block: before applying the user's delta,
  we snapshot every node's current position into the sidecar (so all edge
  endpoints stay correct after pinning).

## Toolbar changes

Insert a new button between Arrow and Text:

- Icon: rotate-counterclockwise (existing `mb-vTb` style).
- aria-label: "Reset layout (Cmd+Shift+R)".
- Disabled state when the block has no `mb-positions` line.
- Click → confirmation modal: *"Reset layout? This removes pinned positions and lets mermaid auto-layout the diagram."* with **Reset** and **Cancel** buttons.

## Edge re-routing details

For each existing edge (already drawn by mermaid before our overlay):

1. Look up the `from` and `to` nodes by id (after positions have been applied).
2. Compute their centers in the SVG's coordinate space.
3. Find the SVG `g.edgePath` element belonging to this edge (mermaid tags it
   with `id="L-<from>-<to>-<n>"` or similar).
4. Replace the `d` attribute of the inner `<path class="path">` with a
   simple cubic bezier:
   - Start: edge of `from` node toward `to`
   - End: edge of `to` node toward `from`
   - Control points: 1/3 and 2/3 along the line, offset perpendicular by
     a small amount for visual curve
5. Recompute the label position to the midpoint of the bezier.
6. Keep mermaid's existing `<marker>` defs for arrowheads.

Limitations accepted:
- Edges may cross other nodes (no smart routing in v1).
- Self-loops and multi-edges between the same pair may overlap.
- Labels for parallel edges may stack on top of each other.

These are explicitly Phase 3+ concerns.

## Files changed

- **Modified**: `src/webview/mermaidVisualEdit.ts` — add positions line
  kind, parser, mutations, re-serializer.
- **Modified**: `src/webview/mermaidVisualEditDom.ts` — add drag handler,
  applyPositionsOverlay, Reset layout button + confirmation dialog,
  cursor styling.
- **Modified**: `src/webview/extensions/mermaidBlock.ts` — call
  `applyPositionsOverlay` after every render (it's a no-op when the
  sidecar isn't present).
- **Modified**: `src/webview/styles/editor.css` — grab / grabbing cursors,
  reset-layout button + confirmation dialog styles. ~50 lines.

## Performance

- Drag uses transient transforms on the SVG node — no source mutation per
  mousemove. Mousemove handler is rAF-batched.
- Re-render after mouseup goes through the same path as any other source
  change. Mermaid's render is ~50 ms for typical flowcharts.
- Position snapshot reads `getBBox()` on every `g.node` once. O(n) where
  n is node count. Snappy.

## Accessibility

- Drag is mouse-only in Phase 2. Keyboard nudge waits for Phase 3.
- Reset layout button has `aria-label` and a tooltip.
- Confirmation modal traps focus, Esc cancels.

## Testing

- **Unit** (jest, `tests/webview/mermaidVisualEdit.parse.test.ts`):
  parse + serialize round-trip of blocks with and without `mb-positions`.
  Test `setPosition` / `clearPositions` correctness.
- **Manual smoke** in dev host + Playwright harness:
  - Open `mermaid-test.md`. Double-click flowchart. Drag a node. Source
    updates with `mb-positions` line. Reload file. Node stays where
    placed.
  - Drag a node connected by a labelled edge. Edge re-routes; label
    follows midpoint.
  - Reset layout → confirmation → diagram returns to auto-layout.
  - Add new node via Rect tool after positions exist. New node lands at
    a sensible default position (we'll insert it at the centroid of
    existing nodes).
  - Subgraphs: drag a node out of its subgraph — subgraph cluster box
    grows to enclose it.

## Open questions (resolved here)

- **Drag activation** — always-on in visual mode (no separate Move tool).
- **First drag pin** — pins ALL nodes' current positions, not just the
  moved one (preserves edge sanity).
- **Reset confirmation** — yes, with Cancel + Reset, because the action
  is destructive across all nodes.
- **Positions for nodes added after pinning** — we place them at the
  centroid of existing positions and immediately write to the sidecar so
  they don't drift on next render.

## Risks

- **Re-render flicker**: SVG node positions briefly snap back to mermaid's
  auto-layout positions before our overlay applies. Mitigation: hide
  `g.node` and `g.edgePath` with CSS visibility:hidden until overlay
  runs, then reveal in the same animation frame.
- **Coordinate space drift**: mermaid's viewBox can differ between renders
  if node count changes. Our positions assume a stable coordinate space.
  Mitigation: store positions as ratios of the viewBox? No — too fragile
  for the v1. Accept that adding a large new node may shift things
  slightly.
- **Edge routing**: simple beziers will look ugly for some flowcharts
  (long edges crossing nodes). Acceptable for v1; Phase 3 considers
  smarter routing or letting mermaid handle edges with our positions
  injected.
