import type { Editor } from '@tiptap/core';
import { getMatches } from './searchExtension';
import {
  scanBoards,
  applyBoardHighlights,
  clearBoardHighlights,
  scrollBoardMatchIntoView,
  boardSearchSupported,
  type BoardMatch,
} from './boardSearch';

// Drives find across two highlight engines that live in the same editor:
//   • ProseMirror decorations for regular document text (incl. toggles), and
//   • CSS Custom Highlight ranges for board card text.
// It merges both into ONE list ordered top-to-bottom by on-screen position, so
// the find bar shows a single "N / total" count and Enter/Shift+Enter walk
// through every match in visual order regardless of which engine owns it.

export interface SearchSummary {
  total: number;
  /** 1-based index of the active match, or 0 when there are none. */
  active: number;
}

type Handle =
  | { kind: 'pm'; index: number; top: number; left: number }
  | { kind: 'board'; index: number; top: number; left: number };

export class SearchCoordinator {
  private handles: Handle[] = [];
  private boardMatches: BoardMatch[] = [];
  private active = -1;
  private query = '';

  /** Run a fresh search on `editor` and activate the first match. */
  setQuery(editor: Editor, query: string): void {
    this.query = query;
    this.recompute(editor, true);
  }

  /**
   * Re-run the current query against the (possibly rebuilt) DOM, KEEPING the
   * user's current match position. Board card highlights are CSS Custom
   * Highlight ranges anchored to live text nodes; when a board re-renders (an
   * external sync echo, a cell edit, autofit, …) it replaces those text nodes,
   * which silently collapses the ranges to empty — the highlight registry still
   * reports them but nothing paints. Re-scanning rebuilds the ranges against the
   * fresh nodes so the highlight survives the re-render. No-op without a query.
   */
  refresh(editor: Editor): void {
    if (!this.query) return;
    this.recompute(editor, false);
  }

  // Recompute matches from scratch and re-render. `resetActive` starts at the
  // first match (a brand-new search); otherwise the current position is kept,
  // clamped to the new match count (a re-scan after a DOM rebuild).
  private recompute(editor: Editor, resetActive: boolean): void {
    // ProseMirror text matches (preview body, tables, toggles; or code view).
    editor.commands.setSearchTerm(this.query);
    const pmMatches = getMatches(editor.state);

    // Board card matches (preview only — code view has no boards).
    clearBoardHighlights();
    this.boardMatches =
      this.query && boardSearchSupported()
        ? scanBoards(editor.view.dom as HTMLElement, this.query)
        : [];

    // Merge into one list ordered by viewport position. PM and board rects are
    // captured in the same coordinate space, so relative order is stable.
    const handles: Handle[] = [];
    pmMatches.forEach((m, i) => {
      let top = 0;
      let left = 0;
      try {
        const c = editor.view.coordsAtPos(m.from);
        top = c.top;
        left = c.left;
      } catch {
        /* position not laid out (e.g. hidden) — sort to top, harmless */
      }
      handles.push({ kind: 'pm', index: i, top, left });
    });
    this.boardMatches.forEach((m, i) => {
      handles.push({ kind: 'board', index: i, top: m.rect.top, left: m.rect.left });
    });
    handles.sort((a, b) => a.top - b.top || a.left - b.left);

    this.handles = handles;
    if (resetActive || this.active < 0 || this.active >= handles.length) {
      this.active = handles.length ? 0 : -1;
    }
    this.render(editor);
  }

  next(editor: Editor): void {
    if (!this.handles.length) return;
    this.active = (this.active + 1) % this.handles.length;
    this.render(editor);
  }

  prev(editor: Editor): void {
    if (!this.handles.length) return;
    this.active = (this.active - 1 + this.handles.length) % this.handles.length;
    this.render(editor);
  }

  clear(editor: Editor | null): void {
    editor?.commands.clearSearch();
    clearBoardHighlights();
    this.handles = [];
    this.boardMatches = [];
    this.active = -1;
    this.query = '';
  }

  summary(): SearchSummary {
    return { total: this.handles.length, active: this.active >= 0 ? this.active + 1 : 0 };
  }

  // Reflect the current active handle into both engines: the active match gets
  // the focused highlight + scroll; everything else stays highlighted-inactive.
  private render(editor: Editor): void {
    const handle = this.active >= 0 ? this.handles[this.active] : null;

    const activeBoardIndex = handle?.kind === 'board' ? handle.index : -1;
    applyBoardHighlights(this.boardMatches, activeBoardIndex);

    if (handle?.kind === 'pm') {
      // Highlights the PM match as active AND scrolls/reveals it (opens toggles).
      editor.commands.setActiveMatch(handle.index);
    } else {
      editor.commands.setActiveMatch(null);
    }

    if (handle?.kind === 'board') {
      scrollBoardMatchIntoView(this.boardMatches[handle.index]);
    }
  }
}
