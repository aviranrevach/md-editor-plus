// Locks in the light-theme node fill values so casual edits can't
// silently revert the contrast fix. Other theme variables are
// intentionally not asserted — this test is single-purpose.

import { THEME_VARS } from '../../src/webview/mermaidRenderer';

describe('THEME_VARS.light node fills', () => {
  it('primaryColor is #dbeafe', () => {
    expect(THEME_VARS.light.primaryColor).toBe('#dbeafe');
  });

  it('mainBkg is #dbeafe', () => {
    expect(THEME_VARS.light.mainBkg).toBe('#dbeafe');
  });
});
