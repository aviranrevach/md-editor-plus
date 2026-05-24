// src/webview/boardTableRender.ts
// Table renderer: builds an empty-state OR a <table> with one header per
// visible field and one row per card.  Real cell editors arrive in Tasks 10-12.

// ── TEMPORARY DIAGNOSTIC: visible flash on drag-related events ─────────────
// Remove once the user confirms drag interactions work.
const BUILD_MARKER = 'BOARD-BUILD-2026-05-24-r5';
function dbgFlash(label: string, color: string): void {
  let el = document.getElementById('bd-dbg-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bd-dbg-toast';
    el.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;background:#000;color:#fff;font:600 11px monospace;padding:6px 10px;border-radius:6px;pointer-events:none;opacity:0;transition:opacity 0.1s;';
    document.body.appendChild(el);
  }
  el.style.background = color;
  el.textContent = `${label} (${BUILD_MARKER})`;
  el.style.opacity = '1';
  clearTimeout((el as unknown as { _t?: number })._t);
  (el as unknown as { _t?: number })._t = window.setTimeout(() => { el!.style.opacity = '0'; }, 1200);
}
// ──────────────────────────────────────────────────────────────────────────

import type { Board, Card, ViewDef, FieldDef } from './boardModel';
import type { BoardRendererCtx, BoardRendererOps } from './boardBlock';
import { buildChip } from './boardSidePanel';
import { setViewSort, setViewGroup, setViewWidth, setViewColumns, hideFieldInView, addCard, moveCard } from './boardOps';
import { startDrag, dropIndicator } from './boardDragShared';

interface Group { key: string; cards: Card[]; }

/** After a successful drag (onDrop), suppress the next click event so the
 *  sort click handler that fires on the same mouseup does not also run. */
function suppressNextClick(): void {
  const suppress = (e: MouseEvent) => {
    e.stopImmediatePropagation();
    e.preventDefault();
    window.removeEventListener('click', suppress, true);
  };
  window.addEventListener('click', suppress, true);
}

function startRowDrag(
  e: MouseEvent,
  card: Card,
  group: Group,
  ctx: BoardRendererCtx,
): () => void {
  const ind = dropIndicator();
  ind.style.position = 'fixed';
  document.body.appendChild(ind);
  let dropBeforeId: string | null = null;
  let isReject = false;
  let hasValidDrop = false;
  return startDrag(e, {
    onMove: (ev) => {
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('tr.bd-table-row') as HTMLElement | null;
      if (!target) { ind.hide(); return; }
      const targetCardId = target.dataset.cardId!;
      const targetCard = group.cards.find(c => c.id === targetCardId);
      if (!targetCard) {
        isReject = true;
        hasValidDrop = false;
        ind.classList.add('bd-drop-line-reject');
        const r = target.getBoundingClientRect();
        ind.show(r.left, r.top, r.width, 2);
        return;
      }
      isReject = false;
      hasValidDrop = true;
      ind.classList.remove('bd-drop-line-reject');
      const r = target.getBoundingClientRect();
      const above = ev.clientY < r.top + r.height / 2;
      const y = above ? r.top : r.bottom;
      ind.show(r.left, y - 1, r.width, 2);
      dropBeforeId = above ? targetCardId : (group.cards[group.cards.indexOf(targetCard) + 1]?.id ?? null);
    },
    onDrop: () => {
      ind.remove();
      suppressNextClick();
      if (hasValidDrop && !isReject) {
        const cur = ctx.getBoard();
        const b2: Board = { ...cur, cards: [...cur.cards] };
        moveCard(b2, card.id, dropBeforeId);
        ctx.mutate(b2);
      }
    },
    onCancel: () => ind.remove(),
  });
}

function startColumnDrag(
  e: MouseEvent,
  f: FieldDef,
  visibleFields: FieldDef[],
  ctx: BoardRendererCtx,
): void {
  const table = ctx.root.querySelector('table');
  if (!table) return;
  const headRow = table.querySelector('thead tr')!;
  const ths = Array.from(headRow.querySelectorAll('th'));
  const ind = dropIndicator();
  ind.style.position = 'fixed';
  document.body.appendChild(ind);
  // -1 signals "no drop observed yet"; onMove always fires before onDrop.
  let dropIdx = -1;
  startDrag(e, {
    onMove: (ev) => {
      let chosen = visibleFields.length;
      for (let i = 0; i < visibleFields.length; i++) {
        const rect = ths[i + 1].getBoundingClientRect();   // +1 for gutter
        const mid = rect.left + rect.width / 2;
        if (ev.clientX < mid) { chosen = i; break; }
      }
      dropIdx = chosen;
      const targetRect = chosen === visibleFields.length
        ? ths[visibleFields.length].getBoundingClientRect()
        : ths[chosen + 1].getBoundingClientRect();
      const x = chosen === visibleFields.length ? targetRect.right : targetRect.left;
      const tableRect = table.getBoundingClientRect();
      ind.show(x - 1, tableRect.top, 2, tableRect.bottom - tableRect.top);
    },
    onDrop: () => {
      ind.remove();
      suppressNextClick();
      if (dropIdx < 0) return;  // no valid drop position observed
      const board = ctx.getBoard();
      const allNames = board.fields.map(x => x.name);
      const visibleNames = visibleFields.map(x => x.name);
      const anchorField = dropIdx < visibleNames.length ? visibleNames[dropIdx] : null;
      const filtered = allNames.filter(n => n !== f.name);
      const insertAt = anchorField ? filtered.indexOf(anchorField) : filtered.length;
      const next = [...filtered];
      next.splice(insertAt, 0, f.name);
      const b2: Board = {
        ...board,
        views: board.views.map(v => ({ ...v, columns: v.columns ? [...v.columns] : undefined })),
      };
      setViewColumns(b2, 'table', next);
      ctx.mutate(b2);
    },
    onCancel: () => ind.remove(),
  });
}

