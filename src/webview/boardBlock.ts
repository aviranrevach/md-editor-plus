// src/webview/boardBlock.ts
import { parseBoardSource, serializeBoard, type Board } from './boardModel';
import { mountKanban } from './boardKanbanRender';
import { mountTable } from './boardTableRender';
import { openBoardSidePanel } from './boardSidePanel';

export interface BoardView {
  dom: HTMLElement;
  update(source: string): void;
}

export interface BoardViewOptions {
  onMutate(nextSource: string): void;
  isReadOnly(): boolean;
}

/** Context object passed from the controller to a board renderer. */
export interface BoardRendererCtx {
  root:           HTMLElement;
  getBoard:       () => Board;
  mutate:         (next: Board) => void;
  /** Open the card side-panel for the given card id. */
  openSidePanel:  (cardId: string) => void;
  readonly:       boolean;
}

/** Lifecycle handles returned by a board renderer. */
export interface BoardRendererOps {
  update:  (next: Board) => void;
  destroy: () => void;
}

export function createBoardView(initialSource: string, opts: BoardViewOptions): BoardView {
  const dom = document.createElement('div');
  dom.className = 'board-block';
  dom.setAttribute('contenteditable', 'false');
  // Tag the DOM with the board's id so the slash-insert handler (and any
  // other external caller) can reliably target a specific board instance —
  // important when more than one board exists in the same document.
  {
    const initialBoard = parseBoardSource(initialSource);
    if (initialBoard.id) dom.dataset.boardId = initialBoard.id;
  }

  // Stop mousedown from bubbling up to ProseMirror, which would call
  // preventDefault on it (to keep the editor focused) and kill the resulting
  // click event on buttons/cards, AND would also set a NodeSelection that
  // steals focus from inline editable spans.
  //
  // IMPORTANT: stop ONLY mousedown (not click). Stopping click in the capture
  // phase prevents the click from ever reaching the target's listener, which
  // breaks every button and card inside the board.
  dom.addEventListener('mousedown', (e: Event) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    // When the user starts interacting with the board, blur the surrounding
    // ProseMirror editable root so the blinking text caret in the paragraph
    // below the board disappears. Nested contenteditable spans (board name,
    // column name, card title) get focus naturally on click, so this only
    // hides the stray caret from the outer document area.
    const pmRoot = findEditableAncestor(dom);
    if (pmRoot && document.activeElement === pmRoot) {
      pmRoot.blur();
    }
    if (t.closest('[contenteditable="true"], button, input, select, textarea, .board-card, .board-column')) {
      e.stopPropagation();
    }
  }, true);

  // Keep board-internal drag events out of Tiptap's global drag-handle gutter,
  // which would otherwise also show a (wrong) block-level insertion line outside
  // the board. Bubble phase: target's own dragstart/dragover/etc. fire first,
  // then we cut the event off before it reaches the editor root.
  for (const t of ['dragstart', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop'] as const) {
    dom.addEventListener(t, (e) => {
      e.stopPropagation();
    });
  }

  let board = parseBoardSource(initialSource);

  function mutate(next: Board): void {
    const prevActiveView = board.activeView;
    board = next;
    opts.onMutate(serializeBoard(board));
    if (board.activeView !== prevActiveView) {
      mountForActiveView();
    } else {
      renderer!.update(board);
    }
  }

  const ctx: BoardRendererCtx = {
    root:     dom,
    getBoard: () => board,
    mutate,
    openSidePanel: (cardId: string) => {
      const card = board.cards.find((c) => c.id === cardId);
      if (!card) return;
      const ro = opts.isReadOnly();
      openBoardSidePanel(
        board,
        card,
        ro
          ? () => {}
          : (nextCard) => {
              const next: Board = {
                ...board,
                cards: board.cards.map((c) => (c.id === nextCard.id ? nextCard : c)),
              };
              mutate(next);
            },
        ro,
        ro ? undefined : (nextBoard) => mutate(nextBoard),
      );
    },
    readonly: opts.isReadOnly(),
  };
  let renderer: BoardRendererOps | null = null;
  function mountForActiveView(): void {
    renderer?.destroy();
    renderer = board.activeView === 'table'
      ? mountTable(ctx)
      : mountKanban(ctx);
  }
  mountForActiveView();

  return {
    dom,
    update(source: string): void {
      const prevActiveView = board.activeView;
      board = parseBoardSource(source);
      ctx.readonly = opts.isReadOnly();
      if (board.activeView !== prevActiveView) {
        mountForActiveView();
      } else {
        renderer!.update(board);
      }
    },
  };
}

function findEditableAncestor(start: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = start.parentElement;
  while (el) {
    if (el.getAttribute('contenteditable') === 'true') return el;
    el = el.parentElement;
  }
  return null;
}
