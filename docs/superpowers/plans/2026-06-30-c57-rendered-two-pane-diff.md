# Rendered Two-Pane Diff (c57) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace VS Code's native plain-text full-diff with two read-only rendered editor panes (base vs current), block-level tint, filler alignment, and a shared click-to-jump change rail.

**Architecture:** A new `WebviewPanel` (the "diff pane") hosts a second, lighter webview bundle that mounts two read-only TipTap editors side by side. A pure alignment function (reusing the existing LCS) pairs base/current blocks into aligned rows; a decoration layer tints changed blocks and inserts filler spacers so paired blocks line up; a shared rail (reusing c55 diff marks) scrolls both panes together.

**Tech Stack:** TypeScript, TipTap/ProseMirror, esbuild (IIFE webview bundles), Jest + ts-jest, VS Code extension API.

## Global Constraints

- **Read-only:** Both diff panes are non-editable. The diff never dispatches a content mutation, never posts an `edit`/`save` message, and never marks the source document modified (the c56 trap).
- **Synthetic content:** The diff pane holds its own base/current markdown strings; it never opens `document.uri` (the c54 trap — the `*.md` custom editor would reclaim the pane).
- **Identical normalization:** Base and current blocks are produced by the same parse→serialize path (the c55 gotcha — un-normalized markdown yields false marks).
- **DRY:** Reuse `lineOps` (`src/webview/conflictDiff.ts`), `resolveDiffBase` (`src/diffBase.ts`), and the editor extension set. Do not re-implement diffing, base resolution, or the editor.
- **Docs before push:** Update `README.md` and `CHANGELOG.md` (Added → Changed → Fixed order) before any push or version bump.
- **CHANGELOG section order:** Always Added → Changed → Fixed within a version block.

---

## File Structure

- **Create** `src/webview/diffAlign.ts` — pure alignment: op list → aligned rows. No DOM.
- **Create** `tests/diffAlign.test.ts` — unit tests for the above.
- **Create** `src/webview/diffPane.ts` — diff webview entry point (second bundle). Mounts two read-only editors, applies decorations, builds the rail.
- **Create** `src/diffPaneView.ts` — extension-side host: builds the diff `WebviewPanel`, its HTML, and message wiring.
- **Modify** `src/webview/editor.ts` — extract the inline extension array into a shared builder; add an exported `createDiffEditor(element, markdown)` that builds a read-only editor without touching the module singletons.
- **Modify** `src/diffViewer.ts` — `openFullDiff` delegates to the new diff pane instead of `vscode.diff`.
- **Modify** `esbuild.config.js` — add `src/webview/diffPane.ts` as a second entry → `dist/diffPane.js`.
- **Modify** `src/webview/styles/editor.css` (or a new `diff.css` imported by `diffPane.ts`) — tint, filler, rail, and two-pane layout styles.
- **Modify** `README.md`, `CHANGELOG.md` — document the feature.

---

## Task 1: Pure alignment mapping

**Files:**
- Create: `src/webview/diffAlign.ts`
- Test: `tests/diffAlign.test.ts`

**Interfaces:**
- Consumes: `lineOps(a: string[], b: string[]): Op[]` from `./conflictDiff` (already exists; `Op = { t: 'eq'|'del'|'add'; a?: string; b?: string }`).
- Produces:
  - `type AlignKind = 'eq' | 'change' | 'add' | 'del'`
  - `interface AlignRow { kind: AlignKind; left: number | null; right: number | null }`
  - `function computeAlignment(baseBlocks: string[], currentBlocks: string[]): AlignRow[]`
  - `left`/`right` are indices into `baseBlocks`/`currentBlocks`; `null` means that side has no block for the row.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/diffAlign.test.ts
import { computeAlignment } from '../src/webview/diffAlign';

