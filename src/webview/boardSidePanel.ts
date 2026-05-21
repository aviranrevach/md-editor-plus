// src/webview/boardSidePanel.ts
import type { Board, Card, FieldType } from './boardModel';
import { createEditor } from './editor';
import { promptNewField, openFieldActionMenu } from './boardProperties';
import { FIELD_TYPE_ICONS, ICON_PLUS, ICON_CLOSE, ICON_CHEVRON_DOWN, ICON_CHECK } from './boardIcons';

let panel: HTMLElement | null = null;
let currentBoard: Board | null = null;
let currentCard: Card | null = null;
let currentOnChange: ((next: Card) => void) | null = null;
let currentOnBoardChange: ((next: Board) => void) | null = null;
let currentReadOnly = false;
// Name of a field whose label should render as an inline-editable input on
// the next renderPanel call. Used immediately after "+ Add a property" so
// the user can rename the just-added field in place (Option D flow).
let renamingFieldName: string | null = null;

export function initBoardSidePanel(): void {
  if (panel) return;
  panel = document.createElement('aside');
  panel.className = 'board-side-panel';
  panel.style.display = 'none';
  document.body.appendChild(panel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel && panel.style.display !== 'none') {
      // Don't close if an open popover (status dropdown / add-prop picker) is on screen.
      if (document.querySelector('.board-status-dropdown, .board-add-field-picker')) return;
      closeBoardSidePanel();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!panel || panel.style.display === 'none') return;
    if (panel.contains(e.target as Node)) return;
    const target = e.target as HTMLElement;
    // Click on a card opens a new panel; don't auto-close in that case.
    if (target.closest('.board-card')) return;
    // Click inside a popover spawned BY the panel; don't close.
    if (target.closest('.board-status-dropdown, .board-add-field-picker')) return;
    // If focus is inside the panel (e.g. an inline-rename input or a
    // contenteditable field), defer the close so the focused element's
    // blur handler can commit its pending edit BEFORE we tear down the
    // panel state. Without this, mousedown synchronously clears
    // currentBoard/currentOnBoardChange and the blur-driven commit
    // returns early as a no-op — losing the edit.
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && panel.contains(activeEl)) {
      setTimeout(() => closeBoardSidePanel(), 0);
      return;
    }
    closeBoardSidePanel();
  });
}

export function openBoardSidePanel(
  board: Board,
  card: Card,
  onChange: (next: Card) => void,
  readOnly: boolean = false,
  onBoardChange?: (next: Board) => void,
): void {
  initBoardSidePanel();
  currentBoard = board;
  currentCard = card;
  currentOnChange = onChange;
  currentOnBoardChange = onBoardChange ?? null;
  currentReadOnly = readOnly;
  renderPanel();
  panel!.style.display = 'block';
}

export function closeBoardSidePanel(): void {
  if (!panel) return;
  panel.style.display = 'none';
  currentBoard = null;
  currentCard = null;
  currentOnChange = null;
  currentOnBoardChange = null;
  currentReadOnly = false;
  renamingFieldName = null;
}

// === Commit helpers. Crucially, they update the module-level currentCard /
// currentBoard BEFORE notifying the outside world, so subsequent edits inside
// the panel read the latest state rather than the stale closure values from
// when renderPanel ran. Fixes the "edits don't save" / "edits overwrite each
// other" bug. ===
function commitCard(updater: (c: Card) => Card): void {
  if (!currentCard || !currentOnChange) return;
  const next = updater(currentCard);
  currentCard = next;
  currentOnChange(next);
}
function commitBoard(next: Board): void {
  currentBoard = next;
  // Refresh currentCard against the new board so subsequent card edits stay
  // consistent (the card's field values might be untouched, but a schema
  // change like "add property" expands the cards' values map).
  if (currentCard) {
    const refreshed = next.cards.find((c) => c.id === currentCard!.id);
    if (refreshed) currentCard = refreshed;
  }
  currentOnBoardChange?.(next);
  // Re-render to show new fields / updated schema.
  renderPanel();
}

