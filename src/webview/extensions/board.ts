import { Node, mergeAttributes } from '@tiptap/core';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { createBoardView, BOARD_INTERACTIVE_SELECTOR } from '../boardBlock';
import { commitBoardSource } from '../boardCommit';
import { boardIdOf, replaceBoardId, mintBoardId } from '../boardModel';

const REGION_RE =
  /<!--\s*board:start[\s\S]*?<!--\s*board:end\s*-->/gi;

function htmlEscape(s: string): string {
  // Newlines MUST be escaped as &#10; — otherwise the multi-line source attribute
  // breaks markdown-it's HTML block detection (a blank line inside the attribute
  // terminates the HTML block, the table is parsed as markdown, the <div> ends
  // up malformed, and Chromium drops the whole element. getAttribute() decodes
  // &#10; back to \n so parseBoardSource sees the same string it always did.
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;');
}

export function preprocessMarkdownBoards(markdown: string): string {
  return markdown.replace(REGION_RE, (region) => {
    return `<div data-board source="${htmlEscape(region)}"></div>`;
  });
}

// Which modifier turns a drag into a COPY — mirrors prosemirror-view's own
// `dragCopyModifier` (Alt on macOS/iOS, Ctrl elsewhere).
const COPY_MODIFIER: 'altKey' | 'ctrlKey' =
  /Mac|iP(hone|[oa]d)/.test(typeof navigator === 'undefined' ? '' : navigator.platform)
    ? 'altKey'
    : 'ctrlKey';

// Recorded by the drop DOM handler and consumed by `transformPasted` on that same
// drop. Null means "no drop involved" — i.e. a clipboard paste.
let lastDropWasCopy: boolean | null = null;

/**
 * Should a pasted / dropped board whose id collides be given a fresh one?
 *
 * Only an internal drag-MOVE keeps its id: the "collision" there is the very
 * board being moved, which is removed in the same transaction. A COPY-drag
 * (Option on macOS, Ctrl elsewhere) is a genuine duplicate and must be re-minted.
 *
 * `dropWasCopy` comes from the DROP event and wins when present, because
 * ProseMirror freezes `dragging.move` at DRAGSTART (view.dragging is built there)
 * while deciding move-vs-copy from the modifier held at DROP. Those disagree
 * whenever the modifier is pressed mid-drag — which is exactly how you
 * option-drag to duplicate: start moving, then hold Option before releasing.
 */
export function shouldRemintOnPaste(opts: {
  isInternalDrag: boolean;
  dropWasCopy: boolean | null;
  draggingMove: boolean;
}): boolean {
  if (!opts.isInternalDrag) return true;   // clipboard paste, or a drop from outside
  return opts.dropWasCopy ?? !opts.draggingMove;
}

/** Every board id present in `doc` (c59). */
export function collectBoardIds(doc: PMNode, nodeName = 'board'): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === nodeName) {
      const id = boardIdOf(node.attrs.source as string);
      if (id) ids.add(id);
    }
    return true;
  });
  return ids;
}

/**
 * Re-mint the board id of any board in `slice` whose id is already in `taken`,
 * walking nested content so a board pasted inside a wrapper is still caught.
 * Returns the original slice untouched when nothing collides, so a normal paste
 * costs one walk and produces no change. `taken` is mutated as ids are claimed,
 * which is what keeps two colliding boards in ONE paste from landing on the
 * same fresh id.
 */
export function remapPastedBoardIds(slice: Slice, taken: Set<string>, nodeName = 'board'): Slice {
  if (taken.size === 0) return slice;
  let changed = false;

  const remap = (fragment: Fragment): Fragment => {
    const out: PMNode[] = [];
    fragment.forEach((node) => {
      if (node.type.name === nodeName) {
        const source = node.attrs.source as string;
        const id = boardIdOf(source);
        if (id && taken.has(id)) {
          const fresh = mintBoardId(taken);
          taken.add(fresh);
          changed = true;
          out.push(node.type.create({ ...node.attrs, source: replaceBoardId(source, fresh) }, node.content, node.marks));
          return;
        }
        if (id) taken.add(id);
        out.push(node);
        return;
      }
      out.push(node.content.size ? node.copy(remap(node.content)) : node);
    });
    return Fragment.fromArray(out);
  };

  const next = remap(slice.content);
  return changed ? new Slice(next, slice.openStart, slice.openEnd) : slice;
}

