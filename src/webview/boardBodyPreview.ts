// c9 — flatten a card's multi-line markdown body into inline-only text for the
// board previews (table Description column + kanban card preview).
//
// A description is edited in the side panel with the FULL block editor, so it
// can hold anything the main document can: headings, lists, task items, tables,
// fenced code, blockquotes, block HTML from a rich paste. The previews render it
// through `renderInlineMarkdown`, which understands inline markdown only — so
// every block construct used to be printed as literal syntax ("i pasted into
// description and got some code in the table view").
//
// This strips the block layer down to readable text while KEEPING the inline
// marks the previews do render (bold, italic, code, links, images, colors).
// Pure string work, no DOM — the caller still renders through
// `renderInlineMarkdown`, so nothing here can inject markup.

// Block-level HTML never survives as a tag in a one-line preview. `<br>` marks a
// break; the rest are unwrapped so their text shows without the tag around it.
const BLOCK_HTML_TAGS =
  'p|div|h[1-6]|ul|ol|li|pre|blockquote|table|thead|tbody|tfoot|tr|td|th|section|article|figure|figcaption|details|summary';

interface FlattenOptions {
  /** Stop once this many content lines are collected (kanban wants just one). */
  maxLines?: number;
}

/**
 * Split `body` into cleaned, inline-only lines. Empty and structure-only lines
 * (thematic breaks, table separator rows, fence delimiters) are dropped, so the
 * result contains only lines with something to show.
 */
export function flattenMarkdownLines(body: string, options?: FlattenOptions): string[] {
  if (!body) return [];

  // Comments (callout / toggle / board markers, and anything pasted) can span
  // lines — drop them before the line walk so they can't leak a stray `-->`.
  let text = body.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(new RegExp(`</?(?:${BLOCK_HTML_TAGS})\\b[^>]*>`, 'gi'), '\n');

  const lines: string[] = [];
  const max = options?.maxLines ?? Infinity;

  let fenceMarker: string | null = null;
  let fenced: string[] = [];

  // A fenced block becomes one inline-code run so its content still reads, but
  // the ``` delimiters never show. Collapsing the newlines also keeps the
  // inline-code matcher from slicing a fence into partial <code> fragments.
  const flushFence = (): void => {
    const code = fenced.join(' ').replace(/\s+/g, ' ').trim();
    fenced = [];
    if (code) lines.push(`\`${code}\``);
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const fence = /^(`{3,}|~{3,})/.exec(line);

    if (fenceMarker !== null) {
      if (fence && line.startsWith(fenceMarker)) {
        fenceMarker = null;
        flushFence();
      } else {
        fenced.push(line);
      }
    } else if (fence) {
      fenceMarker = fence[1];
    } else {
      const cleaned = stripBlockSyntax(line);
      if (cleaned) lines.push(cleaned);
    }

    if (lines.length >= max) return lines.slice(0, max);
  }

  // An unterminated fence still shows what it holds.
  if (fenceMarker !== null) flushFence();

  return lines.slice(0, max);
}

/**
 * Flatten `body` to a single preview string, joining content lines with ` • `.
 * `maxLength` truncates the result (the table column's old behaviour).
 */
export function flattenMarkdownToInline(body: string, maxLength?: number): string {
  const joined = flattenMarkdownLines(body).join(' • ');
  return maxLength === undefined ? joined : joined.slice(0, maxLength);
}

// Strip one line's leading block markers. Returns '' when the line is pure
// structure (thematic break, table separator) and has nothing to show.
function stripBlockSyntax(line: string): string {
  if (!line) return '';
  // Thematic break — ***, ---, ___ (also catches a stray frontmatter fence).
  if (/^(?:[*_-][ \t]*){3,}$/.test(line)) return '';
  // Table alignment row — |---|:--:|
  if (/^\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?$/.test(line)) return '';

  let s = line;
  s = s.replace(/^(?:>[ \t]*)+/, '');            // blockquote, possibly nested
  s = s.replace(/^#{1,6}[ \t]+/, '');            // ATX heading
  s = s.replace(/[ \t]+#+[ \t]*$/, '');          // …and its optional closing #s
  s = s.replace(/^(?:[-*+][ \t]+|\d{1,9}[.)][ \t]+)/, ''); // list / ordered marker
  s = s.replace(/^\[[ xX]\][ \t]+/, '');         // task checkbox, after its bullet

  // Table content row — show the cells, not the pipes.
  if (/^\|.*\|$/.test(s)) {
    s = s
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(' • ');
  }

  return s.trim();
}
