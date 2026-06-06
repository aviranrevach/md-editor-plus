// src/webview/boardKanbanRender.ts
// Kanban renderer: owns all the DOM-building helpers that were previously
// private to boardBlock.ts.  The controller (boardBlock.ts) creates a
// BoardRendererCtx and calls mountKanban(); this module handles everything
// that happens inside the board's root element.

import type { Board, Card, FieldDef, ColorToken } from './boardModel';
import { COLOR_TOKENS_PUBLIC, mintCardId } from './boardModel';
import type { BoardRendererCtx, BoardRendererOps } from './boardBlock';

export function mountKanban(ctx: BoardRendererCtx): BoardRendererOps {
  function paint(board: Board): void {
    const ro = ctx.readonly;
    ctx.root.innerHTML = '';
    ctx.root.appendChild(renderColumns(board, ctx.mutate, ro, ctx));
  }

  // Initial paint.
  paint(ctx.getBoard());

  return {
    update(next: Board): void {
      const heightSnapshot = snapshotColumnHeights(ctx.root);
      const scrollLeftBefore =
        (ctx.root.querySelector('.board-columns') as HTMLElement | null)?.scrollLeft ?? 0;
      paint(next);
      // Restore horizontal scroll on the freshly-rendered columns row so adding
      // a card in a column you scrolled to doesn't jerk the board back to the start.
      const cols = ctx.root.querySelector('.board-columns') as HTMLElement | null;
      if (cols) cols.scrollLeft = scrollLeftBefore;
      animateColumnHeights(ctx.root, heightSnapshot);
    },
    destroy(): void {
      ctx.root.innerHTML = '';
    },
  };
}

// ---------------------------------------------------------------------------
// Columns row
// ---------------------------------------------------------------------------

function renderColumns(board: Board, mutate: (next: Board) => void, readOnly: boolean, ctx: BoardRendererCtx): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-columns';
  if (!readOnly) attachEdgeScroll(row);
  const validNames = new Set(board.columns.map((c) => c.name));
  for (const col of board.columns) {
    row.appendChild(renderColumn(board, col, mutate, readOnly, ctx));
  }
  const orphans = board.cards.filter((c) => !validNames.has(c.values.Status || ''));
  if (orphans.length) {
    row.appendChild(renderUncategorized(board, orphans, mutate, readOnly, ctx));
  }

  if (!readOnly) {
    // Tall "+ Add column" button at the end of the row. To make its height
    // match an empty new column EXACTLY, mirror the column's internal DOM
    // structure (.board-column-body wrapping a spacer head + a placeholder
    // add-card). That way the same CSS rules size both, so any change to
    // column-head / column-body / add-card spacing applies to the + button
    // too with no extra math.
    const addBig = document.createElement('button');
    addBig.type = 'button';
    addBig.className = 'board-add-column-big';
    addBig.title = 'Add column';
    // The hidden head + hidden add-card MUST contain real text content so
    // their height matches a real column's children (line-height calculation
    // depends on actual rendered text, not just padding). visibility:hidden
    // keeps them invisible without removing them from layout.
    addBig.innerHTML = `
      <div class="board-column-body board-add-column-mirror">
        <div class="board-column-head" aria-hidden="true">
          <span class="board-column-chip"><span class="board-column-chip-dot"></span><span class="board-column-name">x</span></span>
        </div>
        <div class="board-add-column-glyph">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
            <path d="M8 3.5v9M3.5 8h9"/>
          </svg>
        </div>
        <div class="board-add-card board-add-column-spacer" aria-hidden="true">+ New card</div>
      </div>
    `;
    addBig.addEventListener('click', () => {
      const base = 'New';
      let nm = base;
      let n = 2;
      while (board.columns.some((c) => c.name === nm)) nm = `${base} ${n++}`;
      const color = nextColor(board.columns.map((c) => c.color));
      mutate({ ...board, columns: [...board.columns, { name: nm, color }] });
      // After mutate(), the row variable references a now-detached element.
      // Query the FRESH DOM via the board id (set as data-board-id on .board-block).
      requestAnimationFrame(() => {
        const boardDom = board.id
          ? (document.querySelector(`.board-block[data-board-id="${board.id}"]`) as HTMLElement | null)
          : null;
        if (!boardDom) return;
        const newColDom = boardDom.querySelector(
          `.board-column[data-column="${cssEscape(nm)}"]`,
        ) as HTMLElement | null;
        if (!newColDom) return;
        // Focus first with preventScroll so the focus-induced auto-scroll
        // doesn't fight the smooth scroll below.
        const nameEl = newColDom.querySelector('.board-column-name') as HTMLElement | null;
        if (nameEl) {
          nameEl.focus({ preventScroll: true });
          selectAllText(nameEl);
        }
        newColDom.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
      });
    });
    row.appendChild(addBig);
  }

  return row;
}

