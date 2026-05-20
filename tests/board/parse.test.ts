import { parseBoardSource } from '../../src/webview/boardModel';

describe('parseBoardSource — minimal', () => {
  it('returns an empty Board when given just start/end markers', () => {
    const source = `<!-- board:start id="b1" -->\n\n<!-- board:end -->`;
    const board = parseBoardSource(source);
    expect(board).toEqual({
      id: 'b1',
      name: '',
      columns: [],
      fields: [
        { name: 'Title', type: 'text', visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
      ],
      cards: [],
    });
  });
});
