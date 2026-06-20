// c46 — regular markdown tables rendered through a NodeView so a rail can hug
// the table's left edge (reachable row grip) without changing the content
// model. contentDOM is the real <tbody>, so markdown round-trip is unchanged.
//
// The rail hosts one reused grip positioned at the hovered row. Click → select
// the whole row (native CellSelection) + open the row menu; drag → reorder the
// row (manual mouse drag — PM intercepts HTML5 dragstart; the drop line lives
// on document.body so a mutation inside the NodeView doesn't tear the drag
// down). Row mutations reuse the tested tableRowOps + tableRowTx modules.
import Table from '@tiptap/extension-table';
import { mergeAttributes } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createGripIcon } from './handleIcons';
import { createMenu, type MenuSection } from './menu';
import { rowMenuModel, canDragRow, ROW_MENU_LABEL, type RowMenuItemKind } from './tableRowOps';
import {
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

/** Resolved positions of the first and last cell of row `idx`, as required by
 *  CellSelection (each position's nodeAfter is the cell). */
function rowCellRange(
  table: PMNode,
  tablePos: number,
  idx: number,
): { anchorPos: number; headPos: number } | null {
  const row = table.maybeChild(idx);
  if (!row || row.childCount === 0) return null;
  let rowStart = tablePos + 1;
  for (let i = 0; i < idx; i++) rowStart += table.child(i).nodeSize;
  const anchorPos = rowStart + 1; // before the first cell
  let headPos = anchorPos;
  for (let i = 0; i < row.childCount - 1; i++) headPos += row.child(i).nodeSize;
  return { anchorPos, headPos };
}

export const TableWithRail = Table.extend({
  addNodeView() {
    return ({ editor, getPos, HTMLAttributes }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'mp-table';

      const rail = document.createElement('div');
      rail.className = 'mp-table-rail';
      rail.contentEditable = 'false';
      rail.setAttribute('aria-hidden', 'true');

      const grip = document.createElement('div');
      grip.className = 'mp-table-rail-grip';
      grip.style.display = 'none';
      grip.appendChild(createGripIcon());
      rail.appendChild(grip);

      const table = document.createElement('table');
      const attrs = mergeAttributes(HTMLAttributes);
      for (const [k, v] of Object.entries(attrs)) {
        if (v != null) table.setAttribute(k, String(v));
      }
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);

      wrapper.appendChild(rail);
      wrapper.appendChild(table);

      const menu = createMenu({ className: 'mp-table-row-menu' });
      let activeTr: HTMLTableRowElement | null = null;
      let dragSrc: { rowIdx: number; isHeader: boolean; startX: number; startY: number } | null = null;
      let moved = false;
      let dropLine: HTMLDivElement | null = null;

      // ---- hover / positioning ----------------------------------------------

      // Resolve the row under the pointer. Over a cell → its <tr>; over the rail
      // → hit-test row rects by Y (the rail has no cells of its own).
      function resolveRow(target: Element | null, clientY: number): HTMLTableRowElement | null {
        const direct = target?.closest('tr') as HTMLTableRowElement | null;
        if (direct && tbody.contains(direct)) return direct;
        for (const tr of Array.from(tbody.children) as HTMLTableRowElement[]) {
          const r = tr.getBoundingClientRect();
          if (clientY >= r.top && clientY <= r.bottom) return tr;
        }
        return null;
      }

      function positionGrip(tr: HTMLTableRowElement): void {
        const railRect = rail.getBoundingClientRect();
        const r = tr.getBoundingClientRect();
        const gh = grip.offsetHeight || 22;
        grip.style.top = `${r.top - railRect.top + r.height / 2 - gh / 2}px`;
      }

      function onWrapperMove(e: MouseEvent): void {
        if (dragSrc) return;
        if (editor.isDestroyed || !editor.isEditable) { grip.style.display = 'none'; activeTr = null; return; }
        const tr = resolveRow(e.target as Element | null, e.clientY);
        if (!tr) { grip.style.display = 'none'; activeTr = null; return; }
        activeTr = tr;
        grip.style.display = 'flex';
        positionGrip(tr);
      }
      wrapper.addEventListener('mousemove', onWrapperMove);
      wrapper.addEventListener('mouseleave', () => {
        if (!dragSrc) { grip.style.display = 'none'; activeTr = null; }
      });

      // ---- shared helpers ---------------------------------------------------

      function loc(): TableLoc | null {
        const tablePos = getPos?.();
        if (typeof tablePos !== 'number') return null;
        const node = editor.state.doc.nodeAt(tablePos);
        if (!node || node.type.name !== 'table') return null;
        return { tablePos, node };
      }

      function currentRowIdx(): { rowIdx: number; isHeader: boolean } | null {
        if (!activeTr) return null;
        const rowIdx = Array.from(tbody.children).indexOf(activeTr);
        if (rowIdx < 0) return null;
        return { rowIdx, isHeader: !!activeTr.querySelector('th') };
      }

      // ---- click → select row + menu ----------------------------------------

      function selectRow(rowIdx: number): void {
        const l = loc(); if (!l) return;
        const range = rowCellRange(l.node, l.tablePos, rowIdx);
        if (!range) return;
        const { doc } = editor.state;
        const sel = new CellSelection(doc.resolve(range.anchorPos), doc.resolve(range.headPos));
        editor.view.dispatch(editor.state.tr.setSelection(sel));
      }

      function openMenu(rowIdx: number, isHeader: boolean): void {
        const kinds = rowMenuModel({ isHeader });
        const run = (fn: (l: TableLoc, i: number) => void): void => {
          const l = loc(); if (!l) return; fn(l, rowIdx);
        };
        const make = (kind: RowMenuItemKind) => ({
          icon: RM_ICON[kind],
          label: ROW_MENU_LABEL[kind],
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
        menu.open(grip, sections);
      }

      // ---- drag → reorder ---------------------------------------------------

      function hideDropLine(): void { if (dropLine) { dropLine.remove(); dropLine = null; } }

      // Insert index (row-array terms) for a pointer Y over the table body.
      function dropIndexAt(clientY: number): number | null {
        const rows = Array.from(tbody.children) as HTMLTableRowElement[];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].getBoundingClientRect();
          if (clientY >= r.top && clientY <= r.bottom) return clientY < r.top + r.height / 2 ? i : i + 1;
        }
        if (rows.length) return clientY < rows[0].getBoundingClientRect().top ? 0 : rows.length;
        return null;
      }

      function showDropLine(insertIdx: number): void {
        const rows = Array.from(tbody.children) as HTMLTableRowElement[];
        const idx = Math.max(1, Math.min(insertIdx, rows.length)); // never above the header
        const ref = rows[idx] ?? rows[rows.length - 1];
        const r = ref.getBoundingClientRect();
        const y = idx >= rows.length ? r.bottom : r.top;
        if (!dropLine) {
          dropLine = document.createElement('div');
          dropLine.className = 'mp-table-drop-line';
          document.body.appendChild(dropLine);
        }
        dropLine.style.top = `${y - 1}px`;
        dropLine.style.left = `${r.left}px`;
        dropLine.style.width = `${r.width}px`;
      }

      function onGripMove(e: MouseEvent): void {
        if (!dragSrc) return;
        if (!moved) {
          if (Math.hypot(e.clientX - dragSrc.startX, e.clientY - dragSrc.startY) < DRAG_THRESHOLD_PX) return;
          moved = true;
          if (canDragRow(dragSrc.isHeader)) {
            grip.classList.add('mp-table-rail-grip-dragging');
            document.body.style.cursor = 'grabbing';
          }
        }
        if (!canDragRow(dragSrc.isHeader)) return; // header can't be reordered
        e.preventDefault();
        const insertIdx = dropIndexAt(e.clientY);
        if (insertIdx == null || insertIdx === dragSrc.rowIdx || insertIdx === dragSrc.rowIdx + 1) { hideDropLine(); return; }
        showDropLine(insertIdx);
      }

      function onGripUp(e: MouseEvent): void {
        document.removeEventListener('mousemove', onGripMove, true);
        document.removeEventListener('mouseup', onGripUp, true);
        const src = dragSrc; dragSrc = null;
        grip.classList.remove('mp-table-rail-grip-dragging');
        document.body.style.cursor = '';
        hideDropLine();
        if (!src) return;
        if (!moved) { selectRow(src.rowIdx); openMenu(src.rowIdx, src.isHeader); return; }
        if (!canDragRow(src.isHeader)) return; // a dragged header is a no-op
        const insertIdx = dropIndexAt(e.clientY);
        if (insertIdx == null) return;
        const l = loc(); if (!l) return;
        moveRow(editor, l, src.rowIdx, insertIdx);
      }

      grip.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const info = currentRowIdx();
        if (!info) return;
        e.preventDefault();
        e.stopPropagation();
        moved = false;
        dragSrc = { ...info, startX: e.clientX, startY: e.clientY };
        document.addEventListener('mousemove', onGripMove, true);
        document.addEventListener('mouseup', onGripUp, true);
      });

      return {
        dom: wrapper,
        contentDOM: tbody,
        ignoreMutation(mutation) {
          const t = mutation.target as Node;
          // Keep rail chrome mutations out of ProseMirror.
          return t === rail || rail.contains(t);
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
