/** @jest-environment jsdom */
import { buildConflictDiffPanel } from '../src/webview/conflictDiffView';
import type { ConflictDiff } from '../src/webview/conflictDiff';

const diff = (rows: ConflictDiff['rows'], truncated = 0): ConflictDiff => ({ rows, truncated });

describe('buildConflictDiffPanel', () => {
  it('renders one .conflict-pair per row with the right cell classes', () => {
    const el = buildConflictDiffPanel(diff([
      { kind: 'change', yours: 'B', disk: 'X' },
      { kind: 'del', yours: 'gone', disk: null },
      { kind: 'add', yours: null, disk: 'new' },
    ]));
    const pairs = el.querySelectorAll('.conflict-pair');
    expect(pairs).toHaveLength(3);
    expect(pairs[0].children[0].className).toContain('change');
    expect(pairs[0].children[1].className).toContain('change');
    expect(pairs[1].children[0].className).toContain('del');
    expect(pairs[1].children[1].className).toContain('empty');
    expect(pairs[2].children[0].className).toContain('empty');
    expect(pairs[2].children[1].className).toContain('add');
  });

  it('puts yours on the left cell and disk on the right cell', () => {
    const el = buildConflictDiffPanel(diff([{ kind: 'change', yours: 'L', disk: 'R' }]));
    const pair = el.querySelector('.conflict-pair')!;
    expect(pair.children[0].textContent).toBe('L');
    expect(pair.children[1].textContent).toBe('R');
  });

  it('shows a "no line differences" note when there are no rows', () => {
    const el = buildConflictDiffPanel(diff([]));
    expect(el.querySelectorAll('.conflict-pair')).toHaveLength(0);
    expect(el.textContent).toContain('No line differences');
  });

  it('reports the truncated count in the footer', () => {
    const el = buildConflictDiffPanel(diff([{ kind: 'add', yours: null, disk: 'x' }], 5));
    expect(el.querySelector('.conflict-foot')!.textContent).toContain('+5 more');
  });

  it('fires onOpenFullDiff when the "Open full diff" link is clicked', () => {
    const onOpenFullDiff = jest.fn();
    const el = buildConflictDiffPanel(diff([{ kind: 'add', yours: null, disk: 'x' }]), { onOpenFullDiff });
    el.querySelector<HTMLElement>('.conflict-openfull')!.click();
    expect(onOpenFullDiff).toHaveBeenCalledTimes(1);
  });
});