function renderPanel(): void {
  if (!panel || !currentBoard || !currentCard) return;

  panel.innerHTML = '';

  // === Toolbar (just close) ===
  const toolbar = document.createElement('div');
  toolbar.className = 'board-panel-toolbar';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'board-panel-close';
  close.title = 'Close';
  close.innerHTML = ICON_CLOSE;
  close.addEventListener('click', closeBoardSidePanel);
  toolbar.appendChild(close);
  panel.appendChild(toolbar);

  // === Scrollable container ===
  const wrap = document.createElement('div');
  wrap.className = 'board-panel-wrap';
  panel.appendChild(wrap);

  wrap.appendChild(renderTitle());
  wrap.appendChild(renderProperties());

  const divider = document.createElement('div');
  divider.className = 'board-panel-divider';
  wrap.appendChild(divider);

  wrap.appendChild(renderBody());
}

function renderTitle(): HTMLElement {
  const card = currentCard!;
  const title = document.createElement('div');
  title.className = 'board-panel-title';
  title.contentEditable = currentReadOnly ? 'false' : 'true';
  const initialTitle = card.values.Title || '';
  title.textContent = initialTitle;
  title.dataset.placeholder = 'Untitled';
  if (!initialTitle) title.classList.add('is-placeholder');
  if (!currentReadOnly) {
    title.addEventListener('input', () => {
      title.classList.toggle('is-placeholder', !title.textContent);
    });
    title.addEventListener('blur', () => {
      commitCard((c) => ({ ...c, values: { ...c.values, Title: title.textContent || '' } }));
    });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        title.blur();
      }
    });
    title.addEventListener('click', () => {
      if (document.activeElement !== title) title.focus();
      selectAllText(title);
    });
  }
  return title;
}

function renderProperties(): HTMLElement {
  const board = currentBoard!;
  const props = document.createElement('div');
  props.className = 'board-panel-props';
  for (const field of board.fields) {
    if (field.name === 'Title') continue;
    if (!field.visibleOnCard && field.name === 'id') continue;
    props.appendChild(renderPropRow(field));
  }
  if (!currentReadOnly) {
    const addProp = document.createElement('button');
    addProp.type = 'button';
    addProp.className = 'board-panel-add-prop';
    addProp.innerHTML = `
      <span class="board-panel-prop-icon">${ICON_PLUS}</span>
      <span class="board-panel-prop-label">Add a property</span>
    `;
    addProp.addEventListener('click', () => {
      if (!currentBoard) return;
      promptNewField(addProp, currentBoard, (nextBoard, newFieldName) => {
        // Drop the user straight into renaming the freshly-added field in
        // its real spot in the property list (no separate name input).
        renamingFieldName = newFieldName;
        commitBoard(nextBoard);
      });
    });
    props.appendChild(addProp);
  }
  return props;
}

