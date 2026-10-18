// Last line of defense against the save/sync data-loss family (c8, c26, c28,
// c30, c37, c48). Every webview edit/save flows through the host's _applyEdit,
// which replaces the WHOLE document. Historically that overwrite was blind: it
// only *logged* the catastrophic cases (an empty buffer, or — c37 — the whole
// board replaced by a single card's body via the editor-singleton hijack) and
// then wrote them to disk anyway, wiping the file while the UI still showed
// "Saved".
//
// This guard turns those log-only tripwires into an actual refusal. It flags
// ONLY writes that are never the result of a legitimate edit, so it can refuse
// them without prompting and with no false positives on normal editing:
//
//   - empty-over-content   — real content replaced by nothing / whitespace
//   - board-block-vanished — the `board:start … board:end` markers disappear
//                            (a normal edit never removes them; their loss is
//                            the c37 signature)
//
// Deliberately NOT flagged: ordinary shrinks, row deletions, or converting a
// board's rows — those are real edits, and VS Code local history covers
// recovery. We refuse only the unambiguous wipe.

export interface WriteAssessment {
  verdict: 'ok' | 'wipe';
  reason?: 'empty-over-content' | 'board-block-vanished';
}

const BOARD_START_RE = /<!--\s*board:start/;

function hasRealContent(text: string): boolean {
  return text.trim() !== '';
}

function hasBoard(text: string): boolean {
  return BOARD_START_RE.test(text);
}

/**
 * Decide whether replacing `prev` with `next` is a catastrophic, never-legitimate
 * write that should be refused rather than written to disk.
 */
export function assessWrite(prev: string, next: string): WriteAssessment {
  // Replacing existing content with an empty / whitespace-only buffer is the
  // 0-byte wipe (c37). Writing into a doc that was already empty is fine.
  if (hasRealContent(prev) && !hasRealContent(next)) {
    return { verdict: 'wipe', reason: 'empty-over-content' };
  }

  // The board block disappearing is the c37 fragment signature: the file had a
  // board, the replacement doesn't. A normal edit keeps the board markers.
  if (hasBoard(prev) && !hasBoard(next)) {
    return { verdict: 'wipe', reason: 'board-block-vanished' };
  }

  return { verdict: 'ok' };
}
