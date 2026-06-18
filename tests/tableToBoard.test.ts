import { tableToBoardSource } from '../src/webview/tableToBoard';
import { parseBoardSource } from '../src/webview/boardModel';

describe('tableToBoardSource', () => {
  it('maps the first column onto the Title field; others become text fields', () => {
    const board = parseBoardSource(
      tableToBoardSource([['Feature', 'Owner'], ['Dark mode', 'Aviran']], 'b-test'),
    );
    // parseBoardSource always injects Title + Status first.
    expect(board.fields.map(f => f.name)).toEqual(['Title', 'Status', 'Owner', 'id']);
    expect(board.fields.find(f => f.name === 'Owner')!.type).toBe('text');
    expect(board.fields.find(f => f.name === 'id')!.visibleOnCard).toBe(false);
    expect(board.activeView).toBe('table');
  });

  it('puts each row first-column value into the card Title', () => {
    const board = parseBoardSource(
      tableToBoardSource(
        [['Feature', 'Owner'], ['Dark mode', 'Aviran'], ['Export PDF', 'Gilad']],
        'b-test',
      ),
    );
    expect(board.cards).toHaveLength(2);
    expect(board.cards[0].values.Title).toBe('Dark mode');
    expect(board.cards[0].values.Owner).toBe('Aviran');
    expect(board.cards[1].values.Title).toBe('Export PDF');
    expect(board.cards[0].id).not.toBe(board.cards[1].id);
  });

  it('gives a blank non-first header a fallback name', () => {
    const board = parseBoardSource(
      tableToBoardSource([['Feature', ''], ['a', 'b']], 'b-test'),
    );
    expect(board.fields.map(f => f.name)).toContain('Column 2');
  });

  it('produces a parseable starter board for an empty grid', () => {
    const board = parseBoardSource(tableToBoardSource([], 'b-empty'));
    expect(board.id).toBe('b-empty');
    expect(board.fields[0].name).toBe('Title');
    expect(board.cards).toHaveLength(0);
  });
});
