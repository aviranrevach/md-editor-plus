# Read-only: real toggle, no stickiness, clear signals — c44 + c45

**Date:** 2026-06-19
**Branch:** `feature/readonly-toggle-c44-c45`
**TODO items:** c44 (read-only was silently ON globally and hid the cursor everywhere — make it un-stickable + add a clear indicator), c45 (replace the confusing blue "active" button with a real toggle switch)

## Background / root cause

A debugging session traced a broad "I click but can't type" report (no caret in card descriptions, kanban titles, plain tables) to a single cause: the editor was in **read-only mode** the whole time. In read-only, `html.read-only .ProseMirror { caret-color: transparent }` (`src/webview/styles/editor.css:2886`) hides the caret on every ProseMirror surface, while board `<td>` cells (not `.ProseMirror`, and re-enabled on click) kept editing — masking the locked state.

Two compounding problems made this a silent trap:

1. **Read-only persists globally.** It is read from `cfg.get('readOnly', false)` (`src/mdEditorPlusProvider.ts:187`) and saved to `ConfigurationTarget.Global` (`:477`, via the `saveReadOnly` message). One stray click locks **every** markdown file in **every** window, permanently, until toggled back.
2. **The control is a disguised toggle.** "Read only" is an action button (`act-toggle-readonly`, `src/mdEditorPlusProvider.ts:996`) in the same group as Copy / Duplicate / Export, signalling state only via a blue `.active` highlight — unlike the 8 genuine settings that use the `.toggle-switch` component (`role="switch"`, sliding knob). There is no indicator that the mode is on.

## Goals

- Read-only can never get silently stuck (chosen behavior: **never persist** — always opens editable; opt in per session).
- Read-only uses the same **real toggle switch** as every other setting.
- When read-only is on, it is **obvious**: a glanceable pill, plus an explanation the moment you try to edit.

Non-goal: changing what read-only *does* when on (it still blocks typing/structural edits). Board `<td>` cells bypassing read-only is a separate known issue, out of scope here.

## Design

### 1. Behavior — never persists (c44 core)

- **Init always editable.** Stop applying a persisted value: the document always opens with read-only OFF, regardless of any stored config. Concretely, init no longer derives read-only from `cfg.get('readOnly')` — it starts `false`.
- **Transient, per-document state.** Toggling read-only sets an in-memory state for the current editor only. It is **not** persisted: remove the `saveReadOnly` round-trip (webview no longer asks the host to persist; host no longer writes `readOnly` to global config). Reopen the file or restart → editable again.
- The existing `applyReadOnly(on)` path stays as the single place that flips state: toggles the `read-only` class on `<html>`, calls `setReadOnly(on)` (→ `editor.setEditable(!on)`), and now also drives the pill + switch (below). It simply no longer triggers persistence.

### 2. The toggle switch (c45)

- Replace the `act-toggle-readonly` **action button** with a **`.toggle-switch` row** identical in markup/behavior to its siblings (e.g. `smart-typography-toggle`): a labeled row "Read only" with a one-line description ("Lock this file — no typing or edits") and a `button.toggle-switch` (`role="switch"`, `aria-checked`, `.on` when active).
- Place it in the ⋯ settings menu **with the other switches**, not in the document-action group.
- Wire it through the existing toggle-switch pattern in `src/webview/index.ts` (mirror `smartTypographyToggle` etc.), but its handler calls `applyReadOnly(on)` and does **not** post a persistence message.
- Remove the now-obsolete `.act-toggle-readonly.active` styling.

### 3. The pill (A — always-on signal)

- While read-only is on, show a **🔒 Read only** pill in the editor toolbar near the title. Hidden entirely when editable.
- Clicking the pill **exits read-only** (calls `applyReadOnly(false)`), so the mode can never trap you.
- Visibility is driven by the same single state in `applyReadOnly`, so pill, switch, and `<html>.read-only` never disagree.

### 4. The "you tried to edit" notification (B — refined option C)

- Trigger: the user attempts to edit while read-only (a printable keydown / `beforeinput` on the locked main editor). Detect at the editor level so it fires for the main document; descriptions/cells route through the same locked editor state.
- Appearance: a **dark/inverted card, top-right** of the editor, sized to its content on **one line** (no wrap):
  - 🔒 icon + **This file is `read-only`. Enable editing?** ("read-only" bold)
  - Buttons: **Enable editing** (primary — calls `applyReadOnly(false)`) and **Dismiss**; plus a small ✕.
- Auto-dismiss after a few seconds; re-trigger on the next edit attempt. Only one instance at a time (re-arm/replace, don't stack).

## Components & boundaries

- **read-only state controller** (extend existing `applyReadOnly` in `index.ts`): the single source of truth. Inputs: `on:boolean`. Effects: `<html>.read-only` class, `setReadOnly`, switch `aria-checked`/`.on`, pill visibility. No persistence. Everything else *reads* this; nothing else flips the class directly.
- **toggle switch** (markup in `mdEditorPlusProvider.ts`, wiring in `index.ts`): calls the controller.
- **pill** (toolbar element + click handler): calls the controller with `false`.
- **edit-attempt notifier** (small module): listens for edit attempts on the locked editor, renders/auto-dismisses the top-right card, buttons call the controller.

## Testing

- **State controller (unit, jsdom):** starts editable; `applyReadOnly(true)` sets `<html>.read-only`, switch `aria-checked=true`, pill visible; `applyReadOnly(false)` reverses all three. No `saveReadOnly` message is ever posted (persistence removed).
- **No-persistence (unit):** init does not read `cfg.get('readOnly')` into the applied state — opening always yields editable even if a stale global value exists.
- **Notifier (unit, jsdom):** an edit attempt while locked renders exactly one notification; "Enable editing" invokes the controller with `false`; a second edit attempt re-arms rather than stacking.
- Pill/notification *visual* placement is verified in the running app (Extension Dev Host).

## Out of scope

- Caret-color CSS (the abandoned c25/c7 branch) — the caret was only invisible *because* of read-only; no CSS change needed.
- Board `<td>` cells remaining editable in read-only (separate masking bug; note for a future item).

## Acceptance

- Every document opens **editable**; toggling read-only never persists across reopen/restart. — c44
- "Read only" is a **toggle switch** beside the other settings; the blue action-button is gone. — c45
- When read-only is on: the **🔒 pill** shows in the toolbar (click exits); trying to type shows the **top-right "This file is read-only. Enable editing?"** notification. — c44
- Read-only mode still blocks editing; read-only still hides the caret (unchanged); turning it off restores normal editing + caret everywhere.
