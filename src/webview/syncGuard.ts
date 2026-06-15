// Pure decision logic for the webview's inbound 'update' message handler.
//
// Background — a data-loss bug: an empty 'update' can reach the webview moments
// after a file opens (e.g. when a second document is opened, a race in the
// host's edit/change bookkeeping can deliver `document.getText() === ''`).
// Applying it ran `setContent('')`, silently wiping the editor — the content was
// only recoverable via undo, and a follow-up auto-save persisted the empty file.
//
// Keeping this as a small pure function lets it be unit-tested without the DOM.

export type UpdateDecision =
  | 'dedup'            // incoming is the echo of our own last-sent edit — ignore
  | 'restore-content'  // incoming would wipe a non-empty editor — re-assert ours
  | 'conflict'         // incoming differs from unsent local edits — ask the user
  | 'apply';           // safe to render incoming into the editor

export interface UpdateContext {
  /** Normalized incoming markdown from the host 'update' message. */
  incoming: string;
  /** Normalized markdown currently in the editor. */
  editorCurrent: string;
  /** Normalized markdown we last sent to the host, or null if none sent yet. */
  lastSent: string | null;
  /** True when the update came from an explicit user-initiated refresh. */
  isRefresh: boolean;
}

const isBlank = (s: string): boolean => s.trim() === '';

export function decideExternalUpdate(ctx: UpdateContext): UpdateDecision {
  const { incoming, editorCurrent, lastSent, isRefresh } = ctx;

  // 1. Echo of our own edit — re-running setContent would needlessly re-render
  //    (and flicker syntax colors), so skip it.
  if (lastSent !== null && incoming === lastSent) return 'dedup';

  // 2. DATA-LOSS GUARD. An empty incoming update that would replace a non-empty
  //    editor is never applied implicitly — that is the wipe this bug caused.
  //    Only an explicit user refresh may empty a populated editor. Otherwise we
  //    re-assert the editor's content so a spuriously-emptied host document /
  //    on-disk file is corrected too.
  if (isBlank(incoming) && !isBlank(editorCurrent) && !isRefresh) {
    return 'restore-content';
  }

  // 3. The incoming (non-empty) content differs from what we last sent AND the
  //    editor has unsent local edits — surface a conflict instead of clobbering.
  const localDirty = lastSent !== null && editorCurrent !== lastSent;
  if (localDirty && !isRefresh) return 'conflict';

  // 4. Safe to apply.
  return 'apply';
}
