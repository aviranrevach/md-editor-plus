import { Schema, Slice, Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { remapPastedBoardIds, collectBoardIds, shouldRemintOnPaste } from '../../src/webview/extensions/board';
import { boardIdOf } from '../../src/webview/boardModel';

// c59: copy→paste of a board reproduced its `board:start id` verbatim, so the
// original and the pasted copy claimed the same id — and the document-wide
// `.board-block[data-board-id="…"]` lookups then alias one board onto the other.
// transformPasted re-mints a colliding pasted board; these cover that remap.

// A minimal stand-in for the real editor schema: just what the remap touches.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] },
    blockquote: { group: 'block', content: 'block+', toDOM: () => ['blockquote', 0] },
    board: {
      group: 'block',
      atom: true,
      attrs: { source: { default: '' } },
      toDOM: () => ['div'],
    },
    text: {},
  },
});

function src(id: string, name = 'My Board'): string {
  return [
    `<!-- board:start id="${id}" name="${name}" columns="Todo|Done" column-colors="blue|emerald" field-types="Title=text,Status=status,id=text" -->`,
    '',
    '| Title | Status | id |',
    '|---|---|---|',
    '| Alpha | Todo | C1 |',
    '',
    '<!-- board:end -->',
  ].join('\n');
}

const board = (id: string): PMNode => schema.nodes.board.create({ source: src(id) });
const para = (t = 'hi'): PMNode => schema.nodes.paragraph.create(null, schema.text(t));
const sliceOf = (...nodes: PMNode[]): Slice => new Slice(Fragment.fromArray(nodes), 0, 0);
const idsIn = (s: Slice): string[] => {
  const out: string[] = [];
  s.content.forEach((n) => { if (n.type.name === 'board') out.push(boardIdOf(n.attrs.source)); });
  return out;
};

// ProseMirror freezes `dragging.move` at DRAGSTART but decides move-vs-copy from
// the modifier held at DROP. Option-dragging to duplicate usually means starting
// a plain drag and pressing Option before releasing — so the dragstart flag says
// "move" while PM actually copies. Trusting it would let an option-drag duplicate
// keep the original's id, which is the whole c59 bug.
describe('shouldRemintOnPaste — move vs copy (option-drag duplicate)', () => {
  it('re-mints a clipboard paste', () => {
    expect(shouldRemintOnPaste({ isInternalDrag: false, dropWasCopy: null, draggingMove: false })).toBe(true);
  });

  it('re-mints a drop from outside the editor', () => {
    expect(shouldRemintOnPaste({ isInternalDrag: false, dropWasCopy: false, draggingMove: true })).toBe(true);
  });

  it('does NOT re-mint a plain internal drag-move (reorder keeps its id)', () => {
    expect(shouldRemintOnPaste({ isInternalDrag: true, dropWasCopy: false, draggingMove: true })).toBe(false);
  });

  it('re-mints when the modifier was held from the start (option-drag throughout)', () => {
    expect(shouldRemintOnPaste({ isInternalDrag: true, dropWasCopy: true, draggingMove: false })).toBe(true);
  });

  it('re-mints when the modifier is pressed MID-drag (dragstart said move)', () => {
    // The realistic option-drag: dragging.move is stale true, the drop says copy.
    expect(shouldRemintOnPaste({ isInternalDrag: true, dropWasCopy: true, draggingMove: true })).toBe(true);
  });

  it('does NOT re-mint when the modifier is RELEASED mid-drag (dragstart said copy)', () => {
    expect(shouldRemintOnPaste({ isInternalDrag: true, dropWasCopy: false, draggingMove: false })).toBe(false);
  });

  it('falls back to dragging.move when no drop modifier was recorded', () => {
    expect(shouldRemintOnPaste({ isInternalDrag: true, dropWasCopy: null, draggingMove: true })).toBe(false);
    expect(shouldRemintOnPaste({ isInternalDrag: true, dropWasCopy: null, draggingMove: false })).toBe(true);
  });
});

