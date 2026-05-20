import { Node, mergeAttributes } from '@tiptap/core';

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
