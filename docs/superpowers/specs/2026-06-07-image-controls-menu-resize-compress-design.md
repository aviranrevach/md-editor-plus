# Image controls — menu · resize · compress

Date: 2026-06-07
Status: Approved (design); pending implementation plan
Backlog item: "Image block controls — menu/resize/compress" (docs/superpowers/backlog.md)

## Goal

Give images first-class controls. Clicking an image in the note body surfaces a
small toolbar with: see where the file lives, replace it, resize it (drag handles
+ size presets), compress it, reveal it in Finder, and remove it. The same
capabilities that make sense at thumbnail scale (source, compress, reveal) are
also added to the existing board image manager.

This builds directly on the shipped image pipeline (c1 add-image, c21 paste/drop,
c22 board images). It reuses `saveImageBytes`, `src/imageAssets.ts`, and the
existing extension `saveImage`/`revealFileInOS` round-trips. It does NOT introduce
new image-acquisition paths.

## Decisions (from brainstorm)

- **Resize persistence: HTML `<img>`.** A sized image serializes to
  `<img src="…" width="420">`; an unsized image keeps clean `![alt](src)`. This
  round-trips on GitHub, Obsidian, VS Code preview, and Pandoc. Strict/sanitizing
  renderers that strip raw HTML degrade to *no custom width*, not *no image*.
- **Resize gesture: drag handles + px presets.** Corner drag-handles for free
  resize, plus toolbar preset buttons that snap to concrete pixel widths.
- **Compress: in-editor `<canvas>` re-encode.** Fully local, no network (AI
  compression rejected — needs a blocked domain and is overkill for
  screenshots/photos).
- **Menu items:** Source · Replace · Size (S/M/L/Full) · Compress · Reveal in
  Finder · Remove. Alt-text deferred to backlog.
- **Scope: both surfaces, shaped per surface.** Body images get the full
  NodeView toolbar with resize. Board cells extend the existing
  `openBoardImageManager` popover with Source/Compress/Reveal only — no resize
  (thumbnails are capped, so a display width is meaningless there).

## Architecture

### Component 1 — `width` attribute + markdown serializer on `ResolvedImage`

`ResolvedImage` (src/webview/editor.ts:43, today only overrides `renderHTML` to
resolve the src) is extended with:

