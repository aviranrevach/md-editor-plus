import type { Board, ViewDef } from './boardModel';
import { mintCardId } from './boardModel';

function ensureView(board: Board, viewName: string): ViewDef {
  let v = board.views.find(x => x.name === viewName);
  if (!v) {
    v = { name: viewName };
    board.views.push(v);
  }
  return v;
}

/** Drop a view from the array if it now has only the `name` key and nothing else meaningful. */
function pruneView(board: Board, viewName: string): void {
  const idx = board.views.findIndex(x => x.name === viewName);
  if (idx < 0) return;
  const v = board.views[idx];
  const hasColumns = !!v.columns && v.columns.length > 0;
  const hasHidden  = !!v.hidden  && v.hidden.length  > 0;
  const hasWidths  = !!v.widths  && Object.keys(v.widths).length > 0;
  const empty = !hasColumns && !hasHidden && !v.sort && !v.groupBy && !hasWidths && !v.extras;
  if (empty) board.views.splice(idx, 1);
}

export function setViewSort(
  board: Board,
  viewName: string,
  sort: { field: string; dir: 'asc' | 'desc' } | null,
): void {
  const v = ensureView(board, viewName);
  if (sort) v.sort = sort;
  else      delete v.sort;
  pruneView(board, viewName);
}

export function setViewGroup(board: Board, viewName: string, groupBy: string | null): void {
  const v = ensureView(board, viewName);
  if (groupBy) v.groupBy = groupBy;
  else         delete v.groupBy;
  pruneView(board, viewName);
}

export function setViewWidth(
  board: Board,
  viewName: string,
  field: string,
  px: number | null,
): void {
  const v = ensureView(board, viewName);
  if (!v.widths) v.widths = {};
  if (px === null) delete v.widths[field];
  else             v.widths[field] = px;
  if (v.widths && Object.keys(v.widths).length === 0) delete v.widths;
  pruneView(board, viewName);
}

/** NOTE: passing an empty array will prune the view if no other settings exist. */
export function setViewColumns(board: Board, viewName: string, columns: string[]): void {
  const v = ensureView(board, viewName);
  v.columns = columns;
  pruneView(board, viewName);
}

export function hideFieldInView(board: Board, viewName: string, field: string): void {
  const v = ensureView(board, viewName);
  v.hidden = Array.from(new Set([...(v.hidden ?? []), field]));
  if (v.sort?.field === field) delete v.sort;
  if (v.groupBy    === field) delete v.groupBy;
  pruneView(board, viewName);
}

export function showFieldInView(board: Board, viewName: string, field: string): void {
  const v = board.views.find(x => x.name === viewName);
  if (!v?.hidden) return;
  v.hidden = v.hidden.filter(n => n !== field);
  if (v.hidden.length === 0) delete v.hidden;
  pruneView(board, viewName);
}

export function addCard(board: Board, presets: Partial<Record<string, string>> = {}): string {
  const id = nextCardId(board);
  const values: Record<string, string> = { id };
  for (const f of board.fields) {
    values[f.name] = presets[f.name] ?? '';
  }
  // Always keep values.id in sync with the card id (the loop above may overwrite it).
  values.id = id;
  if (!('Status' in presets) && !values.Status) values.Status = board.columns[0]?.name ?? '';
  board.cards.push({ id, values, body: '' });
  return id;
}

function nextCardId(board: Board): string {
  return mintCardId(board.cards.map(c => c.id));
}

export function moveCard(board: Board, fromId: string, beforeId: string | null): void {
  const fromIdx = board.cards.findIndex(c => c.id === fromId);
  if (fromIdx < 0) return;
  const [card] = board.cards.splice(fromIdx, 1);
  if (beforeId === null) { board.cards.push(card); return; }
  const insertIdx = board.cards.findIndex(c => c.id === beforeId);
  if (insertIdx < 0) { board.cards.push(card); return; }
  board.cards.splice(insertIdx, 0, card);
}

export function deleteField(board: Board, field: string): void {
  board.fields = board.fields.filter(f => f.name !== field);
  for (const card of board.cards) delete card.values[field];
  // Clean every view that referenced this field.
  for (const v of board.views) {
    if (v.columns) {
      v.columns = v.columns.filter(n => n !== field);
      if (v.columns.length === 0) delete v.columns;
    }
    if (v.hidden) {
      v.hidden = v.hidden.filter(n => n !== field);
      if (v.hidden.length === 0) delete v.hidden;
    }
    if (v.sort?.field    === field) delete v.sort;
    if (v.groupBy        === field) delete v.groupBy;
    if (v.widths?.[field] !== undefined) {
      delete v.widths[field];
      if (Object.keys(v.widths).length === 0) delete v.widths;
    }
  }
  // After cleanup, prune views that have nothing meaningful left.
  board.views = board.views.filter(v =>
    (!!v.columns && v.columns.length > 0) ||
    (!!v.hidden  && v.hidden.length  > 0) ||
    v.sort || v.groupBy ||
    (!!v.widths  && Object.keys(v.widths).length > 0) ||
    v.extras,
  );
}
