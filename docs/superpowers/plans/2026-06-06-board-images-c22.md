# Board Images (c22) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring images into boards three ways — (A) a new **image field type** whose table cell shows thumbnail(s) with a "+N" badge, (B) **inline image thumbnails** rendered for `![](…)` links inside text/description cells, and (C) a **card cover** auto-derived from the first image in a card's body on the kanban view.

**Architecture:** Board renderers emit raw `<img>` DOM (not TipTap nodes), so relative `src` paths won't get the editor's automatic resolution. We extract the existing private `resolveImageSrc`/`setMediaBaseUri` from `editor.ts` into a tiny shared module (`mediaResolve.ts`) that both the editor and the board renderers import. A pure helpers module parses `![](…)` links out of cell/body strings. The board model gains an `'image'` field type (parsed/serialized via the existing `field-types` attribute; cell value is one or more space-separated `![](path)` markdown links, which already survive table-cell escaping). Table cells render thumbnails + a click-to-edit picker (`boardImagePicker.ts`) that reuses the c1/c21 ingestion pipeline (`saveImageBytes` / `pickProjectImage` / `embedImageFromClipboard`). Text/description cells render inline thumbnails for any image links they contain. The kanban card renderer extracts the first body image and shows it as a cover banner.

**Tech Stack:** TypeScript, board renderers (plain DOM), TipTap image resolution, Jest + ts-jest + jsdom. Builds on the merged image pipeline: `src/webview/imageUpload.ts`, `src/imageAssets.ts`.

---

## Scope

Covers c22 (A image field, B inline thumbnails, C card cover). The board parse/round-trip data-loss bug is **already fixed on main** (newline escaping in `board.ts htmlEscape`), so cell data is safe — no prerequisite fix needed.

**Design decisions (from brainstorming):**
- Image field cell holds **multiple** images → gallery thumbnail + "+N" badge.
- Cover = **first** image in the card body, automatic (no UI to choose).
- Cell value format = space-separated markdown image links `![](./Note.assets/a.png) ![](./Note.assets/b.png)` — consistent with inline-in-text, survives `escapeCell` (it only escapes `|` and `\n`).

## File Structure

**Create:**
- `src/webview/mediaResolve.ts` — extracted `setMediaBaseUri` + `resolveImageSrc` (shared by editor + board renderers; avoids a circular import on `editor.ts`).
- `src/webview/boardImageLinks.ts` — pure helpers: `parseImageLinks(s)` → `{alt,src}[]`, `firstImageSrc(s)` → `string|null`, `appendImageLink(value, src)`.
- `tests/boardImageLinks.test.ts` — unit tests for the helpers.
- `src/webview/boardImagePicker.ts` — small popover (Upload / Browse project / From clipboard) that appends an image link to a cell, mirroring `boardTagsPicker.ts`.

**Modify:**
- `src/webview/editor.ts` — import `setMediaBaseUri`/`resolveImageSrc` from `mediaResolve.ts` instead of defining them locally (re-export for existing callers).
- `src/webview/boardModel.ts` — add `'image'` to `FieldType` + the `parseFieldTypes` validation list.
- `src/webview/boardTableRender.ts` — add `case 'image'` to `renderCell` (thumbnails + badge + picker), and render inline thumbnails inside text/Description cells.
- `src/webview/boardKanbanRender.ts` — cover banner from first body image.
- `src/webview/styles/board.css` — thumbnail / badge / cover styles.

---

## Task 1: Shared media resolver + pure image-link helpers (TDD)

**Files:**
- Create: `src/webview/mediaResolve.ts`
- Modify: `src/webview/editor.ts`
- Create: `src/webview/boardImageLinks.ts`
- Test: `tests/boardImageLinks.test.ts`

- [ ] **Step 1: Extract the resolver into `mediaResolve.ts`**

Create `src/webview/mediaResolve.ts`:

```ts
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
```

- [ ] **Step 2: Point `editor.ts` at the shared module**

In `src/webview/editor.ts`, find the local definitions:

