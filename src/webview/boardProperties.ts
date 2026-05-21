// src/webview/boardProperties.ts
import type { Board, FieldDef, FieldType } from './boardModel';
import { FIELD_TYPE_ICONS, FIELD_TYPE_LABELS } from './boardIcons';

// ===== Shared field-mutation helpers =====
// These are used by both the Properties popover (board chrome) and the
// side-panel row-label menu, so the behaviour is identical regardless of
// which surface the user triggers the action from.

const ICON_TRASH = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M5.5 4V2.5h5V4M4 4l.5 9.5h7L12 4M6.5 7v4M9.5 7v4"/></svg>`;
const ICON_EDIT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L6 12l-3 1 1-3 7.5-7.5z"/></svg>`;
const ICON_EYE_OFF = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 8c1.5 3 4 4 6 4s4.5-1 6-4-4-4-6-4-4.5 1-6 4z"/><line x1="2" y1="2" x2="14" y2="14"/></svg>`;
const ICON_EYE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8c1.5 3 4 4 6 4s4.5-1 6-4-4-4-6-4-4.5 1-6 4z"/><circle cx="8" cy="8" r="2"/></svg>`;
const ICON_MORE = `<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>`;

export function fieldHasAnyValue(board: Board, fieldName: string): boolean {
  return board.cards.some((c) => ((c.values[fieldName] || '').trim().length > 0));
}

export function deleteFieldFromBoard(board: Board, fieldName: string): Board {
  return {
    ...board,
    fields: board.fields.filter((f) => f.name !== fieldName),
    cards: board.cards.map((c) => {
      const v: Record<string, string> = { ...c.values };
      delete v[fieldName];
      return { ...c, values: v };
    }),
  };
}

export function toggleFieldVisibility(board: Board, fieldName: string): Board {
  return {
    ...board,
    fields: board.fields.map((f) =>
      f.name === fieldName ? { ...f, visibleOnCard: !f.visibleOnCard } : f,
    ),
  };
}

export function renameFieldInBoard(board: Board, oldName: string, newName: string): Board {
  return {
    ...board,
    fields: board.fields.map((f) => (f.name === oldName ? { ...f, name: newName } : f)),
    cards: board.cards.map((c) => {
      const v: Record<string, string> = { ...c.values };
      if (oldName in v) {
        v[newName] = v[oldName];
        delete v[oldName];
      }
      return { ...c, values: v };
    }),
  };
}

/**
 * Delete a field with smart confirmation: silent if no card has a value for
 * the field, modal-confirm if any card has data that would be lost.
 */
export function deleteFieldWithConfirm(
  board: Board,
  fieldName: string,
  onChange: (next: Board) => void,
): void {
  if (!fieldHasAnyValue(board, fieldName)) {
    onChange(deleteFieldFromBoard(board, fieldName));
    return;
  }
  const count = board.cards.filter((c) => ((c.values[fieldName] || '').trim().length > 0)).length;
  showConfirm(
    `Delete property "${fieldName}"?`,
    `${count} card${count === 1 ? '' : 's'} ${count === 1 ? 'has' : 'have'} a value in this field. Deleting it removes that data permanently.`,
    'Delete',
    () => onChange(deleteFieldFromBoard(board, fieldName)),
  );
}

// ===== Custom confirm dialog (VSCode webviews block window.confirm) =====
function showConfirm(
  title: string,
  body: string,
  dangerLabel: string,
  onConfirm: () => void,
): void {
  document.querySelectorAll('.board-confirm-overlay').forEach((n) => n.remove());
  const overlay = document.createElement('div');
  overlay.className = 'board-confirm-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'board-confirm';
  dialog.innerHTML = `
    <div class="board-confirm-title"></div>
    <div class="board-confirm-body"></div>
    <div class="board-confirm-actions">
      <button type="button" class="board-confirm-cancel">Cancel</button>
      <button type="button" class="board-confirm-confirm"></button>
    </div>
  `;
  (dialog.querySelector('.board-confirm-title') as HTMLElement).textContent = title;
  (dialog.querySelector('.board-confirm-body') as HTMLElement).textContent = body;
  (dialog.querySelector('.board-confirm-confirm') as HTMLElement).textContent = dangerLabel;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey, true); }
    else if (e.key === 'Enter') { onConfirm(); close(); document.removeEventListener('keydown', onKey, true); }
  };
  document.addEventListener('keydown', onKey, true);
  (dialog.querySelector('.board-confirm-cancel') as HTMLButtonElement).addEventListener('click', () => {
    close();
    document.removeEventListener('keydown', onKey, true);
  });
  (dialog.querySelector('.board-confirm-confirm') as HTMLButtonElement).addEventListener('click', () => {
    onConfirm();
    close();
    document.removeEventListener('keydown', onKey, true);
  });
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) {
      close();
      document.removeEventListener('keydown', onKey, true);
    }
  });
}