export function mountTable(ctx: BoardRendererCtx): BoardRendererOps {
  // DIAGNOSTIC: prove the fresh build is mounted + that mousedown reaches us.
  dbgFlash('mountTable() running', '#9333ea');
  const root = ctx.root;
  root.classList.add('bd-table-host');
  root.addEventListener('mousedown', (e) => {
    const t = e.target as HTMLElement | null;
    const cls = t?.className || t?.tagName || '?';
    const inDrag = !!t?.closest('[data-board-drag]');
    dbgFlash(`host mousedown: ${typeof cls === 'string' ? cls.slice(0, 30) : '?'} drag=${inDrag}`, '#0891b2');
  }, true);
  let detached = false;
  const collapsedGroups = new Set<string>();
  const pendingFocus: { id: string | null; field: string | null } = { id: null, field: null };
  // Cancel an in-progress row drag before wiping the DOM on re-render.
  let cancelRowDrag: (() => void) | null = null;

  function render(): void {
    if (detached) return;
    cancelRowDrag?.();
    cancelRowDrag = null;
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
    gutterCol.style.width = '14px';
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
      th.dataset.field = f.name;
      th.style.position = 'relative';

      if (!ctx.readonly) {
        // Left: dedicated drag handle — dragging ONLY, never triggers sort.
        const dragHandle = document.createElement('span');
        dragHandle.className = 'bd-col-drag-handle';
        dragHandle.title = 'Drag to reorder column';
        dragHandle.setAttribute('data-board-drag', '');
        dragHandle.innerHTML = `<svg viewBox="0 0 8 14" width="8" height="14"><circle cx="2" cy="3" r="1"/><circle cx="6" cy="3" r="1"/><circle cx="2" cy="7" r="1"/><circle cx="6" cy="7" r="1"/><circle cx="2" cy="11" r="1"/><circle cx="6" cy="11" r="1"/></svg>`;
        dragHandle.addEventListener('mousedown', (e) => {
          dbgFlash('colDrag mousedown', '#15803d');
          e.preventDefault();
          e.stopPropagation();
          th.classList.add('bd-th-dragging');
          startColumnDrag(e, f, visibleFields, ctx);
          const cleanup = () => { th.classList.remove('bd-th-dragging'); };
          document.addEventListener('mouseup', cleanup, { once: true });
        });
        th.appendChild(dragHandle);
      }

      // Label (clickable for sort)
      const label = document.createElement('span');
      label.className = 'bd-th-label';
      label.textContent = f.name;
      th.appendChild(label);

      if (v.sort?.field === f.name) {
        const caret = document.createElement('span');
        caret.className = 'bd-sort-caret';
        caret.textContent = v.sort.dir === 'asc' ? ' ▲' : ' ▼';
        th.appendChild(caret);
      }

      if (!ctx.readonly) {
        const headerMenuBtn = document.createElement('button');
        headerMenuBtn.type = 'button';
        headerMenuBtn.className = 'bd-col-menu-btn';
        headerMenuBtn.textContent = '⋯';
        headerMenuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openColumnMenu(headerMenuBtn, f, ctx, collapsedGroups);
        });
        th.appendChild(headerMenuBtn);

        const resizer = document.createElement('div');
        resizer.className = 'bd-col-resizer';
        resizer.setAttribute('data-board-drag', '');
        resizer.addEventListener('mousedown', (e) => {
          dbgFlash('resize mousedown', '#1d4ed8');
          e.preventDefault();
          e.stopPropagation();
          document.body.style.cursor = 'col-resize';
          const start = e.clientX;
          const col = table.querySelectorAll('colgroup col')[1 + visibleFields.indexOf(f)] as HTMLTableColElement;
          const parsedW = parseInt(col.style.width, 10);
          const startW = Number.isNaN(parsedW) ? 160 : parsedW;
          const onMove = (ev: MouseEvent) => {
            const next = Math.max(60, startW + (ev.clientX - start));
            col.style.width = `${next}px`;
          };
          const onUp = (ev: MouseEvent) => {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
            document.body.style.cursor = '';
            const next = Math.max(60, startW + (ev.clientX - start));
            const cur = ctx.getBoard();
            const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2, widths: { ...(v2.widths ?? {}) } })) };
            setViewWidth(b2, 'table', f.name, next);
            ctx.mutate(b2);
          };
          document.addEventListener('mousemove', onMove, true);
          document.addEventListener('mouseup', onUp, true);
        });
        th.appendChild(resizer);

        // Sort click on the th — drag handle, menu btn, resizer all stop propagation.
        th.addEventListener('click', (e) => {
          const t = e.target as HTMLElement;
          if (t.closest('.bd-col-resizer, .bd-col-menu-btn, .bd-col-drag-handle')) return;
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

        // Caret lives outside the chip — clicking it (or the chip) collapses.
        const caretEl = document.createElement('span');
        caretEl.className = 'bd-group-caret';
        caretEl.textContent = collapsedGroups.has(g.key) ? '▸' : '▾';

        // Chip: colored pill matching the Status chip palette.
        let chipColor = 'gray';
        if (v.groupBy === 'Status') {
          const colDef = b.columns.find(c => c.name === g.key);
          if (colDef) chipColor = colDef.color;
        }
        const chip = document.createElement('span');
        chip.className = `board-column-chip color-${chipColor} bd-group-chip`;
        const dot = document.createElement('span');
        dot.className = 'board-column-chip-dot';
        chip.appendChild(dot);
        const nameSpan = document.createElement('span');
        nameSpan.className = 'board-column-name';
        nameSpan.textContent = g.key;
        chip.appendChild(nameSpan);
        const countSpan = document.createElement('span');
        countSpan.className = 'bd-group-count';
        countSpan.textContent = String(g.cards.length);
        chip.appendChild(countSpan);

        const left = document.createElement('span');
        left.className = 'bd-group-left';
        left.append(caretEl, chip);

        const isUncategorizedStatus = v.groupBy === 'Status' && g.key === 'Uncategorized';
        if (!ctx.readonly && !isUncategorizedStatus) {
          const addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.className = 'bd-group-add';
          addBtn.textContent = '+ Add row';
          addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cur = ctx.getBoard();
            const b2: Board = { ...cur, cards: [...cur.cards] };
            const presets: Partial<Record<string, string>> = {};
            if (v.groupBy) {
              presets[v.groupBy] = g.key === '—' ? '' : g.key;
            }
            const newId = addCard(b2, presets);
            pendingFocus.id = newId;
            pendingFocus.field = 'Title'; // NOTE: if the Title field is ever renamed, this focus silently no-ops
            ctx.mutate(b2);
          });
          row.append(left, addBtn);
        } else {
          row.append(left);
        }
        td.appendChild(row);
        head.appendChild(td);
        if (!ctx.readonly) {
          head.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.bd-group-add')) return;
            if (collapsedGroups.has(g.key)) collapsedGroups.delete(g.key);
            else                            collapsedGroups.add(g.key);
            render();
          });
        }
        tbody.appendChild(head);
      }
      if (collapsedGroups.has(g.key)) continue;
      for (const card of g.cards) {
        const tr = document.createElement('tr');
        tr.className = 'bd-table-row';
        tr.dataset.cardId = card.id;
        const gutter = document.createElement('td');
        gutter.className = 'bd-table-gutter';
        if (!v.sort && !ctx.readonly) {
          const grip = document.createElement('span');
          grip.className = 'bd-row-grip';
          grip.setAttribute('data-board-drag', '');
          grip.innerHTML = `<svg viewBox="0 0 8 14" width="8" height="14"><circle cx="2" cy="3" r="1"/><circle cx="6" cy="3" r="1"/><circle cx="2" cy="7" r="1"/><circle cx="6" cy="7" r="1"/><circle cx="2" cy="11" r="1"/><circle cx="6" cy="11" r="1"/></svg>`;
          grip.addEventListener('mousedown', (ev) => {
            dbgFlash('rowDrag mousedown', '#b45309');
            ev.preventDefault();
            ev.stopPropagation();
            tr.classList.add('bd-tr-dragging');
            cancelRowDrag = startRowDrag(ev, card, g, ctx);
            const cleanup = () => { tr.classList.remove('bd-tr-dragging'); };
            document.addEventListener('mouseup', cleanup, { once: true });
          });
          gutter.appendChild(grip);
        }
        tr.appendChild(gutter);
        for (const f of visibleFields) {
          const td = document.createElement('td');
          renderCell(td, card, f, ctx);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }

    if (!v.groupBy && !ctx.readonly) {
      const addRow = document.createElement('tr');
      addRow.className = 'bd-table-addrow';
      const gutter = document.createElement('td');
      gutter.className = 'bd-table-gutter';
      addRow.appendChild(gutter);
      for (const f of visibleFields) {
        const td = document.createElement('td');
        td.className = 'bd-table-cell bd-addrow-cell';
        if (f.name === 'Title' || (visibleFields.indexOf(f) === 0 && !visibleFields.some(x => x.name === 'Title'))) {
          td.textContent = '+ Add row';
          td.classList.add('bd-addrow-placeholder');
        }
        addRow.appendChild(td);
      }
      addRow.addEventListener('click', () => {
        const cur = ctx.getBoard();
        const b2: Board = { ...cur, cards: [...cur.cards] };
        const newId = addCard(b2);
        pendingFocus.id = newId;
        pendingFocus.field = 'Title';
        ctx.mutate(b2);
      });
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
    const explicit = v.columns;
    const hasExplicitOrder = !!explicit && explicit.length > 0;
    const hasHidden = hidden.size > 0;
    // Fresh view (no per-view column or hidden config): fall back to the
    // board-level `visibleOnCard` so the table mirrors what the kanban shows.
    // Once the user has expressed per-view intent (reorder OR hide), trust
    // view.hidden as the only source of "hidden" and ignore visibleOnCard.
    const usesFallback = !hasExplicitOrder && !hasHidden;
    const explicitSet = new Set(explicit ?? []);
    const tail = b.fields.map(f => f.name).filter(n => !explicitSet.has(n));
    const orderedNames = hasExplicitOrder ? [...explicit!, ...tail] : tail;
    const out: FieldDef[] = [];
    for (const name of orderedNames) {
      const f = b.fields.find(x => x.name === name);
      if (!f) continue;
      if (hidden.has(name)) continue;
      if (usesFallback && !f.visibleOnCard) continue;
      out.push(f);
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

let currentColumnMenuOutside: ((e: MouseEvent) => void) | null = null;

function openColumnMenu(anchor: HTMLElement, f: FieldDef, ctx: BoardRendererCtx, collapsedGroups: Set<string>): void {
  // Close any existing menu AND remove its stale outside-click listener.
  if (currentColumnMenuOutside) {
    document.removeEventListener('mousedown', currentColumnMenuOutside, true);
    currentColumnMenuOutside = null;
  }
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
    btn.addEventListener('click', (e) => { e.stopPropagation(); fn(); menu.remove(); document.removeEventListener('mousedown', close, true); currentColumnMenuOutside = null; });
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
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener('mousedown', close, true);
      currentColumnMenuOutside = null;
    }
  };
  currentColumnMenuOutside = close;
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
      const at = new Date(a).getTime();
      const ct = new Date(c).getTime();
      if (isNaN(at) && isNaN(ct)) return 0;
      if (isNaN(at)) return 1;
      if (isNaN(ct)) return -1;
      return at - ct;
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
  // text, person — empties sort last to match date/tags semantics
  return (a, c) => {
    if (!a && !c) return 0;
    if (!a) return 1;
    if (!c) return -1;
    return a.localeCompare(c, undefined, { sensitivity: 'base' });
  };
}

function renderCell(td: HTMLTableCellElement, card: Card, field: FieldDef, ctx: BoardRendererCtx): void {
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
      const colDef = ctx.getBoard().columns.find(c => c.name === value);
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
      if (!value) {
        const placeholder = document.createElement('span');
        placeholder.className = 'bd-cell-empty';
        placeholder.textContent = '—';
        td.appendChild(placeholder);
      } else {
        const pill = document.createElement('span');
        pill.className = 'bd-date';
        const d = new Date(value + 'T00:00:00');
        pill.textContent = isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  const range = document.createRange();
  range.selectNodeContents(td);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
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

let currentStatusOutside: ((e: MouseEvent) => void) | null = null;

function openStatusDropdown(anchor: HTMLElement, card: Card, ctx: BoardRendererCtx): void {
  document.querySelectorAll('.board-status-dropdown').forEach((n) => n.remove());
  if (currentStatusOutside) {
    document.removeEventListener('mousedown', currentStatusOutside, true);
    currentStatusOutside = null;
  }
  const pop = document.createElement('div');
  pop.className = 'board-status-dropdown';

  function closeOnOutside(e: MouseEvent): void {
    if (!pop.contains(e.target as Node)) {
      pop.remove();
      document.removeEventListener('mousedown', closeOnOutside, true);
      currentStatusOutside = null;
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
  currentStatusOutside = closeOnOutside;
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

  let resolved = false;
  const commit = () => {
    if (resolved) return;
    resolved = true;
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
    if (resolved) return;
    resolved = true;
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
