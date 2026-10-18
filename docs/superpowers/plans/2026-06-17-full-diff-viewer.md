# Full Diff Viewer (native VS Code diff) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "see what changed" diff that opens VS Code's **native** diff editor (current file ↔ git HEAD, with an open-snapshot fallback), reachable from a toolbar button and the conflict-banner link.

**Architecture:** A pure, vscode-free `diffBase.ts` resolves the left-side (base) content — explicit content (banner) > git HEAD via the Git API > open-snapshot. `diffViewer.ts` (vscode glue) registers a read-only content provider for the base and calls `vscode.diff`. The custom editor captures the open-snapshot and forwards an `openFullDiff` message; the webview triggers it from a toolbar button and the conflict-banner link.

**Tech Stack:** TypeScript, Jest (ts-jest), VS Code extension API (`vscode.diff`, `TextDocumentContentProvider`), the built-in `vscode.git` extension API.

## Global Constraints

- No new npm dependencies (the `vscode.git` API `exports` is `any` — adapt structurally, no `@types`).
- Pre-existing failures unrelated to this work — do NOT fix, do NOT count as regressions: `tests/toggle.test.ts` (type-check) and `tests/board/grouping.test.ts` ("group band color").
- Run all commands from the worktree root: `/Users/aviranrevach/AI Projects Aviran/MD viewer mscode/.claude/worktrees/feat+full-diff-viewer-c24` (`node_modules` is a symlink; `npx jest`/`npx tsc`/`node esbuild.config.js` work).

---

## File Structure

- `src/diffBase.ts` — CREATE. Pure `resolveDiffBase` (no vscode import) → unit-testable.
- `tests/diffBase.test.ts` — CREATE.
- `src/diffViewer.ts` — CREATE. vscode glue: content provider, Git API access, `openFullDiff`.
- `src/extension.ts` — MODIFY. Register the diff content provider.
- `src/mdEditorPlusProvider.ts` — MODIFY. Capture open-snapshot; handle `openFullDiff`; add toolbar button to `_getHtml`.
- `src/webview/index.ts` — MODIFY. Wire the toolbar diff button + pass `onOpenFullDiff` to the conflict panel.
- `src/webview/conflictDiffView.ts` — MODIFY. Re-add the optional "Open full diff →" footer link.
- `src/webview/styles/editor.css` — MODIFY. Re-add `.conflict-openfull` style.
- `tests/conflictDiffView.test.ts` — MODIFY. Re-add the link-fires-callback test.

---

### Task 1: Pure base resolver

**Files:**
- Create: `src/diffBase.ts`
- Test: `tests/diffBase.test.ts`

**Interfaces:**
- Produces: `resolveDiffBase(opts: ResolveDiffBaseOptions): Promise<DiffBase>`; `interface DiffBase { content: string; label: string }`; `interface GitApiLike { getRepository(uri: unknown): GitRepoLike | null }`; `interface GitRepoLike { show(ref: string, path: string): Promise<string> }`; `interface ResolveDiffBaseOptions { fsPath: string; uri: unknown; explicitBase?: DiffBase; gitApi: GitApiLike | null; snapshot: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { resolveDiffBase } from '../src/diffBase';

const opts = (over: Record<string, unknown> = {}) =>
  ({ fsPath: '/w/TODO.md', uri: {}, gitApi: null, snapshot: 'SNAP', ...over }) as Parameters<typeof resolveDiffBase>[0];

describe('resolveDiffBase', () => {
  it('uses explicit base verbatim (conflict-banner case)', async () => {
    expect(await resolveDiffBase(opts({ explicitBase: { content: 'DISK', label: 'On disk' } })))
      .toEqual({ content: 'DISK', label: 'On disk' });
  });

  it('returns git HEAD content when repo + show succeed', async () => {
    const gitApi = { getRepository: () => ({ show: async () => 'HEAD CONTENT' }) };
    const r = await resolveDiffBase(opts({ gitApi }));
    expect(r.content).toBe('HEAD CONTENT');
    expect(r.label).toContain('HEAD');
  });

  it('falls back to snapshot when the git extension is absent', async () => {
    expect((await resolveDiffBase(opts({ gitApi: null }))).content).toBe('SNAP');
  });

  it('falls back to snapshot when getRepository returns null', async () => {
    const gitApi = { getRepository: () => null };
    expect((await resolveDiffBase(opts({ gitApi }))).content).toBe('SNAP');
  });

  it('falls back to snapshot (labelled) when show rejects (untracked file)', async () => {
    const gitApi = { getRepository: () => ({ show: async () => { throw new Error('not in HEAD'); } }) };
    const r = await resolveDiffBase(opts({ gitApi }));
    expect(r.content).toBe('SNAP');
    expect(r.label).toBe('when you opened it');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/diffBase.test.ts`
