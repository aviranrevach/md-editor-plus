# Image controls — menu · resize · compress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give body images a click toolbar (source/replace/size presets + drag-resize/compress/reveal/remove) with sizes persisted as portable HTML `<img width>`, and extend the board image manager with source/compress/reveal.

**Architecture:** A pure markdown module decides image serialization (HTML `<img>` when a `width` attribute is set, clean `![]()` otherwise) and width math; `ResolvedImage` in editor.ts gains the `width` attribute + a markdown serializer override + a NodeView that renders a selection toolbar and corner drag-handles. A pure compress module makes the canvas re-encode decisions; the async canvas pass is shared by the body toolbar and the board manager. A new `revealImage` extension message mirrors the existing `saveImage` round-trip.

**Tech Stack:** TypeScript, TipTap/ProseMirror (`@tiptap/extension-image`), tiptap-markdown (`html: true` default — confirmed `getMarkdownSpec` merges `{...default, ...nodeStorage}` so our serializer wins), VS Code webview `postMessage`, Jest + ts-jest (pure helpers; DOM/canvas pieces verified by `npm run compile` + manual F5).

**Baseline note:** `npm test` has known pre-existing failures (a toggle.ts ts-jest type-check and board grouping c12) unrelated to this work — see [[project_toggle_test_pre_existing_failure]]. New tests below must pass; don't be alarmed by those two.

**Concurrency:** Another tab is on c2. Implement in a git worktree off `main` (use the using-git-worktrees skill at execution time). Do NOT sweep other tabs' uncommitted files into commits — `git add` only the listed paths.

---

### Task 1: Image markdown serialization + width helpers (pure)

**Files:**
- Create: `src/webview/imageMarkdown.ts`
- Test: `tests/imageMarkdown.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/imageMarkdown.test.ts
import { normalizeWidth, clampWidth, imageNodeToMarkdown } from '../src/webview/imageMarkdown';

describe('normalizeWidth', () => {
  it('returns a positive integer for numbers and numeric strings', () => {
    expect(normalizeWidth(420)).toBe(420);
    expect(normalizeWidth('420')).toBe(420);
    expect(normalizeWidth('420px')).toBe(420);
    expect(normalizeWidth(419.6)).toBe(420);
  });
  it('returns null for missing / zero / negative / non-numeric', () => {
    expect(normalizeWidth(null)).toBeNull();
    expect(normalizeWidth('')).toBeNull();
    expect(normalizeWidth(0)).toBeNull();
    expect(normalizeWidth(-5)).toBeNull();
    expect(normalizeWidth('abc')).toBeNull();
  });
});

describe('clampWidth', () => {
  it('bounds a value into [min, max] and rounds', () => {
    expect(clampWidth(50, 80, 700)).toBe(80);
    expect(clampWidth(999, 80, 700)).toBe(700);
    expect(clampWidth(420.4, 80, 700)).toBe(420);
  });
  it('tolerates swapped min/max', () => {
    expect(clampWidth(420, 700, 80)).toBe(420);
  });
});

describe('imageNodeToMarkdown', () => {
  it('emits clean ![]() when no width', () => {
    expect(imageNodeToMarkdown({ src: './a.png', alt: '' })).toBe('![](./a.png)');
    expect(imageNodeToMarkdown({ src: './a.png', alt: 'cat' })).toBe('![cat](./a.png)');
  });
  it('escapes parens in the src for the ![]() form', () => {
    expect(imageNodeToMarkdown({ src: './a(1).png', alt: '' })).toBe('![](./a\\(1\\).png)');
  });
  it('emits an HTML <img> with width when width is set', () => {
    expect(imageNodeToMarkdown({ src: './a.png', alt: '', width: 420 }))
      .toBe('<img src="./a.png" width="420" />');
  });
  it('includes alt in the <img> when present', () => {
    expect(imageNodeToMarkdown({ src: './a.png', alt: 'cat', width: 420 }))
      .toBe('<img src="./a.png" alt="cat" width="420" />');
  });
  it('escapes double quotes and angle brackets in <img> attributes', () => {
    expect(imageNodeToMarkdown({ src: './a"b.png', alt: '<x>', width: 100 }))
      .toBe('<img src="./a&quot;b.png" alt="&lt;x&gt;" width="100" />');
  });
  it('treats zero / negative width as unsized', () => {
    expect(imageNodeToMarkdown({ src: './a.png', alt: '', width: 0 })).toBe('![](./a.png)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest imageMarkdown --testPathIgnorePatterns "/.claude/"`
