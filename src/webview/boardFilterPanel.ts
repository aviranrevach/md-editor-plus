// The board "Filter" pill + popover. Edits the session-only FilterState that
// boardBlock owns via ctx.getFilter()/ctx.setFilter(). Visibility only; the
// renderers do the actual hiding. Hidden entirely when the board has no
// status/tag fields to filter on.

import type { BoardRendererCtx } from './boardBlock';
import type { Board, ColumnDef } from './boardModel';
import { getStatusOptions } from './boardModel';
import { applyFilter, EMPTY_VALUE, onValues, toggleFilterValue, clearFilterField } from './boardFilter';
import { createPopover, type Popover } from './popover';

export interface FilterableField { name: string; values: ColumnDef[]; }

export function filterableFields(board: Board): FilterableField[] {
  const out: FilterableField[] = [];
  for (const f of board.fields) {
    if (f.type === 'status') out.push({ name: f.name, values: getStatusOptions(board, f.name) });
    else if (f.type === 'tags') out.push({ name: f.name, values: f.options ?? [] });
  }
  return out;
}

export interface FilterPill { el: HTMLElement; refresh: () => void; open: () => void; }

// One field's filter row (label + value chips). Shared by the global funnel
// panel and the per-column mini-filter. `onChange` fires after a toggle so the
// caller can rebuild its own container to reflect the new selection.
export function buildFieldFilterRow(
  ctx: BoardRendererCtx, f: FilterableField, onChange: () => void,
): HTMLElement {
  const optionNames = f.values.map((v) => v.name);
  const on = onValues(ctx.getFilter(), f.name, optionNames);

  const row = document.createElement('div');
  row.className = 'bd-filter-field';

  const label = document.createElement('div');
  label.className = 'bd-filter-field-label';
  label.textContent = f.name;
  row.appendChild(label);

  const chips = document.createElement('div');
  chips.className = 'bd-filter-chips';

  const mkChip = (value: string, display: string, token: string, isEmpty: boolean): void => {
    const isOn = on.has(value);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `board-column-chip color-${token} bd-filter-chip`
      + (isOn ? ' is-selected' : ' bd-filter-hollow')
      + (isEmpty ? ' bd-filter-empty' : '');
    const dot = document.createElement('span');
    dot.className = 'board-column-chip-dot';
    chip.appendChild(dot);
    const name = document.createElement('span');
    name.textContent = display;
    chip.appendChild(name);
    chip.addEventListener('click', () => {
      ctx.setFilter(toggleFilterValue(ctx.getFilter(), f.name, optionNames, value));
      onChange();
    });
    chips.appendChild(chip);
  };

  for (const opt of f.values) mkChip(opt.name, opt.name, opt.color, false);
  mkChip(EMPTY_VALUE, '(Empty)', 'gray', true);

  row.appendChild(chips);
  return row;
}

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

  let popover: Popover | null = null;

  function closePanel(): void {
    popover?.close();
    popover = null;
    pill.classList.remove('is-open');
  }

  function openPanel(): void {
    popover = createPopover({
      className: 'bd-filter-panel',
      preferX: 'right',
      onClose: () => { popover = null; pill.classList.remove('is-open'); },
    });
    popover.el.setAttribute('role', 'dialog');
    buildPanel();
    popover.open(pill);
    pill.classList.add('is-open');
  }

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popover?.isOpen()) closePanel();
    else openPanel();
  });

  function buildPanel(): void {
    if (!popover) return;
    const panel = popover.el;
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
      panel.appendChild(buildFieldFilterRow(ctx, f, buildPanel));
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
  return {
    el: wrap,
    refresh,
    open: () => { if (!popover?.isOpen()) openPanel(); },
  };
}
