# Image Foundation + c1 (Fix Add Image) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `window.prompt`-based "Add image" block with a working in-webview popover (Upload from computer · Browse project images · Embed link), backed by a shared image-ingestion pipeline that copies files into a per-note assets folder and writes clean relative markdown links.

**Architecture:** A pure string-only helper module (`src/imageAssets.ts`) computes the per-note assets folder name, sanitizes filenames, and de-duplicates collisions — imported by both the extension and the webview, unit-tested with Jest. The extension (`mdEditorPlusProvider.ts`) gains two request/response message handlers: `saveImage` (writes image bytes into `<note>.assets/` and replies with the relative path) and `listWorkspaceImages` (returns existing workspace images for the "Browse" option). A webview bridge module (`imageUpload.ts`) wraps those round-trips in promises keyed by a request id. A popover UI module (`imagePicker.ts`) presents the three entry modes and calls back with the chosen `src`, which the block picker inserts as a TipTap `image` node. Images already render correctly via the existing `ResolvedImage` extension + `mediaBaseUri` resolution, so no rendering changes are needed.

**Tech Stack:** TypeScript, TipTap (ProseMirror), VS Code Custom Editor webview API (`postMessage`/`onDidReceiveMessage`, `vscode.workspace.fs`), esbuild (webview bundle), Jest + ts-jest + jsdom.

---

## Scope

This plan covers **only** the shared foundation + **c1** (Fix Add image). The two sibling items get their own plans, built on this foundation:
- **c21 / c10** — paste & drop images (reuses `imageUpload.ts` + `saveImage`; adds clipboard `extensionForMime` + `pasted-<date>` naming).
- **c22** — images in board table cells (adds an `image` field type + inline thumbnail rendering + card cover).

## File Structure

**Create:**
- `src/imageAssets.ts` — pure, dependency-free string helpers (folder name, filename sanitize, collision dedupe, relative path). Imported by both extension (`./imageAssets`) and webview (`../imageAssets`).
- `tests/imageAssets.test.ts` — Jest unit tests for the helpers.
- `src/webview/imageUpload.ts` — webview-side promise bridge to the extension (`saveImageBytes`, `listWorkspaceImages`) + `arrayBufferToBase64`.
- `tests/imageUpload.test.ts` — Jest unit test for `arrayBufferToBase64` (pure).
- `src/webview/imagePicker.ts` — the in-webview popover (Upload / Browse / Embed link) with injected styles.

**Modify:**
- `src/mdEditorPlusProvider.ts` — add `saveImage` and `listWorkspaceImages` handlers inside `onDidReceiveMessage`; import helpers from `./imageAssets`.
- `src/webview/blockPicker.ts:186-189` — replace `window.prompt` in the `image` BlockDef `insert` with `openImagePicker`.

