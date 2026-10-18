// Lossy-but-safe mermaid AST + serializer for Phase 1 visual editing.
//
// Scope: flowchart / graph blocks with simple node declarations and pair-style
// edges. Anything unfamiliar (subgraph, classDef, style, chained edges, ::: class
// modifiers, &-fanout, click handlers, comments, etc.) passes through verbatim
// at its original line index.
//
// Round-trip contract: parsing then immediately serializing an AST returns the
// source unchanged for the supported subset, and preserves passthrough lines in
// their original positions.

export type NodeShape =
  | 'rect'          // A[Label]
  | 'pill'          // A([Label])     stadium
  | 'circle'        // A((Label))
  | 'diamond'       // A{Label}
  | 'round'         // A(Label)
  | 'subroutine'    // A[[Label]]
  | 'cylinder'      // A[(Label)]
  | 'hexagon'       // A{{Label}}
  | 'trapezoid'     // A[\Label/]     base bottom — priority/manual op shape
  | 'parallelogram' // A[/Label/]     lean-right — data input/output shape
  | 'text'          // bare — emitted as A["Label"]
  ;

// `raw` holds the original source text of the parsed line, indent stripped.
// If `raw` is present, the serializer emits it verbatim (preserving the
// user's quoting / whitespace choices). Mutations (rename, shape change)
// clear `raw` so the serializer falls back to canonical emit.

export interface NodeDecl {
  id:    string;
  label: string;
  shape: NodeShape;
  raw?:  string;
}

export interface EdgeDecl {
  from:   string;
  to:     string;
  label?: string;
  arrow:  'open' | 'arrow' | 'dotted' | 'thick' | 'cross' | 'circle';
  raw?:   string;
}

export interface PassthroughLine {
  raw: string;
}

export type PositionMap = Record<string, [number, number]>;

export interface NodeStyle {
  fill?:        string;
  border?:      string;
  text?:        string;
  fontSize?:    number;
  bold?:        boolean;
  italic?:      boolean;
  underline?:   boolean;
  strike?:      boolean;
  borderWidth?: number;    // stroke-width on the shape (px)
  opacity?:     number;    // 0..1 — applied to the whole node g
  strokeType?:  'solid' | 'dashed' | 'dotted';
  textAlign?:     'left' | 'center' | 'right';
  verticalAlign?: 'top'  | 'middle' | 'bottom';
  padding?:       'tight' | 'normal' | 'spacious';
  lineHeight?:    'tight' | 'normal';
  // Per-node scale override (width / height multipliers). Stored together
  // because resize handles always set both at once. CSS transform on g.node.
  scale?: [number, number];
}
export type StyleMap = Record<string, NodeStyle>;

/** Per-edge visual style. Key in the EdgeStyleMap is `<from>->-<to>->-<index>`
    where index disambiguates parallel edges. */
export type EdgeCap = 'none' | 'arrow' | 'circle';
export type EdgeAnimation = 'none' | 'slow' | 'fast';
export type EdgeAnimationDirection = 'forward' | 'reverse';
export interface EdgeStyle {
  type?:      'solid' | 'dashed' | 'dotted';
  thickness?: number;     // stroke-width in SVG units
  color?:     string;     // hex or 'none' to hide
  opacity?:   number;     // 0..1
  // Marching-ants animation. `animation` picks the speed; `animationDirection`
  // controls whether dashes travel toward the arrow (forward) or away (reverse).
  // Legacy `animated: true` files map to `animation: 'slow'` on read.
  animation?:          EdgeAnimation;
  animationDirection?: EdgeAnimationDirection;
  startCap?:  EdgeCap;
  endCap?:    EdgeCap;
}
export type EdgeStyleMap = Record<string, EdgeStyle>;

/** Standalone "free" line — not connected to any node. Used as a separator,
    pointer, or annotation. Coordinates are in the rendered mermaid SVG's
    viewBox space (same coordinate system as `PositionMap`).

    Each endpoint can be either a free SVG coordinate, or anchored to a node's
    hook (one of N/E/S/W on the node's bounding box). Anchored endpoints
    "stick" — they follow the node as it moves or resizes.

    `lastX`/`lastY` is a fallback: when an anchored endpoint's target node is
    deleted, the resolver falls back to these coordinates so the line stays
    visible. They mirror the last-rendered resolved position; the renderer
    keeps them up to date so a fallback is always a sensible value. */
export type LineEndpoint =
  | { kind: 'free'; x: number; y: number }
  | { kind: 'node'; id: string; side: 'n' | 'e' | 's' | 'w'; lastX?: number; lastY?: number };

export interface LineDecl {
  id:         string;
  from:       LineEndpoint;
  to:         LineEndpoint;
  color?:     string;
  thickness?: number;
  type?:      'solid' | 'dashed' | 'dotted';
}

type AnyLine =
  | { kind: 'node';        node: NodeDecl }
  | { kind: 'edge';        edge: EdgeDecl }
  | { kind: 'header';      raw:  string; direction: string }
  | { kind: 'positions';   raw:  string; map: PositionMap }
  | { kind: 'locks';       raw:  string; ids: string[] }
  | { kind: 'styles';      raw:  string; map: StyleMap }
  | { kind: 'edge-styles'; raw:  string; map: EdgeStyleMap }
  | { kind: 'lines';       raw:  string; lines: LineDecl[] }
  | { kind: 'pass';        raw:  string };

