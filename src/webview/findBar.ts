import type { Editor } from '@tiptap/core';
import { SearchCoordinator } from './searchCoordinator';

// Floating, Notion-style find bar. It owns its own DOM and keyboard handling
// and stays agnostic about WHICH editor it drives — the host hands it a
// `getActiveEditor` callback so the same bar works in both the preview and the
// source view. Find-only (no replace) by design for v1.

export interface FindBar {
  /** Show the bar, focus the input, seed from the current selection, run search. */
  open(): void;
  /** Hide the bar and clear all match highlights on the active editor. */
  close(): void;
  isOpen(): boolean;
  /**
   * Re-run the current query against a (possibly different) active editor —
   * called when the user switches between preview and source while the bar is
   * open so highlights move to the now-visible editor.
   */
  retarget(previousEditor: Editor | null): void;
}

interface FindBarOptions {
  getActiveEditor: () => Editor | null;
}

export function createFindBar({ getActiveEditor }: FindBarOptions): FindBar {
  let open = false;
  const coordinator = new SearchCoordinator();

  // Board card highlights are CSS Custom Highlight ranges anchored to the
  // board's live text nodes. When a board re-renders (external sync echo, a
  // cell edit, column autofit, …) it replaces those nodes, which collapses the
  // ranges to empty — the highlight registry still lists them but nothing
  // paints. While the bar is open we watch the active editor for board DOM
  // changes and re-scan, rebuilding the ranges against the fresh nodes.
  let boardObserver: MutationObserver | null = null;
  let refreshScheduled = false;

  const bar = document.createElement('div');
  bar.className = 'find-bar';
  bar.setAttribute('dir', 'ltr');
  bar.innerHTML = `
    <span class="find-bar-icon" aria-hidden="true">${searchIcon()}</span>
    <input class="find-bar-input" type="text" placeholder="Find" aria-label="Find in document" spellcheck="false" />
    <span class="find-bar-count" aria-live="polite">0/0</span>
    <span class="find-bar-divider"></span>
    <button class="find-bar-btn find-bar-prev" title="Previous (Shift+Enter)" aria-label="Previous match">${chevron('up')}</button>
    <button class="find-bar-btn find-bar-next" title="Next (Enter)" aria-label="Next match">${chevron('down')}</button>
    <span class="find-bar-divider"></span>
    <button class="find-bar-btn find-bar-close" title="Close (Esc)" aria-label="Close find">${closeIcon()}</button>
  `;
  document.body.appendChild(bar);

  const input = bar.querySelector('.find-bar-input') as HTMLInputElement;
  const count = bar.querySelector('.find-bar-count') as HTMLElement;
  const prevBtn = bar.querySelector('.find-bar-prev') as HTMLButtonElement;
  const nextBtn = bar.querySelector('.find-bar-next') as HTMLButtonElement;
  const closeBtn = bar.querySelector('.find-bar-close') as HTMLButtonElement;

  function updateCount(): void {
    const { total, active } = coordinator.summary();
    count.textContent = `${active}/${total}`;
    bar.classList.toggle('find-bar-empty', total === 0 && input.value.length > 0);
  }

  function runSearch(): void {
    const editor = getActiveEditor();
    if (!editor) return;
    coordinator.setQuery(editor, input.value);
    updateCount();
  }

  function goNext(): void {
    const editor = getActiveEditor();
    if (editor) coordinator.next(editor);
    updateCount();
  }

  function goPrev(): void {
    const editor = getActiveEditor();
    if (editor) coordinator.prev(editor);
    updateCount();
  }

  // rAF-coalesced re-scan, keeping the user's current match position.
  function scheduleRefresh(): void {
    if (refreshScheduled) return;
    refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshScheduled = false;
      if (!open || !input.value) return;
      const editor = getActiveEditor();
      if (editor) {
        coordinator.refresh(editor);
        updateCount();
      }
    });
  }

  // Watch only `.board-block` subtrees: a board rebuild is what orphans the
  // highlight ranges. Ignoring everything else keeps us from reacting to the
  // ProseMirror search-decoration spans this search adds elsewhere in the doc
  // (which would otherwise loop endlessly).
  function startBoardObserver(editor: Editor | null): void {
    stopBoardObserver();
    if (!editor) return;
    boardObserver = new MutationObserver((mutations) => {
      const touchedBoard = mutations.some((m) => {
        const t = m.target;
        const el = t.nodeType === Node.ELEMENT_NODE ? (t as HTMLElement) : t.parentElement;
        return !!el?.closest('.board-block');
      });
      if (touchedBoard) scheduleRefresh();
    });
    boardObserver.observe(editor.view.dom, { childList: true, subtree: true, characterData: true });
  }

  function stopBoardObserver(): void {
    boardObserver?.disconnect();
    boardObserver = null;
  }

  input.addEventListener('input', runSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.shiftKey ? goPrev() : goNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      goNext();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      goPrev();
    }
  });

  nextBtn.addEventListener('click', () => { goNext(); input.focus(); });
  prevBtn.addEventListener('click', () => { goPrev(); input.focus(); });
  closeBtn.addEventListener('click', () => close());

  function doOpen(): void {
    // Seed from the current selection if it's a short single-line bit of text.
    const editor = getActiveEditor();
    if (editor) {
      const { from, to } = editor.state.selection;
      if (to > from) {
        const sel = editor.state.doc.textBetween(from, to, ' ').trim();
        if (sel && !sel.includes('\n') && sel.length <= 80) input.value = sel;
      }
    }
    open = true;
    bar.classList.add('open');
    input.focus();
    input.select();
    if (input.value) runSearch();
    else updateCount();
    startBoardObserver(editor);
  }

  function close(): void {
    if (!open) return;
    open = false;
    bar.classList.remove('open');
    stopBoardObserver();
    coordinator.clear(getActiveEditor());
    // Return focus to the editor so the user keeps typing where they were.
    getActiveEditor()?.commands.focus();
  }

  function retarget(previousEditor: Editor | null): void {
    if (!open) return;
    coordinator.clear(previousEditor);
    if (input.value) runSearch();
    else updateCount();
    startBoardObserver(getActiveEditor());
  }

  return {
    open: doOpen,
    close,
    isOpen: () => open,
    retarget,
  };
}

function searchIcon(): string {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>`;
}

function chevron(dir: 'up' | 'down'): string {
  const d = dir === 'up' ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6';
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

function closeIcon(): string {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
}
