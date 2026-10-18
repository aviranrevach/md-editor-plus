// Selection formatting toolbar for board free-text surfaces.
//
// The document bubble menu (bubbleMenu.ts) is a ProseMirror feature — it only
// fires for selections inside the editor's own document model. Board cells are
// NOT part of that model: when edited they become plain `contenteditable` boxes
// holding RAW markdown text (`**bold**`), and the board node deliberately
// swallows their selection events so they never reach ProseMirror. So selecting
// a word in a board cell never shows the bubble menu.
//
// This is a small, board-specific toolbar that operates on that raw markdown
// text directly: each action wraps/unwraps the selection in the corresponding
// markdown markers (which then render styled via boardInlineRender.ts on commit).
// Every action runs on mousedown+preventDefault so focus never leaves the cell —
// nothing blurs, nothing commits, and the edit session stays alive.
//
// Scope (free-text content that round-trips to markdown):
//   .bd-cell-editing        — table text/person cells
//   .board-panel-prop-value — side-panel text/person property values
// Deliberately NOT covered: structural labels (column/board/field names) — they
// have their own classes and injecting `**` would corrupt the stored name (and a
// Status name desync would orphan cards) — and the input-based kanban card title,
// which is a plain <input> that cannot host markdown.

import { placeFloatingAtRect } from './menuPosition';

// ── Pure text transforms (exported for unit tests) ────────────────────────────

export interface WrapInput {
  text: string;   // full text of the edited text node
  start: number;  // selection start offset within that node
  end: number;    // selection end offset
}
export interface WrapResult {
  text: string;
  start: number;  // new selection start (inner content)
  end: number;
}

// Symmetric marker (bold **, italic *, strike ~~, code `, highlight ==). Toggles:
// if the chars immediately outside the selection already are the marker, strip
// them; otherwise wrap. In edit mode the cell shows raw markdown, so the markers
// sit just outside a re-selected word — making this a natural toggle.
export function toggleSymmetric(input: WrapInput, marker: string): WrapResult {
  const { text, start, end } = input;
  const before = text.slice(0, start);
  const mid = text.slice(start, end);
  const after = text.slice(end);
  const m = marker.length;
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return { text: before.slice(0, -m) + mid + after.slice(m), start: start - m, end: end - m };
  }
  return { text: before + marker + mid + marker + after, start: start + m, end: end + m };
}

export function isSymmetricActive(input: WrapInput, marker: string): boolean {
  const before = input.text.slice(0, input.start);
  const after = input.text.slice(input.end);
  return before.endsWith(marker) && after.startsWith(marker);
}

// Link → `[selected](url)` with the `url` placeholder selected so the user types
// the URL inline, in the cell — no popup, no focus steal.
export function wrapLink(input: WrapInput, placeholder = 'url'): WrapResult {
  const { text, start, end } = input;
  const before = text.slice(0, start);
  const mid = text.slice(start, end);
  const after = text.slice(end);
  const prefix = `[${mid}](`;
  const selStart = start + prefix.length;
  return { text: before + prefix + placeholder + ')' + after, start: selStart, end: selStart + placeholder.length };
}

const COLOR_OPEN_RE = /<span style="color:[^"]*">$/;
const COLOR_CLOSE = '</span>';

// Text color → `<span style="color:VALUE">selected</span>`, inner text reselected.
export function wrapColor(input: WrapInput, value: string): WrapResult {
  const { text, start, end } = input;
  const before = text.slice(0, start);
  const mid = text.slice(start, end);
  const after = text.slice(end);
  const open = `<span style="color:${value}">`;
  const selStart = start + open.length;
  return { text: before + open + mid + COLOR_CLOSE + after, start: selStart, end: selStart + mid.length };
}

// Remove a color span wrapping the selection, if present; otherwise unchanged.
export function clearColor(input: WrapInput): WrapResult {
  const { text, start, end } = input;
  const before = text.slice(0, start);
  const after = text.slice(end);
  const m = COLOR_OPEN_RE.exec(before);
  if (m && after.startsWith(COLOR_CLOSE)) {
    return {
      text: before.slice(0, -m[0].length) + text.slice(start, end) + after.slice(COLOR_CLOSE.length),
      start: start - m[0].length,
      end: end - m[0].length,
    };
  }
  return { text, start, end };
}

export function colorActive(input: WrapInput): boolean {
  const before = input.text.slice(0, input.start);
  const after = input.text.slice(input.end);
  return COLOR_OPEN_RE.test(before) && after.startsWith(COLOR_CLOSE);
}

// ── DOM / selection wiring ─────────────────────────────────────────────────────

// Surfaces the toolbar attaches to. The class is on the contenteditable element
// itself (the <td> / the value <span>), so `ce.matches(...)` is exact.
const BOARD_RICH_TEXT = '.bd-cell-editing, .board-panel-prop-value';

