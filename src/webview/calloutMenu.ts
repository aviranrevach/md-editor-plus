import { Editor } from '@tiptap/core';
import { placeFloating, type PlacementHandle } from './menuPosition';

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

const EMOJI_GRID = [
  '😀','😂','😍','🥰','😎','🤔','😢','😡','🙏','👍',
  '👎','❤️','✅','❌','⚠️','💡','❓','❗','⭐','✨',
  '🔥','🎯','🚀','📌','📝','📚','💻','📱','🎉','💯',
  '🌟','🌈','🌸','🍀','☀️','🌙','⏰','🎨','📊','🎁',
];

type View = 'types' | 'emoji';

export interface CalloutMenu {
  open: (anchorEl: HTMLElement, calloutPos: number) => void;
  close: () => void;
}

export function createCalloutMenu(editor: Editor): CalloutMenu {
  let pos = 0;
  let placement: PlacementHandle | null = null;

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

  function showView(view: View): void {
    el.querySelectorAll<HTMLElement>('.callout-menu-view').forEach((v) => {
      v.classList.toggle('active', v.dataset.view === view);
    });
    if (view === 'emoji') {
      const input = el.querySelector<HTMLInputElement>('.callout-menu-emoji-input');
      requestAnimationFrame(() => {
        input?.focus();
        input?.select();
      });
    }
  }

  function render(currentType: CalloutTypeDef['id'], currentEmoji: string): void {
    el.innerHTML = `
      <div class="callout-menu-view active" data-view="types">
        <div class="callout-menu-header">Callout type</div>
        <div class="callout-menu-list">
          ${TYPES.map((t) => `
            <button class="callout-menu-chip ${t.id === currentType ? 'active' : ''}" data-type="${t.id}" data-callout-preview="${t.id}">
              <span class="callout-menu-chip-emoji">${t.id === currentType ? escapeHtml(currentEmoji) : t.emoji}</span>
              <span class="callout-menu-chip-label">${t.label}</span>
              ${t.id === currentType ? '<span class="callout-menu-chip-check">✓</span>' : ''}
            </button>
          `).join('')}
        </div>
        <div class="callout-menu-divider"></div>
        <div class="callout-menu-emoji-section">
          <div class="callout-menu-emoji-head">
            <span class="callout-menu-emoji-title">Custom emoji</span>
            <button class="callout-menu-emoji-reset" data-action="reset">Reset</button>
          </div>
          <button class="callout-menu-emoji-trigger" data-action="open-picker">
            <span class="callout-menu-emoji-current">${escapeHtml(currentEmoji)}</span>
            <span class="callout-menu-emoji-trigger-label">Customize Emoji</span>
            <span class="callout-menu-emoji-trigger-caret">›</span>
          </button>
        </div>
      </div>
      <div class="callout-menu-view" data-view="emoji">
        <button class="callout-menu-back" data-action="back">
          <span class="callout-menu-back-icon">‹</span>
          <span class="callout-menu-back-label">Customize emoji</span>
        </button>
        <div class="callout-menu-emoji-input-row">
          <input
            class="callout-menu-emoji-input"
            type="text"
            spellcheck="false"
            autocomplete="off"
            maxlength="32"
            placeholder="Paste any emoji or press ↵"
            value="${escapeAttr(currentEmoji)}"
          />
          <button class="callout-menu-emoji-apply" data-action="apply">Set</button>
        </div>
        <div class="callout-menu-emoji-hint">
          Tip: focus this field and press <kbd>${osPickerShortcut()}</kbd> for the system emoji picker.
        </div>
        <div class="callout-menu-emoji-quickpicks-label">Quick picks</div>
        <div class="callout-menu-emoji-grid">
          ${EMOJI_GRID.map((e) => `
            <button class="callout-menu-emoji-cell ${e === currentEmoji ? 'active' : ''}" data-emoji="${escapeAttr(e)}" title="${escapeAttr(e)}">${e}</button>
          `).join('')}
        </div>
      </div>
    `;

    el.querySelectorAll<HTMLButtonElement>('.callout-menu-chip').forEach((row) => {
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const newType = row.dataset.type as CalloutTypeDef['id'];
        const newEmoji = DEFAULT_EMOJI_BY_TYPE[newType] ?? '💡';
        setAttrs(newType, newEmoji);
        close();
      });
    });

    el.querySelector<HTMLButtonElement>('[data-action="open-picker"]')?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showView('emoji');
    });

    el.querySelector<HTMLButtonElement>('[data-action="back"]')?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showView('types');
    });

    const input = el.querySelector<HTMLInputElement>('.callout-menu-emoji-input');
    function applyInput(): void {
      const raw = input?.value.trim() ?? '';
      if (!raw) return;
      setAttrs(null, raw);
      // Update the trigger preview and return to the types view; the callout
      // itself reflects the change because setAttrs has already fired.
      refreshTriggerPreview();
      showView('types');
    }

    function refreshTriggerPreview(): void {
      const next = input?.value.trim() ?? '';
      const cur = el.querySelector<HTMLElement>('.callout-menu-emoji-current');
      if (cur) cur.textContent = next;
      // Also reflect the change on the active type chip in the types view.
      const activeChipEmoji = el.querySelector<HTMLElement>('.callout-menu-chip.active .callout-menu-chip-emoji');
      if (activeChipEmoji) activeChipEmoji.textContent = next;
    }

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyInput();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        showView('types');
      }
    });
    input?.addEventListener('mousedown', (e) => { e.stopPropagation(); });

    el.querySelector<HTMLButtonElement>('[data-action="apply"]')?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyInput();
    });

    el.querySelectorAll<HTMLButtonElement>('.callout-menu-emoji-cell').forEach((cell) => {
      cell.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = cell.dataset.emoji ?? '';
        if (!next) return;
        if (input) input.value = next;
        setAttrs(null, next);
        refreshTriggerPreview();
        showView('types');
      });
    });

    el.querySelector<HTMLButtonElement>('[data-action="reset"]')?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const defaultEmoji = DEFAULT_EMOJI_BY_TYPE[currentType];
      setAttrs(null, defaultEmoji);
      if (input) input.value = defaultEmoji;
      const cur = el.querySelector<HTMLElement>('.callout-menu-emoji-current');
      if (cur) cur.textContent = defaultEmoji;
      const activeChipEmoji = el.querySelector<HTMLElement>('.callout-menu-chip.active .callout-menu-chip-emoji');
      if (activeChipEmoji) activeChipEmoji.textContent = defaultEmoji;
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
      placement = placeFloating(el, anchorEl);
    } catch (err) {
      console.error('[md-editor-plus] calloutMenu.open failed', err);
    }
  }

  function close(): void {
    el.classList.remove('open');
    placement?.destroy();
    placement = null;
  }

  document.addEventListener('mousedown', (e) => {
    if (!el.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.classList.contains('open')) close();
  });
  // Close on any scroll — the popover is anchored to a viewport position,
  // so scrolling makes it visually disconnect from the callout it opened
  // from. capture:true catches scrolls on every ancestor.
  window.addEventListener('scroll', () => {
    if (el.classList.contains('open')) close();
  }, { capture: true, passive: true });

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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function osPickerShortcut(): string {
  const ua = (navigator.userAgent || '').toLowerCase();
  const platform = ((navigator as unknown as { platform?: string }).platform || '').toLowerCase();
  if (ua.includes('mac') || platform.includes('mac')) return '⌃⌘Space';
  if (ua.includes('win') || platform.includes('win')) return 'Win+.';
  if (ua.includes('linux')) return 'system emoji shortcut';
  return '⌃⌘Space';
}
