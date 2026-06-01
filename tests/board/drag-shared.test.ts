/**
 * Tests for boardDragShared helpers.
 * Runs in Jest's default node environment with a lightweight document mock.
 */

// ---------------------------------------------------------------------------
// Minimal DOM shim — just enough for dropIndicator() to work in Node.
// ---------------------------------------------------------------------------
function makeFakeElement(tag: string) {
  const classes = new Set<string>();
  const dataset: Record<string, string> = {};
  const style: Record<string, string> = {};

  // className setter keeps the internal class-set in sync,
  // mirroring what a real HTMLElement does.
  let _className = '';
  const el: any = {
    tagName: tag.toUpperCase(),
    get className() { return _className; },
    set className(v: string) {
      _className = v;
      classes.clear();
      v.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
    },
    classList: {
      contains: (c: string) => classes.has(c),
      add:      (c: string) => classes.add(c),
      remove:   (c: string) => classes.delete(c),
    },
    dataset,
    style,
  };
  return el;
}

// Patch global.document before importing the module under test.
(global as any).document = {
  createElement: (tag: string) => makeFakeElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
};

import { dropIndicator } from '../../src/webview/boardDragShared';

describe('dropIndicator', () => {
  it('creates a single 2px blue line element with the expected class', () => {
    const ind = dropIndicator();
    expect(ind.tagName).toBe('DIV');
    expect(ind.classList.contains('bd-drop-line')).toBe(true);
    expect(ind.dataset.role).toBe('drop-indicator');
  });
  it('show(x,y,w,h) sets position + size + visible class', () => {
    const ind = dropIndicator();
    ind.show(10, 20, 100, 2);
    expect(ind.style.left).toBe('10px');
    expect(ind.style.top).toBe('20px');
    expect(ind.style.width).toBe('100px');
    expect(ind.style.height).toBe('2px');
    expect(ind.classList.contains('bd-drop-line-visible')).toBe(true);
  });
  it('hide() removes the visible class', () => {
    const ind = dropIndicator();
    ind.show(0, 0, 50, 2);
    ind.hide();
    expect(ind.classList.contains('bd-drop-line-visible')).toBe(false);
  });
});
