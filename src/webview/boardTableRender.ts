// src/webview/boardTableRender.ts
// Table renderer: builds an empty-state OR a <table> with one header per
// visible field and one row per card.  Real cell editors arrive in Tasks 10-12.

import type { Board, Card, ViewDef, FieldDef } from './boardModel';
import type { BoardRendererCtx, BoardRendererOps } from './boardBlock';

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
    default:
      td.textContent = value;
  }
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
