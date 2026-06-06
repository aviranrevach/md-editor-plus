// Webview-side bridge to the extension's image handlers. Wraps the
// fire-and-forget postMessage transport in promises correlated by a request id.

interface Bridge { postMessage: (m: unknown) => void; }

function bridge(): Bridge | undefined {
  return (window as unknown as { __mdViewerVscode?: Bridge }).__mdViewerVscode;
}

export interface WorkspaceImage {
  relPath: string;
  label: string;
  webviewUri: string;
}

type Pending =
  | { kind: 'image'; resolve: (relPath: string) => void; reject: (err: Error) => void }
  | { kind: 'list'; resolve: (images: WorkspaceImage[]) => void; reject: (err: Error) => void };

const pending = new Map<string, Pending>();
let counter = 0;
let listenerInstalled = false;

function ensureListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as { type?: string; requestId?: string;
      relPath?: string; images?: WorkspaceImage[]; error?: string };
    if (!msg || typeof msg.requestId !== 'string') return;
    if (msg.type === 'imageSaved') {
      const p = pending.get(msg.requestId);
      if (!p || p.kind !== 'image') return;
      pending.delete(msg.requestId);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.relPath ?? '');
    } else if (msg.type === 'workspaceImages') {
      const p = pending.get(msg.requestId);
      if (!p || p.kind !== 'list') return;
      pending.delete(msg.requestId);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.images ?? []);
    }
  });
}

function nextId(): string {
  counter += 1;
  return `img-${Date.now()}-${counter}`;
}

// Convert raw bytes to base64 without spread-overflowing the call stack on
// large images (String.fromCharCode(...hugeArray) throws "too many arguments").
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(binary, 'binary').toString('base64'); // jest/node fallback
}

// Send image bytes to the extension; resolves with the relative markdown path.
export function saveImageBytes(name: string, buffer: ArrayBuffer): Promise<string> {
  ensureListener();
  const vs = bridge();
  if (!vs) return Promise.reject(new Error('no vscode bridge'));
  const requestId = nextId();
  return new Promise<string>((resolve, reject) => {
    pending.set(requestId, { kind: 'image', resolve, reject });
    vs.postMessage({ type: 'saveImage', requestId, name, bytesBase64: arrayBufferToBase64(buffer) });
    setTimeout(() => {
      if (pending.delete(requestId)) reject(new Error('saveImage timed out'));
    }, 15000);
  });
}

export function listWorkspaceImages(): Promise<WorkspaceImage[]> {
  ensureListener();
  const vs = bridge();
  if (!vs) return Promise.reject(new Error('no vscode bridge'));
  const requestId = nextId();
  return new Promise<WorkspaceImage[]>((resolve, reject) => {
    pending.set(requestId, { kind: 'list', resolve, reject });
    vs.postMessage({ type: 'listWorkspaceImages', requestId });
    setTimeout(() => {
      if (pending.delete(requestId)) reject(new Error('listWorkspaceImages timed out'));
    }, 15000);
  });
}
