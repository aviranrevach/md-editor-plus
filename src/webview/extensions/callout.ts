import { Node, mergeAttributes } from '@tiptap/core';

export type CalloutType = 'note' | 'tip' | 'important' | 'warning' | 'caution' | 'info';

const DEFAULT_EMOJIS: Record<CalloutType, string> = {
  note: '💡',
  tip: '✅',
  important: '📌',
  warning: '⚠️',
  caution: '🛑',
  info: 'ℹ️',
};

const CALLOUT_TYPES = 'NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO';
const CALLOUT_LINE_RE = new RegExp(`^> \\[!(${CALLOUT_TYPES})\\]\\s*(.*)?$`, 'i');
const BLOCK_LINE_RE = /^> ?(.*)$/;

export interface CalloutAttrs {
  type: CalloutType;
  emoji: string;
}

export function parseCalloutLine(line: string): CalloutAttrs | null {
  const match = line.match(CALLOUT_LINE_RE);
  if (!match) return null;
  const type = match[1].toLowerCase() as CalloutType;
  const emoji = match[2]?.trim() || DEFAULT_EMOJIS[type];
  return { type, emoji };
}

export function calloutToMarkdown(
  type: CalloutType,
  emoji: string,
  content: string,
): string {
  const body = content
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  return `> [!${type.toUpperCase()}] ${emoji}\n${body}\n`;
}

// Convert inline markdown (bold/italic/code/strikethrough/links) to HTML so
// ProseMirror's parser picks up the formatting when the callout div is parsed.
function inlineMarkdownToHtml(src: string): string {
  let out = src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_m, text: string, url: string) => `<a href="${url}">${text}</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(?<!_)__([^_]+)__(?!_)/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  out = out.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
  out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return out;
}

// Pre-process raw markdown so GFM-style callouts (`> [!NOTE]\n> body…`) become
// `<div data-callout data-type="…">…</div>` HTML blocks. tiptap-markdown's HTML
// passthrough then hands them straight to the Callout node's parseHTML rule.
export function preprocessMarkdownCallouts(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const head = parseCalloutLine(lines[i]);
    if (!head) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      // Stop if this line begins a NEW callout — covers files where adjacent
      // callouts weren't separated by a blank line (the markdown serializer
      // didn't always emit one).
      if (parseCalloutLine(lines[j])) break;
      const m = lines[j].match(BLOCK_LINE_RE);
      if (!m) break;
      body.push(m[1]);
      j++;
    }
    const html = inlineMarkdownToHtml(body.join(' ').trim());
    out.push(
      `<div data-callout data-type="${head.type}" data-emoji="${head.emoji}">${html}</div>`,
      '',
    );
    i = j;
  }
  return out.join('\n');
}

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',

  addAttributes() {
    return {
      type: {
        default: 'note' as CalloutType,
        parseHTML: (element) =>
          (element.getAttribute('data-type') as CalloutType | null) ?? 'note',
        renderHTML: (attrs) => ({ 'data-type': attrs.type }),
      },
      emoji: {
        default: '💡',
        parseHTML: (element) => {
          const explicit = element.getAttribute('data-emoji');
          if (explicit) return explicit;
          const type = (element.getAttribute('data-type') as CalloutType) ?? 'note';
          return DEFAULT_EMOJIS[type];
        },
        renderHTML: (attrs) => ({ 'data-emoji': attrs.emoji }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-callout': '', class: 'callout', dir: 'auto' },
        HTMLAttributes,
      ),
      ['span', { class: 'callout-emoji', contenteditable: 'false' }, node.attrs.emoji as string],
      ['div', { class: 'callout-content', dir: 'auto' }, 0],
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const content = node.textContent as string;
          state.write(calloutToMarkdown(node.attrs.type, node.attrs.emoji, content));
          state.ensureNewLine();
          state.write('\n');
        },
      },
    };
  },
});

export default Callout;
