import { idNumber, normalizeLegacyId, mintCardId, parseBoardSource, serializeBoard } from '../../src/webview/boardModel';

describe('idNumber', () => {
  it('extracts the trailing integer from C<n> and legacy c<n>', () => {
    expect(idNumber('C7')).toBe(7);
    expect(idNumber('c7')).toBe(7);
    expect(idNumber('C103')).toBe(103);
  });
  it('returns null for non-matching ids', () => {
    expect(idNumber('')).toBeNull();
    expect(idNumber('c-ab12')).toBeNull();
    expect(idNumber('task-3')).toBeNull();
    expect(idNumber('C7x')).toBeNull();
  });
});

describe('normalizeLegacyId', () => {
  it('uppercases legacy lowercase c<n>', () => {
    expect(normalizeLegacyId('c8')).toBe('C8');
    expect(normalizeLegacyId('c17')).toBe('C17');
  });
  it('leaves already-canonical and non-matching ids untouched', () => {
    expect(normalizeLegacyId('C8')).toBe('C8');
    expect(normalizeLegacyId('c-ab12')).toBe('c-ab12');
    expect(normalizeLegacyId('')).toBe('');
  });
  it('strips leading zeros to the canonical unpadded form', () => {
    expect(normalizeLegacyId('c007')).toBe('C7');
    expect(normalizeLegacyId('c0')).toBe('C0');
  });
});

describe('mintCardId', () => {
  it('continues from the highest existing number, uppercase C', () => {
    expect(mintCardId(['C1', 'C17', 'C3'])).toBe('C18');
  });
  it('accounts for legacy lowercase numbers when scanning', () => {
    expect(mintCardId(['c8', 'C2'])).toBe('C9');
  });
  it('starts at C1 when there are no numeric ids', () => {
    expect(mintCardId([])).toBe('C1');
    expect(mintCardId(['c-ab12'])).toBe('C1');
  });
  it('skips a number already taken at the computed slot', () => {
    // max is 5 -> tries C6; if C6 already present, advances
    expect(mintCardId(['C5', 'C6'])).toBe('C7');
  });
});

describe('legacy id migration on parse (c17)', () => {
  const src = [
    '<!-- board:start id="b1" name="B" columns="Todo" column-colors="blue" field-types="Title=text,Status=status,id=text" hidden-fields="id" -->',
    '',
    '| Title | Status | id |',
    '|---|---|---|',
    '| Alpha | Todo | c8 |',
    '| Beta | Todo | c17 |',
    '',
    '<!-- board:body id="c8" -->',
    '',
    'Body for eight',
    '',
    '<!-- board:body id="c17" -->',
    '',
    'Body for seventeen',
    '',
    '<!-- board:end -->',
  ].join('\n');

  it('uppercases card ids and keeps them linked to their bodies', () => {
    const board = parseBoardSource(src)!;
    expect(board.cards.map(c => c.id)).toEqual(['C8', 'C17']);
    expect(board.cards.map(c => c.values.id)).toEqual(['C8', 'C17']);
    expect(board.cards[0].body.trim()).toBe('Body for eight');
    expect(board.cards[1].body.trim()).toBe('Body for seventeen');
    expect(board.orphanBodies).toHaveLength(0);
  });

  it('round-trips uppercased ids into the table and the body anchors', () => {
    const out = serializeBoard(parseBoardSource(src)!);
    expect(out).toContain('| Alpha | Todo | C8 |');
    expect(out).toContain('| Beta | Todo | C17 |');
    expect(out).toContain('<!-- board:body id="C8" -->');
    expect(out).toContain('<!-- board:body id="C17" -->');
    expect(out).not.toContain('id="c8"');
    expect(out).not.toContain('| c17 |');
  });
});