Expected: FAIL — "Cannot find module '../src/webview/imageMarkdown'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/webview/imageMarkdown.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest imageMarkdown --testPathIgnorePatterns "/.claude/"`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/webview/imageMarkdown.ts tests/imageMarkdown.test.ts
git commit -m "feat(images): pure markdown serializer + width helpers"
```

---

### Task 2: Wire width attribute + markdown serializer into ResolvedImage

**Files:**
- Modify: `src/webview/editor.ts:43-49` (the `ResolvedImage` definition)

This task has no jest coverage (the real editor pulls in mermaid etc. and is mocked in jest via `tests/__mocks__/editorMock.js`). Verify by typecheck + manual F5 round-trip.

- [ ] **Step 1: Add the import**

At the top of `src/webview/editor.ts`, near the existing `import { setMediaBaseUri, resolveImageSrc } from './mediaResolve';` (line 33), add:

```ts
import { imageNodeToMarkdown, normalizeWidth } from './imageMarkdown';
```

- [ ] **Step 2: Replace the `ResolvedImage` definition**

Replace lines 43-49 (the current `const ResolvedImage = Image.extend({ renderHTML… });`) with:

```ts
const ResolvedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        // Read width off an <img> (from HTML round-trip) as a positive int.
        parseHTML: (el: HTMLElement) => normalizeWidth(el.getAttribute('width')),
        // Emitted into the editor DOM; the markdown serializer (below) handles files.
        renderHTML: (attrs: { width?: number | null }) =>
          attrs.width ? { width: String(attrs.width) } : {},
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const out: Record<string, unknown> = { ...HTMLAttributes };
    if (typeof out.src === 'string') out.src = resolveImageSrc(out.src);
    return ['img', mergeAttributes(this.options.HTMLAttributes, out)];
  },
  addStorage() {
    return {
      markdown: {
        // Sized images persist as HTML <img width>; unsized stay ![](). This
        // overrides tiptap-markdown's default image serializer (getMarkdownSpec
        // merges {...default, ...thisStorage}).
        serialize(state: any, node: any) {
          state.write(imageNodeToMarkdown(node.attrs));
        },
        parse: {},
      },
    };
  },
});
```

- [ ] **Step 3: Typecheck the build**

Run: `npm run compile`
Expected: completes with no TypeScript errors (tsc) and writes `dist/webview.js`.

- [ ] **Step 4: Manual round-trip verification (F5)**

Open the Extension Development Host (F5), open a markdown file with an image, and confirm:
- An untouched image still saves as `![](./Note.assets/x.png)` (open the raw file to check — unchanged from before).
- (After Task 8/9 land, set a width and confirm it saves as `<img src="…" width="…">` and reopens at that width.)

For now just confirm no regression: existing images load and resave as plain `![]()`.

- [ ] **Step 5: Commit**

```bash
git add src/webview/editor.ts
git commit -m "feat(images): width attribute + HTML-img markdown serializer on ResolvedImage"
```

---

### Task 3: Compress decision helpers (pure)

**Files:**
- Create: `src/webview/imageCompress.ts` (helpers only this task; canvas fn added in Task 4)
- Test: `tests/imageCompress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/imageCompress.test.ts
import { outputMimeForCompress, scaleToFit } from '../src/webview/imageCompress';

describe('outputMimeForCompress', () => {
  it('keeps JPEG as JPEG and WebP as WebP', () => {
    expect(outputMimeForCompress('image/jpeg')).toBe('image/jpeg');
    expect(outputMimeForCompress('image/jpg')).toBe('image/jpeg');
    expect(outputMimeForCompress('image/webp')).toBe('image/webp');
  });
  it('re-encodes PNG to WebP', () => {
    expect(outputMimeForCompress('image/png')).toBe('image/webp');
  });
  it('returns null (skip) for vector/animated/other formats', () => {
    expect(outputMimeForCompress('image/svg+xml')).toBeNull();
    expect(outputMimeForCompress('image/gif')).toBeNull();
    expect(outputMimeForCompress('image/bmp')).toBeNull();
    expect(outputMimeForCompress('application/octet-stream')).toBeNull();
  });
});

