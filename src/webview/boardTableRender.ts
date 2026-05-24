// src/webview/boardTableRender.ts
// Table renderer: builds an empty-state OR a <table> with one header per
// visible field and one row per card.  Real cell editors arrive in Tasks 10-12.

import type { Board, Card, ViewDef, FieldDef } from './boardModel';
import type { BoardRendererCtx, BoardRendererOps } from './boardBlock';
import { buildChip } from './boardSidePanel';
import { setViewSort, setViewGroup, setViewWidth, hideFieldInView, addCard } from './boardOps';

interface Group { key: string; cards: Card[]; }

export function mountTable(ctx: BoardRendererCtx): BoardRendererOps {
  const root = ctx.root;
  root.classList.add('bd-table-host');
  let detached = false;
  const collapsedGroups = new Set<string>();
  const pendingFocus: { id: string | null; field: string | null } = { id: null, field: null };

  function render(): void {
    if (detached) return;
    const b = ctx.getBoard();
    const v = b.views.find(x => x.name === 'table') ?? { name: 'table' };
    root.innerHTML = '';

    const visibleFields = computeVisibleFields(b, v);
    const widths = v.widths ?? {};

    if (b.cards.length === 0 && ctx.readonly) {
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
      if (!ctx.readonly) {
        th.style.cursor = 'pointer';
      }
      if (v.sort?.field === f.name) {
        const caret = document.createElement('span');
        caret.className = 'bd-sort-caret';
        caret.textContent = v.sort.dir === 'asc' ? ' ▲' : ' ▼';
        th.appendChild(caret);
      }
      if (!ctx.readonly) {
        th.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).classList.contains('bd-col-resizer')) return;
          if ((e.target as HTMLElement).closest('.bd-col-menu-btn')) return;
          const cur = ctx.getBoard();
          const curView = cur.views.find(x => x.name === 'table');
          const curSort = curView?.sort;
          const nextDir: 'asc' | 'desc' | null =
            !curSort || curSort.field !== f.name ? 'asc' :
            curSort.dir === 'asc'               ? 'desc' :
                                                  null;
          const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
          setViewSort(b2, 'table', nextDir ? { field: f.name, dir: nextDir } : null);
          ctx.mutate(b2);
        });
        const headerMenuBtn = document.createElement('button');
        headerMenuBtn.type = 'button';
        headerMenuBtn.className = 'bd-col-menu-btn';
        headerMenuBtn.textContent = '⋯';
        headerMenuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openColumnMenu(headerMenuBtn, f, ctx, collapsedGroups);
        });
        th.appendChild(headerMenuBtn);
      }
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    // tbody — grouped rendering
    const tbody = document.createElement('tbody');
    const sortedCards = applySort(b.cards, v, b);
    const groups = applyGroup(sortedCards, v, b);
    for (const g of groups) {
      if (v.groupBy) {
        const head = document.createElement('tr');
        head.className = 'bd-table-group';
        const td = document.createElement('td');
        td.colSpan = visibleFields.length + 1;
        const row = document.createElement('div');
        row.className = 'bd-group-row';
        const left = document.createElement('span');
        left.className = 'bd-group-left';
        const caret = document.createElement('span');
        caret.className = 'bd-group-caret';
        caret.textContent = collapsedGroups.has(g.key) ? '▸' : '▾';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'bd-group-name';
        nameSpan.textContent = g.key;
        const countSpan = document.createElement('span');
        countSpan.className = 'bd-group-count';
        countSpan.textContent = String(g.cards.length);
        left.append(caret, nameSpan, countSpan);
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'bd-group-add';
        addBtn.textContent = '+ Add card';
        if (!ctx.readonly) {
          addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cur = ctx.getBoard();
            const b2: Board = { ...cur, cards: [...cur.cards] };
            const presets: Partial<Record<string, string>> = {};
            if (v.groupBy) {
              presets[v.groupBy] = (g.key === 'Uncategorized' || g.key === '—') ? '' : g.key;
            }
            const newId = addCard(b2, presets);
            pendingFocus.id = newId;
            pendingFocus.field = 'Title';
            ctx.mutate(b2);
          });
        }
        row.append(left, addBtn);
        td.appendChild(row);
        head.appendChild(td);
        head.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.bd-group-add')) return;
          if (collapsedGroups.has(g.key)) collapsedGroups.delete(g.key);
          else                            collapsedGroups.add(g.key);
          render();
        });
        tbody.appendChild(head);
      }
      if (collapsedGroups.has(g.key)) continue;
      for (const card of g.cards) {
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
    }

    if (!v.groupBy && !ctx.readonly) {
      const addRow = document.createElement('tr');
      addRow.className = 'bd-table-addrow';
      const td = document.createElement('td');
      td.colSpan = visibleFields.length + 1;
      td.textContent = '+ Add card';
      td.addEventListener('click', () => {
        const cur = ctx.getBoard();
        const b2: Board = { ...cur, cards: [...cur.cards] };
        const newId = addCard(b2);
        pendingFocus.id = newId;
        pendingFocus.field = 'Title';
        ctx.mutate(b2);
      });
      addRow.appendChild(td);
      tbody.appendChild(addRow);
    }

    table.appendChild(tbody);

    root.appendChild(table);

    if (pendingFocus.id) {
      const tr = root.querySelector<HTMLElement>(`tr.bd-table-row[data-card-id="${pendingFocus.id}"]`);
      const td = tr?.querySelector<HTMLElement>(`.bd-table-cell[data-field="${pendingFocus.field}"]`);
      pendingFocus.id = null;
      pendingFocus.field = null;
      if (td) td.click();
    }
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

