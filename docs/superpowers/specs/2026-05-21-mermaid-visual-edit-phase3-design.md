# Mermaid visual edit — Phase 3 design

Polish on top of Phase 2. Dragging a node now snaps to other nodes for alignment and to a grid, can be nudged with the keyboard, expands its containing subgraph, and newly-added nodes land sensibly in pinned diagrams.

## Goal

Make the visual editor *feel* like Miro / Figma for the cases users actually hit — small layout tweaks, dragging a node out of a subgraph, picking up where mermaid's auto-layout drops the ball.

## What ships in Phase 3

1. **Alignment guides** — while dragging, dashed indigo lines appear when the dragged node's center / edges line up with another node's center / edges. The guides snap the node to those positions within a small threshold.
2. **Snap-to-grid** — optional 8 px grid snap during drag, off by default. New toolbar toggle (icon: grid) between Reset Layout and the existing buttons.
3. **Keyboard nudge** — with a node selected and the editor focused: `Arrow` moves the node 1 px, `Shift+Arrow` moves 8 px. Each nudge writes a position update.
4. **Subgraph cluster fit** — after drag commit (and after every `applyPositionsOverlay`), recompute each subgraph cluster's `<rect>` to enclose its contained nodes plus padding.
5. **New-node centroid placement** — when the user drops a node via the toolbar in a block that already has `mb-positions`, immediately place it at the centroid of existing positions (offset slightly to avoid overlap) and add it to the sidecar.

## What does NOT ship in Phase 3

- Zoom (Cmd+0 / +/-) inside the block — separate feature.
- Cmd+D duplicate.
- Cross-block paste (clipboard JSON).
- Multi-select drag.

All of these can ship later without disturbing the existing surface.

## Alignment guides

### When they appear

During a drag, on every mousemove we compute candidate alignments against every other (non-dragging) node:

- Center X equal → vertical guide line at the shared X.
- Center Y equal → horizontal guide line at the shared Y.
- Left edge X equal → vertical guide at the shared X (using the dragged + other node's bbox).
- Right edge X equal → same.
- Top edge Y equal → horizontal guide.
- Bottom edge Y equal → horizontal guide.

A "match" means the absolute distance between the two coordinates is less than the snap threshold (6 SVG units). When matched, the dragged node's transient transform is snapped to the matching coordinate.

### Visual

Each guide is a `<line>` rendered into a dedicated SVG overlay layer added to the `previewPane`:

- Stroke: `--link` (indigo).
- Stroke-width: 1.
- Stroke-dasharray: `3 3`.
- Z-index: above SVG, below selection ring.

Multiple guides can show simultaneously (e.g., vertical center + horizontal top).

Guides are cleared on mouseup.

### Implementation

A `createGuideLayer(previewPane)` function returns `{ show(lines: GuideLine[]), hide(), destroy() }`. `GuideLine` is `{ orient: 'h' | 'v'; coord: number; from: number; to: number }`. The drag handler computes guides each move; if `show()` is called with the same set, the layer reuses elements.

## Snap-to-grid

A new state flag on the visual editor: `snapToGrid: boolean`, default false. Toolbar gains a Grid toggle button next to Reset; clicking toggles the flag. When enabled and no alignment guide is active, the dragged node's position rounds to the nearest 8 SVG units on each axis.

Alignment guide snap takes precedence over grid snap (matching Figma).

The grid itself is NOT drawn — too noisy. The toggle is purely behavioral.

## Keyboard nudge

When the visual editor has a selected node and no inline rename is open:

- `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight` — move the node ±1 unit.
- `Shift + Arrow` — move ±8 units.
- Each press writes a position update (debounced 200 ms so 10 rapid presses become 1 source mutation).

Pressing arrows in source-edit mode (textarea) is unaffected.

Edge case: if the block has no `mb-positions` line yet, the first nudge snapshots all node positions (same as drag).

## Subgraph cluster fit

After every `applyPositionsOverlay` (and once at the end of each drag), for each `g.cluster`:

1. Find all `g.node` elements inside the cluster's `<g.nodes>` (or otherwise tagged as children).
2. Compute their combined bounding box.
3. Set the cluster's `<rect>` (or `<polygon>` for shaped clusters) `x`, `y`, `width`, `height` to the bbox padded by 24 units.
4. Re-position the cluster's label so it stays at the top-left or top-center (whichever mermaid originally chose).

If the SVG structure differs in some mermaid version, the function exits gracefully — clusters just stay where mermaid put them.

## New-node centroid placement

When the user picks a shape from the toolbar and clicks the canvas:

1. The mutation (`addNode`) runs as before, creating a new node line in the AST.
2. If `getPositions(ast)` returns a non-null map, compute the centroid of the existing positions and offset by `(40, 40)` to avoid stacking on the centroid.
3. Add the new node's position to the sidecar via `setPosition`.
4. The single `mutate` call commits both the new node AND the new position.

If positions don't exist (auto-layout block), behavior is unchanged from Phase 2: mermaid picks the position.

## Files changed

- **Modified**: `src/webview/mermaidVisualEditDom.ts` — alignment guide layer, snap logic, keyboard nudge handler, cluster fit, centroid helper, new toolbar grid toggle. Estimated ~250 new lines.
- **Modified**: `src/webview/extensions/mermaidBlock.ts` — call subgraph cluster fit after the overlay runs.
- **Modified**: `src/webview/styles/editor.css` — guide line style, grid-toggle button active state. ~30 lines.

## Performance

- Alignment guide computation is O(n) per mousemove. Inexpensive for typical flowcharts (n ≤ 50). For larger blocks we'd consider spatial indexing — out of scope.
- Cluster fit is O(clusters × nodes). Acceptable; runs only on render and after drag, not on every mousemove.

## Accessibility

- Keyboard nudge gives diagram authors a screen-reader-friendly way to fine-tune positions.
- Snap-to-grid toggle has an `aria-pressed` attribute.

## Testing

- **Unit** (jest, optional in this round): `nudgeNode`, centroid math, cluster fit math. Pure functions.
- **Manual smoke** in the harness + dev host:
  - Drag a node; pink guides appear when aligned with neighbors. Release with a guide active → node snaps to the guide.
  - Toggle Snap to grid; drag a node — positions land on 8 px increments.
  - Select a node, press arrows — node moves 1 px. Hold shift — 8 px.
  - Drag a node *inside* a subgraph; the cluster's box doesn't move. Drag the node *outside* the subgraph; the cluster shrinks to fit what remains.
  - In a pinned block, drop a new Rect via the toolbar — it lands near the centroid of existing nodes, not at (0, 0) or off-screen.

## Open questions (resolved here)

- **Guide threshold** — 6 SVG units. Empirical: roughly half a typical node width gap on a normal-density diagram.
- **Grid size** — fixed 8 px. We could expose this as a setting; not now.
- **Nudge debounce** — 200 ms. Long enough to coalesce typeahead-style nudges, short enough to feel responsive.
- **Cluster padding** — 24 SVG units. Matches mermaid's default cluster inset.