Expected: FAIL — `Cannot find module '../src/diffBase'`.

- [ ] **Step 3: Implement `src/diffBase.ts`**

```ts
// Pure base-content resolver for the full diff viewer (c24). No vscode import,
// so it is unit-testable. The vscode glue lives in diffViewer.ts.

export interface DiffBase { content: string; label: string; }

/** Minimal structural shape of the bits of the VS Code Git API we use. */
export interface GitRepoLike { show(ref: string, path: string): Promise<string>; }
export interface GitApiLike { getRepository(uri: unknown): GitRepoLike | null; }

export interface ResolveDiffBaseOptions {
  fsPath: string;
  uri: unknown;                 // passed through to gitApi.getRepository
  explicitBase?: DiffBase;      // banner case: use verbatim
  gitApi: GitApiLike | null;    // null when the git extension is unavailable
  snapshot: string;             // content captured when the editor opened
}

/** Left-side content for the diff: explicit > git HEAD > open-snapshot. */
export async function resolveDiffBase(opts: ResolveDiffBaseOptions): Promise<DiffBase> {
  if (opts.explicitBase) return opts.explicitBase;
  const repo = opts.gitApi ? opts.gitApi.getRepository(opts.uri) : null;
  if (repo) {
    try {
      const head = await repo.show('HEAD', opts.fsPath);
      return { content: head, label: 'HEAD (last commit)' };
    } catch {
      // untracked / new file — fall through to the snapshot
    }
  }
  return { content: opts.snapshot, label: 'when you opened it' };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/diffBase.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/diffBase.ts tests/diffBase.test.ts
git commit -m "feat(diff): pure base resolver for the full diff viewer (c24)"
```

---

### Task 2: vscode glue — content provider, Git API, openFullDiff; wire into the extension

**Files:**
- Create: `src/diffViewer.ts`
- Modify: `src/extension.ts` (activate — add provider registration)
- Modify: `src/mdEditorPlusProvider.ts` (import; capture snapshot near the top of `resolveCustomTextEditor`; handle the `openFullDiff` message in `onDidReceiveMessage`)

**Interfaces:**
- Consumes: `resolveDiffBase`, `DiffBase`, `GitApiLike` from `./diffBase`.
- Produces: `registerDiffContentProvider(context: vscode.ExtensionContext): void`; `openFullDiff(document: vscode.TextDocument, msg: { baseContent?: string; baseLabel?: string }, snapshot: string): Promise<void>`.

- [ ] **Step 1: Implement `src/diffViewer.ts`**

```ts
import * as vscode from 'vscode';
import { resolveDiffBase, type GitApiLike, type DiffBase } from './diffBase';

const SCHEME = 'md-editor-plus-diff';
// token -> base (left) content. Read-only docs served to vscode.diff's left pane.
const bases = new Map<string, string>();
let seq = 0;

/** Register the read-only content provider that serves the diff's base side. */
export function registerDiffContentProvider(context: vscode.ExtensionContext): void {
  const provider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri) { return bases.get(uri.query) ?? ''; },
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
  );
}

/** Adapt the built-in vscode.git extension's (untyped) API to GitApiLike, or null. */
async function getGitApi(): Promise<GitApiLike | null> {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext) return null;
  try {
    const exports = ext.isActive ? ext.exports : await ext.activate();
    const api = exports?.getAPI?.(1);
    return (api ?? null) as GitApiLike | null;
  } catch {
    return null;
  }
}

/** Open VS Code's native diff editor: base (left) vs the live document (right). */
export async function openFullDiff(
  document: vscode.TextDocument,
  msg: { baseContent?: string; baseLabel?: string },
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

  const token = String(++seq);
  bases.set(token, base.content);
  const fileName = document.uri.path.split('/').pop() ?? 'document.md';
  const leftUri = vscode.Uri.from({ scheme: SCHEME, path: '/' + fileName, query: token });
  await vscode.commands.executeCommand(
    'vscode.diff',
    leftUri,
    document.uri,
    `${fileName} — changes since ${base.label}`,
  );
}
```

- [ ] **Step 2: Register the provider in `src/extension.ts`**

