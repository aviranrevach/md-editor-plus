// src/webview/boardSidePanel.ts
import type { Board, Card } from './boardModel';

export interface SidePanelHost {
  // Called when the panel mutates the card (Phase 6 wires this up).
  onChange?: (next: Card) => void;
}

let panel: HTMLElement | null = null;
let currentBoard: Board | null = null;
let currentCard: Card | null = null;
let host: SidePanelHost | null = null;

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

export function openBoardSidePanel(board: Board, card: Card, h?: SidePanelHost): void {
  initBoardSidePanel();
  currentBoard = board;
  currentCard = card;
  host = h ?? null;
  renderPanel();
  panel!.style.display = 'block';
}

export function closeBoardSidePanel(): void {
  if (!panel) return;
  panel.style.display = 'none';
  currentBoard = null;
  currentCard = null;
  host = null;
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
  title.textContent = card.values.Title || 'Untitled';
  panel.appendChild(title);

  for (const field of board.fields) {
    if (field.name === 'Title') continue;
    if (!field.visibleOnCard && field.name === 'id') continue; // hide id by default
    const row = document.createElement('div');
    row.className = 'board-panel-field';
    const label = document.createElement('span');
    label.className = 'board-panel-field-label';
    label.textContent = field.name;
    const value = document.createElement('span');
    value.className = 'board-panel-field-value';
    value.textContent = card.values[field.name] || '';
    row.append(label, value);
    panel.appendChild(row);
  }

  const body = document.createElement('div');
  body.className = 'board-panel-body';
  body.textContent = card.body || 'No description.';
  panel.appendChild(body);
}
