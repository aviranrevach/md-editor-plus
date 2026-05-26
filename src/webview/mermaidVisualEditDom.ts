// DOM overlays for the visual mermaid editor. Pure DOM — no ProseMirror, no
// mermaid library knowledge. Talks to mermaidVisualEdit through callbacks.
//
// Built as a single createVisualEditor() factory because the toolbar, selection,
// rename overlay, and context tip all share a coordinate space (the block
// container) and a small bit of internal state (active tool, current selection).
// Splitting them into independent modules would just shuffle the cross-talk
// into a global event bus — and Phase 2 will reach into all of them at once
// when drag-to-reposition lands.

import {
  parseMermaid, serializeMermaid, cloneAst, canEdit,
  addNode, renameNode, deleteNode, addEdge, changeNodeShape,
  collectNodes, NodeShape, Ast,
  getPositions, setAllPositions, setPosition, clearPositions, PositionMap,
  getLocks, isLocked, toggleLock,
  getStyles, getNodeStyle, setNodeStyle, NodeStyle, StyleMap,
  getEdgeStyles, getEdgeStyle, setEdgeStyle, deleteEdgeByKey, edgeKey,
  EdgeStyle, EdgeCap, EdgeAnimation, EdgeAnimationDirection,
  getLines, setLines, addLine, updateLineById, deleteLineById, LineDecl, LineEndpoint,
} from './mermaidVisualEdit';

export type Tool =
  | 'select' | 'pan'
  | 'rect' | 'round' | 'pill' | 'circle' | 'diamond' | 'hexagon' | 'cylinder' | 'subroutine' | 'trapezoid' | 'parallelogram'
  | 'arrow' | 'line' | 'text' | 'sticky';

export interface VisualEditorOptions {
  /** The block's outer DOM element (we own absolute overlays inside it). */
  block:       HTMLElement;
  /** The pane that contains the rendered mermaid <svg>. We position overlays relative to this. */
  previewPane: HTMLElement;
  /** Current mermaid source. */
  getSource:   () => string;
  /** Called whenever a visual edit produces a new source. */
  onSourceChange: (newSource: string) => void;
  /** Called when the editor wants to exit (Esc, outside click). */
  onExit: () => void;
}

export interface VisualEditorHandle {
  /** Re-bind to the rendered SVG after mermaidRenderer paints a new one. */
  onMermaidRerender: () => void;
  /** Tear everything down — overlays, listeners, state. */
  destroy: () => void;
}

const SHAPE_FOR_TOOL: Record<Exclude<Tool, 'select' | 'arrow' | 'sticky' | 'pan' | 'line'>, NodeShape> = {
  rect:           'rect',
  round:          'round',
  pill:           'pill',
  circle:         'circle',
  diamond:        'diamond',
  hexagon:        'hexagon',
  cylinder:       'cylinder',
  subroutine:     'subroutine',
  trapezoid:      'trapezoid',
  parallelogram:  'parallelogram',
  text:           'text',
};

// SVG icons used by the toolbar. Stroke-based, currentColor — tint via CSS.
// Phosphor-bold-styled tool icons. Stroke 2.2 + linecap round to match the
// thicker, more deliberate Phosphor look. Each glyph is sized for the bigger
// (32px) tool buttons so they don't look skinny inside the chip.
const TOOL_STROKE = `fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;
const ICONS: Record<string, string> = {
  select:  `<svg viewBox="0 0 24 24" ${TOOL_STROKE} fill="currentColor"><path d="M5.5 3.5 5.5 19.7 9.4 16 14.8 22 17.3 20.5 13.2 14.5 18.5 14.5z" fill="currentColor" stroke="currentColor"/></svg>`,
  pan:     `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.99-3.5l-3.4-5.9a2 2 0 1 1 3.4-2l1.99 3.4"/></svg>`,
  rect:           `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><rect x="4" y="6" width="16" height="12"/></svg>`,
  round:          `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><rect x="4" y="6" width="16" height="12" rx="4"/></svg>`,
  pill:           `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><rect x="3" y="8" width="18" height="8" rx="4"/></svg>`,
  circle:         `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><circle cx="12" cy="12" r="7"/></svg>`,
  diamond:        `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><path d="M12 3l9 9-9 9-9-9 9-9z"/></svg>`,
  hexagon:        `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><path d="M7 5h10l5 7-5 7H7l-5-7 5-7z"/></svg>`,
  cylinder:       `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><ellipse cx="12" cy="7" rx="6" ry="2"/><path d="M6 7v10c0 1.1 2.7 2 6 2s6-.9 6-2V7"/></svg>`,
  subroutine:     `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><rect x="4" y="6" width="16" height="12"/><line x1="7" y1="6" x2="7" y2="18"/><line x1="17" y1="6" x2="17" y2="18"/></svg>`,
  trapezoid:      `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><path d="M3 18 L7 6 L17 6 L21 18 Z"/></svg>`,
  parallelogram:  `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><path d="M7 6 L21 6 L17 18 L3 18 Z"/></svg>`,
  arrow:   `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><path d="M4 12h14"/><path d="M14 7l5 5-5 5"/></svg>`,
  line:    `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><path d="M5 19L19 5"/></svg>`,
  text:    `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><path d="M5 6h14"/><path d="M12 6v14"/></svg>`,
  sticky:  `<svg viewBox="0 0 24 24" fill="#fef6a9" stroke="#b89d1f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5" fill="#f0e07a"/></svg>`,
  // "Shapes" composite button — a square + circle + triangle in one glyph.
  shapes:  `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><rect x="3" y="13" width="8" height="8" rx="1"/><circle cx="17" cy="17" r="4"/><path d="M9 3l5 8h-10z"/></svg>`,
  reset:   `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/></svg>`,
  grid:    `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/></svg>`,
  lock:    `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  unlock:  `<svg viewBox="0 0 24 24" ${TOOL_STROKE}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.8"/></svg>`,
};

const TOOL_HOTKEYS: Record<string, Tool> = {
  v: 'select',
  h: 'pan',
  r: 'rect',
  p: 'pill',
  c: 'circle',
  d: 'diamond',
  a: 'arrow',
  l: 'line',
  t: 'text',
  n: 'sticky',
};