**No changes needed:** `src/webview/editor.ts` (`ResolvedImage` + `resolveImageSrc` already render relative paths); `localResourceRoots` already include the doc dir and workspace folder ([mdEditorPlusProvider.ts:91-95](../../../src/mdEditorPlusProvider.ts#L91-L95)).

---

## Task 1: Pure image-asset helpers (TDD)

**Files:**
- Create: `src/imageAssets.ts`
- Test: `tests/imageAssets.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/imageAssets.test.ts`:

```ts
import {
  assetsFolderName,
  sanitizeImageFileName,
  dedupeFileName,
  relativeAssetPath,
  isImageFileName,
} from '../src/imageAssets';

describe('assetsFolderName', () => {
  it('derives "<note>.assets" from a .md file name', () => {
    expect(assetsFolderName('TODO.md')).toBe('TODO.assets');
  });
  it('strips only the final extension', () => {
    expect(assetsFolderName('my.notes.md')).toBe('my.notes.assets');
  });
  it('handles a name with no extension', () => {
    expect(assetsFolderName('README')).toBe('README.assets');
  });
});

describe('sanitizeImageFileName', () => {
  it('keeps a clean name unchanged', () => {
    expect(sanitizeImageFileName('diagram.png')).toBe('diagram.png');
  });
  it('strips any directory parts', () => {
    expect(sanitizeImageFileName('/Users/me/Pictures/shot.png')).toBe('shot.png');
    expect(sanitizeImageFileName('C:\\pics\\shot.png')).toBe('shot.png');
  });
  it('replaces whitespace and unsafe chars with dashes and collapses runs', () => {
    expect(sanitizeImageFileName('my   cool*pic?.png')).toBe('my-cool-pic-.png');
  });
  it('falls back to "image.png" for an empty result', () => {
    expect(sanitizeImageFileName('   ')).toBe('image.png');
  });
});

describe('dedupeFileName', () => {
  it('returns the name unchanged when it is unique', () => {
    expect(dedupeFileName('shot.png', ['other.png'])).toBe('shot.png');
  });
  it('inserts -2 before the extension on first collision', () => {
    expect(dedupeFileName('shot.png', ['shot.png'])).toBe('shot-2.png');
  });
  it('keeps incrementing until unique', () => {
    expect(dedupeFileName('shot.png', ['shot.png', 'shot-2.png'])).toBe('shot-3.png');
  });
  it('dedupes names without an extension', () => {
    expect(dedupeFileName('shot', ['shot'])).toBe('shot-2');
  });
});

describe('relativeAssetPath', () => {
  it('builds a ./folder/file relative link', () => {
    expect(relativeAssetPath('TODO.assets', 'shot.png')).toBe('./TODO.assets/shot.png');
  });
});

describe('isImageFileName', () => {
  it('accepts common image extensions case-insensitively', () => {
    expect(isImageFileName('a.PNG')).toBe(true);
    expect(isImageFileName('b.jpeg')).toBe(true);
    expect(isImageFileName('c.svg')).toBe(true);
  });
  it('rejects non-images', () => {
    expect(isImageFileName('notes.md')).toBe(false);
    expect(isImageFileName('noext')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest imageAssets --silent=false`
Expected: FAIL — `Cannot find module '../src/imageAssets'`.

- [ ] **Step 3: Implement the helpers**

Create `src/imageAssets.ts`:

```ts
// Pure, dependency-free helpers for the image-ingestion pipeline.
// Imported by BOTH the extension (./imageAssets) and the webview bundle
// (../imageAssets), so it must not import node `path`, `fs`, vscode, or DOM.

export const IMAGE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico',
] as const;

// "TODO.md" -> "TODO.assets". Strips only the final extension.
export function assetsFolderName(docFileName: string): string {
  const base = docFileName.replace(/\.[^.]+$/, '');
  return `${base}.assets`;
}

// Reduce an arbitrary (possibly path-laden) name to a safe single filename.
export function sanitizeImageFileName(raw: string): string {
  // Drop any directory portion (handles both / and \ separators).
  const baseOnly = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = baseOnly
    .replace(/[\\/:*?"<>|\s]+/g, '-')          // unsafe + whitespace runs -> dash
    .replace(/-{2,}/g, '-')                    // collapse dash runs
    .replace(/^-+/, '');                        // no leading dash
  return cleaned.length ? cleaned : 'image.png';
}

// If `name` collides with an existing entry, insert -2, -3, ... before the ext.
export function dedupeFileName(name: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  let candidate = `${stem}-${n}${ext}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${stem}-${n}${ext}`;
  }
  return candidate;
}

// Build the relative markdown link the editor will store.
export function relativeAssetPath(folderName: string, fileName: string): string {
  return `./${folderName}/${fileName}`;
}

export function isImageFileName(name: string): boolean {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  if (!m) return false;
  return (IMAGE_EXTENSIONS as readonly string[]).includes(m[1].toLowerCase());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest imageAssets --silent=false`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/imageAssets.ts tests/imageAssets.test.ts
git commit -m "feat(images): pure asset-path helpers (folder name, sanitize, dedupe)"
```

---

## Task 2: Extension handlers — saveImage + listWorkspaceImages

**Files:**
- Modify: `src/mdEditorPlusProvider.ts` (import at top near line 6; handlers added inside `onDidReceiveMessage`, before the closing `});` at line 550)

This task can't be unit-tested without a VS Code host; it is verified end-to-end in Task 6.

- [ ] **Step 1: Add the import**

In `src/mdEditorPlusProvider.ts`, the existing import block (lines 1-6) ends with:

```ts
import { MARKDOWN_EXTENSIONS, isMarkdownPath, resolveClipboardCandidates } from './openPath';
```

Add directly below it:

```ts
import { assetsFolderName, sanitizeImageFileName, dedupeFileName, relativeAssetPath } from './imageAssets';
```

- [ ] **Step 2: Add the two message handlers**

In `src/mdEditorPlusProvider.ts`, find the `duplicate` handler that ends at line 549:

```ts
      if (msg.type === 'duplicate') {
        const dir = vscode.Uri.joinPath(document.uri, '..');
        const base = document.uri.path.split('/').pop() ?? 'document.md';
        const name = base.replace(/(\.md)$/i, '') + ' copy.md';
        const newUri = vscode.Uri.joinPath(dir, name);
        await vscode.workspace.fs.writeFile(newUri, Buffer.from(document.getText(), 'utf8'));
        await vscode.commands.executeCommand('vscode.openWith', newUri, 'md-editor-plus.editor');
      }
