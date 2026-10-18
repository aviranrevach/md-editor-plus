# Turn selection into… (using AI) — Design

**Date:** 2026-06-01
**Status:** Approved design, pending implementation plan
**Related:** `src/webview/bubbleMenu.ts` ("Turn row into"), `src/webview/boardModel.ts`, `src/webview/extensions/board.ts`, `src/webview/extensions/mermaidBlock.ts`

## Summary

A sibling to the existing **"Turn row into"** transform. Where "Turn row into" applies a direct, single-block transform inside the editor, **"Turn selection into… (using AI)"** operates on a *multi-block selection* and, instead of transforming the content itself, **generates a ready-to-paste prompt** for a **file-aware AI tool** (Claude Code, Cursor, the VS Code AI extension). The user pastes that prompt into their AI, the AI edits the markdown file directly, and the viewer re-renders.

The feature's unique justification — versus the existing direct transforms or a generic AI chat — is that the generated prompt carries **this app's exact, proprietary block grammar** (boards, tables, mermaid), so the AI's output pastes/renders correctly and is **bulletproof**.

There is **no network call and no API integration**. The only channel is the clipboard (one direction: out). This fits the project's security posture.

## Goals

- Let users turn a loose, multi-block selection into one of the app's structured blocks via an external AI, with output that round-trips correctly.
- Make the generated prompt self-contained: it tells the AI *where* in the file to act, *what* to produce, and *how* (the exact format), with guardrails.
- Never lose or mangle content that is already in the selection (images, diagrams, existing tables/boards).

## Non-goals

- No in-app AI/LLM call, no API keys, no network. (Clipboard only.)
- No paste-back box. The AI edits the file directly; the result returns by the AI's own file edit, not by the user pasting an answer back into the app.
- No support for AI tools that cannot edit files (plain chat). Out of scope for v1.

## Scope / phasing

**Phase 1 (this build) — structural targets** (each needs the proprietary grammar):

- ▦ **Table** — standard GFM pipe table.
- 📋 **Kanban board** — the `<!-- board:start … --> … <!-- board:end -->` region.
- 🔀 **Mermaid diagram** — a fenced ` ```mermaid ` block (renders as a live diagram).

**Phase 2 (later) — "thinking" targets** (plain-markdown output, no proprietary grammar):

- 📝 Summary / TL;DR · ✅ Action items / task list · 🧱 Outline (nested headings) · ⏱ Timeline.

These live under the same ✨ AI entry point and reuse the same prompt skeleton and Replace/Add behavior.

## User flow

1. User makes a multi-block text selection. The bubble menu appears (existing behavior).
2. User opens the **✨ AI** menu (or the "Using AI" section of the existing "Turn into" list) and picks a target (e.g. *Table*).
3. A **panel** opens showing: a one-line selection summary, a **Replace / Add** toggle, the generated prompt (collapsed/expandable), the 3 steps, and a **Copy** button.
4. User clicks **Copy**, pastes the prompt into their file-aware AI tool.
5. The AI edits the markdown file directly (replacing the selected region, or inserting after it).
6. The viewer re-renders the file; the new table/board/diagram appears.

No paste-back, no network.

## Entry points (both)

1. **✨ AI icon button** on the bubble-menu toolbar — the *broad* home for all AI actions, including Phase-2 "thinking" actions (e.g. Summarize) that are not "turn into a shape." Opens a small menu of AI actions.
2. **"Using AI" section** inside the existing "Turn into" list — the three Phase-1 structural targets repeated under a labeled divider, where users already look for transforms.

## The panel

Layout, top to bottom:

- **Header** — e.g. "📋 Turn selection into a Table — using AI" + close.
- **Selection summary** — a single line: *"Converting N lines · ~M words."* (No itemized list and no full-text dump; the count is enough confirmation.)
- **Replace / Add toggle** — *↻ Replace selection* (default) vs *＋ Add below (keep original)*. This choice changes one sentence in the generated prompt (the instruction in part 3).
- **The prompt** — collapsed by default, expandable; an **Edit** affordance lets advanced users tweak before copying.
- **What to do next** — three steps: (1) Copy, (2) paste into your file-aware AI, (3) it edits the file and the viewer re-renders.
- **Copy prompt** — primary action.

Light and dark themes both supported (the panel respects the editor theme).

## The generated prompt — five fixed parts

Every prompt has the same skeleton; only **part 4** (the format spec) changes per target.

1. **Where (file)** — "You are editing the file `<workspace-relative path>` in this workspace."
2. **Where (anchors)** — a small **boundary anchor**, not a full content dump:
   - start anchor = approximate source-line number + the *text of the first selected line*;
   - end anchor = approximate source-line number + the *text of the last selected line*.
   - The text anchors are the **primary** locator (robust if line numbers drift); the line numbers are a **hint**. The full middle content is **not** embedded — the AI reads it from the file. This keeps the prompt small regardless of selection size (a 2-page selection yields the same tiny anchor as a 4-line one).
3. **Instruction** — Replace *or* Add:
   - Replace: "Replace that section with a `<target>` built from its content."
   - Add: "Insert a `<target>` built from that section immediately after it, leaving the original in place."
4. **Exact format spec** — the proprietary grammar for the chosen target, with allowed values inline (see per-target specs below).
5. **Rules / guardrails** — target-specific constraints, plus the universal **content-handling rule** (below), plus: "Edit the file directly; reply with nothing else."

### Content-handling rule (universal, all targets)

> *"The selection may reference images (`![alt](src)`) and contain existing diagrams, tables, or boards. **Read** each one you can access — open referenced image files (paths are relative to this markdown file) and read diagram/table/board source — and use what they show as context or data when building the result. Represent items as cells or links where they belong; preserve anything you cannot fold in; if an image is unreadable, use its alt text and the link. **Never silently drop content.**"*

Rationale: a file-aware, vision-capable AI can open referenced image files and read existing block source, so images/diagrams can be **used as context** (e.g. an explanatory diagram informs the table) or **carried as cell values** (a list of items each with a picture), with a safe fallback (alt text + link) when an image cannot be opened. This blends safety (never lose content) with intelligence (read & use it).

## Per-target format specs (part 4 content)

The AI edits the **file on disk**, so it writes plain markdown with **real newlines**. The internal `&#10;` newline escaping in `board.ts` is purely the viewer's load-time preprocessing and is **not** something the AI produces.

