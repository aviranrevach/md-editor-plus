import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { PLACEHOLDER_TEXT } from './emptyPlaceholder';

// c51: clicking the empty area below the last block should add a new block and
// put the cursor in it; hovering that area should preview a ghost "Start
// writing…" hint so the area reads as clickable WITHOUT a click first. Without
// this, the bottom of a doc that ends in a non-text block (board, code block,
// image, table) feels dead — there's nowhere for the caret to land.

export type BelowClickAction =
  | { kind: 'none' } // do nothing — let ProseMirror handle the click normally
  | { kind: 'focus-empty-last' } // the doc already ends in an empty paragraph: just land there
  | { kind: 'append-paragraph' }; // append a fresh empty paragraph and land in it

// Pure decision: given a click, decide whether (and how) to add/focus a trailing
// block. Kept free of DOM/view objects so it can be unit-tested directly.
export function decideBelowClickAction(args: {
  editable: boolean;
  button: number; // MouseEvent.button — only a plain left click (0) counts
  belowContent: boolean; // is the click below the bottom of the last rendered block?
  lastIsEmptyParagraph: boolean; // does the doc already end in an empty paragraph?
}): BelowClickAction {
  if (!args.editable) return { kind: 'none' }; // read-only docs stay read-only (c44/c45/c47)
  if (args.button !== 0) return { kind: 'none' };
  if (!args.belowContent) return { kind: 'none' };
  if (args.lastIsEmptyParagraph) return { kind: 'focus-empty-last' };
  return { kind: 'append-paragraph' };
}

// Pure decision: should the ghost hint show while hovering the area below the
// last block? Suppressed in read-only, and when the doc already ends in an empty
// paragraph (that blank line is the affordance — a second ghost would double up,
// cf. c50's stacked empty states).
export function shouldShowBelowHint(args: {
  editable: boolean;
  belowContent: boolean;
  lastIsEmptyParagraph: boolean;
}): boolean {
  return args.editable && args.belowContent && !args.lastIsEmptyParagraph;
}

function lastIsEmptyParagraph(view: EditorView): boolean {
  const last = view.state.doc.lastChild;
  return !!last && last.type.name === 'paragraph' && last.content.size === 0;
}

// True when `clientY` sits below the bottom of the last top-level block. Measured
// off the block's own DOM node (via nodeDOM) rather than dom.lastElementChild so
// the ghost-hint widget — itself the last element child while shown — never
// throws off the measurement.
function belowLastBlock(view: EditorView, clientY: number): boolean {
  const { doc } = view.state;
  const last = doc.lastChild;
  if (!last) return false;
  const lastStart = doc.content.size - last.nodeSize;
  const dom = view.nodeDOM(lastStart) as HTMLElement | null;
  if (!dom || typeof dom.getBoundingClientRect !== 'function') return false;
  return clientY > dom.getBoundingClientRect().bottom;
}

const hintKey = new PluginKey<boolean>('clickBelowContentHint');

function buildHintWidget(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pm-below-hint';
  el.textContent = PLACEHOLDER_TEXT;
  el.setAttribute('contenteditable', 'false');
  return el;
}

const ClickBelowContent = Extension.create({
  name: 'clickBelowContent',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<boolean>({
        key: hintKey,
        state: {
          init: () => false,
          apply(tr, value) {
            const meta = tr.getMeta(hintKey);
            return typeof meta === 'boolean' ? meta : value;
          },
        },
        props: {
          decorations(state) {
            if (!hintKey.getState(state)) return DecorationSet.empty;
            // Re-check structure against the live doc so a stale "hovering" flag
            // can't render a hint once the doc already ends in an empty paragraph.
            if (!editor.isEditable) return DecorationSet.empty;
            const last = state.doc.lastChild;
            if (last && last.type.name === 'paragraph' && last.content.size === 0) {
              return DecorationSet.empty;
            }
            const end = state.doc.content.size;
            return DecorationSet.create(state.doc, [
              Decoration.widget(end, buildHintWidget, { side: 1, key: 'pm-below-hint' }),
            ]);
          },
          handleDOMEvents: {
            mousemove(view, event) {
              const desired = shouldShowBelowHint({
                editable: view.editable,
                belowContent: belowLastBlock(view, event.clientY),
                lastIsEmptyParagraph: lastIsEmptyParagraph(view),
              });
              if (desired !== (hintKey.getState(view.state) ?? false)) {
                view.dispatch(view.state.tr.setMeta(hintKey, desired));
              }
              return false;
            },
            mouseleave(view) {
              if (hintKey.getState(view.state)) {
                view.dispatch(view.state.tr.setMeta(hintKey, false));
              }
              return false;
            },
            mousedown(view, event) {
              const action = decideBelowClickAction({
                editable: view.editable,
                button: event.button,
                belowContent: belowLastBlock(view, event.clientY),
                lastIsEmptyParagraph: lastIsEmptyParagraph(view),
              });
              if (action.kind === 'none') return false;

              event.preventDefault();
              const { state } = view;
              const endPos = state.doc.content.size;

              if (action.kind === 'focus-empty-last') {
                // Caret sits just inside the trailing empty paragraph (endPos - 1).
                const sel = TextSelection.create(state.doc, endPos - 1);
                view.dispatch(state.tr.setSelection(sel).scrollIntoView());
              } else {
                const para = state.schema.nodes.paragraph.create();
                const tr = state.tr.insert(endPos, para);
                // The new paragraph opens at endPos; its inner caret pos is endPos + 1.
                const sel = TextSelection.create(tr.doc, endPos + 1);
                view.dispatch(tr.setSelection(sel).scrollIntoView());
              }

              view.focus();
              return true;
            },
          },
        },
      }),
    ];
  },
});

export default ClickBelowContent;
