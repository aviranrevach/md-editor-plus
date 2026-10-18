# Board block — implementation progress

**Status:** 37 of 38 tasks complete. Branch `feat/board-block` is ready for manual smoke-test (Task 38).

**Plan:** [2026-05-20-board-block.md](2026-05-20-board-block.md)
**Spec:** [../specs/2026-05-20-board-block-design.md](../specs/2026-05-20-board-block-design.md)

## Branch state

- **Branch:** `feat/board-block` (from `main` at `54d8eca`)
- **Commits:** 38 (37 task commits + 1 progress commit)
- **Last commit:** `35a42dc` test(board): manual integration script
- **Automated tests:** 27/27 passing across 5 suites
- **Compile:** clean (`npm run compile` succeeds)

## What's complete

| Phase | Tasks | Outcome |
|---|---|---|
| 1 — Model | 1–6 | parse, serialize, round-trip property — fully TDD |
| 2 — Tiptap node | 7–9 | preprocessor + atom node + editor wiring |
| 3 — Read-only chrome | 10–12 | NodeView renders board + columns + cards + uncategorized fallback |
| 4 — Slash command | 13–14 | `/board` inserts a fresh board, tested in block picker |
| 5 — Side panel (read) | 15–16 | clicking a card opens a panel with fields + nested Tiptap body |
| 6 — Card editing | 17–21 | title, text/person/date, status select, tags chip input, writable body |
| 7 — Drag-drop | 22–24 | between columns, within column, column reorder |
| 8 — Column ops | 25–29 | add card, add column, rename, ⋯ menu (color/sort/delete), inline board name |
| 9 — Properties | 30–33 | menu, visibility toggle, rename/delete fields, drag-reorder, inline add-field picker |
| 10 — Edge cases | 34, 35, 35.5, 36 | dup-id auto-suffix, read-only mode, orphan body preservation, external-edit refresh |

## What's left

**Task 38 — final manual verification.** Subagents cannot drive a live VSCode editor; this step needs your eyes:

1. Build: `npm run compile`
2. Open the spec's storage example ([docs/superpowers/specs/2026-05-20-board-block-design.md](../specs/2026-05-20-board-block-design.md)) in a fresh `.md` file
3. Run through the 12-step checklist at [tests/board/integration-script.md](../../../tests/board/integration-script.md)
4. Flag any failures and open follow-up tasks before merging

If everything passes, the feature is ready to merge into `main`.

## Deviations from the plan worth knowing

| Task | Deviation | Why |
|---|---|---|
| 4 | First implementer pass shipped a complex single-regex with inline body capture and missed committing the test file. Reverted to the plan's two-pass `BODY_RE` + slice approach with explicit `\n+` normalization, and amended the commit to include the test. | Plan's normalization is needed for round-trip stability; original commit was incomplete. |
| 5 | Code-quality reviewer raised a theoretical concern that `field-types` is emitted unconditionally and might break round-trip. Verified empirically: all 3 boundary scenarios (no fields, hidden-only id, full schema) round-trip cleanly. No fix needed; concern was unfounded. | Reviewer was wrong; ran a quick property check before forcing a fix cycle. |
| 16 | Did NOT modify `createEditor`. Instead, the side panel mounts a nested instance and calls `sub.setEditable(false)` directly. Added a Jest stub (`tests/__mocks__/editorMock.js`) and a `moduleNameMapper` entry in `package.json` because `editor.ts` transitively imports `lowlight` (ESM-only) which Jest's node env can't parse. | Cleaner Tiptap API; the mock keeps the test suite running without rewriting Jest config to handle ESM. |
| 35.5 | Also had to fix `tests/board/parse.test.ts` fixture (not just `serialize.test.ts` as the task noted) to include the new `orphanBodies: []` field. | The "minimal" parse test uses `toEqual` on the full Board object, so a new required field breaks it. |

## File-by-file delta vs `main`

**New (board-specific):**
- `src/webview/boardModel.ts` (288 lines) — types, parse, serialize, round-trip-stable
- `src/webview/boardBlock.ts` (545 lines) — NodeView, render, drag, click handlers
- `src/webview/boardSidePanel.ts` (210 lines) — slide-in panel, all field editors, nested body editor
- `src/webview/boardProperties.ts` (246 lines) — properties menu (visibility/rename/delete/reorder/add)
- `src/webview/extensions/board.ts` (98 lines) — preprocessor + Tiptap atom node + NodeView wiring
- `src/webview/styles/board.css` (351 lines) — chrome, cards, drag, panel, properties, color tokens
- `tests/__mocks__/editorMock.js` (12 lines) — Jest stub for editor.ts (avoid ESM lowlight)
- `tests/board/parse.test.ts` (185 lines)
- `tests/board/serialize.test.ts` (86 lines)
- `tests/board/roundtrip.test.ts` (74 lines)
- `tests/board/preprocess.test.ts` (41 lines)
- `tests/board/integration-script.md` (16 lines) — manual checklist for Task 38

**Modified (existing files, surgical):**
- `src/webview/blockPicker.ts` (+43) — `/board` entry + `freshBoardSource` helper
- `src/webview/editor.ts` (+6) — Board node + `preprocessMarkdownBoards` chained into preprocessing
- `src/webview/index.ts` (+5) — boardCss import + `initBoardSidePanel()` on init
- `tests/blockPicker.test.ts` (+22) — entry shape test
- `package.json` (+3) — jest `moduleNameMapper` for editor.ts stub

**Unrelated files in the diff (pre-existing, not touched by this work):**
- `demo-tester.md`, `wordwrap-test.md` — were already untracked when work began; they're included in the diff against `main` but neither file was modified by the implementation tasks.

## What the user might want to do next

- Run `npm run compile` and open a board file in dev VSCode to verify behavior end-to-end (Task 38).
- Walk the integration checklist at [tests/board/integration-script.md](../../../tests/board/integration-script.md).
- If something looks off in the UI, the most likely fix sites are:
  - Card face / chip rendering — `boardBlock.ts: renderCard / renderChip`
  - Side panel field editors — `boardSidePanel.ts: renderPanel`
  - Properties popover — `boardProperties.ts`
  - CSS — `styles/board.css` (all classes prefixed `board-` or `board-column-` or `board-panel-`)
- If round-trip surprises happen, model tests in `tests/board/` are the first place to add a fixture.
