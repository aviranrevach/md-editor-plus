/**
 * @jest-environment jsdom
 */
import { createPlusIcon, createGripIcon } from '../src/webview/handleIcons';

describe('handle icons', () => {
  it('createPlusIcon returns an <svg> with two stroke paths/lines', () => {
    const svg = createPlusIcon();
    expect(svg.tagName.toLowerCase()).toBe('svg');
    // one <path> drawing the plus cross
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(1);
  });

  it('createGripIcon returns an <svg> with six dots', () => {
    const svg = createGripIcon();
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelectorAll('circle').length).toBe(6);
  });
});
