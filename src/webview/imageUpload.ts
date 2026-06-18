// Webview-side bridge to the extension's image handlers. Wraps the
// fire-and-forget postMessage transport in promises correlated by a request id.

interface Bridge { postMessage: (m: unknown) => void; }

function bridge(): Bridge | undefined {
  return (window as unknown as { __mdViewerVscode?: Bridge }).__mdViewerVscode;
}

// All image round-trips resolve to a string src (or null when the user cancels
// a picker). Replies are correlated to the originating call by requestId.
type PendingResolve = (value: string | null) => void;
const pending = new Map<string, { resolve: PendingResolve; reject: (err: Error) => void }>();
let counter = 0;
let listenerInstalled = false;

function ensureListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as {
      type?: string; requestId?: string;
      relPath?: string; src?: string; canceled?: boolean; error?: string; ok?: boolean;
      bytesBase64?: string;
    };
    if (!msg || typeof msg.requestId !== 'string') return;
    const p = pending.get(msg.requestId);
    if (!p) return;
    if (msg.type === 'imageSaved') {
      pending.delete(msg.requestId);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.relPath ?? '');
    } else if (msg.type === 'projectImagePicked') {
      pending.delete(msg.requestId);
      if (msg.error) p.reject(new Error(msg.error));
      else if (msg.canceled) p.resolve(null);
      else p.resolve(msg.relPath ?? null);
    } else if (msg.type === 'clipboardImageResolved') {
      pending.delete(msg.requestId);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.src ?? '');
    } else if (msg.type === 'imageRevealed') {
      pending.delete(msg.requestId);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve('');
    } else if (msg.type === 'imagePathCopied') {
      pending.delete(msg.requestId);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve('');
    } else if (msg.type === 'imageBytesRead') {
      pending.delete(msg.requestId);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.bytesBase64 ?? '');
    }
  });
}

function nextId(): string {
  counter += 1;
  return `img-${Date.now()}-${counter}`;
}

function request(message: Record<string, unknown>): Promise<string | null> {
  ensureListener();
  const vs = bridge();
  if (!vs) return Promise.reject(new Error('no vscode bridge'));
  const requestId = nextId();
  return new Promise<string | null>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    vs.postMessage({ ...message, requestId });
    setTimeout(() => {
      if (pending.delete(requestId)) reject(new Error(`${String(message.type)} timed out`));
    }, 60000);
  });
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

// Upload: send image bytes to the extension; resolves with the relative path.
export function saveImageBytes(name: string, buffer: ArrayBuffer): Promise<string> {
  return request({ type: 'saveImage', name, bytesBase64: arrayBufferToBase64(buffer) })
    .then((v) => v ?? '');
}

// Browse project: opens the native VS Code file picker (shows real folders).
// Resolves to a relative link, or null if the user cancels.
export function pickProjectImage(): Promise<string | null> {
  return request({ type: 'pickProjectImage' });
}

// Embed from clipboard: reads the clipboard text and resolves it to an image
// src — a web/data URL as-is, or a project file path turned into a relative link.
export function embedImageFromClipboard(): Promise<string> {
  return request({ type: 'embedImageFromClipboard' }).then((v) => v ?? '');
}

// Ask the extension to reveal the asset (relative path) in the OS file manager.
export function revealImage(relPath: string): Promise<void> {
  return request({ type: 'revealImage', relPath }).then(() => undefined);
}

// Ask the extension to copy the asset's ABSOLUTE filesystem path to the clipboard.
export function copyImagePath(relPath: string): Promise<void> {
  return request({ type: 'copyImagePath', relPath }).then(() => undefined);
}

// Read the bytes of a local asset by its RELATIVE path (e.g. ./Note.assets/x.png).
// Goes through the extension because the webview's CSP (default-src 'none')
// blocks fetch() of local resources. Used to feed the image into compressImage
// and to measure its size. Throws if the extension can't read it.
export async function readImageBytes(relPath: string): Promise<ArrayBuffer> {
  const b64 = (await request({ type: 'readImageBytes', relPath })) ?? '';
  const binary = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
