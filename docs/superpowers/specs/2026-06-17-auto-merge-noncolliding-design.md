# Auto-merge non-colliding external changes (c28-part-2)

Date: 2026-06-17
Status: Design approved. Completes c28 (the phantom-dirty half shipped earlier).

## Problem

When the editor has unsaved edits and the file changes on disk (another tab, sync, git),
`decideExternalUpdate` returns `'conflict'` and the banner asks the user to choose. But if the
two sets of changes touch **different lines**, there's no real conflict — we should merge them
silently instead of interrupting.

## Safety principle (the whole point)

A wrong auto-merge corrupts the file, so the bar is: **merge only when provably safe; otherwise
ask.** Concretely — line-level, conservative:
- Merge only when our changes and the external changes touch **disjoint** base line-ranges.
- **Any** overlap, same-start edits, two insertions at the same point, or a missing base →
  return null → fall back to the existing conflict banner (now with the side-by-side diff).
- Never fabricate or guess an ordering. Worst case is an unnecessary prompt, never corruption.

## Approach: line-level 3-way merge

A pure `merge3(base, ours, theirs): string | null`:
- `base` = `lastSent` (the last version we pushed — the common ancestor both sides diverged from).
- `ours` = current editor markdown; `theirs` = the incoming external markdown. All normalized
  (`\n`, no trailing blanks) before calling.

Algorithm:
1. Fast paths: `ours === theirs` → return `ours`; `base === ours` (only theirs changed) →
   return `theirs`; `base === theirs` (only ours changed) → return `ours`.
2. Split all three into lines. Compute **hunks** (LCS-based) for base→ours and base→theirs —
   each hunk is `{ start, end, lines }`: base lines `[start, end)` replaced by `lines`.
3. **Conflict test:** for every (ours-hunk, theirs-hunk) pair, return `null` if their base ranges
   overlap (`a.start < c.end && c.start < a.end`) **or** start at the same base line
   (`a.start === c.start` — catches same-point insertions and same-start replacements).
4. Otherwise the hunk sets are disjoint and independent: apply all hunks to `base` in order
   (`out += base[pos..start] + hunk.lines; pos = end`), append the tail, `join('\n')`. A final
   guard (`if (h.start < pos) return null`) catches any residual overlap.

Board note: each card is one markdown line, so editing **different cards** merges; editing the
**same card** (even different fields) is the same line → asks. That's the intended, safe bar.

## Wiring

In `src/webview/index.ts`, the `'update'` handler's `if (decision === 'conflict')` branch
(currently sets `pendingExternalMarkdown`, renders the panel, shows the banner). Prepend a merge
attempt:

```
const merged = lastSentMarkdown !== null
  ? merge3(lastSentMarkdown, normalizeMd(getCurrentMarkdown()), normalizeMd(msg.markdown))
  : null;
if (merged !== null) {
  // silent auto-merge: adopt merged content and push it so disk catches up
  currentMarkdown = merged;
  lastSentMarkdown = normalizeMd(merged);
  updateContent(merged);
  if (sourceMode && sourceEditorReady) updateSourceContent(merged);
  vscode.postMessage({ type: 'edit', markdown: merged });
  return;
}
// else: existing banner path (pendingExternalMarkdown / renderConflictPanel / showConflictBanner)
```

`decideExternalUpdate` itself is unchanged — it still returns `'conflict'`; the handler decides
merge-vs-banner. `updateContent` already preserves scroll and best-effort cursor across the
re-render, so the merge is minimally disruptive.

## Components

- Create: `src/webview/merge3.ts` — pure `merge3` + the internal LCS hunk diff. No DOM.
- Create: `tests/merge3.test.ts`.
- Modify: `src/webview/index.ts` — import `merge3`; the conflict-branch merge attempt above.

## Error handling / edges

- **No base** (`lastSent === null`): skip merge → banner (we only reach the conflict branch with
  local edits, so this is rare, but guarded).
- **Both append at the same point** (two tabs each add a card at the table end): same insertion
  point → `null` → asks (ordering is ambiguous; safe). Out of scope to auto-order.
- **Merge result identical to incoming or ours**: still fine — it's just applied.
- Silent by design (no prompt). No toast in v1 (the user asked for silent); the save indicator's
  normal flow still runs.

## Testing

`tests/merge3.test.ts` — pure, thorough:
1. `ours === theirs` → returns that text.
2. only theirs changed (`base === ours`) → returns theirs.
3. only ours changed (`base === theirs`) → returns ours.
4. disjoint edits (ours edits line 1, theirs edits the last line) → merged contains both edits.
5. ours inserts at top, theirs inserts at bottom → merged contains both insertions, base lines intact.
6. both edit the **same** line differently → `null`.
7. overlapping ranges (ours replaces lines 2–4, theirs replaces 3–5) → `null`.
8. two insertions at the same base point → `null`.
9. realistic board: base rows A,B,C; ours edits row A; theirs edits row C → merged has both edits, B untouched.
10. empty base handled (no crash); whitespace-only / CRLF already normalized by the caller.

UI wiring is thin and not unit-tested (the handler path is exercised manually).

## Out of scope

- Intra-line / field-level merge of the same card (line-level only).
- Auto-ordering two insertions at the same point (asks instead).
- Any change to when conflicts are detected (`decideExternalUpdate` unchanged) or to the banner.
- A "merged" toast/notification (kept silent per the request).
