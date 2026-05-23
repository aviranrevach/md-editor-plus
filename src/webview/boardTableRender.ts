// src/webview/boardTableRender.ts
// Table renderer: builds an empty-state OR a <table> with one header per
// visible field and one row per card.  Real cell editors arrive in Tasks 10-12.

import type { Board, Card, ViewDef, FieldDef } from './boardModel';
import type { BoardRendererCtx, BoardRendererOps } from './boardBlock';
import { buildChip } from './boardSidePanel';

export function mountTable(ctx: BoardRendererCtx): BoardRendererOps {
  const root = ctx.root;
  root.classList.add('bd-table-host');
  let detached = false;

  function render(): void {
    if (detached) return;
    const b = ctx.getBoard();
    const v = b.views.find(x => x.name === 'table') ?? { name: 'table' };
    root.innerHTML = '';

    const visibleFields = computeVisibleFields(b, v);
    const widths = v.widths ?? {};

    if (b.cards.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bd-table-empty';
      empty.textContent = 'No cards. Click + Add card to get started.';
      root.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'bd-table';

    // colgroup with widths
    const colgroup = document.createElement('colgroup');
    const gutterCol = document.createElement('col');
    gutterCol.style.width = '36px';
    colgroup.appendChild(gutterCol);
    for (const f of visibleFields) {
      const col = document.createElement('col');
      col.style.width = `${widths[f.name] ?? 160}px`;
      colgroup.appendChild(col);
    }
    table.appendChild(colgroup);

    // thead
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th'));  // gutter
    for (const f of visibleFields) {
      const th = document.createElement('th');
      th.textContent = f.name;
      th.dataset.field = f.name;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    // tbody — empty rows in this task (real cells in Task 10/11)
    const tbody = document.createElement('tbody');
    for (const card of b.cards) {
      const tr = document.createElement('tr');
      tr.className = 'bd-table-row';
      tr.dataset.cardId = card.id;
      const gutter = document.createElement('td');
      gutter.className = 'bd-table-gutter';
      tr.appendChild(gutter);
      for (const f of visibleFields) {
        const td = document.createElement('td');
        renderCell(td, card, f, b, ctx);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    root.appendChild(table);
  }

  function computeVisibleFields(b: Board, v: ViewDef): FieldDef[] {
    const hidden = new Set(v.hidden ?? []);
    const order  = v.columns ?? b.fields.map(f => f.name);
    const out: FieldDef[] = [];
    for (const name of order) {
      const f = b.fields.find(x => x.name === name);
      if (f && !hidden.has(name)) out.push(f);
    }
    return out;
  }

  render();

  return {
    update: (_next: Board) => render(),
    destroy: () => {
      detached = true;
      root.innerHTML = '';
      root.classList.remove('bd-table-host');
    },
  };
}

function renderCell(td: HTMLTableCellElement, card: Card, field: FieldDef, b: Board, ctx: BoardRendererCtx): void {
  td.dataset.field = field.name;
  td.className = `bd-table-cell bd-cell-${field.type}`;
  const value = card.values[field.name] ?? '';
  switch (field.type) {
    case 'text':
    case 'person':
      td.textContent = value;
      if (!ctx.readonly) {
        td.addEventListener('click', () => beginInlineText(td, card, field, ctx));
      }
      return;
    case 'status': {
      const colDef = b.columns.find(c => c.name === value);
      if (value) {
        td.appendChild(buildChip(value, colDef?.color ?? 'gray'));
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'bd-cell-empty';
        placeholder.textContent = '—';
        td.appendChild(placeholder);
      }
      if (!ctx.readonly) {
        td.addEventListener('click', (e) => {
          e.stopPropagation();
          openStatusDropdown(td, card, ctx);
        });
      }
      return;
    }
    case 'date': {
      const dateStr = value;
      if (!dateStr) {
        const placeholder = document.createElement('span');
        placeholder.className = 'bd-cell-empty';
        placeholder.textContent = '—';
        td.appendChild(placeholder);
      } else {
        const pill = document.createElement('span');
        pill.className = 'bd-date';
        const d = new Date(dateStr + 'T00:00:00');
        pill.textContent = isNaN(d.getTime()) ? dateStr : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        if (!isNaN(d.getTime()) && d.getTime() < startOfToday()) {
          pill.classList.add('bd-date-overdue');
          pill.textContent += ' · overdue';
        }
        td.appendChild(pill);
      }
      if (!ctx.readonly) {
        td.addEventListener('click', (e) => { e.stopPropagation(); openDatePicker(td, card, field, ctx); });
      }
      return;
    }
    case 'tags': {
      const tags = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
      if (tags.length === 0) {
        const placeholder = document.createElement('span');
        placeholder.className = 'bd-cell-empty';
        placeholder.textContent = '—';
        td.appendChild(placeholder);
      } else {
        for (const t of tags) {
          const chip = document.createElement('span');
          chip.className = 'bd-tag';
          chip.textContent = t;
          td.appendChild(chip);
        }
      }
      if (!ctx.readonly) {
        td.addEventListener('click', (e) => { e.stopPropagation(); openTagsEditor(td, card, field, ctx); });
      }
      return;
    }
    default:
      td.textContent = value;
  }
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function openDatePicker(anchor: HTMLElement, card: Card, field: FieldDef, ctx: BoardRendererCtx): void {
  const input = document.createElement('input');
  input.type = 'date';
  input.value = card.values[field.name] ?? '';
  input.className = 'bd-date-input';
  const r = anchor.getBoundingClientRect();
  input.style.position = 'fixed';
  input.style.left = `${r.left}px`;
  input.style.top  = `${r.top}px`;
  document.body.appendChild(input);
  input.focus();
  const commit = () => {
    const v = input.value;
    input.remove();
    document.removeEventListener('mousedown', onOutside, true);
    if (v !== (card.values[field.name] ?? '')) {
      const cur = ctx.getBoard();
      ctx.mutate({
        ...cur,
        cards: cur.cards.map(c =>
          c.id === card.id
            ? { ...c, values: { ...c.values, [field.name]: v } }
            : c,
        ),
      });
    }
  };
  const onOutside = (e: MouseEvent) => { if (e.target !== input) commit(); };
  input.addEventListener('change', commit);
  document.addEventListener('mousedown', onOutside, true);
}

function openTagsEditor(anchor: HTMLElement, card: Card, field: FieldDef, ctx: BoardRendererCtx): void {
  const td = anchor;
  td.innerHTML = '';
  td.textContent = (card.values[field.name] ?? '');
  td.setAttribute('contenteditable', 'true');
  td.focus();
  const commit = () => {
    td.removeAttribute('contenteditable');
    const next = (td.textContent ?? '')
      .split(',').map(s => s.trim()).filter(Boolean).join(', ');
    if (next !== (card.values[field.name] ?? '')) {
      const cur = ctx.getBoard();
      ctx.mutate({
        ...cur,
        cards: cur.cards.map(c =>
          c.id === card.id
            ? { ...c, values: { ...c.values, [field.name]: next } }
            : c,
        ),
      });
    }
    cleanup();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); td.removeAttribute('contenteditable'); cleanup(); }
  };
  const onBlur = () => commit();
  function cleanup() {
    td.removeEventListener('keydown', onKey);
    td.removeEventListener('blur',    onBlur);
  }
  td.addEventListener('keydown', onKey);
  td.addEventListener('blur',    onBlur);
}

function openStatusDropdown(anchor: HTMLElement, card: Card, ctx: BoardRendererCtx): void {
  document.querySelectorAll('.board-status-dropdown').forEach((n) => n.remove());
  const pop = document.createElement('div');
  pop.className = 'board-status-dropdown';

  function closeOnOutside(e: MouseEvent): void {
    if (!pop.contains(e.target as Node)) {
      pop.remove();
      document.removeEventListener('mousedown', closeOnOutside, true);
    }
  }

  for (const col of ctx.getBoard().columns) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'board-status-option';
    item.appendChild(buildChip(col.name, col.color));
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = ctx.getBoard();
      ctx.mutate({
        ...cur,
        cards: cur.cards.map(c =>
          c.id === card.id
            ? { ...c, values: { ...c.values, Status: col.name } }
            : c,
        ),
      });
      pop.remove();
      document.removeEventListener('mousedown', closeOnOutside, true);
    });
    pop.appendChild(item);
  }
  const r = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = `${r.left}px`;
  pop.style.top = `${r.bottom + 4}px`;
  document.body.appendChild(pop);
  document.addEventListener('mousedown', closeOnOutside, true);
}