```

Immediately AFTER that closing `}` (still inside the `onDidReceiveMessage` callback, before the callback's closing `});` on line 550), insert:

```ts
      if (msg.type === 'saveImage') {
        const m = msg as unknown as { requestId?: unknown; name?: unknown; bytesBase64?: unknown };
        const requestId = typeof m.requestId === 'string' ? m.requestId : '';
        const reply = (extra: Record<string, unknown>) =>
          void webviewPanel.webview.postMessage({ type: 'imageSaved', requestId, ...extra });
        if (!requestId || typeof m.name !== 'string' || typeof m.bytesBase64 !== 'string') {
          reply({ error: 'bad saveImage request' });
          return;
        }
        try {
          const docDir = vscode.Uri.joinPath(document.uri, '..');
          const folderName = assetsFolderName(path.basename(document.uri.fsPath));
          const folderUri = vscode.Uri.joinPath(docDir, folderName);
          await vscode.workspace.fs.createDirectory(folderUri);
          let existing: string[] = [];
          try {
            existing = (await vscode.workspace.fs.readDirectory(folderUri)).map(([n]) => n);
          } catch { /* empty/new folder */ }
          const finalName = dedupeFileName(sanitizeImageFileName(m.name), existing);
          const fileUri = vscode.Uri.joinPath(folderUri, finalName);
          await vscode.workspace.fs.writeFile(fileUri, Buffer.from(m.bytesBase64, 'base64'));
          reply({ relPath: relativeAssetPath(folderName, finalName) });
        } catch (err) {
          reply({ error: (err as Error).message });
        }
        return;
      }
      if (msg.type === 'listWorkspaceImages') {
        const m = msg as unknown as { requestId?: unknown };
        const requestId = typeof m.requestId === 'string' ? m.requestId : '';
        const reply = (extra: Record<string, unknown>) =>
          void webviewPanel.webview.postMessage({ type: 'workspaceImages', requestId, ...extra });
        if (!requestId) { reply({ error: 'bad listWorkspaceImages request' }); return; }
        try {
          const files = await vscode.workspace.findFiles(
            '**/*.{png,jpg,jpeg,gif,webp,svg,bmp,avif,ico,PNG,JPG,JPEG,GIF,WEBP,SVG,BMP}',
            '{**/node_modules/**,**/.git/**,**/dist/**}',
            300,
          );
          const docDir = path.dirname(document.uri.fsPath);
          const images = files
            .slice()
            .sort((a, b) => a.fsPath.localeCompare(b.fsPath))
            .map((uri) => {
              let rel = path.relative(docDir, uri.fsPath).split(path.sep).join('/');
              if (!rel.startsWith('.')) rel = `./${rel}`;
              return {
                relPath: rel,
                label: path.basename(uri.fsPath),
                webviewUri: webviewPanel.webview.asWebviewUri(uri).toString(),
              };
            });
          reply({ images });
        } catch (err) {
          reply({ error: (err as Error).message });
        }
        return;
      }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS — no type errors. (The handlers cast `msg` via `as unknown as {...}`, matching the existing pattern at lines 339, 353, 359, etc.)

- [ ] **Step 4: Commit**

```bash
git add src/mdEditorPlusProvider.ts
git commit -m "feat(images): extension saveImage + listWorkspaceImages handlers"
```

---

## Task 3: Webview bridge — imageUpload.ts (TDD for the pure part)

**Files:**
- Create: `src/webview/imageUpload.ts`
- Test: `tests/imageUpload.test.ts`

