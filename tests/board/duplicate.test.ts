import { parseBoardSource, duplicateBoardSource, mintBoardId } from '../../src/webview/boardModel';

const SRC = [
  '<!-- board:start id="b-src1" name="My Board" columns="Todo|Doing|Done" column-colors="blue|amber|emerald" field-types="Title=text,Status=status,id=text" hidden-fields="id" -->',
  '',
  '| Title | Status | id |',
  '|---|---|---|',
  '| Alpha | Todo | C1 |',
  '| Beta | Doing | C2 |',
  '',
  '<!-- board:body id="C1" -->',
  '',
  'Body for Alpha',
  '',
  '<!-- board:end -->',
].join('\n');

describe('mintBoardId', () => {
  it('returns a b- prefixed id not in the taken set', () => {
    const id = mintBoardId(['b-aaaa', 'b-bbbb']);
    expect(id).toMatch(/^b-[a-z0-9]{1,4}$/);
    expect(['b-aaaa', 'b-bbbb']).not.toContain(id);
  });
});

describe('duplicateBoardSource', () => {
  it('gives the copy a fresh board id, different from the source', () => {
    const out = duplicateBoardSource(SRC, []);
    const orig = parseBoardSource(SRC);
    const dup = parseBoardSource(out);
    expect(dup.id).not.toBe(orig.id);
    expect(dup.id).toMatch(/^b-/);
  });

  it('never reuses an id already present in the document', () => {
    const out = duplicateBoardSource(SRC, ['b-other']);
    const dup = parseBoardSource(out);
    expect(['b-src1', 'b-other']).not.toContain(dup.id);
  });

  it('preserves cards, their ids, values, and bodies verbatim', () => {
    const dup = parseBoardSource(duplicateBoardSource(SRC, []));
    expect(dup.cards.map(c => c.id)).toEqual(['C1', 'C2']);
    expect(dup.cards.map(c => c.values.id)).toEqual(['C1', 'C2']);
    expect(dup.cards[0].body.trim()).toBe('Body for Alpha');
    expect(dup.name).toBe('My Board');
    expect(dup.columns.map(c => c.name)).toEqual(['Todo', 'Doing', 'Done']);
  });
});
