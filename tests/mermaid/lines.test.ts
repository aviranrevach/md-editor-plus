// Smoke test for the lines sidecar (uses Jest)
import {
  parseMermaid, serializeMermaid, addLine, getLines,
  updateLineById, deleteLineById, LineDecl,
} from '../../src/webview/mermaidVisualEdit';

describe('mb-lines sidecar', () => {
  const baseSrc = `flowchart TB\n    A[Start] --> B[End]`;

  it('round-trips an empty diagram (no lines)', () => {
    expect(getLines(parseMermaid(baseSrc))).toEqual([]);
  });

  it('addLine + getLines', () => {
    const ast = parseMermaid(baseSrc);
    const a = addLine(ast, { x1: 10, y1: 20, x2: 100, y2: 200, color: '#ff0000', thickness: 2, type: 'dashed' });
    const b = addLine(ast, { x1: 50, y1: 60, x2: 150, y2: 250 });
    expect(a.id).toBe('L1');
    expect(b.id).toBe('L2');
    expect(getLines(ast).length).toBe(2);
  });

  it('serialize then parse round-trips lines', () => {
    const ast = parseMermaid(baseSrc);
    addLine(ast, { x1: 10, y1: 20, x2: 100, y2: 200, color: '#ff0000', thickness: 2, type: 'dashed' });
    addLine(ast, { x1: 50, y1: 60, x2: 150, y2: 250 });
    const ser = serializeMermaid(ast);
    expect(ser).toMatch(/mb-lines:/);
    const reparsed = getLines(parseMermaid(ser));
    expect(reparsed.length).toBe(2);
    expect(reparsed[0].color).toBe('#ff0000');
    expect(reparsed[0].thickness).toBe(2);
    expect(reparsed[0].type).toBe('dashed');
    expect(reparsed[1].color).toBeUndefined();
  });

  it('updateLineById updates one line', () => {
    const ast = parseMermaid(baseSrc);
    addLine(ast, { x1: 0, y1: 0, x2: 1, y2: 1 });
    updateLineById(ast, 'L1', { color: '#0000ff' });
    expect(getLines(ast)[0].color).toBe('#0000ff');
  });

  it('deleteLineById removes a single line; empty list drops sidecar', () => {
    const ast = parseMermaid(baseSrc);
    addLine(ast, { x1: 0, y1: 0, x2: 1, y2: 1 });
    addLine(ast, { x1: 2, y1: 2, x2: 3, y2: 3 });
    deleteLineById(ast, 'L1');
    expect(getLines(ast).map((l: LineDecl) => l.id)).toEqual(['L2']);
    deleteLineById(ast, 'L2');
    expect(serializeMermaid(ast)).not.toMatch(/mb-lines/);
  });

  it('passthrough unrelated source lines remain intact', () => {
    const src = `flowchart TB\n    %% mb-positions: {"A":[10,20]}\n    A[Start] --> B[End]`;
    const ast = parseMermaid(src);
    addLine(ast, { x1: 0, y1: 0, x2: 1, y2: 1 });
    const ser = serializeMermaid(ast);
    expect(ser).toMatch(/mb-positions:/);
    expect(ser).toMatch(/mb-lines:/);
  });
});
