import { fitStatusColumnWidth } from '../src/webview/boardTableRender';

// c16: status/Impact pills overflowed their fixed-width column (table-layout:
// fixed pins the column, cells have overflow:visible, so a wide pill like
// "Urgent!!" spilled ~40px past the cell edge). Auto-fit grows the column to
// the widest pill while never shrinking below a user-configured width.
describe('fitStatusColumnWidth', () => {
  const PAD = 20; // cell horizontal padding (10px left + 10px right)

  it('keeps the configured width when there are no pills', () => {
    expect(fitStatusColumnWidth([], 60)).toBe(60);
  });

  it('grows the column to fit a pill wider than the configured width', () => {
    // "Urgent!!" measured ~82px in a 60px column -> needs 82 + 20 padding.
    expect(fitStatusColumnWidth([82], 60, PAD)).toBe(102);
  });

  it('fits the WIDEST pill in the column, not the first', () => {
    expect(fitStatusColumnWidth([56, 82, 60], 60, PAD)).toBe(102);
  });

  it('never shrinks below the configured width (respects a manual widen)', () => {
    // All pills fit in 60, and the user widened the column to 200 -> keep 200.
    expect(fitStatusColumnWidth([40, 50], 200, PAD)).toBe(200);
  });

  it('does not change a column where every pill already fits', () => {
    // Widest pill 30 + 20 pad = 50, which is < 60 configured -> stay 60.
    expect(fitStatusColumnWidth([30, 28], 60, PAD)).toBe(60);
  });

  it('rounds fractional pill widths up so the pill is never clipped by a sub-pixel', () => {
    expect(fitStatusColumnWidth([81.4], 60, PAD)).toBe(102);
  });
});
