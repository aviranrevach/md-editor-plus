// c46 — Notion-style row handle for regular markdown tables.
//
// A single floating grip (one reused element on document.body) follows the
// hovered row of a *regular* table. Drag reorders the row; a click with no
// movement opens a row-actions menu. Modeled on blockHandle.ts (floating
// handle + tooltip) and codeBlock.ts (manual mouse drag — ProseMirror
// intercepts HTML5 dragstart — with a drop line parented to document.body so
// the in-flight drag isn't torn down by a mutation inside the editor DOM).
//
// Board tables (.bd-table) render their own grips (c36) and are excluded here.

import { Editor } from '@tiptap/core';
import { createGripIcon } from './handleIcons';
import { createMenu, type MenuSection } from './menu';
import { rowMenuModel, canDragRow, ROW_MENU_LABEL, type RowMenuItemKind } from './tableRowOps';
import {
  findTableAround,
  moveRow,
  duplicateRow,
  insertRowRelative,
  deleteRowAt,
  type TableLoc,
} from './tableRowTx';

const DRAG_THRESHOLD_PX = 4;

const RM_ICON: Record<RowMenuItemKind, string> = {
  'insert-above': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  'insert-below': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
  'duplicate': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>',
  'delete': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>',
};

interface RowCtx {
  loc: TableLoc;
  rowIdx: number;
  isHeader: boolean;
}

/** The <tr> under `el` if it belongs to a regular editor table (not a board
 *  table, which renders its own grips). */
function regularTableRowAt(el: Element | null): HTMLTableRowElement | null {
  const tr = el?.closest('tr') as HTMLTableRowElement | null;
  if (!tr) return null;
  const table = tr.closest('table');
  if (!table || !table.closest('.ProseMirror')) return null;
  // Exclude board tables (c36 owns those grips).
  if (table.classList.contains('bd-table') || tr.classList.contains('bd-table-row')) return null;
  if (tr.closest('.bd-table-host')) return null;
  return tr;
}