/**
 * Small per-field action menu used from BOTH the Properties popover row's
 * "more" button AND the side-panel row-label click. Same actions, same
 * styling, same wiring.
 */
export function openFieldActionMenu(
  anchor: HTMLElement,
  board: Board,
  field: FieldDef,
  onChange: (next: Board) => void,
  options: { onRename?: () => void } = {},
): void {
  document.querySelectorAll('.board-field-action-menu').forEach((n) => n.remove());

  const isLocked = field.name === 'Title' || field.name === 'Status';

  const menu = document.createElement('div');
  menu.className = 'board-field-action-menu';
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'absolute';
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;

  const addItem = (icon: string, label: string, variant: '' | 'danger', disabled: boolean, handler: () => void) => {
    const it = document.createElement('button');
    it.type = 'button';
    it.className = 'board-field-action-item' + (variant ? ` is-${variant}` : '');
    it.disabled = disabled;
    it.innerHTML = `<span class="board-field-action-icon">${icon}</span><span class="board-field-action-label">${label}</span>`;
    it.addEventListener('click', () => { handler(); close(); });
    menu.appendChild(it);
  };

  addItem(ICON_EDIT, 'Rename', '', isLocked, () => options.onRename?.());
  addItem(
    field.visibleOnCard ? ICON_EYE_OFF : ICON_EYE,
    field.visibleOnCard ? 'Hide on card' : 'Show on card',
    '',
    isLocked,
    () => onChange(toggleFieldVisibility(board, field.name)),
  );
  const divider = document.createElement('div');
  divider.className = 'board-field-action-divider';
  menu.appendChild(divider);
  addItem(ICON_TRASH, 'Delete property', 'danger', isLocked, () => {
    deleteFieldWithConfirm(board, field.name, onChange);
  });

  function onOutside(e: MouseEvent) {
    if (!menu.contains(e.target as Node) && e.target !== anchor) close();
  }
  function close() {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

  // After positioning, nudge the menu horizontally if it would overflow the viewport.
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    const overflow = r.right - window.innerWidth;
    if (overflow > 0) {
      menu.style.left = `${Math.max(8, parseFloat(menu.style.left) - overflow - 8)}px`;
    }
  });
}

// ===== Properties popover (the chrome ⚙ icon target) =====

