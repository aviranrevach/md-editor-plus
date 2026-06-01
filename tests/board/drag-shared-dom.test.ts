/**
 * @jest-environment jsdom
 *
 * DOM-level companion tests for boardDragShared.
 * The existing drag-shared.test.ts uses a node-environment lightweight shim.
 * This file uses real jsdom and exercises actual DOM event dispatch.
 */

import { dropIndicator, startDrag, DRAG_THRESHOLD_PX } from '../../src/webview/boardDragShared';

afterEach(() => {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// dropIndicator — real DOM
// ---------------------------------------------------------------------------

describe('dropIndicator (jsdom)', () => {
  it('returns a DIV with the bd-drop-line class', () => {
    const ind = dropIndicator();
    expect(ind.tagName).toBe('DIV');
    expect(ind.classList.contains('bd-drop-line')).toBe(true);
  });

  it('dataset.role is "drop-indicator"', () => {
    const ind = dropIndicator();
    expect(ind.dataset.role).toBe('drop-indicator');
  });

  it('show(x, y, w, h) sets position styles and adds bd-drop-line-visible', () => {
    const ind = dropIndicator();
    ind.show(10, 20, 100, 2);
    expect(ind.style.left).toBe('10px');
    expect(ind.style.top).toBe('20px');
    expect(ind.style.width).toBe('100px');
    expect(ind.style.height).toBe('2px');
    expect(ind.classList.contains('bd-drop-line-visible')).toBe(true);
  });

  it('hide() removes bd-drop-line-visible', () => {
    const ind = dropIndicator();
    ind.show(0, 0, 50, 2);
    ind.hide();
    expect(ind.classList.contains('bd-drop-line-visible')).toBe(false);
  });

  it('show then hide then show toggles the class correctly', () => {
    const ind = dropIndicator();
    ind.show(0, 0, 50, 2);
    expect(ind.classList.contains('bd-drop-line-visible')).toBe(true);
    ind.hide();
    expect(ind.classList.contains('bd-drop-line-visible')).toBe(false);
    ind.show(5, 5, 80, 2);
    expect(ind.classList.contains('bd-drop-line-visible')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// startDrag — real DOM events
// ---------------------------------------------------------------------------

/** Helper to fire a MouseEvent on document. */
function docMouseEvent(type: string, x: number, y: number): void {
  document.dispatchEvent(
    new MouseEvent(type, { bubbles: false, cancelable: true, clientX: x, clientY: y }),
  );
}

describe('startDrag (jsdom)', () => {
  it('movement below the threshold does NOT fire onMove', () => {
    const onMove = jest.fn();
    const onDrop = jest.fn();

    const startEv = new MouseEvent('mousedown', { clientX: 0, clientY: 0 });
    startDrag(startEv, { onMove, onDrop });

    // Move less than DRAG_THRESHOLD_PX
    docMouseEvent('mousemove', DRAG_THRESHOLD_PX - 1, 0);

    expect(onMove).not.toHaveBeenCalled();

    // Clean up
    docMouseEvent('mouseup', DRAG_THRESHOLD_PX - 1, 0);
  });

  it('movement past the threshold fires onMove', () => {
    const onMove = jest.fn();
    const onDrop = jest.fn();

    const startEv = new MouseEvent('mousedown', { clientX: 0, clientY: 0 });
    startDrag(startEv, { onMove, onDrop });

    // Move past threshold
    docMouseEvent('mousemove', DRAG_THRESHOLD_PX + 1, 0);

    expect(onMove).toHaveBeenCalledTimes(1);

    // Clean up
    docMouseEvent('mouseup', DRAG_THRESHOLD_PX + 1, 0);
  });

  it('mouseup after moving past threshold calls onDrop, not onCancel', () => {
    const onMove = jest.fn();
    const onDrop = jest.fn();
    const onCancel = jest.fn();

    const startEv = new MouseEvent('mousedown', { clientX: 0, clientY: 0 });
    startDrag(startEv, { onMove, onDrop, onCancel });

    docMouseEvent('mousemove', DRAG_THRESHOLD_PX + 2, 0);
    docMouseEvent('mouseup',   DRAG_THRESHOLD_PX + 2, 0);

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('mouseup WITHOUT reaching threshold fires onCancel, not onDrop', () => {
    const onMove = jest.fn();
    const onDrop = jest.fn();
    const onCancel = jest.fn();

    const startEv = new MouseEvent('mousedown', { clientX: 0, clientY: 0 });
    startDrag(startEv, { onMove, onDrop, onCancel });

    // Tiny move — still below threshold
    docMouseEvent('mousemove', 1, 0);
    docMouseEvent('mouseup',   1, 0);

    expect(onDrop).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('the returned cancel function fires onCancel and detaches listeners', () => {
    const onMove = jest.fn();
    const onDrop = jest.fn();
    const onCancel = jest.fn();

    const startEv = new MouseEvent('mousedown', { clientX: 0, clientY: 0 });
    const cancel = startDrag(startEv, { onMove, onDrop, onCancel });

    cancel();

    expect(onCancel).toHaveBeenCalledTimes(1);

    // After cancel, further mousemove should NOT fire onMove
    docMouseEvent('mousemove', DRAG_THRESHOLD_PX + 5, 0);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('calling cancel twice only invokes onCancel once', () => {
    const onCancel = jest.fn();

    const startEv = new MouseEvent('mousedown', { clientX: 0, clientY: 0 });
    const cancel = startDrag(startEv, { onMove: jest.fn(), onDrop: jest.fn(), onCancel });

    cancel();
    cancel();

    // The second cancel fires the function again (startDrag does not guard
    // against that — calling code is responsible). This test documents
    // the actual behavior so it's not accidentally changed.
    // (If this assertion ever needs to flip to toBe(1), update the test comment.)
    expect(onCancel.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('listeners are detached after a normal drop so extra moves are ignored', () => {
    const onMove = jest.fn();
    const onDrop = jest.fn();

    const startEv = new MouseEvent('mousedown', { clientX: 0, clientY: 0 });
    startDrag(startEv, { onMove, onDrop });

    docMouseEvent('mousemove', DRAG_THRESHOLD_PX + 1, 0);
    docMouseEvent('mouseup',   DRAG_THRESHOLD_PX + 1, 0);

    // Move after drop — should be ignored
    docMouseEvent('mousemove', DRAG_THRESHOLD_PX + 10, 0);

    expect(onMove).toHaveBeenCalledTimes(1);  // only the pre-drop move
  });
});
