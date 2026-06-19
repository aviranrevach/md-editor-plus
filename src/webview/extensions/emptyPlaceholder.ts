import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';

export const PLACEHOLDER_TEXT = 'Start writing, or press / for commands';

/** Only plain paragraphs and headings receive the empty-state hint (not code blocks, etc.). */
export function isPlaceholderBlockType(typeName: string): boolean {
  return typeName === 'paragraph' || typeName === 'heading';
}

export function shouldShowPlaceholder(flags: {
  isEmpty: boolean;
  isFocused: boolean;
  isFirstBlock: boolean;
  docIsEmpty: boolean;
}): boolean {
  return flags.isEmpty && (flags.isFocused || (flags.isFirstBlock && flags.docIsEmpty));
}

function buildDecorations(state: EditorState): DecorationSet {
  const { doc, selection } = state;
  const decos: Decoration[] = [];
  const docIsEmpty = doc.textContent === '';
  let topIndex = -1;
  doc.forEach((node, pos) => {
    topIndex++;
    // Only plain paragraphs and headings get the hint (not code blocks, etc.).
    if (!node.isTextblock) return;
    if (!isPlaceholderBlockType(node.type.name)) return;
    const isEmpty = node.content.size === 0;
    const isFocused = selection.empty && selection.$from.parent === node;
    const isFirstBlock = topIndex === 0;
    if (shouldShowPlaceholder({ isEmpty, isFocused, isFirstBlock, docIsEmpty })) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, {
        'data-placeholder': PLACEHOLDER_TEXT,
        class: 'is-empty-block',
      }));
    }
  });
  return DecorationSet.create(doc, decos);
}

const emptyPlaceholderKey = new PluginKey<DecorationSet>('emptyPlaceholder');

export const EmptyPlaceholder = Extension.create({
  name: 'emptyPlaceholder',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: emptyPlaceholderKey,
        props: {
          // Recompute every render: placeholder visibility depends on selection,
          // not just doc content.
          decorations(state) {
            return buildDecorations(state);
          },
        },
      }),
    ];
  },
});

export default EmptyPlaceholder;
