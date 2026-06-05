import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { findMatches } from './search';

// In-document find for the preview and source editors. Searches the document
// MODEL (not the rendered DOM), so it sees text inside collapsed toggles — the
// nodes are there, just visually hidden. Matches are painted with ProseMirror
// decorations, which never touch the document content, so highlighting can
// never dirty the markdown or trigger a save.
//
// Board nodes are atoms whose card text lives in an opaque `source` attribute,
// so they are invisible to this text walk. That's the deliberate v1 scope cut —
// a board-aware path can slot in later without changing this engine.

export interface SearchMatch {
  from: number;
  to: number;
}

interface SearchState {
  query: string;
  caseSensitive: boolean;
  matches: SearchMatch[];
  /** 0-based index into `matches`, or -1 when there are none. */
  active: number;
  decorations: DecorationSet;
}

export const searchPluginKey = new PluginKey<SearchState>('mdEditorSearch');

interface SetMeta {
  query?: string;
  caseSensitive?: boolean;
  active?: number;
}

// Walk the doc and find matches, returning ProseMirror {from,to} ranges.
//
// We build one combined string from all text nodes so a match can span across
// mark boundaries within a block (e.g. "hel<b>lo</b>" matches "hello"). Text
// nodes that abut in document positions are concatenated directly; a gap
// between them (a block boundary) inserts a "\n" separator. Because the find
// bar is single-line, a user query never contains "\n", so no match can ever
// straddle a block boundary — which keeps the offset→position mapping exact.
function computeMatches(doc: PMNode, query: string, caseSensitive: boolean): SearchMatch[] {
  if (!query) return [];

  let combined = '';
  // Maps each character offset in `combined` back to its absolute doc position.
  const offsetToPos: number[] = [];
  let prevEnd = -1;

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    if (prevEnd !== -1 && pos !== prevEnd) {
      // Block boundary — insert a separator that no single-line query matches.
      combined += '\n';
      offsetToPos.push(-1);
    }
    for (let i = 0; i < text.length; i++) {
      offsetToPos.push(pos + i);
    }
    combined += text;
    prevEnd = pos + node.nodeSize;
    return true;
  });

  return findMatches(combined, query, { caseSensitive }).map(({ start, end }) => ({
    from: offsetToPos[start],
    // `end` is exclusive; the position just past the last char is the last
    // matched char's position + 1.
    to: offsetToPos[end - 1] + 1,
  }));
}

function buildDecorations(doc: PMNode, matches: SearchMatch[], active: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === active ? 'search-match search-match-active' : 'search-match',
    }),
  );
  return DecorationSet.create(doc, decos);
}

// If the active match sits inside one or more collapsed <details> (toggles),
// open them, then scroll the match into view. Layout shifts when a toggle
// opens, so scrolling happens after the open() calls.
function revealAndScroll(view: EditorView, match: SearchMatch): void {
  let domInfo: { node: Node } | null = null;
  try {
    domInfo = view.domAtPos(match.from);
  } catch {
    return;
  }
  if (!domInfo) return;

  let el: HTMLElement | null =
    domInfo.node.nodeType === Node.TEXT_NODE
      ? domInfo.node.parentElement
      : (domInfo.node as HTMLElement);
  if (!el) return;

  // Walk up and open every collapsed <details> ancestor.
  let cursor: HTMLElement | null = el;
  while (cursor) {
    if (cursor instanceof HTMLDetailsElement && !cursor.open) {
      cursor.open = true;
    }
    cursor = cursor.parentElement;
  }

  el.scrollIntoView({ block: 'center', inline: 'nearest' });
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mdSearch: {
      setSearchTerm: (query: string, caseSensitive?: boolean) => ReturnType;
      /**
       * Highlight one match as the active (focused) one and scroll it into
       * view, opening any collapsed toggle around it. `null` clears the active
       * highlight (all matches stay highlighted as inactive) — used when the
       * active match lives outside this editor, e.g. inside a board.
       */
      setActiveMatch: (index: number | null) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

export const SearchExtension = Extension.create({
  name: 'mdSearch',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
          init(): SearchState {
            return {
              query: '',
              caseSensitive: false,
              matches: [],
              active: -1,
              decorations: DecorationSet.empty,
            };
          },
          apply(tr, prev): SearchState {
            const meta = tr.getMeta(searchPluginKey) as SetMeta | undefined;

            // A search term / active-index change: recompute from scratch.
            if (meta && (meta.query !== undefined || meta.caseSensitive !== undefined)) {
              const query = meta.query ?? prev.query;
              const caseSensitive = meta.caseSensitive ?? prev.caseSensitive;
              const matches = computeMatches(tr.doc, query, caseSensitive);
              // Active index is driven externally by the coordinator; default to
              // none. Clamp to the available matches.
              const requested = meta.active ?? -1;
              const active = matches.length === 0 || requested < 0 ? -1 : Math.min(requested, matches.length - 1);
              return {
                query,
                caseSensitive,
                matches,
                active,
                decorations: buildDecorations(tr.doc, matches, active),
              };
            }

            // An active-index move (next / prev).
            if (meta && meta.active !== undefined) {
              const active = prev.matches.length === 0 ? -1 : meta.active;
              return {
                ...prev,
                active,
                decorations: buildDecorations(tr.doc, prev.matches, active),
              };
            }

            // The document changed while a search is open — recompute against
            // the new doc so ranges stay valid.
            if (tr.docChanged && prev.query) {
              const matches = computeMatches(tr.doc, prev.query, prev.caseSensitive);
              const active = matches.length === 0 ? -1 : Math.min(prev.active < 0 ? 0 : prev.active, matches.length - 1);
              return {
                ...prev,
                matches,
                active,
                decorations: buildDecorations(tr.doc, matches, active),
              };
            }

            // No relevant change — keep decorations mapped through the tr.
            if (tr.docChanged) {
              return { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return searchPluginKey.getState(state)?.decorations ?? null;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      // Compute and highlight all matches, but do NOT pick an active one — the
      // coordinator decides which match is active across all editors/boards.
      setSearchTerm:
        (query: string, caseSensitive?: boolean) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            dispatch(tr.setMeta(searchPluginKey, { query, caseSensitive: caseSensitive ?? false, active: -1 }));
          }
          return true;
        },

      setActiveMatch:
        (index: number | null) =>
        ({ tr, dispatch, state, view }) => {
          const s = searchPluginKey.getState(state);
          if (!s) return false;
          const active = index == null ? -1 : index;
          if (dispatch) {
            dispatch(tr.setMeta(searchPluginKey, { active }));
            if (active >= 0 && active < s.matches.length) {
              revealAndScroll(view, s.matches[active]);
            }
          }
          return true;
        },

      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchPluginKey, { query: '', caseSensitive: false, active: -1 }));
          return true;
        },
    };
  },
});

export default SearchExtension;

// Read the current match ranges off an editor's plugin state. The coordinator
// uses these (plus coordsAtPos) to order matches against board matches.
export function getMatches(state: EditorState): SearchMatch[] {
  return searchPluginKey.getState(state)?.matches ?? [];
}
