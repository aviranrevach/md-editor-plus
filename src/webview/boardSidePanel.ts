// src/webview/boardSidePanel.ts
import type { Board, Card } from './boardModel';
import { createEditor } from './editor';

let panel: HTMLElement | null = null;
let currentBoard: Board | null = null;
let currentCard: Card | null = null;
let currentOnChange: ((next: Card) => void) | null = null;
let currentReadOnly = false;

export function initBoardSidePanel(): void {
  if (panel) return;
  panel = document.createElement('aside');
  panel.className = 'board-side-panel';
  panel.style.display = 'none';
  document.body.appendChild(panel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel && panel.style.display !== 'none') {
      closeBoardSidePanel();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!panel || panel.style.display === 'none') return;
    if (panel.contains(e.target as Node)) return;
    // Click on a card opens a new panel; don't auto-close in that case.
    const onCard = (e.target as HTMLElement).closest('.board-card');
    if (onCard) return;
    closeBoardSidePanel();
  });
}

export function openBoardSidePanel(
  board: Board,
  card: Card,
  onChange: (next: Card) => void,
  readOnly: boolean = false,
): void {
  initBoardSidePanel();
  currentBoard = board;
  currentCard = card;
  currentOnChange = onChange;
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
  currentReadOnly = false;
}

function renderPanel(): void {
  if (!panel || !currentBoard || !currentCard) return;
  const board = currentBoard;
  const card = currentCard;

  panel.innerHTML = '';
  const close = document.createElement('button');
  close.className = 'board-panel-close';
  close.type = 'button';
  close.textContent = '×';
  close.addEventListener('click', closeBoardSidePanel);
  panel.appendChild(close);

  const title = document.createElement('div');
  title.className = 'board-panel-title';
  title.contentEditable = currentReadOnly ? 'false' : 'true';
  title.textContent = card.values.Title || '';
  title.dataset.placeholder = 'Untitled';
  if (!currentReadOnly) {
    title.addEventListener('blur', () => {
      if (!currentOnChange) return;
      const next: Card = { ...card, values: { ...card.values, Title: title.textContent || '' } };
      currentOnChange(next);
    });
  }
  panel.appendChild(title);

  for (const field of board.fields) {
    if (field.name === 'Title') continue;
    if (!field.visibleOnCard && field.name === 'id') continue; // hide id by default
    const row = document.createElement('div');
    row.className = 'board-panel-field';
    const label = document.createElement('span');
    label.className = 'board-panel-field-label';
    label.textContent = field.name;
    row.appendChild(label);

    if (field.type === 'date') {
      const input = document.createElement('input');
      input.type = 'date';
      input.className = 'board-panel-field-value';
      input.value = card.values[field.name] || '';
      input.disabled = currentReadOnly;
      if (!currentReadOnly) {
        input.addEventListener('change', () => {
          if (!currentOnChange) return;
          const next: Card = { ...card, values: { ...card.values, [field.name]: input.value } };
          currentOnChange(next);
        });
      }
      row.appendChild(input);
    } else if (field.type === 'status') {
      const select = document.createElement('select');
      select.className = 'board-panel-field-value';
      for (const col of board.columns) {
        const opt = document.createElement('option');
        opt.value = col.name;
        opt.textContent = col.name;
        if (card.values.Status === col.name) opt.selected = true;
        select.appendChild(opt);
      }
      select.disabled = currentReadOnly;
      if (!currentReadOnly) {
        select.addEventListener('change', () => {
          if (!currentOnChange) return;
          const next: Card = { ...card, values: { ...card.values, Status: select.value } };
          currentOnChange(next);
        });
      }
      row.appendChild(select);
    } else if (field.type === 'tags') {
      const wrap = document.createElement('div');
      wrap.className = 'board-tag-input';
      const tags = (card.values[field.name] || '').split(',').map((t) => t.trim()).filter(Boolean);
      if (currentReadOnly) {
        // Read-only: render chips without remove buttons or input
        tags.forEach((tag) => {
          const chip = document.createElement('span');
          chip.className = 'board-tag-chip';
          chip.textContent = tag;
          chip.style.pointerEvents = 'none';
          wrap.appendChild(chip);
        });
      } else {
        const renderChips = () => {
          // Remove existing chips before re-rendering
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
        };
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Add tag…';
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
          if (!currentOnChange) return;
          const next: Card = { ...card, values: { ...card.values, [field.name]: tags.join(', ') } };
          currentOnChange(next);
          renderChips();
        };
        wrap.appendChild(input);
        renderChips();
      }
      row.appendChild(wrap);
    } else {
      // text or person
      const value = document.createElement('span');
      value.className = 'board-panel-field-value';
      value.contentEditable = currentReadOnly ? 'false' : 'true';
      value.textContent = card.values[field.name] || '';
      if (!currentReadOnly) {
        value.addEventListener('blur', () => {
          if (!currentOnChange) return;
          const next: Card = { ...card, values: { ...card.values, [field.name]: value.textContent || '' } };
          currentOnChange(next);
        });
      }
      row.appendChild(value);
    }
    panel.appendChild(row);
  }

  const body = document.createElement('div');
  body.className = 'board-panel-body editable';
  panel.appendChild(body);
  const sub = createEditor(body, card.body || '', (markdown: string) => {
    if (!currentOnChange) return;
    const next: Card = { ...card, body: markdown };
    currentOnChange(next);
  });
  sub.setEditable(!currentReadOnly);
}
