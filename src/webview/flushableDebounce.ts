// A debounce that can be FLUSHED — firing the pending callback immediately
// instead of dropping it. Used so edits in flight are never lost when the
// editor blurs or the webview closes.
export interface FlushableDebounce {
  /** (Re)start the timer. Any previously scheduled callback is replaced. */
  schedule(): void;
  /** If a callback is pending, fire it now and clear the timer. Else no-op. */
  flush(): void;
  /** Drop any pending callback without firing it. */
  cancel(): void;
  /** True if a callback is currently queued. */
  pending(): boolean;
}

export function createFlushableDebounce(fn: () => void, delayMs: number): FlushableDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  return {
    schedule(): void {
      clear();
      timer = setTimeout(() => { timer = null; fn(); }, delayMs);
    },
    flush(): void {
      if (timer !== null) { clear(); fn(); }
    },
    cancel(): void { clear(); },
    pending(): boolean { return timer !== null; },
  };
}
