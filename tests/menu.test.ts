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

test('renders sections, labels, dividers, and item variants', () => {
  const m = createMenu();
  m.open(anchorAt(), [
    { label: 'Group A', items: [
      { icon: 'I', label: 'Plain', onSelect() {} },
      { label: 'Current', checked: true, onSelect() {} },
    ]},
    { items: [ { label: 'Delete', variant: 'danger', onSelect() {} } ] },
  ]);
  const el = m.popover.el;
  expect(el.querySelectorAll('.mp-menu-item').length).toBe(3);
  expect(el.querySelector('.mp-menu-section')?.textContent).toBe('Group A');
  expect(el.querySelectorAll('.mp-menu-divider').length).toBe(1);
  expect(el.querySelector('.mp-menu-check')).toBeTruthy();
  expect(el.querySelector('.mp-menu-item.is-danger')).toBeTruthy();
});

test('clicking an item fires onSelect and closes the menu', () => {
  const m = createMenu();
  let picked = '';
  m.open(anchorAt(), [{ items: [{ label: 'Pick me', onSelect() { picked = 'yes'; } }] }]);
  const row = m.popover.el.querySelector('.mp-menu-item') as HTMLElement;
  row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(picked).toBe('yes');
  expect(m.popover.isOpen()).toBe(false);
});

test('a disabled item does not fire onSelect or close', () => {
  const m = createMenu();
  let fired = false;
  m.open(anchorAt(), [{ items: [{ label: 'Nope', disabled: true, onSelect() { fired = true; } }] }]);
  const row = m.popover.el.querySelector('.mp-menu-item') as HTMLElement;
  row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(fired).toBe(false);
  expect(m.popover.isOpen()).toBe(true);
});

test('trailing element is rendered and its clicks do not close the menu', () => {
  const m = createMenu();
  const toggle = document.createElement('button'); toggle.className = 'my-toggle';
  m.open(anchorAt(), [{ items: [{ label: 'Has toggle', trailing: toggle }] }]);
  expect(m.popover.el.querySelector('.my-toggle')).toBe(toggle);
  toggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(m.popover.isOpen()).toBe(true);
});
