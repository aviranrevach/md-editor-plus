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

  const name = document.createElement('span');
  name.className = 'board-properties-name';
  name.textContent = field.name;

  const type = document.createElement('span');
  type.className = 'board-properties-type';
  type.textContent = field.type;

  const visToggle = document.createElement('input');
  visToggle.type = 'checkbox';
  visToggle.checked = field.visibleOnCard;
  visToggle.disabled = field.name === 'Title' || field.name === 'Status';
  visToggle.title = 'Show on card';
  visToggle.addEventListener('change', () => {
    const fields = board.fields.map((f) =>
      f.name === field.name ? { ...f, visibleOnCard: visToggle.checked } : f,
    );
    onChange({ ...board, fields });
  });

  row.append(name, type, visToggle);
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
