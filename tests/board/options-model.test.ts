import { parseBoardSource, serializeBoard } from '../../src/webview/boardModel';

describe('10-color palette', () => {
  it('parses and preserves a new color token (teal) on a column', () => {
    const src = `<!-- board:start id="b1" columns="A|B" column-colors="teal|indigo" field-types="Title=text,Status=status" -->\n\n<!-- board:end -->`;
    const board = parseBoardSource(src);
    expect(board.columns).toEqual([
      { name: 'A', color: 'teal' },
      { name: 'B', color: 'indigo' },
    ]);
    expect(serializeBoard(board)).toContain('column-colors="teal|indigo"');
  });
});
