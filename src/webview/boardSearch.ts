import { findMatches } from './search';

// Board-aware search. A board is an atom node whose card text lives in an
// opaque `source` attribute and is rendered into DOM by the board NodeView,
// which tells ProseMirror to ignore all mutations inside it. So the regular
// decoration-based search can't see or highlight board text.
//
// Instead we walk the board's RENDERED DOM and highlight matches with the CSS
// Custom Highlight API (CSS.highlights + ::highlight()) — which paints over
// existing text ranges WITHOUT mutating the DOM. That's essential here: wrapping
// matches in <span>s would be wiped by the board's own re-renders and could
// break its drag/click handlers. If the runtime lacks the API, board matches
// simply aren't highlighted and the rest of search still works.

// Containers that hold user-visible board text. Anything outside these (counts,
// the ⋯ menus, "+ New card" buttons, sort carets, drag handles) is chrome and
// stays out of search.
const SEARCHABLE_SELECTORS = [
  '.board-name',         // board title
  '.board-column-name',  // kanban column / table group names
  '.board-card-title',   // card titles
  '.board-card-preview', // card body previews
  '.board-card-chips',   // visible field chips / tags on a card
  '.bd-table-cell',       // table cell values
  '.bd-th-label',        // table column (field) headers
].join(',');

// Placeholder text ("—", "No cards…") inside a searchable container that should
// never match.
const SKIP_SELECTOR = '.bd-cell-empty, .bd-table-empty';

// Element a match should scroll to — the nearest card / row / header / name.
const SCROLL_TARGET_SELECTOR =
  '.board-card, .bd-table-row, .board-column-head, .bd-th-inner, .board-name';

const HL = 'md-board-search';
const HL_ACTIVE = 'md-board-search-active';

export interface BoardMatch {
  range: Range;
  /** Viewport rect at scan time — used to order against ProseMirror matches. */
  rect: DOMRect;
  /** Nearest scrollable element to bring into view when this match is active. */
  el: HTMLElement;
}

interface HighlightRegistry {
  set(name: string, hl: unknown): void;
  delete(name: string): void;
}

function registry(): HighlightRegistry | null {
  const c = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return c?.highlights ?? null;
}

function makeHighlight(ranges: Range[]): unknown {
  const Ctor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  return Ctor ? new Ctor(...ranges) : null;
}

export function boardSearchSupported(): boolean {
  return registry() !== null && typeof (globalThis as { Highlight?: unknown }).Highlight === 'function';
}

/** Find every match across all boards rendered under `root`, in DOM order. */
export function scanBoards(root: HTMLElement, query: string, caseSensitive = false): BoardMatch[] {
  const out: BoardMatch[] = [];
  if (!query) return out;

  root.querySelectorAll<HTMLElement>('.board-block').forEach((board) => {
    board.querySelectorAll<HTMLElement>(SEARCHABLE_SELECTORS).forEach((container) => {
      collectInContainer(container, query, caseSensitive, out);
    });
  });
  return out;
}

// Real browsers implement Range.getBoundingClientRect; jsdom (tests) doesn't.
function rectOf(range: Range): DOMRect {
  if (typeof range.getBoundingClientRect === 'function') return range.getBoundingClientRect();
  return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 } as DOMRect;
}

function collectInContainer(
  container: HTMLElement,
  query: string,
  caseSensitive: boolean,
  out: BoardMatch[],
): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent ?? '';
      if (!text.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (parent && parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? '';
    for (const { start, end } of findMatches(text, query, { caseSensitive })) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const parent = node.parentElement;
      const el = (parent?.closest(SCROLL_TARGET_SELECTOR) as HTMLElement | null) ?? parent ?? container;
      out.push({ range, rect: rectOf(range), el });
    }
  }
}

/**
 * Paint highlights for the given matches. `activeIndex` (or -1) gets the
 * stronger "active" style; the rest get the normal highlight. No-op when the
 * Highlight API is unavailable.
 */
export function applyBoardHighlights(matches: BoardMatch[], activeIndex: number): void {
  const reg = registry();
  if (!reg) return;

  const inactive: Range[] = [];
  let active: Range | null = null;
  matches.forEach((m, i) => {
    if (i === activeIndex) active = m.range;
    else inactive.push(m.range);
  });

  const hl = makeHighlight(inactive);
  if (hl) reg.set(HL, hl);
  else reg.delete(HL);

  if (active) {
    const activeHl = makeHighlight([active]);
    if (activeHl) reg.set(HL_ACTIVE, activeHl);
  } else {
    reg.delete(HL_ACTIVE);
  }
}

export function clearBoardHighlights(): void {
  const reg = registry();
  if (!reg) return;
  reg.delete(HL);
  reg.delete(HL_ACTIVE);
}

export function scrollBoardMatchIntoView(match: BoardMatch): void {
  match.el.scrollIntoView({ block: 'center', inline: 'center' });
}