export function createVisualEditor(opts: VisualEditorOptions): VisualEditorHandle {
  let activeTool: Tool = 'select';
  // Multi-select: `selectedIds` is the canonical store. `selectedId` mirrors
  // the single-selection convenience (set only when size === 1) so the rest
  // of the file's existing single-node logic continues to work unchanged.
  const selectedIds = new Set<string>();
  let selectedId: string | null = null;
  function syncSelectedId(): void {
    selectedId = selectedIds.size === 1 ? selectedIds.values().next().value as string : null;
  }
  // Phase 9: selected edge (single, by edgeKey "from->to->idx"). Mutually
  // exclusive with node selection — selecting an edge clears node selection
  // and vice versa.
  let selectedEdgeKey: string | null = null;
  // Phase 10 (standalone lines): selected free-line id. Mutually exclusive
  // with node + edge selection.
  let selectedLineId: string | null = null;
  // For Arrow tool — first click captures the source node, second click connects.
  let pendingFromId: string | null = null;

  const undoStack: Ast[] = [];
  const redoStack: Ast[] = [];
  const MAX_UNDO = 50;
  // After a duplicate, re-select the new copies on the next rerender.
  let pendingDuplicateIds: string[] | null = null;
  // After committing a fresh line, auto-select it once the SVG re-renders.
  let pendingNewLineId: string | null = null;

  // ── Overlays (mounted under the block, absolute-positioned) ─────────────
  opts.block.classList.add('mb-visual-active');

  // ── Phase 3 state ──────────────────────────────────────────────────────
  let gridSnapEnabled = false;
  const guideLayer = createGuideLayer(opts.previewPane);

  // ── Phase 7: viewport (zoom + pan) ─────────────────────────────────────
  const viewport = { scale: 1, tx: 0, ty: 0 };
  function getSvgHost(): HTMLElement | null {
    return opts.previewPane.querySelector<HTMLElement>('.mb-svg-host');
  }
  function applyViewport(): void {
    const host = getSvgHost();
    if (!host) return;
    host.style.transformOrigin = '0 0';
    host.style.transform = `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`;
    zoomReadout?.update(viewport.scale);
    // Re-pick the dot grid spacing so dots stay at a comfortable on-screen
    // density (~14 px) regardless of zoom — snaps to powers of 2.
    updateDotGrid(opts.previewPane, viewport.scale * naturalSvgScale(opts.previewPane));
    // Selection overlays use getBoundingClientRect which already accounts for
    // CSS transforms, so they follow automatically — just refresh.
    refreshSelectionUI();
  }
  function setZoom(next: number, anchor?: { x: number; y: number }): void {
    const clamped = Math.max(0.2, Math.min(4, next));
    if (anchor) {
      // Keep the anchor point fixed under the cursor by adjusting tx/ty.
      const host = getSvgHost();
      if (host) {
        const hostRect = host.getBoundingClientRect();
        const hostX = anchor.x - hostRect.left;
        const hostY = anchor.y - hostRect.top;
        // Position of the anchor in pre-transform svg coords.
        const preX = (hostX) / viewport.scale;
        const preY = (hostY) / viewport.scale;
        // After zoom, we want preX,preY to land back at hostX,hostY.
        // New transform: host_orig + (preX*newScale, preY*newScale)
        // host_orig = (tx, ty) since transform-origin is 0,0.
        // So new tx = anchor.x - hostRect.left + (oldHostRect.left - newHostRect.left)... easier:
        // newAnchorScreenX = hostRect.left - tx + tx_new + preX*clamped
        // We want newAnchorScreenX = anchor.x.
        // Solving: tx_new = anchor.x - hostRect.left - preX*clamped + tx
        viewport.tx = viewport.tx + (hostX - preX * clamped);
        viewport.ty = viewport.ty + (hostY - preY * clamped);
      }
    }
    viewport.scale = clamped;
    applyViewport();
  }
  function panBy(dx: number, dy: number): void {
    viewport.tx += dx;
    viewport.ty += dy;
    applyViewport();
  }
  function resetViewport(): void {
    viewport.scale = 1;
    viewport.tx    = 0;
    viewport.ty    = 0;
    applyViewport();
  }

  // Viewport lock: when true (the default), `fitSvgViewBoxToNodes` is
  // suppressed so style/resize/structural mutations don't slide the canvas
  // around. Users can unlock via the toolbar if they want the viewport to
  // recenter automatically.
  let viewportLocked = true;

  const toolbar = buildToolbar({
    onPick: (tool) => setTool(tool),
    onReset: () => {
      if (!window.confirm('Reset layout? This removes pinned positions and lets mermaid auto-layout the diagram.')) return;
      mutate((ast) => clearPositions(ast));
    },
    onToggleGrid: () => {
      gridSnapEnabled = !gridSnapEnabled;
      toolbar.setGridSnapOn(gridSnapEnabled);
    },
    onToggleViewportLock: () => {
      viewportLocked = !viewportLocked;
      toolbar.setViewportLocked(viewportLocked);
      opts.block.dataset.mbViewportLocked = viewportLocked ? 'true' : 'false';
      if (!viewportLocked) {
        // Unlocking: immediate fit so the diagram recenters now and
        // subsequent rerenders re-fit too.
        fitSvgViewBoxToNodes(opts.previewPane);
      } else {
        // Re-locking: snapshot the current viewBox so future rerenders
        // restore THIS view (the user may have panned/zoomed since the
        // initial lock).
        const svg = opts.previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
        if (svg) lockedViewBox = svg.getAttribute('viewBox');
      }
    },
  });
  const selectionRing = document.createElement('div');
  selectionRing.className = 'mb-vSel mb-hidden';
  // Additional rings for multi-selected nodes — pooled.
  const extraRings: HTMLDivElement[] = [];
  // Resize handles overlay — 8 grippers around the single-selected node.
  // Hidden for multi-select, edge-select, locked nodes, or no selection.
  const resizeOverlay = buildResizeOverlay({
    onResize: (id, sx, sy) => {
      // Live update while dragging — keeps it snappy by skipping the source
      // mutation. The DOM mutation is the source of truth until release.
      const el = findNodeElementById(id, opts.previewPane) as SVGGElement | null;
      if (!el) return;
      applyNodeScale(el, sx, sy);
      // Keep the selection ring + handles glued to the visually-scaled node.
      positionRingAround(selectionRing, el, opts.previewPane);
      resizeOverlay.positionAround(el, opts.previewPane);
      // Edges anchored on this node need to track its new visual extent.
      recomputeEdgesTouching(id, opts.previewPane);
      recomputeLinesTouching(id, opts.previewPane);
    },
    onResizeEnd: (id, sx, sy) => {
      mutate((ast) => { setNodeStyle(ast, id, { scale: [sx, sy] }); });
    },
  });
  const contextTip = buildContextTip({
    onDelete: () => {
      const targetIds = Array.from(selectedIds);
      if (targetIds.length === 0) return;
      mutate((ast) => {
        const locks = getLocks(ast) ?? new Set<string>();
        for (const id of targetIds) {
          if (!locks.has(id)) deleteNode(ast, id);
        }
      });
      setSelected(null);
    },
    onShape: (shape) => {
      if (!selectedId) return;
      mutate((ast) => {
        // Pin current positions first so the shape swap doesn't let mermaid
        // re-flow the whole diagram (some shapes have different default
        // dimensions, which moves every other node).
        pinAllRenderedPositions(ast, opts.previewPane);
        changeNodeShape(ast, selectedId!, shape);
      });
    },
    onToggleLock: () => {
      const targetIds = Array.from(selectedIds);
      if (targetIds.length === 0) return;
      mutate((ast) => {
        for (const id of targetIds) toggleLock(ast, id);
      });
    },
    onStyle: (partial) => {
      const targetIds = Array.from(selectedIds);
      if (targetIds.length === 0) return;
      mutate((ast) => {
        for (const id of targetIds) setNodeStyle(ast, id, partial);
      });
    },
    onDuplicate: () => { duplicateSelected(); },
    onAlign:     (axis) => { alignSelected(axis); },
  });
  const renameOverlay = buildRenameOverlay({
    onCommit: (newLabel) => {
      if (!selectedId) return;
      mutate((ast) => renameNode(ast, selectedId!, newLabel));
      renameOverlay.hide();
    },
    onCancel: () => renameOverlay.hide(),
  });
  const pendingPin = document.createElement('div');
  pendingPin.className = 'mb-vPin mb-hidden';
  pendingPin.textContent = 'Click another node to connect';

  // ── Phase 10: standalone-line context tip ──────────────────────────────
  const lineTip = buildLineContextTip({
    onStyleChange: (partial) => {
      if (!selectedLineId) return;
      const id = selectedLineId;
      mutate((ast) => { updateLineById(ast, id, partial); });
    },
    onDelete: () => {
      if (!selectedLineId) return;
      const id = selectedLineId;
      mutate((ast) => { deleteLineById(ast, id); });
      selectedLineId = null;
      refreshSelectionUI();
    },
  });

  // ── Phase 9: edge context tip ──────────────────────────────────────────
  const edgeTip = buildEdgeContextTip({
    onStyleChange: (partial) => {
      if (!selectedEdgeKey) return;
      const key = selectedEdgeKey;
      mutate((ast) => { setEdgeStyle(ast, key, partial); });
    },
    onFlip: () => {
      if (!selectedEdgeKey) return;
      const key = selectedEdgeKey;
      mutate((ast) => {
        const cur = getEdgeStyle(ast, key) ?? {};
        // Default caps if unset: end=arrow, start=none (mermaid default).
        const start = cur.startCap ?? 'none';
        const end   = cur.endCap   ?? 'arrow';
        setEdgeStyle(ast, key, { startCap: end, endCap: start });
      });
    },
    onDelete: () => {
      if (!selectedEdgeKey) return;
      const key = selectedEdgeKey;
      mutate((ast) => { deleteEdgeByKey(ast, key); });
      selectedEdgeKey = null;
      refreshSelectionUI();
    },
  });

  // ── Phase 4 overlays: connection points + marquee + lock badges ────────
  // Container for the 4 connection points around the primary selected node.
  const connectionLayer = document.createElement('div');
  connectionLayer.className = 'mb-vConn mb-hidden';
  connectionLayer.contentEditable = 'false';
  const connSides: Array<'n' | 'e' | 's' | 'w'> = ['n', 'e', 's', 'w'];
  const connDots: Record<string, HTMLElement> = {};
  for (const side of connSides) {
    const d = document.createElement('div');
    d.className = `mb-vConn-dot mb-vConn-${side}`;
    d.dataset.side = side;
    connDots[side] = d;
    connectionLayer.appendChild(d);
  }

  // Phase 9: hooks appearing over the target node during an edge draft.
  // Visually identical to the source-node hooks; just mirrors the 4 sides
  // onto whichever node is currently being hovered.
  const targetHooksLayer = document.createElement('div');
  targetHooksLayer.className = 'mb-vConn mb-vTargetHooks mb-hidden';
  targetHooksLayer.contentEditable = 'false';
  for (const side of connSides) {
    const d = document.createElement('div');
    d.className = `mb-vConn-dot mb-vConn-${side}`;
    d.dataset.side = side;
    targetHooksLayer.appendChild(d);
  }

  // Marquee selection rect.
  const marqueeEl = document.createElement('div');
  marqueeEl.className = 'mb-vMarquee mb-hidden';
  marqueeEl.contentEditable = 'false';

  // Lock badge pool — left for compatibility; no badges are mounted any more
  // (the Lock button in the toolbar is the only indicator).
  const lockBadges: HTMLElement[] = [];

  // Phase 7: zoom controls in the bottom-right corner.
  const zoomCtrl = document.createElement('div');
  zoomCtrl.className = 'mb-vZoom';
  zoomCtrl.contentEditable = 'false';
  zoomCtrl.innerHTML = `
    <button type="button" class="mb-vZoom-btn" data-act="out" aria-label="Zoom out">−</button>
    <span class="mb-vZoom-readout" aria-live="polite">100%</span>
    <button type="button" class="mb-vZoom-btn" data-act="in"  aria-label="Zoom in">+</button>
    <button type="button" class="mb-vZoom-btn mb-vZoom-fit" data-act="fit" aria-label="Reset view">⌂</button>
  `;
  zoomCtrl.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  zoomCtrl.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    e.preventDefault(); e.stopPropagation();
    if (act === 'in')  setZoom(viewport.scale + 0.1);
    if (act === 'out') setZoom(viewport.scale - 0.1);
    if (act === 'fit') resetViewport();
  });
  const zoomReadout = {
    el: zoomCtrl.querySelector<HTMLElement>('.mb-vZoom-readout'),
    update(scale: number) { if (this.el) this.el.textContent = `${Math.round(scale * 100)}%`; },
  };

  // All overlays live in the preview pane so the NodeView's ignoreMutation
  // hook (which already trusts preview-pane mutations) doesn't fight us.
  opts.previewPane.appendChild(toolbar.el);
  opts.previewPane.appendChild(selectionRing);
  opts.previewPane.appendChild(resizeOverlay.el);
  opts.previewPane.appendChild(connectionLayer);
  opts.previewPane.appendChild(targetHooksLayer);
  opts.previewPane.appendChild(marqueeEl);
  opts.previewPane.appendChild(contextTip.el);
  opts.previewPane.appendChild(edgeTip.el);
  opts.previewPane.appendChild(lineTip.el);
  opts.previewPane.appendChild(renameOverlay.el);
  opts.previewPane.appendChild(pendingPin);
  opts.previewPane.appendChild(zoomCtrl);

  // ── Listeners ───────────────────────────────────────────────────────────
  const onPreviewClick = (e: MouseEvent) => {
    // A successful drag fires mouseup → click on the same node. The click
    // shouldn't be interpreted as a selection toggle / rename, so suppress.
    if (suppressNextClick) {
      suppressNextClick = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    // Clicks on our own overlay chrome (resize handles, edge tip, context
    // tip, etc.) shouldn't fall through to selection/edge hit-testing.
    if ((e.target as Element).closest?.('.mb-vResize, .mb-vCtx, .mb-vEdgeCtx2, .mb-vTb, .mb-vConn, .mb-vZoom, .mb-vLineTip')) {
      return;
    }
    // Same for the line endpoint handles — clicking one shouldn't deselect
    // the line. (A drag that started on a handle already swallows mouseup.)
    if ((e.target as Element).closest?.('circle.mb-vLine-handle')) {
      return;
    }

    const targetNode = findMermaidNode(e.target as Element, opts.previewPane);

    if (activeTool === 'select') {
      // Standalone-line hit test runs before node/edge — lines are decorative
      // overlays that sit on top of everything, so they shouldn't be shadowed
      // by node hit-testing. If e.target is one of our line elements, it
      // wins outright (pointer-events:stroke ensures only the line catches).
      const lineEl = (e.target as Element).closest?.('line.mb-vLine') as SVGLineElement | null;
      if (lineEl && lineEl.dataset.lineId) {
        const lid = lineEl.dataset.lineId;
        // Clear any other selection state.
        setSelected(null);
        if (selectedEdgeKey) {
          selectedEdgeKey = null;
          edgeTip.hide();
          clearAllEdgeSelections(opts.previewPane);
        }
        selectedLineId = lid;
        refreshLineSelectionDom();
        const ast = parseMermaid(opts.getSource());
        const found = getLines(ast).find(l => l.id === lid) ?? null;
        lineTip.setStyle(found);
        lineTip.showAt(e.clientX, e.clientY);
        return;
      }
      if (targetNode) {
        // Clicking a node clears any edge selection.
        if (selectedEdgeKey) { selectedEdgeKey = null; edgeTip.hide(); }
        if (selectedLineId) { selectedLineId = null; lineTip.hide(); refreshLineSelectionDom(); }
        const shift = e.shiftKey;
        // Shift-click toggles in the selection (add/remove). Plain click on
        // the already-selected single node opens rename (unless locked).
        if (shift) {
          setSelected(targetNode.id, 'toggle');
        } else if (selectedIds.size === 1 && targetNode.id === selectedId) {
          const ast = parseMermaid(opts.getSource());
          if (!isLocked(ast, targetNode.id)) {
            openRenameFor(targetNode);
          }
        } else {
          setSelected(targetNode.id, 'replace');
        }
      } else {
        // Maybe the user clicked (near) an edge path? Mermaid edges are 1.5px
        // strokes, so a pixel-perfect click is hard. We accept exact hits via
        // closest() and fall back to a fuzzy distance test.
        const exact = (e.target as Element).closest?.('g.edgePaths > path, path.flowchart-link') as SVGPathElement | null;
        const hitEdgePath = exact ?? findEdgePathNearClick(e.clientX, e.clientY, opts.previewPane);
        if (hitEdgePath) {
          const ep = parseEdgeEndpoints(hitEdgePath);
          if (ep) {
            // Pick the index by looking at order in g.edgePaths.
            const idx = Array.from(opts.previewPane.querySelectorAll<SVGPathElement>('g.edgePaths > path'))
              .filter(p => {
                const o = parseEdgeEndpoints(p);
                return o && o.from === ep.from && o.to === ep.to;
              })
              .indexOf(hitEdgePath);
            const key = edgeKey(ep.from, ep.to, Math.max(0, idx));
            // Clear node selection, mark this edge selected, show its tip.
            setSelected(null);
            selectedEdgeKey = key;
            const ast = parseMermaid(opts.getSource());
            edgeTip.setStyle(getEdgeStyle(ast, key));
            edgeTip.showAt(e.clientX, e.clientY);
            // Highlight the path (path turns blue + arrow heads follow).
            clearAllEdgeSelections(opts.previewPane);
            setEdgePathSelected(hitEdgePath, true);
            return;
          }
        }
        // Empty canvas click — deselect everything.
        if (!e.shiftKey) {
          setSelected(null);
          if (selectedEdgeKey) {
            selectedEdgeKey = null;
            edgeTip.hide();
            clearAllEdgeSelections(opts.previewPane);
          }
          if (selectedLineId) {
            selectedLineId = null;
            lineTip.hide();
            refreshLineSelectionDom();
          }
        }
      }
      return;
    }

    if (activeTool === 'arrow') {
      if (!targetNode) {
        pendingFromId = null;
        pendingPin.classList.add('mb-hidden');
        return;
      }
      if (pendingFromId == null) {
        pendingFromId = targetNode.id;
        pendingPin.classList.remove('mb-hidden');
      } else if (pendingFromId !== targetNode.id) {
        const from = pendingFromId;
        const to   = targetNode.id;
        pendingFromId = null;
        pendingPin.classList.add('mb-hidden');
        mutate((ast) => {
          // Snapshot all rendered node positions before adding the edge so
          // mermaid's auto-layout can't reshuffle the diagram on re-render.
          pinAllRenderedPositions(ast, opts.previewPane);
          addEdge(ast, from, to);
        });
        toolbar.setActive('select');
        activeTool = 'select';
      }
      return;
    }

    // One of the shape tools — drop a node where the user clicked. If the
    // block wasn't pinned yet, snapshot every existing node's auto-layout
    // position first so edges stay coherent once we promote the block to
    // pinned mode (same trick as the first-drag commit).
    const isSticky = activeTool === 'sticky';
    const shapeKey: keyof typeof SHAPE_FOR_TOOL = isSticky ? 'rect' : (activeTool as keyof typeof SHAPE_FOR_TOOL);
    const dropPos = clientToSvgPoint(e.clientX, e.clientY, opts.previewPane);
    mutate((ast) => {
      const added = addNode(ast, SHAPE_FOR_TOOL[shapeKey], isSticky ? 'Note' : undefined);
      // Sticky note styling — yellow fill, dark text, bold.
      if (isSticky) {
        setNodeStyle(ast, added.id, { fill: '#fef6a9', border: '#f0e07a', text: '#1f1f23', bold: true });
      }
      if (dropPos) {
        if (!getPositions(ast)) {
          const snapshot: PositionMap = {};
          const allNodes = opts.previewPane.querySelectorAll<SVGGElement>('g.node');
          for (const n of Array.from(allNodes)) {
            const nid = extractMermaidId(n);
            if (!nid) continue;
            const t = readNodeTranslate(n);
            if (t) snapshot[nid] = [t.x, t.y];
          }
          setAllPositions(ast, snapshot);
        }
        setPosition(ast, added.id, dropPos.x, dropPos.y);
      } else {
        // Fallback when we can't measure the SVG: drop near the centroid of
        // any existing pinned nodes, or let mermaid auto-layout decide.
        const positions = getPositions(ast);
        if (positions) {
          const ids = Object.keys(positions);
          if (ids.length > 0) {
            let sx = 0, sy = 0;
            for (const id of ids) { sx += positions[id][0]; sy += positions[id][1]; }
            const cx = Math.round(sx / ids.length) + 40;
            const cy = Math.round(sy / ids.length) + 40;
            setPosition(ast, added.id, cx, cy);
          }
        }
      }
    });
    toolbar.setActive('select');
    activeTool = 'select';
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // The visual editor owns its keyboard scope by virtue of being active —
    // if our overlays are mounted, we are the relevant editor. We deliberately
    // do NOT gate on document.activeElement, because ProseMirror's
    // contenteditable wrapper is the active element when the user is editing
    // any block, and the block we live in is its descendant rather than its
    // ancestor.
    const meta = e.metaKey || e.ctrlKey;

    if (e.key === 'Escape') {
      if (renameOverlay.isOpen()) { renameOverlay.hide(); return; }
      if (pendingFromId) { pendingFromId = null; pendingPin.classList.add('mb-hidden'); return; }
      // Panic reset: any in-progress drag/draft state that could leave the
      // canvas feeling stuck. Escape rescues without exiting the editor.
      let didReset = false;
      if (edgeDraft) {
        if (edgeDraft.pathEl) edgeDraft.pathEl.remove();
        if (edgeDraft.currentTarget) {
          const prev = findNodeElementById(edgeDraft.currentTarget, opts.previewPane);
          prev?.classList.remove('mb-vEdgeTarget');
        }
        targetHooksLayer.classList.add('mb-hidden');
        edgeDraft = null;
        didReset = true;
      }
      if (lineDraft) {
        if (lineDraft.el) lineDraft.el.remove();
        lineDraft = null;
        didReset = true;
      }
      if (drag)             { drag = null;             didReset = true; }
      if (lineHandleDrag)   { lineHandleDrag = null;   didReset = true; }
      if (lineBodyDrag)     { lineBodyDrag = null;     didReset = true; }
      if (pan)              {
        pan = null;
        opts.previewPane.classList.remove('mb-panning');
        didReset = true;
      }
      if (marquee)          {
        marquee = null;
        marqueeEl.classList.add('mb-hidden');
        didReset = true;
      }
      if (didReset) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      opts.onExit();
      return;
    }

    if (renameOverlay.isOpen()) {
      // Let the overlay's own handlers manage typing.
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Lines have their own selection store; handle before node-delete.
      if (selectedLineId) {
        e.preventDefault();
        const id = selectedLineId;
        mutate((ast) => { deleteLineById(ast, id); });
        selectedLineId = null;
        lineTip.hide();
        refreshLineSelectionDom();
        return;
      }
      if (selectedIds.size === 0) return;
      e.preventDefault();
      const targetIds = Array.from(selectedIds);
      mutate((ast) => {
        const locks = getLocks(ast) ?? new Set<string>();
        for (const id of targetIds) {
          if (!locks.has(id)) deleteNode(ast, id);
        }
      });
      setSelected(null);
      return;
    }

    if (meta && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectedIds.clear();
      const nodes = opts.previewPane.querySelectorAll<SVGGElement>('g.node');
      for (const n of Array.from(nodes)) {
        const id = extractMermaidId(n);
        if (id) selectedIds.add(id);
      }
      syncSelectedId();
      refreshSelectionUI();
      return;
    }

    // Phase 8: Cmd+D duplicate selection.
    if (meta && e.key.toLowerCase() === 'd' && selectedIds.size > 0) {
      e.preventDefault();
      duplicateSelected();
      return;
    }

    // Phase 8: Cmd+C / Cmd+V cross-block clipboard.
    if (meta && e.key.toLowerCase() === 'c' && selectedIds.size > 0) {
      e.preventDefault();
      copySelection().catch(() => undefined);
      return;
    }
    if (meta && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      pasteSelection().catch(() => undefined);
      return;
    }

    if (e.key === 'Enter' && selectedId) {
      e.preventDefault();
      const ast = parseMermaid(opts.getSource());
      if (isLocked(ast, selectedId)) return;
      const nodeEl = findNodeElementById(selectedId, opts.previewPane);
      if (nodeEl) openRenameFor({ id: selectedId, el: nodeEl });
      return;
    }

    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else            undo();
      return;
    }

    // Phase 7: zoom keys.
    if (meta && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(viewport.scale + 0.1); return; }
    if (meta && (e.key === '-' || e.key === '_')) { e.preventDefault(); setZoom(viewport.scale - 0.1); return; }
    if (meta &&  e.key === '0')                   { e.preventDefault(); resetViewport();                 return; }

    // Space — temporary Pan grab cursor (matches Figma / Miro). Prevent
    // the browser default (page scroll) on every event, including repeats,
    // since holding space would otherwise scroll the surrounding page.
    if (e.key === ' ' && !meta && !e.altKey) {
      e.preventDefault();
      if (!e.repeat) {
        spaceHeld = true;
        opts.previewPane.classList.add('mb-pan-temp');
      }
      return;
    }

    // Phase 3: arrow-key nudge of selected node.
    if (selectedId && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const step = e.shiftKey ? 8 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
      nudgeSelected(dx, dy);
      return;
    }

    // Toolbar hotkeys.
    if (!meta && !e.shiftKey && !e.altKey) {
      const t = TOOL_HOTKEYS[e.key.toLowerCase()];
      if (t) {
        e.preventDefault();
        setTool(t);
      }
    }
  };

  // Keyboard nudge — debounce the source mutation so 10 rapid presses are
  // coalesced into one undo step. We update the DOM (transient transform)
  // synchronously for snappy feel.
  let nudgeAcc: { id: string; x: number; y: number } | null = null;
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  function nudgeSelected(dx: number, dy: number): void {
    if (!selectedId) return;
    const nodeEl = findNodeElementById(selectedId, opts.previewPane) as SVGGElement | null;
    if (!nodeEl) return;
    const cur = readNodeTranslate(nodeEl);
    if (!cur) return;
    const nx = cur.x + dx;
    const ny = cur.y + dy;
    nodeEl.setAttribute('transform', `translate(${nx}, ${ny})`);
    recomputeEdgesTouching(selectedId, opts.previewPane);
    recomputeLinesTouching(selectedId, opts.previewPane);
    positionRingAround(selectionRing, nodeEl, opts.previewPane);
    contextTip.showBelow(nodeEl, opts.previewPane);
    nudgeAcc = { id: selectedId, x: nx, y: ny };
    if (nudgeTimer) clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(commitNudge, 200);
  }
  // Phase 8: Power-user actions.
  function duplicateSelected(): void {
    const targetIds = Array.from(selectedIds);
    if (targetIds.length === 0) return;
    mutate((ast) => {
      const positions = getPositions(ast);
      const styles    = getStyles(ast) ?? {};
      const newIds: string[] = [];
      for (const id of targetIds) {
        const orig = collectNodes(ast).get(id);
        const shape: NodeShape = orig?.shape ?? 'rect';
        const label = (orig?.label ?? id) + ' copy';
        const added = addNode(ast, shape, label);
        newIds.push(added.id);
        if (styles[id]) setNodeStyle(ast, added.id, styles[id]);
        if (positions && positions[id]) {
          setPosition(ast, added.id, positions[id][0] + 30, positions[id][1] + 30);
        }
      }
      pendingDuplicateIds = newIds;
    });
  }

  interface ClipboardNode {
    shape:  NodeShape;
    label:  string;
    pos?:   [number, number];
    style?: NodeStyle;
  }

  async function copySelection(): Promise<void> {
    const ast = parseMermaid(opts.getSource());
    const nodesMap = collectNodes(ast);
    const positions = getPositions(ast);
    const styles    = getStyles(ast) ?? {};
    const out: ClipboardNode[] = [];
    for (const id of selectedIds) {
      const n = nodesMap.get(id);
      if (!n) continue;
      out.push({
        shape: n.shape,
        label: n.label,
        pos:   positions?.[id],
        style: styles[id],
      });
    }
    if (out.length === 0) return;
    const payload = `__mb_clipboard__:${JSON.stringify(out)}`;
    try { await navigator.clipboard.writeText(payload); } catch { /* ignore */ }
  }

  async function pasteSelection(): Promise<void> {
    let raw: string;
    try { raw = await navigator.clipboard.readText(); } catch { return; }
    if (!raw.startsWith('__mb_clipboard__:')) return;
    let data: ClipboardNode[];
    try { data = JSON.parse(raw.slice('__mb_clipboard__:'.length)); } catch { return; }
    if (!Array.isArray(data) || data.length === 0) return;
    mutate((ast) => {
      const newIds: string[] = [];
      for (const item of data) {
        const added = addNode(ast, item.shape ?? 'rect', item.label ?? 'Untitled');
        newIds.push(added.id);
        if (item.style) setNodeStyle(ast, added.id, item.style);
        if (item.pos) setPosition(ast, added.id, item.pos[0] + 30, item.pos[1] + 30);
      }
      pendingDuplicateIds = newIds;
    });
  }

  type AlignAxis = 'left' | 'center-h' | 'right' | 'top' | 'middle-v' | 'bottom' | 'distribute-h' | 'distribute-v';
  function alignSelected(axis: AlignAxis): void {
    const ids = Array.from(selectedIds);
    if (ids.length < 2) return;
    mutate((ast) => {
      // Need positions for alignment. Snapshot if missing.
      if (!getPositions(ast)) {
        const snapshot: PositionMap = {};
        const allNodes = opts.previewPane.querySelectorAll<SVGGElement>('g.node');
        for (const n of Array.from(allNodes)) {
          const nid = extractMermaidId(n);
          if (!nid) continue;
          const t = readNodeTranslate(n);
          if (t) snapshot[nid] = [t.x, t.y];
        }
        setAllPositions(ast, snapshot);
      }
      const positions = getPositions(ast)!;
      const halves = new Map<string, { w: number; h: number }>();
      for (const id of ids) {
        const el = findNodeElementById(id, opts.previewPane) as SVGGElement | null;
        halves.set(id, el ? nodeHalfExtent(el) : { w: 30, h: 20 });
      }
      const xs = ids.map(id => positions[id]?.[0] ?? 0);
      const ys = ids.map(id => positions[id]?.[1] ?? 0);
      const lefts   = ids.map(id => (positions[id]?.[0] ?? 0) - (halves.get(id)?.w ?? 30));
      const rights  = ids.map(id => (positions[id]?.[0] ?? 0) + (halves.get(id)?.w ?? 30));
      const tops    = ids.map(id => (positions[id]?.[1] ?? 0) - (halves.get(id)?.h ?? 20));
      const bottoms = ids.map(id => (positions[id]?.[1] ?? 0) + (halves.get(id)?.h ?? 20));

      if (axis === 'left') {
        const target = Math.min(...lefts);
        ids.forEach(id => setPosition(ast, id, target + (halves.get(id)?.w ?? 30), positions[id][1]));
      } else if (axis === 'right') {
        const target = Math.max(...rights);
        ids.forEach(id => setPosition(ast, id, target - (halves.get(id)?.w ?? 30), positions[id][1]));
      } else if (axis === 'center-h') {
        const cx = (Math.min(...lefts) + Math.max(...rights)) / 2;
        ids.forEach(id => setPosition(ast, id, cx, positions[id][1]));
      } else if (axis === 'top') {
        const target = Math.min(...tops);
        ids.forEach(id => setPosition(ast, id, positions[id][0], target + (halves.get(id)?.h ?? 20)));
      } else if (axis === 'bottom') {
        const target = Math.max(...bottoms);
        ids.forEach(id => setPosition(ast, id, positions[id][0], target - (halves.get(id)?.h ?? 20)));
      } else if (axis === 'middle-v') {
        const cy = (Math.min(...tops) + Math.max(...bottoms)) / 2;
        ids.forEach(id => setPosition(ast, id, positions[id][0], cy));
      } else if (axis === 'distribute-h') {
        const sorted = [...ids].sort((a, b) => positions[a][0] - positions[b][0]);
        if (sorted.length < 3) return;
        const minX = positions[sorted[0]][0];
        const maxX = positions[sorted[sorted.length - 1]][0];
        const step = (maxX - minX) / (sorted.length - 1);
        sorted.forEach((id, i) => setPosition(ast, id, minX + i * step, positions[id][1]));
      } else if (axis === 'distribute-v') {
        const sorted = [...ids].sort((a, b) => positions[a][1] - positions[b][1]);
        if (sorted.length < 3) return;
        const minY = positions[sorted[0]][1];
        const maxY = positions[sorted[sorted.length - 1]][1];
        const step = (maxY - minY) / (sorted.length - 1);
        sorted.forEach((id, i) => setPosition(ast, id, positions[id][0], minY + i * step));
      }
      void xs; void ys; // satisfy lint
    });
  }

  function commitNudge(): void {
    if (!nudgeAcc) return;
    const { id, x, y } = nudgeAcc;
    nudgeAcc = null;
    nudgeTimer = null;
    mutate((ast) => {
      if (!getPositions(ast)) {
        const snapshot: PositionMap = {};
        const allNodes = opts.previewPane.querySelectorAll<SVGGElement>('g.node');
        for (const n of Array.from(allNodes)) {
          const nid = extractMermaidId(n);
          if (!nid) continue;
          const t = readNodeTranslate(n);
          if (t) snapshot[nid] = [t.x, t.y];
        }
        setAllPositions(ast, snapshot);
      }
      setPosition(ast, id, x, y);
    });
  }

  const onOutsideClick = (e: MouseEvent) => {
    if (opts.block.contains(e.target as Node)) return;
    if (renameOverlay.isOpen()) renameOverlay.hide();
    opts.onExit();
  };

  opts.previewPane.addEventListener('click', onPreviewClick);
  document.addEventListener('keydown',     onKeyDown,     true);
  document.addEventListener('mousedown',   onOutsideClick, true);

  // Sync Reset Layout enabled state with the current source's pinned-ness.
  toolbar.setResetEnabled(getPositions(parseMermaid(opts.getSource())) !== null);

  // ── Drag-to-reposition ─────────────────────────────────────────────────
  // Mousedown on a node starts a candidate drag. If the cursor moves > 4 px
  // before release, we promote to a real drag and apply transient transforms
  // to the mermaid SVG. On release we commit the new position to the source.
  // Non-moving mousedown→mouseup falls through to the click handler so
  // selection still works.
  interface DragMember {
    id:        string;
    nodeEl:    SVGGElement;
    originX:   number;
    originY:   number;
  }
  interface DragCandidate {
    primary:   DragMember;            // node the cursor actually grabbed
    members:   DragMember[];          // every node moving (1 for single, N for multi)
    startX:    number;
    startY:    number;
    scale:     number;
    moved:     boolean;
  }
  // Mutually-exclusive gestures sharing the mouse:
  //  - drag           : node reposition (single or multi)
  //  - marquee        : drag on empty canvas → multi-select
  //  - edgeDraft      : drag from a connection-point dot → new edge
  //  - lineDraft      : Line tool — drag on canvas → free-form straight line
  //  - lineHandleDrag : drag one endpoint of a selected free line; may snap
  //                     to a node hook on release
  //  - lineBodyDrag   : drag the body of a selected free line to translate
  //                     both endpoints (anchored endpoints get dropped → free)
  let drag: DragCandidate | null = null;
  let marquee: { x1: number; y1: number; x2: number; y2: number; additive: boolean } | null = null;
  let edgeDraft: {
    fromId:        string;
    fromX:         number;     // hook position in SVG coords (the dot the user grabbed)
    fromY:         number;
    pathEl:        SVGPathElement | null;
    currentTarget: string | null;  // id of node currently hovered
  } | null = null;
  // Phase 10: while drawing a free line, this holds the live draft.
  // `el` is a transient SVG <line> we append to the host SVG and update on
  // mousemove. On mouseup we either commit (>4 px) or discard.
  let lineDraft: {
    startX: number; // SVG coords
    startY: number;
    endX:   number;
    endY:   number;
    el:     SVGLineElement | null;
  } | null = null;
  // Phase 11: drag a single endpoint of the selected line. We mutate the
  // live SVG line during the gesture and only persist on mouseup so we
  // don't create one undo step per pixel.
  let lineHandleDrag: {
    lineId:        string;
    end:           'from' | 'to';
    fixedX:        number;       // the OTHER endpoint, in SVG coords
    fixedY:        number;
    moved:         boolean;
    startScreenX:  number;
    startScreenY:  number;
    currentTarget: string | null;  // id of node currently hovered for snap
  } | null = null;
  // Phase 11: drag the line body. Both endpoints translate by the cursor
  // delta. Anchored endpoints get dropped per the Miro-style spec
  // (deliberate body drag detaches anchors).
  let lineBodyDrag: {
    lineId:        string;
    startScreenX:  number;
    startScreenY:  number;
    fromOriginX:   number;        // resolved origin coords at gesture start
    fromOriginY:   number;
    toOriginX:     number;
    toOriginY:     number;
    moved:         boolean;
  } | null = null;
  let pan: { startX: number; startY: number; originTx: number; originTy: number } | null = null;
  let spaceHeld = false;
  let suppressNextClick = false;
  const DRAG_THRESHOLD = 4;

  function onDragMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // left button only

    // Pan tool, space-drag, or middle-click → pan the viewport.
    if (activeTool === 'pan' || spaceHeld) {
      // Don't pan if click landed on our own UI overlays (toolbar, etc.).
      const inOverlay = (e.target as Element).closest('.mb-vTb, .mb-vCtx, .mb-vZoom, .mb-snackbar, .mb-vRename, .mb-vPin, .mb-vResize, .mb-vLineTip');
      if (inOverlay) return;
      pan = {
        startX:   e.clientX,
        startY:   e.clientY,
        originTx: viewport.tx,
        originTy: viewport.ty,
      };
      opts.previewPane.classList.add('mb-panning');
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Line tool — drag anywhere on the canvas to draw a free-form straight
    // line. Ignores nodes/edges entirely (the line is decorative — Miro/Figma
    // line tool behavior).
    if (activeTool === 'line') {
      const inOverlay = (e.target as Element).closest('.mb-vTb, .mb-vCtx, .mb-vZoom, .mb-snackbar, .mb-vRename, .mb-vPin, .mb-vResize, .mb-vLineTip');
      if (inOverlay) return;
      const svgPt = clientToSvgPoint(e.clientX, e.clientY, opts.previewPane);
      if (!svgPt) return;
      lineDraft = { startX: svgPt.x, startY: svgPt.y, endX: svgPt.x, endY: svgPt.y, el: null };
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (activeTool !== 'select') return;

    // Free-line endpoint handle → start endpoint drag. Highest priority on
    // mousedown because the handle visually sits over both the line body and
    // any node it's anchored to.
    const handleEl = (e.target as Element).closest?.('circle.mb-vLine-handle') as SVGCircleElement | null;
    if (handleEl && selectedLineId && handleEl.dataset.lineId === selectedLineId) {
      const ast = parseMermaid(opts.getSource());
      const line = getLines(ast).find(l => l.id === selectedLineId);
      if (line) {
        const end = (handleEl.dataset.end === 'to' ? 'to' : 'from') as 'from' | 'to';
        const fixed = resolveLineEndpoint(end === 'from' ? line.to : line.from, opts.previewPane);
        if (fixed) {
          lineHandleDrag = {
            lineId:        line.id,
            end,
            fixedX:        fixed.x,
            fixedY:        fixed.y,
            moved:         false,
            startScreenX:  e.clientX,
            startScreenY:  e.clientY,
            currentTarget: null,
          };
          opts.previewPane.classList.add('mb-line-drag-active');
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }

    // Free-line BODY → start body drag (translate both endpoints, dropping
    // any anchors). The line itself is the hit target (pointer-events:stroke).
    const lineHitEl = (e.target as Element).closest?.('line.mb-vLine') as SVGLineElement | null;
    if (lineHitEl && lineHitEl.dataset.lineId && selectedLineId === lineHitEl.dataset.lineId) {
      const ast = parseMermaid(opts.getSource());
      const line = getLines(ast).find(l => l.id === selectedLineId);
      if (line) {
        const a = resolveLineEndpoint(line.from, opts.previewPane);
        const b = resolveLineEndpoint(line.to,   opts.previewPane);
        if (a && b) {
          lineBodyDrag = {
            lineId:       line.id,
            startScreenX: e.clientX,
            startScreenY: e.clientY,
            fromOriginX:  a.x,
            fromOriginY:  a.y,
            toOriginX:    b.x,
            toOriginY:    b.y,
            moved:        false,
          };
          opts.previewPane.classList.add('mb-line-drag-active');
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }

    // Connection-point dot → start edge draft. The source hook is the dot
    // the user grabbed (not the node center), so the line emerges cleanly
    // from that side.
    const dotEl = (e.target as Element).closest?.('.mb-vConn-dot') as HTMLElement | null;
    if (dotEl && selectedId) {
      const sourceEl = findNodeElementById(selectedId, opts.previewPane) as SVGGElement | null;
      if (sourceEl) {
        const side = (dotEl.dataset.side ?? 'e') as 'n' | 'e' | 's' | 'w';
        const hook = nodeHookPosition(sourceEl, side);
        if (hook) {
          edgeDraft = { fromId: selectedId, fromX: hook.x, fromY: hook.y, pathEl: null, currentTarget: null };
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }

    const hit = findMermaidNode(e.target as Element, opts.previewPane);
    if (!hit) {
      // Empty canvas mousedown with Select tool → start marquee.
      // (Don't start marquee for clicks inside our own UI overlays — those have
      //  their own pointer handlers and shouldn't trigger selection drag.)
      const inOverlay = (e.target as Element).closest('.mb-vTb, .mb-vCtx, .mb-vConn, .mb-vResize, .mb-snackbar, .mb-vRename, .mb-vPin, .mb-vLineTip, .mb-vEdgeCtx2, .mb-svg-host svg');
      if (!inOverlay) {
        marquee = { x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY, additive: e.shiftKey };
      }
      return;
    }
    const nodeEl = hit.el as SVGGElement;
    const origin = readNodeTranslate(nodeEl);
    if (!origin) return;
    const svg = nodeEl.ownerSVGElement;
    if (!svg) return;

    // Decide single vs multi drag. If the hit node is part of an existing
    // multi-selection, all selected (non-locked) nodes move together. If
    // not, fall back to single-node drag (selection follows on mouseup).
    const ast = parseMermaid(opts.getSource());
    const locks = getLocks(ast) ?? new Set<string>();
    const partOfSelection = selectedIds.has(hit.id) && selectedIds.size > 1;
    const memberIds: string[] = partOfSelection ? Array.from(selectedIds) : [hit.id];
    const members: DragMember[] = [];
    for (const id of memberIds) {
      if (locks.has(id)) continue;
      const el = findNodeElementById(id, opts.previewPane) as SVGGElement | null;
      if (!el) continue;
      const o = readNodeTranslate(el);
      if (!o) continue;
      members.push({ id, nodeEl: el, originX: o.x, originY: o.y });
    }
    if (members.length === 0) return; // every candidate is locked

    const primary = members.find(m => m.id === hit.id) ?? members[0];
    drag = {
      primary,
      members,
      startX:  e.clientX,
      startY:  e.clientY,
      scale:   svgUnitsPerPixel(svg),
      moved:   false,
    };
  }

  function onDragMouseMove(e: MouseEvent): void {
    if (pan) {
      viewport.tx = pan.originTx + (e.clientX - pan.startX);
      viewport.ty = pan.originTy + (e.clientY - pan.startY);
      applyViewport();
      return;
    }
    // Line draft: extend a transient <line> from the click origin to the
    // current cursor position. We materialize the element lazily so a click
    // that never moves stays purely click-vs-drag in mouseup.
    if (lineDraft) {
      const svgPt = clientToSvgPoint(e.clientX, e.clientY, opts.previewPane);
      if (!svgPt) return;
      lineDraft.endX = svgPt.x;
      lineDraft.endY = svgPt.y;
      if (!lineDraft.el) {
        const svg = opts.previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
        if (!svg) return;
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        el.setAttribute('class', 'mb-vLineDraft');
        el.setAttribute('stroke', '#6366f1');
        el.setAttribute('stroke-width', '1.5');
        el.setAttribute('stroke-dasharray', '4 3');
        el.setAttribute('pointer-events', 'none');
        svg.appendChild(el);
        lineDraft.el = el;
      }
      lineDraft.el.setAttribute('x1', String(lineDraft.startX));
      lineDraft.el.setAttribute('y1', String(lineDraft.startY));
      lineDraft.el.setAttribute('x2', String(lineDraft.endX));
      lineDraft.el.setAttribute('y2', String(lineDraft.endY));
      return;
    }
    // Line endpoint drag — move one end of the selected line. Snap to a
    // node hook when hovering, otherwise free-flow under the cursor.
    if (lineHandleDrag) {
      const svgPt = clientToSvgPoint(e.clientX, e.clientY, opts.previewPane);
      if (!svgPt) return;
      const dxScreen = e.clientX - lineHandleDrag.startScreenX;
      const dyScreen = e.clientY - lineHandleDrag.startScreenY;
      if (!lineHandleDrag.moved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD) return;
      lineHandleDrag.moved = true;

      // Hover detection for snap target. elementFromPoint is more reliable
      // than e.target — during a drag, the target gets stuck on the handle.
      const hit       = elementAtPoint(e.clientX, e.clientY, opts.previewPane);
      const hitTarget = findMermaidNode(hit, opts.previewPane);
      const newTargetId = hitTarget?.id ?? null;

      // Update highlight class + the floating hook indicators on the target.
      if (newTargetId !== lineHandleDrag.currentTarget) {
        if (lineHandleDrag.currentTarget) {
          const prev = findNodeElementById(lineHandleDrag.currentTarget, opts.previewPane);
          prev?.classList.remove('mb-vEdgeTarget');
        }
        if (newTargetId) {
          const next = findNodeElementById(newTargetId, opts.previewPane);
          next?.classList.add('mb-vEdgeTarget');
        }
        lineHandleDrag.currentTarget = newTargetId;
      }
      if (newTargetId) {
        const targetEl = findNodeElementById(newTargetId, opts.previewPane);
        if (targetEl) {
          const r     = targetEl.getBoundingClientRect();
          const hRect = opts.previewPane.getBoundingClientRect();
          targetHooksLayer.style.left   = `${r.left - hRect.left}px`;
          targetHooksLayer.style.top    = `${r.top  - hRect.top}px`;
          targetHooksLayer.style.width  = `${r.width}px`;
          targetHooksLayer.style.height = `${r.height}px`;
          targetHooksLayer.classList.remove('mb-hidden');
        }
      } else {
        targetHooksLayer.classList.add('mb-hidden');
      }

      // Compute the live endpoint: snap to closest hook if hovering a node.
      let endPoint = svgPt;
      if (newTargetId) {
        const targetEl = findNodeElementById(newTargetId, opts.previewPane) as SVGGElement | null;
        const hook = targetEl
          ? closestHook(targetEl, { x: lineHandleDrag.fixedX, y: lineHandleDrag.fixedY })
          : null;
        if (hook) endPoint = hook;
      }

      // Mutate the visible <line> + handle directly — no AST round-trip while
      // dragging, so we don't spam the undo stack or re-render mermaid.
      const lineEl = opts.previewPane.querySelector<SVGLineElement>(
        `g.mb-vLines > line.mb-vLine[data-line-id="${lineHandleDrag.lineId}"]`);
      if (lineEl) {
        const ax = lineHandleDrag.end === 'from' ? endPoint.x : lineHandleDrag.fixedX;
        const ay = lineHandleDrag.end === 'from' ? endPoint.y : lineHandleDrag.fixedY;
        const bx = lineHandleDrag.end === 'from' ? lineHandleDrag.fixedX : endPoint.x;
        const by = lineHandleDrag.end === 'from' ? lineHandleDrag.fixedY : endPoint.y;
        lineEl.setAttribute('x1', String(ax));
        lineEl.setAttribute('y1', String(ay));
        lineEl.setAttribute('x2', String(bx));
        lineEl.setAttribute('y2', String(by));
        refreshLineHandles();
      }
      return;
    }

    // Line body drag — translate both endpoints by the cursor delta. Mutate
    // the live <line> in place; the AST is updated on mouseup.
    if (lineBodyDrag) {
      const dxScreen = e.clientX - lineBodyDrag.startScreenX;
      const dyScreen = e.clientY - lineBodyDrag.startScreenY;
      if (!lineBodyDrag.moved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD) return;
      lineBodyDrag.moved = true;
      const svg = opts.previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
      if (!svg) return;
      const unit = svgUnitsPerPixel(svg);
      const dxSvg = dxScreen * unit;
      const dySvg = dyScreen * unit;
      const lineEl = opts.previewPane.querySelector<SVGLineElement>(
        `g.mb-vLines > line.mb-vLine[data-line-id="${lineBodyDrag.lineId}"]`);
      if (lineEl) {
        lineEl.setAttribute('x1', String(lineBodyDrag.fromOriginX + dxSvg));
        lineEl.setAttribute('y1', String(lineBodyDrag.fromOriginY + dySvg));
        lineEl.setAttribute('x2', String(lineBodyDrag.toOriginX   + dxSvg));
        lineEl.setAttribute('y2', String(lineBodyDrag.toOriginY   + dySvg));
        refreshLineHandles();
      }
      return;
    }

    // Edge draft path: while dragging, hover-detect a target node, highlight it,
    // and snap the bezier endpoint to the target's closest hook.
    if (edgeDraft) {
      const svgPt = clientToSvgPoint(e.clientX, e.clientY, opts.previewPane);
      if (!svgPt) return;
      const svg = opts.previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
      if (!svg) return;
      if (!edgeDraft.pathEl) {
        edgeDraft.pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        edgeDraft.pathEl.setAttribute('class', 'mb-vEdgeDraft');
        edgeDraft.pathEl.setAttribute('fill', 'none');
        edgeDraft.pathEl.setAttribute('stroke', '#6366f1');
        edgeDraft.pathEl.setAttribute('stroke-width', '1.5');
        edgeDraft.pathEl.setAttribute('stroke-dasharray', '4 3');
        edgeDraft.pathEl.setAttribute('pointer-events', 'none');
        svg.appendChild(edgeDraft.pathEl);
      }

      // Hit-test under the cursor for a target node (skip the source).
      // elementFromPoint is more reliable than e.target during drag, which
      // can sometimes still be the dot or path.
      const hit = elementAtPoint(e.clientX, e.clientY, opts.previewPane);
      const hitTarget = findMermaidNode(hit, opts.previewPane);
      const newTargetId = (hitTarget && hitTarget.id !== edgeDraft.fromId) ? hitTarget.id : null;

      // Update highlight class on target nodes + show the 4 hooks over them.
      if (newTargetId !== edgeDraft.currentTarget) {
        if (edgeDraft.currentTarget) {
          const prev = findNodeElementById(edgeDraft.currentTarget, opts.previewPane);
          prev?.classList.remove('mb-vEdgeTarget');
        }
        if (newTargetId) {
          const next = findNodeElementById(newTargetId, opts.previewPane);
          next?.classList.add('mb-vEdgeTarget');
        }
        edgeDraft.currentTarget = newTargetId;
      }
      // Reposition the target-hooks overlay so the user can see the snap points.
      if (newTargetId) {
        const targetEl = findNodeElementById(newTargetId, opts.previewPane);
        if (targetEl) {
          const r = targetEl.getBoundingClientRect();
          const hRect = opts.previewPane.getBoundingClientRect();
          targetHooksLayer.style.left   = `${r.left - hRect.left}px`;
          targetHooksLayer.style.top    = `${r.top  - hRect.top}px`;
          targetHooksLayer.style.width  = `${r.width}px`;
          targetHooksLayer.style.height = `${r.height}px`;
          targetHooksLayer.classList.remove('mb-hidden');
        }
      } else {
        targetHooksLayer.classList.add('mb-hidden');
      }

      // Compute endpoint: snap to target's nearest hook if we're over one,
      // else free-flowing under the cursor.
      let endPoint: { x: number; y: number };
      if (newTargetId) {
        const targetEl = findNodeElementById(newTargetId, opts.previewPane) as SVGGElement | null;
        const hook = targetEl ? closestHook(targetEl, { x: edgeDraft.fromX, y: edgeDraft.fromY }) : null;
        endPoint = hook ?? svgPt;
      } else {
        endPoint = svgPt;
      }

      edgeDraft.pathEl.setAttribute('d', bezierPath({ x: edgeDraft.fromX, y: edgeDraft.fromY }, endPoint));
      return;
    }

    if (marquee) {
      marquee.x2 = e.clientX;
      marquee.y2 = e.clientY;
      paintMarquee();
      applyMarqueeSelection();
      return;
    }

    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    opts.previewPane.classList.add('mb-dragging');

    const isMulti = drag.members.length > 1;
    // For multi-drag we skip alignment guides — they get noisy fast.
    let snapDxSvg = dx * drag.scale;
    let snapDySvg = dy * drag.scale;
    if (!isMulti) {
      const newSvgX = drag.primary.originX + snapDxSvg;
      const newSvgY = drag.primary.originY + snapDySvg;
      const otherNodes = collectOtherNodes(drag.primary.id, opts.previewPane);
      const dragHalf = nodeHalfExtent(drag.primary.nodeEl);
      const snap = computeAlignmentSnap({ x: newSvgX, y: newSvgY }, dragHalf, otherNodes);
      let finalX = snap.snapX !== null ? snap.snapX : newSvgX;
      let finalY = snap.snapY !== null ? snap.snapY : newSvgY;
      if (snap.guides.length > 0) {
        guideLayer.show(snap.guides);
      } else if (gridSnapEnabled) {
        const GRID = 8;
        finalX = Math.round(finalX / GRID) * GRID;
        finalY = Math.round(finalY / GRID) * GRID;
        guideLayer.hide();
      } else {
        guideLayer.hide();
      }
      snapDxSvg = finalX - drag.primary.originX;
      snapDySvg = finalY - drag.primary.originY;
    } else {
      guideLayer.hide();
    }

    // Apply the same delta to every member.
    for (const m of drag.members) {
      const nx = m.originX + snapDxSvg;
      const ny = m.originY + snapDySvg;
      m.nodeEl.setAttribute('transform', `translate(${nx}, ${ny})`);
      recomputeEdgesTouching(m.id, opts.previewPane);
      recomputeLinesTouching(m.id, opts.previewPane);
    }
    // Refresh selection rings + tip to follow the moved nodes.
    refreshSelectionUI();
  }

  function onDragMouseUp(e: MouseEvent): void {
    // Wrap the whole body so an unexpected error in any branch can't leave
    // a draft / drag state dangling. If something throws, we still flush all
    // in-progress state and remove our drag-active classes.
    try { onDragMouseUpInner(e); }
    catch (err) {
      console.error('[mermaid] mouseup handler threw, recovering:', err);
      edgeDraft = null;
      lineDraft = null;
      drag = null;
      lineHandleDrag = null;
      lineBodyDrag = null;
      pan = null;
      marquee = null;
      opts.previewPane.classList.remove('mb-panning', 'mb-line-drag-active');
      targetHooksLayer.classList.add('mb-hidden');
      marqueeEl.classList.add('mb-hidden');
    }
  }
  function onDragMouseUpInner(e: MouseEvent): void {
    if (pan) {
      pan = null;
      opts.previewPane.classList.remove('mb-panning');
      return;
    }
    // Line draft → if the cursor moved enough to constitute a deliberate
    // drag (>4 px in screen units), commit. Otherwise it was a stray click,
    // so we drop it without mutating the source.
    if (lineDraft) {
      const draft = lineDraft;
      lineDraft = null;
      if (draft.el) draft.el.remove();
      // Measure the screen-space drag length. Going via SVG coords is fragile
      // when the diagram is zoomed; we re-derive in screen px from the start
      // SVG point's CTM mapping using the live SVG.
      const svg = opts.previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
      if (!svg) return;
      const dxSvg = draft.endX - draft.startX;
      const dySvg = draft.endY - draft.startY;
      // Convert SVG-space delta to screen-space using one SVG unit's screen size.
      const ctm = svg.getScreenCTM();
      const unit = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
      const screenLen = Math.hypot(dxSvg, dySvg) * unit;
      if (screenLen < DRAG_THRESHOLD) {
        e.stopPropagation();
        return;
      }
      suppressNextClick = true;
      mutate((ast) => {
        const created = addLine(ast, {
          from: { kind: 'free', x: draft.startX, y: draft.startY },
          to:   { kind: 'free', x: draft.endX,   y: draft.endY   },
          color:     '#1f2937',
          thickness: 1.5,
          type:      'solid',
        });
        // Select the new line so the style tip pops up immediately.
        pendingNewLineId = created.id;
      });
      // After mutate → re-render fires; we'll auto-select pendingNewLineId there.
      // Snap back to select tool so users don't accidentally redraw.
      toolbar.setActive('select');
      activeTool = 'select';
      e.stopPropagation();
      return;
    }
    // Line endpoint drag → persist. If the endpoint landed over a node,
    // anchor to its nearest hook. Otherwise stay free with the cursor
    // coords. A drag with no movement just falls through as a click on the
    // handle (no-op).
    if (lineHandleDrag) {
      const gesture = lineHandleDrag;
      lineHandleDrag = null;
      opts.previewPane.classList.remove('mb-line-drag-active');
      // Clear hover indicator regardless of outcome.
      targetHooksLayer.classList.add('mb-hidden');
      if (gesture.currentTarget) {
        const prev = findNodeElementById(gesture.currentTarget, opts.previewPane);
        prev?.classList.remove('mb-vEdgeTarget');
      }
      if (!gesture.moved) return;
      suppressNextClick = true;
      // Re-derive the target under the cursor at mouseup as a belt-and-braces
      // check — elementFromPoint can lag during fast drags.
      const finalTargetId = gesture.currentTarget
        ?? findMermaidNode(elementAtPoint(e.clientX, e.clientY, opts.previewPane), opts.previewPane)?.id
        ?? null;
      const svgPt = clientToSvgPoint(e.clientX, e.clientY, opts.previewPane);
      mutate((ast) => {
        const line = getLines(ast).find(l => l.id === gesture.lineId);
        if (!line) return;
        let newEndpoint: LineEndpoint;
        if (finalTargetId) {
          // Snap to the closest hook of the target.
          const targetEl = findNodeElementById(finalTargetId, opts.previewPane) as SVGGElement | null;
          let side: 'n' | 'e' | 's' | 'w' = 'e';
          let snapped: { x: number; y: number } | null = null;
          if (targetEl) {
            const sides: Array<'n' | 'e' | 's' | 'w'> = ['n', 'e', 's', 'w'];
            let bestD = Infinity;
            for (const s of sides) {
              const h = nodeHookPosition(targetEl, s);
              if (!h) continue;
              const d = Math.hypot(h.x - gesture.fixedX, h.y - gesture.fixedY);
              if (d < bestD) { bestD = d; side = s; snapped = h; }
            }
          }
          newEndpoint = {
            kind: 'node',
            id:   finalTargetId,
            side,
            ...(snapped ? { lastX: snapped.x, lastY: snapped.y } : {}),
          };
        } else {
          newEndpoint = {
            kind: 'free',
            x: svgPt?.x ?? gesture.fixedX,
            y: svgPt?.y ?? gesture.fixedY,
          };
        }
        const partial = gesture.end === 'from' ? { from: newEndpoint } : { to: newEndpoint };
        updateLineById(ast, gesture.lineId, partial);
      });
      e.stopPropagation();
      return;
    }

    // Line body drag → persist. Both endpoints become FREE at their new
    // positions (Miro behavior: a deliberate body drag detaches anchors).
    if (lineBodyDrag) {
      const gesture = lineBodyDrag;
      lineBodyDrag = null;
      opts.previewPane.classList.remove('mb-line-drag-active');
      if (!gesture.moved) return;
      suppressNextClick = true;
      const svg = opts.previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
      const unit = svg ? svgUnitsPerPixel(svg) : 1;
      const dxSvg = (e.clientX - gesture.startScreenX) * unit;
      const dySvg = (e.clientY - gesture.startScreenY) * unit;
      mutate((ast) => {
        updateLineById(ast, gesture.lineId, {
          from: { kind: 'free', x: gesture.fromOriginX + dxSvg, y: gesture.fromOriginY + dySvg },
          to:   { kind: 'free', x: gesture.toOriginX   + dxSvg, y: gesture.toOriginY   + dySvg },
        });
      });
      e.stopPropagation();
      return;
    }

    // Edge draft → commit if landed on a node. Prefer the tracked target
    // (set during mousemove via elementFromPoint) since e.target during
    // mouseup can be our draft path or another overlay.
    if (edgeDraft) {
      // Hide target hooks + clear hover highlight regardless of outcome.
      targetHooksLayer.classList.add('mb-hidden');
      if (edgeDraft.currentTarget) {
        const prev = findNodeElementById(edgeDraft.currentTarget, opts.previewPane);
        prev?.classList.remove('mb-vEdgeTarget');
      }
      const targetId = edgeDraft.currentTarget
        ?? findMermaidNode(elementAtPoint(e.clientX, e.clientY, opts.previewPane), opts.previewPane)?.id
        ?? null;
      if (targetId && targetId !== edgeDraft.fromId) {
        const fromId = edgeDraft.fromId;
        const toId   = targetId;
        mutate((ast) => {
          // Same as the arrow-tool path: pin everything first so mermaid
          // can't re-layout the diagram when the new edge changes structure.
          pinAllRenderedPositions(ast, opts.previewPane);
          addEdge(ast, fromId, toId);
        });
      }
      if (edgeDraft.pathEl) edgeDraft.pathEl.remove();
      edgeDraft = null;
      e.stopPropagation();
      return;
    }

    if (marquee) {
      // Final selection set already applied during mousemove.
      marquee = null;
      marqueeEl.classList.add('mb-hidden');
      return;
    }

    if (!drag) return;
    const wasDrag = drag.moved;
    const movers = drag.members;
    drag = null;
    opts.previewPane.classList.remove('mb-dragging');
    guideLayer.hide();
    if (!wasDrag) return;
    suppressNextClick = true;
    // Commit. If the block had no positions yet, snapshot every node's
    // current auto-layout position first so edges stay coherent.
    mutate((ast) => {
      if (!getPositions(ast)) {
        const snapshot: PositionMap = {};
        const allNodes = opts.previewPane.querySelectorAll<SVGGElement>('g.node');
        for (const n of Array.from(allNodes)) {
          const nodeId = extractMermaidId(n);
          if (!nodeId) continue;
          const t = readNodeTranslate(n);
          if (t) snapshot[nodeId] = [t.x, t.y];
        }
        setAllPositions(ast, snapshot);
      }
      for (const m of movers) {
        const finalPos = readNodeTranslate(m.nodeEl);
        if (finalPos) setPosition(ast, m.id, finalPos.x, finalPos.y);
      }
    });
  }

  function paintMarquee(): void {
    if (!marquee) return;
    const host = opts.previewPane.getBoundingClientRect();
    const x = Math.min(marquee.x1, marquee.x2) - host.left;
    const y = Math.min(marquee.y1, marquee.y2) - host.top;
    const w = Math.abs(marquee.x2 - marquee.x1);
    const h = Math.abs(marquee.y2 - marquee.y1);
    marqueeEl.style.left   = `${x}px`;
    marqueeEl.style.top    = `${y}px`;
    marqueeEl.style.width  = `${w}px`;
    marqueeEl.style.height = `${h}px`;
    marqueeEl.classList.remove('mb-hidden');
  }
  function applyMarqueeSelection(): void {
    if (!marquee) return;
    const x1 = Math.min(marquee.x1, marquee.x2);
    const y1 = Math.min(marquee.y1, marquee.y2);
    const x2 = Math.max(marquee.x1, marquee.x2);
    const y2 = Math.max(marquee.y1, marquee.y2);

    const base = marquee.additive ? new Set(selectedIds) : new Set<string>();
    const nodes = opts.previewPane.querySelectorAll<SVGGElement>('g.node');
    for (const n of Array.from(nodes)) {
      const id = extractMermaidId(n);
      if (!id) continue;
      const r = n.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top  + r.height / 2;
      if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) {
        base.add(id);
      }
    }
    selectedIds.clear();
    for (const id of base) selectedIds.add(id);
    syncSelectedId();
    refreshSelectionUI();
  }

  opts.previewPane.addEventListener('mousedown', onDragMouseDown, true);
  document.addEventListener('mousemove', onDragMouseMove, true);
  document.addEventListener('mouseup',   onDragMouseUp,   true);

  // Phase 7: wheel zoom (Ctrl/Cmd + wheel) and keyup for space-release.
  function onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    if (!opts.previewPane.contains(e.target as Node)) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom(viewport.scale + factor, { x: e.clientX, y: e.clientY });
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ' && spaceHeld) {
      spaceHeld = false;
      opts.previewPane.classList.remove('mb-pan-temp');
    }
  }
  opts.previewPane.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('keyup', onKeyUp, true);

  // ── Tool / selection / rename / mutation plumbing ────────────────────────
  function setTool(tool: Tool): void {
    activeTool = tool;
    toolbar.setActive(tool);
    // Drive cursor styling off a class on the previewPane. The Line tool
    // gets a crosshair so users know they can draw anywhere.
    opts.previewPane.classList.toggle('mb-tool-line', tool === 'line');
    if (tool !== 'arrow') {
      pendingFromId = null;
      pendingPin.classList.add('mb-hidden');
    }
    // Switching to a non-Select tool clears selection so users don't think
    // they're operating on the selected node.
    if (tool !== 'select') {
      setSelected(null);
      // Same idea for line selection — it'd be confusing if the line stayed
      // selected while a different tool is active.
      if (selectedLineId) {
        selectedLineId = null;
        lineTip.hide();
        refreshLineSelectionDom();
      }
    }
  }

  type SelectMode = 'replace' | 'add' | 'toggle';

  function setSelected(id: string | null, mode: SelectMode = 'replace'): void {
    renameOverlay.hide();
    if (id == null) {
      selectedIds.clear();
    } else if (mode === 'replace') {
      selectedIds.clear();
      selectedIds.add(id);
    } else if (mode === 'add') {
      selectedIds.add(id);
    } else if (mode === 'toggle') {
      if (selectedIds.has(id)) selectedIds.delete(id);
      else                     selectedIds.add(id);
    }
    syncSelectedId();
    refreshSelectionUI();
  }

  // Render selection rings + context tip from the canonical `selectedIds`.
  function refreshSelectionUI(): void {
    const ids = Array.from(selectedIds);

    // Primary ring uses the first selected node; extras come from the pool.
    if (ids.length === 0) {
      selectionRing.classList.add('mb-hidden');
      for (const r of extraRings) r.classList.add('mb-hidden');
      contextTip.hide();
      hideConnectionPoints();
      resizeOverlay.hide();
      return;
    }

    const pivotEl = findNodeElementById(ids[0], opts.previewPane);
    if (!pivotEl) {
      selectionRing.classList.add('mb-hidden');
      contextTip.hide();
      hideConnectionPoints();
      resizeOverlay.hide();
      return;
    }
    positionRingAround(selectionRing, pivotEl, opts.previewPane);
    selectionRing.classList.remove('mb-hidden');

    // Resize the extra-ring pool to match the rest of the selection.
    const needed = ids.length - 1;
    while (extraRings.length < needed) {
      const r = document.createElement('div');
      r.className = 'mb-vSel mb-hidden';
      opts.previewPane.appendChild(r);
      extraRings.push(r);
    }
    for (let i = 0; i < extraRings.length; i++) {
      const id = ids[i + 1];
      if (!id) { extraRings[i].classList.add('mb-hidden'); continue; }
      const el = findNodeElementById(id, opts.previewPane);
      if (!el) { extraRings[i].classList.add('mb-hidden'); continue; }
      positionRingAround(extraRings[i], el, opts.previewPane);
      extraRings[i].classList.remove('mb-hidden');
    }

    // Context tip: single vs multi.
    if (ids.length === 1) {
      contextTip.showBelow(pivotEl, opts.previewPane);
      const ast = parseMermaid(opts.getSource());
      const locked = isLocked(ast, ids[0]);
      contextTip.setLocked(locked);
      contextTip.setStyle(getNodeStyle(ast, ids[0]));
      const nodeDecl = collectNodes(ast).get(ids[0]);
      if (nodeDecl) contextTip.setShape(nodeDecl.shape);
      showConnectionPoints(pivotEl);
      // Resize handles: only when unlocked. Seed with the persisted scale so
      // dragging continues from where the last edit left off.
      if (locked) {
        resizeOverlay.hide();
      } else {
        const persisted = getNodeStyle(ast, ids[0])?.scale ?? [1, 1];
        resizeOverlay.attach(ids[0], pivotEl, opts.previewPane, persisted);
      }
    } else {
      contextTip.showMulti(ids.length, opts.previewPane, pivotEl);
      contextTip.setStyle(null);
      hideConnectionPoints();
      resizeOverlay.hide();
    }

    // Padlock badges over locked selected nodes.
    refreshLockBadges();
  }

  function refreshLineSelectionDom(): void {
    const all = opts.previewPane.querySelectorAll<SVGLineElement>('g.mb-vLines > line.mb-vLine');
    for (const el of Array.from(all)) {
      const isSel = !!selectedLineId && el.dataset.lineId === selectedLineId;
      el.classList.toggle('mb-vLine-selected', isSel);
    }
    refreshLineHandles();
  }

  /** Mount / refresh the two endpoint handles for the currently-selected
   *  line. Handles are <circle> elements that sit in their own SVG group
   *  so we can paint them above the line. */
  function refreshLineHandles(): void {
    const svg = opts.previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
    if (!svg) return;
    let group = svg.querySelector<SVGGElement>('g.mb-vLineHandles');
    if (!selectedLineId) {
      if (group) group.remove();
      return;
    }
    const lineEl = svg.querySelector<SVGLineElement>(`g.mb-vLines > line.mb-vLine[data-line-id="${selectedLineId}"]`);
    if (!lineEl) {
      if (group) group.remove();
      return;
    }
    if (!group) {
      group = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
      group.setAttribute('class', 'mb-vLineHandles');
      svg.appendChild(group);
    } else {
      // Move to the end so handles paint above lines + nodes, and clear.
      svg.appendChild(group);
      while (group.firstChild) group.removeChild(group.firstChild);
    }
    const x1 = parseFloat(lineEl.getAttribute('x1') ?? '0');
    const y1 = parseFloat(lineEl.getAttribute('y1') ?? '0');
    const x2 = parseFloat(lineEl.getAttribute('x2') ?? '0');
    const y2 = parseFloat(lineEl.getAttribute('y2') ?? '0');
    // Convert "5 px radius in screen space" to SVG units so the handle stays
    // the same visual size at any zoom level.
    const unit = svgUnitsPerPixel(svg);
    const r = 5 * unit;
    for (const end of (['from', 'to'] as const)) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'mb-vLine-handle');
      c.dataset.lineId = selectedLineId;
      c.dataset.end    = end;
      c.setAttribute('cx', String(end === 'from' ? x1 : x2));
      c.setAttribute('cy', String(end === 'from' ? y1 : y2));
      c.setAttribute('r',  String(r));
      group.appendChild(c);
    }
  }

  function showConnectionPoints(nodeEl: Element): void {
    const r = nodeEl.getBoundingClientRect();
    const h = opts.previewPane.getBoundingClientRect();
    const left = r.left - h.left;
    const top  = r.top  - h.top;
    connectionLayer.style.left   = `${left}px`;
    connectionLayer.style.top    = `${top}px`;
    connectionLayer.style.width  = `${r.width}px`;
    connectionLayer.style.height = `${r.height}px`;
    connectionLayer.classList.remove('mb-hidden');
  }
  function hideConnectionPoints(): void {
    connectionLayer.classList.add('mb-hidden');
  }

  function refreshLockBadges(): void {
    // Lock badges removed by request — the toolbar's Lock button (with the
    // `mb-vCtx-lock-on` class when active) is the single source of truth
    // for lock state. Keep the helper as a no-op so existing call sites
    // don't need to change.
  }

  function openRenameFor(target: { id: string; el: Element }): void {
    const nodes = collectNodes(parseMermaid(opts.getSource()));
    const current = nodes.get(target.id);
    renameOverlay.open(current?.label ?? target.id, target.el as HTMLElement, opts.previewPane);
  }

  function mutate(fn: (ast: Ast) => void): void {
    const before = parseMermaid(opts.getSource());
    undoStack.push(cloneAst(before));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    const next = cloneAst(before);
    fn(next);
    // Refresh `lastX/lastY` for any anchored line endpoint whose target node
    // currently exists in the DOM. The live DOM reflects the pre-rerender
    // state — which still has any node the mutation just deleted from the
    // AST. That gives us one last chance to snapshot the position so the
    // line keeps something to fall back on.
    refreshAnchoredLineFallbacks(next, opts.previewPane);
    opts.onSourceChange(serializeMermaid(next));
  }

  function undo(): void {
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(parseMermaid(opts.getSource()));
    opts.onSourceChange(serializeMermaid(prev));
    setSelected(null);
  }

  function redo(): void {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(parseMermaid(opts.getSource()));
    opts.onSourceChange(serializeMermaid(next));
    setSelected(null);
  }

  // ── Cleanup + rebind ────────────────────────────────────────────────────
  // Initial layout deferred one animation frame so the .mb-visual-active
  // class added at the top of createVisualEditor has applied to layout —
  // otherwise preview.getBoundingClientRect() inside fitSvgViewBoxToNodes
  // returns stale (often zero) dimensions and the captured lockedViewBox
  // is wrong forever. A `destroyed` flag guards against a torn-down block
  // (rapid Esc within ~16ms).
  let destroyed = false;
  let lockedViewBox: string | null = null;
  requestAnimationFrame(() => {
    if (destroyed) return;
    fitSvgViewBoxToNodes(opts.previewPane);
    installDotGrid(opts.previewPane);
    const initialSvg = opts.previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
    if (initialSvg) lockedViewBox = initialSvg.getAttribute('viewBox');
    opts.block.dataset.mbViewportLocked = 'true';
    toolbar.setViewportLocked(true);
  });

  function restoreLockedViewBox(): void {
    if (!viewportLocked || !lockedViewBox) return;
    const svg = opts.previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
    if (!svg) return;
    if (svg.getAttribute('viewBox') !== lockedViewBox) {
      svg.setAttribute('viewBox', lockedViewBox);
    }
    svg.style.width  = '100%';
    svg.style.height = '100%';
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }

  return {
    onMermaidRerender(): void {
      // mermaidBlock already called applyPositionsOverlay for us before
      // this. We just refresh toolbar state and re-bind ring/tip to the
      // (possibly newly-positioned) selected nodes.
      // When locked: stamp back the original viewBox so mermaid's
      // auto-layout doesn't drift the canvas. When unlocked: re-fit.
      if (viewportLocked) restoreLockedViewBox();
      else                fitSvgViewBoxToNodes(opts.previewPane);
      // Re-inject the dot grid; mermaid wiped the SVG and rebuilt it.
      installDotGrid(opts.previewPane);
      const ast = parseMermaid(opts.getSource());
      toolbar.setResetEnabled(getPositions(ast) !== null);
      // Drop any selectedIds that no longer have a node in the SVG.
      const presentIds = new Set<string>();
      const allNodes = opts.previewPane.querySelectorAll<SVGGElement>('g.node');
      for (const n of Array.from(allNodes)) {
        const id = extractMermaidId(n);
        if (id) presentIds.add(id);
      }
      // Promote pending duplicate selection (set during a duplicate mutate).
      if (pendingDuplicateIds) {
        selectedIds.clear();
        for (const id of pendingDuplicateIds) {
          if (presentIds.has(id)) selectedIds.add(id);
        }
        pendingDuplicateIds = null;
      } else {
        for (const id of Array.from(selectedIds)) {
          if (!presentIds.has(id)) selectedIds.delete(id);
        }
      }
      syncSelectedId();
      refreshSelectionUI();

      // Phase 9 fix: refresh the edge tip from the AST so cap UI / color
      // swatch reflect the latest state without having to close + reopen.
      if (selectedEdgeKey) {
        const style = getEdgeStyle(ast, selectedEdgeKey);
        edgeTip.setStyle(style);
        // Re-find the path (it may be a new element after re-render) and
        // re-apply the selected-edge highlight (path + marker heads blue).
        clearAllEdgeSelections(opts.previewPane);
        const parts = selectedEdgeKey.split('->');
        if (parts.length >= 2) {
          const from = parts[0], to = parts[1];
          const targetIdx = parts[2] ? parseInt(parts[2], 10) : 0;
          const paths = opts.previewPane.querySelectorAll<SVGPathElement>('g.edgePaths > path');
          let seen = 0;
          for (const p of Array.from(paths)) {
            const ep = parseEdgeEndpoints(p);
            if (!ep || ep.from !== from || ep.to !== to) continue;
            if (seen === targetIdx) { setEdgePathSelected(p, true); break; }
            seen++;
          }
        }
      }

      // Phase 10: promote a freshly-drawn line to the active selection and
      // open its style tip. Also re-sync the selected-line DOM class +
      // tip-style on every re-render (so style edits made via the tip stay
      // reflected in both the line element and the tip's controls).
      if (pendingNewLineId) {
        selectedLineId = pendingNewLineId;
        pendingNewLineId = null;
      }
      if (selectedLineId) {
        const lines = getLines(ast);
        const found = lines.find(l => l.id === selectedLineId) ?? null;
        if (!found) {
          // The line we had selected was deleted (e.g., undo).
          selectedLineId = null;
          lineTip.hide();
        } else {
          lineTip.setStyle(found);
          // Park the tip near the midpoint of the line for natural placement.
          const svg = opts.previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
          const a = resolveLineEndpoint(found.from, opts.previewPane);
          const b = resolveLineEndpoint(found.to,   opts.previewPane);
          if (svg && a && b) {
            const ctm = svg.getScreenCTM();
            if (ctm) {
              const pt = svg.createSVGPoint();
              pt.x = (a.x + b.x) / 2;
              pt.y = (a.y + b.y) / 2;
              const scr = pt.matrixTransform(ctm);
              lineTip.showAt(scr.x, scr.y);
            }
          }
        }
        refreshLineSelectionDom();
      }
    },
    destroy(): void {
      destroyed = true;
      opts.block.classList.remove('mb-visual-active');
      delete opts.block.dataset.mbViewportLocked;
      // Strip the dot grid so the static preview doesn't keep it.
      removeDotGrid(opts.previewPane);
      opts.previewPane.removeEventListener('click', onPreviewClick);
      opts.previewPane.removeEventListener('mousedown', onDragMouseDown, true);
      opts.previewPane.removeEventListener('wheel',     onWheel);
      document.removeEventListener('keydown',     onKeyDown,     true);
      document.removeEventListener('keyup',       onKeyUp,       true);
      document.removeEventListener('mousedown',   onOutsideClick, true);
      document.removeEventListener('mousemove',   onDragMouseMove, true);
      document.removeEventListener('mouseup',     onDragMouseUp,   true);
      // Reset host transform so a future visual session starts clean.
      const host = getSvgHost();
      if (host) host.style.transform = '';
      opts.previewPane.classList.remove('mb-tool-line');
      toolbar.el.remove();
      selectionRing.remove();
      for (const r of extraRings) r.remove();
      contextTip.destroy();
      edgeTip.destroy();
      lineTip.destroy();
      renameOverlay.destroy();
      pendingPin.remove();
      connectionLayer.remove();
      targetHooksLayer.remove();
      marqueeEl.remove();
      zoomCtrl.remove();
      for (const b of lockBadges) b.remove();
      guideLayer.destroy();
      if (nudgeTimer) clearTimeout(nudgeTimer);
    },
  };

  // Suppress unused warning — canEdit is re-exported through here for the wiring layer.
  void canEdit;
}

// ── Toolbar ─────────────────────────────────────────────────────────────────

interface ToolbarHandle {
  el:                 HTMLElement;
  setActive:          (tool: Tool) => void;
  setResetEnabled:    (enabled: boolean) => void;
  setGridSnapOn:      (on: boolean) => void;
  setViewportLocked:  (on: boolean) => void;
}

interface ToolbarHandlers {
  onPick:    (tool: Tool) => void;
  onReset:   () => void;
  onToggleGrid: () => void;
  onToggleViewportLock: () => void;
}

function buildToolbar({ onPick, onReset, onToggleGrid, onToggleViewportLock }: ToolbarHandlers): ToolbarHandle {
  const el = document.createElement('div');
  el.className = 'mb-vTb mb-vTb2';
  el.contentEditable = 'false';

  // Shape tools collapse into a single "Shapes" button with a popover —
  // matches the 10 shapes the contextual shape picker exposes.
  const SHAPE_TOOLS: Tool[] = [
    'rect', 'round', 'pill', 'circle',
    'diamond', 'hexagon', 'cylinder', 'subroutine',
    'trapezoid', 'parallelogram',
  ];
  const groups: Array<{ tools: Tool[] }> = [
    { tools: ['select', 'pan'] },
    { tools: ['arrow', 'line'] },
    { tools: ['text', 'sticky'] },
  ];

  const tipMap: Record<Tool, string> = {
    select:         'Select (V)',
    pan:            'Pan (H)',
    rect:           'Rectangle (R)',
    round:          'Rounded rectangle',
    pill:           'Pill (P)',
    circle:         'Circle (C)',
    diamond:        'Diamond (D)',
    hexagon:        'Hexagon',
    cylinder:       'Cylinder',
    subroutine:     'Subroutine',
    trapezoid:      'Trapezoid',
    parallelogram:  'Parallelogram',
    arrow:          'Arrow (A)',
    line:           'Line (L)',
    text:           'Text (T)',
    sticky:         'Sticky note (N)',
  };

  const buttonsByTool = new Map<Tool, HTMLButtonElement>();

  function makeToolButton(tool: Tool): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mb-vTb-btn';
    b.dataset.tool = tool;
    b.dataset.tip = tipMap[tool];
    b.setAttribute('aria-label', tipMap[tool]);
    b.innerHTML = ICONS[tool];
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPick(tool);
    });
    return b;
  }

  groups.forEach((group, idx) => {
    if (idx > 0) {
      const sep = document.createElement('span');
      sep.className = 'mb-vTb-sep';
      el.appendChild(sep);
    }
    for (const tool of group.tools) {
      const b = makeToolButton(tool);
      buttonsByTool.set(tool, b);
      el.appendChild(b);
    }
    // After the first group (Select/Pan), inject the Shapes group button + popover.
    if (idx === 0) {
      const sepShapes = document.createElement('span');
      sepShapes.className = 'mb-vTb-sep';
      el.appendChild(sepShapes);

      const shapesWrap = document.createElement('div');
      shapesWrap.className = 'mb-vTb-shapes';

      const shapesBtn = document.createElement('button');
      shapesBtn.type = 'button';
      shapesBtn.className = 'mb-vTb-btn mb-vTb-shapesbtn';
      shapesBtn.dataset.tip = 'Shapes';
      shapesBtn.setAttribute('aria-label', 'Shapes — pick a shape to drop');
      shapesBtn.innerHTML = ICONS.shapes;
      shapesBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });

      const shapesPop = document.createElement('div');
      shapesPop.className = 'mb-vTb-shapespop mb-hidden';
      for (const tool of SHAPE_TOOLS) {
        const opt = makeToolButton(tool);
        // Re-style as a popover row.
        opt.classList.add('mb-vTb-shapespop-item');
        buttonsByTool.set(tool, opt);
        shapesPop.appendChild(opt);
      }
      shapesBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        shapesPop.classList.toggle('mb-hidden');
      });
      // Auto-close when clicking outside.
      document.addEventListener('mousedown', (e) => {
        if (!shapesWrap.contains(e.target as Node)) shapesPop.classList.add('mb-hidden');
      }, true);
      // Closes after a shape is picked.
      shapesPop.addEventListener('click', () => {
        shapesPop.classList.add('mb-hidden');
      });

      shapesWrap.append(shapesBtn, shapesPop);
      el.appendChild(shapesWrap);

      // Expose for setActive() to also toggle the parent Shapes button.
      (buttonsByTool as Map<Tool, HTMLButtonElement> & { __shapesBtn?: HTMLButtonElement }).__shapesBtn = shapesBtn;
    }
  });

  // Layout actions — separator + grid toggle + reset.
  const sep2 = document.createElement('span');
  sep2.className = 'mb-vTb-sep';
  el.appendChild(sep2);

  const gridBtn = document.createElement('button');
  gridBtn.type = 'button';
  gridBtn.className = 'mb-vTb-btn mb-vTb-grid';
  gridBtn.dataset.tip = 'Snap to grid';
  gridBtn.setAttribute('aria-label', 'Snap to grid (8 px)');
  gridBtn.setAttribute('aria-pressed', 'false');
  gridBtn.innerHTML = ICONS.grid;
  gridBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  gridBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleGrid();
  });
  el.appendChild(gridBtn);

  // Lock viewport — when on (default), the canvas no longer auto-pans /
  // auto-zooms in response to node edits. Users can toggle this off if they
  // want the diagram to recenter as they work.
  const lockBtn = document.createElement('button');
  lockBtn.type = 'button';
  lockBtn.className = 'mb-vTb-btn mb-vTb-viewlock mb-vTb-active';
  lockBtn.dataset.tip = 'Viewport locked — click to unlock';
  lockBtn.setAttribute('aria-label', 'Viewport lock');
  lockBtn.setAttribute('aria-pressed', 'true');
  lockBtn.innerHTML = ICONS.lock;
  lockBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  lockBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleViewportLock();
  });
  el.appendChild(lockBtn);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'mb-vTb-btn mb-vTb-reset mb-vTb-disabled';
  resetBtn.dataset.tip = 'Reset layout';
  resetBtn.setAttribute('aria-label', 'Reset layout — restore auto-layout');
  resetBtn.innerHTML = ICONS.reset;
  resetBtn.disabled = true;
  resetBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  resetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (resetBtn.disabled) return;
    onReset();
  });
  el.appendChild(resetBtn);

  function setActive(tool: Tool): void {
    for (const [t, btn] of buttonsByTool) {
      btn.classList.toggle('mb-vTb-active', t === tool);
    }
    // Light up the Shapes parent button whenever any shape tool is active.
    const shapesParent = (buttonsByTool as Map<Tool, HTMLButtonElement> & { __shapesBtn?: HTMLButtonElement }).__shapesBtn;
    if (shapesParent) {
      shapesParent.classList.toggle('mb-vTb-active', SHAPE_TOOLS.includes(tool));
    }
  }

  function setResetEnabled(enabled: boolean): void {
    resetBtn.disabled = !enabled;
    resetBtn.classList.toggle('mb-vTb-disabled', !enabled);
  }

  function setGridSnapOn(on: boolean): void {
    gridBtn.classList.toggle('mb-vTb-active', on);
    gridBtn.setAttribute('aria-pressed', String(on));
  }

  function setViewportLocked(on: boolean): void {
    lockBtn.classList.toggle('mb-vTb-active', on);
    lockBtn.setAttribute('aria-pressed', String(on));
    lockBtn.innerHTML = on ? ICONS.lock : ICONS.unlock;
    lockBtn.dataset.tip = on ? 'Viewport locked — click to unlock' : 'Viewport unlocked — click to lock';
  }

  setActive('select');
  return { el, setActive, setResetEnabled, setGridSnapOn, setViewportLocked };
}

