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
  let selectedId: string | null = null;
  // For Arrow tool — first click captures the source node, second click connects.
  let pendingFromId: string | null = null;

  const undoStack: Ast[] = [];
  const redoStack: Ast[] = [];
  const MAX_UNDO = 50;

  // ── Overlays (mounted under the block, absolute-positioned) ─────────────
  opts.block.classList.add('mb-visual-active');

  const toolbar = buildToolbar({
    onPick: (tool) => setTool(tool),
    onReset: () => {
      if (!window.confirm('Reset layout? This removes pinned positions and lets mermaid auto-layout the diagram.')) return;
      mutate((ast) => clearPositions(ast));
    },
  });
  const selectionRing = document.createElement('div');
  selectionRing.className = 'mb-vSel mb-hidden';
  const contextTip = buildContextTip({
    onDelete: () => {
      if (!selectedId) return;
      mutate((ast) => deleteNode(ast, selectedId!));
      setSelected(null);
    },
    onShape: (shape) => {
      if (!selectedId) return;
      mutate((ast) => changeNodeShape(ast, selectedId!, shape));
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

  // All overlays live in the preview pane so the NodeView's ignoreMutation
  // hook (which already trusts preview-pane mutations) doesn't fight us.
  opts.previewPane.appendChild(toolbar.el);
  opts.previewPane.appendChild(selectionRing);
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
        // Click on the already-selected node opens rename.
        if (targetNode.id === selectedId) {
          openRenameFor(targetNode);
        } else {
          setSelected(targetNode.id);
        }
      } else {
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

    // One of the shape tools — drop a node. Position is left to mermaid's
    // auto-layout in Phase 1 (we just insert a node declaration; mermaid will
    // place it on next render).
    const shapeKey = activeTool as keyof typeof SHAPE_FOR_TOOL;
    mutate((ast) => { addNode(ast, SHAPE_FOR_TOOL[shapeKey]); });
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
      if (!selectedId) return;
      e.preventDefault();
      mutate((ast) => deleteNode(ast, selectedId!));
      setSelected(null);
      return;
    }

    if (e.key === 'Enter' && selectedId) {
      e.preventDefault();
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

    // Toolbar hotkeys.
    if (!meta && !e.shiftKey && !e.altKey) {
      const t = TOOL_HOTKEYS[e.key.toLowerCase()];
      if (t) {
        e.preventDefault();
        setTool(t);
      }
    }
  };

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
  interface DragCandidate {
    id:        string;
    nodeEl:    SVGGElement;
    startX:    number;
    startY:    number;
    originSvgX:number;
    originSvgY:number;
    scale:     number;
    moved:     boolean;
  }
  let drag: DragCandidate | null = null;
  let suppressNextClick = false;
  const DRAG_THRESHOLD = 4;

  function onDragMouseDown(e: MouseEvent): void {
    if (activeTool !== 'select') return;
    if (e.button !== 0) return; // left button only
    const hit = findMermaidNode(e.target as Element, opts.previewPane);
    if (!hit) return;
    const nodeEl = hit.el as SVGGElement;
    const origin = readNodeTranslate(nodeEl);
    if (!origin) return;
    const svg = nodeEl.ownerSVGElement;
    if (!svg) return;
    drag = {
      id:         hit.id,
      nodeEl,
      startX:     e.clientX,
      startY:     e.clientY,
      originSvgX: origin.x,
      originSvgY: origin.y,
      scale:      svgUnitsPerPixel(svg),
      moved:      false,
    };
  }

  function onDragMouseMove(e: MouseEvent): void {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    opts.previewPane.classList.add('mb-dragging');
    const newSvgX = drag.originSvgX + dx * drag.scale;
    const newSvgY = drag.originSvgY + dy * drag.scale;
    drag.nodeEl.setAttribute('transform', `translate(${newSvgX}, ${newSvgY})`);
    // Live edge update + ring tracking
    recomputeEdgesTouching(drag.id, opts.previewPane);
    positionRingAround(selectionRing, drag.nodeEl, opts.previewPane);
    if (selectedId === drag.id) {
      contextTip.showBelow(drag.nodeEl, opts.previewPane);
    }
  }

  function onDragMouseUp(_e: MouseEvent): void {
    if (!drag) return;
    const wasDrag = drag.moved;
    const id = drag.id;
    const finalPos = readNodeTranslate(drag.nodeEl);
    drag = null;
    opts.previewPane.classList.remove('mb-dragging');
    if (!wasDrag || !finalPos) return;
    suppressNextClick = true;
    // Commit. If this block had no positions yet, snapshot every node's
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
      setPosition(ast, id, finalPos.x, finalPos.y);
    });
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

  function setSelected(id: string | null): void {
    selectedId = id;
    renameOverlay.hide();
    if (!id) {
      selectionRing.classList.add('mb-hidden');
      contextTip.hide();
      return;
    }
    const nodeEl = findNodeElementById(id, opts.previewPane);
    if (!nodeEl) {
      selectionRing.classList.add('mb-hidden');
      contextTip.hide();
      return;
    }
    positionRingAround(selectionRing, nodeEl, opts.previewPane);
    selectionRing.classList.remove('mb-hidden');
    contextTip.showBelow(nodeEl, opts.previewPane);
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
      // (possibly newly-positioned) selected node.
      const ast = parseMermaid(opts.getSource());
      toolbar.setResetEnabled(getPositions(ast) !== null);
      if (!selectedId) return;
      const nodeEl = findNodeElementById(selectedId, opts.previewPane);
      if (!nodeEl) { setSelected(null); return; }
      positionRingAround(selectionRing, nodeEl, opts.previewPane);
      contextTip.showBelow(nodeEl, opts.previewPane);
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
      contextTip.destroy();
      renameOverlay.destroy();
      pendingPin.remove();
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
}

interface ToolbarHandlers {
  onPick:  (tool: Tool) => void;
  onReset: () => void;
}

function buildToolbar({ onPick, onReset }: ToolbarHandlers): ToolbarHandle {
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

  // Reset layout — separator + dedicated action button (not a tool).
  const sep2 = document.createElement('span');
  sep2.className = 'mb-vTb-sep';
  el.appendChild(sep2);
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

  setActive('select');
  return { el, setActive, setResetEnabled };
}

// ── Context tip ─────────────────────────────────────────────────────────────

interface ContextTipHandle {
  el:        HTMLElement;
  showBelow: (node: Element, host: HTMLElement) => void;
  hide:      () => void;
  destroy:   () => void;
}

function buildContextTip(handlers: { onDelete: () => void; onShape: (s: NodeShape) => void }): ContextTipHandle {
  const el = document.createElement('div');
  el.className = 'mb-vCtx mb-hidden';
  el.contentEditable = 'false';

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

  el.append(shapeBtn, shapeMenu, sep, deleteBtn);

  function showBelow(node: Element, host: HTMLElement): void {
    const nodeRect = node.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    el.style.left = `${nodeRect.left - hostRect.left + nodeRect.width / 2}px`;
    el.style.top  = `${nodeRect.bottom - hostRect.top + 8}px`;
    el.classList.remove('mb-hidden');
    shapeMenu.classList.add('mb-hidden');
  }

  function hide(): void {
    el.classList.add('mb-hidden');
    shapeMenu.classList.add('mb-hidden');
  }

  function destroy(): void { el.remove(); }

  return { el, showBelow, hide, destroy };
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

  // 2) Expand SVG viewBox to enclose every (possibly-moved) node. Mermaid's
  // auto-layout sets a tight viewBox; if a user drags a node outside it,
  // the node renders off-screen unless we widen.
  fitSvgViewBoxToNodes(host);

  // 3) Recompute edges. We do this for ALL edges, not just ones touching a
  // pinned node — keeps the pipeline simple and avoids partial weirdness.
  recomputeAllEdges(host);
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
