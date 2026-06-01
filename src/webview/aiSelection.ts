// Pure helpers for deriving prompt context from a selection. No DOM/editor imports.

export interface SelectionSummary {
  lines: number;
  words: number;
}

export function summarizeSelection(text: string): SelectionSummary {
  const lines = text.split('\n').filter(l => l.trim().length > 0).length;
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { lines, words };
}

export function formatSummary(s: SelectionSummary): string {
  const lineWord = s.lines === 1 ? 'line' : 'lines';
  const wordWord = s.words === 1 ? 'word' : 'words';
  return `Converting ${s.lines} ${lineWord} · ~${s.words} ${wordWord}`;
}

export function locateAnchors(
  md: string,
  startText: string,
  endText: string,
): { startLine: number | null; endLine: number | null } {
  const lines = md.split('\n');
  const find = (needle: string): number | null => {
    if (!needle) return null;
    // substring match (not equality): the anchor is a line's text content, which may be prefixed in source by markdown markup like '- ' or '#'.
    const idx = lines.findIndex(l => l.includes(needle));
    return idx === -1 ? null : idx + 1;
  };
  return { startLine: find(startText), endLine: find(endText) };
}

/**
 * Collapses whitespace and truncates for display.
 * When truncated, the result is at most `max + 1` chars (the … ellipsis is added on top of `max`).
 */
export function truncateAnchor(text: string, max = 80): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : collapsed.slice(0, max) + '…';
}
