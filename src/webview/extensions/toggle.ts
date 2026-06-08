import { Node, mergeAttributes } from '@tiptap/core';

const DETAILS_PATTERN = /^<details(\s[^>]*)?>/i;

export function toggleToMarkdown(summary: string, content: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${content}\n\n</details>\n`;
}

export function parseToggleSummary(line: string): boolean {
  return DETAILS_PATTERN.test(line.trim());
}

const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',

  addAttributes() {
    return {
      summary: {
        default: 'Toggle',
        parseHTML: (el: HTMLElement) => {
          const s = el.querySelector(':scope > summary');
          const text = s?.textContent?.trim();
          return text || 'Toggle';
        },
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'details' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'details',
      mergeAttributes(HTMLAttributes, { dir: 'auto' }),
      ['summary', { contenteditable: 'false', dir: 'auto' }, node.attrs.summary as string],
      ['div', { class: 'toggle-content', dir: 'auto' }, 0],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('details');
      dom.setAttribute('dir', 'auto');
      const summary = document.createElement('summary');
      summary.contentEditable = 'false';
      summary.setAttribute('dir', 'auto');
      summary.textContent = (node.attrs.summary as string) || 'Toggle';
      const content = document.createElement('div');
      content.className = 'toggle-content';
      content.setAttribute('dir', 'auto');
      dom.appendChild(summary);
      dom.appendChild(content);

      return {
        dom,
        contentDOM: content,
        ignoreMutation(mutation: { type: string; attributeName?: string | null; target?: globalThis.Node }) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'open') {
            return true;
          }
          if (mutation.target && summary.contains(mutation.target)) return true;
          return false;
        },
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          const next = (updatedNode.attrs.summary as string) || 'Toggle';
          if (next !== summary.textContent) summary.textContent = next;
          return true;
        },
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const content = node.textContent as string;
          state.write(toggleToMarkdown(node.attrs.summary, content));
          state.ensureNewLine();
        },
      },
    };
  },
});

export default Toggle;