// ── Context tip ─────────────────────────────────────────────────────────────

interface ContextTipHandle {
  el:         HTMLElement;
  showBelow:  (node: Element, host: HTMLElement) => void;
  showMulti:  (count: number, host: HTMLElement, pivot: Element) => void;
  setLocked:  (locked: boolean) => void;
  setStyle:   (s: NodeStyle | null) => void;
  setShape:   (shape: NodeShape) => void;
  hide:       () => void;
  destroy:    () => void;
}

interface ContextTipHandlers {
  onDelete:    () => void;
  onShape:     (s: NodeShape) => void;
  onToggleLock:() => void;
  onStyle:     (partial: NodeStyle) => void;
  onDuplicate: () => void;
  onAlign:     (axis: 'left' | 'center-h' | 'right' | 'top' | 'middle-v' | 'bottom' | 'distribute-h' | 'distribute-v') => void;
}

function buildContextTip(handlers: ContextTipHandlers): ContextTipHandle {
  const el = document.createElement('div');
  el.className = 'mb-vCtx mb-vCtx2 mb-hidden';
  el.contentEditable = 'false';

  // Multi-select summary chip (shown only when |selection| > 1).
  const multiLabel = document.createElement('span');
  multiLabel.className = 'mb-vCtx-multi mb-hidden';
  multiLabel.textContent = '';
  el.appendChild(multiLabel);

  // ── Shape ────────────────────────────────────────────────────────────
  // Trigger shows the current shape's icon; popover is an icon grid.
  const shapeCtl = makeShapePicker((shape) => handlers.onShape(shape));
  const shapeWrap = shapeCtl.el;
  const shapeMenu = shapeCtl.menu;

  const sep1 = sepEl();

  // ── Font size ────────────────────────────────────────────────────────
  const fontInput = document.createElement('input');
  fontInput.type = 'number';
  fontInput.className = 'mb-vCtx-num';
  fontInput.min = '8';
  fontInput.max = '72';
  fontInput.step = '1';
  fontInput.value = '14';
  fontInput.setAttribute('aria-label', 'Font size');
  fontInput.title = 'Font size';
  fontInput.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  fontInput.addEventListener('change', () => {
    const v = parseInt(fontInput.value, 10);
    if (Number.isFinite(v)) handlers.onStyle({ fontSize: v });
  });

  const sep2 = sepEl();

  // ── Type-style popover (B / I / U / S) ──────────────────────────────
  const typeCtl = makeTypeStylePopover((partial) => handlers.onStyle(partial));
  // ── Alignment popover (H + V text alignment) ────────────────────────
  const alignCtl = makeAlignmentPopover((partial) => handlers.onStyle(partial));
  // ── Text color (color + opacity) ────────────────────────────────────
  const textCtl = makeColorPopover({
    glyph: 'A',
    ariaLabel: 'Text color',
    tooltip:   'Text color',
    iconClass: 'mb-vCtx-textbtn',
    showThickness: false,
    showLineType:  false,
    onColor:   (c) => handlers.onStyle({ text: c }),
    onOpacity: (o) => handlers.onStyle({ opacity: o }),
  });
  // ── Stroke (border) — line type + thickness + opacity + color ──────
  const strokeCtl = makeColorPopover({
    glyph: '',
    ariaLabel: 'Stroke',
    tooltip:   'Stroke style',
    iconClass: 'mb-vCtx-strokebtn',
    iconHTML: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`,
    showThickness: true,
    showLineType:  true,
    onColor:     (c) => handlers.onStyle({ border: c }),
    onOpacity:   (o) => handlers.onStyle({ opacity: o }),
    onThickness: (t) => handlers.onStyle({ borderWidth: t }),
    onLineType:  (t) => handlers.onStyle({ strokeType: t }),
  });
  // ── Fill (color + opacity) ──────────────────────────────────────────
  const fillCtl = makeColorPopover({
    glyph: '',
    ariaLabel: 'Fill',
    tooltip:   'Fill',
    iconClass: 'mb-vCtx-fillbtn',
    iconHTML: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`,
    showThickness: false,
    showLineType:  false,
    onColor:   (c) => handlers.onStyle({ fill: c }),
    onOpacity: (o) => handlers.onStyle({ opacity: o }),
  });

  const sep3 = sepEl();

  // ── Duplicate ────────────────────────────────────────────────────────
  const dupBtn = document.createElement('button');
  dupBtn.type = 'button';
  dupBtn.className = 'mb-vCtx-btn mb-vCtx-dup';
  dupBtn.setAttribute('aria-label', 'Duplicate');
  dupBtn.title = 'Duplicate';
  dupBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  dupBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  dupBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handlers.onDuplicate(); });

  // ── Lock ─────────────────────────────────────────────────────────────
  const lockBtn = document.createElement('button');
  lockBtn.type = 'button';
  lockBtn.className = 'mb-vCtx-btn mb-vCtx-lock';
  lockBtn.setAttribute('aria-label', 'Lock node');
  lockBtn.title = 'Lock / unlock';
  lockBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  lockBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  lockBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handlers.onToggleLock(); });

  // ── More menu (canvas align / distribute) ───────────────────────────
  const moreWrap = document.createElement('div');
  moreWrap.className = 'mb-vCtx-popwrap';
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'mb-vCtx-btn mb-vCtx-more';
  moreBtn.textContent = '⋯';
  moreBtn.setAttribute('aria-label', 'More actions');
  moreBtn.title = 'Canvas align / distribute';
  moreBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  const morePop = document.createElement('div');
  morePop.className = 'mb-vCtx-morepop mb-vCtx-popLight mb-hidden';
  const moreItems: Array<[ContextTipHandlers['onAlign'] extends (a: infer A) => unknown ? A : never, string]> = [
    ['left',         'Align nodes left'],
    ['center-h',     'Align nodes center'],
    ['right',        'Align nodes right'],
    ['top',          'Align nodes top'],
    ['middle-v',     'Align nodes middle'],
    ['bottom',       'Align nodes bottom'],
    ['distribute-h', 'Distribute horizontally'],
    ['distribute-v', 'Distribute vertically'],
  ];
  for (const [axis, label] of moreItems) {
    const it = document.createElement('button');
    it.type = 'button';
    it.className = 'mb-vCtx-menu-item';
    it.title = label;
    it.textContent = label;
    it.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    it.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      morePop.classList.add('mb-hidden');
      handlers.onAlign(axis);
    });
    morePop.appendChild(it);
  }
  moreBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    morePop.classList.toggle('mb-hidden');
  });
  moreWrap.append(moreBtn, morePop);

  // ── Delete ───────────────────────────────────────────────────────────
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'mb-vCtx-btn mb-vCtx-danger';
  deleteBtn.setAttribute('aria-label', 'Delete node');
  deleteBtn.title = 'Delete';
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
  deleteBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  deleteBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handlers.onDelete(); });

  el.append(
    multiLabel,
    shapeWrap, sep1,
    fontInput, sep2,
    typeCtl.el,
    alignCtl.el,
    textCtl.el,
    strokeCtl.el,
    fillCtl.el,
    sep3,
    dupBtn, lockBtn, moreWrap, deleteBtn,
  );

  // Single-popover policy: opening any popover auto-closes the others.
  // We sync `aria-expanded` on every trigger button after each open/close so
  // assistive tech announces the change.
  function syncAriaExpanded(): void {
    const triggers = el.querySelectorAll<HTMLElement>('[aria-haspopup="true"]');
    for (const trig of Array.from(triggers)) {
      const sib = trig.parentElement?.querySelector<HTMLElement>('.mb-vCtx-menu, .mb-vCtx-morepop, .mb-vCtx-bigpop');
      const open = !!sib && !sib.classList.contains('mb-hidden');
      trig.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }
  el.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (!t) return;
    if (t.closest('.mb-vCtx-menu-item, .mb-vCtx-swatch, .mb-vCtx-segbtn, .mb-vCtx-typebtn, .mb-vCtx-sliderwrap, .mb-vCtx-popLight, .mb-vCtx-bigpop')) return;
    const opener = t.closest('.mb-vCtx-btn');
    if (!opener) return;
    const allPops = el.querySelectorAll<HTMLElement>('.mb-vCtx-menu, .mb-vCtx-morepop, .mb-vCtx-bigpop');
    const ownPop = opener.parentElement?.querySelector<HTMLElement>('.mb-vCtx-menu, .mb-vCtx-morepop, .mb-vCtx-bigpop');
    for (const p of Array.from(allPops)) {
      if (p !== ownPop) p.classList.add('mb-hidden');
    }
    // Defer to after the opener's own click handler toggles its popover.
    setTimeout(syncAriaExpanded, 0);
  }, true);
  // Escape closes any open popover and returns focus to the tip root.
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const allPops = el.querySelectorAll<HTMLElement>('.mb-vCtx-menu, .mb-vCtx-morepop, .mb-vCtx-bigpop');
      let any = false;
      for (const p of Array.from(allPops)) {
        if (!p.classList.contains('mb-hidden')) { p.classList.add('mb-hidden'); any = true; }
      }
      if (any) {
        e.stopPropagation();
        syncAriaExpanded();
      }
    }
  });

  function showBelow(node: Element, host: HTMLElement): void {
    const nodeRect = node.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    el.style.left = `${nodeRect.left - hostRect.left + nodeRect.width / 2}px`;
    el.style.top  = `${nodeRect.bottom - hostRect.top + 8}px`;
    el.classList.remove('mb-hidden');
    shapeWrap.classList.remove('mb-hidden');
    sep1.classList.remove('mb-hidden');
    multiLabel.classList.add('mb-hidden');
    shapeMenu.classList.add('mb-hidden');
  }

  function showMulti(count: number, host: HTMLElement, pivot: Element): void {
    const pivotRect = pivot.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    el.style.left = `${pivotRect.left - hostRect.left + pivotRect.width / 2}px`;
    el.style.top  = `${pivotRect.bottom - hostRect.top + 8}px`;
    el.classList.remove('mb-hidden');
    shapeWrap.classList.add('mb-hidden');
    sep1.classList.add('mb-hidden');
    multiLabel.textContent = `${count} selected`;
    multiLabel.classList.remove('mb-hidden');
    shapeMenu.classList.add('mb-hidden');
  }

  function setLocked(locked: boolean): void {
    lockBtn.classList.toggle('mb-vCtx-lock-on', locked);
  }

  function setStyle(s: NodeStyle | null): void {
    fontInput.value = String(s?.fontSize ?? 14);
    typeCtl.setState({
      bold:      !!s?.bold,
      italic:    !!s?.italic,
      underline: !!s?.underline,
      strike:    !!s?.strike,
    });
    alignCtl.setState({
      textAlign:     s?.textAlign     ?? 'center',
      verticalAlign: s?.verticalAlign ?? 'middle',
      padding:       s?.padding       ?? 'spacious',
      lineHeight:    s?.lineHeight    ?? 'normal',
    });
    const opacity = s?.opacity ?? 1;
    textCtl.setState(  { color: s?.text   ?? null, opacity });
    strokeCtl.setState({ color: s?.border ?? null, opacity, thickness: s?.borderWidth ?? 1, lineType: s?.strokeType ?? 'solid' });
    fillCtl.setState(  { color: s?.fill   ?? null, opacity });
  }

  function setShape(shape: NodeShape): void {
    shapeCtl.setShape(shape);
  }

  function hide(): void {
    el.classList.add('mb-hidden');
    const allPops = el.querySelectorAll<HTMLElement>('.mb-vCtx-menu, .mb-vCtx-morepop, .mb-vCtx-bigpop');
    for (const p of Array.from(allPops)) p.classList.add('mb-hidden');
  }

  function destroy(): void { el.remove(); }

  return { el, showBelow, showMulti, setLocked, setStyle, setShape, hide, destroy };
}

