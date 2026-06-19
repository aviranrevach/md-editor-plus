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
