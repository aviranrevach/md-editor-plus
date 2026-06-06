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

import type { Board, Card, ViewDef, FieldDef, ColorToken } from './boardModel';
import { getStatusOptions, autoColorPublic, mintCardId } from './boardModel';
import type { BoardRendererCtx, BoardRendererOps } from './boardBlock';
import { buildChip } from './boardSidePanel';
import { setViewSort, setViewGroup, setViewWidth, setViewColumns, hideFieldInView, addCard, moveCard } from './boardOps';
import { startDrag, dropIndicator } from './boardDragShared';
import { openStatusOptionsEditor } from './boardStatusOptions';
import { openTagsPicker } from './boardTagsPicker';

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
      col.style.width = `${widths[f.name] ?? (f.name === 'id' ? 64 : 160)}px`;
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
          // Skip when the click is part of a double-click (rename) sequence;
          // otherwise the two clicks fire sort twice before dblclick lands.
          if (e.detail >= 2) return;
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

        // Color from the grouped field: status option color, tag hash, else neutral.
        const gc = groupColor(b, v.groupBy!, g.key);
        const chipColor = gc ?? 'gray';
        if (gc) row.classList.add('bd-group-band', `color-${gc}`);
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
      // NOTE: when grouped by a tag, a multi-tag card appears in several buckets;
      // this resolves to the FIRST matching bucket, so dragging it from another of
      // its buckets reorders relative to the first. moveCard works on the global
      // cards array by id (no duplication/loss) — this is a known, accepted limit.
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

/** The color token for a group key, or null for a neutral band. */
function groupColor(b: Board, field: string, key: string): ColorToken | null {
  const f = b.fields.find(x => x.name === field);
  if (!f) return null;
  if (f.type === 'status') {
    if (key === 'Uncategorized') return null;
    return getStatusOptions(b, field).find(o => o.name === key)?.color ?? null;
  }
  if (f.type === 'tags' && key !== '—') return autoColorPublic(key);
  return null;
}

