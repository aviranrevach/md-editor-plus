import { parseBoardSource, serializeBoard } from '../../src/webview/boardModel';

const lower = [
  '<!-- board:start id="b1" name="B" columns="Todo|Done" column-colors="blue|emerald" field-types="Title=text,Status=status,id=text" -->',
  '',
  '| Title | Status | id |',
  '|---|---|---|',
  '| Alpha | Todo | c8 |',
  '| Beta | Done | c17 |',
  '',
  '<!-- board:body id="c8" -->',
  '',
  'Body for eight',
  '',
  '<!-- board:end -->',
].join('\n');

const upper = lower.replace(/c8/g, 'C8').replace(/c17/g, 'C17');

describe('board serialization is idempotent', () => {
  it('round-trips a lowercase-id board byte-identically', () => {
    expect(serializeBoard(parseBoardSource(lower))).toBe(lower);
  });
  it('round-trips an uppercase-id board byte-identically', () => {
    expect(serializeBoard(parseBoardSource(upper))).toBe(upper);
  });
  it('keeps the body linked regardless of id case', () => {
    expect(parseBoardSource(lower).cards[0].body.trim()).toBe('Body for eight');
  });
});
