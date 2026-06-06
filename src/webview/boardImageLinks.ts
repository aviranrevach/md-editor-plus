// Pure helpers for image markdown links inside board cell values and card bodies.
// A cell can hold several images as space-separated `![alt](src)` links.

export interface ImageLink { alt: string; src: string; }

// The src matcher allows one level of balanced parens so paths like
// `./a_(1).png` parse fully instead of truncating at the first `)`.
const IMAGE_LINK_RE = /!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g;

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

// Remove the image link at `index` (0-based, order from parseImageLinks),
// returning the rebuilt space-joined value. Out-of-range index returns input unchanged.
export function removeImageLinkAt(value: string, index: number): string {
  const links = parseImageLinks(value);
  if (index < 0 || index >= links.length) return value;
  links.splice(index, 1);
  return links.map((l) => `![${l.alt}](${l.src})`).join(' ');
}

// Replace the src of the image link at `index` (keeping its alt), returning the
// rebuilt space-joined value. Out-of-range index returns input unchanged.
export function replaceImageLinkAt(value: string, index: number, newSrc: string): string {
  const links = parseImageLinks(value);
  if (index < 0 || index >= links.length) return value;
  links[index] = { alt: links[index].alt, src: newSrc };
  return links.map((l) => `![${l.alt}](${l.src})`).join(' ');
}
