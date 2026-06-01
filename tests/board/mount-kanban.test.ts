/**
 * @jest-environment jsdom
 *
 * Smoke tests for mountKanban: structural DOM assertions only.
 */

import { mountKanban } from '../../src/webview/boardKanbanRender';
import type { Board } from '../../src/webview/boardModel';
import type { BoardRendererCtx } from '../../src/webview/boardBlock';

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: 'b1',
    name: 'Test Board',
    columns: [
      { name: 'Todo',  color: 'blue'  },
      { name: 'Doing', color: 'amber' },
    ],
    fields: [
      { name: 'Title',  type: 'text',   visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
    ],
    cards: [
      { id: 'c1', values: { id: 'c1', Title: 'Card One',   Status: 'Todo'  }, body: '' },
      { id: 'c2', values: { id: 'c2', Title: 'Card Two',   Status: 'Todo'  }, body: '' },
      { id: 'c3', values: { id: 'c3', Title: 'Card Three', Status: 'Doing' }, body: '' },
    ],
    orphanBodies: [],
    views: [],
    activeView: 'kanban',
    ...overrides,
  };
}

function makeCtx(
  board: Board,
  overrides: Partial<BoardRendererCtx> = {},
): BoardRendererCtx {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return {
    root,
    getBoard: () => board,
    mutate: (_next: Board) => { /* no-op for read-only smoke tests */ },
    openSidePanel: (_id: string) => { /* no-op */ },
    readonly: false,
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mountKanban — smoke tests', () => {
  it('mounts .board-columns inside the root', () => {
    const ctx = makeCtx(makeBoard());
    const ops = mountKanban(ctx);

    const columns = ctx.root.querySelector('.board-columns');
    expect(columns).not.toBeNull();

    ops.destroy();
  });

  it('renders one .board-column per column defined in the board', () => {
    const ctx = makeCtx(makeBoard());
    const ops = mountKanban(ctx);

    const cols = ctx.root.querySelectorAll('.board-column');
    // board has 2 columns; no orphan cards, so no Uncategorized
    expect(cols.length).toBe(2);

    ops.destroy();
  });

  it('each .board-column has the correct data-column attribute', () => {
    const ctx = makeCtx(makeBoard());
    const ops = mountKanban(ctx);

    const cols = ctx.root.querySelectorAll('.board-column[data-column]');
    const names = Array.from(cols).map(c => (c as HTMLElement).dataset.column);
    expect(names).toContain('Todo');
    expect(names).toContain('Doing');

    ops.destroy();
  });

  it('renders one .board-card[data-card-id] per card in the right column', () => {
    const ctx = makeCtx(makeBoard());
    const ops = mountKanban(ctx);

    // c1 and c2 are in Todo
    const todoCol = ctx.root.querySelector('.board-column[data-column="Todo"]');
    expect(todoCol).not.toBeNull();
    const todoCards = todoCol!.querySelectorAll('.board-card[data-card-id]');
    expect(todoCards.length).toBe(2);
    const todoCardIds = Array.from(todoCards).map(c => (c as HTMLElement).dataset.cardId);
    expect(todoCardIds).toContain('c1');
    expect(todoCardIds).toContain('c2');

    // c3 is in Doing
    const doingCol = ctx.root.querySelector('.board-column[data-column="Doing"]');
    expect(doingCol).not.toBeNull();
    const doingCards = doingCol!.querySelectorAll('.board-card[data-card-id]');
    expect(doingCards.length).toBe(1);
    expect((doingCards[0] as HTMLElement).dataset.cardId).toBe('c3');

    ops.destroy();
  });

  it('cards with an unknown Status land in the Uncategorized column', () => {
    const b = makeBoard({
      cards: [
        { id: 'c1', values: { id: 'c1', Title: 'Good',   Status: 'Todo'    }, body: '' },
        { id: 'c2', values: { id: 'c2', Title: 'Orphan', Status: 'Deleted' }, body: '' },
      ],
    });
    const ctx = makeCtx(b);
    const ops = mountKanban(ctx);

    const uncategorized = ctx.root.querySelector('.board-column-uncategorized');
    expect(uncategorized).not.toBeNull();
    const orphanCard = uncategorized!.querySelector('.board-card[data-card-id="c2"]');
    expect(orphanCard).not.toBeNull();

    ops.destroy();
  });

  it('destroy() clears the root', () => {
    const ctx = makeCtx(makeBoard());
    const ops = mountKanban(ctx);

    ops.destroy();

    expect(ctx.root.innerHTML).toBe('');
  });

  it('readonly mode: no .board-add-card or .board-add-column-big buttons', () => {
    const ctx = makeCtx(makeBoard(), { readonly: true });
    const ops = mountKanban(ctx);

    expect(ctx.root.querySelector('.board-add-card')).toBeNull();
    expect(ctx.root.querySelector('.board-add-column-big')).toBeNull();

    ops.destroy();
  });
});