```ts
let _mediaBaseUri = '';

export function setMediaBaseUri(uri: string): void {
  _mediaBaseUri = uri || '';
}

// Resolve a relative image src against the document's directory so the VS Code
// webview can actually load it. Absolute URLs, data: URIs and protocol-relative
// URLs pass through untouched.
function resolveImageSrc(src: string): string {
  if (!src || !_mediaBaseUri) return src;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return src;
  try {
    return new URL(src, _mediaBaseUri).href;
  } catch {
    return src;
  }
}
```

Delete those and add an import near the other imports at the top of the file:

```ts
import { setMediaBaseUri, resolveImageSrc } from './mediaResolve';
```

`editor.ts` already re-exports `setMediaBaseUri` (it's imported by `index.ts`). Keep that working: add an explicit re-export line after the import so existing importers of `setMediaBaseUri` from `./editor` are unaffected:

```ts
export { setMediaBaseUri };
```

(If `index.ts` imports `setMediaBaseUri` from `./editor`, this re-export preserves it. `resolveImageSrc` stays used internally by `ResolvedImage`.)

- [ ] **Step 3: Write failing tests for the link helpers**

Create `tests/boardImageLinks.test.ts`:

```ts
import { parseImageLinks, firstImageSrc, appendImageLink } from '../src/webview/boardImageLinks';

describe('parseImageLinks', () => {
  it('returns [] for a string with no images', () => {
    expect(parseImageLinks('just text')).toEqual([]);
  });
  it('parses a single image link', () => {
    expect(parseImageLinks('![cat](./a.png)')).toEqual([{ alt: 'cat', src: './a.png' }]);
  });
  it('parses multiple image links in order', () => {
    expect(parseImageLinks('![](./a.png) ![b](./b.jpg)')).toEqual([
      { alt: '', src: './a.png' },
      { alt: 'b', src: './b.jpg' },
    ]);
  });
  it('parses images embedded mid-text', () => {
    expect(parseImageLinks('see ![x](./x.png) here')).toEqual([{ alt: 'x', src: './x.png' }]);
  });
});

describe('firstImageSrc', () => {
  it('returns the first image src', () => {
    expect(firstImageSrc('text ![a](./a.png) ![b](./b.png)')).toBe('./a.png');
  });
  it('returns null when there is no image', () => {
    expect(firstImageSrc('no images here')).toBeNull();
  });
});

describe('appendImageLink', () => {
  it('creates a link when the value is empty', () => {
    expect(appendImageLink('', './a.png')).toBe('![](./a.png)');
  });
  it('appends with a separating space when the value already has one', () => {
    expect(appendImageLink('![](./a.png)', './b.png')).toBe('![](./a.png) ![](./b.png)');
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx jest boardImageLinks --silent=false`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the helpers**

Create `src/webview/boardImageLinks.ts`:

```ts
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
```

- [ ] **Step 6: Run tests + type-check + build**

Run: `npx jest boardImageLinks --silent=false && npx tsc -p tsconfig.json --noEmit && npm run compile`
Expected: PASS — helper tests green, tsc clean, "Webview built." (the `mediaResolve` extraction compiles and existing `setMediaBaseUri` importers still resolve).

- [ ] **Step 7: Commit**

```bash
git add src/webview/mediaResolve.ts src/webview/editor.ts src/webview/boardImageLinks.ts tests/boardImageLinks.test.ts
git commit -m "feat(board-images): shared media resolver + pure image-link helpers"
```

---

## Task 2: Add the `image` field type to the board model (TDD)

**Files:**
- Modify: `src/webview/boardModel.ts`
- Test: `tests/board/imageField.test.ts` (new)

- [ ] **Step 1: Write a failing round-trip test**

Create `tests/board/imageField.test.ts`:

```ts
import { parseBoard, serializeBoard } from '../../src/webview/boardModel';

const SRC = [
  '<!-- board:start id="b1" name="B" columns="Todo|Done" column-colors="gray|emerald" field-types="Title=text,Status=status,Shot=image" -->',
  '',
  '| Title | Status | Shot |',
  '|---|---|---|',
  '| Card A | Todo | ![](./B.assets/a.png) |',
  '',
  '<!-- board:end -->',
].join('\n');

describe('image field type', () => {
  it('parses an image field and its cell value', () => {
    const board = parseBoard(SRC);
    const shot = board.fields.find((f) => f.name === 'Shot');
    expect(shot?.type).toBe('image');
    expect(board.cards[0].values.Shot).toBe('![](./B.assets/a.png)');
  });

  it('round-trips field-types=...,Shot=image and the cell value', () => {
    const out = serializeBoard(parseBoard(SRC));
    expect(out).toContain('Shot=image');
    expect(out).toContain('![](./B.assets/a.png)');
  });
});
```

> Note: confirm the exact exported names (`parseBoard`/`serializeBoard`) against `src/webview/boardModel.ts` before running; if they differ (e.g. `parse`/`serialize`), update the import to match.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest board/imageField --silent=false`
Expected: FAIL — `Shot` parses as `text` (image not yet a valid type), so `shot?.type` is `'text'`.

- [ ] **Step 3: Add `'image'` to the type union and parser allow-list**

In `src/webview/boardModel.ts`:

(a) The `FieldType` union (around line 5):
```ts
export type FieldType = 'text' | 'status' | 'date' | 'person' | 'tags';
```
becomes:
```ts
export type FieldType = 'text' | 'status' | 'date' | 'person' | 'tags' | 'image';
```

(b) The validation list inside `parseFieldTypes` (around line 325):
```ts
if (n && t && ['text', 'status', 'date', 'person', 'tags'].includes(t)) {
```
becomes:
```ts
if (n && t && ['text', 'status', 'date', 'person', 'tags', 'image'].includes(t)) {
```

Serialization needs no change — it writes `${f.name}=${f.type}` for every field, and `escapeCell` already preserves the `![](…)` markdown (it only escapes `|` and `\n`).

(c) **`FIELD_TYPE_ICONS` and `FIELD_TYPE_LABELS` are `Record<FieldType, string>`** in `src/webview/boardIcons.ts` — so adding `'image'` to the union makes tsc require entries in both. Add them:

In `src/webview/boardIcons.ts`, add to `FIELD_TYPE_ICONS` (before the closing `};`):
```ts
  image:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1"/>
      <circle cx="6" cy="6.5" r="1"/>
      <path d="M3 12l3.5-3.5 2.5 2.5 2-2 2 2"/>
    </svg>`,
```
and to `FIELD_TYPE_LABELS` (before its closing `};`):
```ts
  image: 'Image',
```

- [ ] **Step 4: Expose `image` in the add-column type picker**

In `src/webview/boardProperties.ts` (~line 649), the type list is:
```ts
  const types: FieldType[] = ['text', 'status', 'date', 'person', 'tags'];
```
Add `'image'`:
```ts
  const types: FieldType[] = ['text', 'status', 'date', 'person', 'tags', 'image'];
```
(The options-editing branch at ~line 282 — `if (field.type === 'status' || field.type === 'tags')` — correctly excludes `image`, which has no options. No change needed there. The default field-creation path will create an empty-valued image column, which is what we want.)

- [ ] **Step 5: Run the test + build to verify**

Run: `npx jest board/imageField --silent=false && npx tsc -p tsconfig.json --noEmit && npm run compile`
Expected: PASS — field parses as `image`, value preserved, round-trip keeps `Shot=image` + the link; tsc clean (icons/labels satisfy `Record<FieldType,string>`); build OK. The "Image" option now appears in the add-column type list.

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardModel.ts src/webview/boardIcons.ts src/webview/boardProperties.ts tests/board/imageField.test.ts
git commit -m "feat(board-images): image field type — model, icon/label, add-column option"
```

---

## Task 3: Board image-cell picker (Upload / Browse / Clipboard)

**Files:**
- Create: `src/webview/boardImagePicker.ts`

This popover is verified via build + the manual test in Task 7 (DOM/picker UI).

- [ ] **Step 1: Read the pattern to mirror**

Read `src/webview/boardTagsPicker.ts` fully to match the project's popover conventions (anchor positioning, outside-click close, `onChange(next)` mutation callback). Mirror its structure.

- [ ] **Step 2: Implement the picker**

Create `src/webview/boardImagePicker.ts`:

```ts
import { saveImageBytes, pickProjectImage, embedImageFromClipboard } from './imageUpload';
import { appendImageLink } from './boardImageLinks';

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .bd-image-picker { position: fixed; z-index: 10000; min-width: 200px;
      background: var(--bg, #fff); color: inherit; border: 1px solid var(--border, rgba(0,0,0,.12));
      border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 6px; }
    .bd-image-picker-row { display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 8px 10px; border: none; background: transparent; color: inherit;
      font: inherit; font-size: 13px; border-radius: 6px; cursor: pointer; text-align: left; }
    .bd-image-picker-row:hover { background: var(--block-hover, rgba(0,0,0,.05)); }
    .bd-image-picker-err { color: #c0392b; font-size: 12px; padding: 6px 10px; }
  `;
  document.head.appendChild(style);
}

// Opens a small menu anchored to `anchor`. When the user picks an image, calls
// onPick(src) with the resolved relative path (or URL), letting the caller
// append it to the cell value and persist.
export function openBoardImagePicker(anchor: HTMLElement, onPick: (src: string) => void): void {
  injectStyles();
  const el = document.createElement('div');
  el.className = 'bd-image-picker';
  el.innerHTML = `
    <button class="bd-image-picker-row" data-act="upload">Upload from computer</button>
    <button class="bd-image-picker-row" data-act="browse">Browse project</button>
    <button class="bd-image-picker-row" data-act="clipboard">From clipboard</button>
  `;
  document.body.appendChild(el);

  const rect = anchor.getBoundingClientRect();
  el.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
  el.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 160)}px`;

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
    err.className = 'bd-image-picker-err';
    err.textContent = msg;
    el.appendChild(err);
  }

  el.querySelector('[data-act="upload"]')!.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    el.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try { finish(await saveImageBytes(file.name, await file.arrayBuffer())); }
      catch (err) { showError((err as Error).message); }
    });
    input.click();
  });
  el.querySelector('[data-act="browse"]')!.addEventListener('click', async () => {
    try { const src = await pickProjectImage(); if (src) finish(src); else finish(); }
    catch (err) { showError((err as Error).message); }
  });
  el.querySelector('[data-act="clipboard"]')!.addEventListener('click', async () => {
    try { finish(await embedImageFromClipboard()); }
    catch (err) { showError((err as Error).message); }
  });

  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc -p tsconfig.json --noEmit && npm run compile`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/webview/boardImagePicker.ts
git commit -m "feat(board-images): board image-cell picker (upload/browse/clipboard)"
```