- [ ] **Step 1: Write the failing test for arrayBufferToBase64**

Create `tests/imageUpload.test.ts`:

```ts
import { arrayBufferToBase64 } from '../src/webview/imageUpload';

describe('arrayBufferToBase64', () => {
  it('encodes bytes to standard base64', () => {
    // "Man" -> "TWFu"
    const bytes = new Uint8Array([0x4d, 0x61, 0x6e]);
    expect(arrayBufferToBase64(bytes.buffer)).toBe('TWFu');
  });
  it('handles an empty buffer', () => {
    expect(arrayBufferToBase64(new Uint8Array([]).buffer)).toBe('');
  });
  it('pads correctly for non-multiple-of-3 lengths', () => {
    // "M" -> "TQ=="
    expect(arrayBufferToBase64(new Uint8Array([0x4d]).buffer)).toBe('TQ==');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest imageUpload --silent=false`
Expected: FAIL — `Cannot find module '../src/webview/imageUpload'`.

- [ ] **Step 3: Implement imageUpload.ts**

Create `src/webview/imageUpload.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest imageUpload --silent=false`
Expected: PASS — all three `arrayBufferToBase64` cases green (uses the `Buffer` fallback under jest).

- [ ] **Step 5: Commit**

```bash
git add src/webview/imageUpload.ts tests/imageUpload.test.ts
git commit -m "feat(images): webview promise bridge for saveImage/listWorkspaceImages"
```

---

## Task 4: Image picker popover + wire into the block picker

**Files:**
- Create: `src/webview/imagePicker.ts`
- Modify: `src/webview/blockPicker.ts` (import at top; `image` BlockDef insert at lines 186-189)

UI task — verified manually in Task 6.

- [ ] **Step 1: Implement imagePicker.ts**

Create `src/webview/imagePicker.ts`:

```ts
import type { Editor } from '@tiptap/core';
import { saveImageBytes, listWorkspaceImages, WorkspaceImage } from './imageUpload';

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .image-picker { position: fixed; z-index: 10000; min-width: 280px; max-width: 360px;
      background: var(--mb-popover-bg, #fff); color: inherit;
      border: 1px solid rgba(0,0,0,.12); border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 8px; display: none; }
    .image-picker.open { display: block; }
    .image-picker-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
    .image-picker-tab { flex: 1; padding: 6px 8px; font-size: 12px; border-radius: 6px;
      border: none; background: transparent; cursor: pointer; color: inherit; }
    .image-picker-tab.active { background: rgba(35,131,226,.12); color: #2383e2; font-weight: 600; }
    .image-picker-body { font-size: 13px; }
    .image-picker-upload-btn { width: 100%; padding: 10px; border-radius: 8px;
      border: 1px dashed rgba(0,0,0,.25); background: transparent; cursor: pointer; color: inherit; }
    .image-picker-url-input { width: 100%; box-sizing: border-box; padding: 8px 10px;
      border-radius: 8px; border: 1px solid rgba(0,0,0,.18); background: transparent; color: inherit; }
    .image-picker-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
      max-height: 220px; overflow: auto; }
    .image-picker-thumb { aspect-ratio: 1; border-radius: 6px; overflow: hidden; cursor: pointer;
      border: 1px solid rgba(0,0,0,.1); background: rgba(0,0,0,.03); }
    .image-picker-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .image-picker-empty { padding: 16px; text-align: center; opacity: .6; font-size: 12px; }
    .image-picker-error { color: #c0392b; font-size: 12px; padding: 6px 2px; }
  `;
  document.head.appendChild(style);
}

type Tab = 'upload' | 'browse' | 'link';

