import { Editor } from '@tiptap/core';

interface CalloutTypeDef {
  id: 'note' | 'tip' | 'important' | 'warning' | 'caution';
  label: string;
  emoji: string;
}

const TYPES: CalloutTypeDef[] = [
  { id: 'note',      label: 'Note',      emoji: '💡' },
  { id: 'tip',       label: 'Tip',       emoji: '✅' },
  { id: 'important', label: 'Important', emoji: '📌' },
  { id: 'warning',   label: 'Warning',   emoji: '⚠️' },
  { id: 'caution',   label: 'Caution',   emoji: '🛑' },
];

const DEFAULT_EMOJI_BY_TYPE: Record<CalloutTypeDef['id'], string> =
  TYPES.reduce((acc, t) => ({ ...acc, [t.id]: t.emoji }), {} as Record<CalloutTypeDef['id'], string>);

export interface CalloutMenu {
  open: (anchorEl: HTMLElement, calloutPos: number) => void;
  close: () => void;
}

export function createCalloutMenu(editor: Editor): CalloutMenu {
  let pos = 0;

  const el = document.createElement('div');
  el.className = 'callout-menu';
  document.body.appendChild(el);

  function setAttrs(nextType: CalloutTypeDef['id'] | null, nextEmoji: string | null): void {
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        const node = tr.doc.nodeAt(pos);
        if (!node || node.type.name !== 'callout') return false;
        if (dispatch) {
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            ...(nextType ? { type: nextType } : {}),
            ...(nextEmoji ? { emoji: nextEmoji } : {}),
          });
        }
        return true;
      })
      .run();
  }

  function render(currentType: CalloutTypeDef['id'], currentEmoji: string): void {
    el.innerHTML = `
      <div class="callout-menu-header">Callout type</div>
      <div class="callout-menu-list">
        ${TYPES.map((t) => `
          <button class="callout-menu-item ${t.id === currentType ? 'active' : ''}" data-type="${t.id}" data-callout-preview="${t.id}">
            <span class="callout-menu-emoji">${t.emoji}</span>
            <span class="callout-menu-label">${t.label}</span>
            ${t.id === currentType ? '<span class="callout-menu-check">✓</span>' : ''}
          </button>
        `).join('')}
      </div>
      <div class="callout-menu-divider"></div>
      <div class="callout-menu-header">Custom emoji</div>
      <div class="callout-menu-emoji-row">
        <input
          class="callout-menu-emoji-input"
          type="text"
          maxlength="20"
          spellcheck="false"
          autocomplete="off"
          value="${escapeAttr(currentEmoji)}"
          placeholder="Paste any emoji"
        />
        <button class="callout-menu-emoji-apply" data-action="apply">Set</button>
      </div>
      <button class="callout-menu-emoji-reset" data-action="reset">Reset to default ${DEFAULT_EMOJI_BY_TYPE[currentType]}</button>
    `;

    el.querySelectorAll<HTMLButtonElement>('.callout-menu-item').forEach((row) => {
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const newType = row.dataset.type as CalloutTypeDef['id'];
        const newEmoji = DEFAULT_EMOJI_BY_TYPE[newType] ?? '💡';
        setAttrs(newType, newEmoji);
        close();
      });
    });

    const input = el.querySelector<HTMLInputElement>('.callout-menu-emoji-input');
    const applyBtn = el.querySelector<HTMLButtonElement>('[data-action="apply"]');
    const resetBtn = el.querySelector<HTMLButtonElement>('[data-action="reset"]');

    function applyEmoji(): void {
      const raw = input?.value.trim() ?? '';
      if (!raw) return;
      setAttrs(null, raw);
      close();
    }

    applyBtn?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      applyEmoji();
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyEmoji();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    resetBtn?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      setAttrs(null, DEFAULT_EMOJI_BY_TYPE[currentType]);
      close();
    });
  }

  function open(anchorEl: HTMLElement, calloutPos: number): void {
    try {
      pos = calloutPos;
      const node = editor.state.doc.nodeAt(calloutPos);
      if (!node || node.type.name !== 'callout') return;
      const currentType = (node.attrs.type as CalloutTypeDef['id']) ?? 'note';
      const currentEmoji = (node.attrs.emoji as string) ?? DEFAULT_EMOJI_BY_TYPE[currentType];
      render(currentType, currentEmoji);
      el.classList.add('open');
      const rect = anchorEl.getBoundingClientRect();
      el.style.left = `${rect.left + window.scrollX}px`;
      el.style.top = `${rect.bottom + window.scrollY + 6}px`;
      requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        if (r.bottom > window.innerHeight - 12) {
          el.style.top = `${rect.top + window.scrollY - r.height - 6}px`;
        }
        if (r.right > window.innerWidth - 12) {
          el.style.left = `${window.innerWidth - r.width - 12}px`;
        }
      });
    } catch (err) {
      console.error('[md-editor-plus] calloutMenu.open failed', err);
    }
  }

  function close(): void {
    el.classList.remove('open');
  }

  document.addEventListener('mousedown', (e) => {
    if (!el.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.classList.contains('open')) close();
  });

  // Open the menu when the user clicks the emoji icon inside a rendered callout.
  editor.view.dom.addEventListener('click', (e) => {
    try {
      const target = e.target as HTMLElement | null;
      const emojiEl = target?.closest?.('.callout-emoji') as HTMLElement | null;
      if (!emojiEl) return;
      const calloutEl = emojiEl.closest('.callout') as HTMLElement | null;
      if (!calloutEl) return;
      e.preventDefault();
      e.stopPropagation();
      const innerPos = editor.view.posAtDOM(calloutEl, 0);
      if (innerPos == null || innerPos < 0) return;
      const $pos = editor.state.doc.resolve(innerPos);
      if ($pos.depth < 1) return;
      const calloutPos = $pos.before(1);
      open(emojiEl, calloutPos);
    } catch (err) {
      console.error('[md-editor-plus] callout emoji click failed', err);
    }
  });

  return { open, close };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