function sepEl(): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'mb-vCtx-sep';
  return s;
}

// ── Edge context tip (Phase 9, redesigned) ─────────────────────────────────
// Two-tier:
//  Top mini bar (always visible): line-style preview button (opens the
//    expanded panel), flip, end-cap, start-cap, delete.
//  Expanded panel (toggled by line button): line type (3), thickness slider,
//    opacity slider, "No color" button, brand colors (4), all colors (20).
// Theme-aware (white in light, dark in dark) — uses --bg/--text variables.

interface EdgeTipHandle {
  el:         HTMLElement;
  showAt:     (clientX: number, clientY: number) => void;
  hide:       () => void;
  setStyle:   (s: EdgeStyle | null) => void;
  destroy:    () => void;
}

interface EdgeTipHandlers {
  onStyleChange: (partial: EdgeStyle) => void;
  onFlip:        () => void;
  onDelete:      () => void;
}

const BRAND_COLORS = ['#ec4899', '#2563eb', '#8b5cf6', '#111827'];
const ALL_COLORS = [
  '#fde68a', '#fed7aa', '#fbcfe8', '#bbf7d0',
  '#bfdbfe', '#e9d5ff', '#fcd34d', '#fb923c',
  '#fb7185', '#86efac', '#60a5fa', '#a78bfa',
  '#c2410c', '#7c2d12', '#dc2626', '#166534',
  '#1e40af', '#6b21a8', '#ffffff', '#9ca3af',
];

function buildEdgeContextTip(handlers: EdgeTipHandlers): EdgeTipHandle {
  const wrap = document.createElement('div');
  wrap.className = 'mb-vEdgeCtx2 mb-hidden';
  wrap.contentEditable = 'false';

  // ── Top mini bar ─────────────────────────────────────────────────────
  const topBar = document.createElement('div');
  topBar.className = 'mb-vEdgeCtx2-top';

  // Line style preview (clicking opens the expanded line panel)
  const lineBtn = document.createElement('button');
  lineBtn.type = 'button';
  lineBtn.className = 'mb-vEdgeCtx2-line';
  lineBtn.setAttribute('aria-label', 'Line style and thickness');
  lineBtn.title = 'Line style, thickness, opacity';
  lineBtn.innerHTML = lineGlyph('solid');

  // Flip endpoints
  const flipBtn = document.createElement('button');
  flipBtn.type = 'button';
  flipBtn.className = 'mb-vEdgeCtx2-icon';
  flipBtn.setAttribute('aria-label', 'Flip endpoints');
  flipBtn.title = 'Flip endpoints';
  flipBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4v16m-3-3l3 3 3-3M16 20V4m3 3l-3-3-3 3"/></svg>`;
  flipBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  flipBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handlers.onFlip(); });

  // Start cap (left-side) and end cap (right-side) — ordered visually
  // start | flip | end so the layout matches the actual edge direction.
  const startCapBtn = makeCapButton('start', (cap) => handlers.onStyleChange({ startCap: cap }));
  const endCapBtn   = makeCapButton('end',   (cap) => handlers.onStyleChange({ endCap:   cap }));

  // Color button — opens its own popover (no longer inside the line panel).
  const colorBtn = document.createElement('button');
  colorBtn.type = 'button';
  colorBtn.className = 'mb-vEdgeCtx2-color';
  colorBtn.setAttribute('aria-label', 'Line color');
  colorBtn.title = 'Line color';
  colorBtn.innerHTML = `<span class="mb-vEdgeCtx2-colorswatch" style="background:#111827"></span>`;
  const colorSwatch = colorBtn.querySelector<HTMLElement>('.mb-vEdgeCtx2-colorswatch');

  // Animate button — opens a popover with speed (None/Slow/Fast) and direction
  // (Left/Right) rows. The button itself is a play triangle that lights up
  // when an animation is active.
  const animCtl = makeAnimButton((partial) => handlers.onStyleChange(partial));

  const sep1 = document.createElement('span');
  sep1.className = 'mb-vEdgeCtx2-sep';
  const sep2 = document.createElement('span');
  sep2.className = 'mb-vEdgeCtx2-sep';

  // Delete
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'mb-vEdgeCtx2-icon mb-vEdgeCtx2-danger';
  deleteBtn.setAttribute('aria-label', 'Delete edge');
  deleteBtn.title = 'Delete edge';
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>`;
  deleteBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  deleteBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handlers.onDelete(); });

  // Order: line | startCap | flip | endCap | color | animate | delete
  topBar.append(lineBtn, sep1, startCapBtn.el, flipBtn, endCapBtn.el, colorBtn, animCtl.el, sep2, deleteBtn);

  // ── Line panel (compact: type + thickness + opacity) ────────────────
  const linePanel = document.createElement('div');
  linePanel.className = 'mb-vEdgeCtx2-panel mb-hidden';

  // Line type (3 buttons in a row)
  const typeRow = document.createElement('div');
  typeRow.className = 'mb-vEdgeCtx2-types';
  const typeBtns: Record<string, HTMLButtonElement> = {};
  for (const t of ['solid', 'dashed', 'dotted']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mb-vEdgeCtx2-type';
    b.dataset.type = t;
    b.setAttribute('aria-label', `Line: ${t}`);
    b.title = `Line: ${t}`;
    b.innerHTML = lineGlyph(t as 'solid' | 'dashed' | 'dotted', 26);
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      handlers.onStyleChange({ type: t as 'solid' | 'dashed' | 'dotted' });
    });
    typeBtns[t] = b;
    typeRow.appendChild(b);
  }

  const thicknessSlider = makeLabelledSlider('Thickness', 0.5, 6, 0.5, 1.5, 'px', (v) => handlers.onStyleChange({ thickness: v }));
  const opacitySlider   = makeLabelledSlider('Opacity', 10, 100, 5, 100, '%', (v) => handlers.onStyleChange({ opacity: v / 100 }));

  linePanel.append(typeRow, thicknessSlider.el, opacitySlider.el);

  // ── Color panel (own popover, opened by the color button) ────────────
  const colorPanel = document.createElement('div');
  colorPanel.className = 'mb-vEdgeCtx2-panel mb-vEdgeCtx2-colorpanel mb-hidden';

  const noColorBtn = document.createElement('button');
  noColorBtn.type = 'button';
  noColorBtn.className = 'mb-vEdgeCtx2-nocolor';
  noColorBtn.title = 'No color';
  noColorBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="5" y1="5" x2="19" y2="19"/></svg><span>No color</span>`;
  noColorBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  noColorBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handlers.onStyleChange({ color: 'transparent' }); });

  const brandLabel = document.createElement('div');
  brandLabel.className = 'mb-vEdgeCtx2-grouplabel';
  brandLabel.textContent = 'Brand colors';
  const brandGrid = makeSwatchGrid(BRAND_COLORS, (c) => handlers.onStyleChange({ color: c }));

  const allLabel = document.createElement('div');
  allLabel.className = 'mb-vEdgeCtx2-grouplabel';
  allLabel.textContent = 'All colors';
  const allGrid = makeSwatchGrid(ALL_COLORS, (c) => handlers.onStyleChange({ color: c }));

  colorPanel.append(noColorBtn, brandLabel, brandGrid, allLabel, allGrid);

  // Toggle panels on their buttons. Opening one closes the other to keep
  // only one expanded at a time — also covers the cap + animate popovers
  // hanging off the top mini-bar so they can't stack with the line panel.
  function closeAllPanels(): void {
    linePanel.classList.add('mb-hidden');
    colorPanel.classList.add('mb-hidden');
    for (const sub of Array.from(wrap.querySelectorAll<HTMLElement>('.mb-vEdgeCtx2-cappop'))) {
      sub.classList.add('mb-hidden');
    }
  }
  lineBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  lineBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const wasOpen = !linePanel.classList.contains('mb-hidden');
    closeAllPanels();
    if (!wasOpen) linePanel.classList.remove('mb-hidden');
  });
  colorBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  colorBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const wasOpen = !colorPanel.classList.contains('mb-hidden');
    closeAllPanels();
    if (!wasOpen) colorPanel.classList.remove('mb-hidden');
  });
  // Capture-phase: when any small popover (cap dropdown / animate menu) is
  // about to open, close the larger panels first so they don't stack.
  wrap.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (!t) return;
    if (t.closest('.mb-vEdgeCtx2-capitem, .mb-vEdgeCtx2-animseg-btn, .mb-vEdgeCtx2-panel')) return;
    const trigger = t.closest('.mb-vEdgeCtx2-cap > .mb-vEdgeCtx2-icon, .mb-vEdgeCtx2-anim-btn');
    if (!trigger) return;
    // Close the line / color panels and sibling cap popovers, but leave this
    // trigger's own popover untouched so its click handler can toggle it.
    linePanel.classList.add('mb-hidden');
    colorPanel.classList.add('mb-hidden');
    const ownPop = trigger.parentElement?.querySelector<HTMLElement>('.mb-vEdgeCtx2-cappop');
    for (const sub of Array.from(wrap.querySelectorAll<HTMLElement>('.mb-vEdgeCtx2-cappop'))) {
      if (sub !== ownPop) sub.classList.add('mb-hidden');
    }
  }, true);

  wrap.append(topBar, linePanel, colorPanel);

  function showAt(clientX: number, clientY: number): void {
    const host = wrap.parentElement;
    if (host) {
      const hostRect = host.getBoundingClientRect();
      wrap.style.left = `${clientX - hostRect.left}px`;
      wrap.style.top  = `${clientY - hostRect.top + 16}px`;
    }
    wrap.classList.remove('mb-hidden');
  }

  function hide(): void {
    wrap.classList.add('mb-hidden');
    linePanel.classList.add('mb-hidden');
    colorPanel.classList.add('mb-hidden');
  }

  function setStyle(s: EdgeStyle | null): void {
    const t = s?.type ?? 'solid';
    lineBtn.innerHTML = lineGlyph(t);
    for (const k of Object.keys(typeBtns)) {
      typeBtns[k].classList.toggle('mb-vEdgeCtx2-type-on', k === t);
    }
    thicknessSlider.setValue(s?.thickness ?? 1.5);
    opacitySlider.setValue(Math.round((s?.opacity ?? 1) * 100));
    startCapBtn.setCap(s?.startCap ?? 'none');
    endCapBtn.setCap(s?.endCap ?? 'arrow');
    if (colorSwatch) colorSwatch.style.background = s?.color ?? '#111827';
    animCtl.setState(s?.animation ?? 'none', s?.animationDirection ?? 'forward', s?.type ?? 'solid');
  }

  function destroy(): void { wrap.remove(); }

  return { el: wrap, showAt, hide, setStyle, destroy };
}

