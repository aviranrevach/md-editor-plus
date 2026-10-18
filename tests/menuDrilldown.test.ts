/** @jest-environment jsdom */
import { createMenu } from '../src/webview/menu';

beforeEach(() => {
  document.body.innerHTML = '';
  (window as any).innerWidth = 1000; (window as any).innerHeight = 800;
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  (window as any).ResizeObserver = class { observe() {} disconnect() {} };
});
function anchorAt(): HTMLElement {
  const a = document.body.appendChild(document.createElement('button'));
  a.getBoundingClientRect = () => ({ top: 40, left: 40, width: 80, height: 24, right: 120, bottom: 64, x: 40, y: 40, toJSON() {} } as DOMRect);
  return a;
}

test('selecting a submenu item pushes a sub-view with a back row; back pops', () => {
  const m = createMenu();
  m.open(anchorAt(), [{ items: [
    { label: 'Turn into', submenu: () => [{ items: [{ label: 'Heading', onSelect() {} }, { label: 'Quote', onSelect() {} }] }] },
  ]}]);
  const el = m.popover.el;
  expect(el.querySelector('.mp-menu-back')).toBeNull(); // root has no back

  (el.querySelector('.mp-menu-item') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(el.querySelector('.mp-menu-back')).toBeTruthy();
  expect(Array.from(el.querySelectorAll('.mp-menu-label')).map(n => n.textContent)).toContain('Heading');
  expect(m.popover.isOpen()).toBe(true); // drilling does not close

  (el.querySelector('.mp-menu-back') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(el.querySelector('.mp-menu-back')).toBeNull(); // back to root
  expect(Array.from(el.querySelectorAll('.mp-menu-label')).map(n => n.textContent)).toContain('Turn into');
});

test('selecting a leaf inside a sub-view fires onSelect and closes', () => {
  const m = createMenu();
  let picked = '';
  m.open(anchorAt(), [{ items: [
    { label: 'More', submenu: () => [{ items: [{ label: 'Leaf', onSelect() { picked = 'leaf'; } }] }] },
  ]}]);
  const el = m.popover.el;
  (el.querySelector('.mp-menu-item') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const leaf = Array.from(el.querySelectorAll('.mp-menu-item')).find(n => n.textContent?.includes('Leaf')) as HTMLElement;
  leaf.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(picked).toBe('leaf');
  expect(m.popover.isOpen()).toBe(false);
});
