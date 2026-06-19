import { computePlacement } from '../src/webview/menuPosition';

const VP = { width: 1000, height: 800 };

test('fits below a top-left anchor: below, left-aligned, no scroll', () => {
  const p = computePlacement({
    anchor: { top: 40, left: 40, width: 120, height: 30 },
    size: { width: 220, height: 200 }, viewport: VP,
  });
  expect(p.side).toBe('below');
  expect(p.top).toBe(40 + 30 + 4);
  expect(p.left).toBe(40);
  expect(p.scroll).toBe(false);
  expect(p.maxHeight).toBeNull();
});

test('near right edge: right-aligns to the anchor, stays on-screen', () => {
  const p = computePlacement({
    anchor: { top: 40, left: 920, width: 60, height: 30 },
    size: { width: 220, height: 200 }, viewport: VP,
  });
  expect(p.left).toBe(920 + 60 - 220);            // right-aligned
  expect(p.left).toBeGreaterThanOrEqual(8);
});

test('near bottom edge: flips above the anchor', () => {
  const p = computePlacement({
    anchor: { top: 760, left: 40, width: 120, height: 30 },
    size: { width: 220, height: 200 }, viewport: VP,
  });
  expect(p.side).toBe('above');
  expect(p.top).toBe(760 - 4 - 200);
});

test('taller than either side: picks roomier side, caps height, scrolls, never covers anchor', () => {
  // anchor mid-screen; each side ~ (800/2 - margins) < 700
  const p = computePlacement({
    anchor: { top: 380, left: 40, width: 120, height: 30 },
    size: { width: 220, height: 700 }, viewport: VP,
  });
  expect(p.scroll).toBe(true);
  expect(p.maxHeight).not.toBeNull();
  // does not overlap the anchor vertically
  const bottom = p.top + (p.maxHeight as number);
  const overlaps = !(bottom <= 380 || p.top >= 410);
  expect(overlaps).toBe(false);
  // stays within viewport
  expect(p.top).toBeGreaterThanOrEqual(8);
  expect(bottom).toBeLessThanOrEqual(800 - 8);
});

test('short menu in a corner never scrolls', () => {
  const p = computePlacement({
    anchor: { top: 770, left: 940, width: 50, height: 24 },
    size: { width: 220, height: 180 }, viewport: VP,
  });
  expect(p.scroll).toBe(false);
  expect(p.left).toBeGreaterThanOrEqual(8);
  expect(p.left + 220).toBeLessThanOrEqual(1000 - 8);
  expect(p.top).toBeGreaterThanOrEqual(8);
});

test('maxHeight caps a tall menu and scrolls even when the side has room', () => {
  // Anchor near the top: 658px of room below, content is 700px. Without a cap
  // the menu would fit below at full height. With a 440px cap it stays compact,
  // scrolls, and still opens right below the anchor (no jump to the top).
  const p = computePlacement({
    anchor: { top: 40, left: 40, width: 120, height: 30 },
    size: { width: 220, height: 700 }, viewport: VP, maxHeight: 440,
  });
  expect(p.side).toBe('below');
  expect(p.top).toBe(40 + 30 + 4);     // sits at the anchor, not clamped away
  expect(p.scroll).toBe(true);
  expect(p.maxHeight).toBe(440);
});

test('maxHeight larger than the content has no effect', () => {
  const p = computePlacement({
    anchor: { top: 40, left: 40, width: 120, height: 30 },
    size: { width: 220, height: 200 }, viewport: VP, maxHeight: 440,
  });
  expect(p.scroll).toBe(false);
  expect(p.maxHeight).toBeNull();
});

test('maxHeight is further capped by the available side space', () => {
  // Anchor mid-screen: each side ~ 358px. A 440px cap can't be honored, so the
  // menu caps to the side space and scrolls, never covering the anchor.
  const p = computePlacement({
    anchor: { top: 380, left: 40, width: 120, height: 30 },
    size: { width: 220, height: 700 }, viewport: VP, maxHeight: 440,
  });
  expect(p.scroll).toBe(true);
  expect(p.maxHeight as number).toBeLessThanOrEqual(440);
  const bottom = p.top + (p.maxHeight as number);
  expect(p.top).toBeGreaterThanOrEqual(8);
  expect(bottom).toBeLessThanOrEqual(800 - 8);
});