Add the import after the existing provider import (line ~2):

```ts
import { registerDiffContentProvider } from './diffViewer';
```

Inside `activate`, right after `context.subscriptions.push(MdEditorPlusProvider.register(context));`, add:

```ts
  registerDiffContentProvider(context);
```

- [ ] **Step 3: Wire the provider — import, snapshot capture, message handler**

In `src/mdEditorPlusProvider.ts`, add the import near the top (after the `ApplyingTracker` import, line ~8):

```ts
import { openFullDiff } from './diffViewer';
```

At the very start of `resolveCustomTextEditor` (right after the opening `{`, before `const docDir = …`), capture the open-snapshot:

```ts
    // Snapshot of the file's content when this editor opened — the fallback base
    // for the full diff viewer (c24) when the file isn't git-tracked.
    const openSnapshot = document.getText();
```

In the `webviewPanel.webview.onDidReceiveMessage(async (msg) => {` handler, add this branch alongside the others (e.g., right after the `if (msg.type === 'ready') { … }` block):

```ts
      if (msg.type === 'openFullDiff') {
        const m = msg as unknown as { baseContent?: string; baseLabel?: string };
        await openFullDiff(document, { baseContent: m.baseContent, baseLabel: m.baseLabel }, openSnapshot);
        return;
      }
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "toggle.ts"`
Expected: no output.

Run: `node esbuild.config.js`
Expected: `Webview built.`

- [ ] **Step 5: Commit**

```bash
git add src/diffViewer.ts src/extension.ts src/mdEditorPlusProvider.ts
git commit -m "feat(diff): native vscode.diff glue + content provider, wired into the editor (c24)"
```

---

### Task 3: Triggers — toolbar button + conflict-banner link

**Files:**
- Modify: `src/mdEditorPlusProvider.ts` (`_getHtml` — add the toolbar button)
- Modify: `src/webview/index.ts` (wire the button; pass `onOpenFullDiff` to the conflict panel)
- Modify: `src/webview/conflictDiffView.ts` (re-add the optional footer link)
- Modify: `src/webview/styles/editor.css` (re-add `.conflict-openfull`)
- Test: `tests/conflictDiffView.test.ts` (re-add the link-fires test)

**Interfaces:**
- Consumes: `buildConflictDiffPanel(diff, opts?)` where `opts` is `{ onOpenFullDiff?: () => void }`.
- Posts to the extension: `{ type: 'openFullDiff' }` (toolbar) and `{ type: 'openFullDiff', baseContent: string, baseLabel: 'On disk' }` (banner).

- [ ] **Step 1: Add the toolbar button** in `src/mdEditorPlusProvider.ts` `_getHtml`

Find the refresh button line in the toolbar:

```ts
    <button class="toolbar-icon" id="refresh-btn" data-tip="Reload from disk">${iRefresh}</button>
```

Insert a diff button immediately before it (reuse the existing `iArrowsH` icon const):

```ts
    <button class="toolbar-icon" id="diff-btn" data-tip="View changes (diff)">${iArrowsH}</button>
```

- [ ] **Step 2: Re-add the failing test** in `tests/conflictDiffView.test.ts`

Add this test inside the `describe('buildConflictDiffPanel', …)` block:

```ts
  it('renders an "Open full diff" link that fires onOpenFullDiff', () => {
    const onOpenFullDiff = jest.fn();
    const el = buildConflictDiffPanel(diff([{ kind: 'add', yours: null, disk: 'x' }]), { onOpenFullDiff });
    const link = el.querySelector<HTMLElement>('.conflict-openfull');
    expect(link).not.toBeNull();
    link!.click();
    expect(onOpenFullDiff).toHaveBeenCalledTimes(1);
  });

  it('omits the "Open full diff" link when no callback is given', () => {
    const el = buildConflictDiffPanel(diff([{ kind: 'add', yours: null, disk: 'x' }]));
    expect(el.querySelector('.conflict-openfull')).toBeNull();
  });
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest tests/conflictDiffView.test.ts`
Expected: FAIL — `buildConflictDiffPanel` takes one arg / no `.conflict-openfull` rendered.

- [ ] **Step 4: Re-add the footer link** in `src/webview/conflictDiffView.ts`

Add the options interface after the imports (top of file):

```ts
export interface ConflictDiffPanelOptions { onOpenFullDiff?: () => void; }
```

Change the signature:

