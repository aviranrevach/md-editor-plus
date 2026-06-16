/** @jest-environment jsdom */
import { buildConflictDiffPanel } from '../src/webview/conflictDiffView';
import type { ConflictDiff } from '../src/webview/conflictDiff';

const diff = (rows: ConflictDiff['rows'], truncated = 0): ConflictDiff => ({ rows, truncated });

describe('buildConflictDiffPanel', () => {
  it('colors cells by column — disk (red) left, mine (green) right, empty for gaps', () => {
    const el = buildConflictDiffPanel(diff([
      { kind: 'change', yours: 'B', disk: 'X' },
      { kind: 'del', yours: 'gone', disk: null },   // yours-only → empty on disk, mine on yours
      { kind: 'add', yours: null, disk: 'new' },     // disk-only → disk on left, empty on yours
    ]));
    const pairs = el.querySelectorAll('.conflict-pair');
    expect(pairs).toHaveLength(3);
    // change: disk left, mine right
    expect(pairs[0].children[0].className).toContain('disk');
    expect(pairs[0].children[1].className).toContain('mine');
    // del (yours-only): disk empty, yours green
    expect(pairs[1].children[0].className).toContain('empty');
    expect(pairs[1].children[1].className).toContain('mine');
    // add (disk-only): disk red, yours empty
    expect(pairs[2].children[0].className).toContain('disk');
    expect(pairs[2].children[1].className).toContain('empty');
  });

  it('puts ON DISK on the left cell and YOURS on the right cell', () => {
    const el = buildConflictDiffPanel(diff([{ kind: 'change', yours: 'mine', disk: 'theirs' }]));
    const pair = el.querySelector('.conflict-pair')!;
    expect(pair.children[0].textContent).toBe('theirs'); // disk
    expect(pair.children[1].textContent).toBe('mine');   // yours
  });

  it('labels the columns so each maps to its button', () => {
    const el = buildConflictDiffPanel(diff([{ kind: 'change', yours: 'a', disk: 'b' }]));
    const head = el.querySelector('.conflict-panel-head')!;
    expect(head.children[0].textContent).toContain('On disk');
    expect(head.children[0].textContent).toContain('Reload from disk');
    expect(head.children[1].textContent).toContain('Your unsaved edits');
    expect(head.children[1].textContent).toContain('Keep my version');
    // dots present, ordered disk then mine
    expect(el.querySelector('.conflict-dot.disk')).not.toBeNull();
    expect(el.querySelector('.conflict-dot.mine')).not.toBeNull();
  });

  it('shows a "no line differences" note when there are no rows', () => {
    const el = buildConflictDiffPanel(diff([]));
    expect(el.querySelectorAll('.conflict-pair')).toHaveLength(0);
    expect(el.textContent).toContain('No line differences');
  });

  it('shows a "+N more" footer only when the diff is truncated', () => {
    const truncated = buildConflictDiffPanel(diff([{ kind: 'add', yours: null, disk: 'x' }], 5));
    expect(truncated.querySelector('.conflict-foot')!.textContent).toContain('+5 more');
    const notTruncated = buildConflictDiffPanel(diff([{ kind: 'add', yours: null, disk: 'x' }]));
    expect(notTruncated.querySelector('.conflict-foot')).toBeNull();
  });

  it('renders an "Open full diff" link that fires onOpenFullDiff', () => {
    const onOpenFullDiff = jest.fn();
    const el = buildConflictDiffPanel(diff([{ kind: 'add', yours: null, disk: 'x' }]), { onOpenFullDiff });
    const link = el.querySelector<HTMLElement>('.conflict-openfull');
    expect(link).not.toBeNull();
    link!.click();
    expect(onOpenFullDiff).toHaveBeenCalledTimes(1);
  });

  it('omits the "Open full diff" link when no callback is given', () => {
    const el = buildConflictDiffPanel(diff([{ kind: 'add', yours: null, disk: 'x' }]));
    expect(el.querySelector('.conflict-openfull')).toBeNull();
  });
});
