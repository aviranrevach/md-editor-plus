// Inline local <img> sources as data: URIs so an exported HTML/PDF file is
// fully self-contained and portable (images survive being emailed or moved).
//
// Pure and dependency-free: the caller supplies a reader that turns a
// document-relative path into raw bytes (the extension reads from disk via
// vscode.workspace.fs). Remote (http/https) and existing data: URIs are left
// untouched.

import { mimeForExtension } from './imageAssets';

/** Reads bytes for a document-relative image path, or null if unavailable. */
export type ImageBytesReader = (relPath: string) => Promise<Uint8Array | null>;

function extOf(relPath: string): string {
  const m = /\.([a-z0-9]{1,5})(?:[?#].*)?$/i.exec(relPath);
  return m ? m[1] : '';
}

function toBase64(bytes: Uint8Array): string {
  // Node Buffer is available in the extension host; fall back to btoa chunks
  // only if it isn't (keeps the function environment-agnostic for tests).
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  // eslint-disable-next-line no-undef
  return btoa(binary);
}

function isRemoteOrData(src: string): boolean {
  return /^(?:https?:|data:|\/\/)/i.test(src);
}

// Match a single <img …> tag; capture is the whole tag so we can rewrite its src.
const IMG_TAG = /<img\b[^>]*>/gi;
// Match the src attribute inside a tag (single or double quoted).
const SRC_ATTR = /\bsrc\s*=\s*(["'])(.*?)\1/i;

/**
 * Replace every local image src in `html` with a base64 data: URI.
 * Sources the reader can't resolve (missing file, read error) are left as-is.
 */
export async function inlineImagesAsDataUris(
  html: string,
  read: ImageBytesReader,
): Promise<string> {
  const tags = html.match(IMG_TAG);
  if (!tags) return html;

  // Resolve each distinct local src once, even if it appears in several tags.
  const uniqueSrcs = new Set<string>();
  for (const tag of tags) {
    const m = SRC_ATTR.exec(tag);
    const src = m?.[2]?.trim();
    if (src && !isRemoteOrData(src)) uniqueSrcs.add(src);
  }

  const dataUriBySrc = new Map<string, string>();
  await Promise.all(
    Array.from(uniqueSrcs).map(async (src) => {
      try {
        const bytes = await read(src);
        if (!bytes || bytes.length === 0) return;
        const mime = mimeForExtension(extOf(src));
        dataUriBySrc.set(src, `data:${mime};base64,${toBase64(bytes)}`);
      } catch {
        /* leave this image untouched */
      }
    }),
  );

  if (dataUriBySrc.size === 0) return html;

  return html.replace(IMG_TAG, (tag) =>
    tag.replace(SRC_ATTR, (attr, quote: string, src: string) => {
      const dataUri = dataUriBySrc.get(src.trim());
      return dataUri ? `src=${quote}${dataUri}${quote}` : attr;
    }),
  );
}
