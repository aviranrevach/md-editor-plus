import { computeListScrollTop } from '../src/webview/menuPosition';

// c53: arrowing down through a capped menu moved the highlight but never
// scrolled the list, so the active row walked off the bottom — and in the block
// picker it slid behind the sticky footer, which overlays the scroll viewport.
//
// A menu row is ~28px, the picker caps at 440px and its footer is ~28px.

const base = { scrollTop: 0, viewport: 100, content: 500, rowTop: 0, rowHeight: 20 };

describe('computeListScrollTop — only scrolls on true overflow', () => {
  test('a fully visible row leaves scrollTop untouched', () => {
    expect(computeListScrollTop({ ...base, rowTop: 10 })).toBe(0);
  });

  test('a row flush with the bottom edge is still left alone', () => {
    expect(computeListScrollTop({ ...base, rowTop: 80 })).toBe(0);
  });

  test('nothing to scroll when the content fits the viewport', () => {
    expect(computeListScrollTop({ ...base, viewport: 200, content: 150, rowTop: 120 })).toBe(0);
  });
});

describe('computeListScrollTop — reveals a row past the bottom', () => {
  test('scrolls the minimum needed to show it', () => {
    // Row 100..120 with a 100px viewport → scroll 20 so it ends flush.
    expect(computeListScrollTop({ ...base, rowTop: 100 })).toBe(20);
  });

  test('accounts for a sticky footer overlaying the viewport (the c53 bug)', () => {
    // Without insetBottom this would return 20 and the row would sit *behind*
    // the 30px footer. The band is only 70px tall, so it must scroll 50.
    expect(computeListScrollTop({ ...base, rowTop: 100, insetBottom: 30 })).toBe(50);
  });

  test('pad keeps breathing room below the row', () => {
    expect(computeListScrollTop({ ...base, rowTop: 100, pad: 4 })).toBe(24);
  });
});

describe('computeListScrollTop — reveals a row above the band', () => {
  test('aligns the row to the top edge', () => {
    expect(computeListScrollTop({ ...base, scrollTop: 200, rowTop: 150 })).toBe(150);
  });

  test('accounts for a sticky header', () => {
    expect(computeListScrollTop({ ...base, scrollTop: 200, rowTop: 150, insetTop: 30 })).toBe(120);
  });
});

describe('computeListScrollTop — clamping', () => {
  test('never scrolls past the end of the content', () => {
    // maxScroll is 50 here (content 150 - viewport 100).
    expect(computeListScrollTop({ ...base, content: 150, rowTop: 140 })).toBe(50);
  });

  test('never scrolls above the start', () => {
    expect(computeListScrollTop({ ...base, scrollTop: 10, rowTop: 0 })).toBe(0);
  });
});

describe('computeListScrollTop — degenerate geometry', () => {
  test('a row taller than the band shows its start, not its middle', () => {
    // Band is 70px (100 viewport - 30 footer); the row is 90px.
    expect(computeListScrollTop({ ...base, rowTop: 0, rowHeight: 90, insetBottom: 30 })).toBe(0);
    // Same, further down the list — still aligned to the row's own top.
    expect(computeListScrollTop({ ...base, rowTop: 200, rowHeight: 90, insetBottom: 30 })).toBe(200);
  });

  test('a zero-height viewport does not produce a negative scrollTop', () => {
    const out = computeListScrollTop({ ...base, viewport: 0, rowTop: 0 });
    expect(out).toBeGreaterThanOrEqual(0);
  });
});

describe('computeListScrollTop — walking a real picker list', () => {
  // 20 rows of 28px inside a 200px viewport, with a 28px sticky footer. The
  // footer sits in normal flow (sticky only changes where it PAINTS), so it
  // counts toward scrollHeight — which is what leaves the last row enough room
  // to scroll clear of it. The visible band is 172px, so ~6 rows show at once.
  const ROW = 28;
  const FOOTER = 28;
  const ROWS = 20;
  const geom = {
    viewport: 200,
    content: ROWS * ROW + FOOTER,
    insetBottom: FOOTER,
    rowHeight: ROW,
    pad: 0,
  };
  const maxScroll = geom.content - geom.viewport;

  function expectRowVisible(scrollTop: number, i: number): void {
    expect(i * ROW).toBeGreaterThanOrEqual(scrollTop);
    expect(i * ROW + ROW).toBeLessThanOrEqual(scrollTop + geom.viewport - geom.insetBottom);
  }

  test('the highlight stays clear of the footer for every row on the way down', () => {
    let scrollTop = 0;
    for (let i = 0; i < ROWS; i++) {
      scrollTop = computeListScrollTop({ ...geom, scrollTop, rowTop: i * ROW });
      expectRowVisible(scrollTop, i);
    }
    expect(scrollTop).toBe(maxScroll);
  });

  test('and on the way back up', () => {
    let scrollTop = maxScroll;
    for (let i = ROWS - 1; i >= 0; i--) {
      scrollTop = computeListScrollTop({ ...geom, scrollTop, rowTop: i * ROW });
      expectRowVisible(scrollTop, i);
    }
    expect(scrollTop).toBe(0);
  });
});
