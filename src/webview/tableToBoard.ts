import {
  type Board,
  type FieldDef,
  type Card,
  serializeBoard,
  mintCardId,
} from './boardModel';

// Map a 2-D grid of cell strings (first row = header) into a board source
// string in table view. First column becomes the Title field; every other
// column is a plain text field; a hidden `id` field carries per-row card ids.
// No Status/typed-field detection — the user retypes a column later. An empty
// or header-less grid yields a parseable single-field starter board.
export function tableToBoardSource(rows: string[][], boardId: string): string {
  const header = rows[0] ?? [];
  const bodyRows = rows.slice(1);

  const names = header.map((h, i) => h.trim() || `Column ${i + 1}`);
  if (names.length === 0) names.push('Title');
  names[0] = 'Title';  // the board model's first field IS the card title

  const fields: FieldDef[] = names.map((name) => ({
    name,
    type: 'text',
    visibleOnCard: true,
  }));
  fields.push({ name: 'id', type: 'text', visibleOnCard: false });

  const ids = new Set<string>();
  const cards: Card[] = bodyRows.map((cells) => {
    const id = mintCardId(ids);
    ids.add(id);
    const values: Record<string, string> = { id };
    names.forEach((name, i) => { values[name] = (cells[i] ?? '').trim(); });
    return { id, values, body: '' };
  });

  const board: Board = {
    id: boardId,
    name: '',
    columns: [],          // no kanban lanes — opens in table view
    fields,
    cards,
    orphanBodies: [],
    views: [{ name: 'table' }],
    activeView: 'table',
  };
  return serializeBoard(board);
}
