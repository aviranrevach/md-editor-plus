export interface Rect { top: number; left: number; width: number; height: number; }
export interface PlacementInput {
  anchor: Rect;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  margin?: number;
  gap?: number;
  preferX?: 'left' | 'right';
}
export interface Placement {
  left: number;
  top: number;
  side: 'above' | 'below';
  maxHeight: number | null;
  scroll: boolean;
}

const FUZZ = 2;

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;            // element bigger than the gap: pin to margin
  return Math.max(lo, Math.min(v, hi));
}

export function computePlacement(input: PlacementInput): Placement {
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 4;
  const preferX = input.preferX ?? 'left';
  const { anchor: a, size, viewport: vp } = input;

  // Vertical side that never covers the anchor.
  const spaceBelow = vp.height - (a.top + a.height) - gap - margin;
  const spaceAbove = a.top - gap - margin;

  let side: 'above' | 'below';
  let avail: number;
  if (size.height <= spaceBelow + FUZZ)      { side = 'below'; avail = spaceBelow; }
  else if (size.height <= spaceAbove + FUZZ) { side = 'above'; avail = spaceAbove; }
  else if (spaceBelow >= spaceAbove)         { side = 'below'; avail = spaceBelow; }
  else                                       { side = 'above'; avail = spaceAbove; }

  const scroll = size.height > avail + FUZZ;
  const maxHeight = scroll ? Math.max(0, avail) : null;
  const effH = scroll ? Math.max(0, avail) : size.height;

  let top = side === 'below' ? a.top + a.height + gap : a.top - gap - effH;

  // Horizontal: left-aligned (or right per preferX); flip if it would cross.
  let left: number;
  if (preferX === 'right') {
    left = a.left + a.width - size.width;
    if (left < margin) left = a.left;                  // flip to left-aligned
  } else {
    left = a.left;
    if (left + size.width > vp.width - margin) left = a.left + a.width - size.width;
  }

  left = clamp(left, margin, vp.width - size.width - margin);
  top = clamp(top, margin, vp.height - effH - margin);

  return { left, top, side, maxHeight, scroll };
}

export interface PlaceOpts { margin?: number; gap?: number; preferX?: 'left' | 'right'; }
export interface PlacementHandle { reposition(): void; destroy(): void; }

export function placeFloating(el: HTMLElement, anchor: HTMLElement, opts: PlaceOpts = {}): PlacementHandle {
  el.style.position = 'fixed';

  // reposition() mutates el's own height/overflow (the max-height cap and the
  // .is-scroll class), which itself resizes el. If the ResizeObserver below
  // simply re-ran reposition() on every resize, our own writes would retrigger
  // it forever — a feedback loop that visibly flickers the scrollbar (and lets
  // the native bar flash through). To break it we DISCONNECT the observer
  // while mutating, then re-observe on the next frame; re-observing fires one
  // initial callback for the settled size, which `skipNext` swallows. Only a
  // genuine later resize (a drill-down swapping content) gets through.
  let ro: ResizeObserver | null = null;
  let skipNext = false;

  function reposition(): void {
    ro?.disconnect();
    const a = anchor.getBoundingClientRect();
    // Natural (uncapped) border-box height WITHOUT removing the cap: scrollHeight
    // is the full content height even while max-height + overflow are applied, so
    // we never strip .is-scroll to remeasure. Stripping it every reposition made
    // the native scrollbar flash (dark) on each call — visible during a window
    // drag, where reposition fires continuously.
    const naturalHeight = el.scrollHeight + (el.offsetHeight - el.clientHeight);
    const p = computePlacement({
      anchor: { top: a.top, left: a.left, width: a.width, height: a.height },
      size: { width: el.offsetWidth, height: naturalHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      margin: opts.margin, gap: opts.gap, preferX: opts.preferX,
    });
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
    if (p.scroll) { el.classList.add('is-scroll'); el.style.maxHeight = `${p.maxHeight ?? 0}px`; }
    else { el.classList.remove('is-scroll'); el.style.maxHeight = ''; }
    if (ro) {
      requestAnimationFrame(() => {
        if (!el.isConnected || !ro) return;
        skipNext = true;
        ro.observe(el);
      });
    }
  }

  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (skipNext) { skipNext = false; return; }
      reposition();
    });
  }

  // Place synchronously so the menu never paints a frame at the wrong spot /
  // uncapped (that 1-frame gap was a visible flash on first open). Callers
  // reveal the element (remove the hidden class) before calling placeFloating,
  // so reading offset/scrollHeight here forces a valid synchronous layout. This
  // first reposition also starts the observation.
  reposition();

  const onWinResize = () => reposition();
  window.addEventListener('resize', onWinResize);

  function destroy(): void {
    if (ro) ro.disconnect();
    window.removeEventListener('resize', onWinResize);
  }

  return { reposition, destroy };
}
