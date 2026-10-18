import { slashShouldOpenPicker } from '../src/webview/slashTrigger';

describe('slashShouldOpenPicker', () => {
  it('opens on an empty block with a collapsed selection', () => {
    expect(slashShouldOpenPicker('', true)).toBe(true);
  });

  it('does not open when the block already has text', () => {
    expect(slashShouldOpenPicker('and/or', true)).toBe(false);
  });

  it('does not open when the selection is a range (not collapsed)', () => {
    expect(slashShouldOpenPicker('', false)).toBe(false);
  });
});
