export interface Rect { top: number; left: number; width: number; height: number; }
export interface PlacementInput {
  anchor: Rect;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  margin?: number;
  gap?: number;
  preferX?: 'left' | 'right';
  // Absolute height ceiling (px). When set, the menu never grows past it even
  // if the side has more room — it caps and scrolls instead (Notion-style).
  // Still further capped by the available side space. Omit for no ceiling.
  maxHeight?: number;
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

  // The height we try to place: the content, capped by an optional ceiling.
  // Side selection uses this so a tall menu with a ceiling still sits at its
  // anchor instead of flipping/clamping to fit its full natural height.
  const cappedH = Math.min(size.height, input.maxHeight ?? Infinity);

  let side: 'above' | 'below';
  let avail: number;
  if (cappedH <= spaceBelow + FUZZ)      { side = 'below'; avail = spaceBelow; }
  else if (cappedH <= spaceAbove + FUZZ) { side = 'above'; avail = spaceAbove; }
  else if (spaceBelow >= spaceAbove)     { side = 'below'; avail = spaceBelow; }
  else                                   { side = 'above'; avail = spaceAbove; }

  // Final display height: the capped height, but never more than the side has.
  const effH = Math.max(0, Math.min(cappedH, avail));
  // Scroll whenever the full content can't show at that height.
  const scroll = size.height > effH + FUZZ;
  const maxHeight = scroll ? effH : null;

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

export interface PlaceOpts { margin?: number; gap?: number; preferX?: 'left' | 'right'; maxHeight?: number; }
export interface PlacementHandle { reposition(): void; destroy(): void; }

export function placeFloating(el: HTMLElement, anchor: HTMLElement, opts: PlaceOpts = {}): PlacementHandle {
  el.style.position = 'fixed';

  let ro: ResizeObserver | null = null;
  let lastNaturalH = -1;

  // Natural (uncapped) border-box height WITHOUT removing the cap: scrollHeight
  // is the full content height even while max-height + overflow are applied, so
  // this value is INVARIANT to our own .is-scroll cap — it only moves when the
  // real content changes. That lets the observer below tell our own resizes
  // (ignore) apart from genuine content changes like late-appended rows or a
  // drill-down swap (reposition). It also means we never strip .is-scroll to
  // remeasure, which used to flash the native (dark) scrollbar every call.
  function naturalHeight(): number {
    return el.scrollHeight + (el.offsetHeight - el.clientHeight);
  }

  function reposition(): void {
    // Anchor detached from the DOM (e.g. its host re-rendered while this
    // floating element is open): its rect collapses to {0,0,0,0}, which would
    // fling the element to the top-left corner. Keep the current position.
    if (!anchor.isConnected) return;
    const a = anchor.getBoundingClientRect();
    const natH = naturalHeight();
    lastNaturalH = natH;
    const p = computePlacement({
      anchor: { top: a.top, left: a.left, width: a.width, height: a.height },
      size: { width: el.offsetWidth, height: natH },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      margin: opts.margin, gap: opts.gap, preferX: opts.preferX, maxHeight: opts.maxHeight,
    });
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
    if (p.scroll) { el.classList.add('is-scroll'); el.style.maxHeight = `${p.maxHeight ?? 0}px`; }
    else { el.classList.remove('is-scroll'); el.style.maxHeight = ''; }
  }

  // Place synchronously so the menu never paints at the wrong spot. Callers
  // reveal the element before calling placeFloating, so reading offset/scroll
  // sizes here forces a valid synchronous layout.
  reposition();

  // Observe AFTER the first placement so the initial observation (which reports
  // the size we just settled) is a no-op. Menus that append their rows AFTER
  // calling placeFloating grow the content → naturalHeight jumps → reposition,
  // so they still cap/flip at the screen edge.
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (Math.abs(naturalHeight() - lastNaturalH) > FUZZ) reposition();
    });
    ro.observe(el);
  }

  const onWinResize = () => reposition();
  window.addEventListener('resize', onWinResize);

  function destroy(): void {
    if (ro) ro.disconnect();
    window.removeEventListener('resize', onWinResize);
  }

  return { reposition, destroy };
}

