import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_RE = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

function detectDir(text: string): 'rtl' | 'ltr' | null {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (RTL_RE.test(c)) return 'rtl';
    if (LTR_RE.test(c)) return 'ltr';
  }
  return null;
}

const PER_BLOCK_TYPES = new Set<string>([
  'paragraph',
  'heading',
  'blockquote',
  'callout',
  'toggle',
  'tableCell',
  'tableHeader',
]);

const LIST_TYPES = new Set<string>([
  'bulletList',
  'orderedList',
  'taskList',
]);

function buildDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (LIST_TYPES.has(node.type.name)) {
      // For lists, detect direction from the first item's text only — so the
      // whole list's marker side and alignment follow the "title" item, even
      // when later items are in the opposite language.
      const firstItemText = node.firstChild?.textContent ?? '';
      const dir = detectDir(firstItemText);
      if (dir) {
        decos.push(Decoration.node(pos, pos + node.nodeSize, { dir }));
      }
      // Don't recurse into list items — they should inherit list direction.
      return false;
    }
    if (PER_BLOCK_TYPES.has(node.type.name)) {
      const dir = detectDir(node.textContent);
      if (dir) {
        decos.push(Decoration.node(pos, pos + node.nodeSize, { dir }));
      }
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

const blockDirectionKey = new PluginKey<DecorationSet>('blockDirection');

export const BlockDirection = Extension.create({
  name: 'blockDirection',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: blockDirectionKey,
        state: {
          init: (_, state) => buildDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return blockDirectionKey.getState(state);
          },
        },
      }),
    ];
  },
});

export default BlockDirection;
