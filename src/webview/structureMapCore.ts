// Pure math for the structure-map rail (c54). No DOM / no editor — the shell in
// structureMap.ts supplies docY (from coordsAtPos) and the window metrics.

export interface MapHeading { pos: number; level: 1 | 2 | 3; docY: number; }
export interface MapInput {
  headings: MapHeading[];
  docHeight: number;
  scrollY: number;
  viewportHeight: number;
}
export interface MapTick { pos: number; level: 1 | 2 | 3; topFrac: number; }
export interface MapResult {
  ticks: MapTick[];
  viewport: { topFrac: number; heightFrac: number };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function computeMap(input: MapInput): MapResult {
  const { headings, docHeight, scrollY, viewportHeight } = input;
  const safeHeight = docHeight > 0 ? docHeight : 1;

  const ticks: MapTick[] = headings.map((h) => ({
    pos: h.pos,
    level: h.level,
    topFrac: clamp01(h.docY / safeHeight),
  }));

  // Whole document visible → the viewport box fills the rail.
  const heightFrac = clamp01(viewportHeight / safeHeight);
  let topFrac = clamp01(scrollY / safeHeight);
  if (topFrac + heightFrac > 1) topFrac = clamp01(1 - heightFrac);

  return { ticks, viewport: { topFrac, heightFrac } };
}