export interface Ast {
  // Lines in original order. Operations append new node/edge lines and remove
  // existing ones; passthrough lines stay anchored.
  lines: AnyLine[];
}

// ── Public surface ─────────────────────────────────────────────────────────

export function canEdit(source: string): boolean {
  // Visual edit only activates for flowchart / graph blocks. The parser is
  // forgiving — any unrecognized line becomes a passthrough — but we want a
  // belt-and-braces "is this even a flowchart" check before we touch the source.
  const firstReal = source.split('\n').map(s => s.trim()).find(s => s.length > 0 && !s.startsWith('%%') && !s.startsWith('---'));
  if (!firstReal) return false;
  return /^(flowchart|graph)\b/.test(firstReal);
}

export function parseMermaid(source: string): Ast {
  const rawLines = source.split('\n');
  const lines: AnyLine[] = [];
  let headerSeen = false;

  for (const raw of rawLines) {
    const trimmed = raw.trim();

    if (!headerSeen) {
      const hm = trimmed.match(/^(flowchart|graph)\s+([A-Z]{1,2})\b/);
      if (hm) {
        headerSeen = true;
        lines.push({ kind: 'header', raw, direction: hm[2] });
        continue;
      }
      // Lines before the header (e.g., `---` frontmatter) are passthrough.
      lines.push({ kind: 'pass', raw });
      continue;
    }

    if (trimmed.length === 0) {
      lines.push({ kind: 'pass', raw });
      continue;
    }

    // Recognize our own positions sidecar before edges/nodes — its leading
    // %% would otherwise classify it as passthrough comment.
    const positions = tryParsePositionsLine(trimmed);
    if (positions) {
      lines.push({ kind: 'positions', raw: trimmed, map: positions });
      continue;
    }

    const locks = tryParseLocksLine(trimmed);
    if (locks) {
      lines.push({ kind: 'locks', raw: trimmed, ids: locks });
      continue;
    }

    const styles = tryParseStylesLine(trimmed);
    if (styles) {
      lines.push({ kind: 'styles', raw: trimmed, map: styles });
      continue;
    }

    const edgeStyles = tryParseEdgeStylesLine(trimmed);
    if (edgeStyles) {
      lines.push({ kind: 'edge-styles', raw: trimmed, map: edgeStyles });
      continue;
    }

    const standaloneLines = tryParseLinesLine(trimmed);
    if (standaloneLines) {
      lines.push({ kind: 'lines', raw: trimmed, lines: standaloneLines });
      continue;
    }

    const edge = tryParseEdge(trimmed);
    if (edge) {
      lines.push({ kind: 'edge', edge });
      continue;
    }

    const node = tryParseStandaloneNode(trimmed);
    if (node) {
      lines.push({ kind: 'node', node });
      continue;
    }

    lines.push({ kind: 'pass', raw });
  }

  if (!headerSeen) {
    // No header → not a flowchart we can edit. Stash everything as passthrough.
    return { lines: rawLines.map(raw => ({ kind: 'pass', raw })) };
  }

  return { lines };
}

export function serializeMermaid(ast: Ast): string {
  return ast.lines.map(l => emitLine(l)).join('\n');
}

// Builds a quick lookup of every node referenced in the AST — by explicit
// declaration AND by appearing as either side of an edge with inline shape.
export function collectNodes(ast: Ast): Map<string, NodeDecl> {
  const m = new Map<string, NodeDecl>();
  for (const line of ast.lines) {
    if (line.kind === 'node') m.set(line.node.id, line.node);
    if (line.kind === 'edge') {
      if (!m.has(line.edge.from)) m.set(line.edge.from, defaultNode(line.edge.from));
      if (!m.has(line.edge.to))   m.set(line.edge.to,   defaultNode(line.edge.to));
    }
  }
  return m;
}

export function collectEdges(ast: Ast): EdgeDecl[] {
  const out: EdgeDecl[] = [];
  for (const line of ast.lines) {
    if (line.kind === 'edge') out.push(line.edge);
  }
  return out;
}

// ── Mutations ───────────────────────────────────────────────────────────────

export function addNode(ast: Ast, shape: NodeShape, label?: string): NodeDecl {
  const id = nextId(ast);
  const node: NodeDecl = {
    id,
    label: label ?? 'Untitled',
    shape,
  };
  // Insert after the last node line (or after the header if no nodes exist).
  const insertAt = lastIndexOfKind(ast, 'node') + 1 || lastIndexOfKind(ast, 'header') + 1 || ast.lines.length;
  ast.lines.splice(insertAt, 0, { kind: 'node', node });
  return node;
}

export function renameNode(ast: Ast, id: string, newLabel: string): boolean {
  let renamed = false;
  for (const line of ast.lines) {
    if (line.kind === 'node' && line.node.id === id) {
      line.node.label = newLabel;
      line.node.raw = undefined;
      renamed = true;
    }
  }
  // If the node was implicit (only referenced in edges), promote it to a real
  // node line so the label sticks.
  if (!renamed) {
    const refByEdge = ast.lines.some(l => l.kind === 'edge' && (l.edge.from === id || l.edge.to === id));
    if (refByEdge) {
      const insertAt = lastIndexOfKind(ast, 'node') + 1 || lastIndexOfKind(ast, 'header') + 1 || ast.lines.length;
      ast.lines.splice(insertAt, 0, { kind: 'node', node: { id, label: newLabel, shape: 'rect' } });
      renamed = true;
    }
  }
  return renamed;
}

