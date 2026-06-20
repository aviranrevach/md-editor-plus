// c46 — ProseMirror transaction helpers for the table COLUMN handle. Mirrors
// tableRowTx: insert/delete delegate to TipTap's column commands (which mint
// cells correctly); move/duplicate rebuild every row's cell list (the codeBlock
// "replace the whole node" approach), so serialization stays clean. Tables here
// are rectangular (markdown has no colspan), so a column index is valid in
// every row.
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { Node as PMNode } from '@tiptap/pm/model';
import { reorderColumns } from './tableColOps';
import type { TableLoc } from './tableRowTx';

/** Number of columns (cells in the first row). */
export function columnCount(table: PMNode): number {
  const first = table.maybeChild(0);
  return first ? first.childCount : 0;
}

/** Document position just before the cell at (rowIdx, colIdx). */
function cellPos(table: PMNode, tablePos: number, rowIdx: number, colIdx: number): number | null {
  const row = table.maybeChild(rowIdx);
  if (!row || colIdx >= row.childCount) return null;
  let rowStart = tablePos + 1;
  for (let i = 0; i < rowIdx; i++) rowStart += table.child(i).nodeSize;
  let pos = rowStart + 1; // step into the row, before the first cell
  for (let c = 0; c < colIdx; c++) pos += row.child(c).nodeSize;
  return pos;
}

/** Put a text selection inside a cell of column `colIdx` so the column commands
 *  resolve that column. Returns false if the column can't be located. */
function selectColForCommand(editor: Editor, loc: TableLoc, colIdx: number): boolean {
  const pos = cellPos(loc.node, loc.tablePos, 0, colIdx);
  if (pos == null) return false;
  const { doc } = editor.state;
  const sel = TextSelection.near(doc.resolve(Math.min(pos + 1, doc.content.size)));
  editor.view.dispatch(editor.state.tr.setSelection(sel));
  return true;
}

/** Select the whole column as a native CellSelection (cells highlight). */
export function selectColumn(editor: Editor, loc: TableLoc, colIdx: number): void {
  const anchor = cellPos(loc.node, loc.tablePos, 0, colIdx);
  const head = cellPos(loc.node, loc.tablePos, loc.node.childCount - 1, colIdx);
  if (anchor == null || head == null) return;
  const { doc } = editor.state;
  editor.view.dispatch(
    editor.state.tr.setSelection(new CellSelection(doc.resolve(anchor), doc.resolve(head))),
  );
}

/** Add a blank column left/right of `colIdx` via TipTap's column commands. */
export function insertColumnRelative(
  editor: Editor,
  loc: TableLoc,
  colIdx: number,
  where: 'left' | 'right',
): void {
  if (!selectColForCommand(editor, loc, colIdx)) return;
  if (where === 'left') editor.commands.addColumnBefore();
  else editor.commands.addColumnAfter();
}

/** Delete column `colIdx`. Refuses when it is the only column. */
export function deleteColumnAt(editor: Editor, loc: TableLoc, colIdx: number): void {
  if (columnCount(loc.node) <= 1) return;
  if (!selectColForCommand(editor, loc, colIdx)) return;
  editor.commands.deleteColumn();
}

/** Insert a copy of column `colIdx` directly to its right (every row). */
export function duplicateColumn(editor: Editor, loc: TableLoc, colIdx: number): void {
  const fresh = editor.state.doc.nodeAt(loc.tablePos);
  if (!fresh || fresh.type.name !== 'table') return;
  const rows: PMNode[] = [];
  fresh.forEach((row) => {
    const cells: PMNode[] = [];
    row.forEach((c) => cells.push(c));
    if (colIdx < cells.length) cells.splice(colIdx + 1, 0, cells[colIdx]); // immutable reuse
    rows.push(row.type.create(row.attrs, cells));
  });
  const newTable = fresh.type.create(fresh.attrs, rows);
  editor.view.dispatch(editor.state.tr.replaceWith(loc.tablePos, loc.tablePos + fresh.nodeSize, newTable));
}

/** Reorder column `fromCol` to `toCol` (rebuilds every row's cell list). */
export function moveColumn(editor: Editor, loc: TableLoc, fromCol: number, toCol: number): void {
  const fresh = editor.state.doc.nodeAt(loc.tablePos);
  if (!fresh || fresh.type.name !== 'table') return;
  const rows: PMNode[] = [];
  let changed = false;
  fresh.forEach((row) => {
    const cells: PMNode[] = [];
    row.forEach((c) => cells.push(c));
    const next = reorderColumns(cells, fromCol, toCol);
    if (next.some((c, i) => c !== cells[i])) changed = true;
    rows.push(row.type.create(row.attrs, next));
  });
  if (!changed) return;
  const newTable = fresh.type.create(fresh.attrs, rows);
  editor.view.dispatch(editor.state.tr.replaceWith(loc.tablePos, loc.tablePos + fresh.nodeSize, newTable));
}
