// tests/diffAlign.test.ts
import { computeAlignment } from '../src/webview/diffAlign';

describe('computeAlignment', () => {
  it('marks identical blocks as eq rows with paired indices', () => {
    expect(computeAlignment(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([
      { kind: 'eq', left: 0, right: 0 },
      { kind: 'eq', left: 1, right: 1 },
      { kind: 'eq', left: 2, right: 2 },
    ]);
  });

  it('pairs a single replaced block as one change row', () => {
    expect(computeAlignment(['a', 'B', 'c'], ['a', 'X', 'c'])).toEqual([
      { kind: 'eq', left: 0, right: 0 },
      { kind: 'change', left: 1, right: 1 },
      { kind: 'eq', left: 2, right: 2 },
    ]);
  });

  it('marks a current-only block as add (left null)', () => {
    expect(computeAlignment(['a', 'c'], ['a', 'b', 'c'])).toEqual([
      { kind: 'eq', left: 0, right: 0 },
      { kind: 'add', left: null, right: 1 },
      { kind: 'eq', left: 1, right: 2 },
    ]);
  });

  it('marks a base-only block as del (right null)', () => {
    expect(computeAlignment(['a', 'b', 'c'], ['a', 'c'])).toEqual([
      { kind: 'eq', left: 0, right: 0 },
      { kind: 'del', left: 1, right: null },
      { kind: 'eq', left: 2, right: 1 },
    ]);
  });

  it('pairs the overlap of an uneven hunk, then emits the remainder', () => {
    // 2 dels vs 1 add: one pairs as change, one is a pure del
    expect(computeAlignment(['B', 'D'], ['X'])).toEqual([
      { kind: 'change', left: 0, right: 0 },
      { kind: 'del', left: 1, right: null },
    ]);
  });

  it('returns an empty array for two empty inputs', () => {
    expect(computeAlignment([], [])).toEqual([]);
  });
});
