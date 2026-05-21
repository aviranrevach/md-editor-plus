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
} from './mermaidVisualEdit';

export type Tool = 'select' | 'rect' | 'pill' | 'circle' | 'diamond' | 'arrow' | 'text';

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

const SHAPE_FOR_TOOL: Record<Exclude<Tool, 'select' | 'arrow'>, NodeShape> = {
  rect:    'rect',
  pill:    'pill',
  circle:  'circle',
  diamond: 'diamond',
  text:    'text',
};

// SVG icons used by the toolbar. Stroke-based, currentColor — tint via CSS.
const ICONS: Record<string, string> = {
  select:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v18l4-4h12L5 3z"/></svg>`,
  rect:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="2"/></svg>`,
  pill:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="8" rx="4"/></svg>`,
  circle:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/></svg>`,
  diamond: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l9 9-9 9-9-9 9-9z"/></svg>`,
  arrow:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-4-4l4 4-4 4"/></svg>`,
  text:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M12 7v13"/></svg>`,
  reset:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/></svg>`,
  grid:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
};

const TOOL_HOTKEYS: Record<string, Tool> = {
  v: 'select',
  r: 'rect',
  p: 'pill',
  c: 'circle',
  d: 'diamond',
  a: 'arrow',
  t: 'text',
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
  // For Arrow tool — first click captures the source node, second click connects.
  let pendingFromId: string | null = null;

  const undoStack: Ast[] = [];
  const redoStack: Ast[] = [];
  const MAX_UNDO = 50;
  // After a duplicate, re-select the new copies on the next rerender.
  let pendingDuplicateIds: string[] | null = null;

  // ── Overlays (mounted under the block, absolute-positioned) ─────────────
  opts.block.classList.add('mb-visual-active');

  // ── Phase 3 state ──────────────────────────────────────────────────────
  let gridSnapEnabled = false;
  const guideLayer = createGuideLayer(opts.previewPane);

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
  });
  const selectionRing = document.createElement('div');
  selectionRing.className = 'mb-vSel mb-hidden';
  // Additional rings for multi-selected nodes — pooled.
  const extraRings: HTMLDivElement[] = [];
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
      mutate((ast) => changeNodeShape(ast, selectedId!, shape));
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
    onDuplicate: () => {
      const targetIds = Array.from(selectedIds);
      if (targetIds.length === 0) return;
      mutate((ast) => {
        const positions = getPositions(ast);
        const styles    = getStyles(ast) ?? {};
        const newIds: string[] = [];
        for (const id of targetIds) {
          // Look up shape + label of original.
          const orig = collectNodes(ast).get(id);
          const shape: NodeShape = orig?.shape ?? 'rect';
          const label = (orig?.label ?? id) + ' copy';
          const added = addNode(ast, shape, label);
          newIds.push(added.id);
          // Copy style if present.
          if (styles[id]) setNodeStyle(ast, added.id, styles[id]);
          // Copy position with a small offset if positions are pinned.
          if (positions && positions[id]) {
            setPosition(ast, added.id, positions[id][0] + 30, positions[id][1] + 30);
          }
        }
        // Defer selection update until after mermaid re-renders.
        pendingDuplicateIds = newIds;
      });
    },
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

  // Marquee selection rect.
  const marqueeEl = document.createElement('div');
  marqueeEl.className = 'mb-vMarquee mb-hidden';
  marqueeEl.contentEditable = 'false';

  // Lock badge pool (one per visible locked node).
  const lockBadges: HTMLElement[] = [];

  // All overlays live in the preview pane so the NodeView's ignoreMutation
  // hook (which already trusts preview-pane mutations) doesn't fight us.
  opts.previewPane.appendChild(toolbar.el);
  opts.previewPane.appendChild(selectionRing);
  opts.previewPane.appendChild(connectionLayer);
  opts.previewPane.appendChild(marqueeEl);
  opts.previewPane.appendChild(contextTip.el);
  opts.previewPane.appendChild(renameOverlay.el);
  opts.previewPane.appendChild(pendingPin);

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

    const targetNode = findMermaidNode(e.target as Element, opts.previewPane);

    if (activeTool === 'select') {
      if (targetNode) {
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
      } else if (!e.shiftKey) {
        setSelected(null);
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
        mutate((ast) => { addEdge(ast, from, to); });
        toolbar.setActive('select');
        activeTool = 'select';
      }
      return;
    }

    // One of the shape tools — drop a node where the user clicked. If the
    // block wasn't pinned yet, snapshot every existing node's auto-layout
    // position first so edges stay coherent once we promote the block to
    // pinned mode (same trick as the first-drag commit).
    const shapeKey = activeTool as keyof typeof SHAPE_FOR_TOOL;
    const dropPos = clientToSvgPoint(e.clientX, e.clientY, opts.previewPane);
    mutate((ast) => {
      const added = addNode(ast, SHAPE_FOR_TOOL[shapeKey]);
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
      opts.onExit();
      return;
    }

    if (renameOverlay.isOpen()) {
      // Let the overlay's own handlers manage typing.
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
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
    positionRingAround(selectionRing, nodeEl, opts.previewPane);
    contextTip.showBelow(nodeEl, opts.previewPane);
    nudgeAcc = { id: selectedId, x: nx, y: ny };
    if (nudgeTimer) clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(commitNudge, 200);
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
  // Three mutually-exclusive gestures share the mouse:
  //  - drag    : node reposition (single or multi)
  //  - marquee : drag on empty canvas → multi-select
  //  - edge    : drag from a connection-point dot → new edge
  let drag: DragCandidate | null = null;
  let marquee: { x1: number; y1: number; x2: number; y2: number; additive: boolean } | null = null;
  let edgeDraft: { fromId: string; fromX: number; fromY: number; pathEl: SVGPathElement | null } | null = null;
  let suppressNextClick = false;
  const DRAG_THRESHOLD = 4;

  function onDragMouseDown(e: MouseEvent): void {
    if (activeTool !== 'select') return;
    if (e.button !== 0) return; // left button only

    // Connection-point dot → start edge draft.
    const dotEl = (e.target as Element).closest?.('.mb-vConn-dot');
    if (dotEl && selectedId) {
      const sourceEl = findNodeElementById(selectedId, opts.previewPane) as SVGGElement | null;
      const origin = sourceEl ? readNodeTranslate(sourceEl) : null;
      if (sourceEl && origin) {
        edgeDraft = { fromId: selectedId, fromX: origin.x, fromY: origin.y, pathEl: null };
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    const hit = findMermaidNode(e.target as Element, opts.previewPane);
    if (!hit) {
      // Empty canvas mousedown with Select tool → start marquee.
      // (Don't start marquee for clicks inside our own UI overlays — those have
      //  their own pointer handlers and shouldn't trigger selection drag.)
      const inOverlay = (e.target as Element).closest('.mb-vTb, .mb-vCtx, .mb-vConn, .mb-snackbar, .mb-vRename, .mb-vPin, .mb-svg-host svg');
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
    // Edge draft path
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
      edgeDraft.pathEl.setAttribute('d', bezierPath({ x: edgeDraft.fromX, y: edgeDraft.fromY }, svgPt));
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
    }
    // Refresh selection rings + tip to follow the moved nodes.
    refreshSelectionUI();
  }

  function onDragMouseUp(e: MouseEvent): void {
    // Edge draft → commit if landed on a node.
    if (edgeDraft) {
      const hit = findMermaidNode(e.target as Element, opts.previewPane);
      if (hit && hit.id !== edgeDraft.fromId) {
        const fromId = edgeDraft.fromId;
        const toId   = hit.id;
        mutate((ast) => { addEdge(ast, fromId, toId); });
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

  // ── Tool / selection / rename / mutation plumbing ────────────────────────
  function setTool(tool: Tool): void {
    activeTool = tool;
    toolbar.setActive(tool);
    if (tool !== 'arrow') {
      pendingFromId = null;
      pendingPin.classList.add('mb-hidden');
    }
    // Switching to a non-Select tool clears selection so users don't think
    // they're operating on the selected node.
    if (tool !== 'select') setSelected(null);
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
      return;
    }

    const pivotEl = findNodeElementById(ids[0], opts.previewPane);
    if (!pivotEl) {
      selectionRing.classList.add('mb-hidden');
      contextTip.hide();
      hideConnectionPoints();
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
      contextTip.setLocked(isLocked(ast, ids[0]));
      contextTip.setStyle(getNodeStyle(ast, ids[0]));
      showConnectionPoints(pivotEl);
    } else {
      contextTip.showMulti(ids.length, opts.previewPane, pivotEl);
      contextTip.setStyle(null);
      hideConnectionPoints();
    }

    // Padlock badges over locked selected nodes.
    refreshLockBadges();
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
    const ast = parseMermaid(opts.getSource());
    const locks = getLocks(ast);
    // Only show badges for currently-rendered nodes that are locked.
    let badgeIdx = 0;
    if (locks) {
      const nodes = opts.previewPane.querySelectorAll<SVGGElement>('g.node');
      for (const n of Array.from(nodes)) {
        const id = extractMermaidId(n);
        if (!id || !locks.has(id)) continue;
        const rect = n.getBoundingClientRect();
        const hostRect = opts.previewPane.getBoundingClientRect();
        let badge = lockBadges[badgeIdx];
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'mb-vLockBadge';
          badge.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 11V7a5 5 0 0 0-10 0v4H5v11h14V11h-2zm-8-4a3 3 0 1 1 6 0v4H9V7z"/></svg>`;
          opts.previewPane.appendChild(badge);
          lockBadges.push(badge);
        }
        badge.style.left = `${rect.right - hostRect.left - 18}px`;
        badge.style.top  = `${rect.top   - hostRect.top  - 4}px`;
        badge.classList.remove('mb-hidden');
        badgeIdx++;
      }
    }
    // Hide unused badges in the pool.
    for (let i = badgeIdx; i < lockBadges.length; i++) {
      lockBadges[i].classList.add('mb-hidden');
    }
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
  return {
    onMermaidRerender(): void {
      // mermaidBlock already called applyPositionsOverlay for us before
      // this. We just refresh toolbar state and re-bind ring/tip to the
      // (possibly newly-positioned) selected nodes.
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
    },
    destroy(): void {
      opts.block.classList.remove('mb-visual-active');
      opts.previewPane.removeEventListener('click', onPreviewClick);
      opts.previewPane.removeEventListener('mousedown', onDragMouseDown, true);
      document.removeEventListener('keydown',     onKeyDown,     true);
      document.removeEventListener('mousedown',   onOutsideClick, true);
      document.removeEventListener('mousemove',   onDragMouseMove, true);
      document.removeEventListener('mouseup',     onDragMouseUp,   true);
      toolbar.el.remove();
      selectionRing.remove();
      for (const r of extraRings) r.remove();
      contextTip.destroy();
      renameOverlay.destroy();
      pendingPin.remove();
      connectionLayer.remove();
      marqueeEl.remove();
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
}

interface ToolbarHandlers {
  onPick:    (tool: Tool) => void;
  onReset:   () => void;
  onToggleGrid: () => void;
}

function buildToolbar({ onPick, onReset, onToggleGrid }: ToolbarHandlers): ToolbarHandle {
  const el = document.createElement('div');
  el.className = 'mb-vTb';
  el.contentEditable = 'false';

  const groups: Array<{ tools: Tool[] }> = [
    { tools: ['select'] },
    { tools: ['rect', 'pill', 'circle', 'diamond'] },
    { tools: ['arrow'] },
    { tools: ['text'] },
  ];

  const tipMap: Record<Tool, string> = {
    select:  'Select (V)',
    rect:    'Rectangle (R)',
    pill:    'Pill (P)',
    circle:  'Circle (C)',
    diamond: 'Diamond (D)',
    arrow:   'Arrow (A)',
    text:    'Text (T)',
  };

  const buttonsByTool = new Map<Tool, HTMLButtonElement>();

  groups.forEach((group, idx) => {
    if (idx > 0) {
      const sep = document.createElement('span');
      sep.className = 'mb-vTb-sep';
      el.appendChild(sep);
    }
    for (const tool of group.tools) {
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
      buttonsByTool.set(tool, b);
      el.appendChild(b);
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
  }

  function setResetEnabled(enabled: boolean): void {
    resetBtn.disabled = !enabled;
    resetBtn.classList.toggle('mb-vTb-disabled', !enabled);
  }

  function setGridSnapOn(on: boolean): void {
    gridBtn.classList.toggle('mb-vTb-active', on);
    gridBtn.setAttribute('aria-pressed', String(on));
  }

  setActive('select');
  return { el, setActive, setResetEnabled, setGridSnapOn };
}

// ── Context tip ─────────────────────────────────────────────────────────────

interface ContextTipHandle {
  el:         HTMLElement;
  showBelow:  (node: Element, host: HTMLElement) => void;
  showMulti:  (count: number, host: HTMLElement, pivot: Element) => void;
  setLocked:  (locked: boolean) => void;
  setStyle:   (s: NodeStyle | null) => void;
  hide:       () => void;
  destroy:    () => void;
}

interface ContextTipHandlers {
  onDelete:    () => void;
  onShape:     (s: NodeShape) => void;
  onToggleLock:() => void;
  onStyle:     (partial: NodeStyle) => void;
  onDuplicate: () => void;
}

function buildContextTip(handlers: ContextTipHandlers): ContextTipHandle {
  const el = document.createElement('div');
  el.className = 'mb-vCtx mb-hidden';
  el.contentEditable = 'false';

  // Multi-select summary chip (shown only when |selection| > 1).
  const multiLabel = document.createElement('span');
  multiLabel.className = 'mb-vCtx-multi mb-hidden';
  multiLabel.textContent = '';
  el.appendChild(multiLabel);

  const shapeBtn = document.createElement('button');
  shapeBtn.type = 'button';
  shapeBtn.className = 'mb-vCtx-btn';
  shapeBtn.textContent = 'Shape ▾';

  const shapeMenu = document.createElement('div');
  shapeMenu.className = 'mb-vCtx-menu mb-hidden';
  const shapeOptions: Array<[NodeShape, string]> = [
    ['rect',    'Rectangle'],
    ['pill',    'Pill'],
    ['circle',  'Circle'],
    ['diamond', 'Diamond'],
  ];
  for (const [shape, label] of shapeOptions) {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'mb-vCtx-menu-item';
    opt.textContent = label;
    opt.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    opt.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      shapeMenu.classList.add('mb-hidden');
      handlers.onShape(shape);
    });
    shapeMenu.appendChild(opt);
  }
  shapeBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  shapeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    shapeMenu.classList.toggle('mb-hidden');
  });

  const sep = document.createElement('span');
  sep.className = 'mb-vCtx-sep';

  // ── Font size ─────────────────────────────────────────────────────────
  const fontInput = document.createElement('input');
  fontInput.type = 'number';
  fontInput.className = 'mb-vCtx-num';
  fontInput.min = '8';
  fontInput.max = '72';
  fontInput.step = '1';
  fontInput.value = '14';
  fontInput.setAttribute('aria-label', 'Font size');
  fontInput.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  fontInput.addEventListener('change', () => {
    const v = parseInt(fontInput.value, 10);
    if (Number.isFinite(v)) handlers.onStyle({ fontSize: v });
  });

  // ── Bold ──────────────────────────────────────────────────────────────
  const boldBtn = document.createElement('button');
  boldBtn.type = 'button';
  boldBtn.className = 'mb-vCtx-btn mb-vCtx-bold';
  boldBtn.textContent = 'B';
  boldBtn.setAttribute('aria-label', 'Bold');
  boldBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  boldBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const on = !boldBtn.classList.contains('mb-vCtx-bold-on');
    handlers.onStyle({ bold: on });
  });

  // ── Text color ────────────────────────────────────────────────────────
  const textColorBtn = makeColorButton('A', 'Text color', (c) => handlers.onStyle({ text: c }));
  // ── Border color ──────────────────────────────────────────────────────
  const borderBtn    = makeColorButton('◯', 'Border color', (c) => handlers.onStyle({ border: c }));
  // ── Fill color ────────────────────────────────────────────────────────
  const fillBtn      = makeColorButton('●', 'Fill color',   (c) => handlers.onStyle({ fill: c }));

  // ── Duplicate ─────────────────────────────────────────────────────────
  const dupBtn = document.createElement('button');
  dupBtn.type = 'button';
  dupBtn.className = 'mb-vCtx-btn mb-vCtx-dup';
  dupBtn.setAttribute('aria-label', 'Duplicate');
  dupBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  dupBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  dupBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handlers.onDuplicate(); });

  const styleSep = document.createElement('span');
  styleSep.className = 'mb-vCtx-sep';

  const lockBtn = document.createElement('button');
  lockBtn.type = 'button';
  lockBtn.className = 'mb-vCtx-btn mb-vCtx-lock';
  lockBtn.setAttribute('aria-label', 'Lock node');
  lockBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  lockBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  lockBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handlers.onToggleLock();
  });

  const sep2 = document.createElement('span');
  sep2.className = 'mb-vCtx-sep';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'mb-vCtx-btn mb-vCtx-danger';
  deleteBtn.textContent = '×';
  deleteBtn.setAttribute('aria-label', 'Delete node');
  deleteBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handlers.onDelete();
  });

  el.append(
    shapeBtn, shapeMenu, sep,
    fontInput, boldBtn,
    textColorBtn.el, borderBtn.el, fillBtn.el,
    dupBtn, styleSep,
    lockBtn, sep2, deleteBtn,
  );

  function showBelow(node: Element, host: HTMLElement): void {
    const nodeRect = node.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    el.style.left = `${nodeRect.left - hostRect.left + nodeRect.width / 2}px`;
    el.style.top  = `${nodeRect.bottom - hostRect.top + 8}px`;
    el.classList.remove('mb-hidden');
    // Single-select mode — show shape button, hide multi label.
    shapeBtn.classList.remove('mb-hidden');
    sep.classList.remove('mb-hidden');
    multiLabel.classList.add('mb-hidden');
    shapeMenu.classList.add('mb-hidden');
  }

  function showMulti(count: number, host: HTMLElement, pivot: Element): void {
    const pivotRect = pivot.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    el.style.left = `${pivotRect.left - hostRect.left + pivotRect.width / 2}px`;
    el.style.top  = `${pivotRect.bottom - hostRect.top + 8}px`;
    el.classList.remove('mb-hidden');
    // Multi-select mode — hide shape (per-shape changes don't apply to many),
    // show count chip + lock + delete.
    shapeBtn.classList.add('mb-hidden');
    sep.classList.add('mb-hidden');
    multiLabel.textContent = `${count} selected`;
    multiLabel.classList.remove('mb-hidden');
    shapeMenu.classList.add('mb-hidden');
  }

  function setLocked(locked: boolean): void {
    lockBtn.classList.toggle('mb-vCtx-lock-on', locked);
  }

  function setStyle(s: NodeStyle | null): void {
    fontInput.value = String(s?.fontSize ?? 14);
    boldBtn.classList.toggle('mb-vCtx-bold-on', !!s?.bold);
  }

  function hide(): void {
    el.classList.add('mb-hidden');
    shapeMenu.classList.add('mb-hidden');
  }

  function destroy(): void { el.remove(); }

  return { el, showBelow, showMulti, setLocked, setStyle, hide, destroy };
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

