// src/webview/boardProperties.ts
import type { Board, FieldDef, FieldType } from './boardModel';
import { FIELD_TYPE_ICONS, FIELD_TYPE_LABELS } from './boardIcons';

export function openPropertiesMenu(
  anchor: HTMLElement,
  board: Board,
  onChange: (next: Board) => void,
): void {
  // Close any existing menu first
  document.querySelectorAll('.board-properties-menu').forEach((n) => n.remove());

  const menu = document.createElement('div');
  menu.className = 'board-properties-menu';
  document.body.appendChild(menu);
  positionAnchored(menu, anchor);

  const list = document.createElement('div');
  list.className = 'board-properties-list';
  menu.appendChild(list);
  for (const field of board.fields) {
    list.appendChild(renderFieldRow(board, field, onChange));
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'board-properties-add';
  add.textContent = '+ Add field';
  add.addEventListener('click', () => promptNewField(add, board, onChange));
  menu.appendChild(add);

  function onOutside(e: MouseEvent) {
    if (!menu.contains(e.target as Node) && e.target !== anchor) {
      closeMenu();
    }
  }
  function closeMenu() {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
  }, 0);
}

function renderFieldRow(board: Board, field: FieldDef, onChange: (next: Board) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-properties-row';
  row.dataset.fieldName = field.name;

  const isLocked = field.name === 'Title' || field.name === 'Status';

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
    // Title must always be first; Status must be second; can't move them.
    if (from === 'Title' || from === 'Status' || field.name === 'Title' || field.name === 'Status') return;
    const fields = [...board.fields];
    const fromIdx = fields.findIndex((f) => f.name === from);
    const toIdx = fields.findIndex((f) => f.name === field.name);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = fields.splice(fromIdx, 1);
    fields.splice(toIdx, 0, moved);
    onChange({ ...board, fields });
  });

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
      // Rename field across the model.
      const fields = board.fields.map((f) =>
        f.name === field.name ? { ...f, name: next } : f,
      );
      const cards = board.cards.map((c) => {
        const v: Record<string, string> = { ...c.values };
        v[next] = v[field.name] || '';
        delete v[field.name];
        return { ...c, values: v };
      });
      onChange({ ...board, fields, cards });
    });
  }

  const type = document.createElement('span');
  type.className = 'board-properties-type';
  type.textContent = field.type;

  const visToggle = document.createElement('input');
  visToggle.type = 'checkbox';
  visToggle.checked = field.visibleOnCard;
  visToggle.disabled = isLocked;
  visToggle.title = 'Show on card';
  visToggle.addEventListener('change', () => {
    const fields = board.fields.map((f) =>
      f.name === field.name ? { ...f, visibleOnCard: visToggle.checked } : f,
    );
    onChange({ ...board, fields });
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'board-properties-delete';
  del.textContent = '×';
  del.title = 'Delete field';
  del.disabled = isLocked;
  del.addEventListener('click', () => {
    if (!confirm(`Delete field "${field.name}"? Values will be lost.`)) return;
    const fields = board.fields.filter((f) => f.name !== field.name);
    const cards = board.cards.map((c) => {
      const v: Record<string, string> = { ...c.values };
      delete v[field.name];
      return { ...c, values: v };
    });
    onChange({ ...board, fields, cards });
  });

  row.append(handle, name, type, visToggle, del);
  return row;
}

export function promptNewField(anchor: HTMLElement, board: Board, onChange: (next: Board) => void): void {
  // One popover, two visible sections:
  // 1) a name input at top, 2) a list of typed options (icon + label) below.
  // Clicking a type row commits the field with that type. No separate "Add" button.

  document.querySelectorAll('.board-add-field-picker').forEach((n) => n.remove());

  const pop = document.createElement('div');
  pop.className = 'board-add-field-picker';
  document.body.appendChild(pop);

  const rect = anchor.getBoundingClientRect();
  pop.style.position = 'absolute';
  pop.style.top = `${rect.bottom + window.scrollY + 4}px`;
  pop.style.left = `${rect.left + window.scrollX}px`;

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Field name';
  nameInput.className = 'board-add-field-name';
  pop.appendChild(nameInput);

  const sep = document.createElement('div');
  sep.className = 'board-add-field-separator';
  pop.appendChild(sep);

  const sectionLabel = document.createElement('div');
  sectionLabel.className = 'board-add-field-section';
  sectionLabel.textContent = 'Type';
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
    row.addEventListener('click', () => commitWithType(t));
    list.appendChild(row);
  }

  const commitWithType = (type: FieldType) => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.classList.add('is-error');
      nameInput.focus();
      return;
    }
    if (board.fields.some((f) => f.name === name)) {
      nameInput.classList.add('is-error');
      nameInput.focus();
      return;
    }
    onChange({
      ...board,
      fields: [...board.fields, { name, type, visibleOnCard: true }],
      cards: board.cards.map((c) => ({ ...c, values: { ...c.values, [name]: '' } })),
    });
    closePop();
  };

  nameInput.addEventListener('keydown', (e) => {
    // Enter on the input → commit as Text (the default first option).
    if (e.key === 'Enter') {
      e.preventDefault();
      commitWithType('text');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePop();
    }
  });
  nameInput.addEventListener('input', () => nameInput.classList.remove('is-error'));

  function onOutside(e: MouseEvent) {
    if (!pop.contains(e.target as Node) && e.target !== anchor) {
      closePop();
    }
  }
  function closePop() {
    pop.remove();
    document.removeEventListener('mousedown', onOutside, true);
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    nameInput.focus();
  }, 0);
}

function positionAnchored(menu: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'absolute';
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;
}
