import type { ConflictDiff, DiffRow } from './conflictDiff';

export interface ConflictDiffPanelOptions { onOpenFullDiff?: () => void; }

function cell(kind: 'change' | 'add' | 'del' | 'empty', text: string): HTMLDivElement {
  const c = document.createElement('div');
  c.className = `conflict-cell ${kind}`;
  c.textContent = text;
  return c;
}

/** Builds the panel content (header + aligned grid + footer) from a diff. Pure DOM, no app deps. */
export function buildConflictDiffPanel(diff: ConflictDiff, opts: ConflictDiffPanelOptions = {}): HTMLElement {
  const wrap = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'conflict-panel-head';
  const hy = document.createElement('div'); hy.textContent = 'Your version';
  const hd = document.createElement('div'); hd.textContent = 'On disk';
  head.append(hy, hd);
  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'conflict-grid';
  for (const row of diff.rows) {
    const pair = document.createElement('div');
    pair.className = 'conflict-pair';
    let left: HTMLDivElement;
    let right: HTMLDivElement;
    if (row.kind === 'change') {
      left = cell('change', row.yours ?? '');
      right = cell('change', row.disk ?? '');
    } else if (row.kind === 'del') {
      left = cell('del', row.yours ?? '');
      right = cell('empty', '');
    } else {
      left = cell('empty', '');
      right = cell('add', row.disk ?? '');
    }
    pair.append(left, right);
    grid.appendChild(pair);
  }
  wrap.appendChild(grid);

  const foot = document.createElement('div');
  foot.className = 'conflict-foot';
  if (diff.rows.length === 0) {
    foot.textContent = 'No line differences.';
    wrap.appendChild(foot);
    return wrap;
  }
  const n = diff.rows.length;
  foot.append(document.createTextNode(
    `${n} changed line${n === 1 ? '' : 's'}${diff.truncated ? ` (+${diff.truncated} more)` : ''} · `,
  ));
  const link = document.createElement('span');
  link.className = 'conflict-openfull';
  link.textContent = 'Open full diff →';
  link.addEventListener('click', () => opts.onOpenFullDiff?.());
  foot.appendChild(link);
  wrap.appendChild(foot);
  return wrap;
}