---

## Task 4: Render the image field cell (thumbnails + badge + edit)

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `src/webview/styles/board.css`

UI — verified via build + Task 7.

- [ ] **Step 1: Add imports to `boardTableRender.ts`**

At the top of `src/webview/boardTableRender.ts`, add:

```ts
import { resolveImageSrc } from './mediaResolve';
import { parseImageLinks, appendImageLink } from './boardImageLinks';
import { openBoardImagePicker } from './boardImagePicker';
```

- [ ] **Step 2: Add the `image` case to `renderCell`**

In `renderCell`'s `switch (field.type)`, add a new case (place it alongside the others, before `default`). `value` is `card.values[field.name]`; `ctx.mutate` and `ctx.readonly` follow the existing date/tags pattern. Use the same mutation shape as the date case:

```ts
    case 'image': {
      const links = parseImageLinks(value);
      td.classList.add('bd-image-cell');
      if (!links.length) {
        const empty = document.createElement('span');
        empty.className = 'bd-cell-empty';
        empty.textContent = ctx.readonly ? '' : '🖼';
        td.appendChild(empty);
      } else {
        const thumb = document.createElement('img');
        thumb.className = 'bd-image-thumb';
        thumb.src = resolveImageSrc(links[0].src);
        thumb.alt = links[0].alt;
        td.appendChild(thumb);
        if (links.length > 1) {
          const badge = document.createElement('span');
          badge.className = 'bd-image-badge';
          badge.textContent = `+${links.length - 1}`;
          td.appendChild(badge);
        }
      }
      if (!ctx.readonly) {
        td.addEventListener('click', (e) => {
          e.stopPropagation();
          openBoardImagePicker(td, (src) => {
            const next = appendImageLink(value, src);
            ctx.mutate({
              ...ctx.getBoard(),
              cards: ctx.getBoard().cards.map((c) =>
                c.id === card.id ? { ...c, values: { ...c.values, [field.name]: next } } : c,
              ),
            });
          });
        });
      }
      return;
    }
```