const ICON = {
  bold:      'M185.08,114.46A48,48,0,0,0,148,36H80A12,12,0,0,0,68,48V200a12,12,0,0,0,12,12h80a52,52,0,0,0,25.08-97.54ZM92,60h56a24,24,0,0,1,0,48H92Zm68,128H92V132h68a28,28,0,0,1,0,56Z',
  italic:    'M204,56a12,12,0,0,1-12,12H160.65l-40,120H144a12,12,0,0,1,0,24H64a12,12,0,0,1,0-24H95.35l40-120H112a12,12,0,0,1,0-24h80A12,12,0,0,1,204,56Z',
  strike:    'M228,128a12,12,0,0,1-12,12H185.86A41.48,41.48,0,0,1,196,168c0,14.45-7.81,28.32-21.43,38.05C162,215.05,145.44,220,128,220s-34-4.95-46.57-13.95C67.81,196.32,60,182.45,60,168a12,12,0,0,1,24,0c0,15.18,20.15,28,44,28s44-12.82,44-28c0-12.76-9.3-20.18-35.35-28H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128ZM75.11,100a12,12,0,0,0,12-12c0-16,17.58-28,40.89-28,17.36,0,31.37,6.65,37.48,17.78a12,12,0,0,0,21-11.56C176.13,47.3,154.25,36,128,36,91,36,63.11,58.35,63.11,88A12,12,0,0,0,75.11,100Z',
  code:      'M71.68,97.22,34.74,128l36.94,30.78a12,12,0,1,1-15.36,18.44l-48-40a12,12,0,0,1,0-18.44l48-40A12,12,0,0,1,71.68,97.22Zm176,21.56-48-40a12,12,0,1,0-15.36,18.44L221.26,128l-36.94,30.78a12,12,0,1,0,15.36,18.44l48-40a12,12,0,0,0,0-18.44ZM164.1,28.72a12,12,0,0,0-15.38,7.18l-64,176a12,12,0,0,0,7.18,15.37A11.79,11.79,0,0,0,96,228a12,12,0,0,0,11.28-7.9l64-176A12,12,0,0,0,164.1,28.72Z',
  highlight: 'M252.49,107.51a12,12,0,0,0-17,0L192,151,113,72l43.52-43.51a12,12,0,0,0-17-17L93.17,57.86a20,20,0,0,0-4.72,20.72L69.17,97.86a20,20,0,0,0,0,28.28L71,128,15.51,183.51a12,12,0,0,0,4.7,19.87l72,24A11.8,11.8,0,0,0,96,228a12,12,0,0,0,8.49-3.52L136,193l1.86,1.86a20,20,0,0,0,28.28,0l19.27-19.27a20.27,20.27,0,0,0,6.59,1.13,19.86,19.86,0,0,0,14.14-5.86l46.35-46.34A12,12,0,0,0,252.49,107.51ZM92.76,202.27,46.21,186.76,88,145l31,31ZM152,175,96.49,119.52h0L89,112l15-15,63,63Z',
  link:      'M117.18,188.74a12,12,0,0,1,0,17l-5.12,5.12A58.26,58.26,0,0,1,70.6,228h0A58.62,58.62,0,0,1,29.14,127.92L63.89,93.17a58.64,58.64,0,0,1,98.56,28.11,12,12,0,1,1-23.37,5.44,34.65,34.65,0,0,0-58.22-16.58L46.11,144.89A34.62,34.62,0,0,0,70.57,204h0a34.41,34.41,0,0,0,24.49-10.14l5.11-5.12A12,12,0,0,1,117.18,188.74ZM226.83,45.17a58.65,58.65,0,0,0-82.93,0l-5.11,5.11a12,12,0,0,0,17,17l5.12-5.12a34.63,34.63,0,1,1,49,49L175.1,145.86A34.39,34.39,0,0,1,150.61,156h0a34.63,34.63,0,0,1-33.69-26.72,12,12,0,0,0-23.38,5.44A58.64,58.64,0,0,0,150.56,180h.05a58.28,58.28,0,0,0,41.47-17.17l34.75-34.75a58.62,58.62,0,0,0,0-82.91Z',
} as const;

// Matches the document bubble menu's text-color palette.
const COLORS: Array<{ value: string | null; label: string }> = [
  { value: null,      label: 'Default' },
  { value: '#e55757', label: 'Red' },
  { value: '#e8954a', label: 'Orange' },
  { value: '#e8c94a', label: 'Yellow' },
  { value: '#57b35b', label: 'Green' },
  { value: '#4a9ee8', label: 'Blue' },
  { value: '#9b5de5', label: 'Purple' },
  { value: '#e85a9b', label: 'Pink' },
];

function svg(path: string): string {
  return `<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="${path}"/></svg>`;
}

interface ActiveSelection { ce: HTMLElement; node: Text; start: number; end: number; }

// Resolve the current selection IF it is a non-collapsed range inside a single
// text node of an allowed board rich-text surface; otherwise null.
function resolveActive(): ActiveSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (range.startContainer !== range.endContainer) return null;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const ce = (node.parentElement)?.closest<HTMLElement>('[contenteditable="true"]') ?? null;
  if (!ce || ce.classList.contains('ProseMirror') || !ce.matches(BOARD_RICH_TEXT)) return null;
  return { ce, node: node as Text, start: range.startOffset, end: range.endOffset };
}

