// Smoke tests for the lines sidecar (Jest).
//
// Covers both data-model concerns:
//   - The new endpoint-based shape (free + anchored)
//   - Backwards-compat with the older flat {x1,y1,x2,y2} sidecar form
//   - Sensible fallback when an anchored node is deleted
import {
  parseMermaid, serializeMermaid, addLine, getLines, setLines,
  updateLineById, deleteLineById, LineDecl, LineEndpoint,
  deleteNode, endpointFallbackCoords,
} from '../../src/webview/mermaidVisualEdit';

const FREE = (x: number, y: number): LineEndpoint => ({ kind: 'free', x, y });

describe('mb-lines sidecar', () => {
  const baseSrc = `flowchart TB\n    A[Start] --> B[End]`;

  it('round-trips an empty diagram (no lines)', () => {
    expect(getLines(parseMermaid(baseSrc))).toEqual([]);
  });

  it('addLine + getLines (free endpoints)', () => {
    const ast = parseMermaid(baseSrc);
    const a = addLine(ast, {
      from: FREE(10, 20), to: FREE(100, 200),
      color: '#ff0000', thickness: 2, type: 'dashed',
    });
    const b = addLine(ast, { from: FREE(50, 60), to: FREE(150, 250) });
    expect(a.id).toBe('L1');
    expect(b.id).toBe('L2');
    expect(getLines(ast).length).toBe(2);
  });

  it('serialize then parse round-trips free-endpoint lines', () => {
    const ast = parseMermaid(baseSrc);
    addLine(ast, { from: FREE(10, 20), to: FREE(100, 200), color: '#ff0000', thickness: 2, type: 'dashed' });
    addLine(ast, { from: FREE(50, 60), to: FREE(150, 250) });
    const ser = serializeMermaid(ast);
    expect(ser).toMatch(/mb-lines:/);
    const reparsed = getLines(parseMermaid(ser));
    expect(reparsed.length).toBe(2);
    expect(reparsed[0].color).toBe('#ff0000');
    expect(reparsed[0].thickness).toBe(2);
    expect(reparsed[0].type).toBe('dashed');
    expect(reparsed[0].from).toEqual(FREE(10, 20));
    expect(reparsed[0].to).toEqual(FREE(100, 200));
    expect(reparsed[1].color).toBeUndefined();
  });

  it('updateLineById updates one line', () => {
    const ast = parseMermaid(baseSrc);
    addLine(ast, { from: FREE(0, 0), to: FREE(1, 1) });
    updateLineById(ast, 'L1', { color: '#0000ff' });
    expect(getLines(ast)[0].color).toBe('#0000ff');
  });

  it('deleteLineById removes a single line; empty list drops sidecar', () => {
    const ast = parseMermaid(baseSrc);
    addLine(ast, { from: FREE(0, 0), to: FREE(1, 1) });
    addLine(ast, { from: FREE(2, 2), to: FREE(3, 3) });
    deleteLineById(ast, 'L1');
    expect(getLines(ast).map((l: LineDecl) => l.id)).toEqual(['L2']);
    deleteLineById(ast, 'L2');
    expect(serializeMermaid(ast)).not.toMatch(/mb-lines/);
  });

  it('passthrough unrelated source lines remain intact', () => {
    const src = `flowchart TB\n    %% mb-positions: {"A":[10,20]}\n    A[Start] --> B[End]`;
    const ast = parseMermaid(src);
    addLine(ast, { from: FREE(0, 0), to: FREE(1, 1) });
    const ser = serializeMermaid(ast);
    expect(ser).toMatch(/mb-positions:/);
    expect(ser).toMatch(/mb-lines:/);
  });

  // ── Back-compat ─────────────────────────────────────────────────────────

  it('parses the legacy {x1,y1,x2,y2} sidecar form', () => {
    // Hand-built sidecar in the old flat shape.
    const legacy = `flowchart TB
    %% mb-lines: [{"id":"L1","x1":10,"y1":20,"x2":100,"y2":200,"color":"#ff0000","thickness":2,"type":"dashed"}]
    A[Start] --> B[End]`;
    const lines = getLines(parseMermaid(legacy));
    expect(lines.length).toBe(1);
    expect(lines[0].id).toBe('L1');
    // Each end pair becomes a free endpoint.
    expect(lines[0].from).toEqual(FREE(10, 20));
    expect(lines[0].to).toEqual(FREE(100, 200));
    expect(lines[0].color).toBe('#ff0000');
    expect(lines[0].thickness).toBe(2);
    expect(lines[0].type).toBe('dashed');
  });

  it('a legacy line, once mutated, re-serializes in the new endpoint shape', () => {
    // Untouched: the sidecar line is preserved as parsed (passthrough-style)
    // so a no-op round-trip stays byte-stable. Any mutation runs through
    // `writeLinesLine`, which always emits the new `from`/`to` shape.
    const legacy = `flowchart TB
    %% mb-lines: [{"id":"L1","x1":10,"y1":20,"x2":100,"y2":200}]
    A[Start] --> B[End]`;
    const ast = parseMermaid(legacy);
    updateLineById(ast, 'L1', { color: '#abcdef' });
    const ser = serializeMermaid(ast);
    // New shape uses `from`/`to` objects, not the bare x1/y1/x2/y2 keys.
    expect(ser).toMatch(/"from":/);
    expect(ser).toMatch(/"to":/);
    expect(ser).not.toMatch(/"x1":/);
    // The data round-trips back to the same free endpoints.
    const reparsed = getLines(parseMermaid(ser));
    expect(reparsed[0].from).toEqual(FREE(10, 20));
    expect(reparsed[0].to).toEqual(FREE(100, 200));
    expect(reparsed[0].color).toBe('#abcdef');
  });

  // ── Anchored endpoints ──────────────────────────────────────────────────

  it('round-trips an anchored endpoint through parse/serialize', () => {
    const ast = parseMermaid(baseSrc);
    addLine(ast, {
      from: { kind: 'node', id: 'A', side: 'e' },
      to:   FREE(200, 100),
    });
    const ser = serializeMermaid(ast);
    expect(ser).toMatch(/"kind":"node"/);
    expect(ser).toMatch(/"side":"e"/);
    const reparsed = getLines(parseMermaid(ser));
    expect(reparsed[0].from).toEqual({ kind: 'node', id: 'A', side: 'e' });
    expect(reparsed[0].to).toEqual(FREE(200, 100));
  });

  it('preserves lastX/lastY on an anchored endpoint through round-trip', () => {
    const ast = parseMermaid(baseSrc);
    addLine(ast, {
      from: { kind: 'node', id: 'A', side: 'e', lastX: 42, lastY: 24 },
      to:   FREE(200, 100),
    });
    const ser = serializeMermaid(ast);
    const reparsed = getLines(parseMermaid(ser));
    expect(reparsed[0].from).toEqual({ kind: 'node', id: 'A', side: 'e', lastX: 42, lastY: 24 });
  });

  it('endpointFallbackCoords falls back to lastX/lastY for anchored, null when missing', () => {
    expect(endpointFallbackCoords({ kind: 'free', x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(endpointFallbackCoords({ kind: 'node', id: 'A', side: 'n', lastX: 5, lastY: 6 }))
      .toEqual({ x: 5, y: 6 });
    expect(endpointFallbackCoords({ kind: 'node', id: 'A', side: 'n' })).toBeNull();
  });

  it('a line whose anchored node was deleted still serializes; the orphan endpoint resolves via lastX/lastY', () => {
    const ast = parseMermaid(baseSrc);
    addLine(ast, {
      from: { kind: 'node', id: 'A', side: 'e', lastX: 50, lastY: 60 },
      to:   FREE(200, 100),
    });
    // Delete the anchored node out from under the line.
    deleteNode(ast, 'A');
    // Line is still in the sidecar.
    const lines = getLines(ast);
    expect(lines.length).toBe(1);
    expect(lines[0].from.kind).toBe('node');
    // Fallback resolver returns the snapshot coords.
    expect(endpointFallbackCoords(lines[0].from)).toEqual({ x: 50, y: 60 });
    // And the sidecar still round-trips.
    expect(serializeMermaid(ast)).toMatch(/mb-lines:/);
  });

  // ── Mixed forms ─────────────────────────────────────────────────────────

  it('setLines accepts a mix of free and anchored entries', () => {
    const ast = parseMermaid(baseSrc);
    const mix: LineDecl[] = [
      { id: 'L1', from: FREE(0, 0), to: FREE(10, 10) },
      { id: 'L2', from: { kind: 'node', id: 'A', side: 'n' }, to: { kind: 'node', id: 'B', side: 's' } },
    ];
    setLines(ast, mix);
    const ser = serializeMermaid(ast);
    const reparsed = getLines(parseMermaid(ser));
    expect(reparsed.length).toBe(2);
    expect(reparsed[1].from).toEqual({ kind: 'node', id: 'A', side: 'n' });
    expect(reparsed[1].to).toEqual({ kind: 'node', id: 'B', side: 's' });
  });
});