export function changeNodeShape(ast: Ast, id: string, shape: NodeShape): boolean {
  for (const line of ast.lines) {
    if (line.kind === 'node' && line.node.id === id) {
      line.node.shape = shape;
      line.node.raw = undefined;
      return true;
    }
  }
  // Implicit nodes — promote with the requested shape.
  const refByEdge = ast.lines.some(l => l.kind === 'edge' && (l.edge.from === id || l.edge.to === id));
  if (refByEdge) {
    const insertAt = lastIndexOfKind(ast, 'node') + 1 || lastIndexOfKind(ast, 'header') + 1 || ast.lines.length;
    ast.lines.splice(insertAt, 0, { kind: 'node', node: { id, label: id, shape } });
    return true;
  }
  return false;
}

export function deleteNode(ast: Ast, id: string): void {
  ast.lines = ast.lines.filter(l => {
    if (l.kind === 'node' && l.node.id === id) return false;
    if (l.kind === 'edge' && (l.edge.from === id || l.edge.to === id)) return false;
    return true;
  });
}

export function addEdge(ast: Ast, from: string, to: string): EdgeDecl {
  const edge: EdgeDecl = { from, to, arrow: 'arrow' };
  ast.lines.push({ kind: 'edge', edge });
  return edge;
}

export function deleteEdge(ast: Ast, from: string, to: string): void {
  let removed = false;
  ast.lines = ast.lines.filter(l => {
    if (removed) return true;
    if (l.kind === 'edge' && l.edge.from === from && l.edge.to === to) {
      removed = true;
      return false;
    }
    return true;
  });
}

// Snapshot helpers for the undo stack — cheap deep clone via JSON since the AST
// is plain data.
export function cloneAst(ast: Ast): Ast {
  return JSON.parse(JSON.stringify(ast)) as Ast;
}

// ── Positions sidecar ──────────────────────────────────────────────────────

export function getPositions(ast: Ast): PositionMap | null {
  for (const line of ast.lines) {
    if (line.kind === 'positions') return line.map;
  }
  return null;
}

/** Replace or insert the positions sidecar wholesale. */
export function setAllPositions(ast: Ast, map: PositionMap): void {
  const filtered: PositionMap = {};
  for (const [k, v] of Object.entries(map)) filtered[k] = [Math.round(v[0]), Math.round(v[1])];
  const raw = `%% mb-positions: ${JSON.stringify(filtered)}`;
  const idx = ast.lines.findIndex(l => l.kind === 'positions');
  if (idx >= 0) {
    ast.lines[idx] = { kind: 'positions', raw, map: filtered };
    return;
  }
  // Insert right after the header.
  const headerIdx = ast.lines.findIndex(l => l.kind === 'header');
  ast.lines.splice(headerIdx + 1, 0, { kind: 'positions', raw, map: filtered });
}

/** Update a single node's position. Inserts the sidecar if missing (caller is
    expected to call setAllPositions first if they want a full snapshot). */
export function setPosition(ast: Ast, id: string, x: number, y: number): void {
  const existing = getPositions(ast) ?? {};
  existing[id] = [Math.round(x), Math.round(y)];
  setAllPositions(ast, existing);
}

export function clearPositions(ast: Ast): void {
  ast.lines = ast.lines.filter(l => l.kind !== 'positions');
}

// ── Locks sidecar (Phase 4) ─────────────────────────────────────────────────

export function getLocks(ast: Ast): Set<string> | null {
  for (const line of ast.lines) {
    if (line.kind === 'locks') return new Set(line.ids);
  }
  return null;
}

export function isLocked(ast: Ast, id: string): boolean {
  return getLocks(ast)?.has(id) ?? false;
}

export function setLocks(ast: Ast, ids: Iterable<string>): void {
  const list = Array.from(new Set(ids)).sort();
  if (list.length === 0) {
    ast.lines = ast.lines.filter(l => l.kind !== 'locks');
    return;
  }
  const raw = `%% mb-locks: ${JSON.stringify(list)}`;
  const idx = ast.lines.findIndex(l => l.kind === 'locks');
  if (idx >= 0) {
    ast.lines[idx] = { kind: 'locks', raw, ids: list };
    return;
  }
  // Insert right after positions (if any), else after header.
  const posIdx = ast.lines.findIndex(l => l.kind === 'positions');
  const headerIdx = ast.lines.findIndex(l => l.kind === 'header');
  const at = posIdx >= 0 ? posIdx + 1 : headerIdx + 1;
  ast.lines.splice(at, 0, { kind: 'locks', raw, ids: list });
}

export function toggleLock(ast: Ast, id: string): void {
  const cur = getLocks(ast) ?? new Set<string>();
  if (cur.has(id)) cur.delete(id);
  else             cur.add(id);
  setLocks(ast, cur);
}

// ── Styles sidecar (Phase 5) ───────────────────────────────────────────────

export function getStyles(ast: Ast): StyleMap | null {
  for (const line of ast.lines) {
    if (line.kind === 'styles') return line.map;
  }
  return null;
}

export function getNodeStyle(ast: Ast, id: string): NodeStyle | null {
  return getStyles(ast)?.[id] ?? null;
}

