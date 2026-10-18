import {
  summarizeSelection,
  formatSummary,
  locateAnchors,
  truncateAnchor,
} from '../../src/webview/aiSelection';

describe('summarizeSelection', () => {
  it('counts lines and words', () => {
    expect(summarizeSelection('one two\nthree')).toEqual({ lines: 2, words: 3 });
  });
  it('handles empty text', () => {
    expect(summarizeSelection('')).toEqual({ lines: 0, words: 0 });
  });
  it('ignores blank lines for the line count but counts words', () => {
    expect(summarizeSelection('a\n\n b ')).toEqual({ lines: 2, words: 2 });
  });
});

describe('formatSummary', () => {
  it('renders the count line', () => {
    expect(formatSummary({ lines: 23, words: 340 })).toBe('Converting 23 lines · ~340 words');
  });
  it('uses singular for one line', () => {
    expect(formatSummary({ lines: 1, words: 4 })).toBe('Converting 1 line · ~4 words');
  });
  it('uses singular for one word', () => {
    expect(formatSummary({ lines: 2, words: 1 })).toBe('Converting 2 lines · ~1 word');
  });
});

describe('locateAnchors', () => {
  const md = ['# Title', '', '- Draft press release', '- Brief sales', '- Set up analytics'].join('\n');
  it('finds 1-based line numbers by substring match', () => {
    expect(locateAnchors(md, 'Draft press release', 'Set up analytics'))
      .toEqual({ startLine: 3, endLine: 5 });
  });
  it('returns null when a line is not found', () => {
    expect(locateAnchors(md, 'nope', 'Set up analytics'))
      .toEqual({ startLine: null, endLine: 5 });
  });
});

describe('truncateAnchor', () => {
  it('passes short text through', () => {
    expect(truncateAnchor('short line')).toBe('short line');
  });
  it('truncates long text with an ellipsis', () => {
    const long = 'x'.repeat(100);
    const out = truncateAnchor(long);
    expect(out.length).toBeLessThanOrEqual(81);
    expect(out.endsWith('…')).toBe(true);
  });
  it('collapses internal whitespace/newlines', () => {
    expect(truncateAnchor('a\n  b\tc')).toBe('a b c');
  });
});