function renderPropRow(field: { name: string; type: FieldType; visibleOnCard: boolean }): HTMLElement {
  const board = currentBoard!;
  const card = currentCard!;
  const row = document.createElement('div');
  row.className = 'board-panel-prop-row';
  row.dataset.fieldName = field.name;

  const icon = document.createElement('span');
  icon.className = 'board-panel-prop-icon';
  icon.innerHTML = FIELD_TYPE_ICONS[field.type] || FIELD_TYPE_ICONS.text;
  row.appendChild(icon);

  // Label slot: usually a static <span>, but for the just-added field we
  // swap in an inline input so the user can name it in place.
  if (field.name === renamingFieldName && !currentReadOnly) {
    row.classList.add('is-renaming');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'board-panel-prop-label-input';
    input.value = field.name;
    input.spellcheck = false;
    row.appendChild(input);

    const finish = (commit: boolean) => {
      if (!currentBoard || renamingFieldName !== field.name) return;
      const oldName = field.name;
      renamingFieldName = null;
      const newName = input.value.trim();
      if (!commit || !newName || newName === oldName) {
        // Cancel / no-op rename — keep the default name and re-render to
        // drop the input.
        renderPanel();
        return;
      }
      if (currentBoard.fields.some((f) => f.name === newName)) {
        // Duplicate — revert silently. (Could highlight in red; keeping
        // simple for v1.)
        renderPanel();
        return;
      }
      const renamed: Board = {
        ...currentBoard,
        fields: currentBoard.fields.map((f) =>
          f.name === oldName ? { ...f, name: newName } : f,
        ),
        cards: currentBoard.cards.map((c) => {
          const v: Record<string, string> = { ...c.values };
          if (oldName in v) {
            v[newName] = v[oldName];
            delete v[oldName];
          }
          return { ...c, values: v };
        }),
      };
      commitBoard(renamed);
    };

    input.addEventListener('keydown', (e) => {
      // Don't let Enter/Escape bubble to the global keydown listener that
      // closes the whole panel on Escape; the rename should be its own
      // commit/cancel scope.
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));

    // Focus + select-all after the DOM is inserted.
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  } else {
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'board-panel-prop-label';
    label.textContent = field.name;
    // Click the label → open the field action menu (Rename / Hide / Delete).
    // Locked fields (Status) don't get a menu trigger.
    const isLocked = field.name === 'Status';
    if (!currentReadOnly && !isLocked) {
      label.classList.add('is-clickable');
      label.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!currentBoard) return;
        openFieldActionMenu(label, currentBoard, field, (nextBoard) => {
          commitBoard(nextBoard);
        }, {
          onRename: () => {
            renamingFieldName = field.name;
            renderPanel();
          },
        });
      });
    }
    row.appendChild(label);
  }

  const rawValue = (card.values[field.name] || '').trim();

  if (field.type === 'date') {
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'board-panel-prop-value';
    input.value = card.values[field.name] || '';
    input.disabled = currentReadOnly;
    if (!rawValue) input.placeholder = 'Empty';
    if (!currentReadOnly) {
      input.addEventListener('change', () => {
        commitCard((c) => ({ ...c, values: { ...c.values, [field.name]: input.value } }));
      });
      // Native date inputs only pop the calendar when you click the calendar
      // glyph at the far right. Calling showPicker() on any click lets the
      // whole field act as a picker trigger while still allowing typing.
      input.addEventListener('mousedown', () => {
        const anyInput = input as HTMLInputElement & { showPicker?: () => void };
        if (typeof anyInput.showPicker === 'function') {
          try { anyInput.showPicker(); } catch { /* ignore — picker may be already open */ }
        }
      });
    }
    row.appendChild(input);
  } else if (field.type === 'status') {
    row.appendChild(renderStatusChipTrigger(board, card));
  } else if (field.type === 'tags') {
    row.appendChild(renderTagsEditor(card, field.name, rawValue));
  } else {
    // text or person — contenteditable span with Empty placeholder
    const value = document.createElement('span');
    value.className = 'board-panel-prop-value';
    value.contentEditable = currentReadOnly ? 'false' : 'true';
    value.textContent = rawValue;
    value.dataset.placeholder = 'Empty';
    if (!rawValue) value.classList.add('is-empty');
    if (!currentReadOnly) {
      value.addEventListener('input', () => {
        value.classList.toggle('is-empty', !value.textContent);
      });
      value.addEventListener('blur', () => {
        commitCard((c) => ({ ...c, values: { ...c.values, [field.name]: value.textContent || '' } }));
      });
    }
    row.appendChild(value);
  }

  return row;
}

// === Status: render the current value as a chip (matches the column chip),
// and on click open a dropdown of chips for every column. No more <select>. ===
function renderStatusChipTrigger(board: Board, card: Card): HTMLElement {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'board-panel-status-trigger board-panel-prop-value';
  trigger.disabled = currentReadOnly;

  const status = card.values.Status || '';
  const col = board.columns.find((c) => c.name === status);
  if (status && col) {
    trigger.appendChild(buildChip(col.name, col.color));
  } else {
    const empty = document.createElement('span');
    empty.className = 'board-panel-status-empty';
    empty.textContent = 'Empty';
    trigger.appendChild(empty);
  }
  const caret = document.createElement('span');
  caret.className = 'board-panel-status-caret';
  caret.innerHTML = ICON_CHEVRON_DOWN;
  trigger.appendChild(caret);

  if (!currentReadOnly) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      openStatusDropdown(trigger);
    });
  }
  return trigger;
}

function buildChip(name: string, color: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `board-column-chip color-${color}`;
  const dot = document.createElement('span');
  dot.className = 'board-column-chip-dot';
  chip.appendChild(dot);
  const text = document.createElement('span');
  text.className = 'board-column-name';
  text.textContent = name;
  chip.appendChild(text);
  return chip;
}

