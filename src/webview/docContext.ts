// Small shared state for webview modules that need the current document's
// path or want to copy text via the extension host. Kept separate from
// index.ts/editor.ts to avoid an import cycle with bubbleMenu.ts.

let _documentPath = '';
let _workspaceName: string | null = null;

export function setDocumentPath(p: string): void {
  _documentPath = p || '';
}

export function getDocumentPath(): string {
  return _documentPath;
}

/** The open workspace folder's name, or null when no folder is open. */
export function setWorkspaceName(name: string | null): void {
  _workspaceName = name || null;
}

export function getWorkspaceName(): string | null {
  return _workspaceName;
}

export function copyToClipboard(text: string): void {
  const vs = (window as unknown as {
    __mdViewerVscode?: { postMessage: (m: unknown) => void };
  }).__mdViewerVscode;
  vs?.postMessage({ type: 'copyText', text });
}
