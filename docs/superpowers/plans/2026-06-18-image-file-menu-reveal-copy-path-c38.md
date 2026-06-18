# Image File Menu (Reveal + Copy Path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the image bubble menu's folder button into a "Turn into"-style drill-down offering **Reveal in Finder** and a new **Copy path** (absolute filesystem path to the clipboard).

**Architecture:** The webview swaps the menu contents in place (back row + list), reusing the existing `.block-picker-back` and `.bm-into-item` chrome. "Copy path" round-trips to the extension host, which resolves the asset's absolute path and writes it to the VS Code clipboard — mirroring the existing `revealImage` handler.

**Tech Stack:** TypeScript, TipTap/ProseMirror bubble-menu plugin (webview), VS Code extension host API (`vscode.env.clipboard`, `vscode.window`).

## Global Constraints

- Actions target the **image's own file**, never the `.md` document. (spec)
- "Copy path" copies the **absolute filesystem path** (`Uri.fsPath`), e.g. `/Users/aviran/AI Projects Aviran/MD viewer mscode/demo-tester.assets/x.png`. (spec)
- Remote/data-URL images (`https:` / `data:`) make both items no-op — no new disabled styling. (spec)
- Only one drill-down view is visible at a time; opening File closes Replace and vice-versa. (spec — floating panels must not overlap)
- This codebase has **no unit-test harness for the extension host (`mdEditorPlusProvider.ts`) or for webview DOM** — the existing image actions (reveal/compress) have no unit tests. Verification for this feature is **manual, in the real app**, consistent with that. Do not fabricate unit tests that cannot run.

---

### Task 1: Copy-path round-trip plumbing (host handler + webview bridge)

Adds the `copyImagePath` message both ends understand. No UI yet — this task delivers the transport that Task 2 wires a button to.

**Files:**
- Modify: `src/mdEditorPlusProvider.ts` (add a `copyImagePath` message handler next to the existing `revealImage` handler near line 608-631)
- Modify: `src/webview/imageUpload.ts` (add a response-listener case near line 42-45 and an exported `copyImagePath` function near line 105-108)

**Interfaces:**
- Produces (webview): `copyImagePath(relPath: string): Promise<void>` — exported from `src/webview/imageUpload.ts`. Resolves when the host confirms, rejects on host error.
- Produces (host): handles inbound `{ type: 'copyImagePath', requestId, relPath }`, replies `{ type: 'imagePathCopied', requestId, ok?: true, error?: string }`.

- [ ] **Step 1: Add the host `copyImagePath` handler**

In `src/mdEditorPlusProvider.ts`, immediately after the closing `}` of the `if (msg.type === 'revealImage') { … }` block (the one ending around line 631), add:

```ts
      if (msg.type === 'copyImagePath') {
        const m = msg as unknown as { requestId?: unknown; relPath?: unknown };
        const requestId = typeof m.requestId === 'string' ? m.requestId : '';
        const reply = (extra: Record<string, unknown>) =>
          void webviewPanel.webview.postMessage({ type: 'imagePathCopied', requestId, ...extra });
        if (!requestId || typeof m.relPath !== 'string') {
          reply({ error: 'bad copyImagePath request' });
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
          await vscode.env.clipboard.writeText(target.fsPath);
          void vscode.window.showInformationMessage('Copied image path');
          reply({ ok: true });
        } catch (err) {
          reply({ error: (err as Error).message });
        }
        return;
      }
```

- [ ] **Step 2: Add the webview response-listener case**

In `src/webview/imageUpload.ts`, inside `ensureListener()`, after the `} else if (msg.type === 'imageRevealed') { … }` branch (ends ~line 45), add a new branch:

```ts
    } else if (msg.type === 'imagePathCopied') {
      pending.delete(msg.requestId);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve('');
    }
```

(Place it before the `imageBytesRead` branch or after `imageRevealed` — anywhere in the `else if` chain is fine, as long as it's a sibling branch.)

- [ ] **Step 3: Add the exported `copyImagePath` bridge function**

In `src/webview/imageUpload.ts`, directly after the existing `revealImage` function (ends ~line 108), add:

```ts
// Ask the extension to copy the asset's ABSOLUTE filesystem path to the clipboard.
export function copyImagePath(relPath: string): Promise<void> {
  return request({ type: 'copyImagePath', relPath }).then(() => undefined);
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors. (A pre-existing `toggle.ts` type-check failure may surface — that is unrelated to this change; see project memory. No new errors should reference `mdEditorPlusProvider.ts` or `imageUpload.ts`.)

- [ ] **Step 5: Commit**

```bash
git add src/mdEditorPlusProvider.ts src/webview/imageUpload.ts
git commit -m "feat(c38): add copyImagePath round-trip (host clipboard + webview bridge)"
```

---

### Task 2: Folder button → swap-in-place File drill-down

Replaces the standalone Reveal button with a `File` drill-down that swaps the menu contents (back row + Reveal in Finder + Copy path), reusing Task 1's `copyImagePath`.

**Files:**
- Modify: `src/webview/imageBubbleMenu.ts` (icon map ~line 23-32; `buildEl()` ~line 41-65; `createImageBubbleMenu` body, helpers and click handler ~line 73-258)
- Modify: `src/webview/styles/editor.css` (add view-toggle + file-view rules near the image-menu styles, ~after line 1664)

**Interfaces:**
- Consumes: `copyImagePath(relPath: string): Promise<void>` from `src/webview/imageUpload.ts` (Task 1).

- [ ] **Step 1: Add the `copy` icon**

In `src/webview/imageBubbleMenu.ts`, inside the `ICON` object (after the `compress` entry, before the closing `} as const;` ~line 31), add:

```ts
  // Overlapping pages = copy.
  copy:      `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg>`,
