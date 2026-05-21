// src/webview/boardSidePanel.ts
import type { Board, Card, FieldType } from './boardModel';
import { createEditor } from './editor';
import { promptNewField } from './boardProperties';

let panel: HTMLElement | null = null;
let currentBoard: Board | null = null;
let currentCard: Card | null = null;
let currentOnChange: ((next: Card) => void) | null = null;
let currentOnBoardChange: ((next: Board) => void) | null = null;
let currentReadOnly = false;

// Inline SVG icons (16x16 viewBox, 1.5 stroke) per field type. Rendered in the
// muted color (var(--board-text-muted)) so they look like Notion's row glyphs.
const FIELD_TYPE_ICONS: Record<FieldType, string> = {
  text:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <path d="M3 4h10M3 8h10M3 12h7"/>
    </svg>`,
  status:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="2" fill="currentColor"/>
    </svg>`,
  date:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1"/>
      <path d="M2.5 6.5h11M5.5 2v2M10.5 2v2"/>
    </svg>`,
  person:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="8" cy="6" r="2.5"/>
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5"/>
    </svg>`,
  tags:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <path d="M3 6h10M3 10h10M6 3v10M10 3v10"/>
    </svg>`,
};

const ICON_PLUS =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <path d="M8 3v10M3 8h10"/>
  </svg>`;
const ICON_CLOSE =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <path d="M4 4l8 8M12 4l-8 8"/>
  </svg>`;

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
}

function renderPanel(): void {
  if (!panel || !currentBoard || !currentCard) return;
  const board = currentBoard;
  const card = currentCard;

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

  // === Body container (scrolls) ===
  const wrap = document.createElement('div');
  wrap.className = 'board-panel-wrap';
  panel.appendChild(wrap);

  // === Big editable title ===
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
      if (!currentOnChange) return;
      const next: Card = { ...card, values: { ...card.values, Title: title.textContent || '' } };
      currentOnChange(next);
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
  wrap.appendChild(title);

  // === Properties section ===
  const props = document.createElement('div');
  props.className = 'board-panel-props';
  for (const field of board.fields) {
    if (field.name === 'Title') continue;
    if (!field.visibleOnCard && field.name === 'id') continue;
    props.appendChild(renderPropRow(board, card, field));
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
      if (!currentOnBoardChange) return; // shouldn't happen — wired in boardBlock
      promptNewField(addProp, board, (nextBoard) => {
        currentOnBoardChange?.(nextBoard);
      });
    });
    props.appendChild(addProp);
  }
  wrap.appendChild(props);

  // === Divider ===
  const divider = document.createElement('div');
  divider.className = 'board-panel-divider';
  wrap.appendChild(divider);

  // === Body ===
  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'board-panel-body-wrap';
  wrap.appendChild(bodyWrap);

  const bodyHost = document.createElement('div');
  bodyHost.className = 'board-panel-body editable';
  bodyWrap.appendChild(bodyHost);

  const sub = createEditor(bodyHost, card.body || '', (markdown: string) => {
    if (!currentOnChange) return;
    const next: Card = { ...card, body: markdown };
    currentOnChange(next);
    updateBodyPlaceholderVisibility(bodyWrap, markdown);
  });
  sub.setEditable(!currentReadOnly);

  // Empty-state placeholder overlay
  const placeholder = document.createElement('div');
  placeholder.className = 'board-panel-body-placeholder';
  placeholder.innerHTML = `Add a description… or press <kbd>/</kbd> for commands`;
  bodyWrap.appendChild(placeholder);
  updateBodyPlaceholderVisibility(bodyWrap, card.body || '');
}

function updateBodyPlaceholderVisibility(bodyWrap: HTMLElement, markdown: string): void {
  const placeholder = bodyWrap.querySelector('.board-panel-body-placeholder') as HTMLElement | null;
  if (!placeholder) return;
  placeholder.style.display = markdown.trim() ? 'none' : 'block';
}

function renderPropRow(board: Board, card: Card, field: { name: string; type: FieldType; visibleOnCard: boolean }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-panel-prop-row';

  const icon = document.createElement('span');
  icon.className = 'board-panel-prop-icon';
  icon.innerHTML = FIELD_TYPE_ICONS[field.type] || FIELD_TYPE_ICONS.text;
  row.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'board-panel-prop-label';
  label.textContent = field.name;
  row.appendChild(label);

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
        if (!currentOnChange) return;
        const next: Card = { ...card, values: { ...card.values, [field.name]: input.value } };
        currentOnChange(next);
      });
    }
    row.appendChild(input);
  } else if (field.type === 'status') {
    const select = document.createElement('select');
    select.className = 'board-panel-prop-value';
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
    } else {
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
        if (!currentOnChange) return;
        const next: Card = { ...card, values: { ...card.values, [field.name]: value.textContent || '' } };
        currentOnChange(next);
      });
    }
    row.appendChild(value);
  }

  return row;
}

function selectAllText(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}
