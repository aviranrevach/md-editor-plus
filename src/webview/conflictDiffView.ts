import type { ConflictDiff } from './conflictDiff';

// Cells are colored by COLUMN, not by change-type: the on-disk (left) side is red,
// your-edits (right) side is green — the standard before→after diff convention.
// `empty` is the hatched gap where a line exists on only one side.
function cell(kind: 'disk' | 'mine' | 'empty', text: string): HTMLDivElement {
  const c = document.createElement('div');
  c.className = `conflict-cell ${kind}`;
  c.textContent = text;
  return c;
}

// One header column: a colored dot + bold title, and a muted line naming the
// button that keeps this side. Columns are ordered to match the banner buttons
// (left = on disk → "Reload from disk", right = yours → "Keep my version").
function header(dot: 'disk' | 'mine', title: string, sub: string): HTMLDivElement {
  const h = document.createElement('div');
  h.className = 'conflict-h';
  const ttl = document.createElement('div');
  ttl.className = 'conflict-h-ttl';
  const d = document.createElement('span');
  d.className = `conflict-dot ${dot}`;
  ttl.append(d, document.createTextNode(title));
  const s = document.createElement('div');
  s.className = 'conflict-h-sub';
  s.textContent = sub;
  h.append(ttl, s);
  return h;
}

/** Builds the panel content (header + aligned grid + optional footer) from a diff.
 *  Pure DOM, no app deps. Left column = on disk, right column = your unsaved edits. */
export function buildConflictDiffPanel(diff: ConflictDiff): HTMLElement {
  const wrap = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'conflict-panel-head';
  head.append(
    header('disk', 'On disk (changed elsewhere)', 'written outside this editor · “Reload from disk” keeps this'),
    header('mine', 'Your unsaved edits', 'not written yet · “Keep my version” keeps this'),
  );
  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'conflict-grid';
  for (const row of diff.rows) {
    const pair = document.createElement('div');
    pair.className = 'conflict-pair';
    let left: HTMLDivElement;   // on disk (red)
    let right: HTMLDivElement;  // yours (green)
    if (row.kind === 'change') {
      left = cell('disk', row.disk ?? '');
      right = cell('mine', row.yours ?? '');
    } else if (row.kind === 'add') {
      // disk-only line
      left = cell('disk', row.disk ?? '');
      right = cell('empty', '');
    } else {
      // yours-only line (del)
      left = cell('empty', '');
      right = cell('mine', row.yours ?? '');
    }
    pair.append(left, right);
    grid.appendChild(pair);
  }
  wrap.appendChild(grid);

  // Footer only when there's something to say: empty diff, or a truncation note.
  if (diff.rows.length === 0) {
    const foot = document.createElement('div');
    foot.className = 'conflict-foot';
    foot.textContent = 'No line differences.';
    wrap.appendChild(foot);
  } else if (diff.truncated > 0) {
    const foot = document.createElement('div');
    foot.className = 'conflict-foot';
    foot.textContent = `+${diff.truncated} more changed line${diff.truncated === 1 ? '' : 's'}`;
    wrap.appendChild(foot);
  }
  return wrap;
}