> Adapt `ctx.getBoard()` / `ctx.mutate(...)` to the exact ctx API used by the date/tags cases in this file (the explore noted the mutate pattern reads the current board then maps cards — match whatever the sibling cases do, e.g. they may capture `cur` from a passed-in board). The shape `{...board, cards: board.cards.map(...)}` is the established pattern.

- [ ] **Step 3: Add CSS**

Append to `src/webview/styles/board.css`:

```css
/* Image field cell */
.bd-image-cell { cursor: pointer; }
.bd-image-thumb {
  height: 28px; max-width: 64px; object-fit: cover;
  border-radius: 4px; vertical-align: middle; border: 1px solid var(--border);
}
.bd-image-badge {
  display: inline-block; margin-left: 6px; padding: 1px 6px;
  font-size: 11px; border-radius: 10px;
  background: var(--block-hover); color: var(--text-secondary); vertical-align: middle;
}
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc -p tsconfig.json --noEmit && npm run compile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardTableRender.ts src/webview/styles/board.css
git commit -m "feat(board-images): image field cell — thumbnail, +N badge, click to add"
```

---

## Task 5: Inline image thumbnails inside text / Description cells

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Find the text/Description rendering**

In `renderCell`, the `text`/`person` case currently sets `td.textContent = value`. The Description column renders a truncated `card.body` preview. Both should show a small inline thumbnail when the string contains `![](…)` links, with the surrounding text kept as text.

