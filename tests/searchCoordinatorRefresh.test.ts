/**
 * @jest-environment jsdom
 */
import { SearchCoordinator } from '../src/webview/searchCoordinator';
import { scanBoards } from '../src/webview/boardSearch';

// c35 regression: board card highlights are CSS Custom Highlight ranges anchored
// to the board's live text nodes. When a board re-renders it replaces those
// nodes, collapsing the ranges to empty — the registry still lists them but
// nothing paints. SearchCoordinator.refresh() must re-scan the rebuilt DOM and
// rebuild the ranges, keeping the user's current match position.

// Minimal CSS Custom Highlight API stub (jsdom has neither). `Highlight` keeps
// its ranges so the test can inspect whether they collapsed.
class FakeHighlight {
  ranges: Range[];
  size: number;
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
    this.size = ranges.length;
  }
}
function installHighlightStub(): Map<string, FakeHighlight> {
  const reg = new Map<string, FakeHighlight>();
  (globalThis as Record<string, unknown>).Highlight = FakeHighlight;
  (globalThis as Record<string, unknown>).CSS = { highlights: reg };
  return reg;
}

// A board in TABLE view — the layout where the bug bit. Two cells contain "type".
function makeTableBoard(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="board-block">
      <table class="bd-table"><tbody>
        <tr class="bd-table-row"><td class="bd-table-cell bd-cell-text" data-field="Title">the data type matters</td></tr>
        <tr class="bd-table-row"><td class="bd-table-cell bd-cell-text" data-field="Title">another type here</td></tr>
      </tbody></table>
    </div>`;
  return root;
}

// Replace every cell's text node with a fresh one holding the same text — what
// a board re-render does (and what collapses the live ranges).
function rerenderCells(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.bd-table-cell').forEach((td) => {
    const text = td.textContent ?? '';
    while (td.firstChild) td.removeChild(td.firstChild);
    td.appendChild(document.createTextNode(text));
  });
}

interface MockEditor {
  commands: { setSearchTerm: jest.Mock; setActiveMatch: jest.Mock; clearSearch: jest.Mock };
  state: Record<string, unknown>;
  view: { dom: HTMLElement; coordsAtPos: () => { top: number; left: number } };
}
function mockEditor(dom: HTMLElement): MockEditor {
  return {
    commands: { setSearchTerm: jest.fn(), setActiveMatch: jest.fn(), clearSearch: jest.fn() },
    state: {},
    view: { dom, coordsAtPos: () => ({ top: 0, left: 0 }) },
  };
}

beforeAll(() => {
  // scrollBoardMatchIntoView calls el.scrollIntoView, which jsdom doesn't implement.
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

describe('scanBoards — table view (c35 untested gap)', () => {
  it('finds matches inside .bd-table-cell text', () => {
    const root = makeTableBoard();
    expect(scanBoards(root, 'type').map((m) => m.range.toString())).toEqual(['type', 'type']);
  });
});

describe('SearchCoordinator.refresh — survives a board re-render (c35)', () => {
  it('rebuilds collapsed highlight ranges and keeps the active match', () => {
    const reg = installHighlightStub();
    const root = makeTableBoard();
    document.body.appendChild(root);
    const editor = mockEditor(root);

    const coord = new SearchCoordinator();
    coord.setQuery(editor as never, 'type');
    expect(coord.summary().total).toBe(2);

    // Move to the second match so we can prove the position is preserved.
    coord.next(editor as never);
    expect(coord.summary().active).toBe(2);

    // Grab a registered range and confirm it's live before the re-render.
    const liveRange = [...(reg.get('md-board-search')?.ranges ?? []), ...(reg.get('md-board-search-active')?.ranges ?? [])][0];
    expect(liveRange.collapsed).toBe(false);

    // A board re-render replaces the cell text nodes — collapsing that range.
    rerenderCells(root);
    expect(liveRange.collapsed).toBe(true); // the bug: highlight now paints nothing

    // The fix: refresh re-scans the rebuilt DOM and re-registers fresh ranges.
    coord.refresh(editor as never);
    expect(coord.summary().total).toBe(2);
    expect(coord.summary().active).toBe(2); // position preserved

    const fresh = [...(reg.get('md-board-search')?.ranges ?? []), ...(reg.get('md-board-search-active')?.ranges ?? [])];
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((r) => !r.collapsed)).toBe(true);
    expect(fresh.map((r) => r.toString()).sort()).toEqual(['type', 'type']);
  });

  it('is a no-op when there is no active query', () => {
    installHighlightStub();
    const root = makeTableBoard();
    const editor = mockEditor(root);
    const coord = new SearchCoordinator();
    coord.refresh(editor as never); // no setQuery first
    expect(editor.commands.setSearchTerm).not.toHaveBeenCalled();
    expect(coord.summary().total).toBe(0);
  });
});
