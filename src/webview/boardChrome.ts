// src/webview/boardChrome.ts
// Shared board chrome: board name editor + ⋯ menu (view switch + Properties).
// Extracted so both the kanban and table renderers can use it.

import type { Board } from './boardModel';
import type { BoardRendererCtx } from './boardBlock';
import { renderPropertiesContent, promptNewField } from './boardProperties';
import { requestHeaderRename } from './boardTableRender';

export interface ChromeHandle {
  el: HTMLElement;
  update: (board: Board) => void;
}

export function renderChrome(
  board: Board,
  mutate: (next: Board) => void,
  readOnly: boolean,
  ctx: BoardRendererCtx,
  registerMenuClose: (cb: () => void) => void,
  unregisterMenuClose: () => void,
): ChromeHandle {
  const chrome = document.createElement('div');
  chrome.className = 'board-chrome';

  // Track the current board so the blur handler can reference the latest name.
  let currentBoard = board;

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
      if (next !== currentBoard.name) mutate({ ...currentBoard, name: next });
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        name.blur();
      }
    });
    name.addEventListener('click', () => {
      if (document.activeElement !== name) name.focus();
      selectAllText(name);
    });
  }
  chrome.appendChild(name);

  let refreshViewSeg: (() => void) | null = null;
  let refreshPropsIfOpen: (() => void) | null = null;

  if (!readOnly) {
    // "+ Add property" quick-action button — same look as the ⋯ button.
    const addPropBtn = document.createElement('button');
    addPropBtn.type = 'button';
    addPropBtn.className = 'bd-more-btn bd-add-prop-btn';
    addPropBtn.setAttribute('aria-label', 'Add property (column)');
    addPropBtn.title = 'Add property (column)';
    addPropBtn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>`;
    addPropBtn.addEventListener('click', () => {
      promptNewField(addPropBtn, ctx.getBoard(), (next, name) => {
        // Ask the table renderer (if active) to enter inline-rename on the
        // new column's header so the user can name it immediately.
        requestHeaderRename(name);
        ctx.mutate(next);
      });
    });
    chrome.appendChild(addPropBtn);

    const moreResult = buildHeaderMore(ctx, registerMenuClose, unregisterMenuClose);
    chrome.appendChild(moreResult.el);
    refreshViewSeg = moreResult.refreshViewSeg;
    refreshPropsIfOpen = () => {
      if (moreResult.isMenuOpen()) {
        moreResult.refreshProps();
      }
    };
  }

  function update(nextBoard: Board): void {
    currentBoard = nextBoard;
    // Update name text if focus is not currently in the name element.
    if (document.activeElement !== name) {
      name.textContent = nextBoard.name || '';
      name.classList.toggle('is-placeholder', !nextBoard.name);
    }
    refreshViewSeg?.();
    // If the more menu is open, refresh the props so newly-added fields appear.
    refreshPropsIfOpen?.();
  }

  return { el: chrome, update };
}

export function buildHeaderMore(
  ctx: BoardRendererCtx,
  registerMenuClose: (cb: () => void) => void,
  unregisterMenuClose: () => void,
): { el: HTMLElement; refreshViewSeg: () => void; refreshProps: () => void; isMenuOpen: () => boolean } {
  const wrap = document.createElement('div');
  wrap.className = 'bd-more';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bd-more-btn';
  btn.setAttribute('aria-label', 'More');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>`;

  const menu = document.createElement('div');
  menu.className = 'bd-more-menu bd-hidden';
  menu.setAttribute('role', 'menu');

  const viewRow = document.createElement('div');
  viewRow.className = 'bd-more-view';
  const seg = document.createElement('div');
  seg.className = 'bd-view-seg';
  const mkSeg = (name: 'kanban' | 'table', label: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bd-view-seg-btn';
    b.dataset.view = name;
    b.textContent = label;
    return b;
  };
  const kanbanBtn = mkSeg('kanban', 'Kanban');
  const tableBtn  = mkSeg('table',  'Table');
  seg.append(kanbanBtn, tableBtn);
  viewRow.appendChild(seg);
  menu.appendChild(viewRow);

  const sep = document.createElement('div');
  sep.className = 'bd-more-sep';
  menu.appendChild(sep);

  const propsHost = document.createElement('div');
  propsHost.className = 'bd-more-props';
  menu.appendChild(propsHost);

  const delSep = document.createElement('div');
  delSep.className = 'bd-more-sep';
  menu.appendChild(delSep);

  const delRow = document.createElement('button');
  delRow.type = 'button';
  delRow.className = 'bd-more-delete';
  delRow.setAttribute('role', 'menuitem');
  delRow.innerHTML =
    '<svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor"><path d="M216 48h-40v-8a24 24 0 0 0-24-24h-48a24 24 0 0 0-24 24v8H40a8 8 0 0 0 0 16h8v144a16 16 0 0 0 16 16h128a16 16 0 0 0 16-16V64h8a8 8 0 0 0 0-16ZM96 40a8 8 0 0 1 8-8h48a8 8 0 0 1 8 8v8H96Zm16 152a8 8 0 0 1-16 0v-72a8 8 0 0 1 16 0Zm48 0a8 8 0 0 1-16 0v-72a8 8 0 0 1 16 0Z"/></svg><span>Delete board</span>';
  delRow.addEventListener('click', () => { closeMenu(); ctx.requestDelete(); });
  menu.appendChild(delRow);

  wrap.append(btn, menu);

  function refreshViewSeg(): void {
    const cur = ctx.getBoard().activeView;
    kanbanBtn.classList.toggle('bd-view-seg-active', !cur || cur === 'kanban');
    tableBtn.classList.toggle('bd-view-seg-active', cur === 'table');
  }

  let removeOutside: (() => void) | null = null;

  // Single, stable renderPropertiesContent instance per menu open. refreshProps
  // calls its rebuild() to update the field list in-place, preserving any
  // in-flight picker / focus / closure state inside the popover.
  let propsHandle: { rebuild: () => void } | null = null;
  function refreshProps(): void {
    if (propsHandle) {
      propsHandle.rebuild();
      return;
    }
    propsHost.innerHTML = '';
    propsHandle = renderPropertiesContent(
      propsHost,
      () => ctx.getBoard(),
      ctx.mutate,
      ctx.getBoard().activeView ?? 'kanban',
    );
  }

  function openMenu(): void {
    menu.classList.remove('bd-hidden');
    btn.setAttribute('aria-expanded', 'true');
    refreshViewSeg();
    // Force a fresh render on each open in case viewName changed (kanban↔table).
    propsHandle = null;
    refreshProps();

    function onOutside(e: MouseEvent): void {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('.bd-more-menu, .board-field-action-menu, .board-add-field-picker, .board-confirm-overlay')) return;
      closeMenu();
    }
    removeOutside = () => document.removeEventListener('mousedown', onOutside, true);
    setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

    registerMenuClose(closeMenu);
  }

  function closeMenu(): void {
    menu.classList.add('bd-hidden');
    btn.setAttribute('aria-expanded', 'false');
    propsHost.innerHTML = '';
    propsHandle = null;
    removeOutside?.();
    removeOutside = null;
    unregisterMenuClose();
  }

  btn.addEventListener('click', () => {
    if (menu.classList.contains('bd-hidden')) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  kanbanBtn.addEventListener('click', () => {
    ctx.mutate({ ...ctx.getBoard(), activeView: 'kanban' });
    closeMenu();
  });

  tableBtn.addEventListener('click', () => {
    ctx.mutate({ ...ctx.getBoard(), activeView: 'table' });
    closeMenu();
  });

  return { el: wrap, refreshViewSeg, refreshProps, isMenuOpen: () => !menu.classList.contains('bd-hidden') };
}

function selectAllText(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}
