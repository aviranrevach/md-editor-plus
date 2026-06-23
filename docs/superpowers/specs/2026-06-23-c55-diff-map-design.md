# c55 — Diff map (red/green/amber change marks on the structure rail)

**Date:** 2026-06-23
**Status:** Design approved, ready for implementation plan
**Builds on:** c54 (structure-map rail + full-diff base resolution)

## Goal

Paint **change marks** onto the c54 structure-map rail — a VS Code-minimap-style
overview of what's changed in the document since the last git commit. Green for
added blocks, amber for modified, red for removed. Click a mark to jump to the
block. The rail becomes a live "what have I touched since HEAD" map.

## Baseline

Marks compare the current document against **git HEAD (last commit)** — matching
the Show Diff feature. For files not in git, fall back to on-disk → session
snapshot. This is exactly what `resolveDiffBase` (`src/diffBase.ts`) already
produces; c55 reuses it, adding no new base-resolution logic.

## Architecture

A new module pair, mirroring the c54 structure-map split:

- `src/webview/diffMapCore.ts` — **pure** (no DOM, no editor): block-splitting +
  LCS → a list of change marks. Unit-tested.
- `src/webview/diffMap.ts` — **DOM shell**: per-node markdown serialization,
  `coordsAtPos`, painting the mark layer onto the rail, events. Verified at F5.

The change-mark layer is a **second decoration layer on the existing rail**, not
a rewrite of `structureMap.ts`.

### Data flow

1. **Host → webview, one new message.** The host resolves the base via
   `resolveDiffBase` (HEAD → on-disk → session) and posts
   `{ type: 'diffBase', content, label }`. Sent on init and re-sent after each
   save. The webview caches the latest base content.
2. **Webview owns all position-aware work:**
   a. Split the current doc into top-level blocks → each yields a markdown
      string (via the `tiptap-markdown` serializer applied per node) plus its
      rendered `docY` (`editor.view.coordsAtPos(node start).top + window.scrollY`)
      and `pos` (for click-to-jump).
   b. Split the cached base markdown into blocks by the same structure.
   c. LCS-diff the two block sequences (reuse the generic `lineOps` from
      `src/webview/conflictDiff.ts`, which already operates on `string[]`).
   d. Produce `DiffMark[]` and paint them.

## The diff algorithm (`diffMapCore.ts`)

**Input:**

```ts
interface BlockSide { md: string; docY: number; pos: number; } // current blocks
interface DiffMapInput {
  baseBlocks: string[];      // base (HEAD) split into block-markdown strings
  currentBlocks: BlockSide[];// current doc blocks, with rendered position
  maxMarks?: number;         // cap; default 200 (mirrors computeConflictDiff)
}
type DiffMarkKind = 'add' | 'change' | 'del';
interface DiffMark { docY: number; kind: DiffMarkKind; pos?: number; }
function computeDiffMarks(input: DiffMapInput): { marks: DiffMark[]; truncated: number };
```

**Algorithm:**

1. `lineOps(baseBlocks, currentBlocks.map(b => b.md))` → ordered `eq | del | add`
   ops.
2. Within each contiguous changed hunk, **pair del+add positionally** (the trick
   `computeConflictDiff` already uses): the first *N* pairs are **`change`**
   (modified blocks), leftover dels are **`del`**, leftover adds are **`add`**.
3. Emit marks:
   - `add` → `{ docY: <new block's docY>, kind: 'add', pos }`.
   - `change` → `{ docY: <modified block's docY>, kind: 'change', pos }`.
   - `del` → `{ docY: <seam>, kind: 'del' }` where the seam is the `docY` of the
     current block that now occupies the deleted block's former position (or the
     document-end `docY` if the deletion was last). No `pos` (nothing to jump to
     on screen; clicking scrolls to the seam).
4. Sort marks by `docY`. If `marks.length > maxMarks`, slice and report
   `truncated`.

**Block-splitting (the one spike).** The current side splits by top-level
ProseMirror node (authoritative). The base side splits the raw markdown by the
same structure: blank-line-separated blocks, with **fenced code blocks** and the
**board HTML-comment block** (`<!-- board:start ... board:end -->`) kept whole.
The plan must pin base-split ↔ serializer-output equivalence with round-trip
tests, because mark accuracy depends on the two splits being comparable. Worst
case on mismatch is a coarser diff (a region flagged whole), never a crash.

## Visual treatment

- **Layout on the rail (three layers, no collision):**
  - Heading ticks — right edge (unchanged from c54).
  - **Change marks — left edge.** A thin vertical bar: `add`/`change` spans ≈ the
    block's rendered height; `del` is a short fixed stub at the seam.
  - Viewport box — translucent overlay across both.
- **Colors** (theme-aware, not hard-coded hex — sourced from the existing
  callout/status palette so they recolor per theme):
  - `add` → green
  - `change` → **amber `#F5A623`** (chosen over VS Code's blue because blue is
    already the app's `--link`/accent color and would blend with links, the
    viewport box, and selection)
  - `del` → red
- **Visibility:** marks show automatically whenever the rail is visible **and**
  there are changes vs the base. No separate toggle in v1 — they're part of the
  map. Absent when the working tree is clean. Hidden in Code view with the rest
  of the rail (`.source-mode-active`).
- **Discreet-until-hover:** marks follow the rail's existing hide/expand-on-hover
  behavior.

## Interaction

- **Click a mark** → smooth-scroll to the block. `add`/`change` jump to `pos`;
  `del` jumps to the seam `docY`. Reuses the rail's existing `jumpToPos` /
  fraction-scroll.
- **Hover a mark** → tooltip "Added" / "Modified" / "Removed", reusing
  `.app-tooltip`. No content preview in v1 — that's what Show Diff is for.

## Lifecycle

- **Recompute marks on edit** — debounced, piggy-backing the existing edit
  signal the structure map already rebuilds on. Block-LCS over tens of blocks is
  cheap.
- **Recompute on new base** — when a fresh `diffBase` message arrives (init +
  after save).
- **Scroll / resize** — reposition existing marks via `coordsAtPos` only; no
  diff recompute (same as the heading ticks).

## Edge cases

- **Not in git / no HEAD** → `resolveDiffBase` fallback (on-disk → session); marks
  reflect that base. No git-specific errors surface.
- **Clean working tree** → no marks; layer absent.
- **Huge diff** (e.g. brand-new file, everything "added") → `maxMarks` cap so the
  rail never renders thousands of nodes.
- **`coordsAtPos` on an invalid/stale pos** → wrapped in try/catch, that mark
  skipped (same pattern as `structureMap.ts`).
- **Block-split mismatch** → degrades to a coarser diff, never a crash.

## Testing

Pure core (`diffMapCore.ts`) carries the coverage:

- block-splitting of representative markdown — headings, paragraphs, fenced code
  block, board HTML-comment block kept whole;
- LCS → marks mapping: pure add, pure delete, paired modify, del-at-end seam;
- `maxMarks` capping reports `truncated`;
- empty / identical inputs → zero marks.

The DOM shell (`diffMap.ts`) stays a thin layer (serialization, `coordsAtPos`,
painting, events), verified at F5 — consistent with `structureMap.ts`.

## Out of scope

- Line-precise (sub-block) mark positioning — rejected in favor of block-aligned
  marks (no faithful line→pixel map in a rendered block editor).
- Content preview on hover (Show Diff covers that).
- Marks in Code (source) view — the rail itself is Preview-only.
- A separate enable/disable toggle for the marks (they're part of the map in v1).
- Staging / reverting a change from the rail (this is a read-only overview).
