/**
 * @jest-environment jsdom
 */
import { scanBoards } from '../src/webview/boardSearch';

// Build a minimal board DOM mirroring what the kanban/table renderers emit.
function makeBoard(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="board-block">
      <div class="board-chrome"><span class="board-name">Release Plan</span></div>
      <div class="board-body">
        <div class="board-columns">
          <div class="board-column">
            <div class="board-column-head">
              <span class="board-column-name">In Progress</span>
              <span class="board-column-count">2</span>
              <button class="board-column-dots">⋯</button>
            </div>
            <div class="board-card-list">
              <div class="board-card">
                <div class="board-card-title">Ship the search feature</div>
                <div class="board-card-preview">covers preview and code views</div>
                <div class="board-card-chips"><span class="chip">backend</span></div>
              </div>
              <div class="board-card">
                <div class="board-card-title">Write the search docs</div>
              </div>
              <button class="board-add-card">+ New card</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  return root;
}

describe('scanBoards', () => {
  it('returns nothing for an empty query', () => {
    expect(scanBoards(makeBoard(), '')).toEqual([]);
  });

  it('finds matches across titles, previews, chips, column and board names', () => {
    const root = makeBoard();
    // "search" appears in two card titles.
    expect(scanBoards(root, 'search').map((m) => m.range.toString())).toEqual(['search', 'search']);
    // "preview" appears in the card body preview.
    expect(scanBoards(root, 'preview').map((m) => m.range.toString())).toEqual(['preview']);
  });

  it('matches case-insensitively and reads the board name and column name', () => {
    const root = makeBoard();
    expect(scanBoards(root, 'release').map((m) => m.range.toString())).toEqual(['Release']);
    expect(scanBoards(root, 'progress').map((m) => m.range.toString())).toEqual(['Progress']);
    expect(scanBoards(root, 'backend')).toHaveLength(1);
  });

  it('ignores chrome — counts, the ⋯ menu, and the "+ New card" button', () => {
    const root = makeBoard();
    // The column count "2", the ⋯ glyph, and "+ New card" are chrome; none match.
    expect(scanBoards(root, '2')).toEqual([]);
    expect(scanBoards(root, '⋯')).toEqual([]);
    expect(scanBoards(root, 'New card')).toEqual([]);
  });

  it('returns each match anchored to a scrollable card / header element', () => {
    const root = makeBoard();
    const m = scanBoards(root, 'Ship')[0];
    expect(m.el.closest('.board-card')).toBeTruthy();
  });
});