// ── Standalone-line context tip ─────────────────────────────────────────────
// A leaner cousin of the edge tip — no caps, no animation, no flip (lines have
// no direction). Just: line-type swatches, thickness, color, delete.

export type LinePartial = Partial<Pick<LineDecl, 'color' | 'thickness' | 'type'>>;

interface LineTipHandle {
  el:       HTMLElement;
  showAt:   (clientX: number, clientY: number) => void;
  hide:     () => void;
  setStyle: (l: LineDecl | null) => void;
  destroy:  () => void;
}

interface LineTipHandlers {
  onStyleChange: (partial: LinePartial) => void;
  onDelete:      () => void;
}

function buildLineContextTip(handlers: LineTipHandlers): LineTipHandle {
  // Reuse the edge tip's chrome classes — same theme-aware container, same
  // panel + swatch styles. Adding `mb-vLineTip` to the wrapper lets the
  // click-suppression elsewhere know "this is our overlay, don't deselect".
  const wrap = document.createElement('div');
  wrap.className = 'mb-vEdgeCtx2 mb-vLineTip mb-hidden';
  wrap.contentEditable = 'false';

  const topBar = document.createElement('div');
  topBar.className = 'mb-vEdgeCtx2-top';

  // Line style preview button — opens the line panel (type + thickness).
  const lineBtn = document.createElement('button');
  lineBtn.type = 'button';
  lineBtn.className = 'mb-vEdgeCtx2-line';
  lineBtn.setAttribute('aria-label', 'Line style and thickness');
  lineBtn.title = 'Line style, thickness';
  lineBtn.innerHTML = lineGlyph('solid');

  // Color button.
  const colorBtn = document.createElement('button');
  colorBtn.type = 'button';
  colorBtn.className = 'mb-vEdgeCtx2-color';
  colorBtn.setAttribute('aria-label', 'Line color');
  colorBtn.title = 'Line color';
  colorBtn.innerHTML = `<span class="mb-vEdgeCtx2-colorswatch" style="background:#1f2937"></span>`;
  const colorSwatch = colorBtn.querySelector<HTMLElement>('.mb-vEdgeCtx2-colorswatch');

  const sep = document.createElement('span');
  sep.className = 'mb-vEdgeCtx2-sep';

  // Delete
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'mb-vEdgeCtx2-icon mb-vEdgeCtx2-danger';
  deleteBtn.setAttribute('aria-label', 'Delete line');
  deleteBtn.title = 'Delete line';
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>`;
  deleteBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  deleteBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handlers.onDelete(); });

  topBar.append(lineBtn, colorBtn, sep, deleteBtn);

  // ── Line panel (type + thickness) ────────────────────────────────────
  const linePanel = document.createElement('div');
  linePanel.className = 'mb-vEdgeCtx2-panel mb-hidden';

  const typeRow = document.createElement('div');
  typeRow.className = 'mb-vEdgeCtx2-types';
  const typeBtns: Record<string, HTMLButtonElement> = {};
  for (const t of ['solid', 'dashed', 'dotted'] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mb-vEdgeCtx2-type';
    b.dataset.type = t;
    b.setAttribute('aria-label', `Line: ${t}`);
    b.title = `Line: ${t}`;
    b.innerHTML = lineGlyph(t, 26);
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      handlers.onStyleChange({ type: t });
    });
    typeBtns[t] = b;
    typeRow.appendChild(b);
  }

  const thicknessSlider = makeLabelledSlider('Thickness', 0.5, 6, 0.5, 1.5, 'px', (v) => handlers.onStyleChange({ thickness: v }));
  linePanel.append(typeRow, thicknessSlider.el);

  // ── Color panel ───────────────────────────────────────────────────────
  const colorPanel = document.createElement('div');
  colorPanel.className = 'mb-vEdgeCtx2-panel mb-vEdgeCtx2-colorpanel mb-hidden';

  const brandLabel = document.createElement('div');
  brandLabel.className = 'mb-vEdgeCtx2-grouplabel';
  brandLabel.textContent = 'Brand colors';
  const brandGrid = makeSwatchGrid(BRAND_COLORS, (c) => handlers.onStyleChange({ color: c }));

  const allLabel = document.createElement('div');
  allLabel.className = 'mb-vEdgeCtx2-grouplabel';
  allLabel.textContent = 'All colors';
  const allGrid = makeSwatchGrid(ALL_COLORS, (c) => handlers.onStyleChange({ color: c }));

  colorPanel.append(brandLabel, brandGrid, allLabel, allGrid);

  function closeAllPanels(): void {
    linePanel.classList.add('mb-hidden');
    colorPanel.classList.add('mb-hidden');
  }
  lineBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  lineBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const wasOpen = !linePanel.classList.contains('mb-hidden');
    closeAllPanels();
    if (!wasOpen) linePanel.classList.remove('mb-hidden');
  });
  colorBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  colorBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const wasOpen = !colorPanel.classList.contains('mb-hidden');
    closeAllPanels();
    if (!wasOpen) colorPanel.classList.remove('mb-hidden');
  });

  wrap.append(topBar, linePanel, colorPanel);

  function showAt(clientX: number, clientY: number): void {
    const host = wrap.parentElement;
    if (host) {
      const hostRect = host.getBoundingClientRect();
      wrap.style.left = `${clientX - hostRect.left}px`;
      wrap.style.top  = `${clientY - hostRect.top + 16}px`;
    }
    wrap.classList.remove('mb-hidden');
  }
  function hide(): void {
    wrap.classList.add('mb-hidden');
    closeAllPanels();
  }
  function setStyle(l: LineDecl | null): void {
    const t = l?.type ?? 'solid';
    lineBtn.innerHTML = lineGlyph(t);
    for (const k of Object.keys(typeBtns)) {
      typeBtns[k].classList.toggle('mb-vEdgeCtx2-type-on', k === t);
    }
    thicknessSlider.setValue(l?.thickness ?? 1.5);
    if (colorSwatch) colorSwatch.style.background = l?.color ?? '#1f2937';
  }
  function destroy(): void { wrap.remove(); }

  return { el: wrap, showAt, hide, setStyle, destroy };
}

function lineGlyph(type: 'solid' | 'dashed' | 'dotted', width = 26): string {
  const dasharray = type === 'dashed' ? '6 4' : type === 'dotted' ? '2 3' : '0';
  return `<svg viewBox="0 0 ${width + 4} 12" width="${width + 4}" height="12"><line x1="2" y1="6" x2="${width + 2}" y2="6" stroke="currentColor" stroke-width="2.5" stroke-dasharray="${dasharray}" stroke-linecap="round"/></svg>`;
}

function makeCapButton(which: 'start' | 'end', onPick: (cap: EdgeCap) => void): { el: HTMLElement; setCap: (c: EdgeCap) => void } {
  const wrap = document.createElement('div');
  wrap.className = 'mb-vEdgeCtx2-cap';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mb-vEdgeCtx2-icon';
  btn.setAttribute('aria-label', which === 'start' ? 'Start cap' : 'End cap');
  btn.title = which === 'start' ? 'Start cap (left endpoint)' : 'End cap (right endpoint)';
  btn.innerHTML = capGlyph(which === 'end' ? 'arrow' : 'none', which);
  const pop = document.createElement('div');
  pop.className = 'mb-vEdgeCtx2-cappop mb-hidden';
  const opts: Array<[EdgeCap, string]> = [['none', 'None'], ['arrow', 'Arrow'], ['circle', 'Circle']];
  const itemsByCap = new Map<EdgeCap, HTMLButtonElement>();
  for (const [cap, label] of opts) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'mb-vEdgeCtx2-capitem';
    item.dataset.cap = cap;
    item.title = label;
    item.innerHTML = `${capGlyph(cap, which)}<span>${label}</span>`;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    item.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      pop.classList.add('mb-hidden');
      onPick(cap);
    });
    itemsByCap.set(cap, item);
    pop.appendChild(item);
  }
  let currentCap: EdgeCap = which === 'end' ? 'arrow' : 'none';
  btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    pop.classList.toggle('mb-hidden');
  });
  wrap.append(btn, pop);
  return {
    el: wrap,
    setCap(c) {
      currentCap = c;
      btn.innerHTML = capGlyph(c, which);
      // The toolbar button itself stays neutral; only the dropdown item gets
      // the highlighted state so users can see the current pick without the
      // toolbar lighting up blue.
      for (const [cap, item] of itemsByCap) {
        item.classList.toggle('mb-vEdgeCtx2-capitem-on', cap === currentCap);
      }
    },
  };
}

function capGlyph(cap: EdgeCap, which: 'start' | 'end'): string {
  // SVG glyph for a horizontal line with a cap on the given end.
  const path = cap === 'arrow'
    ? (which === 'end' ? `<line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 10 L10 6 M14 10 L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>`
                       : `<line x1="6" y1="10" x2="18" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 10 L10 6 M6 10 L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>`)
    : cap === 'circle'
    ? (which === 'end' ? `<line x1="2" y1="10" x2="13" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="10" r="2.5" fill="currentColor"/>`
                       : `<circle cx="4" cy="10" r="2.5" fill="currentColor"/><line x1="7" y1="10" x2="18" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`)
    : /* none */         `<line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 20 20" width="18" height="18" fill="none">${path}</svg>`;
}

