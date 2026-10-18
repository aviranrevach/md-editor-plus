import { computeConflictDiff } from '../src/webview/conflictDiff';

describe('computeConflictDiff', () => {
  it('returns no rows for identical input', () => {
    expect(computeConflictDiff('a\nb\nc', 'a\nb\nc')).toEqual({ rows: [], truncated: 0 });
  });

  it('pairs a single changed line as one change row', () => {
    const d = computeConflictDiff('a\nB\nc', 'a\nX\nc');
    expect(d.rows).toEqual([{ kind: 'change', yours: 'B', disk: 'X' }]);
  });

  it('reports a disk-only line as add (yours null)', () => {
    const d = computeConflictDiff('a\nc', 'a\nb\nc');
    expect(d.rows).toEqual([{ kind: 'add', yours: null, disk: 'b' }]);
  });

  it('reports a yours-only line as del (disk null)', () => {
    const d = computeConflictDiff('a\nb\nc', 'a\nc');
    expect(d.rows).toEqual([{ kind: 'del', yours: 'b', disk: null }]);
  });

  it('pairs an uneven hunk: changes first, then leftover adds', () => {
    // yours: X      disk: P Q R   -> change(X,P), add(Q), add(R)
    const d = computeConflictDiff('top\nX\nbot', 'top\nP\nQ\nR\nbot');
    expect(d.rows).toEqual([
      { kind: 'change', yours: 'X', disk: 'P' },
      { kind: 'add', yours: null, disk: 'Q' },
      { kind: 'add', yours: null, disk: 'R' },
    ]);
  });

  it('excludes unchanged lines between changes (changed-region-only)', () => {
    const d = computeConflictDiff('A1\nsame\nB1', 'A2\nsame\nB2');
    expect(d.rows).toEqual([
      { kind: 'change', yours: 'A1', disk: 'A2' },
      { kind: 'change', yours: 'B1', disk: 'B2' },
    ]);
  });

  it('caps rows at maxRows and reports the remainder as truncated', () => {
    const yours = Array.from({ length: 10 }, (_, i) => `y${i}`).join('\n');
    const disk = Array.from({ length: 10 }, (_, i) => `d${i}`).join('\n');
    const d = computeConflictDiff(yours, disk, 4);
    expect(d.rows).toHaveLength(4);
    expect(d.truncated).toBe(6);
  });

  it('normalizes CRLF and ignores trailing blank lines', () => {
    expect(computeConflictDiff('a\r\nb\r\n', 'a\nb')).toEqual({ rows: [], truncated: 0 });
  });

  it('handles a realistic board change (status flip + added row + your-only row)', () => {
    const yours = '| Export | Todo | c15 |\n| RTL | c26 |';
    const disk  = '| Export | Done | c15 |\n| Diff viewer | c24 |';
    const d = computeConflictDiff(yours, disk);
    expect(d.rows).toEqual([
      { kind: 'change', yours: '| Export | Todo | c15 |', disk: '| Export | Done | c15 |' },
      { kind: 'change', yours: '| RTL | c26 |', disk: '| Diff viewer | c24 |' },
    ]);
  });

  it('handles empty inputs on either or both sides', () => {
    expect(computeConflictDiff('', '')).toEqual({ rows: [], truncated: 0 });
    expect(computeConflictDiff('', 'a\nb')).toEqual({
      rows: [
        { kind: 'add', yours: null, disk: 'a' },
        { kind: 'add', yours: null, disk: 'b' },
      ],
      truncated: 0,
    });
    expect(computeConflictDiff('a\nb', '')).toEqual({
      rows: [
        { kind: 'del', yours: 'a', disk: null },
        { kind: 'del', yours: 'b', disk: null },
      ],
      truncated: 0,
    });
  });
});
