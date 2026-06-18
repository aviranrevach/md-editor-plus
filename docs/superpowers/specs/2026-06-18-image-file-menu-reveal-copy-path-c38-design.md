# c38 — Image file menu: Reveal in Finder + Copy path

**Date:** 2026-06-18
**Area:** Images / image bubble menu
**Requested by:** Gilad (High)

## Problem

The image bubble menu has a standalone folder button that only does one thing:
**Reveal in Finder**. There's no way to grab the image file's path. Gilad asked
for the menu to also offer **Copy path**, with the two file actions grouped so
it "makes sense" rather than piling another icon into the row.

All of these actions target the **image's own file** — never the surrounding
`.md` document.

## Design

Turn the existing folder button into a **drill-down** that swaps the menu
contents in place, exactly like the "Turn into" block picker (a back row at the
top, then the list). No second floating panel — only one view shows at a time,
honoring the "floating panels must not overlap" rule by construction.

### Interaction

1. **Default menu** — top row is `Replace · Compress · File · Remove`, second
   row is the `S / M / L / Full` size presets. The folder icon (`File`) is the
   drill-down trigger and shows its `.active` state while drilled in.
2. **Drilled in** — the two icon rows are replaced by:
   - A back row: `‹ Image file` — returns to the full menu.
   - **Reveal in Finder** (folder icon) — the action that exists today.
   - **Copy path** (copy icon) — new.
3. Back, selecting an item, or deselecting the image returns/closes to the
   default menu.

### What "Copy path" copies

The **absolute filesystem path** of the image, e.g.
`/Users/aviran/AI Projects Aviran/MD viewer mscode/demo-tester.assets/x.png`.
This matches Finder's "Copy as Pathname" and is what's useful for pasting into a
terminal, another app, or sharing where the file lives.

After copying, the host shows a quiet confirmation toast ("Copied image path")
so it's obvious it worked.

## Components & changes

### Webview — `src/webview/imageBubbleMenu.ts`

- Replace the standalone `data-action="reveal"` folder button with a
  `data-action="file"` drill-down trigger (same folder icon).
- Build a drilled-in view that swaps the menu's row content for a back row
  (`‹ Image file`) + two `.bm-into-item`s: **Reveal in Finder** and
  **Copy path**. Reuse the `.block-picker-back` styling (or an equivalent
  `bubble-into` back row) so it matches "Turn into".
- Generalize the current `closeReplace()` into a single
  `closeAllPanels()` / `showDefault()` helper so the Replace drill-down and the
  File drill-down never coexist, and both reset on deselect.
- Wire actions:
  - **Reveal in Finder** → existing `revealImage(src)`.
  - **Copy path** → new `copyImagePath(src)` request.
- Add a `copy` Phosphor icon to the local `ICON` map for the Copy path item.

### Webview — `src/webview/imageUpload.ts`

- Add `copyImagePath(relPath: string): Promise<void>` that sends
  `{ type: 'copyImagePath', relPath }` via the existing `request()` helper,
  mirroring `revealImage`.

### Host — `src/mdEditorPlusProvider.ts`

- Add a `copyImagePath` message handler mirroring the `revealImage` handler:
  - Reject when there's no `requestId`/`relPath`, or the document isn't saved
    to disk (`!document.uri.scheme.startsWith('file')`) — reply with an error
    ("save the file first"), same as reveal.
  - Resolve the relative path against the document's directory (strip leading
    `./`, `joinPath(docDir, clean)`), take the resolved URI's **`fsPath`**.
  - `await vscode.env.clipboard.writeText(fsPath)`.
  - `vscode.window.showInformationMessage('Copied image path')`.
  - Reply `{ ok: true }` (response message type e.g. `imagePathCopied`).

## Edge cases

- **Remote / data-URL images** (`https:` / `data:`): there's no local file, so
  both Reveal and Copy path no-op — matching how Reveal silently no-ops today.
  Items stay visible and inert; no new disabled-state styling to design.
- **Unsaved document:** the host can't resolve an absolute path, so it replies
  with an error and surfaces a "save the file first" notice — same path as
  Reveal.

## Testing / verification

This is DOM + host-message UI with no new parsing logic (the host path
resolution is the proven `revealImage` code path), so verification is in the
real app:

1. Select a local body image → open the bubble menu → click the folder icon →
   the menu swaps to the `‹ Image file` view.
2. **Reveal in Finder** opens Finder at the asset (unchanged behavior).
3. **Copy path** puts the absolute path on the clipboard and shows the toast;
   paste confirms the value.
4. Back returns to the full menu; opening Replace then File (or vice-versa)
   never shows two panels at once.
5. A remote image (`https://…`) leaves both items inert.

## Out of scope

- Copying the relative path or the image URL (absolute path only, per request).
- Any change to the `.md` document's path actions.
- Disabled/greyed-out states for remote images.
