# Backlog

Running list of work explicitly deferred from shipped or designed features.
Each item names the spec it was deferred from so the context isn't lost.

Add new entries at the top of each section.

---

## c1 image picker — "Embed link" still broken in the real host

- Deferred from the c1 drill-down redesign (branch `fix/c1-image-picker-drilldown`).
- Symptom: in the F5 Extension Development Host, choosing Image → **Embed link** shows nothing / doesn't insert, even after two fixes (hide filter bar; capture-phase outside-click). A jsdom regression test (`tests/blockPickerImage.test.ts`) reproduces the intended flow and PASSES, so the failure is environment-specific to the webview — needs live instrumentation (e.g. console logging in the running host) to find the real cause.
- Upload / Browse project / Embed from clipboard were the working siblings; only Embed link is affected.

---

## Board — tags & grouping follow-ups (deferred 2026-06-05)

Deferred from `2026-06-05-board-grouping-design.md` and `2026-06-05-board-tags-design.md` (both shipped).

- **Kanban "group by" any field** — kanban columns are still hardwired to the built-in Status. Let the columns be driven by any chosen status (or tag) field, like the table's group-by. (Grouping option "B" from the brainstorm.)
- **Persist collapsed groups** — table group collapse/expand is in-memory and resets on reload; store it per view. (Also listed under "Board — table view".)
- **Multi-tag row drag (table)** — when grouped by a tag, a card that appears in several tag groups resolves to its *first* bucket for drag/reorder; grabbing it from another bucket reorders relative to the first. No data loss (moveCard works by id), just unintuitive. See the comment at `boardTableRender.ts` drag handler.
- **Tag-set reordering** — no UI to reorder options within a status/tag set; order is stored/derived (first-seen). A drag-to-reorder in the options editor would be nice.
- **Picker chip style consistency (cosmetic)** — the tags picker rows use the dotted `.board-column-chip` while rendered cells use flat `.bd-tag`; unify the look.
- **Tags picker re-anchor on toggle (cosmetic)** — toggling a tag in the table rebuilds the cell, so the open picker's anchor detaches; it stays functional but doesn't reposition.

---

## Header / chrome responsiveness (deferred from whiteboard manual smoke 2026-05-26)

At narrow window widths the top-of-plugin chrome stops fitting:
- The outline-panel sidebar overlaps the Preview/Code toggle pill instead
  of auto-collapsing.
- The "Preview" / "Code" button labels stay full-width when there's no
  room — should drop to icon-only below a breakpoint.
- The open file name doesn't truncate cleanly and ends up overlapping
  the right-side header buttons (reload / theme / `⋯`).

Fix targets:
1. Auto-collapse the outline panel below a width breakpoint (likely
   when the editor column drops below its text min-width).
2. Hide the Preview/Code labels and keep just the eye/code glyphs at
   narrow widths (matches what the in-block mermaid Preview/Code
   toggle already does in `mermaidBlock.ts`).
3. Make the file-name region behave: `min-width: 0` on its flex parent
   + `text-overflow: ellipsis` + a sane `flex` ratio so the right-side
   button group never gets covered.

---

## Whiteboard canvas-sizing on first paint (deferred from `2026-05-25-visual-edit-init-polish-design.md`)

After Task 3 (rAF wrap + retry) was reverted and pre-pinned positions
were dropped from the whiteboard starter (`0070d4b`), the canvas
behavior is acceptable but still not "infinite-canvas" perfect:
- The SVG viewBox is whatever mermaid auto-laid-out; dragged-out nodes
  clip at the SVG bounds.
- No visual indicator of canvas extent (dot grid was removed in `8d00cb0`).
- The `naturalSvgScale` helper in `mermaidVisualEditDom.ts` is now
  dead code — keep or rip depending on whether the dot grid comes back
  in a different form.

Open questions worth a separate brainstorm:
- Should the canvas behave as truly infinite (viewBox auto-expands on
  drag toward edges), or stay bounded with explicit zoom/pan?
- If we bring back a backdrop pattern, paint it on the HTML pane (not
  inside the SVG) so it doesn't read as a hard boundary.

---

## Board — table view (deferred from `2026-05-23-board-table-view-design.md`)

- Multi-column sort
- "Group by week / month" smart bucketing for `date` fields (v1 buckets by exact value)
- Frozen / sticky first column on horizontal scroll
- Filter / search bar inside the table
- Aggregations in the group header row (count, sum, avg)
- Conditional formatting (cell color by value)
- Bulk-select rows + bulk edit
- CSV / markdown export of the table
- Per-view saved presets (e.g. "Show overdue only")
- Persisted group-collapse state (v1 keeps it in-memory; resets on reload)

## Board — other views (designed-for, not built)

- Calendar view — cards laid out by a `date` field on a month grid
- Timeline / Gantt view — needs a new field type (`daterange` / start+end)

## Board — kanban v1 carry-overs (from `2026-05-20-board-block-design.md`)

- Side panel resize handle (fixed 420 px in v1)
- Saved filters or search within a board
- Card relations (link a card to another card)
- Templates (preset boards)
- Formulas, rollups, aggregates
- Comments / activity log on cards
- `@`-mention autocomplete from a member list (free text only in v1)
- Auto-promotion of existing markdown task lists into a board
- Multi-card selection / bulk move
- Per-board color theming beyond status colors
- Export to CSV / JSON
- Pinning / docking the side panel

## Mermaid visual edit — a11y polish (from the agent audit)

- `aria-pressed` on shape picker icons, B/I/U/S type chips, padding/line-height segmented buttons
- `aria-haspopup` + `aria-expanded` on Fill/Stroke/Text/Align/Shape popover triggers
- Focus management: focus first item on popover open, return focus to trigger on close
- Per-popover Escape close (currently only the visual-edit-wide panic Escape)

## Mermaid — still unverified in real host

- Connector-dot click hang (couldn't repro in harness; added defensive Escape + try/catch)
- White popover visual fidelity across all themes (light/dark/sepia/claude)
