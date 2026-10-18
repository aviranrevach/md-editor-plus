import { computeMap } from '../src/webview/structureMapCore';

const base = { docHeight: 1000, scrollY: 0, viewportHeight: 200 };

describe('computeMap', () => {
  it('maps heading docY to a fraction of the document height', () => {
    const r = computeMap({ ...base, headings: [
      { pos: 1, level: 1, docY: 0 },
      { pos: 9, level: 2, docY: 500 },
      { pos: 20, level: 3, docY: 1000 },
    ]});
    expect(r.ticks.map(t => t.topFrac)).toEqual([0, 0.5, 1]);
    expect(r.ticks.map(t => t.level)).toEqual([1, 2, 3]);
  });

  it('computes the viewport box from scroll position', () => {
    const r = computeMap({ ...base, headings: [], scrollY: 250 });
    expect(r.viewport.topFrac).toBeCloseTo(0.25);
    expect(r.viewport.heightFrac).toBeCloseTo(0.2);
  });

  it('clamps the viewport box to [0,1] at the bottom', () => {
    const r = computeMap({ ...base, headings: [], scrollY: 900 });
    expect(r.viewport.topFrac + r.viewport.heightFrac).toBeLessThanOrEqual(1);
    expect(r.viewport.topFrac).toBeCloseTo(0.8);
  });

  it('fills the rail when the whole document fits in the viewport', () => {
    const r = computeMap({ headings: [], docHeight: 150, scrollY: 0, viewportHeight: 200 });
    expect(r.viewport.topFrac).toBe(0);
    expect(r.viewport.heightFrac).toBe(1);
  });

  it('returns no ticks for an empty document', () => {
    expect(computeMap({ ...base, headings: [] }).ticks).toEqual([]);
  });

  it('handles a single heading', () => {
    const r = computeMap({ ...base, headings: [{ pos: 1, level: 1, docY: 300 }] });
    expect(r.ticks).toEqual([{ pos: 1, level: 1, topFrac: 0.3 }]);
  });

  it('clamps tick fractions into [0,1] when docY exceeds docHeight', () => {
    const r = computeMap({ ...base, headings: [{ pos: 1, level: 1, docY: 1500 }] });
    expect(r.ticks[0].topFrac).toBe(1);
  });
});