// ── Positions overlay (Phase 2) ────────────────────────────────────────────

/** Mermaid puts `transform="translate(X, Y)"` on every g.node. Parse it. */
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
  // the node renders off-screen unless we widen.
  fitSvgViewBoxToNodes(host);

  // 4) Recompute edges. We do this for ALL edges, not just ones touching a
  // pinned node — keeps the pipeline simple and avoids partial weirdness.
  recomputeAllEdges(host);
}

/** For each g.cluster, recompute the `<rect>` (or `<polygon>`) so it
    encloses its contained nodes after positions are applied. Padded so the
    box doesn't kiss the node edges. */
/** Build a context-tip color button with a 6-swatch popover. */
function makeColorButton(glyph: string, ariaLabel: string, onPick: (color: string) => void): { el: HTMLElement } {
  const SWATCHES = ['#1f2937', '#6366f1', '#06b6d4', '#22c55e', '#b45309', '#ec4899', '#ffffff'];
  const wrap = document.createElement('div');
  wrap.className = 'mb-vCtx-color';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mb-vCtx-btn mb-vCtx-colorbtn';
  btn.textContent = glyph;
  btn.setAttribute('aria-label', ariaLabel);

  const pop = document.createElement('div');
  pop.className = 'mb-vCtx-colorpop mb-hidden';
  for (const c of SWATCHES) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'mb-vCtx-swatch';
    s.style.background = c;
    s.dataset.color = c;
    s.setAttribute('aria-label', `${ariaLabel} ${c}`);
    s.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    s.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      onPick(c);
      pop.classList.add('mb-hidden');
    });
    pop.appendChild(s);
  }

  btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    pop.classList.toggle('mb-hidden');
  });

  wrap.append(btn, pop);
  return { el: wrap };
}

