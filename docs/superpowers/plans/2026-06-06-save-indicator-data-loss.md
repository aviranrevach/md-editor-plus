# Save Indicator + Data-Loss Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop edits being lost on close, auto-save to disk ~1s after typing stops, add a Cmd+S that saves immediately, and show a condensed Saved/Saving…/Unsaved/Conflict indicator next to the filename.

**Architecture:** Two new pure, unit-tested webview modules carry the risky logic: a flushable debouncer (never drops pending work) and a save-state reducer + presenter (the indicator can't lie). The TipTap editor, the webview shell (`index.ts`), and the VS Code custom-editor provider are thin glue that wire those modules to real events — verified by `tsc` compile + a manual smoke matrix, matching this repo's convention (provider/DOM glue is not unit-tested; pure logic is).

**Tech Stack:** TypeScript, TipTap, VS Code Custom Text Editor API, esbuild (webview bundle), Jest + ts-jest (node env, no DOM/vscode mock — pure modules only).

---

## Spec

See [docs/superpowers/specs/2026-06-06-save-indicator-data-loss-design.md](../specs/2026-06-06-save-indicator-data-loss-design.md).

## Refinement vs spec (read first)

The spec says "the extension is the single source of truth" for save state. In practice the conflict is detected **webview-side** (existing banner at [index.ts:980-990](../../../src/webview/index.ts#L980-L990)) and the user types webview-side, while disk-save lifecycle is known **extension-side**. So the implementation uses a single pure **reducer** (`nextSaveState`) living in the webview that combines three event sources — local edit, conflict detect/resolve (webview), and save lifecycle `saving`/`saved`/`failed` (posted by the extension). The reducer is structured so a `conflict` state sticks until resolved and a save lifecycle event can never show "Saved" while edits are pending. This preserves the spec's intent (the indicator cannot lie) and is fully unit-testable.

## File Structure

- **Create** `src/webview/flushableDebounce.ts` — a debouncer with `schedule/flush/cancel/pending`. Pure. Replaces the raw `setTimeout` in `editor.ts` so pending edits can be **flushed** (fired now) instead of dropped on close.
- **Create** `tests/flushableDebounce.test.ts` — Jest fake-timer tests for the debouncer.
- **Create** `src/webview/saveState.ts` — `SaveState`, `SaveEvent`, `nextSaveState()` reducer, `describeSaveState()` presenter. Pure.
- **Create** `tests/saveState.test.ts` — reducer + presenter tests.
- **Modify** `src/webview/editor.ts` — use the debouncer; flush on `onBlur` and in `destroyEditor`; export `flushPendingEdit()`.
- **Modify** `tests/__mocks__/editorMock.js` — add `flushPendingEdit` stub so `index.ts` keeps mocking cleanly.
- **Modify** `src/mdEditorPlusProvider.ts` — per-webview auto-save (1s) calling `document.save()`; `save` (Cmd+S) message handler; `conflictPause` message handler; `onDidSaveTextDocument` → post `saveState`; best-effort save on dispose; add `save-indicator` span to toolbar HTML.
- **Modify** `src/webview/index.ts` — add `SaveStateMessage` to `HostMessage`; render the indicator via the reducer; Cmd+S keybinding; flush on `blur`/`pagehide`/`visibilitychange→hidden`; wire local-edit + conflict events into the reducer; post `conflictPause`.
- **Modify** `src/webview/styles/editor.css` — `.save-indicator` states + flash.
- **Modify** `TODO.md` — mark c8 done (final task).

---

### Task 1: Flushable debouncer (pure module)

**Files:**
- Create: `src/webview/flushableDebounce.ts`
- Test: `tests/flushableDebounce.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/flushableDebounce.test.ts
import { createFlushableDebounce } from '../src/webview/flushableDebounce';

describe('createFlushableDebounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires the callback once after the delay elapses', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    d.schedule();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-scheduling resets the delay (debounce)', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    d.schedule();
    jest.advanceTimersByTime(400);
    d.schedule();
    jest.advanceTimersByTime(400);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush() fires a pending callback immediately and clears the timer', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    d.schedule();
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(500); // must not fire again
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush() with nothing pending does nothing', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel() drops the pending callback', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    d.schedule();
    d.cancel();
    jest.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });

  it('pending() reflects whether a callback is queued', () => {
    const fn = jest.fn();
    const d = createFlushableDebounce(fn, 500);
    expect(d.pending()).toBe(false);
    d.schedule();
    expect(d.pending()).toBe(true);
    d.flush();
    expect(d.pending()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/flushableDebounce.test.ts`
Expected: FAIL — cannot find module `../src/webview/flushableDebounce`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/webview/flushableDebounce.ts
// A debounce that can be FLUSHED — firing the pending callback immediately
// instead of dropping it. Used so edits in flight are never lost when the
// editor blurs or the webview closes.
export interface FlushableDebounce {
  /** (Re)start the timer. Any previously scheduled callback is replaced. */
  schedule(): void;
  /** If a callback is pending, fire it now and clear the timer. Else no-op. */
  flush(): void;
  /** Drop any pending callback without firing it. */
  cancel(): void;
  /** True if a callback is currently queued. */
  pending(): boolean;
}

export function createFlushableDebounce(fn: () => void, delayMs: number): FlushableDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  return {
    schedule(): void {
      clear();
      timer = setTimeout(() => { timer = null; fn(); }, delayMs);
    },
    flush(): void {
      if (timer !== null) { clear(); fn(); }
    },
    cancel(): void { clear(); },
    pending(): boolean { return timer !== null; },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/flushableDebounce.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/flushableDebounce.ts tests/flushableDebounce.test.ts
git commit -m "feat(save): flushable debounce util so pending edits are never dropped"
```

---

### Task 2: Save-state reducer + presenter (pure module)

**Files:**
- Create: `src/webview/saveState.ts`
- Test: `tests/saveState.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/saveState.test.ts
import { nextSaveState, describeSaveState, SaveState } from '../src/webview/saveState';

describe('nextSaveState', () => {
  it('local edit moves saved/saving to unsaved', () => {
    expect(nextSaveState('saved', 'localEdit')).toBe('unsaved');
    expect(nextSaveState('saving', 'localEdit')).toBe('unsaved');
  });

  it('save lifecycle transitions', () => {
    expect(nextSaveState('unsaved', 'saveStarted')).toBe('saving');
    expect(nextSaveState('saving', 'saveSucceeded')).toBe('saved');
    expect(nextSaveState('saving', 'saveFailed')).toBe('unsaved');
  });

  it('conflict sticks until resolved — no event escapes it except conflictResolved', () => {
    const events = ['localEdit', 'saveStarted', 'saveSucceeded', 'saveFailed', 'conflictDetected'] as const;
    for (const e of events) {
      expect(nextSaveState('conflict', e)).toBe('conflict');
    }
    expect(nextSaveState('conflict', 'conflictResolved')).toBe('saved');
  });

  it('conflictDetected always wins from any state', () => {
    const states: SaveState[] = ['saved', 'unsaved', 'saving'];
    for (const s of states) {
      expect(nextSaveState(s, 'conflictDetected')).toBe('conflict');
    }
  });
});

describe('describeSaveState', () => {
  it('maps every state to a label, glyph and css class', () => {
    expect(describeSaveState('saved')).toEqual({ label: 'Saved', glyph: '✓', cssClass: 'save-ind-saved' });
    expect(describeSaveState('unsaved')).toEqual({ label: 'Unsaved', glyph: '•', cssClass: 'save-ind-unsaved' });
    expect(describeSaveState('saving')).toEqual({ label: 'Saving…', glyph: '⟳', cssClass: 'save-ind-saving' });
    expect(describeSaveState('conflict')).toEqual({ label: 'Edited elsewhere', glyph: '⚠', cssClass: 'save-ind-conflict' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/saveState.test.ts`
Expected: FAIL — cannot find module `../src/webview/saveState`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/webview/saveState.ts
// Pure save-state model. The indicator is a function of this state, so it can
// never claim "Saved" while edits are pending or a conflict is unresolved.
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict';

export type SaveEvent =
  | 'localEdit'
  | 'saveStarted'
  | 'saveSucceeded'
  | 'saveFailed'
  | 'conflictDetected'
  | 'conflictResolved';

export function nextSaveState(current: SaveState, event: SaveEvent): SaveState {
  // A detected conflict overrides everything; it persists until explicitly resolved.
  if (event === 'conflictDetected') return 'conflict';
  if (current === 'conflict') return event === 'conflictResolved' ? 'saved' : 'conflict';
  switch (event) {
    case 'localEdit':        return 'unsaved';
    case 'saveStarted':      return 'saving';
    case 'saveSucceeded':    return 'saved';
    case 'saveFailed':       return 'unsaved';
    case 'conflictResolved': return 'saved';
  }
}

export interface SaveStateView {
  label: string;
  glyph: string;
  cssClass: string;
}

export function describeSaveState(state: SaveState): SaveStateView {
  switch (state) {
    case 'saved':    return { label: 'Saved',            glyph: '✓', cssClass: 'save-ind-saved' };
    case 'unsaved':  return { label: 'Unsaved',          glyph: '•', cssClass: 'save-ind-unsaved' };
    case 'saving':   return { label: 'Saving…',          glyph: '⟳', cssClass: 'save-ind-saving' };
    case 'conflict': return { label: 'Edited elsewhere', glyph: '⚠', cssClass: 'save-ind-conflict' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/saveState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/saveState.ts tests/saveState.test.ts
git commit -m "feat(save): save-state reducer + indicator presenter"
```

---

### Task 3: Flush pending edits in the editor (fixes dropped-keystrokes leak)

**Files:**
- Modify: `src/webview/editor.ts:35` (module var), `:131-137` (onUpdate), `:138` (add onBlur), `:186-190` (destroyEditor); add `flushPendingEdit` export
- Modify: `tests/__mocks__/editorMock.js`

- [ ] **Step 1: Import the debouncer and replace the raw timer var**

In `src/webview/editor.ts`, add to the import block (after line 30):

```typescript
import { createFlushableDebounce, FlushableDebounce } from './flushableDebounce';
```

Replace line 35:

```typescript
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
```

with:

```typescript
let _editDebounce: FlushableDebounce | null = null;
```

- [ ] **Step 2: Build the debouncer in createEditor and use it in onUpdate**

Replace the `onUpdate` handler (lines 131-137) with:

```typescript
    onUpdate() {
      _editDebounce?.schedule();
    },
    onBlur() {
      // Losing focus is a natural save point — flush so the last keystrokes
      // reach the host immediately instead of waiting on the debounce.
      _editDebounce?.flush();
    },
```

Immediately after the `const _editor = new Editor({ ... })` block closes (after line 138's `});`), add:

```typescript
  _editDebounce = createFlushableDebounce(() => {
    if (!_editor) return;
    const markdown = _editor.storage.markdown.getMarkdown() as string;
    onChange(_frontmatter + markdown);
  }, 500);
```

- [ ] **Step 3: Flush (not clear) in destroyEditor, and add flushPendingEdit export**

Replace `destroyEditor` (lines 186-190) with:

```typescript
export function flushPendingEdit(): void {
  _editDebounce?.flush();
}

export function destroyEditor(): void {
  // Flush — NOT clear — so edits made in the last 500ms before close are sent
  // to the host instead of being silently discarded.
  _editDebounce?.flush();
  _editDebounce = null;
  _editor?.destroy();
  _editor = null;
}
```

- [ ] **Step 3b: Apply the same flush fix to the SOURCE (Code view) editor**

The Code-view editor (`createSourceEditor`, ~line 239-263) has the identical bug: its `onUpdate` uses a raw `_sourceDebounceTimer` and `destroySourceEditor` (~line 278-282) clears it without firing. Editing in Code view then closing loses work the same way. Mirror the fix:

- Add a module var alongside the source editor state (~line 223): replace `let _sourceDebounceTimer: ReturnType<typeof setTimeout> | null = null;` with `let _sourceEditDebounce: FlushableDebounce | null = null;`
- In `createSourceEditor`'s `onUpdate` (lines 254-259), replace the raw-timer body with `if (_suppressSourceUpdate) return; _sourceEditDebounce?.schedule();` and add an `onBlur() { _sourceEditDebounce?.flush(); }` handler.
- After the `new Editor({...})` assignment to `_sourceEditor`, build: `_sourceEditDebounce = createFlushableDebounce(() => { if (!_sourceEditor || _suppressSourceUpdate) return; onChange(getSourceMarkdown()); }, 500);`
- In `destroySourceEditor`, replace `if (_sourceDebounceTimer) clearTimeout(_sourceDebounceTimer);` with `_sourceEditDebounce?.flush(); _sourceEditDebounce = null;`
- Make `flushPendingEdit()` flush BOTH editors: `_editDebounce?.flush(); _sourceEditDebounce?.flush();`

- [ ] **Step 4: Keep the editor mock in sync**

In `tests/__mocks__/editorMock.js`, add inside the exported object:

```javascript
  flushPendingEdit: () => {},
```

- [ ] **Step 5: Compile to verify types**

Run: `npm run compile`
Expected: completes with no TypeScript errors.

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `npx jest`
Expected: same baseline as before this branch (note: `tests/toggle.test.ts` has a known pre-existing type-check failure unrelated to this work — see project memory; all other suites pass, including the two new ones).

- [ ] **Step 7: Commit**

```bash
git add src/webview/editor.ts tests/__mocks__/editorMock.js
git commit -m "fix(save): flush pending edit on blur and close instead of dropping it"
```

---

### Task 4: Extension-side auto-save, Cmd+S save, save lifecycle (provider)

**Files:**
- Modify: `src/mdEditorPlusProvider.ts` — message-handler type (`:149-163`), `onDidChangeTextDocument` area (`:140-147`), `edit` handler (`:173-175`), dispose (`:487-489`), toolbar HTML (`:568`)

- [ ] **Step 1: Add the save-indicator span to the toolbar HTML**

In `_getHtml`, replace the filename line (line 568):

```typescript
    <span class="toolbar-filename" id="toolbar-filename" title="${fileName}">${fileName}</span>
```

with:

```typescript
    <span class="toolbar-filename" id="toolbar-filename" title="${fileName}">${fileName}</span>
    <span class="save-indicator" id="save-indicator" aria-live="polite"></span>
```

- [ ] **Step 2: Add per-webview save state + helpers inside resolveCustomTextEditor**

In `resolveCustomTextEditor`, just after `const mediaBaseUri = ...` (line 104), add:

```typescript
    const AUTO_SAVE_MS = 1000;
    let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    let conflictPaused = false;

    const postSaveState = (state: 'saving' | 'saved' | 'failed', flash = false): void => {
      void webviewPanel.webview.postMessage({ type: 'saveState', state, flash });
    };

    const cancelAutoSave = (): void => {
      if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
    };

    // Writes the (already-applied, in-memory) document to disk. Gated on conflict:
    // while a conflict banner is up the webview suppresses edits AND pauses us, so
    // we never overwrite an external change with the user's un-reconciled version.
    const saveToDisk = async (flash = false): Promise<void> => {
      if (conflictPaused) return;
      if (!document.isDirty) { postSaveState('saved', flash); return; }
      postSaveState('saving');
      try {
        const ok = await document.save();
        postSaveState(ok ? 'saved' : 'failed', ok && flash);
      } catch (err) {
        console.error('[md-editor-plus] save failed', err);
        postSaveState('failed');
      }
    };

    const scheduleAutoSave = (): void => {
      cancelAutoSave();
      autoSaveTimer = setTimeout(() => { autoSaveTimer = null; void saveToDisk(); }, AUTO_SAVE_MS);
    };
```

- [ ] **Step 3: Subscribe to disk saves so external/other saves update the indicator**

Immediately after the `const onDocChange = vscode.workspace.onDidChangeTextDocument(...)` block (ends line 147), add:

```typescript
    const onDocSave = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.toString() !== document.uri.toString()) return;
      postSaveState('saved');
    });
```

- [ ] **Step 4: Widen the incoming-message type and handle edit/save/conflictPause**

In the `onDidReceiveMessage` parameter type (lines 149-163), add a `paused` field to the inline type — change the opening of the object type:

```typescript
    webviewPanel.webview.onDidReceiveMessage(async (msg: {
      type: string;
      markdown?: string;
      paused?: boolean;
      defaults?: {
```

Replace the existing `edit` handler (lines 173-175):

```typescript
      if (msg.type === 'edit' && msg.markdown !== undefined) {
        await this._applyEdit(document, msg.markdown);
      }
```

with:

```typescript
      if (msg.type === 'edit' && msg.markdown !== undefined) {
        await this._applyEdit(document, msg.markdown);
        scheduleAutoSave();
        return;
      }
      if (msg.type === 'save') {
        if (msg.markdown !== undefined) await this._applyEdit(document, msg.markdown);
        cancelAutoSave();
        await saveToDisk(true);
        return;
      }
      if (msg.type === 'conflictPause') {
        conflictPaused = Boolean(msg.paused);
        if (conflictPaused) cancelAutoSave();
        return;
      }
```

- [ ] **Step 5: Best-effort save + unsubscribe on dispose**

Replace the dispose handler (lines 487-489):

```typescript
    webviewPanel.onDidDispose(() => {
      onDocChange.dispose();
    });
```

with:

```typescript
    webviewPanel.onDidDispose(() => {
      cancelAutoSave();
      onDocChange.dispose();
      onDocSave.dispose();
      // Safety net for the close path: if the webview flushed a final edit into
      // the document but the 1s auto-save hadn't fired yet, persist it now.
      if (document.isDirty && !conflictPaused) { void document.save(); }
    });
```

- [ ] **Step 6: Compile**

Run: `npm run compile`
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/mdEditorPlusProvider.ts
git commit -m "feat(save): extension-side auto-save, Cmd+S save, and save lifecycle events"
```

---

### Task 5: Wire the indicator, Cmd+S, flush triggers, and conflict events (index.ts)

**Files:**
- Modify: `src/webview/index.ts` — imports (`:5`), `HostMessage` (`:83-85`), edit callback (`:930-935`), keydown (`:945-954`), message listener (`:918`, `:971-996`), conflict banner handlers (`:271-296`); add indicator render + flush listeners

- [ ] **Step 1: Import the new modules and editor flush**

Add to the `./editor` import on line 5 — append `flushPendingEdit`:

```typescript
import { createEditor, updateContent, createSourceEditor, updateSourceContent, getSourceMarkdown, getCurrentMarkdown, setFrontmatterChangeListener, setMediaBaseUri, setReadOnly, getEditor, getSourceEditor, flushPendingEdit } from './editor';
```

Add a new import (after line 30, near the other `./` imports):

```typescript
import { nextSaveState, describeSaveState, SaveState, SaveEvent } from './saveState';
```

- [ ] **Step 2: Extend HostMessage with the saveState message**

Replace lines 83-85:

```typescript
interface InitMessage   { type: 'init';   markdown: string; defaults: SavedDefaults; mediaBaseUri?: string; documentPath?: string; workspaceName?: string | null; }
interface UpdateMessage { type: 'update'; markdown: string; source?: 'refresh' | 'external' }
type HostMessage = InitMessage | UpdateMessage;
```

with:

```typescript
interface InitMessage      { type: 'init';   markdown: string; defaults: SavedDefaults; mediaBaseUri?: string; documentPath?: string; workspaceName?: string | null; }
interface UpdateMessage    { type: 'update'; markdown: string; source?: 'refresh' | 'external' }
interface SaveStateMessage { type: 'saveState'; state: 'saving' | 'saved' | 'failed'; flash?: boolean }
type HostMessage = InitMessage | UpdateMessage | SaveStateMessage;
```

- [ ] **Step 3: Add the indicator state + render helpers inside init()**

Near the other top-of-`init` state declarations (after line 304, `let findBar...`), add:

```typescript
  let saveState: SaveState = 'saved';
  const saveIndicatorEl = document.getElementById('save-indicator');
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  function renderSaveIndicator(flash: boolean): void {
    if (!saveIndicatorEl) return;
    const v = describeSaveState(saveState);
    saveIndicatorEl.textContent = `${v.glyph} ${v.label}`;
    saveIndicatorEl.className = `save-indicator ${v.cssClass}${flash ? ' save-ind-flash' : ''}`;
    if (flash) {
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => saveIndicatorEl.classList.remove('save-ind-flash'), 1000);
    }
  }

  function applySaveEvent(event: SaveEvent, flash = false): void {
    saveState = nextSaveState(saveState, event);
    renderSaveIndicator(flash);
  }
```

- [ ] **Step 4: Mark unsaved on every local edit**

In the `createEditor` callback (lines 930-935), add `applySaveEvent('localEdit');` as the first line of the callback body:

```typescript
      const editorInstance = createEditor(editorEl, msg.markdown, (markdown) => {
        applySaveEvent('localEdit');
        currentMarkdown = markdown;
        lastSentMarkdown = normalizeMd(markdown);
        if (sourceMode && sourceEditorReady) updateSourceContent(markdown);
        vscode.postMessage({ type: 'edit', markdown });
      });
```

Also drive the indicator from Code-view edits: in `ensureSourceEditor` (the `createSourceEditor(sourceEditorEl, currentMarkdown, (md) => { ... })` callback, ~line 155-159), add `applySaveEvent('localEdit');` as the first line of that callback body so typing in the Code view marks the document unsaved too.

- [ ] **Step 5: Add the Cmd+S keybinding**

In the `document.addEventListener('keydown', ...)` block (lines 945-954), add a branch after the existing Cmd+F branch (after line 953's closing `}`):

```typescript
        if (mod && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          flushPendingEdit();
          // Read the ACTIVE editor — in Code view the latest text lives in the
          // source editor, not the preview one.
          const md = sourceMode ? getSourceMarkdown() : getCurrentMarkdown();
          currentMarkdown = md;
          lastSentMarkdown = normalizeMd(md);
          vscode.postMessage({ type: 'save', markdown: md });
        }
```

- [ ] **Step 6: Handle incoming saveState messages**

In the `window.addEventListener('message', ...)` handler, add a branch (place it just before the `if (msg.type === 'update' ...)` branch at line 971):

```typescript
    if (msg.type === 'saveState') {
      const event: SaveEvent =
        msg.state === 'saving' ? 'saveStarted' :
        msg.state === 'saved'  ? 'saveSucceeded' :
                                 'saveFailed';
      applySaveEvent(event, Boolean(msg.flash));
      return;
    }
```

- [ ] **Step 7: Drive conflict events + pause/resume from the banner**

In `showConflictBanner` (lines 271-274), add at the end of the function body:

```typescript
    applySaveEvent('conflictDetected');
    vscode.postMessage({ type: 'conflictPause', paused: true });
```

In `hideConflictBanner` (lines 275-278), add at the end of the function body:

```typescript
    applySaveEvent('conflictResolved');
    vscode.postMessage({ type: 'conflictPause', paused: false });
```

Note: the existing `#conflict-reload` handler (lines 279-288) adopts disk content and the `#conflict-keep` handler (lines 289-296) re-sends the local version as an `edit` — both already call `hideConflictBanner()`, so resume + auto-save resume happen automatically. The `keep` path's `edit` message restarts the extension's auto-save; the `reload` path leaves the document clean (`onDidSaveTextDocument` not needed — content matches disk).

- [ ] **Step 8: Flush pending edits when the view goes away**

At the end of `init()` (just before the final `vscode.postMessage({ type: 'ready' });` at line 1004), add:

```typescript
  // Never lose the last keystrokes: flush the pending edit on any teardown signal.
  window.addEventListener('blur', () => flushPendingEdit());
  window.addEventListener('pagehide', () => flushPendingEdit());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingEdit();
  });
```

- [ ] **Step 9: Compile**

Run: `npm run compile`
Expected: no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add src/webview/index.ts
git commit -m "feat(save): render save indicator, Cmd+S, flush-on-teardown, conflict wiring"
```

---

### Task 6: Indicator styling

**Files:**
- Modify: `src/webview/styles/editor.css` (after the `.toolbar-filename` rules near line 72-96)

- [ ] **Step 1: Add the indicator styles**

After the `.toolbar-filename.active { ... }` rule (around line 95-97), add:

```css
.save-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 2px;
  color: var(--toolbar-fg-muted, #8a8a8a);
  white-space: nowrap;
  user-select: none;
  transition: color 120ms ease, opacity 120ms ease;
}
.save-ind-saved    { color: var(--save-ok, #2e9e5b); }
.save-ind-unsaved  { color: var(--save-warn, #c9821f); }
.save-ind-saving   { color: var(--toolbar-fg-muted, #8a8a8a); }
.save-ind-conflict { color: var(--save-danger, #c44); }

/* Deliberate Cmd+S gets a brief acknowledging pulse. */
.save-ind-flash { animation: save-ind-pulse 1s ease; }
@keyframes save-ind-pulse {
  0%   { transform: scale(1);    opacity: 1; }
  25%  { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1);    opacity: 1; }
}
```

- [ ] **Step 2: Compile (bundles CSS via esbuild)**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/styles/editor.css
git commit -m "style(save): condensed save indicator states + Cmd+S flash"
```

---

### Task 7: Manual verification + close out c8

There is no DOM/vscode test harness in this repo, so the integration is verified by running the extension. Press F5 in VS Code (Extension Development Host) and open a markdown file with MD Editor Plus.

- [ ] **Step 1: Auto-save + resting state**
  - Type a sentence, stop. Within ~1s the indicator goes `⟳ Saving…` → `✓ Saved`.
  - Close the tab, reopen the file → your sentence is present. (Auto-save reached disk.)

- [ ] **Step 2: Dropped-keystroke regression (the original bug)**
  - Type a word and **immediately** close the tab (well under 1s).
  - Reopen → the word is present. (Flush-on-close fired the pending edit; dispose best-effort save persisted it.)

- [ ] **Step 2b: Code-view (source) regression**
  - Switch to Code view, type, and immediately close the tab. Reopen → the text is present.
  - In Code view, type and press Cmd+S → indicator confirms `✓ Saved`; reopen shows the Code-view edit (not stale preview content).

- [ ] **Step 3: Cmd+S feedback**
  - Type, then press Cmd+S (Ctrl+S on Windows/Linux). The indicator immediately shows `✓ Saved` with a brief pulse. File on disk is updated.

- [ ] **Step 4: Unsaved indicator**
  - Start typing — the indicator shows `• Unsaved` (amber) during the brief window before auto-save.

- [ ] **Step 5: External-edit conflict + auto-save pause**
  - Edit in the editor (leave it `Unsaved`/just-typed), then change the same file from another app or `git checkout`.
  - The conflict banner appears and the indicator shows `⚠ Edited elsewhere`; the file is **not** auto-overwritten.
  - Click **Reload from disk** → editor shows disk content, indicator returns to `✓ Saved`.
  - Repeat, click **Keep my version** → your version is written, indicator goes `⟳ Saving…` → `✓ Saved`.

- [ ] **Step 6: Full suite green**

Run: `npx jest`
Expected: only the known pre-existing `tests/toggle.test.ts` failure (per project memory); `flushableDebounce` and `saveState` suites pass.

- [ ] **Step 7: Mark c8 done in TODO.md**

In `TODO.md`, change the c8 row's `Status` cell from `Todo` to `Done` (the row whose `id` is `c8`).

- [ ] **Step 8: Commit**

```bash
git add TODO.md
git commit -m "chore(todo): mark c8 (save indicator + data-loss fix) done"
```

---

## Self-Review notes

- **Spec coverage:** Part 1 (flush-on-close + edits-reach-disk) → Tasks 3, 4 (dispose best-effort + auto-save). Part 2 (auto-save 1s + Cmd+S immediate) → Task 4 (`scheduleAutoSave`, `save` handler) + Task 5 (Cmd+S keybinding). Part 3 (four indicator states, extension-driven, can't lie, Cmd+S flash) → Tasks 2, 5, 6. Part 4 (conflict pauses auto-save, reuse banner) → Task 4 (`conflictPause`/`saveToDisk` gate) + Task 5 (banner wiring). All covered.
- **Type consistency:** message types `edit` / `save` / `conflictPause` / `saveState` and fields (`markdown`, `paused`, `state`, `flash`) match across `index.ts` and `mdEditorPlusProvider.ts`. `SaveState`/`SaveEvent` names match between `saveState.ts`, its test, and `index.ts`. `flushPendingEdit` is exported from `editor.ts`, stubbed in `editorMock.js`, imported in `index.ts`.
- **Residual risk (documented, accepted):** the close path relies on the webview delivering its flushed `edit` before teardown plus the provider's dispose-time `document.save()` of the already-dirty doc. This is best-effort (VS Code does not guarantee message delivery during disposal) but closes the realistic data-loss window; the manual Step 2 verifies it.
