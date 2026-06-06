import { createFlushableDebounce } from '../src/webview/flushableDebounce';

describe('createFlushableDebounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires the callback once after the delay elapses', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    d.schedule();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-scheduling resets the delay (debounce)', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    d.schedule();
    jest.advanceTimersByTime(400);
    d.schedule();
    jest.advanceTimersByTime(400);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush() fires a pending callback immediately and clears the timer', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    d.schedule();
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(500); // must not fire again
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush() with nothing pending does nothing', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel() drops the pending callback', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    d.schedule();
    d.cancel();
    jest.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    expect(d.pending()).toBe(false);
  });

  it('can be re-scheduled and fire again after a flush', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    d.schedule();
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    d.schedule();
    jest.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('pending() reflects whether a callback is queued', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    expect(d.pending()).toBe(false);
    d.schedule();
    expect(d.pending()).toBe(true);
    d.flush();
    expect(d.pending()).toBe(false);
  });
});
