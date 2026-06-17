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

export function createFilterPill(ctx: BoardRendererCtx): FilterPill {
  const wrap = document.createElement('div');
  wrap.className = 'bd-filter';

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'bd-filter-pill';
  pill.setAttribute('aria-haspopup', 'true');
  pill.title = 'Filter cards by status or tag';
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
    title.textContent = 'Filter';
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

      const mkChip = (value: string, display: string, token: string): void => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `bd-opt-pchip color-${token}` + (sel.has(value) ? ' is-selected' : '');
        chip.textContent = display;
        chip.addEventListener('click', () => setFieldValue(f.name, value, !sel.has(value)));
        chips.appendChild(chip);
      };

      for (const opt of f.values) mkChip(opt.name, opt.name, opt.color);
      mkChip(EMPTY_VALUE, '(Empty)', 'gray');

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
      pill.classList.remove('is-active');
      pill.textContent = 'Filter';
    } else {
      pill.classList.add('is-active');
      const hidden = board.cards.length - applyFilter(board.cards, filter, board).length;
      pill.textContent = hidden > 0 ? `Filter · ${activeN} · ${hidden} hidden` : `Filter · ${activeN}`;
    }
  }

  refresh();
  return { el: wrap, refresh };
}
