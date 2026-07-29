/**
 * @jest-environment jsdom
 *
 * Regression guard for c37 — "Saved" but the file is wiped to a fragment.
 *
 * Root cause: editor.ts keeps the editor in module-level singletons
 * (`_editor`, `_editDebounce`, `_frontmatter`). The board side panel rendered
 * a card's *description* body with the SAME `createEditor()`, which overwrote
 * those singletons. After that, the host's save path (`getCurrentMarkdown()` /
 * `flushPendingEdit()`) read the description editor instead of the main
 * document — so saving wrote one card's description as the ENTIRE file.
 *
 * The fix: the description body must be built with an isolated `createDetachedEditor`
 * that never touches the primary singletons. This test asserts that wiring.
 */
import { openBoardSidePanel, closeBoardSidePanel } from '../src/webview/boardSidePanel';
import type { Board, Card } from '../src/webview/boardModel';

// boardSidePanel imports './editor', which jest maps to editorMock.js. Importing
// the mock by its own path resolves to the SAME module instance, so the call
// counters it records are the ones the side panel incremented.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const editorMock = require('./__mocks__/editorMock');

function makeBoard(card: Card): Board {
  return {
    id: 'b1',
    name: 'My Board',
    columns: [],
    fields: [{ name: 'Title', type: 'text', visibleOnCard: true }],
    cards: [card],
    orphanBodies: [],
    views: [],
    activeView: 'table',
  };
}

describe('board side panel description editor isolation (c37)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    editorMock.__reset();
  });

  afterEach(() => {
    closeBoardSidePanel();
  });

  it('builds the description body with an isolated detached editor, never the primary createEditor', () => {
    const card: Card = { id: 'c1', values: { Title: 'Card one' }, body: 'card body text' };

    openBoardSidePanel(makeBoard(card), card, () => {});

    // The description must NOT hijack the primary editor singleton.
    expect(editorMock.__calls.createEditor).toBe(0);
    expect(editorMock.__calls.createDetachedEditor).toBe(1);
  });
});

// c25 — "sometimes no blinking cursor" in the description. Read-only was captured
// as a boolean when the panel opened, then re-applied verbatim on every re-render
// (any property / status / tag commit re-renders the panel). So a read-only
// toggle after opening was never seen: a stale `true` kept re-locking the
// description editor — click it, no caret, can't type. Callers now hand over a
// live getter, which the panel re-reads each render.
describe('description editor tracks LIVE read-only, not a snapshot (c25)', () => {
  const card: Card = { id: 'c1', values: { Title: 'Card one' }, body: '' };

  beforeEach(() => {
    document.body.innerHTML = '';
    editorMock.__reset();
  });
  afterEach(() => closeBoardSidePanel());

  it('locks the editor when the getter says read-only', () => {
    openBoardSidePanel(makeBoard(card), card, () => {}, () => true);
    expect(editorMock.__calls.setEditable).toEqual([false]);
  });

  it('unlocks the editor when the getter says editable', () => {
    openBoardSidePanel(makeBoard(card), card, () => {}, () => false);
    expect(editorMock.__calls.setEditable).toEqual([true]);
  });

  it('picks up a read-only toggle that happened AFTER the panel opened', () => {
    let readOnly = true;
    const board = makeBoard(card);
    openBoardSidePanel(board, card, () => {}, () => readOnly);
    expect(editorMock.__calls.setEditable).toEqual([false]);

    // The user turns read-only OFF, then clicks a card — the panel re-renders.
    readOnly = false;
    openBoardSidePanel(board, card, () => {}, () => readOnly);
    expect(editorMock.__calls.setEditable).toEqual([false, true]);
  });

  it('still accepts a plain boolean (unchanged callers keep working)', () => {
    openBoardSidePanel(makeBoard(card), card, () => {}, true);
    expect(editorMock.__calls.setEditable).toEqual([false]);
  });

  it('defaults to editable when no read-only argument is given', () => {
    openBoardSidePanel(makeBoard(card), card, () => {});
    expect(editorMock.__calls.setEditable).toEqual([true]);
  });
});