- [ ] **Step 2: Add a shared inline renderer**

Add this helper near the top of `boardTableRender.ts` (after imports):

```ts
// Render a cell/preview string into `host`, turning ![alt](src) links into small
// inline thumbnails and leaving the rest as text. Returns true if any image was
// rendered (so callers can decide whether to keep plain-text fast paths).
function renderInlineWithImages(host: HTMLElement, value: string): boolean {
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let last = 0;
  let found = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) host.appendChild(document.createTextNode(value.slice(last, m.index)));
    const img = document.createElement('img');
    img.className = 'bd-inline-thumb';
    img.src = resolveImageSrc(m[2].trim());
    img.alt = m[1];
    host.appendChild(img);
    found = true;
    last = m.index + m[0].length;
  }
  if (last < value.length) host.appendChild(document.createTextNode(value.slice(last)));
  return found;
}
```

- [ ] **Step 3: Use it in the text/person case**

Replace the text/person body that does `td.textContent = value;` with:

```ts
    case 'text':
    case 'person':
      if (value.includes('![')) {
        renderInlineWithImages(td, value);
      } else {
        td.textContent = value;
      }
      if (!ctx.readonly) {
        td.addEventListener('click', () => beginInlineText(td, card, field, ctx));
      }
      return;
```

(Keep the existing `beginInlineText` wiring exactly as it currently is — only the display line changes. Inline edit still edits the raw markdown text.)

- [ ] **Step 4: Use it in the Description preview**

Where the Description column builds its truncated `card.body` preview as text, route the preview string through `renderInlineWithImages` when it contains `![`. (Match the existing Description code: if it sets `textContent`, swap to `renderInlineWithImages(host, preview)` guarded by `preview.includes('![')`.)

- [ ] **Step 5: CSS**

Append to `src/webview/styles/board.css`:

```css
.bd-inline-thumb {
  height: 20px; max-width: 40px; object-fit: cover;
  border-radius: 3px; vertical-align: text-bottom; margin: 0 2px;
  border: 1px solid var(--border);
}
```

- [ ] **Step 6: Type-check + build, then commit**

Run: `npx tsc -p tsconfig.json --noEmit && npm run compile`
Expected: PASS.

```bash
git add src/webview/boardTableRender.ts src/webview/styles/board.css
git commit -m "feat(board-images): inline image thumbnails in text/description cells"
```

