# Idempotent board serialization — fix phantom "unsaved changes" (c28, part 1)

Date: 2026-06-16
Status: Design approved (approach A). Scope: the phantom-dirty piece of c28 only.
(The other c28/c29 pieces — auto-merge non-colliding changes, diff-on-conflict — are
separate, later efforts.)

## Problem

The editor shows "unsaved changes" — and pops VS Code's "file changed outside the
editor" conflict banner — when the user changed nothing. Confirmed root cause: board
serialization is **not idempotent**.

`serializeBoard(parseBoardSource(x)) !== x` for any board whose ids are lowercase
(`c8`, `c11`, …). The codebase treats uppercase `C<n>` as canonical and migrates legacy
lowercase ids to it (`normalizeLegacyId`, boardModel.ts:578; `mintCardId` also emits
`C<n>`). So the moment the board re-serializes (any mutate, view toggle, or save), every
id flips case → the document no longer matches disk → "unsaved changes" the user never
made. Measured on the real TODO.md: 40 of 98 lines differ purely from id-case
normalization (table cells **and** `board:body id="…"` markers).

The recently-fixed save bug (Gap A) made this worse — un-persisted edits left the doc
permanently dirty — but the non-idempotent serialize is the independent root cause.

## Principle

**The editor must never rewrite content the user didn't touch.** Saving (or
re-serializing) an otherwise-unchanged board must produce byte-identical output.

## Approach (A — approved)

Preserve each id exactly as authored; never force-normalize case on serialize.

1. **Parse** — store `Card.id` as the verbatim string from the source (do not uppercase).
   Keep the legacy-normalization helper only for *comparison*, not for mutating stored ids.
2. **Matching** — wherever table rows are matched to `board:body` sections (and any other
   id lookups), compare case-insensitively (e.g. by `idNumber()` / case-folded compare),
   so `c8`/`C8` still resolve to the same card.
3. **Minting** — new ids match the file's existing case convention: if existing ids are
   lowercase, mint `c<n>`; otherwise mint `C<n>`. (Determined from the board's current ids;
   default uppercase when the board has none.)
4. **Serialize** — write `Card.id` verbatim in both the table column and the
   `board:body id="…"` markers (and the start marker if it carries ids).

Rejected: (B) migrate-once-on-load — dirties files just for opening them, the exact
complaint. (C) case-insensitive dirty-detection only — still rewrites `c8`→`C8` on the
next save; the file still changes under the user.

## Components touched

- `src/webview/boardModel.ts` — `parseBoardSource` (preserve id case), `serializeTable` /
  `serializeBodies` / start-marker (write verbatim id), `mintCardId` (case-aware), and the
  body-matching logic. Keep `normalizeLegacyId` available for comparison helpers.
- No webview/provider/UI changes expected. Display may continue to show ids however it
  does today; if display currently relies on the stored id being uppercase, add a thin
  display-only normalization rather than mutating stored ids.

## Acceptance criteria / tests

1. **Idempotency (the spec-as-test):** for representative fixtures — including the real
   lowercase-id TODO.md board, an uppercase-id board, and a mixed board —
   `serializeBoard(parseBoardSource(x)) === x` exactly. This also catches any
   non-idempotency beyond id-case.
2. **Case-insensitive matching preserved:** a body section authored as `id="c8"` still
   attaches to a table row with id `c8`/`C8`.
3. **Minting matches file case:** adding a card to an all-lowercase board yields `c<n>`;
   to an all-uppercase board yields `C<n>`; to an empty board yields `C<n>` (default).
4. **No regressions:** existing board parse/serialize/round-trip/grouping/tags suites stay
   green (modulo the pre-existing `grouping.test.ts` / `toggle.test.ts` failures on main).

## Out of scope

- Auto-merge of non-colliding external changes (c28 part 2).
- Diff-in-conflict-banner (c29).
- Any change to the conflict banner itself.
