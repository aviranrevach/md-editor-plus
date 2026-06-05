// src/webview/boardProperties.ts
import type { Board, FieldDef, FieldType, ColumnDef } from './boardModel';
import { COLOR_TOKENS_PUBLIC } from './boardModel';
import { FIELD_TYPE_ICONS, FIELD_TYPE_LABELS } from './boardIcons';
import { setViewColumns, hideFieldInView, showFieldInView } from './boardOps';
import { buildOptionsEditor, openStatusOptionsEditor } from './boardStatusOptions';

const DEFAULT_STATUS_OPTIONS: ColumnDef[] = [
  { name: 'Todo',        color: 'blue' },
  { name: 'In progress', color: 'amber' },
  { name: 'Done',        color: 'emerald' },
];

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

// ===== Manual mouse-based reorder for Properties rows =====
// We avoid HTML5 drag-and-drop here: ProseMirror's view intercepts dragstart
// events on the page and the popover sometimes sits inside its viewport, so
// HTML5 drag is unreliable in this context.
function startManualFieldDrag(
  downEvent: MouseEvent,
  fromName: string,
  listEl: HTMLElement,
  board: Board,
  onChange: (next: Board) => void,
  viewName: string,
): void {
  const startX = downEvent.clientX;
  const startY = downEvent.clientY;
  const THRESHOLD = 4;
  let active = false;
  let lastDropTarget: HTMLElement | null = null;

  function clearIndicator(): void {
    document.querySelectorAll('.board-properties-drop-indicator').forEach((n) => n.remove());
  }

  function showIndicator(target: HTMLElement, before: boolean): void {
    clearIndicator();
    const parent = target.parentElement;
    if (!parent) return;
    const indicator = document.createElement('div');
    indicator.className = 'board-properties-drop-indicator';
    if (before) parent.insertBefore(indicator, target);
    else parent.insertBefore(indicator, target.nextSibling);
  }

  function findRowAt(x: number, y: number): { row: HTMLElement; before: boolean } | null {
    const rows = listEl.querySelectorAll('.board-properties-row');
    for (const r of Array.from(rows) as HTMLElement[]) {
      const rect = r.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom && x >= rect.left && x <= rect.right) {
        const before = y < rect.top + rect.height / 2;
        return { row: r, before };
      }
    }
    return null;
  }

  function onMove(e: MouseEvent): void {
    if (!active) {
      if (Math.abs(e.clientX - startX) < THRESHOLD && Math.abs(e.clientY - startY) < THRESHOLD) return;
      active = true;
      document.body.classList.add('is-dragging-property');
    }
    e.preventDefault();
    const hit = findRowAt(e.clientX, e.clientY);
    if (!hit) {
      clearIndicator();
      lastDropTarget = null;
      return;
    }
    const targetName = hit.row.dataset.fieldName || '';
    if (targetName === 'Title' || targetName === 'Status' || targetName === fromName) {
      clearIndicator();
      lastDropTarget = null;
      return;
    }
    showIndicator(hit.row, hit.before);
    lastDropTarget = hit.row;
  }

  function onUp(e: MouseEvent): void {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    document.body.classList.remove('is-dragging-property');
    if (!active) {
      clearIndicator();
      return;
    }
    const hit = findRowAt(e.clientX, e.clientY);
    clearIndicator();
    if (!hit) return;
    const toName = hit.row.dataset.fieldName || '';
    if (toName === 'Title' || toName === 'Status' || toName === fromName) return;
    if (viewName === 'table') {
      const order = board.fields.map(f => f.name);
      const fromIdx2 = order.indexOf(fromName);
      if (fromIdx2 < 0 || order.indexOf(toName) < 0) return;
      const [movedName] = order.splice(fromIdx2, 1);
      const insertAt = hit.before ? order.indexOf(toName) : order.indexOf(toName) + 1;
      order.splice(insertAt, 0, movedName);
      const b2: Board = { ...board, views: board.views.map(v => ({ ...v })) };
      setViewColumns(b2, viewName, order);
      onChange(b2);
    } else {
      const fields = [...board.fields];
      const fromIdx = fields.findIndex((f) => f.name === fromName);
      let toIdx = fields.findIndex((f) => f.name === toName);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = fields.splice(fromIdx, 1);
      toIdx = fields.findIndex((f) => f.name === toName);
      const insertAt = hit.before ? toIdx : toIdx + 1;
      fields.splice(insertAt, 0, moved);
      onChange({ ...board, fields });
    }
  }
  void lastDropTarget;

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup', onUp, true);
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
  viewName = 'kanban',
): void {
  document.querySelectorAll('.board-field-action-menu').forEach((n) => n.remove());

  const isLocked = field.name === 'Title' || field.name === 'Status' || field.name === 'Description';

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
  if (field.type === 'status' || field.type === 'tags') {
    let liveBoard = board;
    addItem(ICON_EDIT, 'Edit options', '', false, () => {
      openStatusOptionsEditor(
        anchor,
        () => liveBoard,
        field.name,
        (next) => { liveBoard = next; onChange(next); },
      );
    });
  }
  if (viewName === 'table') {
    const tableView = board.views.find(x => x.name === 'table');
    const isHiddenInTable = !!tableView?.hidden?.includes(field.name);
    addItem(
      isHiddenInTable ? ICON_EYE : ICON_EYE_OFF,
      isHiddenInTable ? 'Show column' : 'Hide column',
      '',
      isLocked,
      () => {
        const b2: Board = { ...board, views: board.views.map(v2 => ({ ...v2, hidden: v2.hidden ? [...v2.hidden] : undefined })) };
        if (isHiddenInTable) showFieldInView(b2, 'table', field.name);
        else                 hideFieldInView(b2, 'table', field.name);
        onChange(b2);
      },
    );
  } else {
    addItem(
      field.visibleOnCard ? ICON_EYE_OFF : ICON_EYE,
      field.visibleOnCard ? 'Hide on card' : 'Show on card',
      '',
      isLocked,
      () => onChange(toggleFieldVisibility(board, field.name)),
    );
  }
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

/**
 * Render the Properties header, field-row list, and "Add a property" button
 * into an arbitrary host element. The caller is responsible for outside-click
 * handling, positioning, and cleanup — this function only manages the content.
 */
/**
 * Render the Properties popover content into `host`. Returns a `rebuild`
 * function the caller can call to refresh the field list from `boardGetter()`
 * without tearing down the popover DOM (which would destroy any in-flight
 * picker / sub-popover state and confuse focus).
 */
export function renderPropertiesContent(
  host: HTMLElement,
  boardGetter: () => Board,
  onChange: (next: Board) => void,
  viewName: string,
): { rebuild: () => void } {
  const header = document.createElement('div');
  header.className = 'board-properties-section';
  header.textContent = 'Properties';
  host.appendChild(header);

  const wrappedOnChange = (next: Board) => {
    onChange(next);
    // The mutate() chain will call rebuild() via the chrome's refreshProps,
    // which now goes through this same function — so the list refreshes once.
  };

  const list = document.createElement('div');
  list.className = 'board-properties-list';
  host.appendChild(list);

  function rebuildList(): void {
    const cur = boardGetter();
    list.innerHTML = '';
    for (const field of cur.fields) {
      list.appendChild(renderFieldRow(cur, field, list, wrappedOnChange, viewName));
    }
    // Synthetic "Description" row — surfaces card.body. Visible in both views:
    // table-side toggle controls the Description column, kanban-side toggle
    // controls whether the body preview shows on the card. Both write to
    // view.hidden for their respective view, so the two stay independent.
    list.appendChild(renderFieldRow(
      cur,
      { name: 'Description', type: 'text', visibleOnCard: false },
      list,
      wrappedOnChange,
      viewName,
    ));
  }
  rebuildList();

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'board-properties-add';
  add.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
    <span>Add a property (column)</span>
  `;
  add.addEventListener('click', () => promptNewField(add, boardGetter(), wrappedOnChange));
  host.appendChild(add);

  return { rebuild: rebuildList };
}

export function openPropertiesMenu(
  anchor: HTMLElement,
  board: Board,
  onChange: (next: Board) => void,
  viewName = 'kanban',
): void {
  document.querySelectorAll('.board-properties-menu').forEach((n) => n.remove());

  const menu = document.createElement('div');
  menu.className = 'board-properties-menu';
  document.body.appendChild(menu);
  positionAnchored(menu, anchor);

  // Legacy free-floating popover (no live caller in chrome path; kept for
  // back-compat). Snapshot the board once since this path has no live getter.
  let snapshot = board;
  const wrappedChange = (next: Board) => { snapshot = next; onChange(next); result.rebuild(); };
  const result = renderPropertiesContent(menu, () => snapshot, wrappedChange, viewName);

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

  // Edge-aware repositioning so the popover never overflows the viewport on
  // either side. The menu is right-anchored via transform: translateX(-100%);
  // if the resulting left edge goes off-screen, switch off the transform and
  // pin the left edge to the viewport margin.
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    const margin = 8;
    if (r.left < margin) {
      menu.style.transform = '';
      menu.style.left = `${window.scrollX + margin}px`;
    } else if (r.right > window.innerWidth - margin) {
      // Unlikely (we anchor right) but guard anyway.
      menu.style.transform = '';
      menu.style.left = `${window.scrollX + window.innerWidth - r.width - margin}px`;
    }
  });
}

function renderFieldRow(board: Board, field: FieldDef, listEl: HTMLElement, onChange: (next: Board) => void, viewName: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-properties-row';
  row.dataset.fieldName = field.name;

  // `isLocked` controls rename / drag / delete affordances — applies to Title,
  // Status, and the synthetic Description (none of those can be renamed,
  // deleted, or reordered).
  const isLocked = field.name === 'Title' || field.name === 'Status' || field.name === 'Description';
  // The visibility toggle is its own concept:
  // - Title: always shown (it's the card's primary identifier).
  // - Status: hideable in TABLE view as a column, but locked-on in KANBAN
  //   because the kanban groups cards INTO Status columns — it has nowhere
  //   to hide.
  // - Everything else (including Description): hideable in both views.
  const isToggleLocked = field.name === 'Title' || (viewName === 'kanban' && field.name === 'Status');

  // Drag handle — always visible. Mouse-based reorder (we don't use HTML5
  // drag-and-drop here because ProseMirror intercepts dragstart events on the
  // page, and the popover lives inside the editor's viewport).
  const handle = document.createElement('span');
  handle.className = 'board-properties-handle' + (isLocked ? ' is-locked' : '');
  handle.textContent = '⋮⋮';
  handle.title = isLocked ? 'Locked field' : 'Drag to reorder';
  if (!isLocked) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startManualFieldDrag(e, field.name, listEl, board, onChange, viewName);
    });
  }
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

  // Toggle: Show on card (kanban) or show in table view
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.disabled = isToggleLocked;
  if (viewName === 'table') {
    const tableView = board.views.find(x => x.name === 'table');
    // Table-view visibility mirrors the table renderer's `computeVisibleFields`:
    // a field is hidden iff in view.hidden, OR it's the special `id` field with
    // visibleOnCard=false (board scaffolding). Other fields are always visible
    // in the table by default.
    const inViewHidden = !!tableView?.hidden?.includes(field.name);
    const isIdScaffold = field.name === 'id' && !field.visibleOnCard;
    const isHidden = inViewHidden || isIdScaffold;
    toggle.className = 'board-properties-toggle' + (!isHidden ? ' is-on' : '');
    toggle.title = isHidden ? 'Hidden in table — click to show' : 'Visible in table — click to hide';
    toggle.addEventListener('click', () => {
      const b2: Board = {
        ...board,
        fields: board.fields.map(ff =>
          ff.name === field.name && isIdScaffold ? { ...ff, visibleOnCard: true } : ff
        ),
        views: board.views.map(v2 => ({ ...v2, hidden: v2.hidden ? [...v2.hidden] : undefined })),
      };
      if (isHidden) showFieldInView(b2, 'table', field.name);
      else          hideFieldInView(b2, 'table', field.name);
      onChange(b2);
    });
  } else if (field.name === 'Description') {
    // Synthetic Description in kanban: toggle writes to the kanban view's
    // .hidden array (controls the body preview on cards). visibleOnCard
    // doesn't apply since Description isn't a real field in board.fields.
    const kanbanView = board.views.find(x => x.name === 'kanban');
    const isHidden = !!kanbanView?.hidden?.includes('Description');
    toggle.className = 'board-properties-toggle' + (!isHidden ? ' is-on' : '');
    toggle.title = isHidden ? 'Hidden on card — click to show' : 'Visible on card — click to hide';
    toggle.addEventListener('click', () => {
      const b2: Board = {
        ...board,
        views: board.views.map(v2 => ({ ...v2, hidden: v2.hidden ? [...v2.hidden] : undefined })),
      };
      if (isHidden) showFieldInView(b2, 'kanban', 'Description');
      else          hideFieldInView(b2, 'kanban', 'Description');
      onChange(b2);
    });
  } else {
    toggle.className = 'board-properties-toggle' + (field.visibleOnCard ? ' is-on' : '');
    toggle.title = field.visibleOnCard ? 'Visible on card — click to hide' : 'Hidden — click to show';
    toggle.addEventListener('click', () => {
      onChange(toggleFieldVisibility(board, field.name));
    });
  }
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
      }, viewName);
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
  // Provisional placement (refined in rAF below once we know the popover's size).
  pop.style.top = `${rect.bottom + window.scrollY + 4}px`;
  pop.style.left = `${rect.left + window.scrollX}px`;

  const sectionLabel = document.createElement('div');
  sectionLabel.className = 'board-add-field-section';
  sectionLabel.textContent = 'Property (column) type';
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
    row.addEventListener('click', () => {
      if (t === 'status') showStatusSetup();
      else commit(t);
    });
    list.appendChild(row);
  }

  // Edge-aware positioning: flip above the anchor if no room below, and clamp
  // horizontally so the popover never overflows either side.
  requestAnimationFrame(() => {
    const r = pop.getBoundingClientRect();
    const margin = 8;
    if (r.bottom > window.innerHeight - margin) {
      const flippedTop = rect.top + window.scrollY - r.height - 4;
      if (flippedTop > margin) pop.style.top = `${flippedTop}px`;
      else pop.style.top = `${window.scrollY + window.innerHeight - r.height - margin}px`;
    }
    const r2 = pop.getBoundingClientRect();
    if (r2.right > window.innerWidth - margin) {
      pop.style.left = `${window.scrollX + window.innerWidth - r2.width - margin}px`;
    } else if (r2.left < margin) {
      pop.style.left = `${window.scrollX + margin}px`;
    }
  });

  function showStatusSetup(): void {
    list.remove();
    sectionLabel.textContent = 'States';

    const working: ColumnDef[] = DEFAULT_STATUS_OPTIONS.map((o) => ({ ...o }));
    const editorHost = document.createElement('div');
    pop.appendChild(editorHost);

    const rerender = () => buildOptionsEditor(editorHost, {
      getOptions: () => working,
      onAdd: () => {
        const used = working.map((o) => o.color);
        const color = COLOR_TOKENS_PUBLIC.find((c) => !used.includes(c)) ?? 'gray';
        working.push({ name: 'New', color });
        rerender();
      },
      onRename: (o, n) => { const t2 = working.find((w) => w.name === o); if (t2) t2.name = n; rerender(); },
      onRecolor: (n, c) => { const t2 = working.find((w) => w.name === n); if (t2) t2.color = c; rerender(); },
      onDelete: (n) => { const i = working.findIndex((w) => w.name === n); if (i >= 0) working.splice(i, 1); rerender(); },
    });
    rerender();

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'board-add-field-create';
    createBtn.textContent = 'Create column';
    createBtn.addEventListener('click', () => commitStatus(working));
    pop.appendChild(createBtn);
  }

  function commitStatus(options: ColumnDef[]): void {
    const base = FIELD_TYPE_LABELS.status;
    let name = base;
    let n = 2;
    while (board.fields.some((f) => f.name === name)) name = `${base} ${n++}`;
    onChange(
      {
        ...board,
        fields: [...board.fields, { name, type: 'status', visibleOnCard: true, options }],
        cards: board.cards.map((c) => ({ ...c, values: { ...c.values, [name]: '' } })),
      },
      name,
    );
    closePop();
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
  // Right-anchored: align popover's right edge to the anchor's right edge so
  // it grows to the LEFT (the Properties button sits at the far right of the
  // chrome row, so opening leftward keeps it on-screen).
  menu.style.left = `${rect.right + window.scrollX}px`;
  menu.style.transform = 'translateX(-100%)';
}