describe('computeAlignment', () => {
  it('marks identical blocks as eq rows with paired indices', () => {
    expect(computeAlignment(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([
      { kind: 'eq', left: 0, right: 0 },
      { kind: 'eq', left: 1, right: 1 },
      { kind: 'eq', left: 2, right: 2 },
    ]);
  });

  it('pairs a single replaced block as one change row', () => {
    expect(computeAlignment(['a', 'B', 'c'], ['a', 'X', 'c'])).toEqual([
      { kind: 'eq', left: 0, right: 0 },
      { kind: 'change', left: 1, right: 1 },
      { kind: 'eq', left: 2, right: 2 },
    ]);
  });

  it('marks a current-only block as add (left null)', () => {
    expect(computeAlignment(['a', 'c'], ['a', 'b', 'c'])).toEqual([
      { kind: 'eq', left: 0, right: 0 },
      { kind: 'add', left: null, right: 1 },
      { kind: 'eq', left: 1, right: 2 },
    ]);
  });

  it('marks a base-only block as del (right null)', () => {
    expect(computeAlignment(['a', 'b', 'c'], ['a', 'c'])).toEqual([
      { kind: 'eq', left: 0, right: 0 },
      { kind: 'del', left: 1, right: null },
      { kind: 'eq', left: 1, right: 1 },
    ]);
  });

  it('pairs the overlap of an uneven hunk, then emits the remainder', () => {
    // 2 dels vs 1 add: one pairs as change, one is a pure del
    expect(computeAlignment(['B', 'D'], ['X'])).toEqual([
      { kind: 'change', left: 0, right: 0 },
      { kind: 'del', left: 1, right: null },
    ]);
  });

  it('returns an empty array for two empty inputs', () => {
    expect(computeAlignment([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/diffAlign.test.ts`
Expected: FAIL — "Cannot find module '../src/webview/diffAlign'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/webview/diffAlign.ts
// Pure: turns base + current block arrays into aligned two-pane rows.
// Reuses the LCS from conflictDiff. No DOM, no editor.
import { lineOps } from './conflictDiff';

export type AlignKind = 'eq' | 'change' | 'add' | 'del';
export interface AlignRow {
  kind: AlignKind;
  left: number | null;  // index into baseBlocks
  right: number | null; // index into currentBlocks
}

export function computeAlignment(baseBlocks: string[], currentBlocks: string[]): AlignRow[] {
  const ops = lineOps(baseBlocks, currentBlocks);
  const rows: AlignRow[] = [];
  let li = 0; // base index
  let ri = 0; // current index
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === 'eq') {
      rows.push({ kind: 'eq', left: li, right: ri });
      li++; ri++; k++;
      continue;
    }
    // Gather one hunk of consecutive non-eq ops, counting dels and adds.
    const delStart = li;
    const addStart = ri;
    let dels = 0, adds = 0;
    while (k < ops.length && ops[k].t !== 'eq') {
      if (ops[k].t === 'del') dels++;
      else adds++;
      k++;
    }
    // Pair the overlap positionally: first N read as "changed" (both sides),
    // the remainder is a pure add or pure del. Matches computeConflictDiff.
    const paired = Math.min(dels, adds);
    for (let p = 0; p < paired; p++) rows.push({ kind: 'change', left: delStart + p, right: addStart + p });
    for (let p = paired; p < dels; p++) rows.push({ kind: 'del', left: delStart + p, right: null });
    for (let p = paired; p < adds; p++) rows.push({ kind: 'add', left: null, right: addStart + p });
    li = delStart + dels;
    ri = addStart + adds;
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/diffAlign.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/diffAlign.ts tests/diffAlign.test.ts
git commit -m "feat(c57): pure two-pane block alignment from LCS"
```

---

## Task 2: Read-only diff editor factory

**Files:**
- Modify: `src/webview/editor.ts`

**Interfaces:**
- Produces: `export function createDiffEditor(element: HTMLElement, markdown: string): Editor` — builds a fully-rendered, **read-only** TipTap editor with the same extensions as the main editor, WITHOUT assigning the module singletons (`_editor`, `_editDebounce`, `_frontmatter`). Safe to call twice (one per pane).

- [ ] **Step 1: Extract the shared extension list**

In `src/webview/editor.ts`, the `buildRichEditor` function constructs `new Editor({ extensions: [ ... ], ... })` with a large inline array. Extract that array into a module-level helper so both the main editor and the diff editor share it (DRY):

```typescript
// Add near the top of editor.ts, after the extension imports.
// Returns the shared extension set. `suppressEmptyPlaceholder` drops the
// generic empty hint (used by the board card panel, c50). The diff panes
// also suppress it — an empty base side should look empty, not prompt.
function editorExtensions(options?: { suppressEmptyPlaceholder?: boolean }) {
  return [
    // ↓ MOVE the existing inline array from buildRichEditor verbatim here,
    //   including the trailing:
    //   ...(options?.suppressEmptyPlaceholder ? [] : [EmptyPlaceholder]),
  ];
}
```

Then in `buildRichEditor`, replace the inline `extensions: [ ... ]` with:

```typescript
    extensions: editorExtensions(options),
```

- [ ] **Step 2: Add the read-only diff editor factory**

Append to `editor.ts`:

```typescript
// Build a standalone, read-only editor for ONE diff pane. Does NOT touch the
// module singletons (_editor/_editDebounce/_frontmatter) — the diff renders two
// of these and must not hijack the main editor's state. Read-only sidesteps the
// whole save/dirty family (c56, c28, c37); the diff never writes.
export function createDiffEditor(element: HTMLElement, markdown: string): Editor {
  const split = splitFrontmatter(markdown);
  let body: string;
  try {
    body = preprocessMarkdownBoards(preprocessMarkdownCallouts(split.body));
  } catch {
    body = split.body;
  }
  return new Editor({
    element,
    editable: false,
    extensions: editorExtensions({ suppressEmptyPlaceholder: true }),
    content: body,
  });
}
```

(`splitFrontmatter`, `preprocessMarkdownBoards`, `preprocessMarkdownCallouts`, and `Editor` are already imported at the top of `editor.ts`.)

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify existing tests still pass**

Run: `npx jest tests/`
Expected: same baseline as before this task (no new failures introduced; pre-existing suite failures noted in project memory are unrelated).

- [ ] **Step 5: Commit**

```bash
git add src/webview/editor.ts
git commit -m "feat(c57): read-only createDiffEditor + shared extension builder"
```

---

## Task 3: Second webview bundle + diff pane skeleton

**Files:**
- Create: `src/webview/diffPane.ts`
- Modify: `esbuild.config.js`

**Interfaces:**
- Produces: a built `dist/diffPane.js` IIFE bundle. On `window` message `{ type: 'init', base, baseLabel, current }` it mounts two read-only editors into `#diff-left` and `#diff-right`. Posts `{ type: 'ready' }` on load.

- [ ] **Step 1: Add the second esbuild entry**

In `esbuild.config.js`, change the single context into two builds. Replace the `esbuild.context({...})` block with:

```javascript
async function buildOne(entry, outfile) {
  const ctx = await esbuild.context({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: 'iife',
    platform: 'browser',
    sourcemap: true,
    loader: { '.css': 'text' },
  });
  if (watch) { await ctx.watch(); }
  else { await ctx.rebuild(); await ctx.dispose(); }
  return ctx;
}

async function main() {
  await buildOne('src/webview/index.ts', 'dist/webview.js');
  await buildOne('src/webview/diffPane.ts', 'dist/diffPane.js');
  console.log(watch ? 'Watching webview + diff pane...' : 'Webview + diff pane built.');
}
```

- [ ] **Step 2: Write the diff pane skeleton**

```typescript
// src/webview/diffPane.ts
import editorCss from './styles/editor.css';
import lightCss from './styles/notion-light.css';
import darkCss from './styles/notion-dark.css';
import boardCss from './styles/board.css';
import { createDiffEditor } from './editor';
import type { Editor } from '@tiptap/core';

interface InitMsg { type: 'init'; base: string; baseLabel: string; current: string; }

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

let leftEditor: Editor | null = null;
let rightEditor: Editor | null = null;

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = `${lightCss}\n${darkCss}\n${editorCss}\n${boardCss}`;
  document.head.appendChild(style);
}

function mount(msg: InitMsg): void {
  const leftEl = document.getElementById('diff-left')!;
  const rightEl = document.getElementById('diff-right')!;
  leftEditor?.destroy();
  rightEditor?.destroy();
  leftEditor = createDiffEditor(leftEl, msg.base);
  rightEditor = createDiffEditor(rightEl, msg.current);
  const leftLabel = document.getElementById('diff-left-label');
  if (leftLabel) leftLabel.textContent = msg.baseLabel;
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as InitMsg;
  if (msg?.type === 'init') mount(msg);
});

injectStyles();
vscode.postMessage({ type: 'ready' });
```

- [ ] **Step 3: Build to verify the bundle compiles**

Run: `node esbuild.config.js`
Expected: prints "Webview + diff pane built." and `dist/diffPane.js` exists (`ls dist/diffPane.js`).

- [ ] **Step 4: Commit**

```bash
git add esbuild.config.js src/webview/diffPane.ts
git commit -m "feat(c57): diff pane webview bundle + skeleton mount"
```

---

## Task 4: Diff panel host + rewire openFullDiff

**Files:**
- Create: `src/diffPaneView.ts`
- Modify: `src/diffViewer.ts`

**Interfaces:**
- Consumes: `resolveDiffBase` and `resolveCurrentSide` from `./diffBase` (already used by `diffViewer.ts`); `getGitApi`-resolved base.
- Produces: `export async function openRenderedDiff(context: vscode.ExtensionContext, document: vscode.TextDocument, base: { content: string; label: string }, current: string): Promise<void>` — creates/reveals a `WebviewPanel` beside the active editor and posts the `init` message once the pane reports `ready`.

- [ ] **Step 1: Write the diff panel host**

```typescript
// src/diffPaneView.ts
import * as vscode from 'vscode';

function nonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function html(webview: vscode.Webview, extensionUri: vscode.Uri, title: string): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'diffPane.js'));
  const n = nonce();
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           style-src ${webview.cspSource} 'unsafe-inline';
           script-src 'nonce-${n}';
           img-src ${webview.cspSource} data: https:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
</head><body>
  <div id="diff-rail"></div>
  <div id="diff-panes">
    <div class="diff-pane">
      <div class="diff-pane-hd"><span id="diff-left-label">Base</span></div>
      <div id="diff-left" class="diff-pane-body"></div>
    </div>
    <div class="diff-pane">
      <div class="diff-pane-hd">Current</div>
      <div id="diff-right" class="diff-pane-body"></div>
    </div>
  </div>
  <script nonce="${n}" src="${scriptUri}"></script>
</body></html>`;
}

export async function openRenderedDiff(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  base: { content: string; label: string },
  current: string,
): Promise<void> {
  const fileName = document.uri.path.split('/').pop() ?? 'document.md';
  const panel = vscode.window.createWebviewPanel(
    'mdEditorPlusDiff',
    `${fileName} — changes since ${base.label}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      retainContextWhenHidden: true,
    },
  );
  // Post init only after the pane is listening (VS Code drops messages sent to a
  // not-yet-ready webview — same lesson as the main editor's 'ready' handshake).
  const sub = panel.webview.onDidReceiveMessage((msg) => {
    if (msg?.type === 'ready') {
      panel.webview.postMessage({ type: 'init', base: base.content, baseLabel: base.label, current });
    }
  });
  panel.onDidDispose(() => sub.dispose());
  panel.webview.html = html(panel.webview, context.extensionUri, fileName);
}
```

- [ ] **Step 2: Rewire `openFullDiff` to use the rendered diff**

`openFullDiff` in `src/diffViewer.ts` currently builds synthetic URIs and calls `vscode.commands.executeCommand('vscode.diff', ...)`. It needs the extension context to resolve `dist/`. Thread the context through:

In `src/diffViewer.ts`, change the signature and body of `openFullDiff` to:

```typescript
import { openRenderedDiff } from './diffPaneView';

// ... keep getGitApi, resolveBaseForDocument, registerDiffContentProvider as-is ...

/** Open the rendered two-pane diff: base (left) vs current (right), in the editor (c57). */
export async function openFullDiff(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  msg: { baseContent?: string; baseLabel?: string; currentMarkdown?: string },
  snapshot: string,
): Promise<void> {
  const explicitBase: DiffBase | undefined =
    msg.baseContent !== undefined
      ? { content: msg.baseContent, label: msg.baseLabel ?? 'On disk' }
      : undefined;
  const gitApi = explicitBase ? null : await getGitApi();
  const base = await resolveDiffBase({
    fsPath: document.uri.fsPath,
    uri: document.uri,
    explicitBase,
    gitApi,
    snapshot,
  });
  const current = resolveCurrentSide(msg.currentMarkdown, document.getText());
  await openRenderedDiff(context, document, base, current);
}
```

You may now delete the now-unused `vscode.diff` plumbing in this file (the `SCHEME`/`bases`/`seq` map, `registerDiffContentProvider`, `diffSidePaths` import) **only if** nothing else references them — grep first:

Run: `grep -rn "registerDiffContentProvider\|diffSidePaths\|md-editor-plus-diff" src/`

If `registerDiffContentProvider` is still called in `src/extension.ts`, leave the content-provider code in place for now and remove it in a follow-up; do not break the build.

- [ ] **Step 3: Update the call site in the provider**

In `src/mdEditorPlusProvider.ts`, the `openFullDiff` handler calls `openFullDiff(document, {...}, openSnapshot)`. Add the context argument. The provider already holds the extension context (used for `this._extensionUri` etc.); pass the `vscode.ExtensionContext` it was constructed with. Update the call to:

```typescript
        await openFullDiff(
          this._context, // the vscode.ExtensionContext held by the provider
          document,
          { baseContent: m.baseContent, baseLabel: m.baseLabel, currentMarkdown: m.markdown },
          openSnapshot,
        );
```

If the provider does not already store the context, add a `private readonly _context: vscode.ExtensionContext` field set in its constructor (the constructor is invoked from `src/extension.ts` where the context is available). Verify with:

Run: `grep -n "ExtensionContext\|constructor" src/mdEditorPlusProvider.ts | head`

- [ ] **Step 4: Build and manual-verify (F5)**

Run: `node esbuild.config.js && npx tsc -p tsconfig.json --noEmit`
Expected: builds clean.

Then F5 in VS Code: open a markdown file in the editor, make an edit, click the diff (↔) toolbar button. Expected: a panel opens beside the editor showing **two rendered editor panes** (base on the left labeled with the base source, current on the right). Both are fully formatted and read-only. No tint/rail yet. Confirm the source file is **not** marked modified by opening the diff.

- [ ] **Step 5: Commit**

```bash
git add src/diffPaneView.ts src/diffViewer.ts src/mdEditorPlusProvider.ts
git commit -m "feat(c57): rendered two-pane diff panel replaces vscode.diff"
```

---

## Task 5: Block-level tint

**Files:**
- Modify: `src/webview/diffPane.ts`
- Create/Modify: `src/webview/styles/diff.css` (new) imported by `diffPane.ts`

**Interfaces:**
- Consumes: `computeAlignment` (Task 1), `createDiffEditor` (Task 2), `blocksFromMarkdown`-style normalization.
- Produces: each changed top-level block carries a CSS class — `diff-block-del` (left), `diff-block-add` (right), `diff-block-change` (both sides of a paired row).

- [ ] **Step 1: Add a normalization helper in diffPane.ts**

Both sides must be split into blocks the SAME way (c55). Reuse the editor's own parser via a temporary read-only editor's markdown storage. Add to `diffPane.ts`:

```typescript
import { splitFrontmatter } from './frontmatter';
import { preprocessMarkdownBoards } from './extensions/board';
import { preprocessMarkdownCallouts } from './extensions/callout';
import type { Node as PMNode } from '@tiptap/pm/model';

// Split markdown into normalized top-level block strings using an editor's own
// parser+serializer, so base and current compare identically (c55).
function blocksOf(editor: Editor, markdown: string): string[] {
  const body = splitFrontmatter(markdown).body;
  const pre = preprocessMarkdownBoards(preprocessMarkdownCallouts(body));
  try {
    const doc = editor.storage.markdown.parser.parse(pre) as PMNode;
    const out: string[] = [];
    doc.forEach((node) => {
      try { out.push((editor.storage.markdown.serializer.serialize(node) as string).trim()); }
      catch { out.push(node.textContent.trim()); }
    });
    return out;
  } catch { return []; }
}

// Map a top-level block index → its DOM element in a rendered pane. ProseMirror
// renders each top-level node as a direct child of the .ProseMirror element.
function blockElements(editor: Editor): HTMLElement[] {
  const root = editor.view.dom as HTMLElement;
  return Array.from(root.children) as HTMLElement[];
}
```

- [ ] **Step 2: Apply tint classes after mount**

Extend `mount()` in `diffPane.ts` to compute alignment and tint blocks:

```typescript
import { computeAlignment } from './diffAlign';

function applyTint(): void {
  if (!leftEditor || !rightEditor) return;
  const baseBlocks = blocksOf(leftEditor, lastInit!.base);
  const curBlocks = blocksOf(rightEditor, lastInit!.current);
  const rows = computeAlignment(baseBlocks, curBlocks);
  const leftEls = blockElements(leftEditor);
  const rightEls = blockElements(rightEditor);
  for (const row of rows) {
    if (row.kind === 'change') {
      if (row.left !== null) leftEls[row.left]?.classList.add('diff-block-change');
      if (row.right !== null) rightEls[row.right]?.classList.add('diff-block-change');
    } else if (row.kind === 'del' && row.left !== null) {
      leftEls[row.left]?.classList.add('diff-block-del');
    } else if (row.kind === 'add' && row.right !== null) {
      rightEls[row.right]?.classList.add('diff-block-add');
    }
  }
}
```

Store the last init payload and call `applyTint()` after editors are created. Update `mount()`:

```typescript
let lastInit: InitMsg | null = null;

function mount(msg: InitMsg): void {
  lastInit = msg;
  const leftEl = document.getElementById('diff-left')!;
  const rightEl = document.getElementById('diff-right')!;
  leftEditor?.destroy();
  rightEditor?.destroy();
  leftEditor = createDiffEditor(leftEl, msg.base);
  rightEditor = createDiffEditor(rightEl, msg.current);
  const leftLabel = document.getElementById('diff-left-label');
  if (leftLabel) leftLabel.textContent = msg.baseLabel;
  // Editors render synchronously enough that the top-level children exist now;
  // requestAnimationFrame ensures layout has flushed before we touch DOM.
  requestAnimationFrame(applyTint);
}
```

- [ ] **Step 3: Add tint + layout styles**

Create `src/webview/styles/diff.css`:

```css
#diff-panes { display: flex; gap: 8px; align-items: flex-start; }
.diff-pane { flex: 1 1 0; min-width: 0; }
.diff-pane-hd {
  font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
  color: var(--muted, #8a93a0); padding: 4px 10px;
  position: sticky; top: 0; background: var(--bg, #fff); z-index: 2;
}
.diff-pane-body { padding: 0 12px; }

.diff-block-add    { background: #e9fbef; box-shadow: inset 3px 0 #2da44e; border-radius: 4px; }
.diff-block-del    { background: #fdeef0; box-shadow: inset 3px 0 #cf222e; border-radius: 4px; }
.diff-block-change { background: #fff7e6; box-shadow: inset 3px 0 #d4a017; border-radius: 4px; }
```

Import it in `diffPane.ts` and add to the injected `<style>`:

```typescript
import diffCss from './styles/diff.css';
// ...in injectStyles(): append `\n${diffCss}` to style.textContent
```

- [ ] **Step 4: Build and manual-verify (F5)**

Run: `node esbuild.config.js`
Then F5: edit a doc (change a paragraph, add a new block, delete one), open the diff. Expected: changed blocks tinted green (right/added), red (left/removed), amber (changed on both sides); unchanged blocks untinted.

- [ ] **Step 5: Commit**

```bash
git add src/webview/diffPane.ts src/webview/styles/diff.css
git commit -m "feat(c57): block-level tint in the rendered diff"
```

---

## Task 6: Filler alignment

**Files:**
- Modify: `src/webview/diffPane.ts`, `src/webview/styles/diff.css`

**Interfaces:**
- Consumes: the `AlignRow[]` and `blockElements` from Task 5.
- Produces: `function alignPanes(): void` — inserts filler spacer `<div>`s so each aligned pair's tops match, and re-runs on resize and async content load.

- [ ] **Step 1: Implement the filler pass**

Filler spacers are plain divs inserted as siblings BEFORE the block they pad, inside each pane body. We pad whichever side is shorter so paired tops align, and insert a full-height filler on the empty side of an add/del row.

```typescript
// Remove any fillers from a prior pass.
function clearFillers(): void {
  document.querySelectorAll('.diff-filler').forEach((f) => f.remove());
}

function filler(height: number): HTMLElement {
  const f = document.createElement('div');
  f.className = 'diff-filler';
  f.style.height = `${Math.max(0, height)}px`;
  return f;
}

function alignPanes(): void {
  if (!leftEditor || !rightEditor || !lastInit) return;
  clearFillers();
  const baseBlocks = blocksOf(leftEditor, lastInit.base);
  const curBlocks = blocksOf(rightEditor, lastInit.current);
  const rows = computeAlignment(baseBlocks, curBlocks);
  const leftEls = blockElements(leftEditor).filter((el) => !el.classList.contains('diff-filler'));
  const rightEls = blockElements(rightEditor).filter((el) => !el.classList.contains('diff-filler'));

  for (const row of rows) {
    const lEl = row.left !== null ? leftEls[row.left] : null;
    const rEl = row.right !== null ? rightEls[row.right] : null;
    if (lEl && rEl) {
      // paired (eq or change): pad the shorter so tops line up
      const lh = lEl.offsetHeight, rh = rEl.offsetHeight;
      if (lh < rh) lEl.parentElement!.insertBefore(filler(rh - lh), lEl);
      else if (rh < lh) rEl.parentElement!.insertBefore(filler(lh - rh), rEl);
    } else if (lEl && !rEl) {
      // base-only (del): full-height filler on the right at the same flow point.
      // Insert before the right block that follows this row, else append.
      const next = nextRightEl(rows, row, rightEls);
      const body = document.getElementById('diff-right')!;
      const f = filler(lEl.offsetHeight);
      if (next) next.parentElement!.insertBefore(f, next); else body.appendChild(f);
    } else if (rEl && !lEl) {
      const next = nextLeftEl(rows, row, leftEls);
      const body = document.getElementById('diff-left')!;
      const f = filler(rEl.offsetHeight);
      if (next) next.parentElement!.insertBefore(f, next); else body.appendChild(f);
    }
  }
}

// The next block on the opposite side that has a real element, after `row`.
function nextRightEl(rows: ReturnType<typeof computeAlignment>, row: typeof rows[number], rightEls: HTMLElement[]): HTMLElement | null {
  const idx = rows.indexOf(row);
  for (let i = idx + 1; i < rows.length; i++) if (rows[i].right !== null) return rightEls[rows[i].right!] ?? null;
  return null;
}
function nextLeftEl(rows: ReturnType<typeof computeAlignment>, row: typeof rows[number], leftEls: HTMLElement[]): HTMLElement | null {
  const idx = rows.indexOf(row);
  for (let i = idx + 1; i < rows.length; i++) if (rows[i].left !== null) return leftEls[rows[i].left!] ?? null;
  return null;
}
```

- [ ] **Step 2: Run alignment after tint and on changes**

In `mount()`, after `requestAnimationFrame(applyTint)`, schedule alignment and wire re-runs:

```typescript
  requestAnimationFrame(() => { applyTint(); alignPanes(); });

  // Rendered heights settle asynchronously (images, mermaid, fonts). Re-align
  // when content loads or the panel resizes. Debounce to avoid thrashing.
  if (!alignWired) {
    alignWired = true;
    let raf = 0;
    const reAlign = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(alignPanes); };
    window.addEventListener('resize', reAlign);
    window.addEventListener('load', reAlign);
    document.addEventListener('load', reAlign, true); // capture <img> load events
    // Mermaid renders asynchronously; observe DOM mutations within the panes.
    const mo = new MutationObserver(reAlign);
    mo.observe(document.getElementById('diff-panes')!, { subtree: true, childList: true, attributes: true });
  }
```

Add `let alignWired = false;` at module scope. Note: the `MutationObserver` will fire from our own filler inserts — guard by skipping mutations whose added/removed nodes are all `.diff-filler`:

```typescript
    const mo = new MutationObserver((records) => {
      const onlyFillers = records.every((r) =>
        [...r.addedNodes, ...r.removedNodes].every((n) => n instanceof HTMLElement && n.classList.contains('diff-filler')));
      if (!onlyFillers) reAlign();
    });
```

- [ ] **Step 3: Style the filler**

Append to `src/webview/styles/diff.css`:

```css
.diff-filler { background: repeating-linear-gradient(45deg, #f3f4f6, #f3f4f6 5px, #eaecef 5px, #eaecef 10px); border-radius: 4px; opacity: .6; }
```

- [ ] **Step 4: Build and manual-verify (F5)**

Run: `node esbuild.config.js`
Then F5: open a diff where one side has extra/removed blocks (add a paragraph, delete a list). Expected: shared blocks sit exactly across from their twins; the missing-side gap shows a hatched filler of matching height. Resize the panel — alignment recomputes. Open a diff with an image or mermaid block — alignment settles correctly after it renders.

- [ ] **Step 5: Commit**

```bash
git add src/webview/diffPane.ts src/webview/styles/diff.css
git commit -m "feat(c57): filler alignment so paired blocks line up"
```

---

## Task 7: Shared rail + click-to-jump + locked scroll

**Files:**
- Modify: `src/webview/diffPane.ts`, `src/webview/styles/diff.css`

**Interfaces:**
- Consumes: `AlignRow[]` (Task 1), aligned block elements (Task 6).
- Produces: a rail of change marks (`add`/`change`/`del`); clicking a mark scrolls both panes to that change; the two panes scroll as one locked unit.

- [ ] **Step 1: Build the rail marks**

After `alignPanes()`, paint a mark per changed row positioned by the right pane's scroll fraction (fall back to the left pane for pure deletions):

```typescript
function buildRail(): void {
  const rail = document.getElementById('diff-rail')!;
  rail.replaceChildren();
  if (!lastInit || !leftEditor || !rightEditor) return;
  const baseBlocks = blocksOf(leftEditor, lastInit.base);
  const curBlocks = blocksOf(rightEditor, lastInit.current);
  const rows = computeAlignment(baseBlocks, curBlocks);
  const leftEls = blockElements(leftEditor).filter((el) => !el.classList.contains('diff-filler'));
  const rightEls = blockElements(rightEditor).filter((el) => !el.classList.contains('diff-filler'));
  const docH = Math.max(document.documentElement.scrollHeight, window.innerHeight);

  let painted = 0;
  for (const row of rows) {
    if (row.kind === 'eq') continue;
    if (painted >= 200) break; // reuse the c55 ceiling
    const anchor = row.right !== null ? rightEls[row.right] : (row.left !== null ? leftEls[row.left] : null);
    if (!anchor) continue;
    const top = anchor.getBoundingClientRect().top + window.scrollY;
    const mark = document.createElement('div');
    mark.className = `diff-mark ${row.kind}`;
    mark.style.top = `${(top / docH) * 100}%`;
    mark.dataset.top = String(top);
    rail.appendChild(mark);
    painted++;
  }
}

document.getElementById('diff-rail')?.addEventListener('click', (e) => {
  const mark = (e.target as HTMLElement).closest<HTMLElement>('.diff-mark');
  if (!mark?.dataset.top) return;
  window.scrollTo({ top: Math.max(0, Number(mark.dataset.top) - 80), behavior: 'smooth' });
});
```

Call `buildRail()` at the end of `alignPanes()` (so marks reflect post-filler positions).

- [ ] **Step 2: Lock the two panes to a single scroll**

With filler alignment, both panes share the page scroll already (they're columns in one scrolling document). Ensure the panes do NOT scroll independently — they must have no inner overflow. In `diff.css`, the `.diff-pane-body` has no `overflow` set, so the whole `<body>` scrolls as one unit. Add an explicit guard:

```css
html, body { overflow-x: hidden; }
.diff-pane-body { overflow: visible; }
#diff-rail {
  position: fixed; top: 0; right: 0; width: 14px; height: 100vh;
  background: var(--rail-bg, #f0f2f5); z-index: 5; cursor: pointer;
}
#diff-rail .diff-mark { position: absolute; left: 3px; right: 3px; height: 12px; border-radius: 3px; }
#diff-rail .diff-mark.add { background: #2da44e; }
#diff-rail .diff-mark.del { background: #cf222e; }
#diff-rail .diff-mark.change { background: #d4a017; }
#diff-panes { margin-right: 18px; } /* clear the fixed rail */
```

(Per project scrollbar memory: never show the OS default scrollbar; the single page scroll matches the rest of the app. If an inner scroller is ever needed, hide-until-hover matching `.board-columns`.)

- [ ] **Step 3: Build and manual-verify (F5)**

Run: `node esbuild.config.js`
Then F5: open a diff with several changes. Expected: a rail on the right shows red/green/amber marks at each change; clicking a mark scrolls to it; scrolling moves both panes together (tops stay aligned).

- [ ] **Step 4: Commit**

```bash
git add src/webview/diffPane.ts src/webview/styles/diff.css
git commit -m "feat(c57): shared change rail with click-to-jump and locked scroll"
```

---

## Task 8: Docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Update the CHANGELOG**

Add an entry under the current unreleased/next version block. Respect Added → Changed → Fixed order:

```markdown
### Added
- Rendered two-pane diff (c57): the diff view now renders both sides through the
  editor — formatted text, callouts, boards, images — instead of VS Code's
  plain-text diff. Changed blocks are tinted, paired blocks align with filler
  gaps, and a change rail jumps between edits.

### Changed
- The diff (↔) toolbar action now opens the rendered two-pane diff in a panel
  beside the editor, replacing the native text diff.
```

- [ ] **Step 2: Update the README**

Find the section describing the diff/“View changes” feature (search `grep -n -i "diff" README.md`). Update it to describe the rendered two-pane view: two read-only rendered panes (base vs current), block tint, filler alignment, and the click-to-jump rail. Note it is read-only.

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs(c57): document the rendered two-pane diff"
```

---

## Manual verification checklist (whole feature)

After all tasks, F5 and confirm:
- [ ] Diff opens as two **rendered** panes (not plain text), read-only.
- [ ] A board, a callout, and an image render in both panes.
- [ ] Added/removed/changed blocks are tinted green/red/amber.
- [ ] Paired blocks line up; missing-side gaps show hatched fillers.
- [ ] The rail shows marks; clicking jumps to the change; scroll is locked across panes.
- [ ] Opening or scrolling the diff does **not** mark the source `.md` file modified (the c56 trap).
- [ ] Base label reflects HEAD / On disk / snapshot per the resolved base.
- [ ] `npx jest tests/diffAlign.test.ts` passes; the full suite shows no new failures.
```