let initialized = false;

export function initBoardFormatToolbar(): void {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;

  const el = document.createElement('div');
  el.className = 'board-format-toolbar';
  el.style.display = 'none';
  el.innerHTML = `
    <div class="bft-row">
      <button class="bm-btn" data-mark="**" data-tip="Bold">${svg(ICON.bold)}</button>
      <button class="bm-btn" data-mark="*" data-tip="Italic">${svg(ICON.italic)}</button>
      <button class="bm-btn" data-mark="~~" data-tip="Strikethrough">${svg(ICON.strike)}</button>
      <button class="bm-btn" data-mark="\`" data-tip="Inline code">${svg(ICON.code)}</button>
      <button class="bm-btn" data-mark="==" data-tip="Highlight">${svg(ICON.highlight)}</button>
      <span class="bm-div"></span>
      <button class="bm-btn" data-action="link" data-tip="Add link">${svg(ICON.link)}</button>
      <button class="bm-btn" data-action="color" data-tip="Text color">
        <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor">
          <path d="M216,208a12,12,0,0,1-11.41-7.97L180.09,148H75.91L51.41,200.03A12,12,0,0,1,40,208a12,12,0,0,1-11.41-15.97L113.09,12.97a12,12,0,0,1,21.82,0l84.5,179.06A12,12,0,0,1,216,208ZM87.09,124h81.82L128,42.84Z"/>
          <rect class="bft-color-bar" x="32" y="224" width="192" height="20" rx="6" fill="#e55757"/>
        </svg>
      </button>
    </div>
    <div class="bm-swatch-panel" data-swatch>
      ${COLORS.map(c => c.value
        ? `<button class="bm-swatch-item" data-color="${c.value}" style="background:${c.value}" data-tip="${c.label}"></button>`
        : `<button class="bm-swatch-item bm-swatch-clear" data-color="" data-tip="${c.label}">⊘</button>`).join('')}
    </div>
  `;
  document.body.appendChild(el);

  const swatch = el.querySelector<HTMLElement>('[data-swatch]')!;
  const colorBar = el.querySelector<SVGRectElement>('.bft-color-bar');

  function hide(): void {
    el.style.display = 'none';
    swatch.classList.remove('open');
  }

  function refreshActiveStates(a: ActiveSelection): void {
    const input: WrapInput = { text: a.node.data, start: a.start, end: a.end };
    el.querySelectorAll<HTMLElement>('[data-mark]').forEach((btn) => {
      btn.classList.toggle('active', isSymmetricActive(input, btn.dataset.mark!));
    });
    el.querySelector<HTMLElement>('[data-action="color"]')?.classList.toggle('active', colorActive(input));
  }

  function show(a: ActiveSelection): void {
    el.style.display = 'flex';
    refreshActiveStates(a);
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    placeFloatingAtRect(el, { top: rect.top, left: rect.left, width: rect.width, height: rect.height });
  }

  // Apply a pure transform to the active text node, then restore the resulting
  // selection so the toolbar stays put and actions can be chained.
  function apply(transform: (input: WrapInput) => WrapResult): void {
    const a = resolveActive();
    if (!a) return;
    const r = transform({ text: a.node.data, start: a.start, end: a.end });
    a.node.data = r.text;
    const range = document.createRange();
    range.setStart(a.node, Math.max(0, Math.min(r.start, r.text.length)));
    range.setEnd(a.node, Math.max(0, Math.min(r.end, r.text.length)));
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const next = resolveActive();
    if (next) show(next);
  }

  // All clicks run on mousedown+preventDefault so the cell never blurs/commits.
  el.addEventListener('mousedown', (e) => {
    const target = e.target as HTMLElement;
    const colorItem = target.closest<HTMLElement>('[data-color]');
    if (colorItem) {
      e.preventDefault();
      const value = colorItem.dataset.color!;
      apply((input) => (value ? wrapColor(input, value) : clearColor(input)));
      if (colorBar && value) colorBar.setAttribute('fill', value);
      swatch.classList.remove('open');
      return;
    }
    const btn = target.closest<HTMLElement>('[data-mark], [data-action]');
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.mark) {
      apply((input) => toggleSymmetric(input, btn.dataset.mark!));
      return;
    }
    switch (btn.dataset.action) {
      case 'link':
        apply((input) => wrapLink(input));
        swatch.classList.remove('open');
        break;
      case 'color':
        swatch.classList.toggle('open');
        if (swatch.classList.contains('open')) { const a = resolveActive(); if (a) show(a); }
        break;
    }
  });

  // Selection drives visibility. selectionchange fires often; coalesce per frame.
  let raf = 0;
  const onSelectionChange = (): void => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const a = resolveActive();
      if (a) show(a); else hide();
    });
  };
  document.addEventListener('selectionchange', onSelectionChange);

  // Keep the toolbar pinned to the selection while scrolling; hide if it's gone.
  const onScrollOrResize = (): void => {
    if (el.style.display === 'none') return;
    const a = resolveActive();
    if (a) show(a); else hide();
  };
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);
}