function writeStylesLine(ast: Ast, map: StyleMap): void {
  // Drop entries with zero meaningful fields so the sidecar stays tidy.
  const filtered: StyleMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v.fill || v.border || v.text || v.fontSize !== undefined || v.bold !== undefined
        || v.italic !== undefined || v.underline !== undefined || v.strike !== undefined
        || v.borderWidth !== undefined || v.opacity !== undefined
        || v.strokeType !== undefined || v.textAlign !== undefined || v.verticalAlign !== undefined
        || v.padding !== undefined || v.lineHeight !== undefined
        || v.scale !== undefined) {
      filtered[k] = v;
    }
  }
  if (Object.keys(filtered).length === 0) {
    ast.lines = ast.lines.filter(l => l.kind !== 'styles');
    return;
  }
  const raw = `%% mb-styles: ${JSON.stringify(filtered)}`;
  const idx = ast.lines.findIndex(l => l.kind === 'styles');
  if (idx >= 0) {
    ast.lines[idx] = { kind: 'styles', raw, map: filtered };
    return;
  }
  // Insert after locks (if any) → positions → header.
  const lockIdx = ast.lines.findIndex(l => l.kind === 'locks');
  const posIdx  = ast.lines.findIndex(l => l.kind === 'positions');
  const headerIdx = ast.lines.findIndex(l => l.kind === 'header');
  const at = lockIdx >= 0 ? lockIdx + 1
           : posIdx  >= 0 ? posIdx  + 1
           : headerIdx + 1;
  ast.lines.splice(at, 0, { kind: 'styles', raw, map: filtered });
}

export function setNodeStyle(ast: Ast, id: string, partial: NodeStyle): void {
  const current = { ...(getStyles(ast) ?? {}) } as StyleMap;
  const merged = { ...(current[id] ?? {}), ...partial };
  current[id] = merged;
  writeStylesLine(ast, current);
}

export function clearNodeStyle(ast: Ast, id: string): void {
  const current = { ...(getStyles(ast) ?? {}) } as StyleMap;
  delete current[id];
  writeStylesLine(ast, current);
}

// ── Edge styles sidecar ────────────────────────────────────────────────────

export function getEdgeStyles(ast: Ast): EdgeStyleMap | null {
  for (const line of ast.lines) {
    if (line.kind === 'edge-styles') return line.map;
  }
  return null;
}

export function edgeKey(from: string, to: string, index = 0): string {
  return `${from}->${to}->${index}`;
}

export function getEdgeStyle(ast: Ast, key: string): EdgeStyle | null {
  return getEdgeStyles(ast)?.[key] ?? null;
}

function writeEdgeStylesLine(ast: Ast, map: EdgeStyleMap): void {
  const filtered: EdgeStyleMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v.type || v.thickness !== undefined || v.color || v.opacity !== undefined
        || v.animation !== undefined || v.animationDirection !== undefined
        || v.startCap !== undefined || v.endCap !== undefined) {
      filtered[k] = v;
    }
  }
  if (Object.keys(filtered).length === 0) {
    ast.lines = ast.lines.filter(l => l.kind !== 'edge-styles');
    return;
  }
  const raw = `%% mb-edge-styles: ${JSON.stringify(filtered)}`;
  const idx = ast.lines.findIndex(l => l.kind === 'edge-styles');
  if (idx >= 0) {
    ast.lines[idx] = { kind: 'edge-styles', raw, map: filtered };
    return;
  }
  const styleIdx = ast.lines.findIndex(l => l.kind === 'styles');
  const lockIdx  = ast.lines.findIndex(l => l.kind === 'locks');
  const posIdx   = ast.lines.findIndex(l => l.kind === 'positions');
  const headerIdx = ast.lines.findIndex(l => l.kind === 'header');
  const at = styleIdx >= 0 ? styleIdx + 1
           : lockIdx  >= 0 ? lockIdx  + 1
           : posIdx   >= 0 ? posIdx   + 1
           : headerIdx + 1;
  ast.lines.splice(at, 0, { kind: 'edge-styles', raw, map: filtered });
}

export function setEdgeStyle(ast: Ast, key: string, partial: EdgeStyle): void {
  const current = { ...(getEdgeStyles(ast) ?? {}) } as EdgeStyleMap;
  const merged = { ...(current[key] ?? {}), ...partial };
  current[key] = merged;
  writeEdgeStylesLine(ast, current);
}

export function deleteEdgeByKey(ast: Ast, key: string): void {
  const parts = key.split('->');
  if (parts.length < 2) return;
  const from = parts[0];
  const to   = parts[1];
  // Find the n-th occurrence of an edge with the same from/to.
  const targetIdx = parts[2] ? parseInt(parts[2], 10) : 0;
  let seen = 0;
  let removeAt = -1;
  for (let i = 0; i < ast.lines.length; i++) {
    const l = ast.lines[i];
    if (l.kind === 'edge' && l.edge.from === from && l.edge.to === to) {
      if (seen === targetIdx) { removeAt = i; break; }
      seen++;
    }
  }
  if (removeAt >= 0) ast.lines.splice(removeAt, 1);
  // Also strip the style entry.
  const styles = { ...(getEdgeStyles(ast) ?? {}) };
  delete styles[key];
  writeEdgeStylesLine(ast, styles);
}