// ---------------------------------------------------------------------------
// Single column
// ---------------------------------------------------------------------------

function renderColumn(board: Board, col: { name: string; color: string }, mutate: (next: Board) => void, readOnly: boolean, ctx: BoardRendererCtx): HTMLElement {
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
      el.classList.add('is-dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('is-dragging');
    });
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('text/board-column-name')) return;
      e.preventDefault();
      // Visual indicator: vertical blue line on left or right depending on cursor side.
      const rect = el.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      el.classList.toggle('drop-col-before', before);
      el.classList.toggle('drop-col-after', !before);
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drop-col-before', 'drop-col-after');
    });
    el.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.types.includes('text/board-column-name')) return;
      const draggedName = e.dataTransfer.getData('text/board-column-name');
      el.classList.remove('drop-col-before', 'drop-col-after');
      if (!draggedName || draggedName === col.name) return;
      e.preventDefault();
      e.stopPropagation();
      const before = el.classList.contains('drop-col-before');  // already removed above, recompute from cursor
      // Recompute side from event position (the classes were just cleared above for cleanup).
      const rect = el.getBoundingClientRect();
      const dropBefore = (e.clientX - rect.left) < rect.width / 2;
      const cols = [...board.columns];
      const fromIdx = cols.findIndex((c) => c.name === draggedName);
      const toIdx = cols.findIndex((c) => c.name === col.name);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = cols.splice(fromIdx, 1);
      // Recompute target index since splice may have shifted it.
      const adjustedTo = cols.findIndex((c) => c.name === col.name);
      const insertAt = dropBefore ? adjustedTo : adjustedTo + 1;
      cols.splice(insertAt, 0, moved);
      mutate({ ...board, columns: cols });
      void before;  // referenced but unused
    });
  }

  // Column head: [chip(dot + name)] [count outside] [⋯ on hover]
  const head = document.createElement('div');
  head.className = 'board-column-head';

  const chip = document.createElement('span');
  chip.className = 'board-column-chip';

  const dot = document.createElement(readOnly ? 'span' : 'button');
  dot.className = 'board-column-chip-dot';
  if (!readOnly) {
    (dot as HTMLButtonElement).type = 'button';
    dot.setAttribute('title', 'Change color');
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      openColumnColorPicker(dot as HTMLElement, board, col, mutate);
    });
  }
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
    // Select-all on click so the user sees that the title is now editable
    // and a single keystroke replaces it.
    nameEl.addEventListener('click', () => {
      if (document.activeElement !== nameEl) nameEl.focus();
      selectAllText(nameEl);
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

  // Column body: ★ wraps the header chip AND the card list AND the "+ New card"
  // button — single rounded background for the whole column.
  // Card-drop handlers attached at the body level so empty columns still accept drops.
  const body = document.createElement('div');
  body.className = 'board-column-body';
  body.appendChild(head);

  const list = document.createElement('div');
  list.className = 'board-card-list';
  for (const card of cards) {
    list.appendChild(renderCard(board, card, mutate, readOnly, ctx));
  }
  if (!readOnly) {
    // Listen on the body, not the list, so drops in the empty bottom area of
    // a column (and on empty columns) still register.
    body.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('text/board-card-id')) return;
      e.preventDefault();
      // The card-level dragover handler covers the case where the cursor is
      // over a specific card. The body handler only steps in when the cursor
      // is BELOW the last card (drop at end of list) or when the list is
      // empty. Without this guard, the indicator flickered between the gap
      // between two cards and the bottom of the list as the cursor moved.
      const overCard = (e.target as HTMLElement | null)?.closest('.board-card');
      if (overCard) return;
      const cards = list.querySelectorAll(':scope > .board-card:not(.is-new)');
      if (cards.length === 0) {
        showEndOfListDropIndicator(list);
        return;
      }
      const lastCard = cards[cards.length - 1] as HTMLElement;
      const lastRect = lastCard.getBoundingClientRect();
      if (e.clientY > lastRect.bottom) {
        showEndOfListDropIndicator(list);
      }
      // Cursor is in a gap between cards: leave the indicator wherever the
      // last card-level dragover placed it.
    });
    body.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.types.includes('text/board-card-id')) return;
      e.preventDefault();
      const id = e.dataTransfer.getData('text/board-card-id');
      if (!id) return;
      if ((e as any).__cardDropHandled) {
        removeAllDropIndicators();
        return;
      }
      // No specific card target → drop at end of this column.
      removeAllDropIndicators();
      const others = board.cards.filter((c) => c.id !== id);
      const dragged = board.cards.find((c) => c.id === id);
      if (!dragged) return;
      const moved = { ...dragged, values: { ...dragged.values, Status: col.name } };
      others.push(moved);
      mutate({ ...board, cards: others });
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

