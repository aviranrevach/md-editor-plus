// src/webview/boardBlock.ts
import { parseBoardSource, serializeBoard, type Board, type Card, type FieldDef, type ColorToken } from './boardModel';
import { openBoardSidePanel } from './boardSidePanel';

export interface BoardView {
  dom: HTMLElement;
  update(source: string): void;
}

export interface BoardViewOptions {
  onMutate(nextSource: string): void;
}

export function createBoardView(initialSource: string, opts: BoardViewOptions): BoardView {
  const dom = document.createElement('div');
  dom.className = 'board-block';
  dom.setAttribute('contenteditable', 'false');

  let board = parseBoardSource(initialSource);
  render();

  function mutate(next: Board): void {
    board = next;
    opts.onMutate(serializeBoard(board));
    render();
  }

  function render(): void {
    dom.innerHTML = '';
    dom.appendChild(renderChrome(board));
    dom.appendChild(renderColumns(board, mutate));
  }

  return {
    dom,
    update(source: string): void {
      board = parseBoardSource(source);
      render();
    },
  };
}

function renderChrome(board: Board): HTMLElement {
  const chrome = document.createElement('div');
  chrome.className = 'board-chrome';
  const name = document.createElement('div');
  name.className = 'board-name';
  name.textContent = board.name || 'Untitled board';
  if (!board.name) name.classList.add('is-placeholder');
  chrome.appendChild(name);
  return chrome;
}

function renderColumns(board: Board, mutate: (next: Board) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-columns';
  const validNames = new Set(board.columns.map((c) => c.name));
  for (const col of board.columns) {
    row.appendChild(renderColumn(board, col, mutate));
  }
  const orphans = board.cards.filter((c) => !validNames.has(c.values.Status || ''));
  if (orphans.length) {
    row.appendChild(renderUncategorized(board, orphans, mutate));
  }
  const addCol = document.createElement('button');
  addCol.type = 'button';
  addCol.className = 'board-add-column';
  addCol.textContent = '+';
  addCol.title = 'Add column';
  addCol.addEventListener('click', () => {
    const name = prompt('Column name', 'New');
    if (!name) return;
    if (board.columns.some((c) => c.name === name)) {
      alert('A column with that name already exists.');
      return;
    }
    const color = nextColor(board.columns.map((c) => c.color));
    mutate({ ...board, columns: [...board.columns, { name, color }] });
  });
  row.appendChild(addCol);
  return row;
}

function renderColumn(board: Board, col: { name: string; color: string }, mutate: (next: Board) => void): HTMLElement {
  const el = document.createElement('div');
  el.className = `board-column color-${col.color}`;
  el.dataset.column = col.name;

  const cards = board.cards.filter((c) => (c.values.Status || '') === col.name);

  const head = document.createElement('div');
  head.className = 'board-column-head';
  head.innerHTML = `
    <span class="board-column-dot" style="background:var(--color-${col.color})"></span>
    <span class="board-column-name">${escapeHtml(col.name)}</span>
    <span class="board-column-count">${cards.length}</span>
  `;

  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    // Only fire column-drag from the column root, not from cards inside it.
    if ((e.target as HTMLElement).closest('.board-card')) return;
    e.dataTransfer!.setData('text/board-column-name', col.name);
    e.dataTransfer!.effectAllowed = 'move';
  });
  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('text/board-column-name')) {
      e.preventDefault();
    }
  });
  el.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.types.includes('text/board-column-name')) return;
    const draggedName = e.dataTransfer.getData('text/board-column-name');
    if (!draggedName || draggedName === col.name) return;
    e.preventDefault();
    e.stopPropagation();
    const cols = [...board.columns];
    const fromIdx = cols.findIndex((c) => c.name === draggedName);
    const toIdx = cols.findIndex((c) => c.name === col.name);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = cols.splice(fromIdx, 1);
    cols.splice(toIdx, 0, moved);
    mutate({ ...board, columns: cols });
  });

  el.appendChild(head);

  const list = document.createElement('div');
  list.className = 'board-card-list';
  for (const card of cards) {
    list.appendChild(renderCard(board, card, mutate));
  }
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    list.classList.add('is-drop-target');
  });
  list.addEventListener('dragleave', () => list.classList.remove('is-drop-target'));
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    list.classList.remove('is-drop-target');
    const id = e.dataTransfer!.getData('text/board-card-id');
    if (!id) return;
    const next: Board = {
      ...board,
      cards: board.cards.map((c) =>
        c.id === id ? { ...c, values: { ...c.values, Status: col.name } } : c,
      ),
    };
    mutate(next);
  });
  el.appendChild(list);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'board-add-card';
  add.textContent = '+ Add card';
  add.addEventListener('click', () => {
    const id = `c-${Math.random().toString(36).slice(2, 6)}`;
    const newCard: Card = {
      id,
      values: { id, Title: '', Status: col.name },
      body: '',
    };
    const nextBoard: Board = { ...board, cards: [...board.cards, newCard] };
    mutate(nextBoard);
    // After re-render, open the new card immediately so the user can type a title.
    queueMicrotask(() => {
      openBoardSidePanel(nextBoard, newCard, (next) => {
        // Re-fetch the latest board snapshot via the mutate closure.
        mutate({
          ...nextBoard,
          cards: nextBoard.cards.map((c) => (c.id === id ? next : c)),
        });
      });
    });
  });
  el.appendChild(add);

  return el;
}