function applyGroup(cards: Card[], v: ViewDef, b: Board): Group[] {
  if (!v.groupBy) return [{ key: '', cards }];
  const field = v.groupBy;
  const fdef = b.fields.find(x => x.name === field);
  if (!fdef) return [{ key: '', cards }];

  const bucket = new Map<string, Card[]>();
  for (const c of cards) {
    let key = c.values[field] ?? '';
    if (field === 'Status' && !b.columns.some(col => col.name === key)) key = 'Uncategorized';
    if (fdef.type === 'tags') key = (key.split(',')[0] ?? '').trim();
    key = key || '—';
    const arr = bucket.get(key) ?? [];
    arr.push(c);
    bucket.set(key, arr);
  }

  let keys: string[];
  if (field === 'Status') {
    // Build keys in board.columns order, including empty groups, then Uncategorized last.
    for (const col of b.columns) {
      if (!bucket.has(col.name)) bucket.set(col.name, []);
    }
    keys = b.columns.map(col => col.name);
    if (bucket.has('Uncategorized')) keys.push('Uncategorized');
  } else {
    keys = Array.from(bucket.keys());
    keys.sort((a, c) => {
      if (a === '—') return 1;
      if (c === '—') return -1;
      return a.localeCompare(c, undefined, { sensitivity: 'base' });
    });
  }

  return keys.map(k => ({ key: k, cards: bucket.get(k) ?? [] }));
}

function openColumnMenu(anchor: HTMLElement, f: FieldDef, ctx: BoardRendererCtx, collapsedGroups: Set<string>): void {
  const existing = document.querySelector('.bd-col-menu');
  existing?.remove();
  const menu = document.createElement('div');
  menu.className = 'bd-col-menu';
  const mkItem = (label: string, fn: () => void) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bd-col-menu-item';
    btn.textContent = label;
    btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', (e) => { e.stopPropagation(); fn(); menu.remove(); document.removeEventListener('mousedown', close, true); });
    menu.appendChild(btn);
  };
  mkItem('Sort ascending', () => {
    const cur = ctx.getBoard();
    const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
    setViewSort(b2, 'table', { field: f.name, dir: 'asc' });
    ctx.mutate(b2);
  });
  mkItem('Sort descending', () => {
    const cur = ctx.getBoard();
    const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
    setViewSort(b2, 'table', { field: f.name, dir: 'desc' });
    ctx.mutate(b2);
  });
  mkItem('Clear sort', () => {
    const cur = ctx.getBoard();
    const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
    setViewSort(b2, 'table', null);
    ctx.mutate(b2);
  });
  mkItem('Group by this', () => {
    collapsedGroups.clear();
    const cur = ctx.getBoard();
    const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
    setViewGroup(b2, 'table', f.name);
    ctx.mutate(b2);
  });
  mkItem('Reset column width', () => {
    const cur = ctx.getBoard();
    const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
    setViewWidth(b2, 'table', f.name, null);
    ctx.mutate(b2);
  });
  mkItem('Hide column', () => {
    const cur = ctx.getBoard();
    const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
    hideFieldInView(b2, 'table', f.name);
    ctx.mutate(b2);
  });
  const r = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${r.left}px`;
  menu.style.top  = `${r.bottom + 4}px`;
  document.body.appendChild(menu);
  const close = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('mousedown', close, true); }
  };
  document.addEventListener('mousedown', close, true);
}

function applySort(cards: Card[], v: ViewDef, b: Board): Card[] {
  if (!v.sort) return cards;
  const { field, dir } = v.sort;
  const f = b.fields.find(x => x.name === field);
  if (!f) return cards;
  const cmp = comparatorFor(f, b);
  const sorted = [...cards].sort((a, c) => cmp(a.values[field] ?? '', c.values[field] ?? ''));
  if (dir === 'desc') sorted.reverse();
  return sorted;
}

function comparatorFor(f: FieldDef, b: Board): (a: string, c: string) => number {
  if (f.type === 'date') {
    return (a, c) => {
      if (!a && !c) return 0;
      if (!a) return 1;        // empty last
      if (!c) return -1;
      return new Date(a).getTime() - new Date(c).getTime();
    };
  }
  if (f.type === 'status') {
    const order = new Map(b.columns.map((col, i) => [col.name, i]));
    return (a, c) => (order.get(a) ?? 1e9) - (order.get(c) ?? 1e9);
  }
  if (f.type === 'tags') {
    return (a, c) => {
      const aa = (a.split(',')[0] ?? '').trim().toLowerCase();
      const cc = (c.split(',')[0] ?? '').trim().toLowerCase();
      if (!aa && !cc) return 0;
      if (!aa) return 1;
      if (!cc) return -1;
      return aa.localeCompare(cc);
    };
  }
  // text, person
  return (a, c) => a.localeCompare(c, undefined, { sensitivity: 'base' });
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
