# Full diff viewer — "see what changed, like VS Code" (c24)

Date: 2026-06-17
Status: Design approved. Builds on the c29 conflict diff (reuses its "Open full diff" seam).

## Problem

Users want a real "what changed?" diff — *"a diff viewer like in VS Code"* (c24). The c29
in-banner diff is a compact, line-level preview for the conflict moment only. c24 is the
full, on-demand viewer.

## Decision: use VS Code's native diff editor — do not reimplement

To be genuinely like VS Code (synchronized scroll, character-level intra-line highlighting,
the minimap with clickable change markers, line numbers, fold-unchanged) we **open VS Code's
own diff editor** via the `vscode.diff` command rather than building a webview imitation. A
reimplementation would always be a lesser knockoff and far more code. The diff opens as its
own editor tab (exactly like VS Code's "Open Changes"), showing the **markdown source** — the
same thing VS Code shows for any file, and consistent with the c29 text diff.

## What it diffs

- **Default (toolbar):** current file ↔ **git HEAD** (the committed version) — the VS Code
  Source-Control mental model. **Fallback** when the file isn't tracked / no repo: current ↔
  an **open-snapshot** (the file's content captured when the editor opened). Auto-save doesn't
  disturb that snapshot, so it stays meaningful.
- **From the conflict banner:** current ↔ the **on-disk/incoming** version (the conflict's
  base) — that's the relevant comparison while a conflict is showing.

Right side is always the live document (`document.uri`), so it reflects current content
including unsaved edits. Left side is the chosen base, served through a content provider.

## Architecture

### 1. Triggers
- **Toolbar button** (provider HTML, `_getHtml`): a new `toolbar-icon` button (Phosphor
  "git-diff"/arrows icon) posting `{ type: 'openFullDiff' }` to the extension.
- **Conflict-banner link** (re-added): `conflictDiffView.buildConflictDiffPanel` regains an
  optional `onOpenFullDiff` callback that renders an "Open full diff →" footer link; `index.ts`
  wires it to post `{ type: 'openFullDiff', baseContent: <pendingExternalMarkdown>, baseLabel: 'On disk' }`.

### 2. Base resolution (extension, `mdEditorPlusProvider`)
On `openFullDiff`:
- If `msg.baseContent` is provided (banner) → use it directly; label from `msg.baseLabel`.
- Else (toolbar) → resolve the **committed** version:
  - Get the Git API: `vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports.getAPI(1)`.
  - `const repo = api?.getRepository(document.uri)`. If `repo`, `await repo.show('HEAD', document.uri.fsPath)` → string (base). Label: "HEAD (last commit)".
  - If no git extension / no repo / `show` throws (untracked) → use the **open-snapshot**
    captured at `resolveCustomTextEditor` time. Label: "When you opened it".

### 3. Serving the base — `TextDocumentContentProvider`
- Register once (in `extension.ts` activate, or lazily in the provider) for scheme
  `md-editor-plus-diff`.
- A module-level `Map<string, string>` holds base content by a short token. On `openFullDiff`,
  store `map.set(token, baseContent)`, build `leftUri = Uri.parse('md-editor-plus-diff:/' + encodeURIComponent(fileName) + '?' + token)`. `provideTextDocumentContent(uri)` returns `map.get(uri.query) ?? ''`.
- The left doc is read-only (content provider documents are).

### 4. Open the diff
`await vscode.commands.executeCommand('vscode.diff', leftUri, document.uri, '${fileName} — changes since ${label}')`. Optionally pass `{ preview: true }` options. This is the native diff editor — minimap, sync scroll, intra-line, all for free.

### 5. Open-snapshot capture
In `resolveCustomTextEditor`, capture `const openSnapshot = document.getText();` once (per editor). Keep it for the fallback base.

## Components touched

- Create: `src/diffViewer.ts` (extension-side) — base resolution (`resolveDiffBase`) + the
  content-provider registration + `openFullDiff(document, msg)` orchestration. Keeps the
  provider file from growing.
- Modify: `src/mdEditorPlusProvider.ts` — capture `openSnapshot`; handle the `openFullDiff`
  message (delegate to `diffViewer`); add the toolbar button to `_getHtml`.
- Modify: `src/extension.ts` — register the content provider (if done at activation).
- Modify: `src/webview/index.ts` — wire the toolbar button (post `openFullDiff`) and pass an
  `onOpenFullDiff` to the conflict panel that posts `openFullDiff` with the disk base.
- Modify: `src/webview/conflictDiffView.ts` — re-add the optional `onOpenFullDiff` footer link.
- Type: add a minimal `git.d.ts` ambient type for the Git API surface used (`GitExtension`,
  `API.getRepository`, `Repository.show`), so we don't depend on `@types` we can't install.

## Error handling / edges

- **No git + no usable snapshot** (shouldn't happen — snapshot is always captured): show
  `vscode.window.showInformationMessage('No earlier version to compare against.')`.
- **`repo.show` throws** (untracked/new file): caught → snapshot fallback.
- **Base identical to current** (no changes): still open the diff (VS Code shows "no changes"
  cleanly) — simpler than special-casing.
- **Non-file document** (untitled): skip git, use snapshot.

## Testing

- `tests/diffViewer.test.ts` — unit-test `resolveDiffBase` with injected dependencies (a fake
  Git API + a snapshot): returns HEAD content when repo+show succeed; returns snapshot when the
  git extension is absent, `getRepository` is null, or `show` rejects; uses `baseContent`
  verbatim when provided. Pure logic, deps injected — no real git, no VS Code runtime.
- The `vscode.diff` invocation and content-provider registration are thin glue, verified by
  manual smoke test (documented in the plan), not unit tests.

## Out of scope

- Rendering the diff as **boards** (the native diff shows markdown source — that's the point).
- Customizing the minimap / inline toggle / char-level highlighting — all native, nothing to build.
- Diffing against an arbitrary commit / a commit picker (HEAD only for v1).
- A webview-embedded diff view.