/** Apply per-node style overrides (Phase 5) to the rendered SVG. */
export function applyStylesOverlay(ast: Ast, host: HTMLElement): void {
  const styles = getStyles(ast);
  if (!styles) return;
  for (const [id, s] of Object.entries(styles)) {
    const g = findNodeElementById(id, host);
    if (!g) continue;
    applyStyleToNode(g as SVGGElement, s);
  }
}

function applyStyleToNode(g: SVGGElement, s: NodeStyle): void {
  // Background shape: rect / circle / polygon / path drawn inside g.node.
  // Mermaid often wraps these in <g class="basic ...">.
  const shapes = g.querySelectorAll<SVGGraphicsElement>(
    'rect, circle, ellipse, polygon, path',
  );
  for (const el of Array.from(shapes)) {
    // Skip the foreignObject label's nested rendering — we only want the
    // outer shape. Mermaid renders the foreignObject content in HTML so it
    // doesn't appear in this query.
    if (s.fill   !== undefined) el.setAttribute('fill',   s.fill);
    if (s.border !== undefined) el.setAttribute('stroke', s.border);
  }

  // Label color + font size + weight live in a foreignObject containing
  // .nodeLabel (mermaid v11).
  const labelDiv = g.querySelector<HTMLElement>('foreignObject .nodeLabel, foreignObject div, .label');
  if (labelDiv) {
    if (s.text     !== undefined) labelDiv.style.color      = s.text;
    if (s.fontSize !== undefined) labelDiv.style.fontSize   = `${s.fontSize}px`;
    if (s.bold     !== undefined) labelDiv.style.fontWeight = s.bold ? '700' : '';
  }
  // Some mermaid versions render labels as <text> directly.
  const textEl = g.querySelector<SVGTextElement>('text.nodeLabel, text');
  if (textEl) {
    if (s.text     !== undefined) textEl.setAttribute('fill', s.text);
    if (s.fontSize !== undefined) textEl.setAttribute('font-size', String(s.fontSize));
    if (s.bold     !== undefined) textEl.setAttribute('font-weight', s.bold ? '700' : '400');
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
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  // Also remove fixed width/height so the SVG scales to its container.
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.maxWidth = '100%';
  svg.style.height = 'auto';
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
  const aHalf = nodeHalfExtent(fromNode);
  const bHalf = nodeHalfExtent(toNode);
  const aEdge = shrinkToNodeEdge(aCenter, aHalf, bCenter);
  const bEdge = shrinkToNodeEdge(bCenter, bHalf, aCenter);
  pathEl.setAttribute('d', bezierPath(aEdge, bEdge));
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

/** Move `center` along the direction `toward - center` until it hits the
    rectangle edge defined by `half`. Result lies on the node's boundary in
    the direction of `toward` — so the arrowhead lands flush against the
    node instead of inside it. */
function shrinkToNodeEdge(
  center: { x: number; y: number },
  half:   { w: number; h: number },
  toward: { x: number; y: number },
): { x: number; y: number } {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  let tx = Infinity, ty = Infinity;
  if (dx !== 0) tx = half.w / Math.abs(dx);
  if (dy !== 0) ty = half.h / Math.abs(dy);
  const t = Math.min(tx, ty, 1); // never overshoot the toward point
  return { x: center.x + t * dx, y: center.y + t * dy };
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