function renderUncategorized(board: Board, cards: Card[], mutate: (next: Board) => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'board-column color-gray board-column-uncategorized';
  el.dataset.column = '';
  const head = document.createElement('div');
  head.className = 'board-column-head';
  head.innerHTML = `
    <span class="board-column-dot" style="background:var(--color-gray)"></span>
    <span class="board-column-name">Uncategorized</span>
    <span class="board-column-count">${cards.length}</span>
  `;
  el.appendChild(head);
  const list = document.createElement('div');
  list.className = 'board-card-list';
  for (const card of cards) list.appendChild(renderCard(board, card, mutate));
  el.appendChild(list);
  return el;
}

function renderCard(board: Board, card: Card, mutate: (next: Board) => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'board-card';
  el.dataset.cardId = card.id;

  const title = document.createElement('div');
  title.className = 'board-card-title';
  title.textContent = card.values.Title || 'Untitled';
  el.appendChild(title);

  const preview = bodyPreview(card.body);
  if (preview) {
    const p = document.createElement('div');
    p.className = 'board-card-preview';
    p.textContent = preview;
    el.appendChild(p);
  }

  const chips = renderChips(board, card);
  if (chips) el.appendChild(chips);

  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer!.setData('text/board-card-id', card.id);
    e.dataTransfer!.effectAllowed = 'move';
    el.classList.add('is-dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('is-dragging'));

  el.addEventListener('dragover', (e) => {
    // Only react to card drags.
    if (!e.dataTransfer?.types.includes('text/board-card-id')) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    el.classList.toggle('drop-before', before);
    el.classList.toggle('drop-after', !before);
  });
  el.addEventListener('dragleave', () => {
    el.classList.remove('drop-before', 'drop-after');
  });
  el.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.types.includes('text/board-card-id')) return;
    e.preventDefault();
    e.stopPropagation();  // prevent the column-list drop handler from also firing
    const id = e.dataTransfer.getData('text/board-card-id');
    if (!id || id === card.id) {
      el.classList.remove('drop-before', 'drop-after');
      return;
    }
    const before = el.classList.contains('drop-before');
    el.classList.remove('drop-before', 'drop-after');
    // Compute new ordering: remove dragged, re-insert relative to current card.
    const others = board.cards.filter((c) => c.id !== id);
    const targetIdx = others.findIndex((c) => c.id === card.id);
    const insertAt = before ? targetIdx : targetIdx + 1;
    const dragged = board.cards.find((c) => c.id === id);
    if (!dragged) return;
    const movedStatus = { ...dragged, values: { ...dragged.values, Status: card.values.Status || '' } };
    others.splice(insertAt, 0, movedStatus);
    mutate({ ...board, cards: others });
  });

  el.addEventListener('click', () => {
    openBoardSidePanel(board, card, (nextCard) => {
      const next: Board = {
        ...board,
        cards: board.cards.map((c) => (c.id === nextCard.id ? nextCard : c)),
      };
      mutate(next);
    });
  });

  return el;
}

function bodyPreview(body: string): string {
  if (!body) return '';
  // Strip simple markdown: leading #, *, -, [task] markers.
  const lines = body
    .split('\n')
    .map((l) => l.replace(/^\s*[#>\-*]\s*\[.\]\s*/, '').replace(/^\s*[#>\-*]\s*/, '').trim())
    .filter(Boolean);
  return lines[0] || '';
}

function renderChips(board: Board, card: Card): HTMLElement | null {
  const visible = board.fields.filter(
    (f) => f.visibleOnCard && f.name !== 'Title' && f.name !== 'Status',
  );
  if (visible.length === 0) return null;
  const row = document.createElement('div');
  row.className = 'board-card-chips';
  for (const f of visible) {
    const val = (card.values[f.name] || '').trim();
    if (!val) continue;
    row.appendChild(renderChip(f, val));
  }
  return row.children.length ? row : null;
}

function renderChip(f: FieldDef, val: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `board-chip chip-${f.type}`;
  if (f.type === 'tags') {
    chip.innerHTML = val
      .split(',')
      .map((t) => `<span class="board-tag">${escapeHtml(t.trim())}</span>`)
      .join('');
  } else if (f.type === 'date') {
    chip.textContent = formatDate(val);
    if (isOverdue(val)) chip.classList.add('is-overdue');
  } else if (f.type === 'person') {
    const initial = val.replace(/^@/, '').charAt(0).toUpperCase();
    chip.innerHTML = `<span class="board-avatar">${escapeHtml(initial)}</span><span>${escapeHtml(val)}</span>`;
  } else {
    chip.textContent = val;
  }
  return chip;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isOverdue(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nextColor(used: string[]): ColorToken {
  const all: ColorToken[] = ['blue', 'amber', 'emerald', 'red', 'purple', 'gray'];
  return all.find((c) => !used.includes(c)) ?? 'gray';
}