/**
 * One-shot placement of `el` against an arbitrary screen-space rect (e.g. a text
 * selection's getBoundingClientRect()), rather than a DOM anchor element. Used by
 * selection-anchored floaters like the board format toolbar, which have no anchor
 * node to observe. Coordinate writes stay here (c34 guardrail home), so callers
 * never hand-roll `.style.left/.top`. No live reposition — callers re-call (or
 * hide) on scroll / selection change.
 */
export function placeFloatingAtRect(el: HTMLElement, rect: Rect, opts: PlaceOpts = {}): void {
  el.style.position = 'fixed';
  const natH = el.scrollHeight + (el.offsetHeight - el.clientHeight);
  const p = computePlacement({
    anchor: rect,
    size: { width: el.offsetWidth, height: natH },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    margin: opts.margin, gap: opts.gap, preferX: opts.preferX, maxHeight: opts.maxHeight,
  });
  el.style.left = `${p.left}px`;
  el.style.top = `${p.top}px`;
  if (p.scroll) { el.classList.add('is-scroll'); el.style.maxHeight = `${p.maxHeight ?? 0}px`; }
  else { el.classList.remove('is-scroll'); el.style.maxHeight = ''; }
}

export interface FlyoutInput {
  panel: Rect;                                  // the action panel's bounding rect
  row: Rect;                                    // the Turn-into row's rect (vertical anchor)
  size: { width: number; height: number };      // the flyout's natural size
  viewport: { width: number; height: number };
  gap?: number;       // gap between panel and flyout (default 8)
  margin?: number;    // viewport margin (default 8)
  maxHeight?: number; // absolute height ceiling (default: none)
}

export function computeFlyoutPlacement(input: FlyoutInput): { left: number; top: number; side: 'right' | 'left'; maxHeight: number | null; scroll: boolean } {
  const gap = input.gap ?? 8;
  const margin = input.margin ?? 8;
  const { panel, row, size, viewport: vp } = input;

  const spaceRight = vp.width - (panel.left + panel.width) - gap - margin;
  const spaceLeft = panel.left - gap - margin;
  let side: 'right' | 'left';
  if (size.width <= spaceRight + FUZZ)      side = 'right';
  else if (size.width <= spaceLeft + FUZZ)  side = 'left';
  else if (spaceRight >= spaceLeft)         side = 'right';
  else                                      side = 'left';

  let left = side === 'right' ? panel.left + panel.width + gap : panel.left - gap - size.width;
  left = clamp(left, margin, vp.width - size.width - margin);

  const cappedH = Math.min(size.height, input.maxHeight ?? Infinity);
  const avail = vp.height - 2 * margin;
  const effH = Math.max(0, Math.min(cappedH, avail));
  const scroll = size.height > effH + FUZZ;
  const maxHeight = scroll ? effH : null;

  let top = clamp(row.top, margin, vp.height - effH - margin);
  return { left, top, side, maxHeight, scroll };
}

/**
 * Measure `flyoutEl`, call `computeFlyoutPlacement`, and apply the result
 * directly to `flyoutEl.style`.  All coordinate writes stay in menuPosition.ts
 * (excluded from the c34 hand-roll guardrail) so blockPicker.ts never touches
 * `.style.left / .style.top` directly.
 *
 * Call this after `flyoutEl` is visible (display != 'none') so that
 * offsetWidth / scrollHeight return real values.
 */
export function placeFlyout(
  flyoutEl: HTMLElement,
  panelEl: HTMLElement,
  anchorRowEl: HTMLElement,
  opts: { maxHeight?: number } = {},
): void {
  const panel = panelEl.getBoundingClientRect();
  const row = anchorRowEl.getBoundingClientRect();
  const natH = flyoutEl.scrollHeight + (flyoutEl.offsetHeight - flyoutEl.clientHeight);
  const p = computeFlyoutPlacement({
    panel: { top: panel.top, left: panel.left, width: panel.width, height: panel.height },
    row:   { top: row.top,   left: row.left,   width: row.width,   height: row.height   },
    size:  { width: flyoutEl.offsetWidth, height: natH },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    maxHeight: opts.maxHeight,
  });
  flyoutEl.style.left = `${p.left}px`;
  flyoutEl.style.top  = `${p.top}px`;
  if (p.scroll) {
    flyoutEl.classList.add('is-scroll');
    flyoutEl.style.maxHeight = `${p.maxHeight ?? 0}px`;
  } else {
    flyoutEl.classList.remove('is-scroll');
    flyoutEl.style.maxHeight = '';
  }
}