// Animate-button popover: a play-triangle that opens a small menu with two
// rows — speed (None / Slow / Fast) and direction (Left / Right). The button
// lights up when an animation is active.
function makeAnimButton(
  onChange: (partial: { animation?: EdgeAnimation; animationDirection?: EdgeAnimationDirection; type?: 'solid' | 'dashed' | 'dotted' }) => void,
): {
  el: HTMLElement;
  setState: (a: EdgeAnimation, d: EdgeAnimationDirection, t: 'solid' | 'dashed' | 'dotted') => void;
} {
  const wrap = document.createElement('div');
  wrap.className = 'mb-vEdgeCtx2-cap mb-vEdgeCtx2-anim';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mb-vEdgeCtx2-icon mb-vEdgeCtx2-anim-btn';
  btn.setAttribute('aria-label', 'Animate line');
  btn.title = 'Animate line';
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>`;

  const pop = document.createElement('div');
  pop.className = 'mb-vEdgeCtx2-cappop mb-vEdgeCtx2-animpop mb-hidden';

  function makeRow(
    label: string,
    options: Array<[string, string]>,
    onPick: (value: string) => void,
  ): { row: HTMLElement; setValue: (v: string) => void } {
    const row = document.createElement('div');
    row.className = 'mb-vEdgeCtx2-animrow';
    const lab = document.createElement('div');
    lab.className = 'mb-vEdgeCtx2-animlabel';
    lab.textContent = label;
    const seg = document.createElement('div');
    seg.className = 'mb-vEdgeCtx2-animseg';
    const buttons = new Map<string, HTMLButtonElement>();
    for (const [val, text] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mb-vEdgeCtx2-animseg-btn';
      b.dataset.value = val;
      b.textContent = text;
      b.title = `${label}: ${text}`;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        onPick(val);
      });
      buttons.set(val, b);
      seg.appendChild(b);
    }
    row.append(lab, seg);
    return {
      row,
      setValue(v) {
        for (const [val, b] of buttons) {
          b.classList.toggle('mb-vEdgeCtx2-animseg-on', val === v);
        }
      },
    };
  }

  let currentAnim: EdgeAnimation = 'none';
  let currentDir: EdgeAnimationDirection = 'forward';
  let currentType: 'solid' | 'dashed' | 'dotted' = 'solid';

  const speedRow = makeRow('Speed', [['none', 'None'], ['slow', 'Slow'], ['fast', 'Fast']], (v) => {
    const next = v as EdgeAnimation;
    currentAnim = next;
    // Marching ants only work on a dashed/dotted stroke. If the user enables
    // animation on a solid line, promote it to dashed in the same edit so the
    // effect is visible right away.
    if (next !== 'none' && currentType === 'solid') {
      currentType = 'dashed';
      onChange({ animation: next, type: 'dashed' });
    } else {
      onChange({ animation: next });
    }
  });
  const dirRow = makeRow('Direction', [['forward', 'Right'], ['reverse', 'Left']], (v) => {
    currentDir = v as EdgeAnimationDirection;
    onChange({ animationDirection: currentDir });
  });
  pop.append(speedRow.row, dirRow.row);

  btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    pop.classList.toggle('mb-hidden');
  });

  wrap.append(btn, pop);
  return {
    el: wrap,
    setState(a, d, t) {
      currentAnim = a;
      currentDir = d;
      currentType = t;
      speedRow.setValue(a);
      dirRow.setValue(d);
      btn.classList.toggle('mb-vEdgeCtx2-anim-on', a !== 'none');
    },
  };
}

function makeLabelledSlider(label: string, min: number, max: number, step: number, initial: number, suffix: string, onChange: (v: number) => void): { el: HTMLElement; setValue: (v: number) => void } {
  const wrap = document.createElement('div');
  wrap.className = 'mb-vEdgeCtx2-slider';
  const inputEl = document.createElement('input');
  inputEl.type = 'range';
  inputEl.min  = String(min);
  inputEl.max  = String(max);
  inputEl.step = String(step);
  inputEl.value = String(initial);
  const row = document.createElement('div');
  row.className = 'mb-vEdgeCtx2-sliderlabel';
  const lab = document.createElement('span');
  lab.textContent = label;
  const val = document.createElement('span');
  val.className = 'mb-vEdgeCtx2-sliderval';
  val.textContent = `${initial}${suffix}`;
  row.append(lab, val);
  inputEl.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  inputEl.addEventListener('input', () => {
    const v = parseFloat(inputEl.value);
    if (Number.isFinite(v)) {
      val.textContent = `${v}${suffix}`;
      onChange(v);
    }
  });
  wrap.append(inputEl, row);
  return {
    el: wrap,
    setValue(v) { inputEl.value = String(v); val.textContent = `${v}${suffix}`; },
  };
}

function makeSwatchGrid(colors: string[], onPick: (c: string) => void): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'mb-vEdgeCtx2-swatches';
  for (const c of colors) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'mb-vEdgeCtx2-swatch';
    s.style.background = c;
    s.dataset.color = c;
    s.setAttribute('aria-label', `Color ${c}`);
    s.title = c;
    s.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    s.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onPick(c); });
    grid.appendChild(s);
  }
  return grid;
}

// ── Rename overlay ──────────────────────────────────────────────────────────

interface RenameOverlayHandle {
  el:      HTMLElement;
  open:    (initial: string, anchor: HTMLElement, host: HTMLElement) => void;
  hide:    () => void;
  isOpen:  () => boolean;
  destroy: () => void;
}

function buildRenameOverlay(handlers: { onCommit: (newLabel: string) => void; onCancel: () => void }): RenameOverlayHandle {
  const el = document.createElement('input');
  el.type = 'text';
  el.className = 'mb-vRename mb-hidden';
  el.setAttribute('aria-label', 'Rename node');

  let open = false;

  el.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  el.addEventListener('click',     (e) => { e.stopPropagation(); });
  el.addEventListener('keydown',   (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handlers.onCommit(el.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handlers.onCancel();
    }
  });
  el.addEventListener('blur', () => {
    if (open) handlers.onCommit(el.value);
  });

  function openOverlay(initial: string, anchor: HTMLElement, host: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const hostRect   = host.getBoundingClientRect();
    el.style.left   = `${anchorRect.left - hostRect.left}px`;
    el.style.top    = `${anchorRect.top  - hostRect.top}px`;
    el.style.width  = `${anchorRect.width}px`;
    el.style.height = `${anchorRect.height}px`;
    el.value = initial;
    el.classList.remove('mb-hidden');
    open = true;
    requestAnimationFrame(() => { el.focus(); el.select(); });
  }

  function hideOverlay(): void {
    el.classList.add('mb-hidden');
    open = false;
  }

  return {
    el: el as unknown as HTMLElement,
    open: openOverlay,
    hide: hideOverlay,
    isOpen: () => open,
    destroy: () => el.remove(),
  };
}

// ── Mermaid DOM probes ──────────────────────────────────────────────────────

// Mermaid renders flowchart nodes as <g class="node …" id="flowchart-<id>-<n>">
// (id format varies between versions; the id between the prefix and the suffix
// is the mermaid node id we passed in). Walk up from the click target until we
// find that ancestor. Returns null if the click was outside any node.
function findMermaidNode(target: Element | null, host: HTMLElement): { id: string; el: Element } | null {
  if (!target) return null;
  if (!host.contains(target)) return null;

  let cur: Element | null = target;
  while (cur && cur !== host) {
    if (cur.tagName?.toLowerCase() === 'g' && cur.classList.contains('node')) {
      const id = extractMermaidId(cur);
      if (id) return { id, el: cur };
    }
    cur = cur.parentElement;
  }
  return null;
}

function findNodeElementById(id: string, host: HTMLElement): Element | null {
  const all = host.querySelectorAll<SVGGElement>('g.node');
  for (const g of Array.from(all)) {
    if (extractMermaidId(g) === id) return g;
  }
  return null;
}

/** Return the (x,y) in SVG coords of a node's hook on the given side. */
function nodeHookPosition(g: SVGGElement, side: 'n' | 'e' | 's' | 'w'): { x: number; y: number } | null {
  const t = readNodeTranslate(g);
  if (!t) return null;
  const half = nodeHalfExtent(g);
  switch (side) {
    case 'n': return { x: t.x,            y: t.y - half.h };
    case 's': return { x: t.x,            y: t.y + half.h };
    case 'e': return { x: t.x + half.w,   y: t.y };
    case 'w': return { x: t.x - half.w,   y: t.y };
  }
}

/** Pick the hook (N/E/S/W) on `g` closest to the given point. */
function closestHook(g: SVGGElement, p: { x: number; y: number }): { x: number; y: number } | null {
  const sides: Array<'n' | 'e' | 's' | 'w'> = ['n', 'e', 's', 'w'];
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const s of sides) {
    const h = nodeHookPosition(g, s);
    if (!h) continue;
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

/** document.elementFromPoint, but climb out of any of our drag-related
    overlays (.mb-vEdgeDraft path, the connection dot) so we see the
    SVG nodes underneath. */
// Install a Miro-style infinite dot grid as a background layer inside the
// SVG. The grid spacing is computed in SVG user units, then a level snap
// based on the current zoom keeps the on-screen dot spacing in a
// comfortable range (~12-24 px) — same trick Excalidraw / Figma use:
// as you zoom in past a threshold, the spacing halves; as you zoom out,
// it doubles. Dots stay visually consistent at any zoom level.

const DOT_GRID_BASE_UNIT = 4;          // SVG user units per "step" (small base → tighter dots)
const DOT_GRID_TARGET_SCREEN_PX = 22;   // ideal on-screen distance between dots
const DOT_GRID_RADIUS_RATIO = 0.075;    // dot radius = ratio * spacing (visible but not chunky)
const DOT_GRID_MAX_RADIUS = 1.6;        // ceiling so the biggest snap level doesn't look chunky

/** Returns the SVG's natural user-units → screen-pixels ratio so the
    dot grid can be sized to a consistent on-screen density. Returns 1
    as a safe fallback when the SVG isn't ready yet. Callers pass the
    outer .mb-preview host; the helper drills into .mb-svg-host > svg. */
export function naturalSvgScale(host: HTMLElement): number {
  const svg = host.querySelector<SVGSVGElement>('.mb-svg-host svg');
  if (!svg) return 1;
  const vb = svg.viewBox?.baseVal;
  const hostWidth = svg.getBoundingClientRect().width;
  if (!vb || vb.width <= 0 || hostWidth <= 0) return 1;
  return hostWidth / vb.width;
}

function gridSpacingForScale(scale: number): number {
  // Snap unitSpacing to base * 2^level so spacing changes only at thresholds.
  const safe = Math.max(0.001, scale);
  const desiredUnit = DOT_GRID_TARGET_SCREEN_PX / safe;
  const level = Math.round(Math.log2(desiredUnit / DOT_GRID_BASE_UNIT));
  return DOT_GRID_BASE_UNIT * Math.pow(2, Math.max(-3, Math.min(6, level)));
}

function installDotGrid(host: HTMLElement): void {
  const svg = host.querySelector<SVGSVGElement>('.mb-svg-host svg');
  if (!svg) return;
  const dark = document.documentElement.classList.contains('theme-dark');
  const dotColor = dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.28)';
  const vb = svg.viewBox?.baseVal;
  if (!vb || !isFinite(vb.width) || vb.width <= 0) return;

  // Remove any old grid bits before reinstalling.
  for (const old of Array.from(svg.querySelectorAll('.mb-vDotGrid, #mb-vDotGrid-pattern'))) {
    old.remove();
  }

  const ns = 'http://www.w3.org/2000/svg';
  let defs = svg.querySelector<SVGDefsElement>('defs');
  if (!defs) {
    defs = document.createElementNS(ns, 'defs') as SVGDefsElement;
    svg.insertBefore(defs, svg.firstChild);
  }

  // Start at the baseline spacing — `updateDotGrid` will rescale on zoom.
  const spacing = gridSpacingForScale(naturalSvgScale(host));
  const radius  = Math.min(DOT_GRID_MAX_RADIUS, Math.max(0.5, spacing * DOT_GRID_RADIUS_RATIO));
  const pattern = document.createElementNS(ns, 'pattern');
  pattern.setAttribute('id', 'mb-vDotGrid-pattern');
  pattern.setAttribute('width',  String(spacing));
  pattern.setAttribute('height', String(spacing));
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', String(spacing / 2));
  dot.setAttribute('cy', String(spacing / 2));
  dot.setAttribute('r',  String(radius));
  dot.setAttribute('fill', dotColor);
  pattern.appendChild(dot);
  defs.appendChild(pattern);

  // The background rect must cover the entire visible canvas across every
  // zoom level so the user never sees a hard SVG edge at the pattern's
  // boundary. Pad 10× the viewBox dimensions — beyond what the zoom
  // range (0.2× .. 4×) could reveal.
  const pad = Math.max(vb.width, vb.height) * 10;
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('class', 'mb-vDotGrid');
  bg.setAttribute('x',      String(vb.x - pad));
  bg.setAttribute('y',      String(vb.y - pad));
  bg.setAttribute('width',  String(vb.width  + pad * 2));
  bg.setAttribute('height', String(vb.height + pad * 2));
  bg.setAttribute('fill', 'url(#mb-vDotGrid-pattern)');
  bg.setAttribute('pointer-events', 'none');
  // Insert as the FIRST renderable child so it always sits behind every
  // other SVG layer (defs come first, but they don't render visually).
  if (defs.nextSibling) svg.insertBefore(bg, defs.nextSibling);
  else                  svg.appendChild(bg);
}

// Remove the dot pattern + background rect — called when the visual
// editor destroys so the static preview doesn't keep showing the grid.
function removeDotGrid(host: HTMLElement): void {
  const svg = host.querySelector<SVGSVGElement>('.mb-svg-host svg');
  if (!svg) return;
  for (const old of Array.from(svg.querySelectorAll('.mb-vDotGrid, #mb-vDotGrid-pattern'))) {
    old.remove();
  }
}

// Update the pattern spacing + dot radius for the current zoom — call on
// every viewport change. Cheap: just attribute writes. The dot's circle
// scales with the new spacing so it stays visible at any zoom level.
function updateDotGrid(host: HTMLElement, scale: number): void {
  const pattern = host.querySelector<SVGPatternElement>('#mb-vDotGrid-pattern');
  if (!pattern) return;
  const spacing = gridSpacingForScale(scale);
  const radius  = Math.min(DOT_GRID_MAX_RADIUS, Math.max(0.5, spacing * DOT_GRID_RADIUS_RATIO));
  pattern.setAttribute('width',  String(spacing));
  pattern.setAttribute('height', String(spacing));
  const dot = pattern.querySelector('circle');
  if (dot) {
    dot.setAttribute('cx', String(spacing / 2));
    dot.setAttribute('cy', String(spacing / 2));
    dot.setAttribute('r',  String(radius));
  }
}

function elementAtPoint(clientX: number, clientY: number, host: HTMLElement): Element | null {
  let el = document.elementFromPoint(clientX, clientY) as Element | null;
  while (el && host.contains(el)) {
    // If we hit our own edge-draft path, a connection dot, or one of the
    // line endpoint handles, look beneath so we still see the snap target.
    if (el.classList.contains('mb-vEdgeDraft') ||
        el.classList.contains('mb-vConn-dot')  ||
        el.classList.contains('mb-vConn')      ||
        el.classList.contains('mb-vLine-handle')) {
      // Temporarily hide pointer events on this element to peek underneath.
      // For SVG handles the style isn't directly addressable; using setAttribute
      // on `pointer-events` works for both HTML + SVG.
      const prev = el.getAttribute('pointer-events');
      el.setAttribute('pointer-events', 'none');
      const beneath = document.elementFromPoint(clientX, clientY) as Element | null;
      if (prev === null) el.removeAttribute('pointer-events');
      else               el.setAttribute('pointer-events', prev);
      el = beneath;
      continue;
    }
    return el;
  }
  return el;
}

function extractMermaidId(g: Element): string | null {
  const rawId = g.getAttribute('id') ?? '';
  // Common forms across mermaid versions:
  //   flowchart-Start-0
  //   <diagramId>-flowchart-Start-0   (mermaid v11 prefixes with the id we
  //                                    pass to mermaid.render)
  //   graph-Process-3
  // We anchor at the end ("-flowchart-<id>-<n>") so any prefix is accepted.
  const m = rawId.match(/-(?:flowchart|graph)-(.+)-\d+$/) ?? rawId.match(/^(?:flowchart|graph)-(.+)-\d+$/);
  if (m) return m[1];
  // Some versions put data-id on the inner shape — check descendants.
  const dataIdEl = g.querySelector('[data-id]');
  const dataId = dataIdEl?.getAttribute('data-id');
  if (dataId) return dataId;
  return null;
}

function positionRingAround(ring: HTMLElement, node: Element, host: HTMLElement): void {
  const nodeRect = node.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  ring.style.left   = `${nodeRect.left - hostRect.left - 4}px`;
  ring.style.top    = `${nodeRect.top  - hostRect.top  - 4}px`;
  ring.style.width  = `${nodeRect.width  + 8}px`;
  ring.style.height = `${nodeRect.height + 8}px`;
}

// ── Resize handles ────────────────────────────────────────────────────────
// Eight grippers around the single-selected node. Dragging a handle scales
// the node via CSS transform (anchored at center, so opposite corners move
// symmetrically — simpler than re-anchoring + translating). The new scale
// commits on mouseup; live edits during the drag stay in the DOM.

type ResizePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface ResizeOverlayHandle {
  el:             HTMLElement;
  attach:         (id: string, node: Element, host: HTMLElement, initialScale: [number, number]) => void;
  positionAround: (node: Element, host: HTMLElement) => void;
  hide:           () => void;
}

function buildResizeOverlay(handlers: {
  onResize:    (id: string, sx: number, sy: number) => void;
  onResizeEnd: (id: string, sx: number, sy: number) => void;
}): ResizeOverlayHandle {
  const el = document.createElement('div');
  el.className = 'mb-vResize mb-hidden';
  const positions: ResizePos[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const handleByPos = new Map<ResizePos, HTMLDivElement>();
  for (const pos of positions) {
    const h = document.createElement('div');
    h.className = 'mb-vResize-handle';
    h.dataset.pos = pos;
    h.title = 'Drag to resize';
    h.setAttribute('aria-label', `Resize handle (${pos})`);
    h.setAttribute('role', 'button');
    el.appendChild(h);
    handleByPos.set(pos, h);
  }

  let currentId: string | null = null;
  let currentNode: Element | null = null;
  let currentHost: HTMLElement | null = null;
  let baseScale: [number, number] = [1, 1];

  function positionHandles(): void {
    if (!currentNode || !currentHost) return;
    const r = currentNode.getBoundingClientRect();
    const h = currentHost.getBoundingClientRect();
    const x = r.left - h.left;
    const y = r.top  - h.top;
    const w = r.width;
    const ht = r.height;
    el.style.left   = `${x}px`;
    el.style.top    = `${y}px`;
    el.style.width  = `${w}px`;
    el.style.height = `${ht}px`;
    const setPos = (pos: ResizePos, cx: number, cy: number): void => {
      const handle = handleByPos.get(pos)!;
      handle.style.left = `${cx}px`;
      handle.style.top  = `${cy}px`;
    };
    setPos('nw', 0,     0);
    setPos('n',  w / 2, 0);
    setPos('ne', w,     0);
    setPos('e',  w,     ht / 2);
    setPos('se', w,     ht);
    setPos('s',  w / 2, ht);
    setPos('sw', 0,     ht);
    setPos('w',  0,     ht / 2);
  }

  // Pointer drag — anchored at node center, so distance to cursor controls
  // the new half-extent. We multiply by 2 to recover the full size.
  el.addEventListener('mousedown', (downEv) => {
    const target = (downEv.target as HTMLElement).closest('.mb-vResize-handle') as HTMLDivElement | null;
    if (!target || !currentId || !currentNode) return;
    downEv.preventDefault();
    downEv.stopPropagation();
    const pos = target.dataset.pos as ResizePos;
    const startRect = currentNode.getBoundingClientRect();
    const startW = startRect.width;
    const startH = startRect.height;
    const cx = startRect.left + startW / 2;
    const cy = startRect.top  + startH / 2;
    // Origin scale (before this drag) — needed so a 2× node scaled to 3×
    // produces sx = 3 / 1 (relative to mermaid's layout), not 3 / 2.
    const baseSx = baseScale[0];
    const baseSy = baseScale[1];
    const unscaledW = startW / baseSx;
    const unscaledH = startH / baseSy;
    let lastSx = baseSx, lastSy = baseSy;

    const move = (e: MouseEvent): void => {
      // Distance from center to cursor → half new extent → full new size.
      const dx = Math.abs(e.clientX - cx);
      const dy = Math.abs(e.clientY - cy);
      let newW = startW;
      let newH = startH;
      if (pos.includes('e') || pos.includes('w')) newW = Math.max(20, dx * 2);
      if (pos.includes('n') || pos.includes('s')) newH = Math.max(20, dy * 2);
      // Shift constrains to a uniform scale (aspect-ratio preserved).
      if (e.shiftKey) {
        const k = Math.max(newW / startW, newH / startH);
        newW = startW * k;
        newH = startH * k;
      }
      lastSx = clampScale(newW / unscaledW);
      lastSy = clampScale(newH / unscaledH);
      handlers.onResize(currentId!, lastSx, lastSy);
    };
    const up = (): void => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup',   up);
      handlers.onResizeEnd(currentId!, lastSx, lastSy);
      baseScale = [lastSx, lastSy];
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup',   up);
  });

  return {
    el,
    attach(id, node, host, initialScale) {
      currentId   = id;
      currentNode = node;
      currentHost = host;
      baseScale   = initialScale;
      positionHandles();
      el.classList.remove('mb-hidden');
    },
    positionAround(node, host) {
      currentNode = node;
      currentHost = host;
      positionHandles();
    },
    hide() {
      currentId = null;
      el.classList.add('mb-hidden');
    },
  };
}

function clampScale(s: number): number {
  // Min 0.25× so the node doesn't collapse below a usable size; max 5× so
  // someone slipping past the edge doesn't blow it up to the whole canvas.
  if (!Number.isFinite(s)) return 1;
  return Math.max(0.25, Math.min(5, s));
}

// ── Positions overlay (Phase 2) ────────────────────────────────────────────

/** Mermaid puts `transform="translate(X, Y)"` on every g.node. Parse it. */
// Snapshot every currently-rendered node's position into mb-positions, but
// only for nodes that aren't already pinned. This is the anchor we set just
// before mutations that would otherwise let mermaid re-run its auto-layout
// (most importantly: adding an edge), so existing nodes stay where they are.
function pinAllRenderedPositions(ast: Ast, host: HTMLElement): void {
  const existing = getPositions(ast) ?? {};
  const snapshot: PositionMap = { ...existing };
  const allNodes = host.querySelectorAll<SVGGElement>('g.node');
  let added = 0;
  for (const n of Array.from(allNodes)) {
    const id = extractMermaidId(n);
    if (!id || existing[id]) continue;
    const t = readNodeTranslate(n);
    if (t) {
      snapshot[id] = [t.x, t.y];
      added++;
    }
  }
  if (added > 0) setAllPositions(ast, snapshot);
}

function readNodeTranslate(g: SVGGElement): { x: number; y: number } | null {
  const t = g.getAttribute('transform') ?? '';
  const m = t.match(/translate\(\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*\)/);
  if (!m) return null;
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

/** How many SVG user units correspond to one CSS pixel — used to convert
    pointer deltas to coordinate-space deltas during a drag. */
function svgUnitsPerPixel(svg: SVGSVGElement): number {
  const vb = svg.viewBox?.baseVal;
  const cssWidth = svg.getBoundingClientRect().width || 1;
  if (vb && vb.width > 0 && cssWidth > 0) return vb.width / cssWidth;
  return 1;
}

/** Fuzzy edge hit-test. Mermaid edges are ~1.5px strokes; we want a click
    within ~8 CSS px of the visible path to count. Samples the path with
    getPointAtLength and finds the closest one. */
function findEdgePathNearClick(clientX: number, clientY: number, host: HTMLElement): SVGPathElement | null {
  const svg = host.querySelector<SVGSVGElement>('.mb-svg-host svg');
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  let local: { x: number; y: number };
  try {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    local = pt.matrixTransform(ctm.inverse());
  } catch { return null; }
  const tolSvg = 8 * svgUnitsPerPixel(svg); // 8 CSS px → svg units
  const paths = host.querySelectorAll<SVGPathElement>('g.edgePaths > path, path.flowchart-link');
  let best: SVGPathElement | null = null;
  let bestDist = Infinity;
  for (const p of Array.from(paths)) {
    let len = 0;
    try { len = p.getTotalLength(); } catch { continue; }
    if (len === 0) continue;
    const samples = Math.min(50, Math.max(12, Math.round(len / 8)));
    for (let i = 0; i <= samples; i++) {
      let s: DOMPoint;
      try { s = p.getPointAtLength((len * i) / samples) as unknown as DOMPoint; } catch { continue; }
      const d = Math.hypot(s.x - local.x, s.y - local.y);
      if (d < tolSvg && d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
  }
  return best;
}

/** Map an absolute client (event) coordinate to a point in the rendered
    mermaid SVG's viewBox space. Uses SVG's native ScreenCTM matrix so any
    parent transforms / preserveAspectRatio offsets are accounted for.
    Returns null if the click missed the SVG. */
function clientToSvgPoint(clientX: number, clientY: number, host: HTMLElement): { x: number; y: number } | null {
  const svg = host.querySelector<SVGSVGElement>('.mb-svg-host svg');
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  try {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  } catch {
    return null;
  }
}

/** Override mermaid's auto-layout positions with the user's pinned ones
    (if any), expand the SVG viewBox to fit them, and redraw every edge as
    a simple bezier between node centers. */
export function applyPositionsOverlay(ast: Ast, host: HTMLElement): void {
  const positions = getPositions(ast);
  if (!positions) return;

  // 1) Override node transforms
  for (const [id, [x, y]] of Object.entries(positions)) {
    const nodeEl = findNodeElementById(id, host);
    if (!nodeEl) continue;
    (nodeEl as SVGGElement).setAttribute('transform', `translate(${x}, ${y})`);
  }

  // 2) Re-fit each subgraph cluster's box around its (now-moved) children.
  // Best-effort: if mermaid's DOM doesn't expose enough info we'll just leave
  // clusters where they are.
  try { fitClusters(host); } catch { /* tolerate */ }

  // 3) Expand SVG viewBox to enclose every (possibly-moved) node. Mermaid's
  // auto-layout sets a tight viewBox; if a user drags a node outside it,
  // the node renders off-screen unless we widen. Skipped when the visual
  // editor has the viewport locked — small edits shouldn't pan/zoom.
  const lockedBlock = host.closest<HTMLElement>('[data-mb-viewport-locked="true"]');
  if (!lockedBlock) fitSvgViewBoxToNodes(host);

  // 4) Recompute edges. We do this for ALL edges, not just ones touching a
  // pinned node — keeps the pipeline simple and avoids partial weirdness.
  recomputeAllEdges(host);
}

/** For each g.cluster, recompute the `<rect>` (or `<polygon>`) so it
    encloses its contained nodes after positions are applied. Padded so the
    box doesn't kiss the node edges. */
// Shape picker — trigger shows the current shape's glyph; popover is an icon
// grid of all supported shapes. Replaces the old text dropdown.
function makeShapePicker(
  onPick: (shape: NodeShape) => void,
): { el: HTMLElement; menu: HTMLElement; setShape: (shape: NodeShape) => void } {
  const wrap = document.createElement('div');
  wrap.className = 'mb-vCtx-popwrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mb-vCtx-btn mb-vCtx-shapetrigger';
  btn.setAttribute('aria-label', 'Change shape');
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.title = 'Change shape';
  btn.innerHTML = shapeIconSvg('rect');

  const menu = document.createElement('div');
  menu.className = 'mb-vCtx-menu mb-vCtx-popLight mb-vCtx-shapegrid mb-hidden';

  const shapes: Array<[NodeShape, string]> = [
    ['rect',          'Rectangle'],
    ['round',         'Rounded rectangle'],
    ['pill',          'Pill'],
    ['circle',        'Circle'],
    ['diamond',       'Diamond'],
    ['hexagon',       'Hexagon'],
    ['cylinder',      'Cylinder'],
    ['subroutine',    'Subroutine'],
    ['trapezoid',     'Trapezoid'],
    ['parallelogram', 'Parallelogram'],
  ];
  const buttons = new Map<NodeShape, HTMLButtonElement>();
  for (const [shape, label] of shapes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mb-vCtx-shapebtn';
    b.dataset.shape = shape;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = shapeIconSvg(shape);
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      menu.classList.add('mb-hidden');
      onPick(shape);
    });
    buttons.set(shape, b);
    menu.appendChild(b);
  }

  btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    menu.classList.toggle('mb-hidden');
    btn.setAttribute('aria-expanded', menu.classList.contains('mb-hidden') ? 'false' : 'true');
  });

  wrap.append(btn, menu);
  return {
    el: wrap,
    menu,
    setShape(shape) {
      btn.innerHTML = shapeIconSvg(shape);
      for (const [s, b] of buttons) {
        const on = s === shape;
        b.classList.toggle('mb-vCtx-shapebtn-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    },
  };
}

function shapeIconSvg(shape: NodeShape): string {
  // 24x24 line glyphs sized to look balanced next to the other toolbar icons.
  const stroke = `fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`;
  switch (shape) {
    case 'rect':
      return `<svg viewBox="0 0 24 24" width="18" height="18" ${stroke}><rect x="4" y="6" width="16" height="12"/></svg>`;
    case 'round':
      return `<svg viewBox="0 0 24 24" width="18" height="18" ${stroke}><rect x="4" y="6" width="16" height="12" rx="4"/></svg>`;
    case 'pill':
      return `<svg viewBox="0 0 24 24" width="18" height="18" ${stroke}><rect x="3" y="8" width="18" height="8" rx="4"/></svg>`;
    case 'circle':
      return `<svg viewBox="0 0 24 24" width="18" height="18" ${stroke}><circle cx="12" cy="12" r="7"/></svg>`;
    case 'diamond':
      return `<svg viewBox="0 0 24 24" width="18" height="18" ${stroke}><path d="M12 3l9 9-9 9-9-9 9-9z"/></svg>`;
    case 'hexagon':
      return `<svg viewBox="0 0 24 24" width="18" height="18" ${stroke}><path d="M7 5h10l5 7-5 7H7l-5-7 5-7z"/></svg>`;
    case 'cylinder':
      return `<svg viewBox="0 0 24 24" width="18" height="18" ${stroke}><ellipse cx="12" cy="7" rx="6" ry="2"/><path d="M6 7v10c0 1.1 2.7 2 6 2s6-.9 6-2V7"/></svg>`;
    case 'subroutine':
      return `<svg viewBox="0 0 24 24" width="18" height="18" ${stroke}><rect x="4" y="6" width="16" height="12"/><line x1="7" y1="6" x2="7" y2="18"/><line x1="17" y1="6" x2="17" y2="18"/></svg>`;
    case 'trapezoid':
      // Wider at the bottom — classic "priority / manual op" shape.
      return `<svg viewBox="0 0 24 24" width="18" height="18" ${stroke}><path d="M7 6h10l4 12H3l4-12z"/></svg>`;
    case 'parallelogram':
      // Lean-right — classic "input / output" shape.
      return `<svg viewBox="0 0 24 24" width="18" height="18" ${stroke}><path d="M8 6h13l-5 12H3l5-12z"/></svg>`;
    case 'text':
    default:
      return `<svg viewBox="0 0 24 24" width="18" height="18" ${stroke}><path d="M5 8h14M12 8v10"/></svg>`;
  }
}

// ── Unified color/style popover ─────────────────────────────────────────────
// One popover with optional line-type row, optional thickness slider, opacity
// slider, "No color" button, and brand + all color swatches. Used by Fill,
// Stroke, and Text-color buttons so all three share the same chrome.

interface ColorPopoverConfig {
  glyph?:        string;
  iconHTML?:     string;
  iconClass?:    string;     // extra class on the trigger button
  ariaLabel:     string;
  tooltip:       string;
  showThickness: boolean;
  showLineType:  boolean;
  onColor:       (c: string) => void;
  onOpacity:     (o: number) => void;
  onThickness?:  (t: number) => void;
  onLineType?:   (t: 'solid' | 'dashed' | 'dotted') => void;
}

interface ColorPopoverState {
  color:     string | null;
  opacity:   number;
  thickness?: number;
  lineType?:  'solid' | 'dashed' | 'dotted';
}

function makeColorPopover(cfg: ColorPopoverConfig): {
  el: HTMLElement;
  setState: (s: ColorPopoverState) => void;
} {
  const wrap = document.createElement('div');
  wrap.className = 'mb-vCtx-popwrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `mb-vCtx-btn mb-vCtx-pillbtn ${cfg.iconClass ?? ''}`;
  btn.setAttribute('aria-label', cfg.ariaLabel);
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.title = cfg.tooltip;
  if (cfg.iconHTML) btn.innerHTML = cfg.iconHTML;
  else              btn.textContent = cfg.glyph ?? '';
  // Tiny underline strip showing the current color (Figma-style).
  const strip = document.createElement('span');
  strip.className = 'mb-vCtx-colorstrip';
  btn.appendChild(strip);

  const pop = document.createElement('div');
  pop.className = 'mb-vCtx-bigpop mb-hidden';

  // Line-type row (stroke popover only).
  let lineTypeRow: { row: HTMLElement; setValue: (t: 'solid' | 'dashed' | 'dotted') => void } | null = null;
  if (cfg.showLineType && cfg.onLineType) {
    const row = document.createElement('div');
    row.className = 'mb-vCtx-types';
    const buttons = new Map<string, HTMLButtonElement>();
    for (const t of ['solid', 'dashed', 'dotted'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mb-vCtx-typebtn';
      b.dataset.type = t;
      b.title = `Line: ${t}`;
      b.setAttribute('aria-label', `Line: ${t}`);
      b.innerHTML = lineGlyph(t, 26);
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        cfg.onLineType!(t);
      });
      buttons.set(t, b);
      row.appendChild(b);
    }
    pop.appendChild(row);
    lineTypeRow = {
      row,
      setValue(t) {
        for (const [k, b] of buttons) b.classList.toggle('mb-vCtx-typebtn-on', k === t);
      },
    };
  }

  let thicknessSlider: { el: HTMLElement; setValue: (v: number) => void } | null = null;
  if (cfg.showThickness && cfg.onThickness) {
    thicknessSlider = makeLightSlider('Thickness', 0, 8, 0.5, 1, 'px', cfg.onThickness);
    pop.appendChild(thicknessSlider.el);
  }
  const opacitySlider = makeLightSlider('Opacity', 10, 100, 5, 100, '%', (v) => cfg.onOpacity(v / 100));
  pop.appendChild(opacitySlider.el);

  // "No color" button.
  const noColorBtn = document.createElement('button');
  noColorBtn.type = 'button';
  noColorBtn.className = 'mb-vCtx-nocolor';
  noColorBtn.title = 'No color';
  noColorBtn.setAttribute('aria-label', 'Clear color');
  noColorBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="5" y1="5" x2="19" y2="19"/></svg><span>No color</span>`;
  noColorBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  noColorBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    cfg.onColor('transparent');
  });
  pop.appendChild(noColorBtn);

  // Brand + all color grids.
  const brandLabel = groupLabel('Brand colors');
  const brandGrid  = colorGrid(BRAND_COLORS, cfg.onColor);
  const allLabel   = groupLabel('All colors');
  const allGrid    = colorGrid(ALL_COLORS,   cfg.onColor);
  pop.append(brandLabel, brandGrid.el, allLabel, allGrid.el);

  btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    pop.classList.toggle('mb-hidden');
    btn.setAttribute('aria-expanded', pop.classList.contains('mb-hidden') ? 'false' : 'true');
  });

  wrap.append(btn, pop);

  return {
    el: wrap,
    setState(s) {
      strip.style.background = s.color && s.color !== 'transparent' ? s.color : 'transparent';
      strip.classList.toggle('mb-vCtx-colorstrip-empty', !s.color || s.color === 'transparent');
      opacitySlider.setValue(Math.round(s.opacity * 100));
      if (thicknessSlider && s.thickness !== undefined) thicknessSlider.setValue(s.thickness);
      if (lineTypeRow    && s.lineType  !== undefined) lineTypeRow.setValue(s.lineType);
      brandGrid.setActive(s.color ?? null);
      allGrid.setActive(s.color ?? null);
    },
  };
}

function groupLabel(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'mb-vCtx-grouplabel';
  d.textContent = text;
  return d;
}

function colorGrid(colors: string[], onPick: (c: string) => void): { el: HTMLElement; setActive: (c: string | null) => void } {
  const grid = document.createElement('div');
  grid.className = 'mb-vCtx-swatches';
  const map = new Map<string, HTMLButtonElement>();
  for (const c of colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mb-vCtx-swatch';
    b.style.background = c;
    b.dataset.color = c;
    b.title = c;
    b.setAttribute('aria-label', `Color ${c}`);
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onPick(c); });
    map.set(c.toLowerCase(), b);
    grid.appendChild(b);
  }
  return {
    el: grid,
    setActive(c) {
      const lc = c?.toLowerCase() ?? '';
      for (const [k, b] of map) b.classList.toggle('mb-vCtx-swatch-on', k === lc);
    },
  };
}

function makeLightSlider(
  label: string, min: number, max: number, step: number,
  initial: number, suffix: string, onChange: (v: number) => void,
): { el: HTMLElement; setValue: (v: number) => void } {
  const wrap = document.createElement('div');
  wrap.className = 'mb-vCtx-sliderwrap';
  const input = document.createElement('input');
  input.type = 'range';
  input.min  = String(min);
  input.max  = String(max);
  input.step = String(step);
  input.value = String(initial);
  input.title = label;
  const row = document.createElement('div');
  row.className = 'mb-vCtx-sliderrow';
  const lab = document.createElement('span');
  lab.textContent = label;
  const val = document.createElement('span');
  val.className = 'mb-vCtx-sliderval';
  val.textContent = `${initial}${suffix}`;
  row.append(lab, val);
  input.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) {
      val.textContent = `${v}${suffix}`;
      onChange(v);
    }
  });
  wrap.append(input, row);
  return {
    el: wrap,
    setValue(v) { input.value = String(v); val.textContent = `${v}${suffix}`; },
  };
}

