// c46 — regular markdown tables rendered through a NodeView so Notion-style
// edge handles can hug the table without changing the content model. contentDOM
// is the real <tbody>, so markdown round-trip is unchanged.
//
// Cell-driven, like Notion. Hovering a cell shows a thin stroke hint on the
// table's left edge (that row) and top edge (that column). Drifting toward an
// edge — a forgiving ~24px band, no precision needed — promotes the hint into a
// ⠿ grip that emerges centered on the stroke (top grip's dots rotated, since it
// drags horizontally). Click a grip → select that row/column + open its menu;
// drag → reorder. Manual mouse drag (PM intercepts HTML5 dragstart); drop lines
// live on document.body. Row/column mutations reuse the tested tableRowTx /
// tableColTx modules. The margin block handle still moves the whole table.
import Table from '@tiptap/extension-table';
import { mergeAttributes } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createGripIcon } from './handleIcons';
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
const BAND = 24;     // forgiving distance from an edge that summons the grip
const EDGE_IN = 8;   // how far the band reaches into the table
const PAD = 9;       // stroke padding (so a stroke never spans the full row/col)
const ROW_MAX = 28;  // cap on the row stroke length
const COL_MAX = 96;  // cap on the column stroke length
const RGRIP_W = 16, RGRIP_H = 24;
const CGRIP_W = 24, CGRIP_H = 16;

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

      const rowStroke = mkEl('mp-table-row-stroke mp-table-stroke');
      const colStroke = mkEl('mp-table-col-stroke mp-table-stroke');
      const rowGrip = mkEl('mp-table-row-grip mp-table-grip');
      const colGrip = mkEl('mp-table-col-grip mp-table-grip');
      rowGrip.appendChild(createGripIcon());
      colGrip.appendChild(createGripIcon());

      // One outline box drawn over the selected cell / row / column (blue
      // strokes on the edges, like the board — never a fill).
      const selBox = mkEl('mp-table-sel-box');

      const table = document.createElement('table');
      const attrs = mergeAttributes(HTMLAttributes);
      for (const [k, v] of Object.entries(attrs)) {
        if (v != null) table.setAttribute(k, String(v));
      }
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);

      wrapper.append(rowStroke, colStroke, rowGrip, colGrip, selBox, table);

      function mkEl(cls: string): HTMLDivElement {
        const el = document.createElement('div');
        el.className = cls;
        el.style.display = 'none';
        el.contentEditable = 'false';
        return el;
      }

      const menu = createMenu({ className: 'mp-table-menu' });
      let activeRow: { idx: number; isHeader: boolean } | null = null;
      let activeCol: { idx: number } | null = null;
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
      function hideAll(): void {
        rowStroke.style.display = colStroke.style.display = 'none';
        rowGrip.style.display = colGrip.style.display = 'none';
      }

      // ---- selection outline box (cell / row / column) ---------------------
      function hideSelBox(): void { selBox.style.display = 'none'; }
      function showSelBoxOver(cells: HTMLElement[]): void {
        if (!cells.length) { hideSelBox(); return; }
        const w = wrapper.getBoundingClientRect();
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        for (const c of cells) {
          const x = c.getBoundingClientRect();
          l = Math.min(l, x.left); t = Math.min(t, x.top);
          r = Math.max(r, x.right); b = Math.max(b, x.bottom);
        }
        selBox.style.left = `${l - w.left - 1}px`;
        selBox.style.top = `${t - w.top - 1}px`;
        selBox.style.width = `${r - l + 2}px`;
        selBox.style.height = `${b - t + 2}px`;
        selBox.style.display = 'block';
      }
      function onSelUpdate(): void {
        if (editor.isDestroyed) return;
        const l = loc(); if (!l) { hideSelBox(); return; }
        const sel = editor.state.selection;
        const within = sel.$from.pos >= l.tablePos && sel.$to.pos <= l.tablePos + l.node.nodeSize;
        if (!within) { hideSelBox(); return; }
        const cells: HTMLElement[] = [];
        if (sel instanceof CellSelection) {
          sel.forEachCell((_node, pos) => {
            const dom = editor.view.nodeDOM(pos);
            if (dom instanceof HTMLElement) cells.push(dom);
          });
        } else {
          const $f = sel.$from;
          for (let d = $f.depth; d > 0; d--) {
            const node = $f.node(d);
            if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
              const dom = editor.view.nodeDOM($f.before(d));
              if (dom instanceof HTMLElement) cells.push(dom);
              break;
            }
          }
        }
        showSelBoxOver(cells);
      }
      editor.on('selectionUpdate', onSelUpdate);

      // ---- hover (document-level, for the forgiving edge band) --------------
      function rowAt(y: number): { tr: HTMLElement; idx: number } | null {
        const trs = Array.from(tbody.children) as HTMLElement[];
        for (let i = 0; i < trs.length; i++) {
          const r = trs[i].getBoundingClientRect();
          if (y >= r.top && y <= r.bottom) return { tr: trs[i], idx: i };
        }
        return null;
      }
      function headerCellAt(x: number): { idx: number; rect: DOMRect } | null {
        const first = tbody.children[0] as HTMLElement | undefined;
        if (!first) return null;
        const cells = Array.from(first.children) as HTMLElement[];
        for (let i = 0; i < cells.length; i++) {
          const r = cells[i].getBoundingClientRect();
          if (x >= r.left && x <= r.right) return { idx: i, rect: r };
        }
        return null;
      }

      function onDocMove(e: MouseEvent): void {
        if (dragSrc) return;
        if (editor.isDestroyed || !editor.isEditable) { hideAll(); return; }
        const x = e.clientX, y = e.clientY;
        const t = table.getBoundingClientRect();
        const w = wrapper.getBoundingClientRect();
        const near = x >= t.left - BAND && x <= t.right + 6 && y >= t.top - BAND && y <= t.bottom + 6;
        // Identify the cell precisely when the pointer is over one; otherwise
        // (in the gutter band) locate the row/column by geometry.
        const cell = (e.target as Element | null)?.closest?.('td, th') as HTMLTableCellElement | null;
        const overCell = !!cell && tbody.contains(cell);
        if (!overCell && !near) { hideAll(); return; }

        // ----- row (left edge) -----
        let rowTr: HTMLElement | null = null;
        let rowIdx = -1;
        if (overCell) {
          rowTr = cell!.closest('tr') as HTMLElement | null;
          rowIdx = rowTr ? Array.from(tbody.children).indexOf(rowTr) : -1;
        } else {
          const r = rowAt(y);
          if (r) { rowTr = r.tr; rowIdx = r.idx; }
        }
        if (rowTr && rowIdx >= 0) {
          placeRow(rowTr, w);
          const nearLeft = x <= t.left + EDGE_IN;
          rowGrip.style.display = nearLeft ? 'grid' : 'none';
          rowStroke.style.display = nearLeft ? 'none' : 'block';
          activeRow = { idx: rowIdx, isHeader: !!rowTr.querySelector('th') || (cell?.tagName === 'TH') };
        } else { rowStroke.style.display = 'none'; rowGrip.style.display = 'none'; }

        // ----- column (top edge) -----
        let colRect: DOMRect | null = null;
        let colIdx = -1;
        if (overCell) { colRect = cell!.getBoundingClientRect(); colIdx = cell!.cellIndex; }
        else { const c = headerCellAt(x); if (c) { colRect = c.rect; colIdx = c.idx; } }
        if (colRect && colIdx >= 0) {
          placeCol(colRect, w, t);
          const nearTop = y <= t.top + EDGE_IN;
          colGrip.style.display = nearTop ? 'grid' : 'none';
          colStroke.style.display = nearTop ? 'none' : 'block';
          activeCol = { idx: colIdx };
        } else { colStroke.style.display = 'none'; colGrip.style.display = 'none'; }
      }

      function placeRow(tr: HTMLElement, w: DOMRect): void {
        const r = tr.getBoundingClientRect();
        const len = Math.min(r.height - 2 * PAD, ROW_MAX);
        rowStroke.style.left = `${r.left - w.left}px`;
        rowStroke.style.top = `${r.top - w.top + (r.height - Math.max(8, len)) / 2}px`;
        rowStroke.style.height = `${Math.max(8, len)}px`;
        rowGrip.style.left = `${r.left - w.left - 9}px`;                 // -1 to centre on the stroke
        rowGrip.style.top = `${r.top - w.top + r.height / 2 - RGRIP_H / 2 - 1}px`;
      }
      function placeCol(c: DOMRect, w: DOMRect, t: DOMRect): void {
        const len = Math.min(c.width - 2 * PAD, COL_MAX);
        colStroke.style.top = `${t.top - w.top}px`;
        colStroke.style.left = `${c.left - w.left + (c.width - Math.max(8, len)) / 2}px`;
        colStroke.style.width = `${Math.max(8, len)}px`;
        colGrip.style.top = `${t.top - w.top - 9}px`;                   // -1 to centre on the stroke
        colGrip.style.left = `${c.left - w.left + c.width / 2 - CGRIP_W / 2 - 1}px`;
      }
      document.addEventListener('mousemove', onDocMove);

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
        menu.open(rowGrip, sections);
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
        menu.open(colGrip, sections);
      }

      // ---- drag (rows + columns) -------------------------------------------
      function hideDropLine(): void { if (dropLine) { dropLine.remove(); dropLine = null; } }
      function ensureDropLine(cls: string): HTMLDivElement {
        if (!dropLine) { dropLine = document.createElement('div'); document.body.appendChild(dropLine); }
        dropLine.className = cls;
        return dropLine;
      }
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
        const el = ensureDropLine('mp-table-drop-line');
        el.style.top = `${y - 1}px`; el.style.left = `${r.left}px`; el.style.width = `${r.width}px`; el.style.height = '2px';
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
        const el = ensureDropLine('mp-table-drop-line mp-table-drop-line-v');
        el.style.left = `${x - 1}px`; el.style.top = `${tRect.top}px`; el.style.height = `${tRect.height}px`; el.style.width = '2px';
      }

      function onGripMove(e: MouseEvent): void {
        if (!dragSrc) return;
        if (!moved) {
          if (Math.hypot(e.clientX - dragSrc.startX, e.clientY - dragSrc.startY) < DRAG_THRESHOLD_PX) return;
          moved = true;
          const draggable = dragSrc.axis === 'col' || canDragRow(dragSrc.isHeader);
          if (draggable) document.body.style.cursor = 'grabbing';
          (dragSrc.axis === 'row' ? rowGrip : colGrip).classList.add('mp-table-grip-dragging');
        }
        if (dragSrc.axis === 'row') {
          if (!canDragRow(dragSrc.isHeader)) return;
          e.preventDefault();
          const i = rowDropIndexAt(e.clientY);
          if (i == null || i === dragSrc.idx || i === dragSrc.idx + 1) { hideDropLine(); return; }
          showRowDropLine(i);
        } else {
          e.preventDefault();
          const i = colDropIndexAt(e.clientX);
          if (i == null || i === dragSrc.idx || i === dragSrc.idx + 1) { hideDropLine(); return; }
          showColDropLine(i);
        }
      }
      function onGripUp(e: MouseEvent): void {
        document.removeEventListener('mousemove', onGripMove, true);
        document.removeEventListener('mouseup', onGripUp, true);
        const src = dragSrc; dragSrc = null;
        rowGrip.classList.remove('mp-table-grip-dragging');
        colGrip.classList.remove('mp-table-grip-dragging');
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
          const i = rowDropIndexAt(e.clientY);
          if (i != null) moveRow(editor, l, src.idx, i);
        } else {
          const i = colDropIndexAt(e.clientX);
          if (i != null) moveColumn(editor, l, src.idx, i);
        }
      }

      function beginDrag(axis: 'row' | 'col', e: MouseEvent): void {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        moved = false;
        if (axis === 'row') {
          if (!activeRow) return;
          dragSrc = { axis: 'row', idx: activeRow.idx, isHeader: activeRow.isHeader, startX: e.clientX, startY: e.clientY };
        } else {
          if (!activeCol) return;
          dragSrc = { axis: 'col', idx: activeCol.idx, startX: e.clientX, startY: e.clientY };
        }
        document.addEventListener('mousemove', onGripMove, true);
        document.addEventListener('mouseup', onGripUp, true);
      }
      rowGrip.addEventListener('mousedown', (e) => beginDrag('row', e));
      colGrip.addEventListener('mousedown', (e) => beginDrag('col', e));

      return {
        dom: wrapper,
        contentDOM: tbody,
        ignoreMutation(mutation) {
          // All of our chrome lives in the wrapper but outside contentDOM; its
          // style/position mutations must NOT make ProseMirror redraw the node
          // (a redraw would reset the selection box and the handles). The drop
          // line lives on document.body, so it's never seen here.
          const t = mutation.target as Node;
          for (const el of [rowStroke, colStroke, rowGrip, colGrip, selBox]) {
            if (t === el || el.contains(t)) return true;
          }
          return false;
        },
        destroy() {
          editor.off('selectionUpdate', onSelUpdate);
          document.removeEventListener('mousemove', onDocMove);
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