function beginInlineText(
  td: HTMLTableCellElement, card: Card, field: FieldDef, ctx: BoardRendererCtx,
): void {
  if (td.getAttribute('contenteditable') === 'true') return;
  td.setAttribute('contenteditable', 'true');
  td.classList.add('bd-cell-editing');
  td.focus();
  const range = document.createRange();
  range.selectNodeContents(td);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  const commit = () => {
    const next = (td.textContent ?? '').trim();
    td.removeAttribute('contenteditable');
    td.classList.remove('bd-cell-editing');
    cleanup();
    if (next !== (card.values[field.name] ?? '')) {
      const b = ctx.getBoard();
      ctx.mutate({
        ...b,
        cards: b.cards.map(c =>
          c.id === card.id
            ? { ...c, values: { ...c.values, [field.name]: next } }
            : c,
        ),
      });
    }
  };
  const cancel = () => {
    td.textContent = card.values[field.name] ?? '';
    td.removeAttribute('contenteditable');
    td.classList.remove('bd-cell-editing');
    cleanup();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Tab') { e.preventDefault(); commit(); }
  };
  const onBlur = () => commit();
  function cleanup() {
    td.removeEventListener('keydown', onKey);
    td.removeEventListener('blur', onBlur);
  }
  td.addEventListener('keydown', onKey);
  td.addEventListener('blur', onBlur);
}
