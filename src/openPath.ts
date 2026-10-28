import * as path from 'path';

/** Markdown extensions the editor handles (lower-case, with leading dot). */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mdx'];

/** True when the path ends in a known markdown extension (case-insensitive). */
export function isMarkdownPath(p: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(path.extname(p).toLowerCase());
}

/**
 * Turn a raw clipboard path into an ordered list of absolute candidate paths to
 * try (first match wins). An absolute path yields a single candidate. A relative
 * path yields [docFolder/<rel>, workspaceRoot/<rel>] so the document's own folder
 * wins. A leading file:// scheme is stripped. Blank input yields [].
 */
export function resolveClipboardCandidates(
  raw: string,
  docFolderPath: string,
  workspaceFolderPath?: string,
): string[] {
  let s = raw.trim();
  if (!s) return [];
  if (s.startsWith('file://')) {
    try {
      s = decodeURIComponent(new URL(s).pathname);
    } catch {
      s = s.replace(/^file:\/\//, '');
    }
  }
  if (path.isAbsolute(s)) return [path.normalize(s)];
  const candidates = [path.resolve(docFolderPath, s)];
  if (workspaceFolderPath) {
    const wsCandidate = path.resolve(workspaceFolderPath, s);
    if (wsCandidate !== candidates[0]) candidates.push(wsCandidate);
  }
  return candidates;
}

/**
 * Split a link href into a local file path (fragment/query stripped, percent
 * decoding applied) or null when it points elsewhere (http, mailto, #anchor...).
 */
export function localPathFromHref(href: string): string | null {
  const h = href.trim();
  if (!h || h.startsWith('#')) return null;
  if (h.startsWith('file://')) return resolveClipboardCandidates(h.replace(/[#?].*$/, ''), '')[0] ?? null;
  // Any other scheme (http:, mailto:, ...) is not a local path; a Windows drive letter is.
  if (/^[a-z][a-z0-9+.-]+:/i.test(h)) return null;
  const bare = h.replace(/[#?].*$/, '');
  if (!bare) return null;
  try {
    return decodeURIComponent(bare);
  } catch {
    return bare;
  }
}