// Type-style popover: Bold / Italic / Underline / Strike row.
interface TypeStyleState {
  bold:      boolean;
  italic:    boolean;
  underline: boolean;
  strike:    boolean;
}
function makeTypeStylePopover(
  onChange: (partial: Partial<TypeStyleState>) => void,
): { el: HTMLElement; setState: (s: TypeStyleState) => void } {
  const wrap = document.createElement('div');
  wrap.className = 'mb-vCtx-popwrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mb-vCtx-btn mb-vCtx-typetrigger';
  btn.setAttribute('aria-label', 'Text style');
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.title = 'Bold / italic / underline / strike';
  btn.innerHTML = `<span style="font-weight:700;text-decoration:underline">B</span>`;

  const pop = document.createElement('div');
  pop.className = 'mb-vCtx-bigpop mb-vCtx-bigpop-tight mb-hidden';

  const row = document.createElement('div');
  row.className = 'mb-vCtx-types';

  const state: TypeStyleState = { bold: false, italic: false, underline: false, strike: false };
  const buttons = new Map<keyof TypeStyleState, HTMLButtonElement>();
  const items: Array<[keyof TypeStyleState, string, string, string]> = [
    ['bold',      'B', 'Bold',          'font-weight:700'],
    ['italic',    'I', 'Italic',        'font-style:italic'],
    ['underline', 'U', 'Underline',     'text-decoration:underline'],
    ['strike',    'S', 'Strikethrough', 'text-decoration:line-through'],
  ];
  for (const [key, glyph, label, style] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mb-vCtx-typebtn mb-vCtx-typeglyph';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span style="${style}">${glyph}</span>`;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      state[key] = !state[key];
      b.classList.toggle('mb-vCtx-typebtn-on', state[key]);
      b.setAttribute('aria-pressed', state[key] ? 'true' : 'false');
      onChange({ [key]: state[key] } as Partial<TypeStyleState>);
    });
    buttons.set(key, b);
    row.appendChild(b);
  }
  pop.appendChild(row);

  btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    pop.classList.toggle('mb-hidden');
    btn.setAttribute('aria-expanded', pop.classList.contains('mb-hidden') ? 'false' : 'true');
  });

  wrap.append(btn, pop);

  return {
    el: wrap,
    setState(s) {
      Object.assign(state, s);
      for (const [k, b] of buttons) {
        const on = !!state[k];
        b.classList.toggle('mb-vCtx-typebtn-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      // Trigger button reflects whether any text style is on.
      const anyOn = state.bold || state.italic || state.underline || state.strike;
      btn.classList.toggle('mb-vCtx-typetrigger-on', anyOn);
    },
  };
}

// Alignment popover: 3 horizontal + 3 vertical buttons, plus padding +
// line-height segmented controls.
interface AlignmentState {
  textAlign:     'left' | 'center' | 'right';
  verticalAlign: 'top'  | 'middle' | 'bottom';
  padding:       'tight' | 'normal' | 'spacious';
  lineHeight:    'tight' | 'normal';
}
function makeAlignmentPopover(
  onChange: (partial: Partial<AlignmentState>) => void,
): {
  el: HTMLElement;
  setState: (s: AlignmentState) => void;
} {
  const wrap = document.createElement('div');
  wrap.className = 'mb-vCtx-popwrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mb-vCtx-btn mb-vCtx-aligntrigger';
  btn.setAttribute('aria-label', 'Alignment');
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.title = 'Alignment';
  // Three horizontal lines glyph.
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="7"  x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>`;

  const pop = document.createElement('div');
  pop.className = 'mb-vCtx-bigpop mb-vCtx-bigpop-align mb-hidden';

  const hRow = document.createElement('div');
  hRow.className = 'mb-vCtx-alignrow';
  const vRow = document.createElement('div');
  vRow.className = 'mb-vCtx-alignrow';

  const hButtons = new Map<string, HTMLButtonElement>();
  const vButtons = new Map<string, HTMLButtonElement>();

  // Horizontal alignment icons — three short lines biased to the side.
  const hItems: Array<['left' | 'center' | 'right', string, string]> = [
    ['left',   'Align text left',
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/></svg>`],
    ['center', 'Align text center',
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/></svg>`],
    ['right',  'Align text right',
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="6" y1="18" x2="20" y2="18"/></svg>`],
  ];
  for (const [val, label, glyph] of hItems) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mb-vCtx-alignbtn';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = glyph;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onChange({ textAlign: val }); });
    hButtons.set(val, b);
    hRow.appendChild(b);
  }

  // Vertical alignment icons — arrow + line.
  const vItems: Array<['top' | 'middle' | 'bottom', string, string]> = [
    ['top',    'Align text top',
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="5" x2="20" y2="5"/><line x1="12" y1="10" x2="12" y2="20"/><path d="M8 14l4-4 4 4"/></svg>`],
    ['middle', 'Align text middle',
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"/><line x1="12" y1="4" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="20"/></svg>`],
    ['bottom', 'Align text bottom',
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="20" x2="20" y2="20"/><line x1="12" y1="4" x2="12" y2="14"/><path d="M8 10l4 4 4-4"/></svg>`],
  ];
  for (const [val, label, glyph] of vItems) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mb-vCtx-alignbtn';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = glyph;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onChange({ verticalAlign: val }); });
    vButtons.set(val, b);
    vRow.appendChild(b);
  }

  const div = document.createElement('div');
  div.className = 'mb-vCtx-aligndivider';

  // Padding segmented control (tight / normal / spacious).
  const padLabel = document.createElement('div');
  padLabel.className = 'mb-vCtx-segLabel';
  padLabel.textContent = 'Padding';
  const padRow = makeSegRow<'tight' | 'normal' | 'spacious'>(
    [['tight', 'Tight'], ['normal', 'Normal'], ['spacious', 'Spacious']],
    (v) => onChange({ padding: v }),
  );

  // Line-height segmented control (tight / normal).
  const lhLabel = document.createElement('div');
  lhLabel.className = 'mb-vCtx-segLabel';
  lhLabel.textContent = 'Line height';
  const lhRow = makeSegRow<'tight' | 'normal'>(
    [['tight', 'Tight'], ['normal', 'Normal']],
    (v) => onChange({ lineHeight: v }),
  );

  const div2 = document.createElement('div');
  div2.className = 'mb-vCtx-aligndivider';

  pop.append(hRow, div, vRow, div2, padLabel, padRow.el, lhLabel, lhRow.el);

  btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    pop.classList.toggle('mb-hidden');
    btn.setAttribute('aria-expanded', pop.classList.contains('mb-hidden') ? 'false' : 'true');
  });

  wrap.append(btn, pop);
  return {
    el: wrap,
    setState(s) {
      for (const [k, b] of hButtons) {
        const on = k === s.textAlign;
        b.classList.toggle('mb-vCtx-alignbtn-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      for (const [k, b] of vButtons) {
        const on = k === s.verticalAlign;
        b.classList.toggle('mb-vCtx-alignbtn-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      padRow.setValue(s.padding);
      lhRow.setValue(s.lineHeight);
    },
  };
}

// Tiny segmented control used in the alignment popover for padding +
// line-height. Returns the row element + a setter that highlights the active.
function makeSegRow<T extends string>(
  options: Array<[T, string]>,
  onPick: (value: T) => void,
): { el: HTMLElement; setValue: (v: T) => void } {
  const row = document.createElement('div');
  row.className = 'mb-vCtx-segrow';
  row.setAttribute('role', 'radiogroup');
  const buttons = new Map<T, HTMLButtonElement>();
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mb-vCtx-segbtn';
    b.dataset.value = value;
    b.title = label;
    b.textContent = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onPick(value); });
    buttons.set(value, b);
    row.appendChild(b);
  }
  return {
    el: row,
    setValue(v) {
      for (const [k, b] of buttons) {
        const on = k === v;
        b.classList.toggle('mb-vCtx-segbtn-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    },
  };
}

/** Render persisted standalone lines (Phase 10) into a dedicated SVG group.
    Lines aren't part of mermaid's output — we keep them in our own
    `<g class="mb-vLines">` group inside the rendered SVG so they live in the
    same coordinate space and zoom/pan with everything else. We clear and
    rebuild the group on every call to keep state simple (no per-element
    diffing). The cost is trivial since line counts are realistically <50. */
/** Resolve a `LineEndpoint` to live SVG coords.
 *
 * - `free`     → returns the stored coords.
 * - `node`     → looks up the target node's current SVG position + hook offset.
 *                If the node has been deleted, falls back to `lastX/lastY` (a
 *                snapshot from the last successful render, persisted in the
 *                AST). If even that's missing, returns null.
 *
 * Centralized here so both rendering and drag-handle positioning use exactly
 * the same coordinate system. */
export function resolveLineEndpoint(
  e: LineEndpoint,
  host: HTMLElement,
): { x: number; y: number; resolvedFromNode: boolean } | null {
  if (e.kind === 'free') {
    return { x: e.x, y: e.y, resolvedFromNode: false };
  }
  const nodeEl = findNodeElementById(e.id, host) as SVGGElement | null;
  if (nodeEl) {
    const hook = nodeHookPosition(nodeEl, e.side);
    if (hook) return { x: hook.x, y: hook.y, resolvedFromNode: true };
  }
  if (typeof e.lastX === 'number' && typeof e.lastY === 'number') {
    return { x: e.lastX, y: e.lastY, resolvedFromNode: false };
  }
  return null;
}

export function applyStandaloneLinesOverlay(ast: Ast, host: HTMLElement): void {
  const svg = host.querySelector<SVGSVGElement>('.mb-svg-host svg');
  if (!svg) return;
  // Find or create our group. Append last so it paints over mermaid's edges
  // and nodes — these are decorative annotations on top of the diagram.
  let group = svg.querySelector<SVGGElement>('g.mb-vLines');
  if (!group) {
    group = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
    group.setAttribute('class', 'mb-vLines');
    svg.appendChild(group);
  } else {
    // Move to the end on every apply so re-renders that prepend new mermaid
    // content don't bury our lines.
    svg.appendChild(group);
    while (group.firstChild) group.removeChild(group.firstChild);
  }

  const lines = getLines(ast);
  for (const l of lines) {
    const a = resolveLineEndpoint(l.from, host);
    const b = resolveLineEndpoint(l.to,   host);
    if (!a || !b) continue; // both endpoints orphaned + no fallback → skip
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    el.setAttribute('class', 'mb-vLine');
    el.dataset.lineId = l.id;
    // Cache anchor info on the element so DOM-only code (e.g.
    // recomputeLinesTouching during a node drag) can reposition without
    // re-parsing the source.
    if (l.from.kind === 'node') {
      el.dataset.fromNodeId = l.from.id;
      el.dataset.fromSide   = l.from.side;
    }
    if (l.to.kind === 'node') {
      el.dataset.toNodeId = l.to.id;
      el.dataset.toSide   = l.to.side;
    }
    el.setAttribute('x1', String(a.x));
    el.setAttribute('y1', String(a.y));
    el.setAttribute('x2', String(b.x));
    el.setAttribute('y2', String(b.y));
    el.setAttribute('stroke', l.color ?? '#1f2937');
    el.setAttribute('stroke-width', String(l.thickness ?? 1.5));
    el.setAttribute('stroke-linecap', 'round');
    if (l.type === 'dashed')      el.setAttribute('stroke-dasharray', '6 4');
    else if (l.type === 'dotted') el.setAttribute('stroke-dasharray', '2 4');
    else                          el.setAttribute('stroke-dasharray', '0');
    group.appendChild(el);
  }
}

/** Walk the AST's standalone lines; for each anchored endpoint, look up the
 *  target node in the live DOM and stash its current resolved hook position
 *  into `lastX/lastY`. This runs from `mutate()` right before serializing,
 *  so a deletion-style mutation captures the soon-to-be-orphan's position
 *  one last time before the node is removed from the next render. */
function refreshAnchoredLineFallbacks(ast: Ast, host: HTMLElement): void {
  const lines = getLines(ast);
  if (lines.length === 0) return;
  let changed = false;
  const next: LineDecl[] = lines.map(l => {
    const from = freshenEndpoint(l.from, host);
    const to   = freshenEndpoint(l.to,   host);
    if (from === l.from && to === l.to) return l;
    changed = true;
    return { ...l, from, to };
  });
  if (changed) setLines(ast, next);
}
function freshenEndpoint(e: LineEndpoint, host: HTMLElement): LineEndpoint {
  if (e.kind !== 'node') return e;
  const nodeEl = findNodeElementById(e.id, host) as SVGGElement | null;
  if (!nodeEl) return e;
  const hook = nodeHookPosition(nodeEl, e.side);
  if (!hook) return e;
  if (e.lastX === Math.round(hook.x) && e.lastY === Math.round(hook.y)) return e;
  return { ...e, lastX: hook.x, lastY: hook.y };
}

/** Live-update any standalone lines whose endpoint is anchored to the given
 *  node id. Mirrors `recomputeEdgesTouching` but for `g.mb-vLines` children.
 *  Reads anchor info from data-* attrs cached on each <line>, so it's pure
 *  DOM and cheap to call from a drag mousemove handler. */
export function recomputeLinesTouching(id: string, host: HTMLElement): void {
  const lines = host.querySelectorAll<SVGLineElement>('g.mb-vLines > line.mb-vLine');
  for (const el of Array.from(lines)) {
    const touchesFrom = el.dataset.fromNodeId === id;
    const touchesTo   = el.dataset.toNodeId   === id;
    if (!touchesFrom && !touchesTo) continue;
    if (touchesFrom && el.dataset.fromSide) {
      const nodeEl = findNodeElementById(id, host) as SVGGElement | null;
      if (nodeEl) {
        const hook = nodeHookPosition(nodeEl, el.dataset.fromSide as 'n' | 'e' | 's' | 'w');
        if (hook) {
          el.setAttribute('x1', String(hook.x));
          el.setAttribute('y1', String(hook.y));
        }
      }
    }
    if (touchesTo && el.dataset.toSide) {
      const nodeEl = findNodeElementById(id, host) as SVGGElement | null;
      if (nodeEl) {
        const hook = nodeHookPosition(nodeEl, el.dataset.toSide as 'n' | 'e' | 's' | 'w');
        if (hook) {
          el.setAttribute('x2', String(hook.x));
          el.setAttribute('y2', String(hook.y));
        }
      }
    }
  }
}

/** Apply per-node + per-edge style overrides (Phases 5 + 9) to the rendered SVG. */
export function applyStylesOverlay(ast: Ast, host: HTMLElement): void {
  const styles = getStyles(ast);
  if (styles) {
    for (const [id, s] of Object.entries(styles)) {
      const g = findNodeElementById(id, host);
      if (!g) continue;
      applyStyleToNode(g as SVGGElement, s);
    }
  }

  // Per-edge styles
  const edgeStyles = getEdgeStyles(ast);
  if (edgeStyles) {
    // Build index: for each "from-to" pair, track which path is the n-th.
    const counters = new Map<string, number>();
    const paths = host.querySelectorAll<SVGPathElement>('g.edgePaths > path, path.flowchart-link');
    for (const p of Array.from(paths)) {
      const ep = parseEdgeEndpoints(p);
      if (!ep) continue;
      const pair = `${ep.from}->${ep.to}`;
      const idx = counters.get(pair) ?? 0;
      counters.set(pair, idx + 1);
      const key = `${ep.from}->${ep.to}->${idx}`;
      const s = edgeStyles[key];
      if (!s) continue;
      applyEdgeStyle(p, s, key);
    }
  }
}

function applyEdgeStyle(p: SVGPathElement, s: EdgeStyle, key: string): void {
  if (s.color !== undefined) {
    p.style.setProperty('stroke', s.color, 'important');
  }
  if (s.thickness !== undefined) {
    p.style.setProperty('stroke-width', `${s.thickness}px`, 'important');
  }
  if (s.opacity !== undefined) {
    p.style.setProperty('opacity', String(s.opacity), 'important');
  }
  // Marching-ants animation needs a dashed stroke to move. If the edge has
  // animation set but no explicit type, force dashed so the animation has
  // dashes to march. This also protects against mermaid's `edge-pattern-solid`
  // class resetting the dasharray after a selection re-render.
  const animOn = s.animation && s.animation !== 'none';
  const effectiveType = s.type ?? (animOn ? 'dashed' : undefined);
  if (effectiveType === 'dashed' || effectiveType === 'dotted') {
    p.style.setProperty('stroke-dasharray', effectiveType === 'dashed' ? '6 4' : '2 4', 'important');
    // Round line caps make dashes look like pills (much nicer than square ends).
    p.style.setProperty('stroke-linecap', 'round', 'important');
  } else if (effectiveType === 'solid') {
    p.style.setProperty('stroke-dasharray', '0', 'important');
    p.style.setProperty('stroke-linecap', 'butt', 'important');
  }

  // Animation: slow/fast classes drive the keyframes duration; the reverse
  // class flips `animation-direction` so dashes travel away from the arrow.
  const wantsAnim = animOn && effectiveType !== 'solid';
  p.classList.toggle('mb-vEdge-anim-slow',    wantsAnim && s.animation === 'slow');
  p.classList.toggle('mb-vEdge-anim-fast',    wantsAnim && s.animation === 'fast');
  p.classList.toggle('mb-vEdge-anim-reverse', !!wantsAnim && s.animationDirection === 'reverse');

  // Endpoint caps. If color OR thickness is overridden we build a per-edge
  // custom marker so its color tracks the line and its size scales with
  // thickness (logarithmic mapping, capped). Otherwise we point to the
  // shared mermaid marker.
  const wantsCustom = (s.color !== undefined) || (s.thickness !== undefined && s.thickness > 1.6);
  if (s.startCap !== undefined) {
    p.setAttribute('marker-start', resolveMarker(p, 'start', s.startCap, key, s, wantsCustom) ?? '');
  }
  if (s.endCap !== undefined) {
    p.setAttribute('marker-end',   resolveMarker(p, 'end',   s.endCap,   key, s, wantsCustom) ?? '');
  }
  // Even if the user didn't pick caps explicitly, recolor the default end
  // marker (which is what most edges land on) when a line color is set.
  if (wantsCustom && s.endCap === undefined) {
    const currentEnd = p.getAttribute('marker-end');
    if (currentEnd && currentEnd !== 'none') {
      p.setAttribute('marker-end', resolveMarker(p, 'end', detectCapFromUrl(currentEnd), key, s, true) ?? currentEnd);
    }
  }
}

function detectCapFromUrl(url: string): EdgeCap {
  if (/circle(Start|End)/.test(url)) return 'circle';
  if (/cross(Start|End)/.test(url))  return 'arrow';   // fallback
  if (/point(Start|End)/.test(url))  return 'arrow';
  return 'none';
}

function resolveMarker(p: SVGPathElement, which: 'start' | 'end', cap: EdgeCap, key: string, s: EdgeStyle, wantsCustom: boolean): string | null {
  if (cap === 'none') return null;
  const svg = p.ownerSVGElement;
  if (!svg) return null;

  // Extract the mermaid prefix from any marker reference on the page.
  const refAttr = p.getAttribute(which === 'start' ? 'marker-start' : 'marker-end')
                ?? p.getAttribute(which === 'end'   ? 'marker-end'   : 'marker-start')
                ?? '';
  let prefix = '';
  const m = refAttr.match(/url\(#(.+?)(point|circle|cross)(Start|End)\b/);
  if (m) prefix = m[1];
  else {
    const sample = svg.querySelector<SVGMarkerElement>('marker[id*="pointEnd"]');
    if (sample) {
      const im = sample.id.match(/^(.+?)point(Start|End)/);
      if (im) prefix = im[1];
    }
  }
  const kind = cap === 'arrow' ? 'point' : cap === 'circle' ? 'circle' : '';
  if (!kind || !prefix) return null;
  const suffix = which === 'start' ? 'Start' : 'End';
  const baseId = `${prefix}${kind}${suffix}`;

  if (!wantsCustom) {
    return `url(#${baseId})`;
  }

  // Build (or update) a custom marker so its color + size follow the edge.
  const baseMarker = svg.querySelector<SVGMarkerElement>(`#${cssEscape(baseId)}`);
  if (!baseMarker) return `url(#${baseId})`;

  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  const customId = `mb-marker-${safeKey}-${which}-${kind}`;
  let custom = svg.querySelector<SVGMarkerElement>(`#${cssEscape(customId)}`);
  if (!custom) {
    custom = baseMarker.cloneNode(true) as SVGMarkerElement;
    custom.setAttribute('id', customId);
    baseMarker.parentNode?.appendChild(custom);
  }

  // Color the marker's children (path/polygon/circle).
  const color = s.color;
  if (color) {
    for (const el of Array.from(custom.querySelectorAll<SVGGraphicsElement>('path, polygon, circle'))) {
      el.style.setProperty('fill',   color, 'important');
      el.style.setProperty('stroke', color, 'important');
    }
  }

  // Scale with thickness — logarithmic, capped to avoid huge or tiny heads.
  const baseW = parseFloat(baseMarker.getAttribute('markerWidth')  ?? '12');
  const baseH = parseFloat(baseMarker.getAttribute('markerHeight') ?? '12');
  const t = s.thickness ?? 1.5;
  const scale = Math.min(2.5, Math.max(0.8, 0.6 + Math.log2(t + 1) * 0.5));
  custom.setAttribute('markerWidth',  String(Math.round(baseW * scale)));
  custom.setAttribute('markerHeight', String(Math.round(baseH * scale)));

  return `url(#${customId})`;
}

function cssEscape(s: string): string {
  // CSS.escape isn't universal; we mostly need to escape the underscore in
  // mermaid's id format. A conservative escape just adds backslashes before
  // special chars. For our generated ids we can do a simpler swap.
  return (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS?.escape?.(s) ?? s;
}

// ── Edge selection marker tint ─────────────────────────────────────────────
// When an edge is selected its path turns blue (CSS). Mermaid arrow heads are
// rendered via SVG <marker> referenced from the path's marker-start /
// marker-end, and SVG markers don't inherit the path's stroke. So we swap the
// path's marker URLs to a blue-tinted clone while selected, then restore them
// when the edge is deselected.

const SELECTION_BLUE = '#6366f1';

function selectionMarkerId(baseId: string): string { return `mb-marker-sel-${baseId}`; }

function buildSelectionMarker(p: SVGPathElement, currentUrl: string): string | null {
  const m = currentUrl.match(/url\(#(.+?)\)/);
  if (!m) return null;
  const baseId = m[1];
  const svg = p.ownerSVGElement;
  if (!svg) return null;
  const baseMarker = svg.querySelector<SVGMarkerElement>(`#${cssEscape(baseId)}`);
  if (!baseMarker) return null;
  const selId = selectionMarkerId(baseId);
  let sel = svg.querySelector<SVGMarkerElement>(`#${cssEscape(selId)}`);
  if (!sel) {
    sel = baseMarker.cloneNode(true) as SVGMarkerElement;
    sel.setAttribute('id', selId);
    baseMarker.parentNode?.appendChild(sel);
  } else {
    // Keep the clone's geometry in sync with the (possibly thickness-scaled)
    // base — otherwise the head shrinks back to default size on re-selection.
    const w = baseMarker.getAttribute('markerWidth');
    const h = baseMarker.getAttribute('markerHeight');
    if (w) sel.setAttribute('markerWidth',  w);
    if (h) sel.setAttribute('markerHeight', h);
  }
  for (const el of Array.from(sel.querySelectorAll<SVGGraphicsElement>('path, polygon, circle'))) {
    el.style.setProperty('fill',   SELECTION_BLUE, 'important');
    el.style.setProperty('stroke', SELECTION_BLUE, 'important');
  }
  return `url(#${selId})`;
}

function setEdgePathSelected(p: SVGPathElement, selected: boolean): void {
  if (selected) {
    if (p.classList.contains('mb-vEdgeSelected')) return;
    p.classList.add('mb-vEdgeSelected');
    for (const which of ['start', 'end'] as const) {
      const attr = which === 'start' ? 'marker-start' : 'marker-end';
      const cur = p.getAttribute(attr);
      if (!cur || cur === 'none') continue;
      const datasetKey = which === 'start' ? 'mbOrigMarkerStart' : 'mbOrigMarkerEnd';
      if (!p.dataset[datasetKey]) p.dataset[datasetKey] = cur;
      const blueUrl = buildSelectionMarker(p, cur);
      if (blueUrl) p.setAttribute(attr, blueUrl);
    }
  } else {
    if (!p.classList.contains('mb-vEdgeSelected')) return;
    p.classList.remove('mb-vEdgeSelected');
    if (p.dataset.mbOrigMarkerStart) {
      p.setAttribute('marker-start', p.dataset.mbOrigMarkerStart);
      delete p.dataset.mbOrigMarkerStart;
    }
    if (p.dataset.mbOrigMarkerEnd) {
      p.setAttribute('marker-end', p.dataset.mbOrigMarkerEnd);
      delete p.dataset.mbOrigMarkerEnd;
    }
  }
}

function clearAllEdgeSelections(root: Element): void {
  root.querySelectorAll<SVGPathElement>('path.mb-vEdgeSelected').forEach(p => setEdgePathSelected(p, false));
}

function applyStyleToNode(g: SVGGElement, s: NodeStyle): void {
  // Background shape: rect / circle / polygon / path drawn inside g.node.
  // Mermaid often wraps these in <g class="basic ...">. Mermaid v11 sets
  // inline `style="fill:..."` on the shape elements, which BEATS a plain
  // `fill="..."` attribute. So we must override via the `style` property
  // (CSSStyleDeclaration). Setting both keeps us compatible with older
  // mermaid versions.
  const shapes = g.querySelectorAll<SVGGraphicsElement>(
    'rect, circle, ellipse, polygon, path',
  );
  for (const el of Array.from(shapes)) {
    if (s.fill !== undefined) {
      el.setAttribute('fill', s.fill);
      el.style.setProperty('fill', s.fill, 'important');
    }
    if (s.border !== undefined) {
      el.setAttribute('stroke', s.border);
      el.style.setProperty('stroke', s.border, 'important');
    }
    if (s.borderWidth !== undefined) {
      el.setAttribute('stroke-width', String(s.borderWidth));
      el.style.setProperty('stroke-width', `${s.borderWidth}px`, 'important');
    }
    if (s.strokeType !== undefined) {
      const dash = s.strokeType === 'dashed' ? '6 4'
                 : s.strokeType === 'dotted' ? '2 4'
                 : '0';
      el.style.setProperty('stroke-dasharray', dash, 'important');
    }
  }
  // Opacity on the whole node group so background, border, and label fade
  // together. Don't combine with the resize CSS transform — they're separate
  // CSS properties on the same element.
  if (s.opacity !== undefined) {
    g.style.setProperty('opacity', String(s.opacity), 'important');
  }
  // Resize: rewrite the shape's geometric attributes (width/height for rect,
  // r for circle, points for polygon, etc.). This keeps the node anchored at
  // mermaid's translate(x,y) so it doesn't visually jump, and leaves the
  // label + stroke at their natural size — only the container grows.
  if (s.scale) {
    applyNodeScale(g, s.scale[0], s.scale[1]);
  }

  // Label color + font size + weight live in a foreignObject containing
  // .nodeLabel (mermaid v11). Use !important since mermaid stylesheets often
  // set these via class rules with higher specificity.
  const labelDivs = g.querySelectorAll<HTMLElement>('foreignObject .nodeLabel, foreignObject div, .label, span.nodeLabel');
  for (const labelDiv of Array.from(labelDivs)) {
    if (s.text       !== undefined) labelDiv.style.setProperty('color',       s.text,           'important');
    if (s.fontSize   !== undefined) labelDiv.style.setProperty('font-size',   `${s.fontSize}px`, 'important');
    if (s.bold       !== undefined) labelDiv.style.setProperty('font-weight', s.bold ? '700' : '', 'important');
    if (s.italic     !== undefined) labelDiv.style.setProperty('font-style',  s.italic ? 'italic' : '', 'important');
    if (s.textAlign  !== undefined) labelDiv.style.setProperty('text-align',  s.textAlign,      'important');
    // Underline + strike combine into one text-decoration-line value so they
    // can co-exist on the same label.
    if (s.underline !== undefined || s.strike !== undefined) {
      const parts: string[] = [];
      if (s.underline) parts.push('underline');
      if (s.strike)    parts.push('line-through');
      labelDiv.style.setProperty('text-decoration', parts.length ? parts.join(' ') : 'none', 'important');
    }
    if (s.lineHeight !== undefined) {
      const lh = s.lineHeight === 'tight' ? '1.1' : '1.4';
      labelDiv.style.setProperty('line-height', lh, 'important');
    }
    if (s.padding !== undefined) {
      const p = s.padding === 'tight' ? '2px 6px'
              : s.padding === 'normal' ? '6px 12px'
              : '12px 20px';
      labelDiv.style.setProperty('padding', p, 'important');
    }
  }
  // The foreignObject hosts the label. We can shift it vertically inside the
  // shape to approximate top/middle/bottom alignment — mermaid leaves the
  // foreignObject centered by default, so positive Y nudges it down. For
  // 'middle' (the natural state), clear any prior transform so the label
  // returns to mermaid's default centering rather than carrying a stale
  // translate computed against a previous shape's half-extent.
  if (s.verticalAlign !== undefined) {
    const foreignObj = g.querySelector<SVGForeignObjectElement>('foreignObject');
    if (foreignObj) {
      if (s.verticalAlign === 'middle') {
        foreignObj.style.removeProperty('transform');
      } else {
        const half = nodeHalfExtent(g);
        const labelH = parseFloat(foreignObj.getAttribute('height') ?? '0') || 0;
        const dy = s.verticalAlign === 'top'
          ? -(half.h - labelH / 2 - 4)
          :  (half.h - labelH / 2 - 4);
        foreignObj.style.setProperty('transform', `translateY(${dy}px)`, 'important');
      }
    }
  }
  // Some mermaid versions render labels as <text> directly.
  const textEl = g.querySelector<SVGTextElement>('text.nodeLabel, text');
  if (textEl) {
    if (s.text     !== undefined) {
      textEl.setAttribute('fill', s.text);
      textEl.style.setProperty('fill', s.text, 'important');
    }
    if (s.fontSize !== undefined) {
      textEl.setAttribute('font-size', String(s.fontSize));
      textEl.style.setProperty('font-size', `${s.fontSize}px`, 'important');
    }
    if (s.bold !== undefined) {
      textEl.setAttribute('font-weight', s.bold ? '700' : '400');
    }
    if (s.italic !== undefined) {
      textEl.setAttribute('font-style', s.italic ? 'italic' : 'normal');
    }
    if (s.underline !== undefined || s.strike !== undefined) {
      const parts: string[] = [];
      if (s.underline) parts.push('underline');
      if (s.strike)    parts.push('line-through');
      textEl.setAttribute('text-decoration', parts.length ? parts.join(' ') : 'none');
    }
    if (s.textAlign !== undefined) {
      textEl.setAttribute('text-anchor',
        s.textAlign === 'left' ? 'start' : s.textAlign === 'right' ? 'end' : 'middle');
    }
  }
}

// ── Geometric resize ──────────────────────────────────────────────────────
// Instead of CSS transform (which scales the label + stroke too, and jumps
// around because of transform-origin vs mermaid's translate), we rewrite the
// shape's geometric attributes: width/height for rect, r for circle, points
// for polygon, etc. The label stays at its natural size, the stroke keeps
// its width, and the node stays anchored at mermaid's translate(x,y).
//
// Each rerender, the SVG comes back fresh from mermaid (default dimensions),
// so we cache the original dimensions in dataset on first apply per render
// and compute the scaled values from those.

// Minimum width/height a shape must keep so its label doesn't overflow. We
// read the foreignObject's natural box (mermaid sized it to fit the text)
// plus a small breathing pad.
function labelMinExtent(g: SVGGElement): { w: number; h: number } {
  const fo = g.querySelector('foreignObject');
  if (!fo) return { w: 0, h: 0 };
  const w = parseFloat(fo.getAttribute('width')  ?? '0') || 0;
  const h = parseFloat(fo.getAttribute('height') ?? '0') || 0;
  const PAD = 8;
  return { w: w + PAD * 2, h: h + PAD * 2 };
}

function findPrimaryShape(g: SVGGElement): SVGGraphicsElement | null {
  // Mermaid v11 wraps the background shape in g.basic (sometimes nested).
  // Prefer the first shape inside that wrapper; fall back to direct children
  // of g.node. Skip label-related shapes living inside foreignObject / .label.
  const inBasic = g.querySelector<SVGGraphicsElement>(
    'g.basic > rect, g.basic > circle, g.basic > ellipse, g.basic > polygon, g.basic > path',
  );
  if (inBasic) return inBasic;
  for (const child of Array.from(g.children) as Element[]) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'rect' || tag === 'circle' || tag === 'ellipse' || tag === 'polygon' || tag === 'path') {
      return child as SVGGraphicsElement;
    }
  }
  return null;
}

function applyNodeScale(g: SVGGElement, sx: number, sy: number): void {
  const shape = findPrimaryShape(g);
  if (!shape) return;
  const tag = shape.tagName.toLowerCase();
  const ds = (shape as SVGGraphicsElement & { dataset: DOMStringMap }).dataset;

  // Don't allow the shape to shrink smaller than its label, otherwise the
  // text overflows visibly. We measure the label's foreignObject and use it
  // as a floor on the new dimensions.
  const labelFloor = labelMinExtent(g);

  if (tag === 'rect') {
    let oW = parseFloat(ds.mbOrigW ?? '');
    let oH = parseFloat(ds.mbOrigH ?? '');
    if (!isFinite(oW) || !isFinite(oH)) {
      oW = parseFloat(shape.getAttribute('width') ?? '0');
      oH = parseFloat(shape.getAttribute('height') ?? '0');
      ds.mbOrigW = String(oW);
      ds.mbOrigH = String(oH);
    }
    const newW = Math.max(oW * sx, labelFloor.w);
    const newH = Math.max(oH * sy, labelFloor.h);
    shape.setAttribute('width',  String(newW));
    shape.setAttribute('height', String(newH));
    // Recenter around (0,0) so mermaid's translate keeps the node in place.
    shape.setAttribute('x', String(-newW / 2));
    shape.setAttribute('y', String(-newH / 2));
  } else if (tag === 'circle') {
    let oR = parseFloat(ds.mbOrigR ?? '');
    if (!isFinite(oR)) {
      oR = parseFloat(shape.getAttribute('r') ?? '0');
      ds.mbOrigR = String(oR);
    }
    // Use the average scale so a non-uniform drag still grows the circle.
    shape.setAttribute('r', String(oR * (sx + sy) / 2));
  } else if (tag === 'ellipse') {
    let oRx = parseFloat(ds.mbOrigRx ?? '');
    let oRy = parseFloat(ds.mbOrigRy ?? '');
    if (!isFinite(oRx) || !isFinite(oRy)) {
      oRx = parseFloat(shape.getAttribute('rx') ?? '0');
      oRy = parseFloat(shape.getAttribute('ry') ?? '0');
      ds.mbOrigRx = String(oRx);
      ds.mbOrigRy = String(oRy);
    }
    shape.setAttribute('rx', String(oRx * sx));
    shape.setAttribute('ry', String(oRy * sy));
  } else if (tag === 'polygon') {
    let orig = ds.mbOrigPoints;
    if (!orig) {
      orig = shape.getAttribute('points') ?? '';
      ds.mbOrigPoints = orig;
    }
    const scaled = orig.trim().split(/\s+/).map((pt: string) => {
      const [px, py] = pt.split(',').map(parseFloat);
      return `${px * sx},${py * sy}`;
    }).join(' ');
    shape.setAttribute('points', scaled);
  } else if (tag === 'path') {
    // Path-based shapes (cylinder, subroutine, callout). Geometric scaling
    // of an arbitrary `d` is hard. Instead, we scale the path via its own
    // SVG transform attribute, anchored at the path's bbox center, and
    // PRESERVE whatever transform mermaid originally put on the path
    // (typically a translate that aligns the path inside g.node). The
    // g.node's translate stays untouched so the node doesn't jump.
    let origT = ds.mbOrigPathTransform;
    let oCx = parseFloat(ds.mbOrigPathCx ?? '');
    let oCy = parseFloat(ds.mbOrigPathCy ?? '');
    if (origT === undefined || !isFinite(oCx) || !isFinite(oCy)) {
      origT = shape.getAttribute('transform') ?? '';
      ds.mbOrigPathTransform = origT;
      try {
        const bb = shape.getBBox();
        oCx = bb.x + bb.width / 2;
        oCy = bb.y + bb.height / 2;
      } catch { oCx = 0; oCy = 0; }
      ds.mbOrigPathCx = String(oCx);
      ds.mbOrigPathCy = String(oCy);
    }
    // Compose: ${origT} (mermaid's transform, outermost) then a
    // translate-scale-translate around (oCx, oCy) so the path grows from
    // its visual center rather than its d-coord origin.
    const prefix = origT ? `${origT} ` : '';
    shape.setAttribute('transform',
      `${prefix}translate(${oCx}, ${oCy}) scale(${sx}, ${sy}) translate(${-oCx}, ${-oCy})`);
  }
  // Clear any prior CSS transform we may have stamped on the g — older
  // renders applied scale that way and the rule should no longer apply.
  if (g.style.transform) {
    g.style.removeProperty('transform');
    g.style.removeProperty('transform-box');
    g.style.removeProperty('transform-origin');
  }
}

function fitClusters(host: HTMLElement): void {
  const clusters = host.querySelectorAll<SVGGElement>('g.cluster');
  const PAD = 24;
  const LABEL_TOP_PAD = 10;
  for (const cluster of Array.from(clusters)) {
    const rect = cluster.querySelector<SVGRectElement>('rect');
    if (!rect) continue;
    // Find nodes inside this cluster — mermaid usually nests them, but the
    // structure varies. We use a heuristic: any g.node whose center falls
    // inside the cluster's bbox before the overlay. Easier path: read the
    // cluster's data attribute (if mermaid sets one) or use the children of
    // the cluster's parent group. We fall back to "all nodes that mermaid
    // tagged as belonging to this cluster" via id naming.
    const clusterIdRaw = cluster.getAttribute('id') ?? '';
    const clusterId = clusterIdRaw.match(/(?:flowchart|graph)-([\w-]+?)(?:-\d+)?$/)?.[1];
    if (!clusterId) continue;
    // mermaid sets parentLookupDb but doesn't expose it in DOM; we instead
    // measure all nodes that sit *visually* inside the cluster's original
    // rect (the rect that mermaid drew before we touched it).
    const innerNodes = findNodesInsideRect(host, rect);
    if (innerNodes.length === 0) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of innerNodes) {
      const t = readNodeTranslate(n);
      if (!t) continue;
      const half = nodeHalfExtent(n);
      minX = Math.min(minX, t.x - half.w);
      minY = Math.min(minY, t.y - half.h);
      maxX = Math.max(maxX, t.x + half.w);
      maxY = Math.max(maxY, t.y + half.h);
    }
    if (!isFinite(minX)) continue;

    rect.setAttribute('x',      String(minX - PAD));
    rect.setAttribute('y',      String(minY - PAD - LABEL_TOP_PAD));
    rect.setAttribute('width',  String(maxX - minX + PAD * 2));
    rect.setAttribute('height', String(maxY - minY + PAD * 2 + LABEL_TOP_PAD));

    // Re-position the cluster label (g.cluster-label) at the top-center.
    const label = cluster.querySelector<SVGGElement>('g.cluster-label, g.label');
    if (label) {
      const cx = (minX + maxX) / 2;
      const ly = minY - PAD - LABEL_TOP_PAD / 2;
      label.setAttribute('transform', `translate(${cx}, ${ly})`);
    }
  }
}

function findNodesInsideRect(host: HTMLElement, rect: SVGRectElement): SVGGElement[] {
  const rx = parseFloat(rect.getAttribute('x') ?? '0');
  const ry = parseFloat(rect.getAttribute('y') ?? '0');
  const rw = parseFloat(rect.getAttribute('width')  ?? '0');
  const rh = parseFloat(rect.getAttribute('height') ?? '0');
  if (rw === 0 || rh === 0) return [];
  // Account for any inherited transform on the cluster ancestor chain.
  // For mermaid's typical structure, the cluster's rect is in the same
  // coordinate space as the nodes (both inside the same root group).
  const inside: SVGGElement[] = [];
  const all = host.querySelectorAll<SVGGElement>('g.node');
  for (const n of Array.from(all)) {
    const t = readNodeTranslate(n);
    if (!t) continue;
    // We check the node's ORIGINAL (pre-overlay) position, but at this
    // point overlay has already moved nodes. As a fallback we use a
    // generous bbox check: if the node CENTER is anywhere within ±rect
    // padded by 32 units, treat it as inside.
    if (t.x >= rx - 32 && t.x <= rx + rw + 32 && t.y >= ry - 32 && t.y <= ry + rh + 32) {
      inside.push(n);
    }
  }
  return inside;
}

function fitSvgViewBoxToNodes(host: HTMLElement): void {
  const svg = host.querySelector<SVGSVGElement>('svg');
  if (!svg) return;

  const nodes = host.querySelectorAll<SVGGElement>('g.node');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of Array.from(nodes)) {
    const t = readNodeTranslate(n);
    if (!t) continue;
    // getBBox on a node returns the bbox of its children in local coords
    // (before the g's transform). Mermaid centers shapes at (0,0), so the
    // bbox tends to be roughly (-w/2, -h/2, w, h). Treat as half-extents.
    let half = 40;
    try {
      const bb = n.getBBox();
      half = Math.max(Math.abs(bb.x), Math.abs(bb.x + bb.width), Math.abs(bb.y), Math.abs(bb.y + bb.height));
    } catch { /* getBBox can throw on detached nodes — ignore */ }
    minX = Math.min(minX, t.x - half);
    minY = Math.min(minY, t.y - half);
    maxX = Math.max(maxX, t.x + half);
    maxY = Math.max(maxY, t.y + half);
  }
  if (!isFinite(minX)) return;

  const current = svg.viewBox?.baseVal;
  const PAD = 20;
  let x = minX - PAD;
  let y = minY - PAD;
  let w = maxX - minX + PAD * 2;
  let h = maxY - minY + PAD * 2;
  // Never shrink an existing viewBox — keeps zoom feel stable when the user
  // drags a node back inside the original bounds.
  if (current) {
    const cx2 = current.x + current.width;
    const cy2 = current.y + current.height;
    x = Math.min(x, current.x);
    y = Math.min(y, current.y);
    w = Math.max(cx2, x + w) - x;
    h = Math.max(cy2, y + h) - y;
  }

  // Free-canvas mode (when the block is in visual-edit). Expand the viewBox
  // to fill the preview pane's aspect ratio so the SVG can stretch to the
  // edges — that gives users empty space around the diagram to drop new
  // nodes into instead of pushing them off the top/side. We key off
  // `mb-visual-active` because it's added inside createVisualEditor (more
  // reliable than `mb-visual`, which the block extension manages).
  const visualBlock = host.closest('.mb-visual, .mb-visual-active') as HTMLElement | null;
  if (visualBlock) {
    const preview = host.closest<HTMLElement>('.mb-preview') ?? host;
    const pr = preview.getBoundingClientRect();
    if (pr.width > 0 && pr.height > 0) {
      const previewAspect = pr.width / pr.height;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const viewAspect = w / h;
      if (viewAspect > previewAspect) {
        // Diagram is wider than preview — grow height to match.
        const newH = w / previewAspect;
        y = cy - newH / 2;
        h = newH;
      } else {
        // Diagram is taller — grow width to match.
        const newW = h * previewAspect;
        x = cx - newW / 2;
        w = newW;
      }
    }
  }

  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  if (visualBlock) {
    // Fill the preview pane both width and height — the viewBox above
    // matches the aspect ratio so nothing letterboxes.
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.width  = '100%';
    svg.style.height = '100%';
    svg.style.maxWidth = '100%';
  } else {
    // Static preview keeps its natural sizing.
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.maxWidth = '100%';
    svg.style.height = 'auto';
  }
}

