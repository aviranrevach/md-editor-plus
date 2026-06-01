import { Node, mergeAttributes } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { createBoardView, BOARD_INTERACTIVE_SELECTOR } from '../boardBlock';

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
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          // Update lastSource locally so the update() callback doesn't re-render
          // on the same content we just produced.
          lastSource = nextSource;
          editor.commands.command(({ tr }) => {
            tr.setNodeAttribute(pos, 'source', nextSource);
            return true;
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