```

- [ ] **Step 2: Import `copyImagePath`**

In `src/webview/imageBubbleMenu.ts`, extend the existing import from `./imageUpload` (line 12-18) to include `copyImagePath`:

```ts
import {
  saveImageBytes,
  pickProjectImage,
  embedImageFromClipboard,
  revealImage,
  readImageBytes,
  copyImagePath,
} from './imageUpload';
```

- [ ] **Step 3: Restructure `buildEl()` markup**

In `src/webview/imageBubbleMenu.ts`, replace the entire `el.innerHTML = \`…\`;` assignment inside `buildEl()` (currently lines 44-62) with this. It wraps the existing rows in a `.bm-default` view, renames the folder button's action from `reveal` to `file`, and adds a sibling `.bm-file-view`:

```ts
  el.innerHTML = `
    <div class="bm-default">
      <div class="bubble-row">
        <button class="bm-btn" data-action="replace" data-tip="Replace image">${ICON.swap}</button>
        <button class="bm-btn" data-action="compress" data-tip="Compress (smaller file)">${ICON.compress}</button>
        <button class="bm-btn" data-action="file" data-tip="Image file">${ICON.folder}</button>
        <button class="bm-btn" data-action="remove" data-tip="Remove image">${ICON.trash}</button>
      </div>
      <div class="bubble-row">
        ${sizeButtonsHtml()}
      </div>
      <div class="bubble-into hidden" id="img-replace">
        <div class="bubble-into-title">Replace with</div>
        <div class="bubble-into-list">
          <button class="bm-into-item" data-replace="upload"><span class="bm-into-icon">${ICON.upload}</span><span class="bm-into-label">Upload from computer</span></button>
          <button class="bm-into-item" data-replace="browse"><span class="bm-into-icon">${ICON.folder}</span><span class="bm-into-label">Browse project</span></button>
          <button class="bm-into-item" data-replace="clipboard"><span class="bm-into-icon">${ICON.clipboard}</span><span class="bm-into-label">From clipboard</span></button>
        </div>
      </div>
    </div>
    <div class="bm-file-view hidden">
      <button class="block-picker-back" data-action="file-back">
        <span class="block-picker-back-icon">‹</span><span class="block-picker-back-label">Image file</span>
      </button>
      <button class="bm-into-item" data-file="reveal"><span class="bm-into-icon">${ICON.folder}</span><span class="bm-into-label">Reveal in Finder</span></button>
      <button class="bm-into-item" data-file="copy"><span class="bm-into-icon">${ICON.copy}</span><span class="bm-into-label">Copy path</span></button>
    </div>
  `;
```

- [ ] **Step 4: Add view-toggle helpers**

In `src/webview/imageBubbleMenu.ts`, inside `createImageBubbleMenu`, just after the existing `const compressBtn = …` line (~line 77) add cached view refs:

```ts
  const defaultView = el.querySelector<HTMLElement>('.bm-default')!;
  const fileView = el.querySelector<HTMLElement>('.bm-file-view')!;
```

Then, replace the existing `closeReplace` function (lines 121-124) with `closeReplace` plus two view helpers:

```ts
  function closeReplace(): void {
    replacePanel.classList.add('hidden');
    replaceBtn.classList.remove('active');
  }

  // Show the normal icon menu (also collapses the Replace panel + File view).
  function showDefault(): void {
    fileView.classList.add('hidden');
    defaultView.classList.remove('hidden');
    closeReplace();
  }

  // Swap the menu in place for the File drill-down (mutually exclusive with Replace).
  function showFileView(): void {
    closeReplace();
    defaultView.classList.add('hidden');
    fileView.classList.remove('hidden');
  }
```

- [ ] **Step 5: Add the `copyPath` action**

In `src/webview/imageBubbleMenu.ts`, directly after the existing `reveal()` function (ends ~line 196), add:

```ts
  async function copyPath(): Promise<void> {
    const pos = selectedImagePos();
    if (pos == null) return;
    const src = (editor.state.doc.nodeAt(pos)?.attrs.src as string) || '';
    if (!src || /^(?:https?:|data:)/i.test(src)) return; // local assets only
    await copyImagePath(src);
  }
```

