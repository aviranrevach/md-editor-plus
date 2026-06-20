// c46 — pure logic for the table COLUMN handle. Mirrors tableRowOps, but
// columns have no fixed "header" (markdown's header is a row), so any column is
// movable/insertable; only Delete is withheld for the last remaining column so
// the table always keeps at least one column. Reuses reorderRows' index math
// with headerCount 0.
import { reorderRows } from './tableRowOps';

export type ColMenuItemKind = 'insert-left' | 'insert-right' | 'duplicate' | 'delete';

export const COL_MENU_LABEL: Record<ColMenuItemKind, string> = {
  'insert-left': 'Insert column left',
  'insert-right': 'Insert column right',
  'duplicate': 'Duplicate column',
  'delete': 'Delete column',
};

/** Ordered actions for a column. Delete is dropped when it is the only column. */
export function colMenuModel(ctx: { isOnly: boolean }): ColMenuItemKind[] {
  const base: ColMenuItemKind[] = ['insert-left', 'insert-right', 'duplicate'];
  return ctx.isOnly ? base : [...base, 'delete'];
}

/** Reorder a column within a row's cell list (no fixed column → headerCount 0). */
export function reorderColumns<T>(cells: T[], fromIdx: number, insertIdx: number): T[] {
  return reorderRows(cells, fromIdx, insertIdx, 0);
}
