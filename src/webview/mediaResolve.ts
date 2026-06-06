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