export function openImagePicker(editor: Editor, pos: number, onPick: (src: string) => void): void {
  injectStyles();

  const el = document.createElement('div');
  el.className = 'image-picker';
  el.innerHTML = `
    <div class="image-picker-tabs">
      <button class="image-picker-tab active" data-tab="upload">Upload</button>
      <button class="image-picker-tab" data-tab="browse">Browse project</button>
      <button class="image-picker-tab" data-tab="link">Embed link</button>
    </div>
    <div class="image-picker-body"></div>
  `;
  document.body.appendChild(el);
  const tabsEl = el.querySelector<HTMLElement>('.image-picker-tabs')!;
  const body = el.querySelector<HTMLElement>('.image-picker-body')!;

  let done = false;
  function finish(src?: string): void {
    if (done) return;
    done = true;
    el.remove();
    document.removeEventListener('mousedown', onDocDown, true);
    if (src) onPick(src);
  }
  function onDocDown(e: MouseEvent): void {
    if (!el.contains(e.target as Node)) finish();
  }

  function showError(msg: string): void {
    const err = document.createElement('div');
    err.className = 'image-picker-error';
    err.textContent = msg;
    body.appendChild(err);
  }

  function renderUpload(): void {
    body.innerHTML = '<button class="image-picker-upload-btn">Choose an image…</button>';
    const btn = body.querySelector<HTMLButtonElement>('.image-picker-upload-btn')!;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    el.appendChild(fileInput);
    btn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      btn.textContent = 'Saving…';
      btn.disabled = true;
      try {
        const buffer = await file.arrayBuffer();
        const relPath = await saveImageBytes(file.name, buffer);
        finish(relPath);
      } catch (err) {
        btn.textContent = 'Choose an image…';
        btn.disabled = false;
        showError((err as Error).message);
      }
    });
  }

  function renderLink(): void {
    body.innerHTML = '<input class="image-picker-url-input" placeholder="Paste image URL, press Enter" />';
    const input = body.querySelector<HTMLInputElement>('.image-picker-url-input')!;
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = input.value.trim();
        if (url) finish(url);
      } else if (e.key === 'Escape') {
        finish();
      }
    });
  }

  async function renderBrowse(): Promise<void> {
    body.innerHTML = '<div class="image-picker-empty">Loading project images…</div>';
    let images: WorkspaceImage[] = [];
    try {
      images = await listWorkspaceImages();
    } catch (err) {
      body.innerHTML = '';
      showError((err as Error).message);
      return;
    }
    if (done) return;
    if (!images.length) {
      body.innerHTML = '<div class="image-picker-empty">No images found in this workspace yet.</div>';
      return;
    }
    body.innerHTML = '<div class="image-picker-grid"></div>';
    const grid = body.querySelector<HTMLElement>('.image-picker-grid')!;
    images.forEach((img) => {
      const cell = document.createElement('div');
      cell.className = 'image-picker-thumb';
      cell.title = img.label;
      const im = document.createElement('img');
      im.src = img.webviewUri;
      cell.appendChild(im);
      cell.addEventListener('click', () => finish(img.relPath));
      grid.appendChild(cell);
    });
  }

  function selectTab(tab: Tab): void {
    tabsEl.querySelectorAll<HTMLElement>('.image-picker-tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.tab === tab));
    if (tab === 'upload') renderUpload();
    else if (tab === 'link') renderLink();
    else void renderBrowse();
  }

  tabsEl.querySelectorAll<HTMLElement>('.image-picker-tab').forEach((t) => {
    t.addEventListener('click', () => selectTab(t.dataset.tab as Tab));
  });

  // Position near the insertion caret; fall back to viewport center.
  let left = window.innerWidth / 2 - 150;
  let top = window.innerHeight / 2 - 80;
  try {
    const coords = editor.view.coordsAtPos(pos);
    left = Math.min(coords.left, window.innerWidth - 380);
    top = coords.bottom + 6;
  } catch { /* use fallback */ }
  el.style.left = `${Math.max(12, left)}px`;
  el.style.top = `${Math.max(12, top)}px`;
  el.classList.add('open');

  selectTab('upload');
  // Defer the outside-click listener so the opening click doesn't immediately close it.
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}
```

- [ ] **Step 2: Wire it into the block picker**

In `src/webview/blockPicker.ts`, the import at line 1 is:

```ts
import { Editor } from '@tiptap/core';
```

Add directly below it:

```ts
import { openImagePicker } from './imagePicker';
```

Then replace the `image` BlockDef `insert` at lines 186-189:

```ts
    insert: (editor, pos) => {
      const url = window.prompt('Image URL:');
      if (url) editor.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src: url, alt: '' } }).run();
    },
```

with:

```ts
    insert: (editor, pos) => {
      openImagePicker(editor, pos, (src) => {
        editor.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src, alt: '' } }).run();
      });
    },
