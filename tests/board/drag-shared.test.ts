/**
 * Tests for boardDragShared helpers.
 * Runs in Jest's default node environment with a lightweight document mock.
 */

// ---------------------------------------------------------------------------
// MockMouseEvent polyfill for Node.js environment
// ---------------------------------------------------------------------------
class MockMouseEvent {
  type: string;
  clientX: number;
  clientY: number;
  bubbles: boolean;

  constructor(type: string, opts: { clientX?: number; clientY?: number; bubbles?: boolean } = {}) {
    this.type = type;
    this.clientX = opts.clientX ?? 0;
    this.clientY = opts.clientY ?? 0;
    this.bubbles = opts.bubbles ?? false;
  }
}

// Make it available as MouseEvent in tests
(global as any).MouseEvent = MockMouseEvent;

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
const listeners: Map<string, Set<Function>> = new Map();

(global as any).document = {
  createElement: (tag: string) => makeFakeElement(tag),
  addEventListener: (event: string, handler: Function) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(handler);
  },
  removeEventListener: (event: string, handler: Function) => {
    if (listeners.has(event)) {
      listeners.get(event)!.delete(handler);
    }
  },
  dispatchEvent: (event: any) => {
    const eventType = event.type;
    if (listeners.has(eventType)) {
      listeners.get(eventType)!.forEach(handler => handler(event));
    }
  },
};

import { dropIndicator, startDrag } from '../../src/webview/boardDragShared';

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

describe('startDrag onClick', () => {
  beforeEach(() => {
    listeners.clear();
  });

  it('fires onClick (not onDrop) on a release with no movement', () => {
    const onDrop = jest.fn();
    const onClick = jest.fn();
    const down = new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true });
    startDrag(down, { onMove: () => {}, onDrop, onClick });
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 10, clientY: 10, bubbles: true }));
    expect(onDrop).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('fires onDrop (not onClick) once moved past threshold', () => {
    const onDrop = jest.fn();
    const onClick = jest.fn();
    const down = new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true });
    startDrag(down, { onMove: () => {}, onDrop, onClick });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100, bubbles: true }));
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('external cancel fires onCancel but never onClick', () => {
    const onCancel = jest.fn();
    const onClick = jest.fn();
    const down = new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true });
    const cancel = startDrag(down, { onMove: () => {}, onDrop: () => {}, onCancel, onClick });
    cancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