describe('scaleToFit', () => {
  it('returns the same size when within the cap or cap disabled', () => {
    expect(scaleToFit(800, 600, 0)).toEqual({ w: 800, h: 600 });
    expect(scaleToFit(800, 600, 1000)).toEqual({ w: 800, h: 600 });
  });
  it('scales down proportionally to the longest side', () => {
    expect(scaleToFit(2000, 1000, 1000)).toEqual({ w: 1000, h: 500 });
    expect(scaleToFit(1000, 2000, 1000)).toEqual({ w: 500, h: 1000 });
  });
  it('never returns a zero dimension', () => {
    expect(scaleToFit(2000, 1, 1000)).toEqual({ w: 1000, h: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest imageCompress --testPathIgnorePatterns "/.claude/"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/webview/imageCompress.ts
// Image compression: pure decision helpers (unit-tested) + an async canvas
// re-encode (DOM, verified manually). Used by the body toolbar and board manager.

// Decide the output mime for a compress pass. null => don't canvas-compress
// (vector/animated/unknown): keep the original bytes untouched.
export function outputMimeForCompress(inputMime: string): string | null {
  const m = inputMime.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'image/jpeg';
  if (m === 'image/webp') return 'image/webp';
  if (m === 'image/png') return 'image/webp'; // PNG screenshots shrink far better as WebP
  return null;
}

// Scale (w,h) down to fit maxDim on the longest side, preserving aspect ratio.
// No upscaling. maxDim <= 0 means "no cap".
export function scaleToFit(w: number, h: number, maxDim: number): { w: number; h: number } {
  if (maxDim <= 0 || w <= 0 || h <= 0) return { w, h };
  const longest = Math.max(w, h);
  if (longest <= maxDim) return { w, h };
  const ratio = maxDim / longest;
  return { w: Math.max(1, Math.round(w * ratio)), h: Math.max(1, Math.round(h * ratio)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest imageCompress --testPathIgnorePatterns "/.claude/"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/imageCompress.ts tests/imageCompress.test.ts
git commit -m "feat(images): compress decision helpers (output mime + scale-to-fit)"
```

---

### Task 4: Canvas compress implementation

**Files:**
- Modify: `src/webview/imageCompress.ts` (append the async `compressImage`)

DOM/canvas — no jest (jsdom canvas can't encode). Verify via `npm run compile` + manual.

- [ ] **Step 1: Append `compressImage` to `src/webview/imageCompress.ts`**

```ts
export interface CompressResult {
  bytes: ArrayBuffer;
  mime: string;
  changed: boolean; // false => caller should keep the original asset as-is
}

// Re-encode image bytes through an offscreen canvas at `quality`, optionally
// capping the longest side to `maxDim`. Never inflates: if the result isn't
// smaller (and the format is unchanged), returns the original with changed=false.
export async function compressImage(
  bytes: ArrayBuffer,
  inputMime: string,
  opts: { quality?: number; maxDim?: number } = {},
): Promise<CompressResult> {
  const outMime = outputMimeForCompress(inputMime);
  if (!outMime) return { bytes, mime: inputMime, changed: false };
  const quality = opts.quality ?? 0.8;
  const maxDim = opts.maxDim ?? 0;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: inputMime }));
  } catch {
    return { bytes, mime: inputMime, changed: false };
  }
  const { w, h } = scaleToFit(bitmap.width, bitmap.height, maxDim);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return { bytes, mime: inputMime, changed: false };
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const outBlob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), outMime, quality),
  );
  if (!outBlob) return { bytes, mime: inputMime, changed: false };
  const outBytes = await outBlob.arrayBuffer();

  // Never inflate when staying in the same format/extension.
  if (outBytes.byteLength >= bytes.byteLength && outMime === inputMime) {
    return { bytes, mime: inputMime, changed: false };
  }
  return { bytes: outBytes, mime: outMime, changed: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run compile`
Expected: no TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/imageCompress.ts
git commit -m "feat(images): canvas re-encode compressImage (local, never inflates)"
```

---

### Task 5: Board link `replaceImageLinkAt` (pure)

**Files:**
- Modify: `src/webview/boardImageLinks.ts` (append)
- Test: `tests/boardImageLinks.test.ts` (append)

- [ ] **Step 1: Add the failing test**

Append to `tests/boardImageLinks.test.ts`:

```ts
import { replaceImageLinkAt } from '../src/webview/boardImageLinks';

describe('replaceImageLinkAt', () => {
  it('replaces the src at an index, keeping alt and the other links', () => {
    const v = '![a](./1.png) ![b](./2.png)';
    expect(replaceImageLinkAt(v, 1, './2.webp')).toBe('![a](./1.png) ![b](./2.webp)');
  });
  it('returns input unchanged for an out-of-range index', () => {
    const v = '![](./1.png)';
    expect(replaceImageLinkAt(v, 5, './x.png')).toBe(v);
    expect(replaceImageLinkAt(v, -1, './x.png')).toBe(v);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest boardImageLinks --testPathIgnorePatterns "/.claude/"`
Expected: FAIL — `replaceImageLinkAt` is not exported.

- [ ] **Step 3: Append the implementation to `src/webview/boardImageLinks.ts`**

```ts
// Replace the src of the image link at `index` (keeping its alt), returning the
// rebuilt space-joined value. Out-of-range index returns input unchanged.
export function replaceImageLinkAt(value: string, index: number, newSrc: string): string {
  const links = parseImageLinks(value);
  if (index < 0 || index >= links.length) return value;
  links[index] = { alt: links[index].alt, src: newSrc };
  return links.map((l) => `![${l.alt}](${l.src})`).join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest boardImageLinks --testPathIgnorePatterns "/.claude/"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardImageLinks.ts tests/boardImageLinks.test.ts
git commit -m "feat(images): replaceImageLinkAt for board cell src rewrite"
```

---

### Task 6: `revealImage` extension handler

**Files:**
- Modify: `src/mdEditorPlusProvider.ts` (add a handler beside the `saveImage` block, ~line 587)

Extension host code — no jest. Verify by `npm run compile` + manual.

- [ ] **Step 1: Add the handler**

Immediately after the `if (msg.type === 'saveImage') { … return; }` block (ends ~line 587), insert:

```ts
      if (msg.type === 'revealImage') {
        const m = msg as unknown as { requestId?: unknown; relPath?: unknown };
        const requestId = typeof m.requestId === 'string' ? m.requestId : '';
        const reply = (extra: Record<string, unknown>) =>
          void webviewPanel.webview.postMessage({ type: 'imageRevealed', requestId, ...extra });
        if (!requestId || typeof m.relPath !== 'string') {
          reply({ error: 'bad revealImage request' });
          return;
        }
        if (!document.uri.scheme.startsWith('file')) {
          reply({ error: 'save the file first' });
          return;
        }
        try {
          const clean = m.relPath.replace(/^\.\//, '');
          const docDir = vscode.Uri.joinPath(document.uri, '..');
          const target = vscode.Uri.joinPath(docDir, clean);
          await vscode.commands.executeCommand('revealFileInOS', target);
          reply({ ok: true });
        } catch (err) {
          reply({ error: (err as Error).message });
        }
        return;
      }
```

- [ ] **Step 2: Typecheck**

Run: `npm run compile`
Expected: no TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/mdEditorPlusProvider.ts
git commit -m "feat(images): revealImage handler (reveal asset in Finder)"
```

---

### Task 7: Webview bridge — `revealImage` + `fetchImageBytes`

**Files:**
- Modify: `src/webview/imageUpload.ts`
- Test: `tests/imageUpload.test.ts` (append a transport test)

- [ ] **Step 1: Add the failing test**

Append to `tests/imageUpload.test.ts`:

```ts
import { revealImage } from '../src/webview/imageUpload';

describe('revealImage transport', () => {
  it('posts a revealImage message and resolves when the extension replies', async () => {
    const posted: any[] = [];
    (window as any).__mdViewerVscode = { postMessage: (m: any) => posted.push(m) };
    const p = revealImage('./Note.assets/x.png');
    // Echo back the reply the extension would send.
    const req = posted.find((m) => m.type === 'revealImage');
    expect(req).toBeTruthy();
    expect(req.relPath).toBe('./Note.assets/x.png');
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'imageRevealed', requestId: req.requestId, ok: true },
    }));
    await expect(p).resolves.toBeUndefined();
  });
});
```

This test needs the jsdom environment. Add this docblock at the very top of `tests/imageUpload.test.ts` if not already present:

```ts
/**
 * @jest-environment jsdom
 */
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest imageUpload --testPathIgnorePatterns "/.claude/"`
Expected: FAIL — `revealImage` is not exported.

- [ ] **Step 3: Extend `src/webview/imageUpload.ts`**

In `ensureListener`, extend the `msg` type to include `ok?: boolean` and add a branch alongside the others (after the `clipboardImageResolved` branch, before the closing `}` of the listener):

```ts
    } else if (msg.type === 'imageRevealed') {
      pending.delete(msg.requestId);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve('');
    }