- **`addAttributes()`** adding a nullable `width` attribute:
  - `parseHTML`: read the `width` attribute off an `<img>` element; parse to an
    integer; `null` if absent or non-numeric.
  - `renderHTML`: when `width` is a positive number, emit `width="<n>"`; otherwise
    emit nothing. (The existing src-resolution stays in the node's `renderHTML`.)
- **`addStorage()`** providing a tiptap-markdown `markdown.serialize(state, node)`:
  - `width` is a positive number → write a raw HTML tag:
    `<img src="<rawSrc>" width="<n>"` plus `alt="…"` if present, then ` />`.
    The `src` written is the **stored/relative** src (NOT the webview-resolved
    URI) — serialization must persist the on-disk path, same string the default
    image serializer would write.
  - `width` is null → fall back to the default image serialization `![alt](src)`.

tiptap-markdown runs with `html: true` by default
(node_modules/tiptap-markdown/dist/tiptap-markdown.es.js:961), so the raw `<img>`
is preserved on serialize and re-parsed on load (markdown-it emits it as HTML,
ProseMirror's DOMParser matches the Image node's `img[src]` rule, and our
`width` `parseHTML` recovers the number). Width therefore round-trips across
reopen.

**Edge cases:**
- `src` containing characters needing escaping in an HTML attribute (quotes) —
  escape `"` to `&quot;`. Reuse/extend the existing escape helper rather than
  hand-rolling.
- A `width` of 0, negative, or NaN is treated as "no width" → `![]()` form.

### Component 2 — body image NodeView (`src/webview/imageNodeView.ts`)

`ResolvedImage` gains `addNodeView()` returning a NodeView whose DOM is a
wrapper containing the `<img>` (src resolved via the existing `resolveImageSrc`).

- **Selection chrome:** when the node is selected, render four corner
  drag-handles and a floating toolbar anchored above the image. When not
  selected, render just the `<img>` (no chrome, no layout shift).
- **Drag handles:** manual mouse drag (`mousedown`/`mousemove`/`mouseup`), NOT
  HTML5 dragstart, because GlobalDragHandle intercepts dragstart
  ([[feedback_manual_drag_pm_intercept]]). During drag, update the `<img>` width
  live (CSS) for responsiveness; on mouseup, commit the final integer width to
  the node via a transaction (`updateAttributes`). Clamp: min ≈ 80px, max =
  current editor content width (so an image can't exceed the column).
- **Toolbar buttons:**
  - **Source** — shows the stored relative path/filename, read-only (e.g. a
    label or a disabled row). No edit.
  - **Replace** — reuses the existing picker entry points
    (`uploadImageFromComputer` / `browseProjectImage` / clipboard) from the
    block-picker drill-down; on success, `updateAttributes({ src, width: null })`
    (replacing resets size to natural).
  - **Size S / M / L / Full** — S/M/L write fixed pixel widths: **S=240,
    M=420, L=640** (constants in one place, easy to tune). **Full** clears
    `width` (→ `null` → serializes as `![]()`, image fills column).
  - **Compress** — calls Component 3, saves the smaller bytes via
    `saveImageBytes`, then `updateAttributes({ src: newRelPath })` (the path may
    change, e.g. PNG→WebP) while preserving the current `width`; refresh the
    rendered `<img>`.
  - **Reveal in Finder** — posts Component 5's message with the stored src.
  - **Remove** — deletes the node from the document.
- **Coexistence:** opening this toolbar dismisses other floating panels (bubble
  menu, block picker, etc.) per [[feedback_floating_panel_coexistence]]; reuse the
  existing closeAll pattern.
- **Drop indicator / strokes:** any selection outline follows
  [[feedback_drag_drop_indicator]] / the borderless-faint convention already
  used for image empty/broken states — no stray inner-div strokes.

### Component 3 — `compressImage` (`src/webview/imageCompress.ts`)

`async function compressImage(bytes: ArrayBuffer | Uint8Array, mime: string,
opts?: { quality?: number; maxDim?: number }): Promise<{ bytes: ArrayBuffer;
mime: string }>`

- Decode via `createImageBitmap` (or an `<img>` + canvas fallback), draw onto an
  offscreen `<canvas>`. If `maxDim` is set and either dimension exceeds it, scale
  down proportionally.
- Re-encode via `canvas.toBlob(..., outMime, quality)` at quality **0.8**.
  Output-mime policy: JPEG → JPEG; WebP → WebP; PNG → re-encode to **WebP at
  quality 0.8** (WebP supports alpha and shrinks PNG screenshots far better than
  PNG-to-PNG, which `toBlob` won't compress). SVG and GIF are skipped (return
  original bytes) — vector/animated formats don't canvas-compress sensibly.
  Because the output extension can change (PNG→WebP), compress passes the new
  bytes + mime to `saveImageBytes`, which writes a new asset; the node/link src
  is then updated to the new relative path.
- **Guard:** if the re-encoded result is not smaller than the input, return the
  original bytes (never inflate a file).
- Pure of any DOM-app coupling beyond `document.createElement('canvas')` /
  `createImageBitmap`; unit-testable in jsdom with mocked canvas where feasible,
  otherwise tested via its pure size-decision/scale-math helpers.

Both the body toolbar and the board manager call `compressImage`, then route the
resulting bytes through the existing `saveImageBytes` write path (which dedupes
and writes to `<note>.assets/`).

### Component 4 — board manager additions (`src/webview/boardImagePicker.ts`)

`openBoardImageManager(anchor, currentValue, onChange)` (boardImagePicker.ts:36)
already lists thumbnails with remove + Upload/Browse/Clipboard add rows. Add, per
thumbnail:

- **Source** — show the stored relative path (tooltip or inline label).
- **Compress** — fetch the asset bytes, `compressImage`, re-save via
  `saveImageBytes`, then `onChange` with the value rewritten to point at the new
  relative path (the path may change, e.g. PNG→WebP); refresh the thumbnail.
- **Reveal in Finder** — post Component 5's message.

No resize controls here. Replace/Remove already exist.

### Component 5 — `revealImage` extension handler (`src/mdEditorPlusProvider.ts`)

New webview→extension message `revealImage` mirroring the `saveImage` handler
(provider ~line 551):

- Payload `{ relPath: string }`. Resolve against the document dir
  (`vscode.Uri.joinPath(document.uri, '..', …)` / same resolution the media base
  uses). Reject non-file documents and paths that escape the workspace.
- `await vscode.commands.executeCommand('revealFileInOS', target)` — the command
  is already used elsewhere in the provider (lines 272, 401).
- No reply payload needed beyond an optional error.

## Data flow

```
Resize:
  drag handle / preset click → NodeView updates width attr (transaction)
    → ResolvedImage.renderHTML emits width on <img>
    → tiptap-markdown serializer writes <img src width> (or ![]() if null)
    → onChange(markdown) → extension saves file
  reopen: markdown-it parses <img> (html:true) → DOMParser → width parseHTML → node

Compress:
  toolbar/manager → read asset bytes → compressImage(canvas re-encode)
    → saveImageBytes(name, smallerBytes, mime) [extension saveImage handler]
    → new asset written (path may change, e.g. PNG→WebP)
    → src/link rewritten to new relPath → <img> refreshed

Reveal:
  toolbar/manager → postMessage revealImage{relPath}
    → provider resolves URI → revealFileInOS
```

## Error handling

- **Compress fails / format unsupported (SVG, GIF):** skip silently, keep
  original; optionally a small toast. Never corrupt or inflate the asset.
- **Reveal on unsaved doc / missing file:** provider returns error; webview shows
  a non-blocking message ("save the file first" / "file not found").
- **Replace canceled:** no-op, node unchanged.
- **Width clamp:** drag never sets width below min or above content width;
  parse of a malformed `width` attribute → treated as null (clean `![]()`).
- **Reading asset bytes for compress** when the src is an http/data URL (not a
  local asset): compress is disabled for non-local images (nothing to overwrite).

## Testing

- **Serializer (unit):** node with `width` → `<img src width>`; node without →
  `![]()`; src with quotes is escaped; width 0/negative/NaN → `![]()`.
- **Round-trip (unit):** `<img src="x.png" width="420">` markdown → parse →
  `width===420`; serialize back → identical tag. Unsized image stays `![]()`.
- **compressImage (unit):** smaller-than-input guard returns original; scale math
  respects `maxDim` and preserves aspect ratio; SVG/GIF pass through unchanged.
- **Width clamp (unit):** clamp helper bounds to [min, contentWidth].
- Manual: drag-resize feel, presets, Full clears width, compress shrinks file,
  reveal opens Finder, board manager actions, popover coexistence.

## Files touched

- `src/webview/editor.ts` — `width` attribute, markdown serializer, register NodeView
- `src/webview/imageNodeView.ts` — NEW: toolbar + drag handles
- `src/webview/imageCompress.ts` — NEW: `compressImage`
- `src/webview/boardImagePicker.ts` — Source/Compress/Reveal per thumbnail
- `src/mdEditorPlusProvider.ts` — `revealImage` handler
- `src/webview/imageUpload.ts` — add `revealImage(relPath)` bridge (+ asset-bytes read helper if needed for compress)
- `src/webview/styles/board.css` + editor styles — toolbar, handles, selection chrome
- Tests — serializer, round-trip, compress, clamp

## Out of scope (backlog)

- Alt-text editing
- AI-based compression
- Resize/width inside board cells
- Caption support

## Concurrency note

Another tab is on c2 (block action menu); c5 already shipped to main. Implement
this on a fresh branch in a git worktree ([[feedback_concurrent_tabs_shared_repo]]),
since the shared working dir is in use. Start a new branch per
[[feedback_branch_per_subject]].