```

- [ ] **Step 3: Update the block description (it no longer just takes a URL)**

In `src/webview/blockPicker.ts`, the `image` BlockDef `description` at line 182 reads:

```ts
    description: 'Paste URL or drag & drop',
```

Change it to:

```ts
    description: 'Upload, pick from project, or paste a link',
```

- [ ] **Step 4: Type-check and run the existing block-picker tests**

Run: `npx tsc -p tsconfig.json --noEmit && npx jest blockPicker --silent=false`
Expected: PASS — type-check clean; `tests/blockPicker.test.ts` still green (it asserts the `image` block stays registered with an `insert` handler; the `'finds image block when querying "image"'` test is unaffected by the description change).

- [ ] **Step 5: Commit**

```bash
git add src/webview/imagePicker.ts src/webview/blockPicker.ts
git commit -m "feat(images): in-webview image picker (upload/browse/link), fix c1 broken add-image"
```

---

## Task 5: Full Jest + build gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS for the new `imageAssets` and `imageUpload` suites, and all previously-passing suites. NOTE: `tests/toggle.test.ts` has a known pre-existing type-check failure unrelated to this work — confirm it is the ONLY failure and that its message matches the known `toggle.ts` issue (do not "fix" unrelated code). All other suites must pass.

- [ ] **Step 2: Build the extension + webview bundle**

Run: `npm run compile`
Expected: PASS — `tsc` clean and esbuild produces `dist/webview.js` with no errors.

- [ ] **Step 3: Commit (only if any build-driven changes appeared)**

```bash
git add -A
git commit -m "chore(images): build foundation + c1" || echo "nothing to commit"
```

---

## Task 6: Manual end-to-end verification

**Files:** none (manual verification via the `/run` or `/verify` skill — launch the extension in an Extension Development Host).

- [ ] **Step 1: Launch the extension host and open a markdown note**

Use the `verify` skill (or press F5 in VS Code) to open an Extension Development Host. Open a `.md` file (e.g. a scratch `image-test.md` in a workspace folder) with MD Editor Plus.

- [ ] **Step 2: Verify Upload**

In the editor, open the block picker (type `/` or use the dragger), choose **Image** → the popover appears with three tabs (no silent no-op — this is the c1 fix). On **Upload**, pick a local image.
Expected: the image appears inline; a `<note>.assets/` folder is created next to the `.md`; the markdown contains `![](./<note>.assets/<filename>)`; reopening the file still shows the image.

- [ ] **Step 3: Verify Browse project**

Open the picker again → **Browse project** tab.
Expected: a thumbnail grid of existing workspace images (including the one just uploaded). Clicking one inserts it via a relative link without creating a duplicate file.

- [ ] **Step 4: Verify Embed link**

Open the picker again → **Embed link** tab, paste an `https://` image URL, press Enter.
Expected: the remote image renders; the markdown contains `![](https://…)` unchanged (no copy made).

- [ ] **Step 5: Verify collision handling**

Upload a second image whose filename matches one already in `<note>.assets/`.
Expected: the new file is saved as `name-2.ext` and the link points to the deduped name; the original file is untouched.

- [ ] **Step 6: Report results**

Report each step's outcome with evidence (screenshots or the resulting markdown text). If any step fails, STOP and use `superpowers:systematic-debugging` before claiming completion.

---

## Self-Review notes

- **Spec coverage:** c1 ("Add image does nothing when clicked") is fixed by removing the webview-blocked `window.prompt` (Task 4) and replacing it with a real popover. The shared foundation (assets folder, relative links, per-note folder `TODO.assets`, collision suffixes) is delivered by Tasks 1-3. "Browse project folders" = Task 2 `listWorkspaceImages` + Task 4 Browse tab. "Embed link" = Link tab. Upload = Upload tab.
- **Drag-drop onto the block** (the "C" option) is intentionally deferred to the c21 plan, since it shares the drop pipeline built there — noted in Scope.
- **Type consistency:** message types are stable across files — `saveImage`/`imageSaved` (with `requestId`, `name`, `bytesBase64`, `relPath`, `error`) and `listWorkspaceImages`/`workspaceImages` (with `requestId`, `images: {relPath,label,webviewUri}[]`, `error`). `WorkspaceImage` shape is identical in `imageUpload.ts` and the extension's reply.
- **No placeholders:** every code step contains complete, runnable code.
