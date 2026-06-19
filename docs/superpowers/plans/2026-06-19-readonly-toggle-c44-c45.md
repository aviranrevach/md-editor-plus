# Read-only Toggle + No-Persist + Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make read-only a real toggle switch that never persists (every file opens editable) and is unmistakable when on — a 🔒 toolbar pill plus a top-right "Enable editing?" notification when you try to type (c44 + c45).

**Architecture:** A single `readonlyState` controller is the one place that flips state — it toggles the `read-only` class on `<html>`, sets the editor's editability, syncs the settings toggle-switch, and shows/hides the pill. A separate `readonlyNotice` module renders the dark top-right "you tried to edit" card. Both are small, dependency-injected, jsdom-testable units; `index.ts` wires them to the real DOM, and persistence (global config read/write) is removed so read-only is purely transient.

**Tech Stack:** TypeScript, Jest + ts-jest + jsdom, esbuild (CSS bundled as text).

## Global Constraints

- Read-only **never persists**: every document opens editable; toggling it writes nothing to config and posts no save message. (verbatim from spec)
- Read-only still **hides the caret** when on — keep `html.read-only .ProseMirror { caret-color: transparent }` (`src/webview/styles/editor.css:2886`) intact.
- The toggle switch must reuse the existing `.toggle-switch` component (`role="switch"`, `aria-checked`, `.on` when active) — do NOT invent a new switch.
- Read-only still blocks editing when on (`editor.setEditable(false)`); turning it off restores editing + caret.
- CSS is bundled at build time, so any run/verify step requires `npm run compile` first.
- Do NOT modify `TODO.md` (living doc, edited by another session).

---

### Task 1: `readonlyState` controller (transient, no persistence)

**Files:**
- Create: `src/webview/readonlyState.ts`
- Test: `tests/readonly-state.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ReadOnlyDeps { root: HTMLElement; toggleSwitch: HTMLElement | null; pill: HTMLElement | null; setEditable: (editable: boolean) => void; }`
  - `interface ReadOnlyController { set(on: boolean): void; get(): boolean; }`
  - `function createReadOnlyController(deps: ReadOnlyDeps): ReadOnlyController`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment jsdom
 */
import { createReadOnlyController } from '../src/webview/readonlyState';

function setup() {
  const root = document.createElement('html');
  const toggleSwitch = document.createElement('button');
  const pill = document.createElement('span');
  pill.hidden = true;
  const editableCalls: boolean[] = [];
  const ctrl = createReadOnlyController({
    root, toggleSwitch, pill,
    setEditable: (e) => editableCalls.push(e),
  });
  return { root, toggleSwitch, pill, editableCalls, ctrl };
}