```ts
export function buildConflictDiffPanel(diff: ConflictDiff, opts: ConflictDiffPanelOptions = {}): HTMLElement {
```

Replace the footer block (the `if (diff.rows.length === 0) { … } else if (diff.truncated > 0) { … }` at the end) with one that also renders the link:

```ts
  // Footer: empty-state note, an optional "+N more" truncation note, and an
  // optional "Open full diff →" link (wired by the host to open the c24 viewer).
  const footParts: Array<Node | string> = [];
  if (diff.rows.length === 0) {
    footParts.push('No line differences.');
  } else if (diff.truncated > 0) {
    footParts.push(`+${diff.truncated} more changed line${diff.truncated === 1 ? '' : 's'}`);
  }
  if (opts.onOpenFullDiff && diff.rows.length > 0) {
    if (footParts.length) footParts.push(' · ');
    const link = document.createElement('span');
    link.className = 'conflict-openfull';
    link.textContent = 'Open full diff →';
    link.addEventListener('click', () => opts.onOpenFullDiff?.());
    footParts.push(link);
  }
  if (footParts.length) {
    const foot = document.createElement('div');
    foot.className = 'conflict-foot';
    foot.append(...footParts);
    wrap.appendChild(foot);
  }
  return wrap;
```

(Delete the previous footer `if/else if` block and its `return wrap;` — this replaces both.)

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest tests/conflictDiffView.test.ts`
Expected: PASS.

- [ ] **Step 6: Re-add `.conflict-openfull` CSS** in `src/webview/styles/editor.css`

Immediately after the `.conflict-foot` / `.theme-dark .conflict-foot` rules, add:

```css
.conflict-openfull { color: var(--link, #2563eb); cursor: pointer; }
.conflict-openfull:hover { text-decoration: underline; }
```

- [ ] **Step 7: Wire the webview triggers** in `src/webview/index.ts`

In the conflict panel render (`renderConflictPanel`), change the `buildConflictDiffPanel` call to pass the disk-base callback. Find:

```ts
    conflictPanel.replaceChildren(buildConflictDiffPanel(diff));
```

Replace with:

```ts
    conflictPanel.replaceChildren(buildConflictDiffPanel(diff, {
      onOpenFullDiff: () => vscode.postMessage({ type: 'openFullDiff', baseContent: disk, baseLabel: 'On disk' }),
    }));
```

Wire the toolbar button — add this near the other toolbar button listeners (e.g., next to the `refreshBtn` listener). Add:

```ts
    document.getElementById('diff-btn')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openFullDiff' });
    });
```

- [ ] **Step 8: Type-check, build, test**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "toggle.ts"`
Expected: no output.

Run: `node esbuild.config.js`
Expected: `Webview built.`

Run: `npx jest tests/conflictDiffView.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/mdEditorPlusProvider.ts src/webview/index.ts src/webview/conflictDiffView.ts src/webview/styles/editor.css tests/conflictDiffView.test.ts
git commit -m "feat(diff): toolbar button + conflict-banner link open the full diff (c24)"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite — no new failures**

Run: `npx jest 2>&1 | tail -5`
Expected: only the two pre-existing failures (`tests/toggle.test.ts`, `tests/board/grouping.test.ts`); the new `diffBase` (5) and updated `conflictDiffView` suites pass.

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "toggle.ts" | head`
Expected: no output.

- [ ] **Step 3: Confirm the feature is bundled / present**

Run: `grep -c "openFullDiff" dist/webview.js && grep -c "md-editor-plus-diff\|vscode.diff" dist/extension.js dist/diffViewer.js 2>/dev/null`
Expected: non-zero in the webview bundle and the emitted extension JS.

- [ ] **Step 4: Manual smoke test (document for the human — not automated)**

In the Extension Development Host: open a git-tracked markdown file, edit it, click the toolbar **diff** button → VS Code's native diff editor opens (HEAD ↔ working) with minimap/sync-scroll/intra-line. Trigger a conflict and click "Open full diff →" → diff opens with the on-disk base. Open an untracked `.md` (no repo) → the diff compares against the open-snapshot.

---

## Notes for the implementer

- `vscode.diff`'s right side is `document.uri` (the live TextDocument), so the diff reflects current content including unsaved edits.
- The `bases` map grows by one small string per diff opened — acceptable for v1; not worth eviction logic.
- Keep `diffBase.ts` free of any `vscode` import so its tests need no vscode mock.
- `iArrowsH` already exists as an icon const inside `_getHtml`; reuse it (no new icon path).