- [ ] **Step 6: Handle File-view item clicks**

In the `el.addEventListener('click', …)` handler, add a `data-file` branch right after the existing `replaceItem` branch (after the `if (replaceItem) { … return; }` block ~line 227):

```ts
    const fileItem = target.closest<HTMLElement>('[data-file]');
    if (fileItem) {
      e.stopPropagation();
      if (fileItem.dataset.file === 'reveal') reveal();
      else if (fileItem.dataset.file === 'copy') void copyPath();
      showDefault();
      return;
    }
```

- [ ] **Step 7: Rewire the action switch (replace `reveal` with `file` / `file-back`)**

In the same click handler's `switch (btn.dataset.action)` block (~lines 240-250), replace the `case 'reveal':` line with the two File cases. The block becomes:

```ts
    switch (btn.dataset.action) {
      case 'replace': {
        const open = !replacePanel.classList.contains('hidden');
        if (open) closeReplace();
        else { replacePanel.classList.remove('hidden'); replaceBtn.classList.add('active'); }
        break;
      }
      case 'compress':  closeReplace(); void compress(); break;
      case 'file':      showFileView(); break;
      case 'file-back': showDefault(); break;
      case 'remove':    closeReplace(); remove(); break;
    }
```

- [ ] **Step 8: Reset to default view on deselect**

In the `editor.on('transaction', …)` handler at the bottom (~line 254-257), replace the `closeReplace()` call in the deselect branch with `showDefault()`:

```ts
  editor.on('transaction', () => {
    if (selectedImagePos() == null) { showDefault(); tipSrc = ''; }
    else void refreshCompressTip();
  });
```

- [ ] **Step 9: Add the CSS for the view toggle + file view**

In `src/webview/styles/editor.css`, after the `#img-replace { … }` rule (ends ~line 1664), add:

```css
/* Image menu view toggle — the folder button swaps the menu in place
   (back row + list) like "Turn into", instead of a second floating panel. */
.bm-default.hidden,
.bm-file-view.hidden { display: none; }

.bm-file-view {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 200px;
}
.bm-file-view .bm-into-item { width: 100%; }
```

- [ ] **Step 10: Type-check + build the webview bundle**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors referencing `imageBubbleMenu.ts` (the pre-existing `toggle.ts` failure, if present, is unrelated).

Then build so the change is loadable in the extension host:
Run: `npm run compile` (or the project's webview build script — check `package.json` `scripts`)
Expected: build succeeds.

- [ ] **Step 11: Manual verification in the real app**

Launch the extension (Run Extension / F5) and open a saved `.md` with a local body image, then confirm:
1. Select the image → bubble menu shows `Replace · Compress · 📁 · Remove` over the size row.
2. Click 📁 → the menu **swaps in place** to `‹ Image file`, **Reveal in Finder**, **Copy path** (no second floating panel).
3. **Reveal in Finder** opens Finder at the asset (unchanged behavior) and returns to the default menu.
4. **Copy path** → an info toast "Copied image path" appears; paste into a text field → it's the **absolute path** ending in `…/<doc>.assets/<file>`.
5. **‹ Image file** returns to the full menu.
6. Open **Replace**, then open **File** → Replace panel closes (never both at once); and vice-versa.
7. With a remote image (`https://…` src), **Reveal** and **Copy path** do nothing (no crash, no toast).

- [ ] **Step 12: Commit**

```bash
git add src/webview/imageBubbleMenu.ts src/webview/styles/editor.css
git commit -m "feat(c38): image folder button becomes Reveal/Copy-path drill-down"
```

---

## Self-Review

- **Spec coverage:**
  - Drill-down swap-in-place with back row → Task 2 Steps 3-4, 6-7, 9. ✓
  - Reveal in Finder retained → Task 2 Step 6 (`reveal()`). ✓
  - Copy path = absolute fsPath via host clipboard + toast → Task 1 Step 1; Task 2 Step 5. ✓
  - Mutual exclusion (one view at a time) → Task 2 Step 4 (`showDefault`/`showFileView` collapse the other), Step 7. ✓
  - Remote/data-URL no-op → Task 2 Step 5 guard (`/^(?:https?:|data:)/i`); reveal already guards. ✓
  - Unsaved doc → host replies "save the file first" → Task 1 Step 1. ✓
  - Verification manual → Task 2 Step 11. ✓
- **Placeholder scan:** No TBD/TODO; every code step shows full code. ✓
- **Type consistency:** `copyImagePath(relPath: string): Promise<void>` defined in Task 1 Step 3, consumed in Task 2 Steps 2 & 5. Host message type `copyImagePath` / response `imagePathCopied` consistent across Task 1 Steps 1-2. View helpers `showDefault`/`showFileView`/`closeReplace` used consistently in Task 2 Steps 4, 6, 7, 8. ✓