describe('collectBoardIds', () => {
  it('finds every board id in the doc', () => {
    const doc = schema.nodes.doc.create(null, [board('b-aaa'), para(), board('b-bbb')]);
    expect([...collectBoardIds(doc)].sort()).toEqual(['b-aaa', 'b-bbb']);
  });

  it('is empty for a doc with no boards', () => {
    expect(collectBoardIds(schema.nodes.doc.create(null, [para()])).size).toBe(0);
  });

  it('skips a board whose source has no id', () => {
    const doc = schema.nodes.doc.create(null, [schema.nodes.board.create({ source: 'garbage' })]);
    expect(collectBoardIds(doc).size).toBe(0);
  });
});

describe('remapPastedBoardIds', () => {
  it('re-mints a pasted board whose id is already in the doc', () => {
    const out = remapPastedBoardIds(sliceOf(board('b-dup')), new Set(['b-dup']));
    const [id] = idsIn(out);
    expect(id).not.toBe('b-dup');
    expect(id).toMatch(/^b-/);
  });

  it('leaves a non-colliding pasted board completely alone', () => {
    const input = sliceOf(board('b-fresh'));
    const out = remapPastedBoardIds(input, new Set(['b-other']));
    expect(out).toBe(input);              // same object — no needless rewrite
    expect(idsIn(out)).toEqual(['b-fresh']);
  });

  it('is a no-op when the doc has no boards at all', () => {
    const input = sliceOf(board('b-any'));
    expect(remapPastedBoardIds(input, new Set())).toBe(input);
  });

  it('keeps everything except the id byte-identical', () => {
    const out = remapPastedBoardIds(sliceOf(board('b-dup')), new Set(['b-dup']));
    const source = out.content.firstChild!.attrs.source as string;
    expect(source).toBe(src(boardIdOf(source)));
    expect(source).toContain('| Alpha | Todo | C1 |');
    expect(source).toContain('name="My Board"');
  });

  it('gives two colliding boards in ONE paste two different ids', () => {
    const out = remapPastedBoardIds(sliceOf(board('b-dup'), board('b-dup')), new Set(['b-dup']));
    const [a, b] = idsIn(out);
    expect(a).not.toBe('b-dup');
    expect(b).not.toBe('b-dup');
    expect(a).not.toBe(b);
  });

  it('does not let a second pasted board reuse the first pasted board\'s id', () => {
    // b-one collides (re-minted); b-two does not, but must still be reserved so
    // a later collision can never be handed b-two.
    const out = remapPastedBoardIds(sliceOf(board('b-one'), board('b-two'), board('b-one')), new Set(['b-one']));
    const ids = idsIn(out);
    expect(ids[1]).toBe('b-two');
    expect(new Set(ids).size).toBe(3);
  });

  it('catches a board nested inside another block', () => {
    const quoted = schema.nodes.blockquote.create(null, [board('b-dup')]);
    const out = remapPastedBoardIds(sliceOf(quoted), new Set(['b-dup']));
    const inner = out.content.firstChild!.firstChild!;
    expect(boardIdOf(inner.attrs.source as string)).not.toBe('b-dup');
  });

  it('passes non-board content through untouched', () => {
    const out = remapPastedBoardIds(sliceOf(para('keep me'), board('b-dup')), new Set(['b-dup']));
    expect(out.content.firstChild!.textContent).toBe('keep me');
  });

  it('preserves the slice open depths so the paste still merges correctly', () => {
    const input = new Slice(Fragment.fromArray([board('b-dup')]), 1, 1);
    const out = remapPastedBoardIds(input, new Set(['b-dup']));
    expect(out.openStart).toBe(1);
    expect(out.openEnd).toBe(1);
  });

  it('leaves a board with an unparseable source alone', () => {
    const input = sliceOf(schema.nodes.board.create({ source: 'not a board region' }));
    expect(remapPastedBoardIds(input, new Set(['b-dup']))).toBe(input);
  });
});