export function createTableRowHandle(editor: Editor): () => void {
  const menu = createMenu({ className: 'tbl-row-menu' });

  const grip = document.createElement('div');
  grip.className = 'tbl-row-handle';
  grip.style.display = 'none';
  grip.appendChild(createGripIcon());
  document.body.appendChild(grip);

  let activeRow: HTMLTableRowElement | null = null;
  let dropLine: HTMLDivElement | null = null;

  function setActive(on: boolean): void {
    document.body.classList.toggle('tbl-row-active', on);
    if (!on) {
      grip.style.display = 'none';
      activeRow = null;
    }
  }

  /** Resolve the current PM table location + row index from a <tr>. */
  function rowCtxFor(tr: HTMLTableRowElement): RowCtx | null {
    let pos: number;
    try {
      pos = editor.view.posAtDOM(tr, 0);
    } catch { return null; }
    if (pos == null || pos < 0) return null;
    const loc = findTableAround(editor.state.doc, pos);
    if (!loc) return null;
    const table = tr.closest('table');
    if (!table) return null;
    const rowIdx = Array.from(table.rows).indexOf(tr);
    if (rowIdx < 0) return null;
    const isHeader = !!tr.querySelector('th');
    return { loc, rowIdx, isHeader };
  }

  function positionGrip(tr: HTMLTableRowElement): void {
    const r = tr.getBoundingClientRect();
    const gw = grip.offsetWidth || 16;
    const gh = grip.offsetHeight || 22;
    grip.style.top = `${r.top + r.height / 2 - gh / 2}px`;
    grip.style.left = `${r.left - gw - 4}px`;
  }

  // Follow the hovered row.
  const onDocMouseMove = (e: MouseEvent): void => {
    if (dragSrc) return; // don't re-target mid-drag
    if (editor.isDestroyed || !editor.isEditable) { setActive(false); return; }
    const t = e.target as Element | null;
    // Staying on the grip itself keeps the current row.
    if (t && grip.contains(t)) return;
    const tr = regularTableRowAt(t);
    if (!tr) { setActive(false); return; }
    activeRow = tr;
    grip.style.display = 'flex';
    positionGrip(tr);
    setActive(true);
  };
  document.addEventListener('mousemove', onDocMouseMove);

  // ---- Drag + click -------------------------------------------------------
  let dragSrc: { ctx: RowCtx; startX: number; startY: number } | null = null;
  let moved = false;

  function rowsOf(tr: HTMLTableRowElement): HTMLTableRowElement[] {
    const table = tr.closest('table');
    return table ? (Array.from(table.rows) as HTMLTableRowElement[]) : [];
  }

  /** Drop insert index (in row-array terms) for a pointer Y over the table. */
  function dropIndexAt(clientY: number, rows: HTMLTableRowElement[]): number | null {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) {
        return clientY < r.top + r.height / 2 ? i : i + 1;
      }
    }
    if (rows.length) {
      if (clientY < rows[0].getBoundingClientRect().top) return 0;
      return rows.length;
    }
    return null;
  }

  function showDropLine(insertIdx: number, rows: HTMLTableRowElement[]): void {
    // Never indicate a drop above the header row.
    const idx = Math.max(1, Math.min(insertIdx, rows.length));
    const ref = rows[idx] ?? rows[rows.length - 1];
    const r = ref.getBoundingClientRect();
    const y = idx >= rows.length ? r.bottom : r.top;
    if (!dropLine) {
      dropLine = document.createElement('div');
      dropLine.className = 'tbl-drop-line';
      document.body.appendChild(dropLine);
    }
    dropLine.style.top = `${y - 1}px`;
    dropLine.style.left = `${r.left}px`;
    dropLine.style.width = `${r.width}px`;
  }

  function hideDropLine(): void {
    if (dropLine) { dropLine.remove(); dropLine = null; }
  }

  function onMove(e: MouseEvent): void {
    if (!dragSrc) return;
    if (!moved) {
      if (Math.hypot(e.clientX - dragSrc.startX, e.clientY - dragSrc.startY) < DRAG_THRESHOLD_PX) return;
      moved = true;
      if (canDragRow(dragSrc.ctx.isHeader)) {
        grip.classList.add('tbl-row-handle-dragging');
        document.body.style.cursor = 'grabbing';
      }
    }
    // Header rows can't be reordered — no drop line, no move.
    if (!canDragRow(dragSrc.ctx.isHeader) || !activeRow) return;
    e.preventDefault();
    const rows = rowsOf(activeRow);
    const insertIdx = dropIndexAt(e.clientY, rows);
    if (insertIdx == null) { hideDropLine(); return; }
    if (insertIdx === dragSrc.ctx.rowIdx || insertIdx === dragSrc.ctx.rowIdx + 1) { hideDropLine(); return; }
    showDropLine(insertIdx, rows);
  }

  function onUp(e: MouseEvent): void {
    const src = dragSrc;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    dragSrc = null;
    grip.classList.remove('tbl-row-handle-dragging');
    document.body.style.cursor = '';
    hideDropLine();
    if (!src) return;
    // No movement past the threshold → a click → open the row menu.
    if (!moved) { openRowMenu(src.ctx); return; }
    // A dragged header is a no-op (it can't be reordered).
    if (!canDragRow(src.ctx.isHeader) || !activeRow) return;
    const rows = rowsOf(activeRow);
    const insertIdx = dropIndexAt(e.clientY, rows);
    if (insertIdx == null) return;
    // Recompute the table location fresh at drop time.
    const fresh = rowCtxFor(activeRow);
    if (!fresh) return;
    moveRow(editor, fresh.loc, src.ctx.rowIdx, insertIdx);
  }

  grip.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !activeRow) return;
    e.preventDefault();
    e.stopPropagation();
    const ctx = rowCtxFor(activeRow);
    if (!ctx) return;
    moved = false;
    dragSrc = { ctx, startX: e.clientX, startY: e.clientY };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  });

  function openRowMenu(ctx: RowCtx): void {
    const tr = activeRow;
    const kinds = rowMenuModel({ isHeader: ctx.isHeader });

    const run = (fn: (loc: TableLoc, rowIdx: number) => void): void => {
      if (!tr) return;
      const fresh = rowCtxFor(tr);
      if (!fresh) return;
      fn(fresh.loc, fresh.rowIdx);
    };

    const make = (kind: RowMenuItemKind) => ({
      icon: RM_ICON[kind],
      label: ROW_MENU_LABEL[kind],
      variant: kind === 'delete' ? ('danger' as const) : undefined,
      onSelect: () => {
        switch (kind) {
          case 'insert-above': run((loc, i) => insertRowRelative(editor, loc, i, 'above')); break;
          case 'insert-below': run((loc, i) => insertRowRelative(editor, loc, i, 'below')); break;
          case 'duplicate':    run((loc, i) => duplicateRow(editor, loc, i)); break;
          case 'delete':       run((loc, i) => deleteRowAt(editor, loc, i)); break;
        }
      },
    });

    // Group: inserts together, duplicate, then delete (danger) — mirrors c36.
    const sections: MenuSection[] = [];
    const inserts = kinds.filter(k => k === 'insert-above' || k === 'insert-below').map(make);
    if (inserts.length) sections.push({ items: inserts });
    if (kinds.includes('duplicate')) sections.push({ items: [make('duplicate')] });
    if (kinds.includes('delete')) sections.push({ items: [make('delete')] });

    menu.open(grip, sections);
  }

  // Teardown — used when the editor is recreated (document switch) and by tests.
  return () => {
    document.removeEventListener('mousemove', onDocMouseMove);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    hideDropLine();
    menu.close();
    grip.remove();
    document.body.classList.remove('tbl-row-active');
  };
}
