// Resolve image src paths for the VS Code webview. Shared by the TipTap editor
// (ResolvedImage) and the board renderers (which emit raw <img> DOM and so don't
// get TipTap's resolution). Lives in its own module to avoid board code importing
// the heavy editor entry point.

let _mediaBaseUri = '';

export function setMediaBaseUri(uri: string): void {
  _mediaBaseUri = uri || '';
}

// Resolve a relative image src against the document's directory so the webview
// can load it. Absolute URLs, data: URIs and protocol-relative URLs pass through.
export function resolveImageSrc(src: string): string {
  if (!src || !_mediaBaseUri) return src;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return src;
  try {
    return new URL(src, _mediaBaseUri).href;
  } catch {
    return src;
  }
}

// Reverse of resolveImageSrc: turn a resolved webview-resource URL back into the
// document-relative path. Used when exporting so the standalone HTML/PDF carries
// portable relative paths (which the extension then inlines as data: URIs)
// instead of webview URIs that only resolve inside VS Code. Anything that isn't
// under the media base (remote URLs, data: URIs) passes through unchanged.
export function unresolveImageSrc(src: string): string {
  if (!src || !_mediaBaseUri) return src;
  if (src.startsWith(_mediaBaseUri)) {
    const rel = src.slice(_mediaBaseUri.length);
    try {
      return decodeURI(rel);
    } catch {
      return rel;
    }
  }
  // Images outside the document's folder (e.g. ../images/x.png) resolve to a URL
  // that is not under the base, so rebuild the relative path with ../ segments.
  try {
    const base = new URL(_mediaBaseUri);
    const url = new URL(src);
    if (url.origin !== base.origin) return src;
    const baseDirs = base.pathname.split('/').filter(Boolean);
    const target = url.pathname.split('/').filter(Boolean);
    let i = 0;
    while (i < baseDirs.length && i < target.length - 1 && baseDirs[i] === target[i]) i += 1;
    const rel = [...Array(baseDirs.length - i).fill('..'), ...target.slice(i)].join('/');
    return decodeURI(rel);
  } catch {
    return src;
  }
}