const Board = Node.create({
  name: 'board',
  group: 'block',
  atom: true,
  // draggable is intentionally false: the board has its own internal drag-drop for
  // cards/columns. If we set draggable:true here, ProseMirror's global drag-handle
  // gutter would intercept all drag events from within the block.
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      source: {
        default: '',
        parseHTML: (el: HTMLElement) =>
          el.getAttribute('source') ?? '',
        renderHTML: (attrs) => ({ source: attrs.source }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-board]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-board': '' }, HTMLAttributes),
    ];
  },

  // c59 — a copied board pastes its `source` verbatim, id and all, so
  // copy→paste produced two boards claiming the same `board:start id`. Boards
  // that share an id alias each other through the document-wide
  // `.board-block[data-board-id="…"]` lookups, so one board's focus / scroll /
  // measure work can land on the other's DOM. Re-mint any pasted board whose id
  // is already taken.
  //
  // Scoped to `transformPasted` on purpose: it runs only for clipboard + drop,
  // never on load. Rewriting ids in an appendTransaction would dirty a file just
  // for being opened — the phantom-dirty family (c28/c56) we already fixed once.
  addProseMirrorPlugins() {
    const name = this.name;
    return [
      new Plugin({
        props: {
          // Observe the drop's copy-modifier only — never handle the event, so
          // ProseMirror's own drop logic runs exactly as before. This fires
          // before the built-in drop handler, hence before transformPasted.
          handleDOMEvents: {
            drop(_view, event) {
              lastDropWasCopy = !!(event as DragEvent)[COPY_MODIFIER];
              return false;
            },
          },
          transformPasted(slice, view) {
            const dragging = view.dragging;
            const dropWasCopy = lastDropWasCopy;
            lastDropWasCopy = null;
            const remint = shouldRemintOnPaste({
              isInternalDrag: !!dragging,
              dropWasCopy,
              draggingMove: !!dragging?.move,
            });
            if (!remint) return slice;
            return remapPastedBoardIds(slice, collectBoardIds(view.state.doc, name), name);
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    // When the whole board is node-selected (see the chrome click handler in
    // addNodeView), Backspace/Delete removes it. PM's base keymap usually does
    // this already, but the board's stopEvent guard makes that fragile — so we
    // handle it explicitly and unambiguously.
    const deleteSelectedBoard = () => {
      const sel = this.editor.state.selection;
      if (sel instanceof NodeSelection && sel.node.type.name === this.name) {
        return this.editor.commands.deleteSelection();
      }
      return false;
    };
    return {
      Backspace: deleteSelectedBoard,
      Delete:    deleteSelectedBoard,
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let lastSource = node.attrs.source as string;
      const view = createBoardView(lastSource, {
        onMutate(nextSource) {
          // Never drop the edit when getPos() is transiently null (Gap A
          // data-loss): commitBoardSource retries and logs loudly on failure.
          // lastSource is updated via onCommitted ONLY when the write lands, so
          // the update() echo check below stays correct.
          commitBoardSource(editor, getPos, nextSource, {
            onCommitted() { lastSource = nextSource; },
          });
        },
        isReadOnly() {
          return !editor.isEditable;
        },
        onDelete() {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          editor.chain().focus().command(({ tr, dispatch }) => {
            const n = tr.doc.nodeAt(pos);
            if (!n || n.type.name !== 'board') return false;
            if (dispatch) tr.delete(pos, pos + n.nodeSize);
            return true;
          }).run();
        },
      });
      // Clicking the board's own chrome / background (not a card, column,
      // button, input, or editable text) selects the whole board node, so the
      // user can then press Backspace/Delete to remove it — and gets a visible
      // selected outline. Interactive children are descendants of view.dom, so
      // boardBlock's capture-phase mousedown stops their events before this
      // bubble listener; only chrome/background clicks reach here.
      view.dom.addEventListener('mousedown', (e) => {
        if (!editor.isEditable) return;
        const t = e.target as HTMLElement | null;
        if (!t) return;
        if (t.closest(BOARD_INTERACTIVE_SELECTOR)) {
          return;
        }
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return;
        const { state } = editor.view;
        editor.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
        editor.view.focus();
      });
      // setEditable() (the read-only toggle) emits the editor 'update' event but
      // does NOT change the board node's source, so the NodeView.update below
      // never fires for it. Subscribe so the board re-syncs its read-only state
      // (and tears down live edit listeners) the moment the doc is locked (c47).
      // refreshReadOnly() is a no-op unless editability actually flipped.
      const onEditorUpdate = () => view.refreshReadOnly();
      editor.on('update', onEditorUpdate);

      return {
        dom: view.dom,
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          const next = updatedNode.attrs.source as string;
          if (next === lastSource) return true; // no-op when source hasn't changed
          lastSource = next;
          view.update(next);
          return true;
        },
        destroy() {
          editor.off('update', onEditorUpdate);
        },
        ignoreMutation() { return true; },
        // Tell ProseMirror to stay out of the way for events that hit our
        // interactive children. Without this, PM treats clicks/keys/drags on
        // the atom block as "select the node" and swallows them, breaking
        // contenteditable spans, buttons, inputs, and our custom drag handlers.
        stopEvent(event: Event) {
          const target = event.target as HTMLElement | null;
          if (!target) return false;
          if (target.closest('[contenteditable="true"], button, input, select, textarea, [data-board-drag]')) {
            return true;
          }
          // Allow drag events on cards/columns (they carry their own drag handlers).
          if (event.type === 'dragstart' || event.type === 'dragover' || event.type === 'drop' || event.type === 'dragend' || event.type === 'dragleave') {
            return true;
          }
          return false;
        },
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const source = (node.attrs.source as string) || '';
          state.write(source);
          state.ensureNewLine();
          state.write('\n');
        },
      },
    };
  },
});

export default Board;
