/** @jest-environment jsdom */
import { placeFloating } from '../src/webview/menuPosition';

function sized(el: HTMLElement, w: number, h: number) {
  Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true });
}

beforeEach(() => {
  (window as any).innerWidth = 1000;
  (window as any).innerHeight = 800;
  // run rAF synchronously
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  (window as any).ResizeObserver = class { observe() {} disconnect() {} };
});

test('positions a fitting menu below the anchor, no is-scroll', () => {
  const anchor = document.body.appendChild(document.createElement('div'));
  anchor.getBoundingClientRect = () => ({ top: 40, left: 40, width: 120, height: 30, right: 160, bottom: 70, x: 40, y: 40, toJSON() {} } as DOMRect);
  const menu = document.body.appendChild(document.createElement('div'));
  sized(menu, 220, 200);

  placeFloating(menu, anchor);

  expect(menu.style.position).toBe('fixed');
  expect(menu.style.top).toBe('74px');
  expect(menu.style.left).toBe('40px');
  expect(menu.classList.contains('is-scroll')).toBe(false);
});

test('adds is-scroll + max-height when taller than its side', () => {
  const anchor = document.body.appendChild(document.createElement('div'));
  anchor.getBoundingClientRect = () => ({ top: 380, left: 40, width: 120, height: 30, right: 160, bottom: 410, x: 40, y: 380, toJSON() {} } as DOMRect);
  const menu = document.body.appendChild(document.createElement('div'));
  sized(menu, 220, 700);

  placeFloating(menu, anchor);

  expect(menu.classList.contains('is-scroll')).toBe(true);
  expect(menu.style.maxHeight).not.toBe('');
});

test('destroy() disconnects the observer and is safe to call', () => {
  const anchor = document.body.appendChild(document.createElement('div'));
  anchor.getBoundingClientRect = () => ({ top: 10, left: 10, width: 50, height: 20, right: 60, bottom: 30, x: 10, y: 10, toJSON() {} } as DOMRect);
  const menu = document.body.appendChild(document.createElement('div'));
  sized(menu, 200, 100);
  const handle = placeFloating(menu, anchor);
  expect(() => handle.destroy()).not.toThrow();
});
