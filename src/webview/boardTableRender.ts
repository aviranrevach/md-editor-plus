// src/webview/boardTableRender.ts
// Table renderer: builds an empty-state OR a <table> with one header per
// visible field and one row per card.
//
// NOTE on drag wiring: ProseMirror's atom-node handling intercepts mousedown
// somewhere between the board-block element and its bodyEl descendant —
// mousedown listeners attached to the table or any of its descendants don't
// fire. To route around this, the column-drag, column-resize, and row-drag
// handlers are installed as a single document-level capture-phase listener
// per mount, with delegation by `data-board-drag` and a per-mount scope
// check (target.closest('.bd-table-host') === this mount's bodyEl). The
// listener is removed on destroy.

import type { Board, Card, ViewDef, FieldDef } from './boardModel';
import type { BoardRendererCtx, BoardRendererOps } from './boardBlock';
import { buildChip } from './boardSidePanel';
import { setViewSort, setViewGroup, setViewWidth, setViewColumns, hideFieldInView, addCard, moveCard } from './boardOps';
import { startDrag, dropIndicator } from './boardDragShared';

interface Group { key: string; cards: Card[]; }

// "Description" is a synthetic field that surfaces card.body as a table column.
// It's not stored in board.fields — it's a virtual entry the table view + the
// Properties popover treat as always-available.
export const DESCRIPTION_FIELD: FieldDef = { name: 'Description', type: 'text', visibleOnCard: false };

// Pending-header-rename setter (filled by mountTable). Lets external code
// (e.g. the chrome's "+ Add property" button) request that the next render
// of the table renderer enter inline-rename on a specific column header.
let pendingHeaderRenameRequest: ((fieldName: string) => void) | null = null;
export function requestHeaderRename(fieldName: string): void {
  pendingHeaderRenameRequest?.(fieldName);
}

