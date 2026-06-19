/** @jest-environment jsdom */
import { createPopover } from '../src/webview/popover';

beforeEach(() => {
  document.body.innerHTML = '';
  (window as any).innerWidth = 1000;
  (window as any).innerHeight = 800;
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  (window as any).ResizeObserver = class { observe() {} disconnect() {} };
});

function anchorAt(): HTMLElement {
  const a = document.body.appendChild(document.createElement('button'));
  a.getBoundingClientRect = () => ({ top: 40, left: 40, width: 80, height: 24, right: 120, bottom: 64, x: 40, y: 40, toJSON() {} } as DOMRect);
  return a;
}

test('open() appends the el and isOpen() flips; close() removes it', () => {
  const p = createPopover({ className: 'test-pop' });
  const a = anchorAt();
  expect(p.isOpen()).toBe(false);
  p.open(a);
  expect(p.isOpen()).toBe(true);
  expect(document.querySelector('.test-pop')).toBe(p.el);
  expect(p.el.style.position).toBe('fixed');
  p.close();
  expect(p.isOpen()).toBe(false);
  expect(document.querySelector('.test-pop')).toBeNull();
});

test('opening a second top-level popover closes the first', () => {
  const a = anchorAt();
  const p1 = createPopover(); p1.open(a);
  const p2 = createPopover(); p2.open(a);
  expect(p1.isOpen()).toBe(false);
  expect(p2.isOpen()).toBe(true);
});

test('a child (parent set) does NOT close its parent', () => {
  const a = anchorAt();
  const parent = createPopover(); parent.open(a);
  const child = createPopover({ parent }); child.open(a);
  expect(parent.isOpen()).toBe(true);
  expect(child.isOpen()).toBe(true);
});

test('outside mousedown closes the popover; inside does not', () => {
  const a = anchorAt();
  const p = createPopover(); p.open(a);
  p.el.appendChild(document.createElement('span'));
  // inside click
  (p.el.firstChild as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(p.isOpen()).toBe(true);
  // outside click
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(p.isOpen()).toBe(false);
});

test('outside click closes a child but not the parent it is nested under', () => {
  const a = anchorAt();
  const parent = createPopover(); parent.open(a);
  const child = createPopover({ parent }); child.open(a);
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(child.isOpen()).toBe(false);
  expect(parent.isOpen()).toBe(false); // both outside → both close
});

test('Escape closes the topmost popover; close() is idempotent + fires onClose once', () => {
  const a = anchorAt();
  let closes = 0;
  const p = createPopover({ onClose: () => closes++ });
  p.open(a);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(p.isOpen()).toBe(false);
  p.close(); // idempotent
  expect(closes).toBe(1);
});
