# Save Indicator + Data-Loss Fix — Design

**TODO item:** c8 (Urgent)
**Date:** 2026-06-06
**Branch:** `fix/save-indicator-data-loss`

## Problem

A user edited a file, closed it, reopened it, and saw the **old** version — their
changes were lost. There is also no way to tell whether the file you are looking at
is saved, and Cmd+S does nothing.

### Root cause (verified)

Two independent leaks, both real:

1. **Dropped debounce on close.** Editor changes are buffered in a 500ms debounce
   timer ([editor.ts:131-137](../../../src/webview/editor.ts#L131-L137)). On close,
   `destroyEditor()` *clears* that timer without firing it
   ([editor.ts:186-190](../../../src/webview/editor.ts#L186-L190)), and the webview
   dispose handler does no flush ([mdEditorPlusProvider.ts:487-489](../../../src/mdEditorPlusProvider.ts#L487-L489)).
   Any edits made in the last 500ms before closing are silently discarded.

2. **Edits never reach disk on their own.** When an `edit` message arrives, the
   extension applies it to the in-memory `TextDocument` via `_applyEdit`
   ([mdEditorPlusProvider.ts:495-505](../../../src/mdEditorPlusProvider.ts#L495-L505)),
   which only marks the document *dirty*. Nothing writes it to disk unless the user
   (or VS Code's global autosave, which may be off) saves it. There is **no Cmd+S
   handler** in the webview and **no save indicator** anywhere.

So the changes were real but never persisted, and nothing told the user.

## Goal

The user should never lose work again, should be able to glance and know the file is
safe, and should get instant confirmation on a deliberate Cmd+S.

## Approach

Chosen: **auto-save + manual save**, with the extension as the single source of truth
for save state.

- The webview already debounces edits and posts `edit` messages. We keep that, fix
  the flush bug, add an explicit `save` path for Cmd+S, and add a `saveState`
  message stream from the extension that drives a condensed indicator.
- Auto-save is implemented by the **extension** (`document.save()` after applying an
  edit), not by relying on VS Code's global `files.autoSave` — so behavior is
  consistent regardless of the user's settings, and the indicator reflects real disk
  state.

Rejected alternatives:
- *Rely on VS Code `files.autoSave`* — depends on a global setting we don't control,
  and gives no hook for a custom, trustworthy indicator.
- *Always-keep-mine on external conflict* — can silently destroy edits made elsewhere.

## Design

### 1. Fix data loss (core, non-negotiable)

- **Flush on close / blur / hide.** Before the editor is destroyed or the webview is
  hidden, flush any pending debounced edit synchronously and post it. Trigger points:
  - webview `window` `blur` and `pagehide`/`visibilitychange→hidden`,
  - editor `onBlur`,
  - `destroyEditor()` fires the pending timer's callback instead of clearing it.
- **Flush before save.** Cmd+S and auto-save both read the editor's latest content
  directly via `getCurrentMarkdown()` ([editor.ts:180-184](../../../src/webview/editor.ts#L180-L184))
  rather than waiting on the debounce, so the most recent keystroke is always included.

### 2. Auto-save + manual save

- **Auto-save:** ~1 second (1000ms) after the last keystroke, the extension applies
  the edit to the document and calls `document.save()` to write disk. The 1s timer
  resets on each keystroke.
- **Cmd+S:** the webview intercepts `Cmd/Ctrl+S` (added alongside the existing Cmd+F /
  Cmd+Shift+O handlers in [index.ts](../../../src/webview/index.ts)), cancels the
  pending auto-save timer, flushes the latest content, and requests an immediate save.
  On completion the indicator flashes the **Saved** state brighter for ~1s.
- **Save is gated by conflict state** (see §4): if a conflict is pending, auto-save
  and Cmd+S do not write — they surface the banner instead.

### 3. Indicator (condensed, next to filename)

A small, muted indicator immediately after `filename.md` in the toolbar
([mdEditorPlusProvider.ts:568](../../../src/mdEditorPlusProvider.ts#L568)). Four states,
each a colored dot/glyph + short label:

| State | Display | Meaning |
|---|---|---|
| Unsaved | `• Unsaved` (amber) | Local changes not yet on disk |
| Saving… | `⟳ Saving…` | Disk write in progress |
| Saved | `✓ Saved` (green, calm resting) | Disk matches the editor |
| Conflict | `⚠ Edited elsewhere` | External change while local edits pending |

State ownership and flow:

- The **extension** is the single source of truth. It posts `{ type: 'saveState',
  state, flash? }` to the webview on transitions:
  - editor reports local change → `unsaved`
  - extension begins `document.save()` → `saving`
  - `onDidSaveTextDocument` for this document fires → `saved`
  - conflict detected (existing logic) → `conflict`
- On `Cmd+S` completion the extension sends `saved` with `flash: true`; the webview
  briefly intensifies the Saved styling, then settles.
- The webview's indicator is a **pure reflection** of the latest `saveState` message —
  it computes nothing on its own, so it cannot show "Saved" while changes are actually
  pending.
- On `init`/reopen, the extension seeds the indicator from `document.isDirty`
  (normally `saved` on a fresh open).

### 4. External-edit safety

Reuse the existing conflict banner
([index.ts:260-296](../../../src/webview/index.ts#L260-L296), trigger at
[index.ts:980-990](../../../src/webview/index.ts#L980-L990)):

- When an external `update` arrives and there are unsaved local edits, the banner
  shows (**Reload from disk** / **Keep my version**) and the indicator switches to
  `conflict`.
- **Auto-save pauses** while a conflict is pending (`pendingExternalMarkdown !== null`):
  no `document.save()` is triggered until the user resolves it. This prevents
  auto-save from clobbering the external version.
- Resolving via **Reload** adopts disk content (indicator → `saved`); **Keep mine**
  pushes the local version and resumes normal save (indicator → `saving` → `saved`).

## Components / interfaces

- **`src/webview/editor.ts`** — flush-on-destroy/blur; expose a `flushPendingEdit()`
  that fires the debounced callback immediately. `getCurrentMarkdown()` already exists.
- **`src/webview/index.ts`** — Cmd+S key handler; `saveState` message → indicator DOM
  update; flush triggers on blur/pagehide; render the indicator element next to the
  filename.
- **`src/mdEditorPlusProvider.ts`** — auto-save debounce (~1s) that calls
  `document.save()`; `onDidSaveTextDocument` subscription → post `saveState: 'saved'`;
  `save` message handler (Cmd+S) → immediate save + flash; gate saves on conflict;
  seed indicator on init.
- **Indicator markup/CSS** — new condensed indicator in the toolbar HTML + styles
  (amber/green/spinner/warn), matching existing toolbar typography.

## Error handling

- If `document.save()` rejects (e.g., read-only file, disk error), the indicator
  returns to `unsaved` and a non-blocking VS Code error message is shown; edits remain
  in memory (not lost).
- Flush-on-close is best-effort synchronous; the webview posts the final `edit` before
  teardown so the extension can persist it.

## Testing

- **Unit / behavior:**
  - Edit then immediately close → reopen shows the edit (regression test for the
    dropped-debounce bug).
  - Auto-save fires ~1s after edits; `document.save()` called; `saved` state emitted.
  - Cmd+S triggers immediate save and `flash` state.
  - External change while dirty → `conflict` state, auto-save suppressed until resolved.
- **Manual smoke (run the extension):**
  - Type, wait, confirm `✓ Saved`; reopen file shows latest.
  - Type and immediately close the tab; reopen → edits present.
  - Edit here, change the file externally → banner + `⚠ Edited elsewhere`.

## Out of scope (YAGNI)

- Side-file backups on conflict (considered, declined).
- Per-file or configurable auto-save cadence (fixed ~1s; Cmd+S always immediate).
- Save history / versioning.
