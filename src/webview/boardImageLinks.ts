// Pure helpers for image markdown links inside board cell values and card bodies.
// A cell can hold several images as space-separated `![alt](src)` links.

export interface ImageLink { alt: string; src: string; }

const IMAGE_LINK_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

export function parseImageLinks(value: string): ImageLink[] {
  const out: ImageLink[] = [];
  if (!value) return out;
  IMAGE_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMAGE_LINK_RE.exec(value)) !== null) {
    out.push({ alt: m[1], src: m[2].trim() });
  }
  return out;
}

export function firstImageSrc(value: string): string | null {
  const links = parseImageLinks(value);
  return links.length ? links[0].src : null;
}

export function appendImageLink(value: string, src: string): string {
  const link = `![](${src})`;
  return value && value.trim().length ? `${value} ${link}` : link;
}