function applyGroup(cards: Card[], v: ViewDef, b: Board): Group[] {
  if (!v.groupBy) return [{ key: '', cards }];
  const field = v.groupBy;
  const fdef = b.fields.find(x => x.name === field);
  if (!fdef) return [{ key: '', cards }];

  const bucket = new Map<string, Card[]>();
  const push = (key: string, c: Card) => {
    const arr = bucket.get(key) ?? [];
    arr.push(c);
    bucket.set(key, arr);
  };
  const alpha = (a: string, c: string) => {
    if (a === '—') return 1;
    if (c === '—') return -1;
    return a.localeCompare(c, undefined, { sensitivity: 'base' });
  };

  if (fdef.type === 'tags') {
    for (const c of cards) {
      const tags = (c.values[field] ?? '').split(',').map(s => s.trim()).filter(Boolean);
      if (tags.length === 0) push('—', c);
      else for (const t of tags) push(t, c);
    }
    return Array.from(bucket.keys()).sort(alpha).map(k => ({ key: k, cards: bucket.get(k) ?? [] }));
  }

  if (fdef.type === 'status') {
    const opts = getStatusOptions(b, field);
    const valid = new Set(opts.map(o => o.name));
    for (const c of cards) {
      const raw = c.values[field] ?? '';
      push(valid.has(raw) ? raw : 'Uncategorized', c);
    }
    for (const o of opts) if (!bucket.has(o.name)) bucket.set(o.name, []);
    const keys = opts.map(o => o.name);
    if (bucket.has('Uncategorized')) keys.push('Uncategorized');
    return keys.map(k => ({ key: k, cards: bucket.get(k) ?? [] }));
  }

  for (const c of cards) push((c.values[field] ?? '') || '—', c);
  return Array.from(bucket.keys()).sort(alpha).map(k => ({ key: k, cards: bucket.get(k) ?? [] }));
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
  const mkItem = (icon: string, label: string, fn: () => void, opts: { disabled?: boolean } = {}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bd-col-menu-item';
    btn.disabled = !!opts.disabled;
    btn.innerHTML = `<span class="bd-col-menu-icon">${icon}</span><span class="bd-col-menu-label">${label}</span>`;
    btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    if (!opts.disabled) {
      btn.addEventListener('click', (e) => { e.stopPropagation(); fn(); menu.remove(); document.removeEventListener('mousedown', close, true); currentColumnMenuOutside = null; });
    }
    menu.appendChild(btn);
  };
  // Rename is the FIRST item — most-common reason to open this menu.
  // Shown but disabled for system fields (Title / Status / Description) so
  // users can SEE the action exists, even if they can't use it on these fields.
  const isLockedName = f.name === 'Title' || f.name === 'Status' || f.name === DESCRIPTION_FIELD.name;
  // Phosphor Bold 16px — viewBox 0 0 256 256, fill currentColor (matches the
  // project's existing icon style in blockPicker.ts).
  const ICON = {
    rename: `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M227.32,73.37,182.63,28.69a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.32,96a16,16,0,0,0,0-22.63ZM48,179.31,76.69,208H48ZM92.69,208,48,163.31,134,77.32,178.69,122ZM192,108.69,147.31,64l24-24L216,84.69Z"/></svg>`,
    sortAsc: `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M152,72a8,8,0,0,1,8-8h48a8,8,0,0,1,0,16H160A8,8,0,0,1,152,72Zm8,48h32a8,8,0,0,0,0-16H160a8,8,0,0,0,0,16Zm0,40h16a8,8,0,0,0,0-16H160a8,8,0,0,0,0,16Zm0,40h8a8,8,0,0,0,0-16h-8a8,8,0,0,0,0,16Zm-50.34-26.34L96,187.31V40a8,8,0,0,0-16,0V187.31L66.34,173.66a8,8,0,0,0-11.32,11.32l24,24a8,8,0,0,0,11.32,0l24-24A8,8,0,0,0,109.66,173.66Z"/></svg>`,
    sortDesc: `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M160,80h8a8,8,0,0,0,0-16h-8a8,8,0,0,0,0,16Zm0,40h16a8,8,0,0,0,0-16H160a8,8,0,0,0,0,16Zm0,40h32a8,8,0,0,0,0-16H160a8,8,0,0,0,0,16Zm48,24H160a8,8,0,0,0,0,16h48a8,8,0,0,0,0-16Zm-98.34-90.34L96,107.31V216a8,8,0,0,1-16,0V107.31L66.34,120.97A8,8,0,0,1,55,109.65l24-24a8,8,0,0,1,11.32,0l24,24A8,8,0,0,1,109.66,93.66Z"/></svg>`,
    sortClear: `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M240,128a96.12,96.12,0,0,1-93.5,95.94,8,8,0,0,1-.5-16A80.11,80.11,0,0,0,224,128a80,80,0,0,0-140.45-52.45L96.4,88.4a8,8,0,0,1-5.66,13.66H40A8,8,0,0,1,32,94V43.3a8,8,0,0,1,13.66-5.66l13.7,13.7A96,96,0,0,1,240,128Z"/></svg>`,
    group: `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM40,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM216,184H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z"/></svg>`,
    resetWidth: `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M240,56V200a8,8,0,0,1-16,0V56a8,8,0,0,1,16,0ZM32,200V56a8,8,0,0,0-16,0V200a8,8,0,0,0,16,0Zm164.69-71.85L168.85,156a4,4,0,0,1-6.85-2.83V136H94v17.17a4,4,0,0,1-6.85,2.83l-27.84-27.85a4,4,0,0,1,0-5.66l27.84-27.85a4,4,0,0,1,6.85,2.83V114h68V102.83a4,4,0,0,1,6.85-2.83l27.84,27.85A4,4,0,0,1,196.69,128.15Z"/></svg>`,
    hide: `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l21.92,24.11a8,8,0,1,0,11.84-10.76Zm46.34,79.42a36,36,0,0,1,49.4,49.4Zm-3.18,90A102.45,102.45,0,0,1,46.71,143C39.62,134.21,32.31,123.5,29,116.74c8.45-17.59,30.93-46.74,72.17-60.18l21.93,24.12a52,52,0,0,0,75.79,71.18l24,26.4A111.55,111.55,0,0,1,128,192a112.46,112.46,0,0,1-30.92-12.27Zm130-31.46a8,8,0,0,1-1.31-11.21c2.66-3.51,17.51-23.81,17.51-32.74,0-8.62-13.79-26.39-21.33-36.06l-.55-.71a112.46,112.46,0,0,0-37.45-32.78,8,8,0,1,1,7.55-14.12,128.39,128.39,0,0,1,42.86,37.43c5.31,6.83,29.92,39.5,29.92,46.24,0,7.5-22.16,40.59-20.94,42.13A8,8,0,0,1,227.08,172.55Z"/></svg>`,
    editOptions: `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M227.32,73.37,182.63,28.69a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.32,96a16,16,0,0,0,0-22.63ZM48,179.31,76.69,208H48ZM92.69,208,48,163.31,134,77.32,178.69,122ZM192,108.69,147.31,64l24-24L216,84.69Z"/></svg>`,
  };
  mkItem(ICON.rename, 'Rename', () => {
    requestHeaderRename(f.name);
    ctx.mutate({ ...ctx.getBoard() });
  }, { disabled: isLockedName });
  if (f.type === 'status' || f.type === 'tags') {
    mkItem(ICON.editOptions, 'Edit options', () => {
      openStatusOptionsEditor(anchor, ctx.getBoard, f.name, ctx.mutate);
    });
  }
  mkItem(ICON.sortAsc, 'Sort ascending', () => {
    const cur = ctx.getBoard();
    const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
    setViewSort(b2, 'table', { field: f.name, dir: 'asc' });
    ctx.mutate(b2);
  });
  mkItem(ICON.sortDesc, 'Sort descending', () => {
    const cur = ctx.getBoard();
    const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
    setViewSort(b2, 'table', { field: f.name, dir: 'desc' });
    ctx.mutate(b2);
  });
  mkItem(ICON.sortClear, 'Clear sort', () => {
    const cur = ctx.getBoard();
    const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
    setViewSort(b2, 'table', null);
    ctx.mutate(b2);
  });
  const tableGroupBy = ctx.getBoard().views.find(x => x.name === 'table')?.groupBy;
  if (tableGroupBy === f.name) {
    mkItem(ICON.group, 'Remove grouping', () => {
      collapsedGroups.clear();
      const cur = ctx.getBoard();
      const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
      setViewGroup(b2, 'table', null);
      ctx.mutate(b2);
    });
  } else {
    mkItem(ICON.group, 'Group by this', () => {
      collapsedGroups.clear();
      const cur = ctx.getBoard();
      const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
      setViewGroup(b2, 'table', f.name);
      ctx.mutate(b2);
    });
  }
  mkItem(ICON.resetWidth, 'Reset column width', () => {
    const cur = ctx.getBoard();
    const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
    setViewWidth(b2, 'table', f.name, null);
    ctx.mutate(b2);
  });
  mkItem(ICON.hide, 'Hide column', () => {
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
  // Edge-aware repositioning: after the menu is sized by the browser, check
  // for viewport overflow on right and bottom; flip / clamp so it stays
  // fully visible. The rightmost columns frequently hit this.
  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    const margin = 8;
    if (menuRect.right > window.innerWidth - margin) {
      // Align the menu's RIGHT edge with the anchor's right edge.
      const left = Math.max(margin, r.right - menuRect.width);
      menu.style.left = `${left}px`;
    }
    if (menuRect.bottom > window.innerHeight - margin) {
      const top = Math.max(margin, r.top - menuRect.height - 4);
      menu.style.top = `${top}px`;
    }
  });
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
    const order = new Map(getStatusOptions(b, f.name).map((col, i) => [col.name, i] as const));
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
  // The `id` field is internal plumbing. Always show the card's canonical id,
  // never editable (clicking does nothing) but selectable/copyable, and styled
  // as a muted system field. Backfill a missing id so the cell is never blank.
  if (field.name === 'id') {
    if (!card.id) {
      const minted = mintCardId(ctx.getBoard().cards.map(c => c.id));
      card.id = minted;
      card.values.id = minted;
    }
    td.textContent = card.id;
    td.classList.add('bd-cell-id');
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
      const opts = getStatusOptions(ctx.getBoard(), field.name);
      const colDef = opts.find((c) => c.name === value);
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
          openStatusDropdown(td, card, field, ctx);
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
        const opts = getStatusOptions(ctx.getBoard(), field.name);
        for (const t of tags) {
          const color = opts.find(o => o.name === t)?.color ?? autoColorPublic(t);
          const chip = document.createElement('span');
          chip.className = `bd-tag color-${color}`;
          chip.textContent = t;
          td.appendChild(chip);
        }
      }
      if (!ctx.readonly) {
        td.addEventListener('click', (e) => {
          e.stopPropagation();
          openTagsPicker(td, ctx.getBoard, field.name, card.id, ctx.mutate);
        });
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

let currentStatusOutside: ((e: MouseEvent) => void) | null = null;

function openStatusDropdown(anchor: HTMLElement, card: Card, field: FieldDef, ctx: BoardRendererCtx): void {
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

  for (const col of getStatusOptions(ctx.getBoard(), field.name)) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'board-status-option';
    item.appendChild(buildChip(col.name, col.color));
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = ctx.getBoard();
      ctx.mutate({
        ...cur,
        cards: cur.cards.map((c) =>
          c.id === card.id
            ? { ...c, values: { ...c.values, [field.name]: col.name } }
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
