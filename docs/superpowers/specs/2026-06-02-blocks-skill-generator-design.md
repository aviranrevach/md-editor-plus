# Blocks Skill Generator — Design

**Date:** 2026-06-02
**Status:** Approved design, pending implementation plan
**Related:** `src/webview/aiTransforms.ts` (✨ AI prompt format specs — to be refactored), `src/webview/boardModel.ts` (board grammar + parser), `src/mdEditorPlusProvider.ts` (⋯ actions + file-write/save-dialog plumbing)

## Summary

A menu action that generates a **Claude Skill** (`SKILL.md`) teaching an AI the **exact block grammar** MD Editor Plus needs, so the AI produces Kanban/Table boards, Mermaid diagrams, callouts, and toggles that **render correctly** instead of as raw text. From the ⋯ actions menu the user opens a small panel, ticks which block types to include, and either **installs** the skill (into the project's or the global `.claude/skills/`) or **downloads** it.

The value is the proprietary, non-obvious grammar (e.g. the `<!-- board:start … field-types=… -->` region, allowed color/field tokens, the mermaid sidecar comments) — not conventions like column names or colors, which an AI infers from context and which would only make a skill rigid. So the skill is **reference documentation of the grammar**, not baked-in style.

## Goals

- One menu click → a ready, installable Claude Skill that makes the user's AI author MD Editor Plus blocks correctly, in any project, with no copy-paste.
- The skill's grammar is **identical** to the grammar the ✨ "Turn selection into… (AI)" feature already uses — guaranteed by a single source of truth, so they can never drift.
- Examples in the skill are **proven to round-trip** through the real parser.

## Non-goals

- No baked-in conventions (default columns, colors, naming) — the AI handles those.
- No rename UI / multi-skill management in v1 (fixed skill name `md-editor-blocks`).
- No new third-party dependencies (no zip library — download is a single `SKILL.md`).
- No network. Files are written locally (project or `~/.claude/skills/`) or via a Save dialog.

## User flow

1. ⋯ actions menu → **"Create blocks skill…"**.
2. A panel opens with:
   - **Block checkboxes** — Kanban board, Table board, Mermaid diagram, Callouts, Toggles. **All on by default.**
   - **Destination** — Install in project · Install globally · Download…
3. On confirm:
   - **Install in project** → write `<workspace>/.claude/skills/md-editor-blocks/SKILL.md` (create dirs).
   - **Install globally** → write `~/.claude/skills/md-editor-blocks/SKILL.md` (create dirs).
   - **Download…** → Save dialog writing a single `SKILL.md`; the panel notes to place it in a `md-editor-blocks/` folder inside a skills dir.
   - If a skill already exists at the target, **confirm before overwriting**.
4. Feedback: after install, a "Skill installed → `<path>`" notification with a **Reveal** action; after download, "Saved."

## The generated `SKILL.md`

A Claude Skill is a folder `md-editor-blocks/` containing `SKILL.md`. Structure:

```markdown
---
name: md-editor-blocks
description: Use when creating or editing Kanban/Table boards, Mermaid diagrams,
  callouts, or toggles in markdown files for MD Editor Plus. Provides the exact
  block grammar so they render correctly instead of as raw text.
---

# MD Editor Plus — block formats

[one section per selected block]
```

The frontmatter `description` is what makes Claude auto-load the skill at the right time. The body has one section per ticked block, each with the same shape:

- **What it is** — one line.
- **Exact grammar** — markers, attribute order, allowed values.
- **Worked example** — a complete, real instance that round-trips.
- **Rules / gotchas** — the constraints that make it valid.

It is **reference** content ("how to author these correctly"), not transform instructions — it deliberately omits the "replace/add this section" and "read images" framing of the ✨ feature.

### Per-block grammar the skill must cover

- **Kanban board** & **Table board** — the `<!-- board:start id=… name=… columns="A|B|C" column-colors="…" field-types="Name=type,…" hidden-fields=… active-view="kanban|table" -->` region, the GFM fields table, `<!-- board:body id="…" -->` blocks, `<!-- board:end -->`. Allowed `column-colors`: gray, blue, amber, emerald, red, purple. Allowed `field-types`: text, status, date, person, tags. Rules: each card's Status equals one column; unique `id` used in both the row and its body; dates `YYYY-MM-DD`; persons `@name`; escape `\|` and use `<br>` in cells. Kanban vs Table differ only by `active-view`.
- **Mermaid diagram** — a fenced ` ```mermaid ` block; renders as a live diagram. Note the optional position/style **sidecar comments** the visual editor persists (extract the exact form from `mermaidBlock.ts` / the mermaid renderer).
- **Callouts** — the five exact GFM forms: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`.
- **Toggles** — `<details>` / `<summary>` form as the app expects it (extract from `extensions/toggle.ts`).

## Architecture — single source of truth

The block grammar currently lives in `aiTransforms.ts` as the ✨ prompt specs. Giving the skill its own copy would let the two drift — the exact bug class this feature exists to prevent. So:

- **`src/webview/blockFormatReference.ts`** *(new, pure)* — the canonical, per-block reference (id, title, grammar, worked example, rules) for kanban, table, mermaid, callout, toggle. **The single source of truth.** No DOM/editor imports → unit-testable in node.
- **`src/webview/skillBuilder.ts`** *(new, pure)* — `buildSkill(selectedBlockIds) → { folderName: 'md-editor-blocks'; skillMd: string }`: assembles the frontmatter + the chosen sections from the reference. Unit-testable.
- **`src/webview/skillPanel.ts`** *(new, DOM)* — the ⋯-menu panel: block checkboxes + destination (Project / Global / Download) + confirm. Posts a `createSkill` message with `{ blocks, destination }` (for install) or hands the built `skillMd` to a `downloadSkill`/`installSkill` host message.
- **`src/mdEditorPlusProvider.ts`** *(modify)* — host handlers:
  - `installSkill` `{ scope: 'project'|'global', skillMd }` → resolve target dir (`workspaceFolder/.claude/skills/md-editor-blocks` or `os.homedir()/.claude/skills/md-editor-blocks`), confirm-on-overwrite, create dirs, write `SKILL.md`, notify with Reveal.
  - `downloadSkill` `{ skillMd }` → Save dialog (default `SKILL.md`), write.
- **`src/webview/aiTransforms.ts`** *(modify — the agreed refactor)* — `FORMAT_SPECS` is derived from `blockFormatReference` instead of holding its own copy, so the ✨ prompts and the skill share one grammar. The existing `buildPrompt` behavior and tests are preserved.
- **Entry wiring** — add the "Create blocks skill…" item to the ⋯ actions menu and open `skillPanel`.

### Data flow

`blockFormatReference` (canonical grammar) → consumed by **both** `skillBuilder` (→ SKILL.md) **and** `aiTransforms` (→ ✨ prompts). The panel selects blocks → `skillBuilder.buildSkill` → host installs/downloads.

## Customization

Only **which block types to include** (checkboxes, all on by default). No conventions, no rename — per the explicit decision that the exact grammar is the value and conventions are trivial for the AI.

## Security / privacy

- No network. Writes a local file: into the workspace (`project`), the user's home skills dir (`global`), or a user-chosen path (download Save dialog).
- Global install writes under `~/.claude/skills/` — outside the project, by explicit user action via the destination choice. Confirm-on-overwrite guards accidental replacement.

## Testing

- **`blockFormatReference`** — each block's worked example is run through the real parser/pipeline (e.g. `parseBoardSource`, the existing board pipeline test) and asserted to round-trip with all data intact. This is what *guarantees* the "exact format."
- **`skillBuilder`** — given a set of selected block ids, assert the output `SKILL.md` has the correct frontmatter (name + description) and exactly the chosen sections (and none of the unticked ones).
- **`aiTransforms` refactor** — existing `buildPrompt` tests stay green; add an assertion that the prompt grammar for a block matches the reference (no drift).
- Host install/download handlers are thin glue, verified manually (Project/Global/Download, overwrite confirm, Reveal).
