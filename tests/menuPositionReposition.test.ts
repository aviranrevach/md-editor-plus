/** @jest-environment jsdom */
import { placeFloating } from '../src/webview/menuPosition';

function rect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top, left, width, height,
    right: left + width, bottom: top + height, x: left, y: top,
    toJSON() {},
  } as DOMRect;
}

test('reposition() bails when the anchor is detached (no top-left jump)', () => {
  const anchor = document.createElement('button');
  const el = document.createElement('div');
  document.body.appendChild(anchor);
  document.body.appendChild(el);
  anchor.getBoundingClientRect = () => rect(100, 120, 80, 24);

  const handle = placeFloating(el, anchor);
  const placedLeft = el.style.left;
  const placedTop = el.style.top;
  expect(placedLeft).not.toBe('');

  // Detach the anchor — simulates the host re-rendering while the popover is open.
  document.body.removeChild(anchor);
  const spy = jest.fn(() => rect(0, 0, 0, 0));
  anchor.getBoundingClientRect = spy;

  handle.reposition();

  expect(spy).not.toHaveBeenCalled();        // guard short-circuited before measuring
  expect(el.style.left).toBe(placedLeft);    // position is preserved, not flung to 0,0
  expect(el.style.top).toBe(placedTop);
  handle.destroy();
});