/** Walks every edge element in the SVG and yields { element, from, to }. */
function* eachEdge(host: HTMLElement): Iterable<{ el: SVGPathElement; from: string; to: string }> {
  // Mermaid v11 emits `<path id="…-L_from_to_n" class="flowchart-link …">`
  // directly inside `g.edgePaths` (no wrapping `g.edgePath`).
  const paths = host.querySelectorAll<SVGPathElement>('g.edgePaths > path, g.edgePaths g.edgePath > path.path, g.edgePath > path.path');
  for (const p of Array.from(paths)) {
    const ep = parseEdgeEndpoints(p);
    if (ep) yield { el: p, from: ep.from, to: ep.to };
  }
}

function recomputeAllEdges(host: HTMLElement): void {
  for (const e of eachEdge(host)) {
    redrawEdge(e.el, e.from, e.to, host);
  }
}

function recomputeEdgesTouching(id: string, host: HTMLElement): void {
  for (const e of eachEdge(host)) {
    if (e.from !== id && e.to !== id) continue;
    redrawEdge(e.el, e.from, e.to, host);
  }
}

function redrawEdge(pathEl: SVGPathElement, fromId: string, toId: string, host: HTMLElement): void {
  const fromNode = findNodeElementById(fromId, host) as SVGGElement | null;
  const toNode   = findNodeElementById(toId,   host) as SVGGElement | null;
  if (!fromNode || !toNode) return;
  const aCenter = readNodeTranslate(fromNode);
  const bCenter = readNodeTranslate(toNode);
  if (!aCenter || !bCenter) return;
  const aEdge = shrinkToNodeEdge(aCenter, fromNode, bCenter);
  const bEdge = shrinkToNodeEdge(bCenter, toNode,   aCenter);
  pathEl.setAttribute('d', bezierPath(aEdge, bEdge));

  // Mermaid renders each edge's label as a sibling <g.edgeLabel> inside
  // g.edgeLabels, in the same document order as g.edgePaths > path. Moving
  // the path leaves the label stranded at its original midpoint, so we
  // re-translate the label to the new path midpoint.
  const edgePaths = pathEl.parentElement;
  const edgeLabels = host.querySelector<SVGGElement>('g.edgeLabels');
  if (!edgePaths || !edgeLabels) return;
  const idx = Array.from(edgePaths.querySelectorAll<SVGPathElement>(':scope > path')).indexOf(pathEl);
  if (idx < 0) return;
  const label = edgeLabels.querySelectorAll<SVGGElement>(':scope > g.edgeLabel')[idx];
  if (!label) return;
  try {
    const len = pathEl.getTotalLength();
    if (!isFinite(len) || len <= 0) return;
    const mid = pathEl.getPointAtLength(len / 2);
    label.setAttribute('transform', `translate(${mid.x}, ${mid.y})`);
  } catch { /* path with empty d throws — ignore */ }
}

/** Half-extents (w/2, h/2) of a mermaid node's bbox. Mermaid centers shapes
    at (0,0) local, so getBBox gives us a roughly symmetric box. We use the
    largest extent in each axis so circles/diamonds get a sensible value. */
function nodeHalfExtent(n: SVGGElement): { w: number; h: number } {
  try {
    const bb = n.getBBox();
    return {
      w: Math.max(Math.abs(bb.x), Math.abs(bb.x + bb.width))  || 30,
      h: Math.max(Math.abs(bb.y), Math.abs(bb.y + bb.height)) || 20,
    };
  } catch {
    return { w: 30, h: 20 };
  }
}

/** Shape-aware clamp. Given the node's center in global SVG coords, the
    node's <g> element (so we can inspect the actual rendered shape), and a
    point `toward` in the same global space, returns the point where a ray
    from `center` to `toward` exits the visible outline of the shape.

    For a rect/round/pill/subroutine this is the rect-edge clamp (current
    behavior, fast). For a circle we use line-circle intersection. For a
    polygon (diamond, hexagon, trapezoid, parallelogram) we intersect the
    ray against each polygon edge and take the closest exit. For a path
    (cylinder, etc.) we approximate with the bbox rect but pull the bottom
    edge slightly inward to compensate for the ellipse undershoot. The
    fallback for an unknown shape is the original rect-edge clamp.

    Result is clamped to never overshoot `toward` (so a tiny node still
    behaves correctly when the endpoint is dragged inside its own bbox). */
function shrinkToNodeEdge(
  center: { x: number; y: number },
  node:   SVGGElement,
  toward: { x: number; y: number },
): { x: number; y: number } {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;

  const shape = findPrimaryShape(node);
  const kind  = shape ? shapeKindFromElement(shape) : 'rect';
  const half  = nodeHalfExtent(node);

  let t: number;
  if (kind === 'circle') {
    // True circle — line-circle intersection at radius = min half-extent.
    // Mermaid sometimes draws a circle as <ellipse> with rx==ry; we still
    // pick up rx/ry from the element so we honor the actual rendered size.
    const r = shape && shape.tagName.toLowerCase() === 'circle'
      ? parseFloat(shape.getAttribute('r') ?? '0') || Math.min(half.w, half.h)
      : Math.min(half.w, half.h);
    t = solveRayToCircle(dx, dy, r);
  } else if (kind === 'ellipse') {
    const rx = shape ? parseFloat(shape.getAttribute('rx') ?? '0') || half.w : half.w;
    const ry = shape ? parseFloat(shape.getAttribute('ry') ?? '0') || half.h : half.h;
    t = solveRayToEllipse(dx, dy, rx, ry);
  } else if (kind === 'polygon' && shape) {
    // Diamond, hexagon, trapezoid, parallelogram — intersect the ray with
    // each polygon edge. Polygon coords are in the node's local space
    // (mermaid centers them at 0,0), so the ray in local coords starts at
    // the origin and points in (dx, dy).
    t = solveRayToPolygon(dx, dy, polygonPoints(shape as SVGPolygonElement));
  } else if (kind === 'cylinder') {
    // Cylinder is a path: a rect with rounded top and bottom ellipses.
    // The bbox includes the ellipse bumps, so a plain rect clamp leaves
    // ~4-6px of empty space below/above the visible body. Pull those edges
    // in by ~5px so the arrow tip lands on the visible curve.
    const ELLIPSE_INSET = 5;
    const insetH = Math.max(half.h - ELLIPSE_INSET, half.h * 0.6);
    t = solveRayToRect(dx, dy, half.w, insetH);
  } else {
    // rect / round / pill / subroutine / unknown — fall back to rect clamp.
    t = solveRayToRect(dx, dy, half.w, half.h);
  }

  // Never overshoot the toward point (tiny-node case).
  t = Math.min(Math.max(t, 0), 1);
  return { x: center.x + t * dx, y: center.y + t * dy };
}

/** Classify the rendered shape by tag + role. Returns a normalized kind:
    'rect' (incl. round, pill, subroutine), 'circle', 'ellipse', 'polygon'
    (diamond, hexagon, trapezoid, parallelogram), 'cylinder' (path), or
    'unknown'. We use a path's bbox aspect ratio to detect cylinder-like
    shapes vs. other path shapes, but the rect fallback handles both fine. */
function shapeKindFromElement(el: SVGGraphicsElement): 'rect' | 'circle' | 'ellipse' | 'polygon' | 'cylinder' | 'unknown' {
  const tag = el.tagName.toLowerCase();
  if (tag === 'rect')    return 'rect';
  if (tag === 'circle')  return 'circle';
  if (tag === 'ellipse') {
    const rx = parseFloat(el.getAttribute('rx') ?? '0');
    const ry = parseFloat(el.getAttribute('ry') ?? '0');
    return rx > 0 && ry > 0 && Math.abs(rx - ry) < 0.5 ? 'circle' : 'ellipse';
  }
  if (tag === 'polygon') return 'polygon';
  if (tag === 'path')    return 'cylinder'; // treat all path shapes as cylinder-like
  return 'unknown';
}

/** Ray-vs-rect: how far along (dx, dy) from origin do we first hit a side
    of the centered rect [-w, +w] × [-h, +h]? */
function solveRayToRect(dx: number, dy: number, w: number, h: number): number {
  let tx = Infinity, ty = Infinity;
  if (dx !== 0) tx = w / Math.abs(dx);
  if (dy !== 0) ty = h / Math.abs(dy);
  return Math.min(tx, ty);
}

/** Ray-vs-circle (centered at origin, radius r). The ray is parameterized
    as (t*dx, t*dy); we want the smallest t > 0 with t² (dx² + dy²) = r². */
function solveRayToCircle(dx: number, dy: number, r: number): number {
  const d2 = dx * dx + dy * dy;
  if (d2 === 0) return 0;
  return r / Math.sqrt(d2);
}

/** Ray-vs-ellipse (centered at origin, semi-axes rx, ry). Solve
    (t*dx/rx)² + (t*dy/ry)² = 1 → t = 1 / sqrt((dx/rx)² + (dy/ry)²). */
function solveRayToEllipse(dx: number, dy: number, rx: number, ry: number): number {
  if (rx <= 0 || ry <= 0) return 0;
  const a = dx / rx;
  const b = dy / ry;
  const denom = Math.sqrt(a * a + b * b);
  return denom === 0 ? 0 : 1 / denom;
}

/** Ray-vs-polygon: intersect the ray (from local origin in direction (dx, dy))
    against every polygon edge. Polygon points are in the node's local SVG
    space (mermaid centers them at ~(0, 0)). We return the smallest positive
    t where the ray crosses any edge — the polygon's outline in that
    direction. If no edge crosses, fall back to the polygon's bbox extents. */
function solveRayToPolygon(dx: number, dy: number, points: Array<{ x: number; y: number }>): number {
  if (points.length < 2) return solveRayToRect(dx, dy, 30, 20);
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    // Segment: P1 + s * (P2 - P1), s ∈ [0, 1].
    // Ray:     (0, 0) + t * (dx, dy), t > 0.
    // Solve:   t * dx = p1.x + s * (p2.x - p1.x)
    //          t * dy = p1.y + s * (p2.y - p1.y)
    const sx = p2.x - p1.x;
    const sy = p2.y - p1.y;
    const denom = dx * sy - dy * sx;
    if (denom === 0) continue; // parallel
    const t = (p1.x * sy - p1.y * sx) / denom;
    const s = (p1.x * dy - p1.y * dx) / denom;
    if (t > 0 && s >= 0 && s <= 1 && t < best) best = t;
  }
  if (!isFinite(best)) {
    // Degenerate — fall back to polygon's axis-aligned bbox half-extents.
    let maxX = 0, maxY = 0;
    for (const p of points) {
      if (Math.abs(p.x) > maxX) maxX = Math.abs(p.x);
      if (Math.abs(p.y) > maxY) maxY = Math.abs(p.y);
    }
    return solveRayToRect(dx, dy, maxX, maxY);
  }
  return best;
}

/** Read a polygon's points attribute into a normalized array, centered on
    the polygon's bbox center so the ray-clamp math (which assumes the node
    is centered at the origin) lines up regardless of how mermaid emitted
    the coordinates. */
function polygonPoints(poly: SVGPolygonElement): Array<{ x: number; y: number }> {
  // Prefer the scaled live points; fall back to parsing the attribute. The
  // SVGPolygonElement.points list reflects whatever mermaid currently has
  // set on the element (including any scaling we applied during resize).
  const raw = poly.getAttribute('points') ?? '';
  const out: Array<{ x: number; y: number }> = [];
  // Accept both "x,y x,y" and "x y x y" pairings.
  const nums = raw.trim().split(/[\s,]+/).map(parseFloat).filter(n => isFinite(n));
  for (let i = 0; i + 1 < nums.length; i += 2) {
    out.push({ x: nums[i], y: nums[i + 1] });
  }
  if (out.length === 0) return out;
  // Center on the polygon's bbox so the clamp math (which uses a ray from
  // the local origin) is correct even when mermaid emits all-positive
  // points (e.g. (0, 0)→(w, h)).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of out) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // If the polygon is already centered around (0, 0) (within 0.5px), skip
  // the recentering — keeps numbers tidy and matches the bbox semantics.
  if (Math.abs(cx) < 0.5 && Math.abs(cy) < 0.5) return out;
  return out.map(p => ({ x: p.x - cx, y: p.y - cy }));
}

/** Mermaid edge ids look like `<diagramPrefix>-L_<from>_<to>_<n>` (v11) or
    `L-<from>-<to>-<n>` (older). We anchor at the end and accept arbitrary
    prefixes. As a fallback we look at LS-/LE- classes. */
function parseEdgeEndpoints(el: Element): { from: string; to: string } | null {
  const rawId = el.getAttribute('id') ?? '';
  // Underscore form (v11): ...-L_from_to_n
  const u = rawId.match(/L_([\w-]+?)_([\w-]+?)_\d+$/);
  if (u) return { from: u[1], to: u[2] };
  // Hyphen form (older): L-from-to-n
  const h = rawId.match(/-L-([\w-]+?)-([\w-]+?)-\d+$/) ?? rawId.match(/^L-([\w-]+?)-([\w-]+?)-\d+$/);
  if (h) return { from: h[1], to: h[2] };

  const cls = el.getAttribute('class') ?? '';
  const fromMatch = cls.match(/LS-([\w-]+)/);
  const toMatch   = cls.match(/LE-([\w-]+)/);
  if (fromMatch && toMatch) return { from: fromMatch[1], to: toMatch[1] };
  return null;
}

/** Cubic bezier from a to b that bends gently — horizontal first half then
    vertical, matching the typical flowchart aesthetic. */
function bezierPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = b.x - a.x;
  // Pull control points one third of the horizontal distance into each side;
  // produces a smooth s-curve regardless of node alignment.
  const cp1x = a.x + dx * 0.5;
  const cp1y = a.y;
  const cp2x = b.x - dx * 0.5;
  const cp2y = b.y;
  return `M ${a.x} ${a.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${b.x} ${b.y}`;
}

// ── Phase 3: alignment guides + snap ───────────────────────────────────────

interface NodeSnap {
  id:    string;
  x:     number;  // center x
  y:     number;  // center y
  half:  { w: number; h: number };
}

interface GuideLine {
  orient: 'h' | 'v';
  coord:  number;
  from:   number;
  to:     number;
}

interface SnapResult {
  snapX:  number | null;
  snapY:  number | null;
  guides: GuideLine[];
}

const ALIGN_THRESHOLD = 6; // SVG units

function collectOtherNodes(excludeId: string, host: HTMLElement): NodeSnap[] {
  const out: NodeSnap[] = [];
  const all = host.querySelectorAll<SVGGElement>('g.node');
  for (const n of Array.from(all)) {
    const id = extractMermaidId(n);
    if (!id || id === excludeId) continue;
    const t = readNodeTranslate(n);
    if (!t) continue;
    out.push({ id, x: t.x, y: t.y, half: nodeHalfExtent(n) });
  }
  return out;
}

/** For a dragged node positioned at `center` with half-extents `half`, find
    the nearest aligning X / Y from any peer node and return both the snap
    coordinates and the guide lines to render. */
function computeAlignmentSnap(
  center: { x: number; y: number },
  half:   { w: number; h: number },
  others: NodeSnap[],
): SnapResult {
  // Candidate X coords: peers' center, left edge, right edge.
  // We track the BEST X snap (closest to the current) and similarly for Y.
  let bestDX = Infinity;
  let snapX: number | null = null;
  let bestDY = Infinity;
  let snapY: number | null = null;
  const guides: GuideLine[] = [];

  const myL = center.x - half.w;
  const myR = center.x + half.w;
  const myT = center.y - half.h;
  const myB = center.y + half.h;

  for (const o of others) {
    const oL = o.x - o.half.w;
    const oR = o.x + o.half.w;
    const oT = o.y - o.half.h;
    const oB = o.y + o.half.h;

    // X candidates: my-center↔o-center, my-left↔o-left, my-right↔o-right,
    // my-left↔o-right, my-right↔o-left. The snap target for the *node center*
    // is derived from the comparison pair.
    const xCandidates: Array<{ targetCenter: number; coord: number }> = [
      { targetCenter: o.x,                  coord: o.x  },                   // center↔center
      { targetCenter: oL + half.w,          coord: oL  },                    // left↔left
      { targetCenter: oR - half.w,          coord: oR  },                    // right↔right
      { targetCenter: oL - half.w,          coord: oL  },                    // right↔left
      { targetCenter: oR + half.w,          coord: oR  },                    // left↔right
    ];
    for (const c of xCandidates) {
      const dist = Math.abs(c.targetCenter - center.x);
      if (dist > ALIGN_THRESHOLD) continue;
      if (dist < bestDX) {
        bestDX = dist;
        snapX  = c.targetCenter;
        // Replace any existing vertical guide
        for (let i = guides.length - 1; i >= 0; i--) {
          if (guides[i].orient === 'v') guides.splice(i, 1);
        }
        const y1 = Math.min(myT, oT);
        const y2 = Math.max(myB, oB);
        guides.push({ orient: 'v', coord: c.coord, from: y1, to: y2 });
      }
    }

    const yCandidates: Array<{ targetCenter: number; coord: number }> = [
      { targetCenter: o.y,                  coord: o.y  },
      { targetCenter: oT + half.h,          coord: oT  },
      { targetCenter: oB - half.h,          coord: oB  },
      { targetCenter: oT - half.h,          coord: oT  },
      { targetCenter: oB + half.h,          coord: oB  },
    ];
    for (const c of yCandidates) {
      const dist = Math.abs(c.targetCenter - center.y);
      if (dist > ALIGN_THRESHOLD) continue;
      if (dist < bestDY) {
        bestDY = dist;
        snapY  = c.targetCenter;
        for (let i = guides.length - 1; i >= 0; i--) {
          if (guides[i].orient === 'h') guides.splice(i, 1);
        }
        const x1 = Math.min(myL, oL);
        const x2 = Math.max(myR, oR);
        guides.push({ orient: 'h', coord: c.coord, from: x1, to: x2 });
      }
    }
  }
  return { snapX, snapY, guides };
}

interface GuideLayerHandle {
  show:    (lines: GuideLine[]) => void;
  hide:    () => void;
  destroy: () => void;
}

/** A dedicated SVG overlay layer for alignment guides. Lives inside the
    preview pane, sized to the rendered SVG's viewBox so guides align with
    the diagram. */
function createGuideLayer(previewPane: HTMLElement): GuideLayerHandle {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'mb-vGuides');
  svg.style.position       = 'absolute';
  svg.style.inset          = '0';
  svg.style.pointerEvents  = 'none';
  svg.style.overflow       = 'visible';
  svg.style.display        = 'none';
  svg.style.zIndex         = '15';
  previewPane.appendChild(svg);

  function syncViewBox(): void {
    const mermaidSvg = previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
    if (!mermaidSvg) return;
    const vb = mermaidSvg.viewBox?.baseVal;
    if (!vb) return;
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    // Position the guide SVG to overlay the mermaid SVG exactly.
    const mRect = mermaidSvg.getBoundingClientRect();
    const pRect = previewPane.getBoundingClientRect();
    svg.style.left   = `${mRect.left - pRect.left}px`;
    svg.style.top    = `${mRect.top  - pRect.top}px`;
    svg.style.width  = `${mRect.width}px`;
    svg.style.height = `${mRect.height}px`;
  }

  function show(lines: GuideLine[]): void {
    syncViewBox();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    for (const l of lines) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      if (l.orient === 'v') {
        el.setAttribute('x1', String(l.coord));
        el.setAttribute('x2', String(l.coord));
        el.setAttribute('y1', String(l.from - 20));
        el.setAttribute('y2', String(l.to + 20));
      } else {
        el.setAttribute('y1', String(l.coord));
        el.setAttribute('y2', String(l.coord));
        el.setAttribute('x1', String(l.from - 20));
        el.setAttribute('x2', String(l.to + 20));
      }
      el.setAttribute('stroke', '#6366f1');
      el.setAttribute('stroke-width', '1');
      el.setAttribute('stroke-dasharray', '3 3');
      el.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(el);
    }
    svg.style.display = lines.length > 0 ? 'block' : 'none';
  }

  function hide(): void {
    svg.style.display = 'none';
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function destroy(): void {
    svg.remove();
  }

  return { show, hide, destroy };
}
