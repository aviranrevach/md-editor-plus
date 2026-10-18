# Open Menu Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Open" flyout submenu to the `…` overflow menu with two actions — "From clipboard path" and "Browse files…" — that open a chosen markdown file in MD Editor Plus block view.

**Architecture:** A pure, unit-tested path-resolution module (`src/openPath.ts`) holds the only branching logic. The extension host (`mdEditorPlusProvider.ts`) adds two `onDidReceiveMessage` handlers that use it plus VSCode dialogs/quick-picks. The webview adds an "Open ›" submenu trigger and panel, and the existing single-submenu flyout logic in `webview/index.ts` is generalized to support multiple submenus keyed by `data-submenu`.

**Tech Stack:** TypeScript, VSCode extension API, esbuild (webview bundle), Jest + ts-jest (unit tests).

---

## File Structure

- **Create** `src/openPath.ts` — pure helpers: `MARKDOWN_EXTENSIONS`, `isMarkdownPath`, `resolveClipboardCandidates`. No `vscode` import, so it's unit-testable under jest's node env.
- **Create** `tests/openPath.test.ts` — unit tests for the above.
- **Modify** `src/mdEditorPlusProvider.ts` — import the helpers; add `openMarkdownInEditor` local helper and two message handlers; add the `iOpen` icon and the new HTML (submenu trigger + panel).
- **Modify** `src/webview/index.ts` — generalize the submenu flyout logic for multiple submenus; bind the two new submenu item clicks.

All four files change together for one feature; each task below is self-contained and ends in a commit.

---

### Task 1: Pure path-resolution module (`src/openPath.ts`)

**Files:**
- Create: `src/openPath.ts`
- Test: `tests/openPath.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/openPath.test.ts`:

```typescript
import {
  isMarkdownPath,
  resolveClipboardCandidates,
  MARKDOWN_EXTENSIONS,
} from '../src/openPath';
import * as path from 'path';

describe('isMarkdownPath', () => {
  it.each(MARKDOWN_EXTENSIONS)('accepts %s', (ext) => {
    expect(isMarkdownPath(`/x/y/file${ext}`)).toBe(true);
  });
  it('accepts an uppercase extension', () => {
    expect(isMarkdownPath('/x/README.MD')).toBe(true);
  });
  it('rejects a non-markdown extension', () => {
    expect(isMarkdownPath('/x/y/file.txt')).toBe(false);
  });
});

describe('resolveClipboardCandidates', () => {
  const doc = '/home/me/notes';
  const ws = '/home/me/project';

  it('returns empty for blank input', () => {
    expect(resolveClipboardCandidates('   ', doc, ws)).toEqual([]);
  });
  it('returns one normalized candidate for an absolute path', () => {
    expect(resolveClipboardCandidates('/tmp/a/../foo.md', doc, ws)).toEqual([
      path.normalize('/tmp/a/../foo.md'),
    ]);
  });
  it('resolves a relative path against the doc folder first, then workspace', () => {
    expect(resolveClipboardCandidates('sub/foo.md', doc, ws)).toEqual([
      path.resolve(doc, 'sub/foo.md'),
      path.resolve(ws, 'sub/foo.md'),
    ]);
  });
  it('omits the workspace candidate when there is no workspace', () => {
    expect(resolveClipboardCandidates('foo.md', doc)).toEqual([
      path.resolve(doc, 'foo.md'),
    ]);
  });
  it('strips a file:// scheme', () => {
    expect(resolveClipboardCandidates('file:///tmp/foo.md', doc, ws)).toEqual([
      path.normalize('/tmp/foo.md'),
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/openPath.test.ts`
Expected: FAIL — `Cannot find module '../src/openPath'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/openPath.ts`:

```typescript
import * as path from 'path';

/** Markdown extensions the editor handles (lower-case, with leading dot). */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mdx'];

/** True when the path ends in a known markdown extension (case-insensitive). */
export function isMarkdownPath(p: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(path.extname(p).toLowerCase());
}

/**
 * Turn a raw clipboard path into an ordered list of absolute candidate paths to
 * try (first match wins). An absolute path yields a single candidate. A relative
 * path yields [docFolder/<rel>, workspaceRoot/<rel>] so the document's own folder
 * wins. A leading file:// scheme is stripped. Blank input yields [].
 */
export function resolveClipboardCandidates(
  raw: string,
  docFolderPath: string,
  workspaceFolderPath?: string,
): string[] {
  let s = raw.trim();
  if (!s) return [];
  if (s.startsWith('file://')) {
    try {
      s = decodeURIComponent(new URL(s).pathname);
    } catch {
      s = s.replace(/^file:\/\//, '');
    }
  }
  if (path.isAbsolute(s)) return [path.normalize(s)];
  const candidates = [path.resolve(docFolderPath, s)];
  if (workspaceFolderPath) {
    const wsCandidate = path.resolve(workspaceFolderPath, s);
    if (wsCandidate !== candidates[0]) candidates.push(wsCandidate);
  }
  return candidates;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/openPath.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/openPath.ts tests/openPath.test.ts
git commit -m "feat(open): pure markdown path-resolution helpers"
```

---

### Task 2: Extension-host message handlers

**Files:**
- Modify: `src/mdEditorPlusProvider.ts` (import at top; `openMarkdownInEditor` near `sendInit` ~line 105; two handlers inside `onDidReceiveMessage` ~after line 198)

This task is thin VSCode glue (clipboard, quick-pick, dialogs) and is verified by running the extension in Task 5 — no unit test.

- [ ] **Step 1: Add the import**

Find the existing top-of-file imports in `src/mdEditorPlusProvider.ts` (it already imports `vscode`, `path`, `os`). Add directly below them:

```typescript
import { MARKDOWN_EXTENSIONS, isMarkdownPath, resolveClipboardCandidates } from './openPath';
```

- [ ] **Step 2: Add the `openMarkdownInEditor` helper**

In `resolveCustomTextEditor`, immediately AFTER the `sendInit` arrow function definition (after line 129, before `const onDocChange`), add:

```typescript
    const openMarkdownInEditor = async (uri: vscode.Uri): Promise<void> => {
      if (!isMarkdownPath(uri.fsPath)) {
        await vscode.window.showErrorMessage("MD Editor Plus: that doesn't look like a markdown file.");
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', uri, 'md-editor-plus.editor');
    };
```

- [ ] **Step 3: Add the two handlers**

In `onDidReceiveMessage`, immediately AFTER the `openInFinder` handler block (after line 198, before the `openExternal` block), add:

```typescript
      if (msg.type === 'openFromClipboard') {
        const raw = (await vscode.env.clipboard.readText()).trim();
        if (!raw) {
          await vscode.window.showErrorMessage('MD Editor Plus: clipboard is empty.');
          return;
        }
        const docFolder = path.dirname(document.uri.fsPath);
        const ws = vscode.workspace.getWorkspaceFolder(document.uri);
        const candidates = resolveClipboardCandidates(raw, docFolder, ws?.uri.fsPath);
        let found: vscode.Uri | null = null;
        for (const c of candidates) {
          const uri = vscode.Uri.file(c);
          try {
            await vscode.workspace.fs.stat(uri);
            found = uri;
            break;
          } catch { /* try next candidate */ }
        }
        if (!found) {
          await vscode.window.showErrorMessage(`MD Editor Plus: no file found at ${raw}`);
          return;
        }
        await openMarkdownInEditor(found);
        return;
      }
      if (msg.type === 'browseMarkdown') {
        const exts = MARKDOWN_EXTENSIONS.map((e) => e.replace(/^\./, ''));
        const files = await vscode.workspace.findFiles(`**/*.{${exts.join(',')}}`);
        const BROWSE = '$(folder-opened) Browse on disk…';
        type Item = vscode.QuickPickItem & { uri?: vscode.Uri };
        const items: Item[] = [
          { label: BROWSE, alwaysShow: true },
          ...files
            .slice()
            .sort((a, b) => a.fsPath.localeCompare(b.fsPath))
            .map((uri) => ({
              label: path.basename(uri.fsPath),
              detail: vscode.workspace.asRelativePath(uri),
              uri,
            })),
        ];
        const pick = await vscode.window.showQuickPick(items, {
          title: 'Open Markdown File',
          placeHolder: 'Pick a markdown file, or browse on disk…',
          matchOnDetail: true,
        });
        if (!pick) return;
        if (pick.label === BROWSE) {
          const chosen = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { Markdown: exts },
            title: 'Open Markdown File',
            openLabel: 'Open',
          });
          if (chosen && chosen[0]) await openMarkdownInEditor(chosen[0]);
          return;
        }
        if (pick.uri) await openMarkdownInEditor(pick.uri);
        return;
      }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors. (If the project has no `--noEmit`-clean baseline, run `npm run compile` and confirm it builds without new errors in `mdEditorPlusProvider.ts` or `openPath.ts`.)

- [ ] **Step 5: Commit**

```bash
git add src/mdEditorPlusProvider.ts
git commit -m "feat(open): extension handlers for clipboard path & browse"
```

---

### Task 3: Webview HTML — icon, submenu trigger, submenu panel

**Files:**
- Modify: `src/mdEditorPlusProvider.ts` (icon consts ~line 471; dots panel ~line 620; submenu panels ~line 626)

- [ ] **Step 1: Add the `iOpen` icon constant**

In `_getHtml`, directly AFTER the `iAppLogo` const (line 471) and before the `return` (line 473), add:

```typescript
    const iOpen = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M245,110.64A16,16,0,0,0,232,104H216V88a16,16,0,0,0-16-16H130.67L102.94,51.2a16.14,16.14,0,0,0-9.6-3.2H40A16,16,0,0,0,24,64V208h0a8,8,0,0,0,8,8H211.1a8,8,0,0,0,7.59-5.47l28.49-85.47A16.05,16.05,0,0,0,245,110.64ZM93.34,64,123.2,86.4A8,8,0,0,0,128,88h72v16H69.77a16,16,0,0,0-15.18,10.94L40,158.7V64Zm112,136H43.1l26.67-80H232Z"/></svg>`;
```

- [ ] **Step 2: Add the "Open ›" trigger to the dots panel**

In the `actions-panel-dots` div, find the `act-finder` button (line 616) followed by `<div class="actions-sep"></div>` (line 617). Insert the new trigger BETWEEN the finder button and that separator, so the markup becomes:

```html
    <button class="settings-action act-finder" data-tip="Reveal this file in your OS file browser">${iFolder}<span class="settings-action-label">Open in Finder</span></button>
    <button class="settings-action act-open-menu" data-submenu="open" data-tip="Open another markdown file in MD Editor Plus">${iOpen}<span class="settings-action-label">Open</span><span class="settings-action-caret">›</span></button>
    <div class="actions-sep"></div>
```

(Only the middle line is new.)

- [ ] **Step 3: Add the "Open" submenu panel**

Find the export submenu element (lines 623-626). Directly AFTER its closing `</div>` (line 626), add a sibling submenu panel:

```html
  <div class="actions-submenu hidden" id="actions-submenu-open" role="menu">
    <button class="settings-action act-open-clipboard" data-tip="Read a file path from the clipboard and open that markdown file">${iLink}<span class="settings-action-label">From clipboard path</span></button>
    <button class="settings-action act-browse-markdown" data-tip="Pick a markdown file from this workspace, or browse anywhere on disk">${iFolder}<span class="settings-action-label">Browse files…</span></button>
  </div>
```

- [ ] **Step 4: Build the webview bundle**

Run: `npm run compile`
Expected: builds with no errors. (No behavior to test yet — the buttons exist but aren't wired; that's Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/mdEditorPlusProvider.ts
git commit -m "feat(open): add Open submenu trigger, panel, and folder-open icon"
```

---

### Task 4: Webview wiring — generalize submenu flyout + bind Open items

**Files:**
- Modify: `src/webview/index.ts` (submenu logic ~lines 531-589; `bindActions` ~lines 617-632; new bindings after line 694)

The current flyout logic only knows about the single `submenuExport` element. Generalize it to open whichever submenu a trigger names via `data-submenu`, then bind the two Open items.

- [ ] **Step 1: Generalize the submenu state and helpers**

Replace the block from line 531 (`const submenuExport = ...`) through line 589 (the two `submenuExport.addEventListener(...)` lines) with:

```typescript
  const submenuExport = document.getElementById('actions-submenu-export') as HTMLElement;
  let submenuOpenTimer: ReturnType<typeof setTimeout> | null = null;
  let submenuCloseTimer: ReturnType<typeof setTimeout> | null = null;
  let submenuAnchor: HTMLElement | null = null;
  let openSubmenuEl: HTMLElement | null = null;

  function submenuElFor(trigger: HTMLElement): HTMLElement | null {
    const name = trigger.dataset.submenu;
    return name ? document.getElementById(`actions-submenu-${name}`) : null;
  }
  function clearSubmenuTimers(): void {
    if (submenuOpenTimer) { clearTimeout(submenuOpenTimer); submenuOpenTimer = null; }
    if (submenuCloseTimer) { clearTimeout(submenuCloseTimer); submenuCloseTimer = null; }
  }
  function positionSubmenu(trigger: HTMLElement): void {
    const sub = submenuElFor(trigger);
    if (!sub) return;
    const triggerRect = trigger.getBoundingClientRect();
    sub.style.left = '0px';
    sub.style.top = '0px';
    sub.classList.remove('hidden');
    const subRect = sub.getBoundingClientRect();
    // Default: align top edge of submenu with top edge of trigger row,
    // and position to the right of the parent actions panel.
    const panel = trigger.closest('.actions-panel') as HTMLElement | null;
    const panelRect = panel?.getBoundingClientRect() ?? triggerRect;
    let left = panelRect.right + 4;
    if (left + subRect.width > window.innerWidth - 8) {
      left = panelRect.left - subRect.width - 4;
    }
    let top = triggerRect.top - 6;
    if (top + subRect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - subRect.height - 8);
    }
    if (top < 8) top = 8;
    sub.style.left = `${left}px`;
    sub.style.top = `${top}px`;
  }
  function openSubmenu(trigger: HTMLElement): void {
    clearSubmenuTimers();
    const sub = submenuElFor(trigger);
    // Close any other submenu that's currently showing.
    if (openSubmenuEl && openSubmenuEl !== sub) openSubmenuEl.classList.add('hidden');
    submenuAnchor = trigger;
    openSubmenuEl = sub;
    document.querySelectorAll<HTMLElement>('[data-submenu]')
      .forEach((el) => el.classList.toggle('submenu-open', el === trigger));
    positionSubmenu(trigger);
  }
  function closeSubmenu(): void {
    clearSubmenuTimers();
    if (openSubmenuEl) openSubmenuEl.classList.add('hidden');
    openSubmenuEl = null;
    document.querySelectorAll<HTMLElement>('[data-submenu]')
      .forEach((el) => el.classList.remove('submenu-open'));
    submenuAnchor = null;
  }
  function scheduleSubmenuOpen(trigger: HTMLElement): void {
    if (submenuCloseTimer) { clearTimeout(submenuCloseTimer); submenuCloseTimer = null; }
    if (submenuAnchor === trigger) return;
    if (submenuOpenTimer) clearTimeout(submenuOpenTimer);
    submenuOpenTimer = setTimeout(() => openSubmenu(trigger), 120);
  }
  function scheduleSubmenuClose(): void {
    if (submenuOpenTimer) { clearTimeout(submenuOpenTimer); submenuOpenTimer = null; }
    if (submenuCloseTimer) clearTimeout(submenuCloseTimer);
    submenuCloseTimer = setTimeout(closeSubmenu, 250);
  }

  // Keep any submenu open while the pointer is over it; close on leave.
  document.querySelectorAll<HTMLElement>('.actions-submenu').forEach((sub) => {
    sub.addEventListener('mouseenter', () => clearSubmenuTimers());
    sub.addEventListener('mouseleave', scheduleSubmenuClose);
  });
```

(`submenuExport` is still declared because the export-item bindings further down reference it.)

- [ ] **Step 2: Generalize the trigger binding in `bindActions`**

Replace the block from line 618 (`const exportTrigger = ...`) through line 632 (the closing `});` of the `.settings-action` forEach) with:

```typescript
    panel.querySelectorAll<HTMLElement>('[data-submenu]').forEach((trigger) => {
      trigger.addEventListener('mouseenter', () => scheduleSubmenuOpen(trigger));
      trigger.addEventListener('mouseleave', scheduleSubmenuClose);
      // Click as an accessibility fallback (keyboard/Enter, touch).
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (submenuAnchor === trigger) closeSubmenu();
        else openSubmenu(trigger);
      });
    });
    // Hovering any non-submenu row should dismiss an open submenu so it doesn't
    // linger over the wrong row.
    panel.querySelectorAll<HTMLElement>('.settings-action').forEach((el) => {
      if (el.hasAttribute('data-submenu')) return;
      el.addEventListener('mouseenter', scheduleSubmenuClose);
    });
```

- [ ] **Step 3: Bind the two Open submenu items**

Directly AFTER the `act-export-pdf` click binding block (after line 694, the closing `});`), add:

```typescript
  const submenuOpen = document.getElementById('actions-submenu-open') as HTMLElement | null;
  submenuOpen?.querySelector<HTMLElement>('.act-open-clipboard')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openFromClipboard' });
    closeAllActionsPanels();
  });
  submenuOpen?.querySelector<HTMLElement>('.act-browse-markdown')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'browseMarkdown' });
    closeAllActionsPanels();
  });
```

- [ ] **Step 4: Build and type-check**

Run: `npm run compile`
Expected: builds with no errors. The export submenu must still behave (the generalization is a superset of the old single-submenu behavior).

- [ ] **Step 5: Commit**

```bash
git add src/webview/index.ts
git commit -m "feat(open): generalize submenu flyout and wire Open items"
```

---

### Task 5: Manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Launch the extension and open a markdown file**

Use the project's run skill / Extension Development Host (F5) and open any `.md` file in MD Editor Plus.

- [ ] **Step 2: Verify the Export submenu still works**

Open the `…` menu, hover **Export ›** — the HTML/PDF submenu should still appear and position correctly. (Regression check for the generalization.)

- [ ] **Step 3: Verify "Open → Browse files…"**

Open the `…` menu, hover **Open ›**, click **Browse files…**. Expect a quick-pick listing workspace markdown files plus a top "📂 Browse on disk…" row. Pick a file → it opens in MD Editor Plus. Re-run and pick "Browse on disk…" → the native open dialog appears, filtered to markdown; choosing a file opens it.

- [ ] **Step 4: Verify "Open → From clipboard path"**

Copy a path to a markdown file to the clipboard (try an absolute path, then a relative one like `./README.md`). Use **Open → From clipboard path**. Expect the file to open. Then copy a bogus path and confirm the error toast *"MD Editor Plus: no file found at …"*; copy a `.txt` path that exists and confirm *"that doesn't look like a markdown file."*; clear the clipboard / copy whitespace and confirm *"clipboard is empty."*

- [ ] **Step 5: Final state**

If steps 1-4 pass with no code changes needed, the feature is complete (all code already committed in Tasks 1-4). If a fix was required, commit it:

```bash
git add -A
git commit -m "fix(open): address smoke-test findings"
```

---

## Self-Review Notes

- **Spec coverage:** Open submenu (Task 3) ✓; clipboard flow with doc-folder-then-workspace resolution + 3 error messages (Tasks 1-2) ✓; browse quick-pick + on-disk escape hatch (Task 2) ✓; opens in MD Editor Plus via `vscode.openWith` (Task 2 helper) ✓; markdown-extension check shared with the registered extensions list (Task 1) ✓; unit tests on the resolution unit (Task 1) ✓; submenu reuses/extends existing flyout (Task 4) ✓.
- **Naming consistency:** `resolveClipboardCandidates`, `isMarkdownPath`, `MARKDOWN_EXTENSIONS`, `openMarkdownInEditor`, message types `openFromClipboard` / `browseMarkdown`, DOM classes `act-open-menu` / `act-open-clipboard` / `act-browse-markdown`, panel id `actions-submenu-open`, `data-submenu="open"` — used identically across all tasks.
- **Out of scope (per spec):** web/`https://` URLs, opening folders as workspaces, adding Open to the filename-hover panel.
