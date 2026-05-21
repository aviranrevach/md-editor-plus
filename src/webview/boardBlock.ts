// src/webview/boardBlock.ts
import { parseBoardSource, serializeBoard, type Board, type Card, type FieldDef, type ColorToken } from './boardModel';
import { openBoardSidePanel } from './boardSidePanel';
import { openPropertiesMenu } from './boardProperties';

export interface BoardView {
  dom: HTMLElement;
  update(source: string): void;
}

export interface BoardViewOptions {
  onMutate(nextSource: string): void;
  isReadOnly(): boolean;
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
    const ro = opts.isReadOnly();
    dom.innerHTML = '';
    dom.appendChild(renderChrome(board, mutate, ro));
    dom.appendChild(renderColumns(board, mutate, ro));
  }

  return {
    dom,
    update(source: string): void {
      board = parseBoardSource(source);
      render();
    },
  };
}

function renderChrome(board: Board, mutate: (next: Board) => void, readOnly: boolean): HTMLElement {
  const chrome = document.createElement('div');
  chrome.className = 'board-chrome';

  const name = document.createElement('div');
  name.className = 'board-name';
  name.contentEditable = readOnly ? 'false' : 'true';
  name.textContent = board.name || '';
  name.dataset.placeholder = 'Untitled board';
  if (!board.name) name.classList.add('is-placeholder');
  if (!readOnly) {
    name.addEventListener('input', () => {
      name.classList.toggle('is-placeholder', !name.textContent);
    });
    name.addEventListener('blur', () => {
      const next = name.textContent || '';
      if (next !== board.name) mutate({ ...board, name: next });
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        name.blur();
      }
    });
  }
  chrome.appendChild(name);

  if (!readOnly) {
    const props = document.createElement('button');
    props.type = 'button';
    props.className = 'board-properties-btn';
    props.title = 'Properties';
    props.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="2" y1="4" x2="14" y2="4"/>
        <line x1="2" y1="8" x2="14" y2="8"/>
        <line x1="2" y1="12" x2="14" y2="12"/>
        <circle cx="5" cy="4" r="1.5" fill="currentColor"/>
        <circle cx="10" cy="8" r="1.5" fill="currentColor"/>
        <circle cx="6" cy="12" r="1.5" fill="currentColor"/>
      </svg>
    `;
    props.addEventListener('click', () => openPropertiesMenu(props, board, mutate));
    chrome.appendChild(props);
  }
  return chrome;
}

function renderColumns(board: Board, mutate: (next: Board) => void, readOnly: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-columns';
  const validNames = new Set(board.columns.map((c) => c.name));
  for (const col of board.columns) {
    row.appendChild(renderColumn(board, col, mutate, readOnly));
  }
  const orphans = board.cards.filter((c) => !validNames.has(c.values.Status || ''));
  if (orphans.length) {
    row.appendChild(renderUncategorized(board, orphans, mutate, readOnly));
  }
  if (!readOnly) {
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
  }
  return row;
}

function renderColumn(board: Board, col: { name: string; color: string }, mutate: (next: Board) => void, readOnly: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = `board-column color-${col.color}`;
  el.dataset.column = col.name;

  const cards = board.cards.filter((c) => (c.values.Status || '') === col.name);

  if (!readOnly) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
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
  }

  // Column head: [chip(dot + name)] [count outside] [⋯ on hover]
  const head = document.createElement('div');
  head.className = 'board-column-head';

  const chip = document.createElement('span');
  chip.className = 'board-column-chip';

  const dot = document.createElement('span');
  dot.className = 'board-column-chip-dot';
  chip.appendChild(dot);

  const nameEl = document.createElement('span');
  nameEl.className = 'board-column-name';
  nameEl.contentEditable = readOnly ? 'false' : 'true';
  nameEl.textContent = col.name;
  if (!readOnly) {
    nameEl.addEventListener('blur', () => {
      const newName = nameEl.textContent?.trim();
      if (!newName || newName === col.name) {
        nameEl.textContent = col.name;
        return;
      }
      if (board.columns.some((c) => c.name === newName)) {
        nameEl.textContent = col.name;
        return;
      }
      const cols = board.columns.map((c) =>
        c.name === col.name ? { ...c, name: newName } : c,
      );
      const cards2 = board.cards.map((c) =>
        (c.values.Status || '') === col.name
          ? { ...c, values: { ...c.values, Status: newName } }
          : c,
      );
      mutate({ ...board, columns: cols, cards: cards2 });
    });
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameEl.blur();
      }
    });
  }
  chip.appendChild(nameEl);
  head.appendChild(chip);

  const count = document.createElement('span');
  count.className = 'board-column-count';
  count.textContent = String(cards.length);
  head.appendChild(count);

  if (!readOnly) {
    const dots = document.createElement('button');
    dots.type = 'button';
    dots.className = 'board-column-dots';
    dots.textContent = '⋯';
    dots.title = 'Column options';
    dots.addEventListener('click', (e) => {
      e.stopPropagation();
      openColumnMenu(dots, board, col, mutate);
    });
    head.appendChild(dots);
  }

  el.appendChild(head);

  // Column body: card list + + New card button inside the rounded gray panel
  const body = document.createElement('div');
  body.className = 'board-column-body';

  const list = document.createElement('div');
  list.className = 'board-card-list';
  for (const card of cards) {
    list.appendChild(renderCard(board, card, mutate, readOnly));
  }
  if (!readOnly) {
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
  }
  body.appendChild(list);

  if (!readOnly) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'board-add-card';
    add.textContent = '+ New card';
    add.addEventListener('click', () => {
      startInlineNewCard(list, add, col.name, board, mutate);
    });
    body.appendChild(add);
  }

  el.appendChild(body);

  return el;
}

// Inline new-card editing: append a draft card with a focused input to the
// card list (NOT yet in the board model). Commits on Enter or blur with content;
// discards on Escape or blur with empty content. Avoids a full re-render so
// focus stays in the input as the user types.
function startInlineNewCard(
  list: HTMLElement,
  addBtn: HTMLElement,
  columnName: string,
  board: Board,
  mutate: (next: Board) => void,
): void {
  // Don't stack multiple drafts.
  if (list.querySelector('.board-card.is-new')) {
    const existing = list.querySelector('.board-card.is-new input') as HTMLInputElement | null;
    existing?.focus();
    return;
  }

  const draft = document.createElement('div');
  draft.className = 'board-card is-new';
  const input = document.createElement('input');
  input.className = 'board-card-title-input';
  input.type = 'text';
  input.placeholder = 'Type a name…';
  draft.appendChild(input);
  list.appendChild(draft);
  // Hide the add button while editing so the draft is the visible action.
  addBtn.style.display = 'none';

  let committed = false;
  const commit = () => {
    if (committed) return;
    const title = input.value.trim();
    if (!title) {
      cancel();
      return;
    }
    committed = true;
    const id = `c-${Math.random().toString(36).slice(2, 6)}`;
    const newCard: Card = {
      id,
      values: { id, Title: title, Status: columnName },
      body: '',
    };
    mutate({ ...board, cards: [...board.cards, newCard] });
    // mutate() triggers a full re-render; nothing else to clean up locally.
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    draft.remove();
    addBtn.style.display = '';
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener('blur', () => {
    // Use setTimeout so a click on the same column doesn't race against blur.
    setTimeout(commit, 50);
  });

  input.focus();
}

function renderUncategorized(board: Board, cards: Card[], mutate: (next: Board) => void, readOnly: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'board-column color-gray board-column-uncategorized';
  el.dataset.column = '';

  const head = document.createElement('div');
  head.className = 'board-column-head';
  const chip = document.createElement('span');
  chip.className = 'board-column-chip';
  const dot = document.createElement('span');
  dot.className = 'board-column-chip-dot';
  chip.appendChild(dot);
  const nameEl = document.createElement('span');
  nameEl.className = 'board-column-name';
  nameEl.textContent = 'Uncategorized';
  chip.appendChild(nameEl);
  head.appendChild(chip);
  const count = document.createElement('span');
  count.className = 'board-column-count';
  count.textContent = String(cards.length);
  head.appendChild(count);
  el.appendChild(head);

  const body = document.createElement('div');
  body.className = 'board-column-body';
  const list = document.createElement('div');
  list.className = 'board-card-list';
  for (const card of cards) list.appendChild(renderCard(board, card, mutate, readOnly));
  body.appendChild(list);
  el.appendChild(body);
  return el;
}

function renderCard(board: Board, card: Card, mutate: (next: Board) => void, readOnly: boolean): HTMLElement {
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

  if (!readOnly) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData('text/board-card-id', card.id);
      e.dataTransfer!.effectAllowed = 'move';
      el.classList.add('is-dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
    el.addEventListener('dragover', (e) => {
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
      e.stopPropagation();
      const id = e.dataTransfer.getData('text/board-card-id');
      if (!id || id === card.id) {
        el.classList.remove('drop-before', 'drop-after');
        return;
      }
      const before = el.classList.contains('drop-before');
      el.classList.remove('drop-before', 'drop-after');
      const others = board.cards.filter((c) => c.id !== id);
      const targetIdx = others.findIndex((c) => c.id === card.id);
      const insertAt = before ? targetIdx : targetIdx + 1;
      const dragged = board.cards.find((c) => c.id === id);
      if (!dragged) return;
      const movedStatus = { ...dragged, values: { ...dragged.values, Status: card.values.Status || '' } };
      others.splice(insertAt, 0, movedStatus);
      mutate({ ...board, cards: others });
    });
  }

  el.addEventListener('click', () => {
    openBoardSidePanel(
      board,
      card,
      readOnly
        ? () => {}
        : (nextCard) => {
            const next: Board = {
              ...board,
              cards: board.cards.map((c) => (c.id === nextCard.id ? nextCard : c)),
            };
            mutate(next);
          },
      readOnly,
    );
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

const COLOR_PALETTE: ColorToken[] =
  ['gray', 'blue', 'amber', 'emerald', 'red', 'purple'];

function openColumnMenu(
  anchor: HTMLElement,
  board: Board,
  col: { name: string; color: string },
  mutate: (next: Board) => void,
): void {
  // Close any existing menu first
  document.querySelectorAll('.board-column-menu').forEach((n) => n.remove());

  const menu = document.createElement('div');
  menu.className = 'board-column-menu';
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'absolute';
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;

  // Row 1: color swatches
  const colorRow = document.createElement('div');
  colorRow.className = 'board-color-swatches';
  for (const tok of COLOR_PALETTE) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'board-color-swatch';
    swatch.style.background = `var(--color-${tok})`;
    swatch.title = tok;
    if (col.color === tok) swatch.classList.add('is-selected');
    swatch.addEventListener('click', () => {
      const cols = board.columns.map((c) =>
        c.name === col.name ? { ...c, color: tok } : c,
      );
      mutate({ ...board, columns: cols });
      closeMenu();
    });
    colorRow.appendChild(swatch);
  }
  menu.appendChild(colorRow);

  // Row 2: sort cards by title
  const sortBtn = document.createElement('button');
  sortBtn.type = 'button';
  sortBtn.textContent = 'Sort cards by title';
  sortBtn.addEventListener('click', () => {
    const inCol = board.cards.filter((c) => (c.values.Status || '') === col.name);
    const others = board.cards.filter((c) => (c.values.Status || '') !== col.name);
    inCol.sort((a, b) => (a.values.Title || '').localeCompare(b.values.Title || ''));
    mutate({ ...board, cards: [...others, ...inCol] });
    closeMenu();
  });
  menu.appendChild(sortBtn);

  // Row 3: delete column
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.textContent = 'Delete column';
  delBtn.addEventListener('click', () => {
    const cardsInCol = board.cards.filter((c) => (c.values.Status || '') === col.name);
    if (cardsInCol.length > 0) {
      const otherCols = board.columns.filter((c) => c.name !== col.name);
      const choice = prompt(
        `Column "${col.name}" has ${cardsInCol.length} card(s). Move to which column? (Leave empty to delete cards.) Options: ${otherCols.map((c) => c.name).join(', ')}`,
        otherCols[0]?.name || '',
      );
      if (choice === null) {
        closeMenu();
        return; // canceled
      }
      let nextCards: Card[];
      if (choice && otherCols.some((c) => c.name === choice)) {
        nextCards = board.cards.map((c) =>
          (c.values.Status || '') === col.name
            ? { ...c, values: { ...c.values, Status: choice } }
            : c,
        );
      } else {
        nextCards = board.cards.filter((c) => (c.values.Status || '') !== col.name);
      }
      const nextCols = board.columns.filter((c) => c.name !== col.name);
      mutate({ ...board, columns: nextCols, cards: nextCards });
    } else {
      mutate({ ...board, columns: board.columns.filter((c) => c.name !== col.name) });
    }
    closeMenu();
  });
  menu.appendChild(delBtn);

  function closeMenu(): void {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
  }
  function onOutside(e: MouseEvent): void {
    if (!menu.contains(e.target as Node) && e.target !== anchor) {
      closeMenu();
    }
  }
  // Defer attaching so the current click doesn't immediately close the menu
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
  }, 0);
}
