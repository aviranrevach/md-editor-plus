/**
 * @jest-environment jsdom
 */
import { createReadOnlyController } from '../src/webview/readonlyState';

function setup() {
  const root = document.createElement('html');
  const toggleSwitch = document.createElement('button');
  const pill = document.createElement('span');
  pill.hidden = true;
  const editableCalls: boolean[] = [];
  const ctrl = createReadOnlyController({
    root, toggleSwitch, pill,
    setEditable: (e) => editableCalls.push(e),
  });
  return { root, toggleSwitch, pill, editableCalls, ctrl };
}

describe('readonlyState controller', () => {
  test('starts editable', () => {
    expect(setup().ctrl.get()).toBe(false);
  });

  test('set(true) locks everything', () => {
    const { root, toggleSwitch, pill, editableCalls, ctrl } = setup();
    ctrl.set(true);
    expect(ctrl.get()).toBe(true);
    expect(root.classList.contains('read-only')).toBe(true);
    expect(toggleSwitch.classList.contains('on')).toBe(true);
    expect(toggleSwitch.getAttribute('aria-checked')).toBe('true');
    expect(pill.hidden).toBe(false);
    expect(editableCalls).toEqual([false]);
  });

  test('set(false) unlocks everything', () => {
    const { root, toggleSwitch, pill, editableCalls, ctrl } = setup();
    ctrl.set(true);
    ctrl.set(false);
    expect(ctrl.get()).toBe(false);
    expect(root.classList.contains('read-only')).toBe(false);
    expect(toggleSwitch.classList.contains('on')).toBe(false);
    expect(toggleSwitch.getAttribute('aria-checked')).toBe('false');
    expect(pill.hidden).toBe(true);
    expect(editableCalls).toEqual([false, true]);
  });

  test('null toggleSwitch/pill are tolerated', () => {
    const root = document.createElement('html');
    const ctrl = createReadOnlyController({ root, toggleSwitch: null, pill: null, setEditable: () => {} });
    expect(() => ctrl.set(true)).not.toThrow();
    expect(root.classList.contains('read-only')).toBe(true);
  });
});
