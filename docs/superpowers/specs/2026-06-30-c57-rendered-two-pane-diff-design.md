# c57 — Rendered two-pane diff

**Date:** 2026-06-30
**Status:** Design approved, pending spec review
**Area:** Diff

## Problem

The full-diff (c24/c54/c55) opens VS Code's **native plain-text diff**
(`vscode.diff`) — raw markdown side by side. That throws away everything the
editor renders: formatted text, callouts, boards, images, mermaid. The user
wants to *see what changed in the rich rendered view*, the way the editor
normally displays the document.

## Goal

Replace the native text diff with a **two-pane rendered diff**: two read-only
instances of our editor side by side — left = base, right = current — both fully
formatted, with changed blocks tinted, shared blocks aligned by filler gaps, and
a clickable change rail that scrolls both panes together.

This is non-negotiably **read-only**: the diff never writes, which keeps it out
of the save/dirty bug family (c56, c28, c37).

## Decisions (settled during brainstorming)

| Question | Decision |
|---|---|
| What's on each side | Two rendered editors: left = base, right = current |
| How changes are marked | **Block-level** tint + change rail (option "C") |
| Pane alignment | **Filler-aligned**, like VS Code — shared blocks sit exactly across from their twin |
| Editability | **Read-only** both panes |
| Placement | **Replaces** the current full-diff trigger (no second command) |
| Rail | **One shared rail** (far right, like VS Code's overview ruler); click jumps both panes |
| Scroll | Panes scroll as **one locked unit** (tops stay matched) |

## Architecture

### Reused as-is (no change)

- **Base resolution** — `resolveDiffBase` (HEAD → on-disk → snapshot) in
  `src/diffBase.ts`. The diff panel asks for the same base the rail uses today.
- **Block diff** — `lineOps` (LCS) in `src/webview/conflictDiff.ts` and the
  pairing logic in `src/webview/diffMapCore.ts`. The ordered `eq / del / add`
  op list (with paired entries read as `change`) **is** the alignment map.
- **Block normalization** — `blocksFromMarkdown` in `src/webview/diffMap.ts`:
  parse → serialize each side identically so base and current blocks compare
  cleanly. (This is the c55 gotcha — comparing un-normalized markdown produces
  false marks. Both panes must normalize through the same parser/serializer.)
- **Rendering** — `createEditor` + `setReadOnly` from `src/webview/editor.ts`.

### New components

1. **Diff panel host** — extension side, in `src/diffViewer.ts`.
   `openFullDiff` stops calling `vscode.commands.executeCommand('vscode.diff', …)`
   and instead creates a `vscode.WebviewPanel` (one beside the active editor).
   It posts an init message `{ base, baseLabel, current }` to the webview.
   The synthetic-content lesson from c54 still holds: never hand the panel the
   live `document.uri` — it owns its own copy of both sides, so the `*.md` custom
   editor can't reclaim the pane.

2. **Diff webview entry** — `src/webview/diffPane.ts`, a **separate, lighter
   bundle** (`dist/diffPane.js`) added as a second `entryPoints` in
   `esbuild.config.js`. It is NOT the main editor entry (`index.ts`) — it skips
   the toolbar, save state, conflict banner, find bar, side panel, etc. It only:
   - mounts two read-only editors into a left and a right container,
   - loads base markdown into the left, current into the right,
   - runs the align-and-tint pass,
   - builds the shared rail.
   It reuses the editor's CSS so rendered output matches the main editor exactly.

3. **Align-and-tint pass** — a ProseMirror decoration layer applied to each pane.
   - **Tint:** node decorations add a CSS class to changed top-level blocks —
     `diff-block-del` (left, red edge+tint), `diff-block-add` (right, green),
     `diff-block-change` (both sides of a paired hunk).
   - **Filler:** widget decorations insert spacer elements so aligned blocks'
     tops match across the gutter (see algorithm below).

4. **Shared rail** — one rail on the far right, reusing the c55 `diff-mark`
   visuals and `computeDiffMarks` output. Clicking a mark scrolls both panes to
   that change (locked scroll keeps them together afterward).

### Filler-alignment algorithm

The op list maps base block *i* ↔ current block *j*:

1. Render both editors fully (read-only).
2. **Measure** each top-level block's rendered height in each pane.
3. Walk the op list:
   - `eq` / `change` (paired) → block *i* (left) is aligned with block *j*
     (right). Pad the **shorter** side with a filler equal to the height
     difference so their tops line up.
   - `add` (right only) → insert a full-height filler in the **left** pane at
     that seam.
   - `del` (left only) → insert a full-height filler in the **right** pane.
4. Insert/update filler widget decorations with the computed heights.

Rendered heights settle **asynchronously** (images loading, mermaid rendering,
fonts). The measure → decorate pass therefore re-runs on:
- initial render (after first paint),
- image `load` and mermaid render-complete events,
- panel resize.

This async re-measure loop is the main source of edge cases and the reason
filler-alignment is "more work" than free-scroll.

## Data flow

```
diff toggle (webview)
  → postMessage 'openFullDiff' (existing)
  → openFullDiff (diffViewer.ts):
       resolveDiffBase(HEAD→disk→snapshot)
       create WebviewPanel, load diffPane.js
       postMessage { base, baseLabel, current }
  → diffPane.ts:
       createEditor(left, readOnly) ← base
       createEditor(right, readOnly) ← current
       blocks = blocksFromMarkdown(base|current)   (normalized identically)
       ops = lineOps(baseBlocks, currentBlocks)
       align+tint decorations from ops + measured heights
       rail marks from computeDiffMarks
```

## Edge cases & guardrails

- **Read-only** both panes — no transactions that mutate the doc, no save path.
  The source file is never marked modified (the c56 trap: merely opening the
  diff must not dirty anything).
- **Synthetic content** — the panel holds its own base/current strings; it never
  opens `document.uri`, so the custom editor can't claim the pane (c54).
- **Identical normalization** — both sides go through the same parse→serialize
  (c55) to avoid false marks.
- **Large docs** — reuse the existing `maxMarks` (200) ceiling for rail marks.
  If top-level blocks exceed a threshold, degrade gracefully: keep tint + rail,
  skip perfect filler alignment (or show a "+N more" note) rather than hang on
  the measure loop.
- **No base available** (untracked file, no HEAD, no snapshot) — base resolves to
  empty; the diff shows the whole doc as added. Same behavior as today.
- **Async content (mermaid/images)** — alignment re-runs when they finish; until
  then alignment is approximate, never wrong (tints/rail are correct from the
  start).

## Testing

- **Unit (no DOM):** the align mapping — given an op list and per-block heights,
  it returns the correct filler/pair instructions (which side gets a filler,
  what height, which blocks are tinted which kind). Mirrors the existing pure
  `conflictDiff` / `diffMapCore` tests.
- **Unit:** reconfirm base+current normalize to identical blocks for unchanged
  content (no false marks) — guards the c55 regression.
- **Manual (F5):** open a doc containing a board, a callout, an image, and a
  paragraph edit. Confirm: correct tints, shared blocks aligned, rail-click
  scrolls both panes, locked scroll, and **the source file is not marked
  modified** by opening or interacting with the diff.

## Out of scope

- Editing inside the diff (right pane stays read-only).
- Inline word-level highlighting within a block (option "B" was rejected in favor
  of block-level).
- Three-way / merge views (covered elsewhere by the conflict banner).
- Keeping the old native text diff as a second command (this replaces it).