describe('readonlyState controller', () => {
  test('starts editable', () => {
    expect(setup().ctrl.get()).toBe(false);
  });

  test('set(true) locks everything', () => {
    const { root, toggleSwitch, pill, editableCalls, ctrl } = setup();
    ctrl.set(true);
    expect(ctrl.get()).toBe(true);
    expect(root.classList.contains('read-only')).toBe(true);
    expect(toggleSwitch.classList.contains('on')).toBe(true);
    expect(toggleSwitch.getAttribute('aria-checked')).toBe('true');
    expect(pill.hidden).toBe(false);
    expect(editableCalls).toEqual([false]);
  });

  test('set(false) unlocks everything', () => {
    const { root, toggleSwitch, pill, editableCalls, ctrl } = setup();
    ctrl.set(true);
    ctrl.set(false);
    expect(ctrl.get()).toBe(false);
    expect(root.classList.contains('read-only')).toBe(false);
    expect(toggleSwitch.classList.contains('on')).toBe(false);
    expect(toggleSwitch.getAttribute('aria-checked')).toBe('false');
    expect(pill.hidden).toBe(true);
    expect(editableCalls).toEqual([false, true]);
  });

  test('null toggleSwitch/pill are tolerated', () => {
    const root = document.createElement('html');
    const ctrl = createReadOnlyController({ root, toggleSwitch: null, pill: null, setEditable: () => {} });
    expect(() => ctrl.set(true)).not.toThrow();
    expect(root.classList.contains('read-only')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/readonly-state.test.ts`
Expected: FAIL — `createReadOnlyController` not found (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/webview/readonlyState.ts
//
// Single source of truth for read-only mode. Flips the editor's editability
// and keeps every read-only affordance (the <html> class that hides the caret,
// the settings toggle-switch, the toolbar pill) in sync. State is transient —
// it is never persisted, so every document opens editable (c44).

export interface ReadOnlyDeps {
  /** documentElement — gets the `read-only` class toggled (drives caret CSS). */
  root: HTMLElement;
  /** the settings `.toggle-switch` button (role="switch"); null-safe. */
  toggleSwitch: HTMLElement | null;
  /** the toolbar pill; shown only while read-only; null-safe. */
  pill: HTMLElement | null;
  /** flips the editor's editability (wraps editor.setEditable). */
  setEditable: (editable: boolean) => void;
}

export interface ReadOnlyController {
  set(on: boolean): void;
  get(): boolean;
}

export function createReadOnlyController(deps: ReadOnlyDeps): ReadOnlyController {
  let state = false;

  function set(on: boolean): void {
    state = on;
    deps.root.classList.toggle('read-only', on);
    if (deps.toggleSwitch) {
      deps.toggleSwitch.classList.toggle('on', on);
      deps.toggleSwitch.setAttribute('aria-checked', String(on));
    }
    if (deps.pill) deps.pill.hidden = !on;
    deps.setEditable(!on);
  }

  return { set, get: () => state };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/readonly-state.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/readonlyState.ts tests/readonly-state.test.ts
git commit -m "feat(c44): transient read-only state controller (no persistence)"
```

---

### Task 2: `readonlyNotice` edit-attempt notification

**Files:**
- Create: `src/webview/readonlyNotice.ts`
- Test: `tests/readonly-notice.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ReadOnlyNoticeDeps { container: HTMLElement; onEnableEditing: () => void; autoDismissMs?: number; }`
  - `interface ReadOnlyNotice { show(): void; destroy(): void; }`
  - `function createReadOnlyNotice(deps: ReadOnlyNoticeDeps): ReadOnlyNotice`
  - Rendered DOM: a `.readonly-notice` card containing `.readonly-notice-enable` (Enable editing) and `.readonly-notice-dismiss` (Dismiss/✕).

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment jsdom
 */
import { createReadOnlyNotice } from '../src/webview/readonlyNotice';

describe('readonlyNotice', () => {
  test('show() renders exactly one notice', () => {
    const container = document.createElement('div');
    createReadOnlyNotice({ container, onEnableEditing: () => {} }).show();
    expect(container.querySelectorAll('.readonly-notice').length).toBe(1);
  });

  test('second show() re-arms, does not stack', () => {
    const container = document.createElement('div');
    const n = createReadOnlyNotice({ container, onEnableEditing: () => {} });
    n.show();
    n.show();
    expect(container.querySelectorAll('.readonly-notice').length).toBe(1);
  });

  test('Enable editing button invokes the callback and hides the notice', () => {
    const container = document.createElement('div');
    let enabled = false;
    const n = createReadOnlyNotice({ container, onEnableEditing: () => { enabled = true; } });
    n.show();
    container.querySelector<HTMLElement>('.readonly-notice-enable')!.click();
    expect(enabled).toBe(true);
    expect(container.querySelectorAll('.readonly-notice').length).toBe(0);
  });

  test('auto-dismiss removes the notice after the timeout', () => {
    jest.useFakeTimers();
    const container = document.createElement('div');
    createReadOnlyNotice({ container, onEnableEditing: () => {}, autoDismissMs: 1000 }).show();
    expect(container.querySelectorAll('.readonly-notice').length).toBe(1);
    jest.advanceTimersByTime(1000);
    expect(container.querySelectorAll('.readonly-notice').length).toBe(0);
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/readonly-notice.test.ts`
Expected: FAIL — `createReadOnlyNotice` not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/webview/readonlyNotice.ts
//
// The "you tried to edit a locked file" notification: a dark, top-right card
// that appears when the user attempts to type while read-only (c44). One at a
// time — a second trigger re-arms the auto-dismiss timer instead of stacking.

export interface ReadOnlyNoticeDeps {
  /** where the card is appended (e.g. document.body). */
  container: HTMLElement;
  /** called when the user clicks "Enable editing". */
  onEnableEditing: () => void;
  /** auto-dismiss delay in ms (default 4000). */
  autoDismissMs?: number;
}

export interface ReadOnlyNotice {
  show(): void;
  destroy(): void;
}

export function createReadOnlyNotice(deps: ReadOnlyNoticeDeps): ReadOnlyNotice {
  const dismissMs = deps.autoDismissMs ?? 4000;
  let el: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function hide(): void {
    if (timer) { clearTimeout(timer); timer = undefined; }
    el?.remove();
    el = null;
  }

  function build(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'readonly-notice';
    card.setAttribute('role', 'status');

    const row = document.createElement('div');
    row.className = 'readonly-notice-row';
    // The message stays on one line (CSS white-space: nowrap), "read-only" bold.
    row.innerHTML = '<span class="readonly-notice-ic">\u{1F512}</span>'
      + '<span class="readonly-notice-msg">This file is <b>read-only</b>. Enable editing?</span>';
    const x = document.createElement('span');
    x.className = 'readonly-notice-x';
    x.textContent = '✕';
    x.addEventListener('click', hide);
    row.appendChild(x);

    const acts = document.createElement('div');
    acts.className = 'readonly-notice-acts';
    const dismiss = document.createElement('button');
    dismiss.className = 'readonly-notice-dismiss';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', hide);
    const enable = document.createElement('button');
    enable.className = 'readonly-notice-enable';
    enable.textContent = 'Enable editing';
    enable.addEventListener('click', () => { deps.onEnableEditing(); hide(); });
    acts.append(dismiss, enable);

    card.append(row, acts);
    return card;
  }

  function show(): void {
    if (!el) {
      el = build();
      deps.container.appendChild(el);
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(hide, dismissMs);
  }

  return { show, destroy: hide };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/readonly-notice.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/readonlyNotice.ts tests/readonly-notice.test.ts
git commit -m "feat(c44): edit-attempt read-only notification module"
```

---

### Task 3: Wire it all up — toggle switch, pill, notice trigger, remove persistence

**Files:**
- Modify: `src/mdEditorPlusProvider.ts` (toggle-switch row, toolbar pill, remove action button + saveReadOnly handler + readOnly default)
- Modify: `src/webview/index.ts` (instantiate controller + notice, wire clicks, init editable, edit-attempt trigger, remove saveReadOnly post)
- Modify: `src/webview/styles/editor.css` (pill + notice styles; remove action-button `.active` styling)

**Interfaces:**
- Consumes: `createReadOnlyController` (Task 1), `createReadOnlyNotice` (Task 2).
- Produces: a fully wired, non-persisting read-only mode with switch + pill + notice.

- [ ] **Step 1: Add the toolbar pill markup.** In `src/mdEditorPlusProvider.ts`, in the `#toolbar` block, immediately after the `save-indicator` span (currently `<span class="save-indicator" id="save-indicator" aria-live="polite"></span>`), add:

```html
    <button class="readonly-pill" id="readonly-pill" hidden data-tip="Read-only — click to enable editing">${iLock}<span>Read only</span></button>
```

- [ ] **Step 2: Replace the action button with a toggle-switch row.** In `src/mdEditorPlusProvider.ts`:
  - DELETE the action button line in `#actions-panel-dots`:
    `<button class="settings-action act-toggle-readonly" id="act-toggle-readonly" ...>${iLock}<span class="settings-action-label">Read only</span></button>`
  - In the **"Editing"** `settings-section` (the one containing Smart typography), ADD a row BEFORE the Smart typography row:

```html
      <div class="settings-row" data-tip="Lock this file — blocks typing and structural edits (never persists; reopen to edit)">
        <span class="settings-row-icon">${iLock}</span>
        <span class="settings-row-label">Read only</span>
        <button class="toggle-switch" id="readonly-toggle" role="switch" aria-checked="false"></button>
      </div>
```

- [ ] **Step 3: Remove persistence in the provider.** In `src/mdEditorPlusProvider.ts`:
  - DELETE the `readOnly: cfg.get<boolean>('readOnly', false),` line from the defaults object (~line 187).
  - DELETE the entire `if (msg.type === 'saveReadOnly') { ... }` handler block (~lines 473-478):

```ts
      if (msg.type === 'saveReadOnly') {
        const value = (msg as unknown as { value?: unknown }).value;
        if (typeof value !== 'boolean') return;
        const cfg = vscode.workspace.getConfiguration('mdEditorPlus');
        await cfg.update('readOnly', value, vscode.ConfigurationTarget.Global);
        return;
      }
```

- [ ] **Step 4: Rewire `index.ts`.** In `src/webview/index.ts`:
  - Add imports near the other webview imports:

```ts
import { createReadOnlyController } from './readonlyState';
import { createReadOnlyNotice } from './readonlyNotice';
```

  - REPLACE the element lookup `const readOnlyActionBtn = document.getElementById('act-toggle-readonly') ...` with:

```ts
  const readOnlyToggle = document.getElementById('readonly-toggle') as HTMLElement | null;
  const readOnlyPill   = document.getElementById('readonly-pill')   as HTMLElement | null;
```

  - REPLACE the `function applyReadOnly(on) { ... }` definition (~lines 950-957) with a controller + notice and a thin `applyReadOnly` wrapper:

```ts
  const roController = createReadOnlyController({
    root: document.documentElement,
    toggleSwitch: readOnlyToggle,
    pill: readOnlyPill,
    setEditable: (editable) => setReadOnly(!editable),
  });
  const roNotice = createReadOnlyNotice({
    container: document.body,
    onEnableEditing: () => applyReadOnly(false),
  });
  function applyReadOnly(on: boolean): void {
    roController.set(on);
  }
```

  - REPLACE the old `readOnlyActionBtn?.addEventListener('click', ...)` block (~lines 260-264) with switch + pill wiring (note: **no** `vscode.postMessage` — nothing persists):

```ts
  readOnlyToggle?.addEventListener('click', () => {
    applyReadOnly(!roController.get());
  });
  readOnlyPill?.addEventListener('click', () => {
    applyReadOnly(false);
  });
```

  - CHANGE the init call (`applyReadOnly(Boolean(d.readOnly));`, ~line 946) to always open editable:

```ts
    applyReadOnly(false);
```

  - ADD an edit-attempt trigger near the other `document` listeners in `init()` (after `roController`/`roNotice` are defined). It fires the notice when a printable key (or Enter/Backspace/Delete) is pressed while read-only, inside an editor surface:

```ts
  document.addEventListener('keydown', (e) => {
    if (!roController.get()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // shortcuts aren't edits
    const isEdit = e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete';
    if (!isEdit) return;
    const t = e.target as HTMLElement | null;
    if (!t?.closest('.ProseMirror, .bd-table-cell, .board-panel-body')) return;
    roNotice.show();
  }, true);
```

- [ ] **Step 5: Add CSS, remove the old action-button styling.** In `src/webview/styles/editor.css`:
  - DELETE the `.settings-action.act-toggle-readonly.active { ... }` rule and its `... .active svg { ... }` sibling (~lines 2890-2893). **KEEP** `html.read-only .ProseMirror { caret-color: transparent; }` (~line 2886).
  - ADD the pill + notice styles:

```css
/* Read-only toolbar pill — visible only while read-only; click to enable editing. */
.readonly-pill {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--link-subtle-bg, #eef1ff); color: var(--link, #3b53d6);
  border: 1px solid var(--link-subtle-border, #d4dcff); border-radius: 999px;
  padding: 2px 9px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.readonly-pill[hidden] { display: none; }
.readonly-pill svg { width: 13px; height: 13px; }

/* Read-only "you tried to edit" notification — dark, top-right, one line. */
.readonly-notice {
  position: fixed; top: 52px; right: 14px; z-index: 1000;
  width: max-content; background: #2b2b29; color: #f5f5f3;
  border-radius: 8px; box-shadow: 0 8px 26px rgba(0,0,0,.30);
  font-family: var(--font-board, sans-serif);
}
.readonly-notice-row {
  display: flex; align-items: center; gap: 9px;
  padding: 12px 13px 10px; font-size: 13px; white-space: nowrap;
}
.readonly-notice-msg b { color: #fff; }
.readonly-notice-x { opacity: .4; cursor: pointer; font-size: 12px; padding-left: 6px; }
.readonly-notice-acts { display: flex; justify-content: flex-end; gap: 8px; padding: 0 13px 12px; }
.readonly-notice-dismiss, .readonly-notice-enable {
  font-size: 12px; border-radius: 5px; padding: 4px 11px; cursor: pointer; border: none;
}
.readonly-notice-dismiss { color: #cfcfcb; background: transparent; border: 1px solid #4a4a47; }
.readonly-notice-enable { background: var(--link, #2383e2); color: #fff; font-weight: 600; }
```

- [ ] **Step 6: Type-check + build.**

Run: `npm run compile`
Expected: `Webview built.` with no TypeScript errors. (If `iLock` is reported unused, it is still used by the pill markup — confirm the action-button reference was the only removal.)

- [ ] **Step 7: Run the unit suites to confirm nothing regressed.**

Run: `npx jest tests/readonly-state.test.ts tests/readonly-notice.test.ts`
Expected: PASS (8 tests total). The controller + notice still behave as wired.

- [ ] **Step 8: Commit**

```bash
git add src/mdEditorPlusProvider.ts src/webview/index.ts src/webview/styles/editor.css
git commit -m "feat(c44,c45): real read-only toggle + pill + edit-notice, drop persistence"
```

---

### Task 4: Visual verification + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the wired feature from Task 3.
- Produces: confirmed real-app behavior + release note.

- [ ] **Step 1: Launch the extension** (F5 / Extension Development Host) on a file with a board and some text.

- [ ] **Step 2: Verify it opens editable** — even though read-only may have been left ON globally before this change, the document opens **editable** (caret visible, typing works). — c44

- [ ] **Step 3: Verify the toggle** — open the ⋯/settings menu; "Read only" is now a **switch** (in the Editing section), not a highlighted button. Flip it on: typing is blocked, caret disappears, and the **🔒 Read only pill** appears in the toolbar. Flip it off (or click the pill): editing + caret return.

- [ ] **Step 4: Verify the notice** — with read-only on, click into the description / a paragraph / a table cell and **type**. The dark **top-right** card appears: "This file is **read-only**. Enable editing?" with Enable editing / Dismiss. "Enable editing" unlocks; the card auto-dismisses after a few seconds otherwise.

- [ ] **Step 5: Verify no persistence** — turn read-only on, close and reopen the file (and/or reload the window). It opens **editable** again. — c44

- [ ] **Step 6: Add the CHANGELOG entry.** Under `## [Unreleased]` in `CHANGELOG.md`, add (or extend) a `### Changed` and `### Fixed` as appropriate:

```markdown
### Changed

- **Read-only is now a real toggle** — the "Read only" control in the ⋯ menu is a proper on/off switch (like the other settings), not a button with a hard-to-read blue highlight. (c45)

### Fixed

- **Read-only can no longer get silently stuck** — it used to be a global setting that, once on, locked every file in every window until you found and unflipped it (with no indication, which made the editor feel broken). Now read-only never persists: every file opens editable, and you opt in per session. When it *is* on, a 🔒 "Read only" pill shows in the toolbar (click to unlock), and trying to type pops a "This file is read-only — Enable editing?" notification. (c44)
```

- [ ] **Step 7: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for read-only toggle + indicators (c44, c45)"
```

- [ ] **Step 8: Hand back to the user** to mark c44 and c45 Done in `TODO.md` (do not edit it here — another session owns it) and to choose merge/PR via the finishing-a-development-branch skill.

---

## Notes for the implementer

- The webview CSP blocks `fetch()` — not relevant here (no network), don't introduce any.
- `iLock` is an existing icon constant already imported in `mdEditorPlusProvider.ts` (used by the old action button) — reuse it for both the pill and the toggle row.
- The board `<td>` cells remain editable while read-only (they re-enable contenteditable on click); that is a known, separate masking bug and intentionally NOT addressed here — do not try to fix it in this plan.
