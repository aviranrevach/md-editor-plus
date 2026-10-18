// c46 — pure row logic for the regular-table row handle.
//
// No DOM, no ProseMirror: just the index math for reordering rows and the
// menu model for a given row. Kept separate from the transaction + DOM layers
// so the rules (especially "the header row stays first and present") are
// unit-tested in isolation. The reorder index math mirrors codeBlock.moveLine.

export type RowMenuItemKind = 'insert-above' | 'insert-below' | 'duplicate' | 'delete';

/** Number of leading rows that are structural and immovable. Markdown tables
 *  have exactly one header row, which must stay first. */
export const HEADER_ROW_COUNT = 1;

/** Clamp a desired insert index so a row never lands above the header and
 *  never past the end of the table. */
export function clampInsertIndex(insertIdx: number, headerCount: number, rowCount: number): number {
  return Math.max(headerCount, Math.min(insertIdx, rowCount));
}

/**
 * Move the row at `fromIdx` so it lands at `insertIdx` (an index in the
 * pre-removal array, like codeBlock.moveLine). Returns a NEW array — the input
 * is never mutated. The header row (anything below `headerCount`) is fixed: a
 * request to move it, or to drop another row above it, is clamped/ignored.
 */
export function reorderRows<T>(
  rows: T[],
  fromIdx: number,
  insertIdx: number,
  headerCount: number = HEADER_ROW_COUNT,
): T[] {
  // Header rows are pinned; an out-of-range source is a no-op.
  if (fromIdx < headerCount || fromIdx < 0 || fromIdx >= rows.length) return rows.slice();
  const clamped = clampInsertIndex(insertIdx, headerCount, rows.length);
  // Inserting at the same slot, or right after itself, changes nothing.
  if (clamped === fromIdx || clamped === fromIdx + 1) return rows.slice();
  const next = rows.slice();
  const [moved] = next.splice(fromIdx, 1);
  const adjusted = clamped > fromIdx ? clamped - 1 : clamped;
  next.splice(adjusted, 0, moved);
  return next;
}

/** Ordered list of actions offered for a row. The header row may only gain a
 *  row below it — inserting above, duplicating, or deleting it would break the
 *  markdown table (the header must be first and present). */
export function rowMenuModel(ctx: { isHeader: boolean }): RowMenuItemKind[] {
  if (ctx.isHeader) return ['insert-below'];
  return ['insert-above', 'insert-below', 'duplicate', 'delete'];
}

/** The header row is not draggable (it must stay first). */
export function canDragRow(isHeader: boolean): boolean {
  return !isHeader;
}

/** Menu labels for each action kind. Shared so the handle and its tests agree. */
export const ROW_MENU_LABEL: Record<RowMenuItemKind, string> = {
  'insert-above': 'Insert row above',
  'insert-below': 'Insert row below',
  'duplicate': 'Duplicate row',
  'delete': 'Delete row',
};