// ── Standalone lines sidecar ───────────────────────────────────────────────
// New shape (current):
//   `%% mb-lines: [{ id: "L1",
//                    from: { kind: "free", x: 100, y: 50 },
//                    to:   { kind: "node", id: "A", side: "e", lastX: 250, lastY: 80 },
//                    color: "#1f2937", thickness: 1.5, type: "solid" }]`
//
// Legacy shape (still read for back-compat — converted on parse):
//   `%% mb-lines: [{ id: "L1", x1: 100, y1: 50, x2: 300, y2: 80, ... }]`
//
// Stored as an array (not a keyed map like the others) because lines have no
// natural "key" — they aren't tied to a node id and there's no equivalent of
// edge from/to. We use `id` so style edits and deletions can target a specific
// line without ambiguity. Each endpoint can be `free` (raw coords) or `node`
// (anchored to a hook on N/E/S/W of a node; follows the node as it moves).

export function getLines(ast: Ast): LineDecl[] {
  for (const line of ast.lines) {
    if (line.kind === 'lines') return line.lines;
  }
  return [];
}

function normalizeEndpoint(e: LineEndpoint): LineEndpoint {
  if (e.kind === 'free') {
    return { kind: 'free', x: Math.round(e.x), y: Math.round(e.y) };
  }
  // Anchored. Only include `lastX/lastY` (rounded) when present, so the
  // sidecar stays terse for newly-created anchored lines.
  const out: LineEndpoint = { kind: 'node', id: e.id, side: e.side };
  if (typeof e.lastX === 'number') out.lastX = Math.round(e.lastX);
  if (typeof e.lastY === 'number') out.lastY = Math.round(e.lastY);
  return out;
}

function writeLinesLine(ast: Ast, lines: LineDecl[]): void {
  // Drop the sidecar entirely when empty so the source stays tidy.
  if (lines.length === 0) {
    ast.lines = ast.lines.filter(l => l.kind !== 'lines');
    return;
  }
  const filtered: LineDecl[] = lines.map(l => {
    const out: LineDecl = {
      id:   l.id,
      from: normalizeEndpoint(l.from),
      to:   normalizeEndpoint(l.to),
    };
    if (l.color     !== undefined) out.color     = l.color;
    if (l.thickness !== undefined) out.thickness = l.thickness;
    if (l.type      !== undefined) out.type      = l.type;
    return out;
  });
  const raw = `%% mb-lines: ${JSON.stringify(filtered)}`;
  const idx = ast.lines.findIndex(l => l.kind === 'lines');
  if (idx >= 0) {
    ast.lines[idx] = { kind: 'lines', raw, lines: filtered };
    return;
  }
  // Insert after edge-styles → styles → locks → positions → header — matches
  // the chain used by every other sidecar so files stay sorted.
  const edgeStyleIdx = ast.lines.findIndex(l => l.kind === 'edge-styles');
  const styleIdx    = ast.lines.findIndex(l => l.kind === 'styles');
  const lockIdx     = ast.lines.findIndex(l => l.kind === 'locks');
  const posIdx      = ast.lines.findIndex(l => l.kind === 'positions');
  const headerIdx   = ast.lines.findIndex(l => l.kind === 'header');
  const at = edgeStyleIdx >= 0 ? edgeStyleIdx + 1
           : styleIdx     >= 0 ? styleIdx     + 1
           : lockIdx      >= 0 ? lockIdx      + 1
           : posIdx       >= 0 ? posIdx       + 1
           : headerIdx + 1;
  ast.lines.splice(at, 0, { kind: 'lines', raw, lines: filtered });
}

export function setLines(ast: Ast, lines: LineDecl[]): void {
  writeLinesLine(ast, lines);
}

/** Data-only endpoint fallback used by tests and pure-data code paths.
    For anchored endpoints this returns `lastX/lastY` if present (snapshot
    from the last render), otherwise null. The DOM layer has a richer
    resolver that uses live node positions. */
export function endpointFallbackCoords(e: LineEndpoint): { x: number; y: number } | null {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  if (typeof e.lastX === 'number' && typeof e.lastY === 'number') {
    return { x: e.lastX, y: e.lastY };
  }
  return null;
}

export function addLine(ast: Ast, line: Omit<LineDecl, 'id'>): LineDecl {
  const lines = getLines(ast).slice();
  const id = nextLineId(lines);
  const created: LineDecl = { id, ...line };
  lines.push(created);
  writeLinesLine(ast, lines);
  return created;
}

export function updateLineById(ast: Ast, id: string, partial: Partial<Omit<LineDecl, 'id'>>): void {
  const lines = getLines(ast).slice();
  const idx = lines.findIndex(l => l.id === id);
  if (idx < 0) return;
  lines[idx] = { ...lines[idx], ...partial, id };
  writeLinesLine(ast, lines);
}

export function deleteLineById(ast: Ast, id: string): void {
  const lines = getLines(ast).filter(l => l.id !== id);
  writeLinesLine(ast, lines);
}

