// The board "Filter" pill + popover. Edits the session-only FilterState that
// boardBlock owns via ctx.getFilter()/ctx.setFilter(). Visibility only; the
// renderers do the actual hiding. Hidden entirely when the board has no
// status/tag fields to filter on.

import type { BoardRendererCtx } from './boardBlock';
import type { Board, ColumnDef } from './boardModel';
import { getStatusOptions } from './boardModel';
import { applyFilter, EMPTY_VALUE } from './boardFilter';

interface FilterableField { name: string; values: ColumnDef[]; }

function filterableFields(board: Board): FilterableField[] {
  const out: FilterableField[] = [];
  for (const f of board.fields) {
    if (f.type === 'status') out.push({ name: f.name, values: getStatusOptions(board, f.name) });
    else if (f.type === 'tags') out.push({ name: f.name, values: f.options ?? [] });
  }
  return out;
}

export interface FilterPill { el: HTMLElement; refresh: () => void; }

// Funnel icon — matches the stroke weight of the sibling "+" / "⋯" chrome buttons.
const FUNNEL_SVG =
  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5.5h17l-6.6 7.8v5.2l-3.8 2v-7.2z"/></svg>`;

export function createFilterPill(ctx: BoardRendererCtx): FilterPill {
  const wrap = document.createElement('div');
  wrap.className = 'bd-filter';

  // Icon button, styled like the sibling + / ⋯ buttons (.bd-more-btn).
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'bd-more-btn bd-filter-btn';
  pill.setAttribute('aria-haspopup', 'true');
  pill.setAttribute('aria-label', 'Filter');
  pill.title = 'Filter cards by status or tag';
  pill.innerHTML = FUNNEL_SVG;
  // Inline active count (shown only when a filter is active — no badge bubble).
  const countEl = document.createElement('span');
  countEl.className = 'bd-filter-count';
  pill.appendChild(countEl);
  wrap.appendChild(pill);

  const panel = document.createElement('div');
  panel.className = 'bd-filter-panel bd-hidden';
  panel.setAttribute('role', 'dialog');
  wrap.appendChild(panel);

  let outsideHandler: ((e: MouseEvent) => void) | null = null;

  function closePanel(): void {
    panel.classList.add('bd-hidden');
    pill.classList.remove('is-open');
    if (outsideHandler) {
      document.removeEventListener('mousedown', outsideHandler, true);
      outsideHandler = null;
    }
  }

  function openPanel(): void {
    buildPanel();
    panel.classList.remove('bd-hidden');
    pill.classList.add('is-open');
    outsideHandler = (e: MouseEvent) => {
      if (!wrap.contains(e.target as Node)) closePanel();
    };
    // Capture phase so opening this pill also closes any other open popover
    // (their own outside-mousedown listeners fire and dismiss them).
    document.addEventListener('mousedown', outsideHandler, true);
  }

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.classList.contains('bd-hidden')) openPanel();
    else closePanel();
  });

  function setFieldValue(field: string, value: string, on: boolean): void {
    const cur: Record<string, string[]> = { ...ctx.getFilter() };
    const set = new Set(cur[field] ?? []);
    if (on) set.add(value);
    else set.delete(value);
    if (set.size === 0) delete cur[field];
    else cur[field] = [...set];
    ctx.setFilter(cur); // re-renders body + calls refresh() (pill label)
    buildPanel();       // rebuild chips to reflect the new selection
  }

  function buildPanel(): void {
    panel.innerHTML = '';
    const board = ctx.getBoard();
    const filter = ctx.getFilter();

    const head = document.createElement('div');
    head.className = 'bd-filter-head';
    const title = document.createElement('span');
    title.className = 'bd-filter-title';
    const activeN = Object.values(filter).filter((v) => Array.isArray(v) && v.length > 0).length;
    if (activeN === 0) {
      title.textContent = 'Filter';
    } else {
      const hidden = board.cards.length - applyFilter(board.cards, filter, board).length;
      title.textContent = `Filter · ${activeN} active` + (hidden > 0 ? ` · ${hidden} hidden` : '');
    }
    head.appendChild(title);
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'bd-filter-clear';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      ctx.setFilter({});
      buildPanel();
    });
    head.appendChild(clear);
    panel.appendChild(head);

    for (const f of filterableFields(board)) {
      const sel = new Set(filter[f.name] ?? []);
      const row = document.createElement('div');
      row.className = 'bd-filter-field';

      const label = document.createElement('div');
      label.className = 'bd-filter-field-label';
      label.textContent = f.name;
      row.appendChild(label);

      const chips = document.createElement('div');
      chips.className = 'bd-filter-chips';

      // Reuse the real status pill (.board-column-chip): selected = solid,
      // unselected = hollow outline (no dimming). The `(Empty)` chip is neutral.
      const mkChip = (value: string, display: string, token: string, isEmpty: boolean): void => {
        const selected = sel.has(value);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `board-column-chip color-${token} bd-filter-chip`
          + (selected ? ' is-selected' : ' bd-filter-hollow')
          + (isEmpty ? ' bd-filter-empty' : '');
        const dot = document.createElement('span');
        dot.className = 'board-column-chip-dot';
        chip.appendChild(dot);
        const name = document.createElement('span');
        name.textContent = display;
        chip.appendChild(name);
        chip.addEventListener('click', () => setFieldValue(f.name, value, !selected));
        chips.appendChild(chip);
      };

      for (const opt of f.values) mkChip(opt.name, opt.name, opt.color, false);
      mkChip(EMPTY_VALUE, '(Empty)', 'gray', true);

      row.appendChild(chips);
      panel.appendChild(row);
    }
  }

  function refresh(): void {
    const board = ctx.getBoard();
    if (filterableFields(board).length === 0) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';

    const filter = ctx.getFilter();
    const activeN = Object.values(filter).filter((v) => Array.isArray(v) && v.length > 0).length;
    if (activeN === 0) {
      pill.classList.remove('is-active', 'has-count');
      countEl.textContent = '';
      pill.title = 'Filter cards by status or tag';
    } else {
      pill.classList.add('is-active', 'has-count');
      countEl.textContent = String(activeN);
      const hidden = board.cards.length - applyFilter(board.cards, filter, board).length;
      pill.title = `Filter · ${activeN} active` + (hidden > 0 ? ` · ${hidden} hidden` : '');
    }
  }

  refresh();
  return { el: wrap, refresh };
}
