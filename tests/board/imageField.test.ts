import { parseBoardSource, serializeBoard } from '../../src/webview/boardModel';

const SRC = [
  '<!-- board:start id="b1" name="B" columns="Todo|Done" column-colors="gray|emerald" field-types="Title=text,Status=status,Shot=image" -->',
  '',
  '| Title | Status | Shot |',
  '|---|---|---|',
  '| Card A | Todo | ![](./B.assets/a.png) |',
  '',
  '<!-- board:end -->',
].join('\n');

describe('image field type', () => {
  it('parses an image field and its cell value', () => {
    const board = parseBoardSource(SRC);
    const shot = board.fields.find((f) => f.name === 'Shot');
    expect(shot?.type).toBe('image');
    expect(board.cards[0].values.Shot).toBe('![](./B.assets/a.png)');
  });

  it('round-trips field-types=...,Shot=image and the cell value', () => {
    const out = serializeBoard(parseBoardSource(SRC));
    expect(out).toContain('Shot=image');
    expect(out).toContain('![](./B.assets/a.png)');
  });
});