```

(Update the inline `msg` type annotation near the top of `ensureListener` to add `ok?: boolean;`.)

Then append these exports at the end of the file:

```ts
// Ask the extension to reveal the asset (relative path) in the OS file manager.
export function revealImage(relPath: string): Promise<void> {
  return request({ type: 'revealImage', relPath }).then(() => undefined);
}

// Read the bytes of an already-resolved (webview-accessible) image URI. Used to
// feed the current image into compressImage. Throws on a non-OK fetch.
export async function fetchImageBytes(resolvedSrc: string): Promise<ArrayBuffer> {
  const res = await fetch(resolvedSrc);
  if (!res.ok) throw new Error(`couldn't read image (${res.status})`);
  return res.arrayBuffer();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest imageUpload --testPathIgnorePatterns "/.claude/"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/imageUpload.ts tests/imageUpload.test.ts
git commit -m "feat(images): webview bridge revealImage + fetchImageBytes"
```

---

### Task 8: Body image NodeView — toolbar + drag handles

**Files:**
- Create: `src/webview/imageNodeView.ts`

DOM-heavy — no jest. Verify by `npm run compile` + manual F5. (Registered into the editor in Task 9.)

- [ ] **Step 1: Create `src/webview/imageNodeView.ts` with the full implementation**

```ts
// NodeView for the body image: renders the <img> plus, when selected, a floating
// toolbar (source/replace/size/compress/reveal/remove) and corner drag-handles.
// Sizes are committed to the node's `width` attribute, which the markdown
// serializer turns into a portable <img width> tag.
import type { Editor } from '@tiptap/core';
import { resolveImageSrc } from './mediaResolve';
import { clampWidth } from './imageMarkdown';
import { compressImage } from './imageCompress';
import {
  saveImageBytes,
  pickProjectImage,
  embedImageFromClipboard,
  revealImage,
  fetchImageBytes,
} from './imageUpload';
import { sanitizeImageFileName, extensionForMime } from '../imageAssets';

export const IMAGE_MIN_WIDTH = 80;
export const IMAGE_SIZE_PRESETS: ReadonlyArray<{ label: string; px: number }> = [
  { label: 'S', px: 240 },
  { label: 'M', px: 420 },
  { label: 'L', px: 640 },
];

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .img-nv { position: relative; display: inline-block; max-width: 100%; line-height: 0; }
    .img-nv > img { max-width: 100%; height: auto; border-radius: 4px; display: block; }
    .img-nv.is-selected > img { outline: 2px solid var(--accent, #2383e2); outline-offset: 2px; }
    .img-nv-handle { position: absolute; width: 12px; height: 12px; background: var(--accent, #2383e2);
      border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.15); z-index: 6; }
    .img-nv-handle.nw { top: -6px; left: -6px; cursor: nwse-resize; }
    .img-nv-handle.ne { top: -6px; right: -6px; cursor: nesw-resize; }
    .img-nv-handle.sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
    .img-nv-handle.se { bottom: -6px; right: -6px; cursor: nwse-resize; }
    .img-nv-toolbar { position: absolute; top: -42px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 2px; padding: 4px; z-index: 7;
      background: var(--bg, #fff); border: 1px solid var(--border, rgba(0,0,0,.12));
      border-radius: 8px; box-shadow: 0 6px 22px rgba(0,0,0,.18); white-space: nowrap; }
    .img-nv-btn { border: none; background: transparent; color: inherit; font: inherit;
      font-size: 12px; padding: 4px 8px; border-radius: 5px; cursor: pointer; line-height: 1.2; }
    .img-nv-btn:hover { background: var(--block-hover, rgba(0,0,0,.06)); }
    .img-nv-sep { width: 1px; align-self: stretch; background: var(--border, rgba(0,0,0,.12)); margin: 2px 2px; }
    .img-nv-src { max-width: 180px; overflow: hidden; text-overflow: ellipsis; opacity: .7;
      font-size: 11px; padding: 4px 6px; }
    .img-nv-submenu { position: absolute; top: 100%; left: 0; margin-top: 4px; display: flex;
      flex-direction: column; min-width: 160px; background: var(--bg, #fff);
      border: 1px solid var(--border, rgba(0,0,0,.12)); border-radius: 8px;
      box-shadow: 0 6px 22px rgba(0,0,0,.18); padding: 4px; }
    .img-nv-submenu button { text-align: left; }
  `;
  document.head.appendChild(style);
}

interface NodeViewCtx {
  node: any;
  editor: Editor;
  getPos: () => number;
}

export function imageNodeViewFactory() {
  return (ctx: NodeViewCtx) => new ImageNodeView(ctx);
}

class ImageNodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private node: any;
  private editor: Editor;
  private getPos: () => number;
  private selected = false;
  private toolbar: HTMLElement | null = null;
  private submenu: HTMLElement | null = null;

  constructor(ctx: NodeViewCtx) {
    injectStyles();
    this.node = ctx.node;
    this.editor = ctx.editor;
    this.getPos = ctx.getPos;

    this.dom = document.createElement('span');
    this.dom.className = 'img-nv';
    this.img = document.createElement('img');
    this.applyImg();
    this.dom.appendChild(this.img);
  }

  private applyImg(): void {
    const src = this.node.attrs.src as string;
    this.img.src = resolveImageSrc(src);
    this.img.alt = (this.node.attrs.alt as string) || '';
    const w = this.node.attrs.width as number | null;
    if (w) this.img.style.width = `${w}px`;
    else this.img.style.removeProperty('width');
  }

  private setWidth(width: number | null): void {
    const pos = this.getPos();
    this.editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, width });
      return true;
    });
  }

  private setSrc(src: string, width: number | null): void {
    const pos = this.getPos();
    this.editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, src, width });
      return true;
    });
  }

  private remove(): void {
    const pos = this.getPos();
    this.editor.commands.command(({ tr }) => {
      tr.delete(pos, pos + this.node.nodeSize);
      return true;
    });
  }

  private maxWidth(): number {
    const editorWidth = (this.editor.view.dom as HTMLElement).clientWidth || 700;
    return Math.max(IMAGE_MIN_WIDTH, editorWidth);
  }

  // --- drag handles ---------------------------------------------------------
  private addHandle(corner: 'nw' | 'ne' | 'sw' | 'se'): void {
    const h = document.createElement('span');
    h.className = `img-nv-handle ${corner}`;
    h.addEventListener('mousedown', (e) => this.beginDrag(e, corner));
    this.dom.appendChild(h);
  }

  private beginDrag(e: MouseEvent, corner: 'nw' | 'ne' | 'sw' | 'se'): void {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = this.img.getBoundingClientRect().width;
    const grows = corner === 'ne' || corner === 'se'; // dragging right edge grows
    const max = this.maxWidth();
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next = clampWidth(startW + (grows ? dx : -dx), IMAGE_MIN_WIDTH, max);
      this.img.style.width = `${next}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const committed = clampWidth(this.img.getBoundingClientRect().width, IMAGE_MIN_WIDTH, max);
      this.setWidth(committed);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // --- toolbar --------------------------------------------------------------
  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'img-nv-btn';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep node selected
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  private closeSubmenu(): void {
    this.submenu?.remove();
    this.submenu = null;
  }

  private openReplaceMenu(anchor: HTMLElement): void {
    this.closeSubmenu();
    const menu = document.createElement('div');
    menu.className = 'img-nv-submenu';
    const add = (label: string, fn: () => Promise<void>) => {
      const b = this.button(label, () => { this.closeSubmenu(); void fn(); });
      menu.appendChild(b);
    };
    add('Upload from computer', async () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        const src = await saveImageBytes(file.name, await file.arrayBuffer());
        if (src) this.setSrc(src, null);
      });
      input.click();
    });
    add('Browse project', async () => {
      const src = await pickProjectImage();
      if (src) this.setSrc(src, null);
    });
    add('From clipboard', async () => {
      const src = await embedImageFromClipboard();
      if (src) this.setSrc(src, null);
    });
    anchor.appendChild(menu);
    this.submenu = menu;
  }

  private async compress(): Promise<void> {
    const rawSrc = this.node.attrs.src as string;
    // Only local assets can be overwritten; skip http/data URLs.
    if (/^(?:https?:|data:)/i.test(rawSrc)) return;
    const resolved = resolveImageSrc(rawSrc);
    const guessMime = `image/${extensionForMime(`image/${(rawSrc.split('.').pop() || '').toLowerCase()}`)}`;
    try {
      const bytes = await fetchImageBytes(resolved);
      // Derive input mime from the file extension.
      const ext = (rawSrc.split('.').pop() || 'png').toLowerCase();
      const inputMime =
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : ext === 'png' ? 'image/png'
        : `image/${ext}`;
      const result = await compressImage(bytes, inputMime, { quality: 0.8 });
      if (!result.changed) return;
      // New filename: original stem + new extension (PNG->webp changes ext).
      const stem = (rawSrc.split('/').pop() || 'image').replace(/\.[^.]+$/, '');
      const name = sanitizeImageFileName(`${stem}.${extensionForMime(result.mime)}`);
      const newSrc = await saveImageBytes(name, result.bytes);
      if (newSrc) this.setSrc(newSrc, this.node.attrs.width ?? null);
    } catch {
      /* swallow: compress is best-effort, never corrupts the asset */
      void guessMime;
    }
  }

  private buildToolbar(): void {
    const bar = document.createElement('div');
    bar.className = 'img-nv-toolbar';
    bar.addEventListener('mousedown', (e) => e.preventDefault());

    const src = document.createElement('span');
    src.className = 'img-nv-src';
    src.textContent = (this.node.attrs.src as string) || '';
    src.title = (this.node.attrs.src as string) || '';
    bar.appendChild(src);

    bar.appendChild(this.sep());
    const replaceBtn = this.button('Replace', () => {
      if (this.submenu) this.closeSubmenu();
      else this.openReplaceMenu(replaceBtn);
    });
    replaceBtn.style.position = 'relative';
    bar.appendChild(replaceBtn);

    bar.appendChild(this.sep());
    for (const p of IMAGE_SIZE_PRESETS) {
      bar.appendChild(this.button(p.label, () => this.setWidth(p.px)));
    }
    bar.appendChild(this.button('Full', () => this.setWidth(null)));

    bar.appendChild(this.sep());
    bar.appendChild(this.button('Compress', () => { void this.compress(); }));
    bar.appendChild(this.button('Reveal', () => {
      void revealImage(this.node.attrs.src as string);
    }));
    bar.appendChild(this.button('Remove', () => this.remove()));

    this.dom.appendChild(bar);
    this.toolbar = bar;
  }

  private sep(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'img-nv-sep';
    return s;
  }

  private showChrome(): void {
    if (this.toolbar) return;
    this.dom.classList.add('is-selected');
    this.buildToolbar();
    (['nw', 'ne', 'sw', 'se'] as const).forEach((c) => this.addHandle(c));
  }

  private hideChrome(): void {
    this.dom.classList.remove('is-selected');
    this.closeSubmenu();
    this.toolbar?.remove();
    this.toolbar = null;
    this.dom.querySelectorAll('.img-nv-handle').forEach((h) => h.remove());
  }

  // --- TipTap NodeView hooks ------------------------------------------------
  selectNode(): void {
    this.selected = true;
    this.showChrome();
  }

  deselectNode(): void {
    this.selected = false;
    this.hideChrome();
  }

  update(node: any): boolean {
    if (node.type.name !== this.node.type.name) return false;
    this.node = node;
    this.applyImg();
    if (this.selected && this.toolbar) {
      const srcEl = this.toolbar.querySelector('.img-nv-src') as HTMLElement | null;
      if (srcEl) { srcEl.textContent = node.attrs.src || ''; srcEl.title = node.attrs.src || ''; }
    }
    return true;
  }

  ignoreMutation(): boolean {
    return true; // we manage our own DOM (toolbar/handles)
  }

  destroy(): void {
    this.hideChrome();
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run compile`
Expected: no TS errors. (If `@tiptap/core` `Editor` type import path differs, match the import style already used elsewhere in `src/webview`.)

- [ ] **Step 3: Commit**

```bash
git add src/webview/imageNodeView.ts
git commit -m "feat(images): body image NodeView (toolbar + drag-resize handles)"
```

---

### Task 9: Register the NodeView + manual round-trip

**Files:**
- Modify: `src/webview/editor.ts` (the `ResolvedImage` definition — add `addNodeView`)

- [ ] **Step 1: Import the factory**

Near the other webview imports in `src/webview/editor.ts`, add:

```ts
import { imageNodeViewFactory } from './imageNodeView';
```

- [ ] **Step 2: Add `addNodeView` to `ResolvedImage`**

Inside the `ResolvedImage = Image.extend({ … })` object (from Task 2), add this method (e.g. after `addStorage`):

```ts
  addNodeView() {
    return imageNodeViewFactory();
  },
```

- [ ] **Step 3: Build**

Run: `npm run compile`
Expected: no TS errors; `dist/webview.js` rebuilt.

- [ ] **Step 4: Manual F5 verification**

In the Extension Development Host with a note containing an image:
- Click the image → toolbar appears above it, four corner handles appear.
- Drag a corner → image resizes live; release → size sticks.
- Open the raw `.md` → the image is now `<img src="./Note.assets/x.png" width="NNN" />`.
- Reload the note → image opens at that width; toolbar still works.
- Click **Full** → width clears; raw file shows `![](…)` again.
- Click **S/M/L** → width snaps to 240/420/640.
- Click **Replace → Upload/Browse/Clipboard** → image swaps, width resets.
- Click **Compress** on a PNG → asset becomes a smaller `.webp`, link updates, image still shows.
- Click **Reveal** → OS file manager opens with the asset selected.
- Click **Remove** → image deleted.
- Click elsewhere → toolbar/handles disappear (no overlap with the bubble menu on text selection).

- [ ] **Step 5: Commit**

```bash
git add src/webview/editor.ts
git commit -m "feat(images): register image NodeView (click toolbar + resize)"
```

---

### Task 10: Board manager — Source / Compress / Reveal per thumbnail

**Files:**
- Modify: `src/webview/boardImagePicker.ts`

DOM — no jest (the pure `replaceImageLinkAt` is covered in Task 5). Verify by `npm run compile` + manual.

- [ ] **Step 1: Extend the imports**

At the top of `src/webview/boardImagePicker.ts`, update the imports:

```ts
import { saveImageBytes, pickProjectImage, embedImageFromClipboard, revealImage, fetchImageBytes } from './imageUpload';
import { resolveImageSrc } from './mediaResolve';
import { parseImageLinks, appendImageLink, removeImageLinkAt, replaceImageLinkAt } from './boardImageLinks';
import { compressImage } from './imageCompress';
import { sanitizeImageFileName, extensionForMime } from '../imageAssets';
```

- [ ] **Step 2: Add per-thumbnail actions in `render()`**

Inside the `links.forEach((link, i) => { … })` loop in `render()`, after the existing delete button is appended to `wrap`, add a small action row. Replace the block that builds `wrap` so it also shows the path and Compress/Reveal. Concretely, after `wrap.appendChild(del);` add:

```ts
        // Per-image actions: show the source path, compress, reveal.
        img.title = link.src; // already set above; ensures the path tooltip
        const actions = document.createElement('div');
        actions.className = 'bd-image-mgr-actions';
        const mkBtn = (label: string, title: string, fn: () => void) => {
          const b = document.createElement('button');
          b.className = 'bd-image-mgr-mini';
          b.textContent = label;
          b.title = title;
          b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
          actions.appendChild(b);
        };
        mkBtn('⤢', `Reveal in Finder: ${link.src}`, () => { void revealImage(link.src); });
        mkBtn('🗜', `Compress: ${link.src}`, () => { void compressLink(i, link.src); });
        wrap.appendChild(actions);
```

- [ ] **Step 3: Add the `compressLink` helper inside `openBoardImageManager`**

Add this function inside `openBoardImageManager` (e.g. just below `commit`):

```ts
  async function compressLink(index: number, src: string): Promise<void> {
    if (/^(?:https?:|data:)/i.test(src)) return; // only local assets
    try {
      const ext = (src.split('.').pop() || 'png').toLowerCase();
      const inputMime =
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : ext === 'png' ? 'image/png'
        : `image/${ext}`;
      const bytes = await fetchImageBytes(resolveImageSrc(src));
      const result = await compressImage(bytes, inputMime, { quality: 0.8 });
      if (!result.changed) return;
      const stem = (src.split('/').pop() || 'image').replace(/\.[^.]+$/, '');
      const name = sanitizeImageFileName(`${stem}.${extensionForMime(result.mime)}`);
      const newSrc = await saveImageBytes(name, result.bytes);
      if (newSrc) commit(replaceImageLinkAt(value, index, newSrc));
    } catch (err) {
      showError((err as Error).message);
    }
  }
```

- [ ] **Step 4: Add styles for the mini actions**

In the `injectStyles()` template string in this file, add:

```css
    .bd-image-mgr-actions { position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 2px; }
    .bd-image-mgr-mini { width: 20px; height: 18px; border: none; border-radius: 4px; cursor: pointer;
      background: var(--bg, #fff); color: inherit; font-size: 11px; line-height: 1;
      box-shadow: 0 1px 4px rgba(0,0,0,.25); padding: 0; }
    .bd-image-mgr-mini:hover { background: var(--block-hover, rgba(0,0,0,.08)); }
```

(Bump `.bd-image-mgr-thumbwrap` height a touch if the action row clips — set `margin-bottom: 8px;` on `.bd-image-mgr-grid`.)

- [ ] **Step 5: Build + manual**

Run: `npm run compile`
Then F5: open a board with an image cell → open the image manager → each thumbnail shows ⤢ (reveal) and 🗜 (compress). Reveal opens Finder; Compress on a PNG shrinks it to `.webp` and the thumbnail/link update. The path shows on hover.

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardImagePicker.ts
git commit -m "feat(images): board image manager gains source/compress/reveal"
```

---

### Task 11: Docs + backlog

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/superpowers/backlog.md`

- [ ] **Step 1: CHANGELOG entry**

Add an entry under the current unreleased/next section describing: click an image to resize (drag handles + S/M/L/Full), replace, compress (local), reveal in Finder, remove; sizes persist as portable HTML `<img>`; board image manager gains source/compress/reveal.

- [ ] **Step 2: README — document the image toolbar**

In the images section of `README.md`, add a short subsection: "Resize & manage images — click any image for a toolbar (size presets + drag handles, replace, compress, reveal, remove). Resized images are saved as standard HTML `<img>` so they render everywhere."

- [ ] **Step 3: Backlog — close this item, leave the rest**

In `docs/superpowers/backlog.md`, mark "Image block controls — menu/resize/compress" as shipped (or remove it). Leave the alt-text, AI-compression, board-cell-resize, captions, embed-link host bug, and `/Image` slash-menu items intact.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/backlog.md
git commit -m "docs: image controls (menu/resize/compress); close backlog item"
```

---

## Self-Review

**Spec coverage:**
- Width attribute + HTML-`<img>` serializer → Tasks 1, 2 ✓
- Round-trip parse (width off `<img>`) → Task 2 `parseHTML` ✓
- NodeView toolbar (source/replace/size presets/compress/reveal/remove) + drag handles → Tasks 8, 9 ✓
- Size presets S=240/M=420/L=640, Full clears width → Task 8 (`IMAGE_SIZE_PRESETS`) + Task 9 manual ✓
- Compress (canvas, local, never inflates, PNG→WebP) → Tasks 3, 4 ✓
- Board manager source/compress/reveal (no resize) → Tasks 5, 10 ✓
- `revealImage` extension message → Tasks 6, 7 ✓
- Compress src can change (PNG→WebP) propagated → Task 8 `compress()` + Task 10 `compressLink` both `setSrc`/`replaceImageLinkAt` ✓
- Tests for serializer/compress/clamp/replace → Tasks 1, 3, 5, 7 ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. The `compress()` `guessMime` local is dead-coded defensively (`void guessMime`) — harmless; an implementer may drop it.

**Type consistency:** `imageNodeToMarkdown(attrs)`, `normalizeWidth`, `clampWidth(raw,min,max)`, `outputMimeForCompress`, `scaleToFit`, `compressImage(bytes,mime,opts) → {bytes,mime,changed}`, `replaceImageLinkAt(value,index,newSrc)`, `revealImage(relPath)`, `fetchImageBytes(resolvedSrc)`, `imageNodeViewFactory()` — names used consistently across tasks. `setSrc(src, width)` always passes an explicit width (preserving or resetting). ✓

**Scope:** Single feature, one editor surface + the existing board manager. Focused. ✓
