import { findMatches } from '../src/webview/search';

describe('findMatches', () => {
  it('returns no matches for an empty query', () => {
    expect(findMatches('the quick brown fox', '')).toEqual([]);
  });

  it('finds every occurrence of a term', () => {
    const text = 'the cat sat on the mat with the hat';
    const m = findMatches(text, 'the');
    expect(m).toEqual([
      { start: 0, end: 3 },
      { start: 15, end: 18 },
      { start: 28, end: 31 },
    ]);
  });

  it('is case-insensitive by default', () => {
    const m = findMatches('Cat cat CAT', 'cat');
    expect(m).toHaveLength(3);
    expect(m[0]).toEqual({ start: 0, end: 3 });
  });

  it('respects caseSensitive when asked', () => {
    const m = findMatches('Cat cat CAT', 'cat', { caseSensitive: true });
    expect(m).toEqual([{ start: 4, end: 7 }]);
  });

  it('returns matches that do not overlap', () => {
    // "aa" in "aaaa" → positions 0 and 2, not 0/1/2/3
    const m = findMatches('aaaa', 'aa');
    expect(m).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('treats the query as a literal string, not a regex', () => {
    const m = findMatches('a.b axb a.b', 'a.b');
    expect(m).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it('returns empty when there is no match', () => {
    expect(findMatches('hello world', 'zzz')).toEqual([]);
  });

  it('handles a query longer than the text', () => {
    expect(findMatches('hi', 'hello there')).toEqual([]);
  });

  it('matches across newlines as part of the haystack', () => {
    const m = findMatches('foo\nbar\nfoo', 'foo');
    expect(m).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });
});
