import { Node, mergeAttributes } from '@tiptap/core';
import { createBoardView } from '../boardBlock';

const REGION_RE =
  /<!--\s*board:start[\s\S]*?<!--\s*board:end\s*-->/gi;

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  draggable: true,
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