function nextLineId(existing: LineDecl[]): string {
  const used = new Set(existing.map(l => l.id));
  for (let i = 1; i < 100000; i++) {
    const candidate = `L${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `L${Date.now()}`;
}

// ── Parsers (internal) ──────────────────────────────────────────────────────

// Order matters — more specific (longer) bracket pairs must come first so a
// "subroutine" line doesn't get caught by the "rect" regex.
const NODE_SHAPES: Array<[NodeShape, RegExp]> = [
  ['subroutine',    /^([A-Za-z][\w-]*)\[\[\s*"?([^\]"]*?)"?\s*\]\]$/],     // A[[Label]]
  ['cylinder',      /^([A-Za-z][\w-]*)\[\(\s*"?([^)"]*?)"?\s*\)\]$/],      // A[(Label)]
  ['pill',          /^([A-Za-z][\w-]*)\(\[\s*"?([^\]"]*?)"?\s*\]\)$/],     // A([Label])
  ['circle',        /^([A-Za-z][\w-]*)\(\(\s*"?([^)"]*?)"?\s*\)\)$/],      // A((Label))
  ['hexagon',       /^([A-Za-z][\w-]*)\{\{\s*"?([^}"]*?)"?\s*\}\}$/],      // A{{Label}}
  // Trapezoid / parallelogram family — slash/backslash delimiters. These must
  // come before `rect` (whose `[…]` would otherwise gobble the entire match).
  ['trapezoid',     /^([A-Za-z][\w-]*)\[\\\s*"?([^"]*?)"?\s*\/\]$/],       // A[\Label/]
  ['parallelogram', /^([A-Za-z][\w-]*)\[\/\s*"?([^"]*?)"?\s*\/\]$/],       // A[/Label/]
  ['rect',          /^([A-Za-z][\w-]*)\[\s*"?([^\]"]*?)"?\s*\]$/],         // A[Label]
  ['round',         /^([A-Za-z][\w-]*)\(\s*"?([^)"]*?)"?\s*\)$/],          // A(Label)
  ['diamond',       /^([A-Za-z][\w-]*)\{\s*"?([^}"]*?)"?\s*\}$/],          // A{Label}
];

// `%% mb-edge-styles: { "A->B->0": { type: "dashed", thickness: 2, color: "#...", opacity: 0.8, animated: true } }`
function tryParseEdgeStylesLine(trimmed: string): EdgeStyleMap | null {
  const m = trimmed.match(/^%%\s*mb-edge-styles:\s*(.+)$/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]) as unknown;
    if (!obj || typeof obj !== 'object') return null;
    const out: EdgeStyleMap = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const s = v as Record<string, unknown>;
      const entry: EdgeStyle = {};
      if (s.type === 'solid' || s.type === 'dashed' || s.type === 'dotted') entry.type = s.type;
      if (typeof s.thickness === 'number') entry.thickness = s.thickness;
      if (typeof s.color     === 'string') entry.color     = s.color;
      if (typeof s.opacity   === 'number') entry.opacity   = s.opacity;
      if (s.animation === 'none' || s.animation === 'slow' || s.animation === 'fast') {
        entry.animation = s.animation;
      } else if (typeof s.animated === 'boolean') {
        // Back-compat with old `animated: true/false` files.
        entry.animation = s.animated ? 'slow' : 'none';
      }
      if (s.animationDirection === 'forward' || s.animationDirection === 'reverse') {
        entry.animationDirection = s.animationDirection;
      }
      if (s.startCap === 'none' || s.startCap === 'arrow' || s.startCap === 'circle') entry.startCap = s.startCap;
      if (s.endCap   === 'none' || s.endCap   === 'arrow' || s.endCap   === 'circle') entry.endCap   = s.endCap;
      out[k] = entry;
    }
    return out;
  } catch {
    return null;
  }
}

// `%% mb-lines: [{ "id": "L1", "from": {...}, "to": {...}, ... }]`
//
// Accepts both the new endpoint form (`from`/`to` objects) and the legacy
// flat form (`x1`/`y1`/`x2`/`y2` numbers). Legacy pairs become two `free`
// endpoints — same coords, no anchor — so old sidecars keep round-tripping.
function tryParseEndpoint(v: unknown): LineEndpoint | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (s.kind === 'node' && typeof s.id === 'string'
      && (s.side === 'n' || s.side === 'e' || s.side === 's' || s.side === 'w')) {
    const out: LineEndpoint = { kind: 'node', id: s.id, side: s.side };
    if (typeof s.lastX === 'number') out.lastX = s.lastX;
    if (typeof s.lastY === 'number') out.lastY = s.lastY;
    return out;
  }
  if ((s.kind === 'free' || s.kind === undefined)
      && typeof s.x === 'number' && typeof s.y === 'number') {
    return { kind: 'free', x: s.x, y: s.y };
  }
  return null;
}

function tryParseLinesLine(trimmed: string): LineDecl[] | null {
  const m = trimmed.match(/^%%\s*mb-lines:\s*(.+)$/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[1]) as unknown;
    if (!Array.isArray(arr)) return null;
    const out: LineDecl[] = [];
    for (const v of arr) {
      if (!v || typeof v !== 'object') continue;
      const s = v as Record<string, unknown>;
      if (typeof s.id !== 'string') continue;
      let from: LineEndpoint | null = null;
      let to:   LineEndpoint | null = null;
      // New form.
      if (s.from !== undefined && s.to !== undefined) {
        from = tryParseEndpoint(s.from);
        to   = tryParseEndpoint(s.to);
      } else if (typeof s.x1 === 'number' && typeof s.y1 === 'number'
              && typeof s.x2 === 'number' && typeof s.y2 === 'number') {
        // Legacy flat form — convert each pair to a free endpoint.
        from = { kind: 'free', x: s.x1, y: s.y1 };
        to   = { kind: 'free', x: s.x2, y: s.y2 };
      }
      if (!from || !to) continue;
      const entry: LineDecl = { id: s.id, from, to };
      if (typeof s.color     === 'string') entry.color     = s.color;
      if (typeof s.thickness === 'number') entry.thickness = s.thickness;
      if (s.type === 'solid' || s.type === 'dashed' || s.type === 'dotted') entry.type = s.type;
      out.push(entry);
    }
    return out;
  } catch {
    return null;
  }
}

// `%% mb-styles: { "n1": { fill: "#...", border: "#...", text: "#...", fontSize: 14, bold: true } }`
function tryParseStylesLine(trimmed: string): StyleMap | null {
  const m = trimmed.match(/^%%\s*mb-styles:\s*(.+)$/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]) as unknown;
    if (!obj || typeof obj !== 'object') return null;
    const out: StyleMap = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const s = v as Record<string, unknown>;
      const entry: NodeStyle = {};
      if (typeof s.fill        === 'string') entry.fill        = s.fill;
      if (typeof s.border      === 'string') entry.border      = s.border;
      if (typeof s.text        === 'string') entry.text        = s.text;
      if (typeof s.fontSize    === 'number') entry.fontSize    = s.fontSize;
      if (typeof s.bold        === 'boolean') entry.bold       = s.bold;
      if (typeof s.italic      === 'boolean') entry.italic     = s.italic;
      if (typeof s.underline   === 'boolean') entry.underline  = s.underline;
      if (typeof s.strike      === 'boolean') entry.strike     = s.strike;
      if (typeof s.borderWidth === 'number') entry.borderWidth = s.borderWidth;
      if (typeof s.opacity     === 'number') entry.opacity     = s.opacity;
      if (s.strokeType === 'solid' || s.strokeType === 'dashed' || s.strokeType === 'dotted') {
        entry.strokeType = s.strokeType;
      }
      if (s.textAlign === 'left' || s.textAlign === 'center' || s.textAlign === 'right') {
        entry.textAlign = s.textAlign;
      }
      if (s.verticalAlign === 'top' || s.verticalAlign === 'middle' || s.verticalAlign === 'bottom') {
        entry.verticalAlign = s.verticalAlign;
      }
      if (s.padding === 'tight' || s.padding === 'normal' || s.padding === 'spacious') {
        entry.padding = s.padding;
      }
      if (s.lineHeight === 'tight' || s.lineHeight === 'normal') {
        entry.lineHeight = s.lineHeight;
      }
      if (Array.isArray(s.scale) && s.scale.length === 2
          && typeof s.scale[0] === 'number' && typeof s.scale[1] === 'number') {
        entry.scale = [s.scale[0], s.scale[1]];
      }
      out[k] = entry;
    }
    return out;
  } catch {
    return null;
  }
}

// `%% mb-locks: ["n1", "n2"]` — phase 4 sidecar listing locked node ids.
function tryParseLocksLine(trimmed: string): string[] | null {
  const m = trimmed.match(/^%%\s*mb-locks:\s*(.+)$/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[1]) as unknown;
    if (!Array.isArray(arr)) return null;
    return arr.filter((v): v is string => typeof v === 'string');
  } catch {
    return null;
  }
}

// `%% mb-positions: { "n1": [120,80], ... }` — our hidden sidecar.
function tryParsePositionsLine(trimmed: string): PositionMap | null {
  const m = trimmed.match(/^%%\s*mb-positions:\s*(.+)$/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]) as unknown;
    if (!obj || typeof obj !== 'object') return null;
    const out: PositionMap = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
        out[k] = [v[0], v[1]];
      }
    }
    return out;
  } catch {
    return null;
  }
}

function tryParseStandaloneNode(trimmed: string): NodeDecl | null {
  for (const [shape, re] of NODE_SHAPES) {
    const m = trimmed.match(re);
    if (m) return { id: m[1], label: m[2], shape, raw: trimmed };
  }
  // A bare id on its own line we treat as a node reference, but we won't
  // bother promoting it unless we have to. So treat as passthrough.
  return null;
}

// Edge pattern matchers — try in order, most specific first. Returns parsed
// from / to plus the arrow style. Only handles the canonical pair form
//   "X --[label?]--> Y"
// Chained edges (A --> B --> C) and fanouts (A --> B & C) are NOT recognized —
// they fall through to passthrough.
function tryParseEdge(trimmed: string): EdgeDecl | null {
  // Strip any trailing semicolon (mermaid tolerates it as separator).
  const line = trimmed.replace(/;\s*$/, '');

  // Inline node decls in edges (A[Label] --> B(Label)) — peel them off and
  // capture the implicit shape. We'll allow this and emit node + edge.
  const splitMatch = line.match(/^(.+?)\s*(==>|---|-\.->|-\.-|-->|--x|--o|--)\s*(?:\|"?([^"|]*)"?\|\s*)?(.+)$/);
  if (!splitMatch) {
    // Also try the form "A -- text --> B".
    const longArrow = line.match(/^(.+?)\s*--\s*"?([^-]+?)"?\s*-->\s*(.+)$/);
    if (longArrow) {
      const fromId = peelInlineId(longArrow[1].trim());
      const toId   = peelInlineId(longArrow[3].trim());
      if (!fromId || !toId) return null;
      return { from: fromId, to: toId, label: longArrow[2].trim(), arrow: 'arrow', raw: trimmed };
    }
    return null;
  }

  const [, lhs, op, label, rhs] = splitMatch;
  const fromId = peelInlineId(lhs.trim());
  const toId   = peelInlineId(rhs.trim());
  if (!fromId || !toId) return null;

  const arrow: EdgeDecl['arrow'] =
      op === '==>'  ? 'thick'
    : op === '-.->' ? 'dotted'
    : op === '-.-'  ? 'dotted'
    : op === '--x'  ? 'cross'
    : op === '--o'  ? 'circle'
    : op === '---'  ? 'open'
    : op === '--'   ? 'open'
    :                  'arrow';

  return { from: fromId, to: toId, label: label?.trim() || undefined, arrow, raw: trimmed };
}

// Extract a bare id from an "A" or "A[Label]" / "A(Label)" / etc. fragment.
// If the fragment carries inline node syntax, we accept it but only return the
// id — the inline declaration is preserved when the AST is serialized via the
// passthrough mechanism (this is a known mild lossiness for v1).
function peelInlineId(fragment: string): string | null {
  const bareMatch = fragment.match(/^([A-Za-z][\w-]*)$/);
  if (bareMatch) return bareMatch[1];
  const shapedMatch = fragment.match(/^([A-Za-z][\w-]*)[\[\(\{]/);
  if (shapedMatch) return shapedMatch[1];
  return null;
}

// ── Serializers (internal) ──────────────────────────────────────────────────

function emitLine(line: AnyLine): string {
  if (line.kind === 'header')    return line.raw;
  if (line.kind === 'pass')      return line.raw;
  if (line.kind === 'positions') return '    ' + line.raw;
  if (line.kind === 'locks')     return '    ' + line.raw;
  if (line.kind === 'styles')    return '    ' + line.raw;
  if (line.kind === 'edge-styles') return '    ' + line.raw;
  if (line.kind === 'lines')     return '    ' + line.raw;
  // For node/edge lines: if the parsed `raw` is still attached, emit it
  // verbatim (preserves the user's quoting and inline shape syntax).
  // Mutations clear `raw` to force a canonical re-emit.
  if (line.kind === 'node') {
    return '    ' + (line.node.raw ?? emitNode(line.node));
  }
  if (line.kind === 'edge') {
    return '    ' + (line.edge.raw ?? emitEdge(line.edge));
  }
  return '';
}

function emitNode(n: NodeDecl): string {
  // Always quote the label when emitting fresh — round-trip stability beats
  // a slightly noisier source. (Users editing the source directly can
  // restore unquoted forms; visual edits never strip quotes.)
  const label = `"${n.label.replace(/"/g, '\\"')}"`;
  switch (n.shape) {
    case 'rect':          return `${n.id}[${label}]`;
    case 'pill':          return `${n.id}([${label}])`;
    case 'circle':        return `${n.id}((${label}))`;
    case 'diamond':       return `${n.id}{${label}}`;
    case 'round':         return `${n.id}(${label})`;
    case 'subroutine':    return `${n.id}[[${label}]]`;
    case 'cylinder':      return `${n.id}[(${label})]`;
    case 'hexagon':       return `${n.id}{{${label}}}`;
    case 'trapezoid':     return `${n.id}[\\${label}/]`;
    case 'parallelogram': return `${n.id}[/${label}/]`;
    case 'text':          return `${n.id}[${label}]`;
  }
}

