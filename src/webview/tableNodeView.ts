// c46 — regular markdown tables rendered through a NodeView so Notion-style
// edge handles can hug the table without changing the content model. contentDOM
// is the real <tbody>, so markdown round-trip is unchanged.
//
// Cell-driven, like Notion: hovering a cell reveals that cell's ROW handle (a
// thin stroke on the table's left outer edge, aligned to the row) and COLUMN
// handle (a thin stroke on the top outer edge, aligned to the column). Each
// stroke darkens on direct hover. Click a stroke → select that row/column +
// open its menu; drag → reorder. Manual mouse drag (PM intercepts HTML5
// dragstart); drop lines live on document.body. Row/column mutations reuse the
// tested tableRowTx / tableColTx modules. The margin block handle still moves
// the whole table.
import Table from '@tiptap/extension-table';
import { mergeAttributes } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createMenu, type MenuSection } from './menu';
import { rowMenuModel, canDragRow, ROW_MENU_LABEL, type RowMenuItemKind } from './tableRowOps';
import { colMenuModel, COL_MENU_LABEL, type ColMenuItemKind } from './tableColOps';
import {
  moveRow, duplicateRow, insertRowRelative, deleteRowAt, type TableLoc,
} from './tableRowTx';
import {
  columnCount, selectColumn, moveColumn, duplicateColumn, insertColumnRelative, deleteColumnAt,
} from './tableColTx';

const DRAG_THRESHOLD_PX = 4;

const RM_ICON: Record<RowMenuItemKind, string> = {
  'insert-above': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  'insert-below': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
  'duplicate': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>',
  'delete': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>',
};
const CM_ICON: Record<ColMenuItemKind, string> = {
  'insert-left': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>',
  'insert-right': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
  'duplicate': RM_ICON.duplicate,
  'delete': RM_ICON.delete,
};

/** Resolved positions of the first and last cell of row `idx`, as CellSelection
 *  requires (each position's nodeAfter is the cell). */
function rowCellRange(table: PMNode, tablePos: number, idx: number): { anchorPos: number; headPos: number } | null {
  const row = table.maybeChild(idx);
  if (!row || row.childCount === 0) return null;
  let rowStart = tablePos + 1;
  for (let i = 0; i < idx; i++) rowStart += table.child(i).nodeSize;
  const anchorPos = rowStart + 1;
  let headPos = anchorPos;
  for (let i = 0; i < row.childCount - 1; i++) headPos += row.child(i).nodeSize;
  return { anchorPos, headPos };
}

