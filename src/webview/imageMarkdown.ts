// Pure helpers for serializing the image node to markdown and normalizing the
// width attribute. No DOM / no editor imports, so this is unit-testable.

export interface ImageNodeAttrs {
  src?: string | null;
  alt?: string | null;
  title?: string | null;
  width?: number | string | null;
}

// Parse a width value (number or numeric string like "420" / "420px") to a
// positive integer, or null when absent / non-positive / non-numeric.
export function normalizeWidth(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

// Clamp a (possibly fractional, from a drag) width into [min, max], rounded.
export function clampWidth(raw: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.round(Math.min(hi, Math.max(lo, raw)));
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// width set  -> portable HTML <img …> (carries width; round-trips on GitHub/Obsidian)
// no width   -> clean ![alt](src), mirroring prosemirror-markdown's default image
export function imageNodeToMarkdown(attrs: ImageNodeAttrs): string {
  const src = typeof attrs.src === 'string' ? attrs.src : '';
  const alt = typeof attrs.alt === 'string' ? attrs.alt : '';
  const width = normalizeWidth(attrs.width ?? null);
  if (width != null) {
    const parts = [`<img src="${escapeAttr(src)}"`];
    if (alt) parts.push(`alt="${escapeAttr(alt)}"`);
    parts.push(`width="${width}"`);
    return `${parts.join(' ')} />`;
  }
  // Mirror prosemirror-markdown's default image serializer: escape parens in src.
  const escSrc = src.replace(/[()]/g, '\\$&');
  const title =
    typeof attrs.title === 'string' && attrs.title
      ? ` "${attrs.title.replace(/"/g, '\\"')}"`
      : '';
  return `![${alt}](${escSrc}${title})`;
}
