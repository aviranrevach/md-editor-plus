/** @jest-environment jsdom */
import { openTagsPicker } from '../src/webview/boardTagsPicker';
import type { Board } from '../src/webview/boardModel';

beforeEach(() => {
  (window as any).innerWidth = 1000;
  (window as any).innerHeight = 800;
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  (window as any).ResizeObserver = class { observe() {} disconnect() {} };
});

const board: Board = {
  id: 'b1', name: 'B', columns: [], cards: [{ id: 'c1', values: {} }],
  fields: [{ name: 'Tags', type: 'tags' }], views: [], columnColors: {},
  fieldOptions: { Tags: [] }, activeView: 'table',
} as unknown as Board;

test('tags picker is fixed-positioned and stays on-screen near the right edge', () => {
  const anchor = document.body.appendChild(document.createElement('div'));
  anchor.getBoundingClientRect = () => ({ top: 40, left: 960, width: 30, height: 24, right: 990, bottom: 64, x: 960, y: 40, toJSON() {} } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { value: 240, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { value: 200, configurable: true });

  openTagsPicker(anchor, () => board, 'Tags', 'c1', () => {});

  const pop = document.querySelector('.bd-tags-pop') as HTMLElement;
  expect(pop.style.position).toBe('fixed');
  expect(parseFloat(pop.style.left)).toBeGreaterThanOrEqual(8);
  expect(parseFloat(pop.style.left) + 240).toBeLessThanOrEqual(1000 - 8);
});