function openStatusDropdown(anchor: HTMLElement): void {
  document.querySelectorAll('.board-status-dropdown').forEach((n) => n.remove());
  if (!currentBoard || !currentCard) return;
  const board = currentBoard;
  const card = currentCard;

  const menu = document.createElement('div');
  menu.className = 'board-status-dropdown';
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'absolute';
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;
  menu.style.minWidth = `${rect.width}px`;

  for (const col of board.columns) {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'board-status-option';
    opt.appendChild(buildChip(col.name, col.color));
    if (card.values.Status === col.name) {
      const check = document.createElement('span');
      check.className = 'board-status-check';
      check.innerHTML = ICON_CHECK;
      opt.appendChild(check);
    }
    opt.addEventListener('click', () => {
      commitCard((c) => ({ ...c, values: { ...c.values, Status: col.name } }));
      close();
    });
    menu.appendChild(opt);
  }

  function close(): void {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
  }
  function onOutside(e: MouseEvent): void {
    if (!menu.contains(e.target as Node) && e.target !== anchor) close();
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
  }, 0);
}

function renderTagsEditor(card: Card, fieldName: string, rawValue: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'board-tag-input board-panel-prop-value';
  const tags = rawValue.split(',').map((t) => t.trim()).filter(Boolean);
  if (currentReadOnly) {
    if (tags.length === 0) {
      wrap.classList.add('is-empty');
      wrap.textContent = 'Empty';
    } else {
      tags.forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'board-tag-chip';
        chip.textContent = tag;
        chip.style.pointerEvents = 'none';
        wrap.appendChild(chip);
      });
    }
    return wrap;
  }
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = tags.length === 0 ? 'Empty' : '';
  const renderChips = () => {
    wrap.querySelectorAll('.board-tag-chip').forEach((n) => n.remove());
    tags.forEach((tag, i) => {
      const chip = document.createElement('span');
      chip.className = 'board-tag-chip';
      chip.textContent = tag;
      const x = document.createElement('button');
      x.type = 'button';
      x.setAttribute('aria-label', 'Remove');
      x.textContent = '×';
      x.addEventListener('click', () => {
        tags.splice(i, 1);
        commit();
      });
      chip.appendChild(x);
      wrap.insertBefore(chip, input);
    });
    input.placeholder = tags.length === 0 ? 'Empty' : '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const t = input.value.replace(/,/g, '').trim();
      if (t && !tags.includes(t)) tags.push(t);
      input.value = '';
      commit();
    }
  });
  const commit = () => {
    commitCard((c) => ({ ...c, values: { ...c.values, [fieldName]: tags.join(', ') } }));
    renderChips();
  };
  wrap.appendChild(input);
  renderChips();
  void card;  // referenced via currentCard inside commitCard
  return wrap;
}

function renderBody(): HTMLElement {
  const card = currentCard!;
  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'board-panel-body-wrap';

  const bodyHost = document.createElement('div');
  bodyHost.className = 'board-panel-body editable';
  bodyWrap.appendChild(bodyHost);

  const sub = createEditor(bodyHost, card.body || '', (markdown: string) => {
    // Use currentCard (latest) instead of the stale closure capture so a
    // body update doesn't clobber other edits the user already made.
    commitCard((c) => ({ ...c, body: markdown }));
    updateBodyPlaceholderVisibility(bodyWrap, markdown);
  });
  sub.setEditable(!currentReadOnly);

  const placeholder = document.createElement('div');
  placeholder.className = 'board-panel-body-placeholder';
  placeholder.textContent = 'Add a description to this card…';
  bodyWrap.appendChild(placeholder);
  updateBodyPlaceholderVisibility(bodyWrap, card.body || '');

  // Hide the placeholder immediately on the first keystroke. Tiptap's
  // onChange fires AFTER the browser has already rendered the typed
  // character, so without this the character briefly overlaps the
  // placeholder text. Listening for `input` on the body host catches the
  // event in the same frame as the keystroke.
  bodyHost.addEventListener('input', () => {
    placeholder.style.display = 'none';
  });

  return bodyWrap;
}

function updateBodyPlaceholderVisibility(bodyWrap: HTMLElement, markdown: string): void {
  const placeholder = bodyWrap.querySelector('.board-panel-body-placeholder') as HTMLElement | null;
  if (!placeholder) return;
  placeholder.style.display = markdown.trim() ? 'none' : 'block';
}

function selectAllText(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}