export const TableWithRail = Table.extend({
  addNodeView() {
    return ({ editor, getPos, HTMLAttributes }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'mp-table';

      const rowHandle = document.createElement('div');
      rowHandle.className = 'mp-table-row-handle';
      rowHandle.style.display = 'none';

      const colHandle = document.createElement('div');
      colHandle.className = 'mp-table-col-handle';
      colHandle.style.display = 'none';

      const table = document.createElement('table');
      const attrs = mergeAttributes(HTMLAttributes);
      for (const [k, v] of Object.entries(attrs)) {
        if (v != null) table.setAttribute(k, String(v));
      }
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);

      wrapper.appendChild(rowHandle);
      wrapper.appendChild(colHandle);
      wrapper.appendChild(table);

      const menu = createMenu({ className: 'mp-table-menu' });
      let activeCell: HTMLTableCellElement | null = null;
      let dragSrc:
        | { axis: 'row'; idx: number; isHeader: boolean; startX: number; startY: number }
        | { axis: 'col'; idx: number; startX: number; startY: number }
        | null = null;
      let moved = false;
      let dropLine: HTMLDivElement | null = null;

      // ---- shared ----------------------------------------------------------
      function loc(): TableLoc | null {
        const tablePos = getPos?.();
        if (typeof tablePos !== 'number') return null;
        const node = editor.state.doc.nodeAt(tablePos);
        if (!node || node.type.name !== 'table') return null;
        return { tablePos, node };
      }
      function rowOf(cell: HTMLTableCellElement): HTMLTableRowElement | null {
        const tr = cell.closest('tr') as HTMLTableRowElement | null;
        return tr && tbody.contains(tr) ? tr : null;
      }
      function hideBars(): void {
        rowHandle.style.display = 'none';
        colHandle.style.display = 'none';
        activeCell = null;
      }

      // ---- hover → position both handles for the active cell ----------------
      function positionHandles(cell: HTMLTableCellElement): void {
        const tr = rowOf(cell);
        if (!tr) return;
        const wRect = wrapper.getBoundingClientRect();
        const rRect = tr.getBoundingClientRect();
        const cRect = cell.getBoundingClientRect();
        rowHandle.style.top = `${rRect.top - wRect.top + 3}px`;
        rowHandle.style.height = `${Math.max(8, rRect.height - 6)}px`;
        rowHandle.style.display = 'block';
        colHandle.style.left = `${cRect.left - wRect.left + 3}px`;
        colHandle.style.width = `${Math.max(8, cRect.width - 6)}px`;
        colHandle.style.display = 'block';
      }

      function onWrapperMove(e: MouseEvent): void {
        if (dragSrc) return;
        if (editor.isDestroyed || !editor.isEditable) { hideBars(); return; }
        const t = e.target as Element | null;
        if (t && (rowHandle.contains(t) || colHandle.contains(t))) return; // stay on the handle
        const cell = t?.closest('td, th') as HTMLTableCellElement | null;
        if (cell && tbody.contains(cell)) { activeCell = cell; positionHandles(cell); return; }
        // Over the gutter padding (not a cell): keep the current handles visible
        // so they stay reachable; only a real mouseleave clears them.
      }
      wrapper.addEventListener('mousemove', onWrapperMove);
      wrapper.addEventListener('mouseleave', () => { if (!dragSrc) hideBars(); });

      // ---- menus -----------------------------------------------------------
      function selectRow(rowIdx: number): void {
        const l = loc(); if (!l) return;
        const range = rowCellRange(l.node, l.tablePos, rowIdx);
        if (!range) return;
        const { doc } = editor.state;
        editor.view.dispatch(
          editor.state.tr.setSelection(new CellSelection(doc.resolve(range.anchorPos), doc.resolve(range.headPos))),
        );
      }

      function openRowMenu(rowIdx: number, isHeader: boolean): void {
        const kinds = rowMenuModel({ isHeader });
        const run = (fn: (l: TableLoc, i: number) => void): void => { const l = loc(); if (l) fn(l, rowIdx); };
        const make = (kind: RowMenuItemKind) => ({
          icon: RM_ICON[kind], label: ROW_MENU_LABEL[kind],
          variant: kind === 'delete' ? ('danger' as const) : undefined,
          onSelect: () => {
            switch (kind) {
              case 'insert-above': run((l, i) => insertRowRelative(editor, l, i, 'above')); break;
              case 'insert-below': run((l, i) => insertRowRelative(editor, l, i, 'below')); break;
              case 'duplicate':    run((l, i) => duplicateRow(editor, l, i)); break;
              case 'delete':       run((l, i) => deleteRowAt(editor, l, i)); break;
            }
          },
        });
        const sections: MenuSection[] = [];
        const inserts = kinds.filter(k => k === 'insert-above' || k === 'insert-below').map(make);
        if (inserts.length) sections.push({ items: inserts });
        if (kinds.includes('duplicate')) sections.push({ items: [make('duplicate')] });
        if (kinds.includes('delete')) sections.push({ items: [make('delete')] });
        menu.open(rowHandle, sections);
      }

      function openColMenu(colIdx: number): void {
        const l = loc(); if (!l) return;
        const kinds = colMenuModel({ isOnly: columnCount(l.node) <= 1 });
        const run = (fn: (l: TableLoc, i: number) => void): void => { const ll = loc(); if (ll) fn(ll, colIdx); };
        const make = (kind: ColMenuItemKind) => ({
          icon: CM_ICON[kind], label: COL_MENU_LABEL[kind],
          variant: kind === 'delete' ? ('danger' as const) : undefined,
          onSelect: () => {
            switch (kind) {
              case 'insert-left':  run((ll, i) => insertColumnRelative(editor, ll, i, 'left')); break;
              case 'insert-right': run((ll, i) => insertColumnRelative(editor, ll, i, 'right')); break;
              case 'duplicate':    run((ll, i) => duplicateColumn(editor, ll, i)); break;
              case 'delete':       run((ll, i) => deleteColumnAt(editor, ll, i)); break;
            }
          },
        });
        const sections: MenuSection[] = [];
        const inserts = kinds.filter(k => k === 'insert-left' || k === 'insert-right').map(make);
        if (inserts.length) sections.push({ items: inserts });
        if (kinds.includes('duplicate')) sections.push({ items: [make('duplicate')] });
        if (kinds.includes('delete')) sections.push({ items: [make('delete')] });
        menu.open(colHandle, sections);
      }

      // ---- drag (rows + columns) -------------------------------------------
      function hideDropLine(): void { if (dropLine) { dropLine.remove(); dropLine = null; } }

      function rowDropIndexAt(clientY: number): number | null {
        const rows = Array.from(tbody.children) as HTMLElement[];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].getBoundingClientRect();
          if (clientY >= r.top && clientY <= r.bottom) return clientY < r.top + r.height / 2 ? i : i + 1;
        }
        if (rows.length) return clientY < rows[0].getBoundingClientRect().top ? 0 : rows.length;
        return null;
      }
      function colDropIndexAt(clientX: number): number | null {
        const first = tbody.children[0] as HTMLElement | undefined;
        if (!first) return null;
        const cells = Array.from(first.children) as HTMLElement[];
        for (let i = 0; i < cells.length; i++) {
          const r = cells[i].getBoundingClientRect();
          if (clientX >= r.left && clientX <= r.right) return clientX < r.left + r.width / 2 ? i : i + 1;
        }
        if (cells.length) return clientX < cells[0].getBoundingClientRect().left ? 0 : cells.length;
        return null;
      }

      function showRowDropLine(insertIdx: number): void {
        const rows = Array.from(tbody.children) as HTMLElement[];
        const idx = Math.max(1, Math.min(insertIdx, rows.length)); // never above the header row
        const ref = rows[idx] ?? rows[rows.length - 1];
        const r = ref.getBoundingClientRect();
        const y = idx >= rows.length ? r.bottom : r.top;
        dropLine = ensureDropLine('mp-table-drop-line');
        dropLine.style.top = `${y - 1}px`;
        dropLine.style.left = `${r.left}px`;
        dropLine.style.width = `${r.width}px`;
        dropLine.style.height = '2px';
      }
      function showColDropLine(insertIdx: number): void {
        const first = tbody.children[0] as HTMLElement | undefined;
        if (!first) return;
        const cells = Array.from(first.children) as HTMLElement[];
        const idx = Math.max(0, Math.min(insertIdx, cells.length));
        const ref = cells[idx] ?? cells[cells.length - 1];
        const r = ref.getBoundingClientRect();
        const x = idx >= cells.length ? r.right : r.left;
        const tRect = table.getBoundingClientRect();
        dropLine = ensureDropLine('mp-table-drop-line mp-table-drop-line-v');
        dropLine.style.left = `${x - 1}px`;
        dropLine.style.top = `${tRect.top}px`;
        dropLine.style.height = `${tRect.height}px`;
        dropLine.style.width = '2px';
      }
      function ensureDropLine(cls: string): HTMLDivElement {
        if (!dropLine) { dropLine = document.createElement('div'); document.body.appendChild(dropLine); }
        dropLine.className = cls;
        return dropLine;
      }

      function onGripMove(e: MouseEvent): void {
        if (!dragSrc) return;
        if (!moved) {
          if (Math.hypot(e.clientX - dragSrc.startX, e.clientY - dragSrc.startY) < DRAG_THRESHOLD_PX) return;
          moved = true;
          const draggable = dragSrc.axis === 'col' || canDragRow(dragSrc.isHeader);
          if (draggable) { document.body.style.cursor = 'grabbing'; }
          (dragSrc.axis === 'row' ? rowHandle : colHandle).classList.add('mp-table-handle-dragging');
        }
        if (dragSrc.axis === 'row') {
          if (!canDragRow(dragSrc.isHeader)) return;
          e.preventDefault();
          const insertIdx = rowDropIndexAt(e.clientY);
          if (insertIdx == null || insertIdx === dragSrc.idx || insertIdx === dragSrc.idx + 1) { hideDropLine(); return; }
          showRowDropLine(insertIdx);
        } else {
          e.preventDefault();
          const insertIdx = colDropIndexAt(e.clientX);
          if (insertIdx == null || insertIdx === dragSrc.idx || insertIdx === dragSrc.idx + 1) { hideDropLine(); return; }
          showColDropLine(insertIdx);
        }
      }

      function onGripUp(e: MouseEvent): void {
        document.removeEventListener('mousemove', onGripMove, true);
        document.removeEventListener('mouseup', onGripUp, true);
        const src = dragSrc; dragSrc = null;
        rowHandle.classList.remove('mp-table-handle-dragging');
        colHandle.classList.remove('mp-table-handle-dragging');
        document.body.style.cursor = '';
        hideDropLine();
        if (!src) return;
        if (!moved) {
          if (src.axis === 'row') { selectRow(src.idx); openRowMenu(src.idx, src.isHeader); }
          else { const l = loc(); if (l) selectColumn(editor, l, src.idx); openColMenu(src.idx); }
          return;
        }
        const l = loc(); if (!l) return;
        if (src.axis === 'row') {
          if (!canDragRow(src.isHeader)) return;
          const insertIdx = rowDropIndexAt(e.clientY);
          if (insertIdx != null) moveRow(editor, l, src.idx, insertIdx);
        } else {
          const insertIdx = colDropIndexAt(e.clientX);
          if (insertIdx != null) moveColumn(editor, l, src.idx, insertIdx);
        }
      }

      function startDrag(axis: 'row' | 'col', e: MouseEvent): void {
        if (e.button !== 0 || !activeCell) return;
        const tr = rowOf(activeCell); if (!tr) return;
        e.preventDefault(); e.stopPropagation();
        moved = false;
        if (axis === 'row') {
          const idx = Array.from(tbody.children).indexOf(tr);
          if (idx < 0) return;
          dragSrc = { axis: 'row', idx, isHeader: !!activeCell.querySelector('th') || activeCell.tagName === 'TH', startX: e.clientX, startY: e.clientY };
        } else {
          dragSrc = { axis: 'col', idx: activeCell.cellIndex, startX: e.clientX, startY: e.clientY };
        }
        document.addEventListener('mousemove', onGripMove, true);
        document.addEventListener('mouseup', onGripUp, true);
      }
      rowHandle.addEventListener('mousedown', (e) => startDrag('row', e));
      colHandle.addEventListener('mousedown', (e) => startDrag('col', e));

      return {
        dom: wrapper,
        contentDOM: tbody,
        ignoreMutation(mutation) {
          const t = mutation.target as Node;
          return rowHandle.contains(t) || colHandle.contains(t) || t === rowHandle || t === colHandle;
        },
        destroy() {
          wrapper.removeEventListener('mousemove', onWrapperMove);
          document.removeEventListener('mousemove', onGripMove, true);
          document.removeEventListener('mouseup', onGripUp, true);
          hideDropLine();
          menu.close();
        },
      };
    };
  },
});

export default TableWithRail;