---

## Task 6: Kanban card cover from the first body image

**Files:**
- Modify: `src/webview/boardKanbanRender.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Imports**

At the top of `src/webview/boardKanbanRender.ts`, add:

```ts
import { resolveImageSrc } from './mediaResolve';
import { firstImageSrc } from './boardImageLinks';
```

- [ ] **Step 2: Insert the cover before the title in `renderCard`**

In `renderCard`, right after the card element is created and before the title is appended:

```ts
  const coverSrc = firstImageSrc(card.body);
  if (coverSrc) {
    const cover = document.createElement('img');
    cover.className = 'board-card-cover';
    cover.src = resolveImageSrc(coverSrc);
    cover.alt = '';
    el.appendChild(cover);
  }
```

(If the body preview later also renders that same image inline, that's acceptable — the cover is the banner; the preview text still shows. If you want to avoid duplication, the body preview already truncates; leave as-is for this task.)

- [ ] **Step 3: CSS**

Append to `src/webview/styles/board.css`:

```css
.board-card-cover {
  display: block; width: 100%; height: 96px; object-fit: cover;
  border-radius: 6px 6px 0 0; margin: -2px 0 8px; /* bleed to card edges */
}
```

(Adjust the negative margin to match the card's existing padding so the cover sits flush at the top — check `.board-card` padding in `board.css` and align.)

- [ ] **Step 4: Type-check + build, then commit**

Run: `npx tsc -p tsconfig.json --noEmit && npm run compile`
Expected: PASS.

```bash
git add src/webview/boardKanbanRender.ts src/webview/styles/board.css
git commit -m "feat(board-images): kanban card cover from first body image"
```

---

## Task 7: Full gate + manual verification

- [ ] **Step 1: Full test + build**

Run: `npm test && npm run compile`
Expected: the new `boardImageLinks` and `board/imageField` suites pass; all previously-passing suites pass. KNOWN pre-existing failures (not from this work): `tests/toggle.test.ts` (ts-jest type-check) and possibly `tests/board/grouping.test.ts` (separate c12 work). Confirm no NEW failures.

- [ ] **Step 2: Manual verification (F5 host)**

Open a board document (use a folder/saved `.md`). Then:
- **Image field (A):** add a column, set its type to `image` (via field-types or the column menu if the UI exposes it — otherwise edit the `field-types` attribute in source to `…,Shot=image`). Click the cell → picker → Upload/Browse/Clipboard → a thumbnail appears; add a second → "+N" badge shows. Reopen the file → images persist.
- **Inline (B):** put `![](./Note.assets/x.png)` inside a text cell or a card description → a small inline thumbnail renders among the text.
- **Cover (C):** add an image to a card's body → switch to kanban → the card shows a cover banner from that first image.
- **Round-trip:** close + reopen → everything survives (relies on the already-fixed parse bug).

- [ ] **Step 3: Report** each with evidence. If anything fails, use `superpowers:systematic-debugging`.

---

## Self-Review notes

- **Spec coverage:** A = Task 2 (model) + Task 3 (picker) + Task 4 (cell render, multiple + "+N"). B = Task 5 (inline thumbnails in text/Description). C = Task 6 (cover from first body image). Shared resolver/helpers = Task 1.
- **Round-trip safety:** image cells store `![](src)` markdown, which `escapeCell` preserves (only `|`/`\n` escaped); the board parse bug that previously dropped boards is already fixed on main.
- **Raw-DOM resolution:** board `<img>` get `resolveImageSrc` applied manually (the editor's `ResolvedImage` only covers TipTap nodes).
- **Open adaptation points flagged for the implementer:** exact `parseBoard`/`serializeBoard` export names, the precise `ctx` mutate API in `boardTableRender.ts`, and the Description-preview code path — match the existing sibling cases.
- **Deferred:** a column-header UI to *set* a field's type to image (if not already present) may need a follow-up; this plan stores/parses/renders the type and can be driven from the `field-types` attribute. Confirm during Task 7 whether the existing "add column" flow lets you choose `image`; if not, note a follow-up.
