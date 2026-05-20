// src/webview/boardProperties.ts
import type { Board, FieldDef, FieldType } from './boardModel';

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
  add.addEventListener('click', () => promptNewField(board, onChange));
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

function promptNewField(board: Board, onChange: (next: Board) => void): void {
  const name = prompt('Field name');
  if (!name) return;
  if (board.fields.some((f) => f.name === name)) {
    alert('A field with that name already exists.');
    return;
  }
  const typeInput = prompt('Type (text / status / date / person / tags)', 'text');
  const allowed: FieldType[] = ['text', 'status', 'date', 'person', 'tags'];
  if (!typeInput || !allowed.includes(typeInput as FieldType)) return;
  const type = typeInput as FieldType;
  onChange({
    ...board,
    fields: [...board.fields, { name, type, visibleOnCard: true }],
    cards: board.cards.map((c) => ({ ...c, values: { ...c.values, [name]: '' } })),
  });
}

function positionAnchored(menu: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'absolute';
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;
}
