import { merge3 } from '../src/webview/merge3';

describe('merge3', () => {
  it('returns the text when ours === theirs', () => {
    expect(merge3('a\nb', 'a\nX', 'a\nX')).toBe('a\nX');
  });

  it('takes theirs when only theirs changed (base === ours)', () => {
    expect(merge3('a\nb\nc', 'a\nb\nc', 'a\nB\nc')).toBe('a\nB\nc');
  });

  it('takes ours when only ours changed (base === theirs)', () => {
    expect(merge3('a\nb\nc', 'a\nB\nc', 'a\nb\nc')).toBe('a\nB\nc');
  });

  it('merges disjoint edits (ours edits first line, theirs edits last line)', () => {
    expect(merge3('a\nb\nc', 'A\nb\nc', 'a\nb\nC')).toBe('A\nb\nC');
  });

  it('merges a top insertion (ours) with a bottom insertion (theirs)', () => {
    expect(merge3('a\nb', 'top\na\nb', 'a\nb\nbot')).toBe('top\na\nb\nbot');
  });

  it('returns null when both edit the same line differently', () => {
    expect(merge3('a\nb\nc', 'a\nOURS\nc', 'a\nTHEIRS\nc')).toBeNull();
  });

  it('returns null when the changed ranges overlap', () => {
    // ours replaces lines 2-3, theirs replaces lines 3-4 → overlap at line 3
    expect(merge3('a\nb\nc\nd', 'a\nX\nY\nd', 'a\nb\nP\nQ')).toBeNull();
  });

  it('returns null for two insertions at the same point', () => {
    expect(merge3('a\nb', 'a\nMINE\nb', 'a\nTHEIRS\nb')).toBeNull();
  });

  it('merges edits to different board rows (realistic)', () => {
    const base = '| A | Todo | c1 |\n| B | Todo | c2 |\n| C | Todo | c3 |';
    const ours = '| A | Done | c1 |\n| B | Todo | c2 |\n| C | Todo | c3 |';   // edited row A
    const theirs = '| A | Todo | c1 |\n| B | Todo | c2 |\n| C | Done | c3 |'; // edited row C
    expect(merge3(base, ours, theirs)).toBe('| A | Done | c1 |\n| B | Todo | c2 |\n| C | Done | c3 |');
  });

  it('handles an empty base without crashing', () => {
    expect(merge3('', 'a', 'a')).toBe('a');
  });
});