function cssEscape(s: string): string {
  // Minimal CSS attribute-value escape — only the characters likely to appear
  // in a field name that would break an attribute selector.
  return s.replace(/["\\]/g, '\\$&');
}

function beginHeaderRename(label: HTMLElement, fieldName: string, ctx: BoardRendererCtx): void {
  if (label.getAttribute('contenteditable') === 'true') return;
  const original = label.textContent ?? fieldName;
  label.setAttribute('contenteditable', 'true');
  label.classList.add('bd-th-label-editing');
  label.focus();
  // Select all so the user can type to replace.
  const range = document.createRange();
  range.selectNodeContents(label);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  let resolved = false;
  const cleanup = (): void => {
    label.removeAttribute('contenteditable');
    label.classList.remove('bd-th-label-editing');
    label.removeEventListener('keydown', onKey);
    label.removeEventListener('blur', onBlur);
  };
  const commit = (): void => {
    if (resolved) return;
    resolved = true;
    const next = (label.textContent ?? '').trim();
    cleanup();
    if (!next || next === fieldName) {
      label.textContent = original;
      return;
    }
    const cur = ctx.getBoard();
    if (cur.fields.some(f => f.name === next)) {
      // Name conflict — restore.
      label.textContent = original;
      return;
    }
    ctx.mutate({
      ...cur,
      fields: cur.fields.map(f => (f.name === fieldName ? { ...f, name: next } : f)),
      cards: cur.cards.map(c => {
        if (!(fieldName in c.values)) return c;
        const v: Record<string, string> = { ...c.values };
        v[next] = v[fieldName];
        delete v[fieldName];
        return { ...c, values: v };
      }),
    });
  };
  const cancel = (): void => {
    if (resolved) return;
    resolved = true;
    label.textContent = original;
    cleanup();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };
  const onBlur = (): void => commit();
  label.addEventListener('keydown', onKey);
  label.addEventListener('blur', onBlur);
}

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
      // Build the new column order from the fields the user can actually SEE
      // in this view. Including hidden fields (like 'id' which is scaffolding)
      // would accidentally promote them into view.columns and make them visible
      // since `view.columns` overrides the default-hidden rule.
      const visibleNames = visibleFields.map(x => x.name);
      const anchorField = dropIdx < visibleNames.length ? visibleNames[dropIdx] : null;
      const filtered = visibleNames.filter(n => n !== f.name);
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
  const root = ctx.root;
  root.classList.add('bd-table-host');
  let detached = false;
  const collapsedGroups = new Set<string>();
  const pendingFocus: { id: string | null; field: string | null } = { id: null, field: null };
  // Cancel an in-progress row drag before wiping the DOM on re-render.
  let cancelRowDrag: (() => void) | null = null;
  // Latest computed visible fields per render — the delegated mousedown handler
  // reads this to translate a `data-field` attribute back into a FieldDef.
  let lastVisibleFields: FieldDef[] = [];
  // Latest <table> element so the resizer handler can find <colgroup col>s.
  let lastTable: HTMLTableElement | null = null;
  // Latest groups (for row-drag scoping). The grip's tr.dataset.cardId maps
  // back to a Card via b.cards, but startRowDrag needs the surrounding group
  // so cross-group drops can be rejected.
  let lastGroups: Group[] = [];
  // When set, the next render enters inline-rename mode on this column's
  // header (used after "+ Add property" so the user can name the new column
  // immediately without re-clicking).
  let pendingHeaderRename: string | null = null;
  pendingHeaderRenameRequest = (name) => { pendingHeaderRename = name; };

  function render(): void {
    if (detached) return;
    cancelRowDrag?.();
    cancelRowDrag = null;
    const b = ctx.getBoard();
    const v = b.views.find(x => x.name === 'table') ?? { name: 'table' };
    root.innerHTML = '';

    const visibleFields = computeVisibleFields(b, v);
    lastVisibleFields = visibleFields;
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
    lastTable = table;

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

      // Flex wrapper: [drag-handle] [label] [sort-caret] <spacer> [menu-btn]
      // Resizer stays as a direct child of th (position:absolute relative to th).
      const inner = document.createElement('div');
      inner.className = 'bd-th-inner';

      const left = document.createElement('span');
      left.className = 'bd-th-left';

      if (!ctx.readonly) {
        const dragHandle = document.createElement('span');
        dragHandle.className = 'bd-col-drag-handle';
        dragHandle.title = 'Drag to reorder column';
        dragHandle.setAttribute('data-board-drag', '');
        dragHandle.innerHTML = `<svg viewBox="0 0 8 14" width="8" height="14"><circle cx="2" cy="3" r="1"/><circle cx="6" cy="3" r="1"/><circle cx="2" cy="7" r="1"/><circle cx="6" cy="7" r="1"/><circle cx="2" cy="11" r="1"/><circle cx="6" cy="11" r="1"/></svg>`;
        left.appendChild(dragHandle);
      }

      const label = document.createElement('span');
      label.className = 'bd-th-label';
      label.textContent = f.name;
      // Double-click → inline rename. Locked for Title/Status/Description
      // (they're system fields with fixed names).
      const isLockedName = f.name === 'Title' || f.name === 'Status' || f.name === DESCRIPTION_FIELD.name;
      if (!ctx.readonly && !isLockedName) {
        label.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation();
          beginHeaderRename(label, f.name, ctx);
        });
      }
      left.appendChild(label);

      if (v.sort?.field === f.name) {
        const caret = document.createElement('span');
        caret.className = 'bd-sort-caret';
        caret.textContent = v.sort.dir === 'asc' ? ' ▲' : ' ▼';
        left.appendChild(caret);
      }
      inner.appendChild(left);
      th.appendChild(inner);

      if (!ctx.readonly) {
        const headerMenuBtn = document.createElement('button');
        headerMenuBtn.type = 'button';
        headerMenuBtn.className = 'bd-col-menu-btn';
        headerMenuBtn.textContent = '⋯';
        headerMenuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openColumnMenu(headerMenuBtn, f, ctx, collapsedGroups);
        });
        // Append menu button INSIDE the flex wrapper so it sits at the far right
        // of the header (the `.bd-th-left` consumes flex space; menu-btn doesn't).
        inner.appendChild(headerMenuBtn);

        const resizer = document.createElement('div');
        resizer.className = 'bd-col-resizer';
        resizer.setAttribute('data-board-drag', '');
        // Resizer is absolutely positioned on the th's right edge (outside inner).
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
    lastGroups = groups;
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
        if (!ctx.readonly) {
          const grip = document.createElement('span');
          grip.className = 'bd-row-grip';
          if (v.sort) {
            // Row reorder is disabled when the table is sort-ordered (the user's
            // sort would just snap back on the next render). Show the grip in a
            // disabled state with an explanatory tooltip rather than hiding it,
            // so the affordance stays discoverable.
            grip.classList.add('bd-row-grip-disabled');
            grip.title = 'Clear sort to reorder rows';
          } else {
            grip.setAttribute('data-board-drag', '');
            grip.title = 'Drag to reorder row';
          }
          grip.innerHTML = `<svg viewBox="0 0 8 14" width="8" height="14"><circle cx="2" cy="3" r="1"/><circle cx="6" cy="3" r="1"/><circle cx="2" cy="7" r="1"/><circle cx="6" cy="7" r="1"/><circle cx="2" cy="11" r="1"/><circle cx="6" cy="11" r="1"/></svg>`;
          gutter.appendChild(grip);
          // mousedown is wired via the document-level delegated listener; the
          // listener checks `data-board-drag` so disabled grips don't trigger.
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
      // Inline-edit add-row: click → first cell becomes contenteditable with
      // placeholder text cleared → Enter/blur-with-content commits and a fresh
      // add-row appears; Escape/blur-empty cancels. Matches the kanban's
      // "+ New card" flow so no card is created until the user actually names it.
      const addRow = document.createElement('tr');
      addRow.className = 'bd-table-addrow';
      const gutter = document.createElement('td');
      gutter.className = 'bd-table-gutter';
      addRow.appendChild(gutter);
      let placeholderCell: HTMLElement | null = null;
      for (const f of visibleFields) {
        const td = document.createElement('td');
        td.className = 'bd-table-cell bd-addrow-cell';
        if (!placeholderCell && (f.name === 'Title' || visibleFields.indexOf(f) === 0)) {
          td.textContent = '+ Add row';
          td.classList.add('bd-addrow-placeholder');
          placeholderCell = td;
        }
        addRow.appendChild(td);
      }
      const beginAdd = (): void => {
        if (!placeholderCell) return;
        if (placeholderCell.getAttribute('contenteditable') === 'true') return;
        placeholderCell.textContent = '';
        placeholderCell.classList.remove('bd-addrow-placeholder');
        placeholderCell.setAttribute('contenteditable', 'true');
        placeholderCell.focus();
        let resolved = false;
        const commit = (): void => {
          if (resolved) return;
          const title = (placeholderCell!.textContent ?? '').trim();
          if (!title) { cancel(); return; }
          resolved = true;
          placeholderCell!.removeAttribute('contenteditable');
          const cur = ctx.getBoard();
          const b2: Board = { ...cur, cards: [...cur.cards] };
          addCard(b2, { Title: title });
          ctx.mutate(b2);
        };
        const cancel = (): void => {
          if (resolved) return;
          resolved = true;
          placeholderCell!.removeAttribute('contenteditable');
          placeholderCell!.textContent = '+ Add row';
          placeholderCell!.classList.add('bd-addrow-placeholder');
        };
        placeholderCell.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
          else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
        });
        placeholderCell.addEventListener('blur', () => commit());
      };
      addRow.addEventListener('click', beginAdd);
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
    // Pending header rename — e.g. user just added a property via chrome '+'.
    if (pendingHeaderRename) {
      const labelEl = root.querySelector<HTMLElement>(
        `th[data-field="${cssEscape(pendingHeaderRename)}"] .bd-th-label`,
      );
      const fieldName = pendingHeaderRename;
      pendingHeaderRename = null;
      if (labelEl) beginHeaderRename(labelEl, fieldName, ctx);
    }
  }

  function computeVisibleFields(b: Board, v: ViewDef): FieldDef[] {
    const hidden = new Set(v.hidden ?? []);
    const explicit = v.columns;
    const hasExplicitOrder = !!explicit && explicit.length > 0;
    const explicitSet = new Set(explicit ?? []);
    const tail = b.fields.map(f => f.name).filter(n => !explicitSet.has(n));
    const orderedNames = hasExplicitOrder ? [...explicit!, ...tail] : tail;
    const out: FieldDef[] = [];
    for (const name of orderedNames) {
      const f = b.fields.find(x => x.name === name);
      if (!f) continue;
      if (hidden.has(name)) continue;
      // Only the conventional `id` field defaults to hidden in the table
      // (it's board scaffolding, not user data). Any other field with
      // visibleOnCard=false is still shown in the table — the table and
      // kanban have independent visibility expectations.
      if (name === 'id' && !f.visibleOnCard && !explicitSet.has('id')) continue;
      out.push(f);
    }
    // Synthetic "Description" field — backed by card.body, always available
    // (it's a first-class concept on every card, edited via the side panel).
    // Hidden if the user explicitly hides it via the Properties popover.
    if (!hidden.has(DESCRIPTION_FIELD.name)) {
      out.push(DESCRIPTION_FIELD);
    }
    return out;
  }

  // Document-level capture mousedown delegation.
  // See file-header NOTE for why this can't be wired directly on the elements.
  // Scope check: target must be inside THIS mount's `root` (bodyEl with
  // bd-table-host class), so other boards on the page aren't affected.
  function onDocMousedown(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const host = target.closest('.bd-table-host');
    if (host !== root) return;

    const resizerEl = target.closest('.bd-col-resizer') as HTMLElement | null;
    if (resizerEl) {
      const th = resizerEl.closest('th[data-field]') as HTMLElement | null;
      const fieldName = th?.dataset.field;
      const f = lastVisibleFields.find(x => x.name === fieldName);
      if (!f || !lastTable) return;
      e.preventDefault();
      e.stopPropagation();
      // Simple delta math: capture cursor + width at mousedown, apply 1:1.
      // Both `startX` and `col` are stable across the drag — no recomputation
      // that could be thrown off if the table re-renders.
      const startX = e.clientX;
      const colIdx = 1 + lastVisibleFields.indexOf(f);
      const col = lastTable.querySelectorAll('colgroup col')[colIdx] as HTMLTableColElement;
      const startW = parseFloat(col.style.width) || 160;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const onMove = (ev: MouseEvent): void => {
        const next = Math.max(60, startW + (ev.clientX - startX));
        col.style.width = `${next}px`;
      };
      const onUp = (ev: MouseEvent): void => {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        const next = Math.max(60, startW + (ev.clientX - startX));
        const cur = ctx.getBoard();
        const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2, widths: { ...(v2.widths ?? {}) } })) };
        setViewWidth(b2, 'table', f.name, Math.round(next));
        ctx.mutate(b2);
      };
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
      return;
    }

    const dragHandleEl = target.closest('.bd-col-drag-handle') as HTMLElement | null;
    if (dragHandleEl) {
      const th = dragHandleEl.closest('th[data-field]') as HTMLElement | null;
      const fieldName = th?.dataset.field;
      const f = lastVisibleFields.find(x => x.name === fieldName);
      if (!f) return;
      e.preventDefault();
      e.stopPropagation();
      // Apply the dragging style only AFTER the drag actually promotes past
      // the 4px threshold — applying it on plain mousedown produced a flash
      // when the user just clicked the handle.
      let armed = false;
      const onMoveOnce = (): void => {
        if (armed) return;
        armed = true;
        th?.classList.add('bd-th-dragging');
        document.removeEventListener('mousemove', onMoveOnce, true);
      };
      document.addEventListener('mousemove', onMoveOnce, true);
      startColumnDrag(e, f, lastVisibleFields, ctx);
      document.addEventListener('mouseup', () => {
        document.removeEventListener('mousemove', onMoveOnce, true);
        th?.classList.remove('bd-th-dragging');
      }, { once: true });
      return;
    }

    const gripEl = target.closest('.bd-row-grip') as HTMLElement | null;
    if (gripEl) {
      const tr = gripEl.closest('tr.bd-table-row') as HTMLElement | null;
      const cardId = tr?.dataset.cardId;
      if (!cardId) return;
      const b = ctx.getBoard();
      const card = b.cards.find(c => c.id === cardId);
      if (!card) return;
      // Find the group this card belongs to (matches the rendered grouping).
      const group = lastGroups.find(g => g.cards.some(c => c.id === cardId)) ?? { key: '', cards: [card] };
      e.preventDefault();
      e.stopPropagation();
      tr?.classList.add('bd-tr-dragging');
      cancelRowDrag = startRowDrag(e, card, group, ctx);
      document.addEventListener('mouseup', () => tr?.classList.remove('bd-tr-dragging'), { once: true });
      return;
    }
  }
  document.addEventListener('mousedown', onDocMousedown, true);

  render();

  return {
    update: (_next: Board) => render(),
    destroy: () => {
      detached = true;
      document.removeEventListener('mousedown', onDocMousedown, true);
      cancelRowDrag?.();
      pendingHeaderRenameRequest = null;
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
  // Rename is the FIRST item — most-common reason to open this menu.
  // Locked for system fields (Title / Status / Description).
  const isLockedName = f.name === 'Title' || f.name === 'Status' || f.name === DESCRIPTION_FIELD.name;
  if (!isLockedName) {
    mkItem('Rename', () => {
      // Trigger inline-rename via the same path the chrome's "+" uses.
      requestHeaderRename(f.name);
      // Force a render so pendingHeaderRename is consumed and focus lands on the label.
      ctx.mutate({ ...ctx.getBoard() });
    });
  }
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
  // Synthetic Description column — shows a single-line preview of card.body.
  // Click opens the side panel for full markdown editing.
  if (field.name === DESCRIPTION_FIELD.name) {
    const body = (card.body || '').trim();
    const preview = body.replace(/[\r\n]+/g, ' • ').slice(0, 200);
    if (preview) {
      td.textContent = preview;
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'bd-cell-empty';
      placeholder.textContent = '—';
      td.appendChild(placeholder);
    }
    td.classList.add('bd-cell-description');
    if (!ctx.readonly) {
      td.style.cursor = 'pointer';
      td.title = 'Click to edit';
      td.addEventListener('click', () => ctx.openSidePanel(card.id));
    }
    return;
  }
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