function emitEdge(e: EdgeDecl): string {
  // No-label edges always use the canonical arrow operator.
  if (!e.label) {
    const op =
        e.arrow === 'thick'  ? '==>'
      : e.arrow === 'dotted' ? '-.->'
      : e.arrow === 'cross'  ? '--x'
      : e.arrow === 'circle' ? '--o'
      : e.arrow === 'open'   ? '---'
      :                        '-->';
    return `${e.from} ${op} ${e.to}`;
  }
  // Labelled edges: use mermaid's pipe-style label syntax for the arrow types
  // that support it (`-->`, `==>`). For dotted use the `-. text .->` form. For
  // open / cross / circle use the `-- text --x` long form (label sits between
  // the dashes and the cap).
  switch (e.arrow) {
    case 'arrow':  return `${e.from} -->|${e.label}| ${e.to}`;
    case 'thick':  return `${e.from} ==>|${e.label}| ${e.to}`;
    case 'dotted': return `${e.from} -. ${e.label} .-> ${e.to}`;
    case 'cross':  return `${e.from} -- ${e.label} --x ${e.to}`;
    case 'circle': return `${e.from} -- ${e.label} --o ${e.to}`;
    case 'open':   return `${e.from} -- ${e.label} --- ${e.to}`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function defaultNode(id: string): NodeDecl {
  return { id, label: id, shape: 'rect' };
}

function lastIndexOfKind(ast: Ast, kind: AnyLine['kind']): number {
  for (let i = ast.lines.length - 1; i >= 0; i--) {
    if (ast.lines[i].kind === kind) return i;
  }
  return -1;
}

function nextId(ast: Ast): string {
  const used = new Set<string>();
  for (const line of ast.lines) {
    if (line.kind === 'node') used.add(line.node.id);
    if (line.kind === 'edge') { used.add(line.edge.from); used.add(line.edge.to); }
  }
  for (let i = 1; i < 10000; i++) {
    const candidate = `n${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `n${Date.now()}`;
}