// ---------------------------------------------------------------------------
// Inline new-card editing
// ---------------------------------------------------------------------------

// Append a draft card with a focused input to the card list (NOT yet in the
// board model). Commits on Enter or blur with content; discards on Escape or
// blur with empty content. Avoids a full re-render so focus stays in the input
// as the user types.
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
    const id = mintCardId(board.cards.map(c => c.id));
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

// ---------------------------------------------------------------------------
// Uncategorized column
// ---------------------------------------------------------------------------

function renderUncategorized(board: Board, cards: Card[], mutate: (next: Board) => void, readOnly: boolean, ctx: BoardRendererCtx): HTMLElement {
  const el = document.createElement('div');
  el.className = 'board-column color-gray board-column-uncategorized';
  el.dataset.column = '';

  // Head + list share a single rounded body bg.
  const body = document.createElement('div');
  body.className = 'board-column-body';

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
  body.appendChild(head);

  const list = document.createElement('div');
  list.className = 'board-card-list';
  for (const card of cards) list.appendChild(renderCard(board, card, mutate, readOnly, ctx));
  body.appendChild(list);

  el.appendChild(body);
  return el;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function renderCard(board: Board, card: Card, mutate: (next: Board) => void, readOnly: boolean, ctx: BoardRendererCtx): HTMLElement {
  const el = document.createElement('div');
  el.className = 'board-card';
  el.dataset.cardId = card.id;

  const title = document.createElement('div');
  title.className = 'board-card-title';
  title.textContent = card.values.Title || 'Untitled';
  el.appendChild(title);

  // Skip the body preview when the kanban view's Properties popover has hidden
  // the synthetic "Description" entry.
  const kanbanView = board.views.find(v => v.name === 'kanban');
  const descriptionHidden = !!kanbanView?.hidden?.includes('Description');
  const preview = descriptionHidden ? '' : bodyPreview(card.body);
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
    el.addEventListener('dragend', () => {
      el.classList.remove('is-dragging');
      removeAllDropIndicators();
    });
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('text/board-card-id')) return;
      e.preventDefault();
      // Decide whether the indicator goes before or after this card based on
      // where the cursor sits within the card's height.
      const rect = el.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      showCardDropIndicator(el, before);
    });
    el.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.types.includes('text/board-card-id')) return;
      e.preventDefault();
      e.stopPropagation();
      // Mark this event so the column-body drop handler doesn't also fire.
      (e as any).__cardDropHandled = true;
      const id = e.dataTransfer.getData('text/board-card-id');
      if (!id || id === card.id) {
        removeAllDropIndicators();
        return;
      }
      const rect = el.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      removeAllDropIndicators();
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

  // Single click = open side panel. Double click = inline-edit title.
  el.addEventListener('click', () => {
    // Defer so a double-click doesn't open the panel before swapping to inline editor.
    setTimeout(() => {
      if (el.classList.contains('is-editing-title')) return;
      ctx.openSidePanel(card.id);
    }, 180);
  });

  if (!readOnly) {
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startInlineTitleEdit(el, card, board, mutate);
    });
  }

  return el;
}

