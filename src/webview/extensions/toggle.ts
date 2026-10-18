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
    return [
      {
        tag: 'details',
        // The <summary> is captured as the `summary` attribute, so exclude it
        // from the parsed body. Without this, ProseMirror folds the summary
        // text into the toggle's content and it re-accumulates on every save
        // (the "ToggleToggleToggle…" corruption). Clone so the attribute
        // parser above still sees the original <summary>.
        contentElement: (dom) => {
          const clone = (dom as HTMLElement).cloneNode(true) as HTMLElement;
          clone.querySelector(':scope > summary')?.remove();
          return clone;
        },
      },
    ];
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
        ignoreMutation(mutation) {
          const mut = mutation as { type: string; attributeName?: string; target: unknown };
          if (mut.type === 'attributes' && mut.attributeName === 'open') {
            return true;
          }
          if (summary.contains(mut.target as globalThis.Node)) return true;
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
          // Emit a blank line after the block (same as callout). Without it,
          // markdown-it glues a following `---` into the toggle's HTML block,
          // where it gets backslash-escaped and doubles on every save.
          state.write('\n');
        },
      },
    };
  },
});

export default Toggle;
