// Tests for the slash-menu Whiteboard starter source.
// Pure data — node env, no DOM, mirrors tests/mermaid/lines.test.ts.

import { freshWhiteboardSource } from '../../src/webview/blockPicker';
import { parseMermaid, serializeMermaid, canEdit, getPositions } from '../../src/webview/mermaidVisualEdit';

describe('freshWhiteboardSource', () => {
  it('parses to 3 nodes A/B/C with labels Idea/Next/Done', () => {
    const src = freshWhiteboardSource();
    const ast = parseMermaid(src);
    const nodes = ast.lines
      .filter((l) => l.kind === 'node')
      .map((l) => (l as { kind: 'node'; node: { id: string; label: string } }).node);
    expect(nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
    expect(nodes.map((n) => n.label)).toEqual(['Idea', 'Next', 'Done']);
  });

  it('parses to 2 edges A->B and B->C', () => {
    const src = freshWhiteboardSource();
    const ast = parseMermaid(src);
    const edges = ast.lines
      .filter((l) => l.kind === 'edge')
      .map((l) => (l as { kind: 'edge'; edge: { from: string; to: string } }).edge);
    expect(edges.map((e) => `${e.from}->${e.to}`)).toEqual(['A->B', 'B->C']);
  });

  it('pins positions for A/B/C at the documented coordinates', () => {
    const ast = parseMermaid(freshWhiteboardSource());
    expect(getPositions(ast)).toEqual({
      A: [200, 200],
      B: [340, 200],
      C: [480, 200],
    });
  });

  it('canEdit returns true (visual editor accepts the starter)', () => {
    expect(canEdit(freshWhiteboardSource())).toBe(true);
  });

  it('serialize(parse(src)) === src — round-trip is byte-clean', () => {
    const src = freshWhiteboardSource();
    expect(serializeMermaid(parseMermaid(src))).toBe(src);
  });
});
