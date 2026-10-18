// c46 — ProseMirror transaction helpers for the regular-table row handle.
//
// These never replace the Table NodeView or change how tables render; they
// only re-arrange / add / remove `tableRow` nodes via transactions. Move and
// duplicate rebuild the table's row sequence (the codeBlock "replace the whole
// node" approach, which keeps serialization clean); insert and delete delegate
// to TipTap's own addRowBefore/addRowAfter/deleteRow commands so empty cells
// are minted to match the column count.
//
// The header row (index 0 / cells of type `tableHeader`) is structural: it
// stays first and present, so move/duplicate/delete/insert-above refuse to act
// on it. Those guards are belt-and-suspenders to the menu model in
// tableRowOps — the menu never offers the forbidden actions, but the tx layer
// enforces them too.

import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { reorderRows, HEADER_ROW_COUNT } from './tableRowOps';

export interface TableLoc { tablePos: number; node: PMNode; }

/** Walk up from a document position to the enclosing `table` node. */
export function findTableAround(doc: PMNode, pos: number): TableLoc | null {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'table') return { tablePos: $pos.before(d), node };
  }
  return null;
}

/** First table in the document, if any (used as a fallback / by tests). */
export function findFirstTable(doc: PMNode): TableLoc | null {
  let res: TableLoc | null = null;
  doc.descendants((node, pos) => {
    if (res) return false;
    if (node.type.name === 'table') { res = { tablePos: pos, node }; return false; }
    return true;
  });
  return res;
}

function rowNodes(table: PMNode): PMNode[] {
  const rows: PMNode[] = [];
  table.forEach(r => rows.push(r));
  return rows;
}

/** A row is the header row when any of its cells is a `tableHeader`. */
export function isHeaderRow(table: PMNode, idx: number): boolean {
  const row = table.maybeChild(idx);
  if (!row) return false;
  let header = false;
  row.forEach(cell => { if (cell.type.name === 'tableHeader') header = true; });
  return header;
}

/** Document position just inside row `idx` (Selection.near refines it into the
 *  first cell's text so the table commands resolve a cell). */
function posInRow(table: PMNode, tablePos: number, idx: number): number {
  let rowStart = tablePos + 1; // step past the table's opening token
  for (let i = 0; i < idx && i < table.childCount; i++) rowStart += table.child(i).nodeSize;
  return rowStart + 1; // step into the row
}

function selectRow(editor: Editor, loc: TableLoc, idx: number): void {
  const { doc } = editor.state;
  const target = Math.min(posInRow(loc.node, loc.tablePos, idx), doc.content.size);
  const sel = TextSelection.near(doc.resolve(target));
  editor.view.dispatch(editor.state.tr.setSelection(sel));
}

function replaceTableRows(editor: Editor, tablePos: number, rows: PMNode[]): void {
  const fresh = editor.state.doc.nodeAt(tablePos);
  if (!fresh || fresh.type.name !== 'table') return;
  const newTable = fresh.type.create(fresh.attrs, rows);
  editor.view.dispatch(
    editor.state.tr.replaceWith(tablePos, tablePos + fresh.nodeSize, newTable),
  );
}

function sameOrder(a: PMNode[], b: PMNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Reorder a row within the table. The header row stays first (enforced by
 *  reorderRows' clamping). No-op when nothing actually moves. */
export function moveRow(editor: Editor, loc: TableLoc, fromIdx: number, toIdx: number): void {
  const rows = rowNodes(loc.node);
  const next = reorderRows(rows, fromIdx, toIdx, HEADER_ROW_COUNT);
  if (sameOrder(rows, next)) return;
  replaceTableRows(editor, loc.tablePos, next);
}

/** Insert a clone of row `idx` directly below it. Refuses the header row. */
export function duplicateRow(editor: Editor, loc: TableLoc, idx: number): void {
  if (idx < HEADER_ROW_COUNT) return;
  const rows = rowNodes(loc.node);
  if (idx < 0 || idx >= rows.length) return;
  const next = rows.slice();
  next.splice(idx + 1, 0, rows[idx]); // PM nodes are immutable — reuse is safe
  replaceTableRows(editor, loc.tablePos, next);
}

/** Add a blank row above/below row `idx` via TipTap's table commands (which
 *  create cells matching the column count). insert-above refuses the header. */
export function insertRowRelative(
  editor: Editor,
  loc: TableLoc,
  idx: number,
  where: 'above' | 'below',
): void {
  if (where === 'above' && idx < HEADER_ROW_COUNT) return;
  selectRow(editor, loc, idx);
  if (where === 'above') editor.commands.addRowBefore();
  else editor.commands.addRowAfter();
}

/** Delete row `idx`. Refuses the header row (a table needs its header). */
export function deleteRowAt(editor: Editor, loc: TableLoc, idx: number): void {
  if (idx < HEADER_ROW_COUNT) return;
  selectRow(editor, loc, idx);
  editor.commands.deleteRow();
}
