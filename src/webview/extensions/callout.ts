import { Node, mergeAttributes } from '@tiptap/core';

export type CalloutType = 'note' | 'warning' | 'tip' | 'info';

const DEFAULT_EMOJIS: Record<CalloutType, string> = {
  note: '💡',
  warning: '⚠️',
  tip: '✅',
  info: 'ℹ️',
};

const CALLOUT_PATTERN = /^> \[!(NOTE|WARNING|TIP|INFO)\]\s*(.*)?$/i;

export interface CalloutAttrs {
  type: CalloutType;
  emoji: string;
}

export function parseCalloutLine(line: string): CalloutAttrs | null {
  const match = line.match(CALLOUT_PATTERN);
  if (!match) return null;
  const type = match[1].toLowerCase() as CalloutType;
  const emoji = match[2]?.trim() || DEFAULT_EMOJIS[type];
  return { type, emoji };
}

export function calloutToMarkdown(
  type: CalloutType,
  emoji: string,
  content: string
): string {
  return `> [!${type.toUpperCase()}] ${emoji}\n> ${content}\n`;
}

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',

  addAttributes() {
    return {
      type: { default: 'note' as CalloutType },
      emoji: { default: '💡' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-callout': '', class: 'callout' }, HTMLAttributes),
      ['span', { class: 'callout-emoji', contenteditable: 'false' }, node.attrs.emoji as string],
      ['div', { class: 'callout-content' }, 0],
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const content = node.textContent as string;
          state.write(calloutToMarkdown(node.attrs.type, node.attrs.emoji, content));
          state.ensureNewLine();
        },
      },
    };
  },
});

export default Callout;
