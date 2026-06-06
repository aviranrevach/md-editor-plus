# Open Menu Actions — Design

**Date:** 2026-06-06
**Status:** Approved (pending spec review)

## Goal

Add an **"Open" flyout submenu** to the `…` overflow menu in the MD Editor Plus
toolbar, giving the user two ways to open another markdown file directly into the
block-view editor:

1. **From clipboard path** — read a local file path from the clipboard and open it.
2. **Browse files…** — pick a markdown file from a quick-pick of workspace files,
   with an escape hatch to browse anywhere on disk.

Both actions open the chosen file **in MD Editor Plus block view**, replacing the
current tab's content (standard `vscode.openWith` behavior — if the file is already
open elsewhere, VSCode focuses that tab instead).

## Menu placement

The new submenu sits in the existing dots overflow menu, just below "Open in Finder"
and above the "EXPORT & TOOLS" separator:

```
  Open in Finder
  Open               ›   ┌─────────────────────────────┐
  ─────────────────      │  From clipboard path         │
  EXPORT & TOOLS         │  Browse files…               │
  Export             ›   └─────────────────────────────┘
  Create blocks skill…
```

The "Open" trigger reuses the exact flyout mechanism already powering the
"Export ›" submenu (hover-open with 120ms delay, 250ms close delay, off-screen
flip positioning, click-to-toggle keyboard fallback). No new submenu machinery is
introduced. The submenu is added to the primary dots panel (`actions-panel-dots`);
the filename-hover panel is left unchanged.

## Components

### Webview side

**HTML** (`src/mdEditorPlusProvider.ts`, in the dots actions panel ~line 608):
- New submenu trigger button: class `settings-action act-open-menu`,
  `data-submenu="open"`, label "Open", caret `›`, a new inline SVG icon.
- New submenu panel `actions-submenu-open` containing two buttons:
  - `act-open-clipboard` — label "From clipboard path"
  - `act-browse-markdown` — label "Browse files…"
- One new inline SVG icon constant (`iOpen`) added alongside the existing icon
  consts (~line 447), an open-folder/open-doc glyph consistent with the existing
  16×16 `currentColor` icon style.

**Wiring** (`src/webview/index.ts`, in the actions-binding section ~line 617):
- Register `data-submenu="open"` with the existing submenu open/close logic (the
  same code path that handles `export`).
- Click handler on `.act-open-clipboard` → `vscode.postMessage({ type: 'openFromClipboard' })`, then close all action panels.
- Click handler on `.act-browse-markdown` → `vscode.postMessage({ type: 'browseMarkdown' })`, then close all action panels.

**CSS** (`src/webview/styles/editor.css`): the existing `.actions-submenu` rules
already cover the new panel; no new styling expected beyond confirming the panel id
is matched by the generic submenu selector.

### Extension host side

**Message handlers** (`src/mdEditorPlusProvider.ts`, in `onDidReceiveMessage`):
- `openFromClipboard` → run the clipboard flow (below).
- `browseMarkdown` → run the browse flow (below).

**Shared helpers:**
- `MARKDOWN_EXTENSIONS` — a single source-of-truth array of markdown extensions
  (`.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx`) matching what the custom editor is
  registered for. Used by both the extension check and the browse glob.
- `isMarkdownPath(path): boolean` — extension check against `MARKDOWN_EXTENSIONS`.
- `resolveClipboardCandidates(raw, docFolderUri, workspaceFolderUri): vscode.Uri[]`
  — pure path-resolution logic that returns an **ordered list of candidate uris**
  (empty for blank input). The handler tries each in order and opens the first that
  exists. This is the unit-tested unit; keeping it free of `fs` calls makes the
  ordering logic testable without the VSCode API.
- `openMarkdownInEditor(uri)` — validates the target is markdown, then
  `vscode.commands.executeCommand('vscode.openWith', uri, 'md-editor-plus.editor')`.

## Data flow

### Flow 1 — From clipboard path

1. Read clipboard via `vscode.env.clipboard.readText()`. Trim it.
2. If empty → `showErrorMessage('Clipboard is empty.')` and stop.
3. Build the ordered candidate list with `resolveClipboardCandidates`:
   - **Absolute path** (`path.isAbsolute`) → a single candidate, used directly.
   - **Relative path** → two candidates in order: resolved against the **current
     document's folder first**, then against the **workspace root**.
   - A leading `file://` scheme is stripped before resolution (defensive; the
     primary case is a plain path, but a pasted `file://` URL should still work).
4. The handler `stat`s each candidate in order and takes the first that exists. If
   none exist → `showErrorMessage('No file found at <path>.')`.
5. If the found file is not markdown → `showErrorMessage("That doesn't look like a markdown file.")`.
6. Otherwise `openMarkdownInEditor(uri)`.

### Flow 2 — Browse files…

1. `vscode.workspace.findFiles('**/*.{md,markdown,mdown,mkd,mdx}', <default excludes>)`.
2. Build a `QuickPick`:
   - First item: **"$(folder-opened) Browse on disk…"** (a sentinel item).
   - Remaining items: one per found file — `label` = filename, `detail` = path
     relative to the workspace (`vscode.workspace.asRelativePath`).
3. On accept:
   - Sentinel "Browse on disk…" → `vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false, filters: { Markdown: [...] }, title: 'Open Markdown File' })` → if a file is chosen, `openMarkdownInEditor`.
   - A file item → `openMarkdownInEditor(item.uri)`.
4. Cancel / dismiss → no-op.

## Error handling

- Every failure path surfaces a `showErrorMessage` toast; no silent no-ops.
- Cancelling a picker or dialog is a clean no-op (not an error).
- Opening a file already open in another tab is left to VSCode (it focuses the
  existing tab) — no special handling.

## Testing

- **Unit tests** for `resolveClipboardCandidates`:
  - absolute path → single candidate, unchanged
  - relative path → `[docFolder/<rel>, workspaceRoot/<rel>]` in that order
  - `file://` prefix stripped correctly
  - empty / whitespace input → empty array
- `isMarkdownPath` table test across the extension list and a non-markdown path.
- Menu wiring, quick-pick, and dialogs are thin VSCode glue and are verified by
  running the extension (manual smoke test), not unit tests.

## Out of scope (YAGNI)

- Remote/web (`https://`) markdown URLs — explicitly excluded; clipboard handling is
  local paths only.
- Opening folders as workspaces.
- Adding the Open submenu to the filename-hover panel.
- Recent-files / history list.
