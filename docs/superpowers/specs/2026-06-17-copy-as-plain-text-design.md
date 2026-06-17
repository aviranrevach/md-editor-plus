# Copy as Plain Text (C23) — Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)

## Goal

Give users a one-click way to copy the current text selection as **pure visible
text** — no colors, no markdown markers (`**bold**`, `_italic_`), no HTML tags.

This solves the symptom captured in C23: copying styled text and pasting it into a
**plain-text destination** (chat box, code comment, terminal, plain email field)
today drags along raw markup like `<span style="color: rgb(0, 0, 0);">…</span>`.
The colored text has no markdown equivalent, so the markdown serializer falls back
to literal HTML and that markup lands in the clipboard.

Normal copy (rich → rich, e.g. page → Word) already works and is left untouched.
This feature is the clean escape hatch for the plain-text case.

## Scope

**In scope**
- A new **"Copy as plain text"** button in the existing selection toolbar
  (the floating bubble menu that appears when text is highlighted).
- Extract the selection as plain visible text and write it to the system clipboard.
- A confirmation toast on success.

**Out of scope (YAGNI)**
- No keyboard shortcut.
- No custom right-click / native context menu.
- No "clean markdown" variant (keeping `**bold**` but dropping color) — the chosen
  behavior is pure visible words only.
- No change to the default copy behavior.

## Placement

The button lives on the **top row** of the bubble menu, immediately **after the
divider, next to the inline-code button** (`bubbleMenu.ts`, first `.bubble-row`):

```
Row 1:  B  I  U  S  |  </>  [Copy as plain text]
Row 2:  🔗  A  🖍  🙂  |  ⋯  ✦
```

Rationale: the top row is always visible the moment text is selected, making the
action maximally discoverable. Icon: clipboard glyph (placeholder — final glyph TBD
during implementation, may be refined to read more clearly as "plain text"); tooltip
text **"Copy as plain text"**.

## How it works

1. **Trigger** — user highlights text; the bubble menu appears; user clicks the new
   button (`data-action="copy-plain"`).
2. **Extract** — in the webview, read the current ProseMirror selection and produce
   plain text via `editor.state.doc.textBetween(from, to, '\n\n', '\n')`:
   - `'\n\n'` as the block separator (blank line between block nodes),
   - `'\n'` as the leaf separator (e.g. hard breaks).
   This yields readable text with paragraph breaks and **no marks or markup**.
   - If the selection is empty (`from === to`), do nothing (the bubble menu only
     shows on a non-empty selection, so this is a guard, not a path users hit).
3. **Write to clipboard** — post the extracted text to the host:
   `vscode.postMessage({ type: 'copyText', text })`. The host already handles
   `copyText` in `mdEditorPlusProvider.ts` and writes via
   `vscode.env.clipboard.writeText(text)`.
4. **Confirm** — show a toast: **"Copied as plain text"**.

## Components & changes

| Unit | File | Change |
|------|------|--------|
| Toolbar button | `src/webview/bubbleMenu.ts` | Add one `<button data-action="copy-plain">` to the first `.bubble-row` after the `${DIV}` that precedes the code button. Add a clipboard SVG icon. |
| Click handler | `src/webview/bubbleMenu.ts` | On `copy-plain`, extract `textBetween` from the current selection and post `copyText`; then dismiss/keep the menu consistent with other actions. |
| Host toast | `src/mdEditorPlusProvider.ts` | The `copyText` handler currently shows the hardcoded `'AI prompt copied to clipboard'`. Parameterize the confirmation message so callers can supply their own (e.g. via an optional `msg.toast` field), defaulting to a generic "Copied to clipboard". The new button passes `"Copied as plain text"`. |

### Why parameterize the toast
`copyText` is currently used only by the AI-prompt copy path, so its toast text is
AI-specific. Adding a second caller means the message must be caller-driven rather
than hardcoded. Default remains safe if a caller omits it.

## Data flow

```
[selection] --highlight--> bubble menu shows
   user clicks "Copy as plain text"
       │
       ▼
webview: doc.textBetween(from, to, '\n\n', '\n')  → plainText
       │ postMessage { type: 'copyText', text: plainText, toast: 'Copied as plain text' }
       ▼
host: vscode.env.clipboard.writeText(text)
      vscode.window.showInformationMessage(toast ?? 'Copied to clipboard')
```

## Error handling

- **Empty selection:** guard — no-op (shouldn't occur since the menu requires a
  selection).
- **Clipboard write failure:** handled by the existing host path; no new surface.
  (The current `copyText` handler does not special-case failure; we match existing
  behavior rather than add new error UI.)

## Testing

- **Unit (webview):** given a doc with a colored/styled range selected,
  `textBetween` extraction returns the visible characters with no `<span>`, no `**`,
  and correct paragraph breaks across block boundaries.
- **Manual:** highlight colored text → click button → paste into a plain text field
  (e.g. a terminal) → only clean text appears, no `<span style…>` tags. Confirm the
  toast reads "Copied as plain text". Confirm normal Cmd+C copy is unchanged.

## Open items for implementation

- Final icon glyph for the button (clipboard vs. a "plain T" treatment).
- Confirm whether the bubble menu should stay open or dismiss after the copy
  (match the behavior of the closest sibling action).