### Table (GFM)

Standard pipe table: header row, `|---|` separator, data rows. In cells: escape pipes as `\|`; do not use literal newlines (use `<br>` if a line break is needed).

```
| Title | Status | Due |
|---|---|---|
| Draft press release | Todo | 2026-06-05 |
```

### Kanban board

The full region from `<!-- board:start … -->` through `<!-- board:end -->` is one atomic block.

- **Start marker attributes (in order):** `id`, `name`, `columns` (pipe-delimited lanes), `column-colors` (pipe-delimited, one per column, same order), `field-types` (comma-delimited `name=type` pairs), `hidden-fields`, optional `active-view`.
- **Allowed `field-types`:** `text`, `status`, `date`, `person`, `tags`.
- **Allowed `column-colors`:** `gray`, `blue`, `amber`, `emerald`, `red`, `purple`.
- **Fields table:** a GFM pipe table of the cards; keep a hidden `id` column.
- **Card body blocks:** `<!-- board:body id="<card-id>" -->` followed by optional longer notes; the `id` matches the row's `id`.
- **Rules:** each card's `Status` must be exactly one of the `columns`; each card needs a unique `id` (`c1`, `c2`, …) used in both the row and its body; dates `YYYY-MM-DD`; persons `@name`; cell escaping as for tables.

Verified round-trip example:

```
<!-- board:start id="b-a3f2" name="Sprint 12" columns="Todo|Doing|Done" column-colors="blue|amber|emerald" field-types="Title=text,Status=status,Owner=person,Due=date,Tags=tags,id=text" hidden-fields="id" -->

| Title | Status | Owner | Due | Tags | id |
|---|---|---|---|---|---|
| Build the kanban block | Doing | @aviran | 2026-06-01 | feature, editor | c1 |
| Write round-trip tests | Todo |  |  | tests | c2 |

<!-- board:body id="c1" -->

## Goal
Add the table + comment parser, render the board view, support drag-drop.

<!-- board:body id="c2" -->

Brief notes for c2.

<!-- board:end -->
```

### Mermaid

A fenced code block whose info string is `mermaid`; renders as a live diagram (not a code block). Written on disk as three backticks, the word `mermaid`, the diagram source, then a closing three backticks. Example (indented here to avoid nesting fences):

    ```mermaid
    flowchart TB
        A[Start] --> B[Process]
        B --> C[End]
    ```

## Architecture / components

- **`AI_TRANSFORMS` list** — a new array beside the existing `TURN_INTO` array in `src/webview/bubbleMenu.ts` (or a sibling module). Each entry: `{ id, label, iconHtml, buildPrompt(ctx) }`, where `ctx` carries the file path, the start/end anchors, the Replace/Add mode, and the selection summary.
- **Prompt builders** — one per target. Each composes parts 1–5; parts 1–3 and 5 are shared helpers, part 4 is the target's format spec. Format-spec strings are kept as constants so they track the real grammar.
- **Anchor extraction** — derive the first/last selected lines' **source text** (reliable) and **approximate source-line numbers** (best-effort) from the current selection. *This WYSIWYG→source-markdown mapping is the one area of technical risk and warrants a small spike during implementation; the text anchor is the primary signal precisely because the line number can drift.*
- **Panel UI** — new component rendering the layout above; reuses bubble-menu styling conventions and theme variables.
- **Entry-point wiring** — the ✨ AI toolbar button (opens the AI-actions menu) and the "Using AI" section appended to the existing "Turn into" list.

## Edge cases & decisions

- **Mixed selections (images / mermaid / tables / boards):** handled by the universal content-handling rule (read & use, preserve, never drop).
- **Atom blocks (boards) may not be partially selectable.** To verify in the spike — if a board can't be partially selected, that simplifies the mixed-selection story.
- **Ambiguous anchor match** (identical first/last line text appears more than once): mitigated by including a small amount of surrounding context in the anchor and by the line-number hint.
- **Duplicate / unreadable images:** alt-text + link fallback.
- **Board parse bug:** a separate, in-progress fix (`BOARD-PARSE-BUG-FINDINGS.md`). The board format spec here must match the corrected post-fix grammar. The AI writes real newlines on disk; the `&#10;` escaping is the viewer's internal load step only.

## Security / privacy

- No network, no API, no keys. Clipboard out only.
- The prompt references a workspace-relative file path and small text anchors; it does not embed credentials or the full file.

## Testing

- Prompt-builder unit tests per target: given a selection context, assert the generated prompt contains the correct file ref, anchors, Replace/Add instruction, format spec, and guardrail text.
- Round-trip fixtures: feed a representative "ideal" AI output (board / table / mermaid) through the existing parser and assert it renders without data loss.
- Anchor-extraction tests against known selections (boundary text + approximate line).