// ---------------------------------------------------------------------------
// Inline title edit on double-click
// ---------------------------------------------------------------------------

// Replaces the title div with an input, focuses it.
// Commit on Enter/blur; Escape reverts.
function startInlineTitleEdit(
  cardEl: HTMLElement,
  card: Card,
  board: Board,
  mutate: (next: Board) => void,
): void {
  const titleEl = cardEl.querySelector('.board-card-title') as HTMLElement | null;
  if (!titleEl) return;
  if (cardEl.classList.contains('is-editing-title')) return;
  cardEl.classList.add('is-editing-title');

  const original = card.values.Title || '';
  const input = document.createElement('input');
  input.className = 'board-card-title-input';
  input.type = 'text';
  input.value = original;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let resolved = false;
  const commit = () => {
    if (resolved) return;
    resolved = true;
    const next = input.value.trim();
    if (next === original) {
      cardEl.classList.remove('is-editing-title');
      // mutate would re-render anyway; fall back to a direct restore for no-op.
      const restored = document.createElement('div');
      restored.className = 'board-card-title';
      restored.textContent = original || 'Untitled';
      input.replaceWith(restored);
      return;
    }
    mutate({
      ...board,
      cards: board.cards.map((c) =>
        c.id === card.id ? { ...c, values: { ...c.values, Title: next } } : c,
      ),
    });
  };
  const cancel = () => {
    if (resolved) return;
    resolved = true;
    cardEl.classList.remove('is-editing-title');
    const restored = document.createElement('div');
    restored.className = 'board-card-title';
    restored.textContent = original || 'Untitled';
    input.replaceWith(restored);
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
  input.addEventListener('blur', () => setTimeout(commit, 50));
}

// ---------------------------------------------------------------------------
// Chip rendering
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Drop indicators
// ---------------------------------------------------------------------------

// A single thin blue line element that lives in the DOM at the position where
// the dragged card would land. Card-level dragover places it above/below the
// hovered card; column-body dragover places it at the end of the list when
// there's no card under the cursor (covers empty columns).

function removeAllDropIndicators(): void {
  document.querySelectorAll('.board-drop-indicator').forEach((n) => n.remove());
}
function showCardDropIndicator(targetCard: HTMLElement, before: boolean): void {
  removeAllDropIndicators();
  const parent = targetCard.parentElement;
  if (!parent) return;
  const indicator = document.createElement('div');
  indicator.className = 'board-drop-indicator';
  if (before) {
    parent.insertBefore(indicator, targetCard);
  } else {
    parent.insertBefore(indicator, targetCard.nextSibling);
  }
}
function showEndOfListDropIndicator(list: HTMLElement): void {
  // Reuse the existing indicator inside this list if present.
  const existing = list.querySelector(':scope > .board-drop-indicator');
  if (existing && existing === list.lastChild) return;
  removeAllDropIndicators();
  const indicator = document.createElement('div');
  indicator.className = 'board-drop-indicator';
  list.appendChild(indicator);
}

// ---------------------------------------------------------------------------
// Column color picker & column menu
// ---------------------------------------------------------------------------

const COLOR_PALETTE: readonly ColorToken[] = COLOR_TOKENS_PUBLIC;

// Inline SVG icons used in the column menu.
const ICON_EDIT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L6 12l-3 1 1-3 7.5-7.5z"/></svg>`;
const ICON_SORT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h10M5 8h6M7 11h2"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M5.5 4V2.5h5V4M4 4l.5 9.5h7L12 4M6.5 7v4M9.5 7v4"/></svg>`;

function openColumnColorPicker(
  anchor: HTMLElement,
  board: Board,
  col: { name: string; color: string },
  mutate: (next: Board) => void,
): void {
  document.querySelectorAll('.board-column-menu').forEach((n) => n.remove());

  const menu = document.createElement('div');
  menu.className = 'board-column-menu board-column-menu-color-only';
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'absolute';
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;

  const colorRow = document.createElement('div');
  colorRow.className = 'board-color-swatches';
  for (const tok of COLOR_PALETTE) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = `board-color-swatch color-${tok}`;
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

  function closeMenu(): void {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
  }
  function onOutside(e: MouseEvent): void {
    if (!menu.contains(e.target as Node) && e.target !== anchor) {
      closeMenu();
    }
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

  // Edge-aware: nudge left if it would overflow the right edge.
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    const overflowRight = r.right - window.innerWidth;
    if (overflowRight > 0) {
      menu.style.left = `${Math.max(8, parseFloat(menu.style.left) - overflowRight - 8)}px`;
    }
  });
}

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

  const section = (label: string) => {
    const s = document.createElement('div');
    s.className = 'board-column-menu-section';
    s.textContent = label;
    menu.appendChild(s);
  };

  const row = (icon: string, label: string, variant: '' | 'danger', onClick: () => void) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'board-column-menu-row' + (variant ? ` is-${variant}` : '');
    btn.innerHTML = `<span class="board-column-menu-icon">${icon}</span><span class="board-column-menu-label">${label}</span>`;
    btn.addEventListener('click', onClick);
    menu.appendChild(btn);
    return btn;
  };

  // Color picker
  section('Color');
  const colorRow = document.createElement('div');
  colorRow.className = 'board-color-swatches';
  for (const tok of COLOR_PALETTE) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = `board-color-swatch color-${tok}`;
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

  const divider1 = document.createElement('div');
  divider1.className = 'board-column-menu-divider';
  menu.appendChild(divider1);

  // Rename — focuses the inline column name input on the source column
  row(ICON_EDIT, 'Rename', '', () => {
    closeMenu();
    // Find the column DOM and focus its name span. The board re-renders on
    // mutate, so reading the live DOM right now is safe.
    const colEl = document.querySelector(`.board-column[data-column="${cssEscape(col.name)}"]`);
    const nameEl = colEl?.querySelector('.board-column-name') as HTMLElement | null;
    if (nameEl) {
      nameEl.focus();
      const range = document.createRange();
      range.selectNodeContents(nameEl);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });

  // Sort cards by title
  row(ICON_SORT, 'Sort cards by title', '', () => {
    const inCol = board.cards.filter((c) => (c.values.Status || '') === col.name);
    const others = board.cards.filter((c) => (c.values.Status || '') !== col.name);
    inCol.sort((a, b) => (a.values.Title || '').localeCompare(b.values.Title || ''));
    mutate({ ...board, cards: [...others, ...inCol] });
    closeMenu();
  });

  const divider2 = document.createElement('div');
  divider2.className = 'board-column-menu-divider';
  menu.appendChild(divider2);

  // Move to trash
  row(ICON_TRASH, 'Move to trash', 'danger', () => {
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

  function closeMenu(): void {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
  }
  function onOutside(e: MouseEvent): void {
    if (!menu.contains(e.target as Node) && e.target !== anchor) {
      closeMenu();
    }
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
  }, 0);
}

// ---------------------------------------------------------------------------
// Edge-scroll while dragging
// ---------------------------------------------------------------------------

// When the user drags a card (or column) near the left/right edge of the
// columns row and the row has horizontal overflow, auto-scroll in that
// direction so they can drop into an off-screen column.
function attachEdgeScroll(row: HTMLElement): void {
  const EDGE = 90;       // px from edge that triggers scrolling
  const MAX_SPEED = 22;  // px per frame at the very edge
  let raf: number | null = null;
  let velocity = 0;

  function loop() {
    if (Math.abs(velocity) < 0.5) {
      raf = null;
      return;
    }
    row.scrollLeft += velocity;
    raf = requestAnimationFrame(loop);
  }

  row.addEventListener('dragover', (e) => {
    const types = e.dataTransfer?.types;
    if (!types || (!types.includes('text/board-card-id') && !types.includes('text/board-column-name'))) return;
    const rect = row.getBoundingClientRect();
    const leftDist = e.clientX - rect.left;
    const rightDist = rect.right - e.clientX;
    if (leftDist < EDGE && leftDist >= 0) {
      velocity = -MAX_SPEED * (1 - leftDist / EDGE);
    } else if (rightDist < EDGE && rightDist >= 0) {
      velocity = MAX_SPEED * (1 - rightDist / EDGE);
    } else {
      velocity = 0;
    }
    if (velocity !== 0 && raf === null) raf = requestAnimationFrame(loop);
  });

  const stop = () => {
    velocity = 0;
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  };
  row.addEventListener('dragleave', (e) => {
    // dragleave fires when the cursor crosses any child boundary; only stop
    // when actually leaving the row.
    const rt = e.relatedTarget as Node | null;
    if (rt && row.contains(rt)) return;
    stop();
  });
  row.addEventListener('drop', stop);
  // dragend bubbles from the source element (card/column) up to the row.
  row.addEventListener('dragend', stop);
}

// ---------------------------------------------------------------------------
// Gentle height transition (FLIP-style) when columns grow/shrink
// ---------------------------------------------------------------------------

// Triggered whenever update() re-renders the board: snapshot each column
// body's height before mutation, then on the freshly rendered DOM lock each
// body to its old height, force a reflow, and transition to the new natural
// height.
function snapshotColumnHeights(boardDom: HTMLElement): Map<string, number> {
  const map = new Map<string, number>();
  const cols = boardDom.querySelectorAll('.board-column');
  cols.forEach((col) => {
    const name = (col as HTMLElement).dataset.column ?? '';
    const body = col.querySelector(':scope > .board-column-body') as HTMLElement | null;
    if (body) map.set(name, body.getBoundingClientRect().height);
  });
  return map;
}

function animateColumnHeights(boardDom: HTMLElement, prev: Map<string, number>): void {
  const cols = boardDom.querySelectorAll('.board-column');
  cols.forEach((col) => {
    const name = (col as HTMLElement).dataset.column ?? '';
    const body = col.querySelector(':scope > .board-column-body') as HTMLElement | null;
    if (!body) return;
    const oldH = prev.get(name);
    if (oldH == null) return;
    const newH = body.getBoundingClientRect().height;
    if (Math.abs(oldH - newH) < 1) return;
    body.style.height = `${oldH}px`;
    body.style.transition = 'none';
    void body.offsetHeight;
    body.style.transition = 'height 260ms cubic-bezier(0.2, 0, 0, 1)';
    body.style.height = `${newH}px`;
    const cleanup = () => {
      body.style.height = '';
      body.style.transition = '';
      body.removeEventListener('transitionend', cleanup);
    };
    body.addEventListener('transitionend', cleanup);
    window.setTimeout(cleanup, 380);
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function selectAllText(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function cssEscape(s: string): string {
  // Minimal CSS attr-value escape for use in `[data-column="..."]` selectors.
  return s.replace(/(["\\])/g, '\\$1');
}

function nextColor(used: string[]): ColorToken {
  return COLOR_TOKENS_PUBLIC.find((c) => !used.includes(c)) ?? COLOR_TOKENS_PUBLIC[0];
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