export function openPropertiesMenu(
  anchor: HTMLElement,
  board: Board,
  onChange: (next: Board) => void,
): void {
  document.querySelectorAll('.board-properties-menu').forEach((n) => n.remove());

  const menu = document.createElement('div');
  menu.className = 'board-properties-menu';
  document.body.appendChild(menu);
  positionAnchored(menu, anchor);

  const header = document.createElement('div');
  header.className = 'board-properties-section';
  header.textContent = 'Properties';
  menu.appendChild(header);

  const list = document.createElement('div');
  list.className = 'board-properties-list';
  menu.appendChild(list);
  for (const field of board.fields) {
    list.appendChild(renderFieldRow(board, field, onChange));
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'board-properties-add';
  add.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
    <span>Add a property</span>
  `;
  add.addEventListener('click', () => promptNewField(add, board, onChange));
  menu.appendChild(add);

  function onOutside(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    // Treat sub-popovers (action menu / type picker / confirm dialog) as
    // "inside" so a click in those doesn't close the parent menu.
    if (t.closest('.board-properties-menu, .board-field-action-menu, .board-add-field-picker, .board-confirm-overlay')) return;
    if (t === anchor || (anchor && anchor.contains(t))) return;
    closeMenu();
  }
  function closeMenu() {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

  // Edge-aware repositioning so the popover never overflows the viewport.
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    const overflowRight = r.right - window.innerWidth;
    if (overflowRight > 0) {
      menu.style.left = `${Math.max(8, parseFloat(menu.style.left) - overflowRight - 8)}px`;
    }
  });
}

function renderFieldRow(board: Board, field: FieldDef, onChange: (next: Board) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-properties-row';
  row.dataset.fieldName = field.name;

  const isLocked = field.name === 'Title' || field.name === 'Status';

  // Drag handle (hover-revealed)
  const handle = document.createElement('span');
  handle.className = 'board-properties-handle';
  handle.textContent = '⋮⋮';
  handle.title = 'Drag to reorder';
  handle.draggable = !isLocked;
  if (!isLocked) {
    handle.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData('text/board-field-name', field.name);
      e.dataTransfer!.effectAllowed = 'move';
      row.classList.add('is-dragging');
    });
    handle.addEventListener('dragend', () => row.classList.remove('is-dragging'));
  }
  row.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('text/board-field-name')) return;
    e.preventDefault();
    row.classList.add('is-drop-target');
  });
  row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
  row.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.types.includes('text/board-field-name')) return;
    e.preventDefault();
    row.classList.remove('is-drop-target');
    const from = e.dataTransfer.getData('text/board-field-name');
    if (!from || from === field.name) return;
    if (from === 'Title' || from === 'Status' || field.name === 'Title' || field.name === 'Status') return;
    const fields = [...board.fields];
    const fromIdx = fields.findIndex((f) => f.name === from);
    const toIdx = fields.findIndex((f) => f.name === field.name);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = fields.splice(fromIdx, 1);
    fields.splice(toIdx, 0, moved);
    onChange({ ...board, fields });
  });
  row.appendChild(handle);

  // Type icon
  const typeIcon = document.createElement('span');
  typeIcon.className = 'board-properties-type-icon';
  typeIcon.innerHTML = FIELD_TYPE_ICONS[field.type] || FIELD_TYPE_ICONS.text;
  row.appendChild(typeIcon);

  // Inline-editable name
  const name = document.createElement('span');
  name.className = 'board-properties-name';
  name.contentEditable = isLocked ? 'false' : 'true';
  name.textContent = field.name;
  if (!isLocked) {
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        name.blur();
      }
    });
    name.addEventListener('blur', () => {
      const next = name.textContent?.trim();
      if (!next || next === field.name) {
        name.textContent = field.name;
        return;
      }
      if (board.fields.some((f) => f.name === next)) {
        name.textContent = field.name;
        return;
      }
      onChange(renameFieldInBoard(board, field.name, next));
    });
  }
  row.appendChild(name);

  // Toggle: Show on card
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'board-properties-toggle' + (field.visibleOnCard ? ' is-on' : '');
  toggle.title = field.visibleOnCard ? 'Visible on card — click to hide' : 'Hidden — click to show';
  toggle.disabled = isLocked;
  toggle.addEventListener('click', () => {
    onChange(toggleFieldVisibility(board, field.name));
  });
  row.appendChild(toggle);

  // ⋯ more button (hover-revealed)
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'board-properties-more';
  more.title = 'More';
  more.innerHTML = ICON_MORE;
  more.disabled = isLocked;
  if (!isLocked) {
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      openFieldActionMenu(more, board, field, onChange, {
        onRename: () => {
          // Focus the inline name span and select-all
          if (name.contentEditable === 'true') {
            name.focus();
            const range = document.createRange();
            range.selectNodeContents(name);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        },
      });
    });
  }
  row.appendChild(more);

  return row;
}

/**
 * Type-only picker. Click "+ Add a property" → menu of types appears
 * (no name input here). Clicking a type creates the field with a default
 * label (e.g., "Status", "Status 2", "Status 3", …) and fires onChange
 * with both the new board state and the chosen default field name so the
 * caller can immediately put that label into "inline rename" mode.
 *
 * Naming the field is intentionally a SEPARATE step from the picker — it
 * happens in the property list itself, where the user can see the row in
 * its real spot with the value column showing "Empty". This eliminates
 * the "name vs value" confusion the old two-input popover had.
 */
export function promptNewField(
  anchor: HTMLElement,
  board: Board,
  onChange: (next: Board, newFieldName: string) => void,
): void {
  document.querySelectorAll('.board-add-field-picker').forEach((n) => n.remove());

  const pop = document.createElement('div');
  pop.className = 'board-add-field-picker board-add-field-picker--types-only';
  document.body.appendChild(pop);

  const rect = anchor.getBoundingClientRect();
  pop.style.position = 'absolute';
  pop.style.top = `${rect.bottom + window.scrollY + 4}px`;
  pop.style.left = `${rect.left + window.scrollX}px`;

  const sectionLabel = document.createElement('div');
  sectionLabel.className = 'board-add-field-section';
  sectionLabel.textContent = 'Property type';
  pop.appendChild(sectionLabel);

  const list = document.createElement('div');
  list.className = 'board-add-field-type-list';
  pop.appendChild(list);

  const types: FieldType[] = ['text', 'status', 'date', 'person', 'tags'];
  for (const t of types) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'board-add-field-type-row';
    row.innerHTML = `
      <span class="board-add-field-type-icon">${FIELD_TYPE_ICONS[t]}</span>
      <span class="board-add-field-type-label">${FIELD_TYPE_LABELS[t]}</span>
    `;
    row.addEventListener('click', () => commit(t));
    list.appendChild(row);
  }

  const commit = (type: FieldType) => {
    // Generate a default name based on the type label, auto-suffixed on conflict.
    const base = FIELD_TYPE_LABELS[type];
    let name = base;
    let n = 2;
    while (board.fields.some((f) => f.name === name)) name = `${base} ${n++}`;
    onChange(
      {
        ...board,
        fields: [...board.fields, { name, type, visibleOnCard: true }],
        cards: board.cards.map((c) => ({ ...c, values: { ...c.values, [name]: '' } })),
      },
      name,
    );
    closePop();
  };

  function onOutside(e: MouseEvent) {
    if (!pop.contains(e.target as Node) && e.target !== anchor) {
      closePop();
    }
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); closePop(); }
  }
  function closePop() {
    pop.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
}

function positionAnchored(menu: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'absolute';
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;
}
