# Idempotent Board Serialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `serializeBoard(parseBoardSource(x)) === x` for unchanged boards, so the editor stops flagging phantom "unsaved changes" caused by rewriting legacy lowercase ids (`c8`) to canonical uppercase (`C8`).

**Architecture:** Preserve each card id verbatim through parse → model → serialize. Keep `normalizeLegacyId` for *comparison only* (linking `board:body` sections to rows stays case-insensitive). New ids mint in the file's existing case.

**Tech Stack:** TypeScript, Jest (ts-jest), pure functions in `src/webview/boardModel.ts`.

Spec: `docs/superpowers/specs/2026-06-16-idempotent-board-serialization-design.md`

**Run all commands from the worktree root:**
`/Users/aviranrevach/AI Projects Aviran/MD viewer mscode/.claude/worktrees/fix+idempotent-board-serialization-c28`

---

## File Structure

- `src/webview/boardModel.ts` — MODIFY: `parseBoardSource` (preserve id case + case-insensitive body link + orphan compare), add `idCase()` helper, `mintCardId` (case-aware), `serializeBoard` de-dup mint (case-aware).
- `tests/board/idempotency.test.ts` — CREATE: round-trip idempotency for lowercase / uppercase / mixed fixtures.
- `tests/board/idScheme.test.ts` — MODIFY: the "legacy id migration" block now asserts preserve-case; add an all-lowercase mint case.

---

### Task 1: Failing idempotency test

**Files:**
- Test (create): `tests/board/idempotency.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { parseBoardSource, serializeBoard } from '../../src/webview/boardModel';

const lower = [
  '<!-- board:start id="b1" name="B" columns="Todo|Done" column-colors="blue|emerald" field-types="Title=text,Status=status,id=text" -->',
  '',
  '| Title | Status | id |',
  '|---|---|---|',
  '| Alpha | Todo | c8 |',
  '| Beta | Done | c17 |',
  '',
  '<!-- board:body id="c8" -->',
  '',
  'Body for eight',
  '',
  '<!-- board:end -->',
].join('\n');

const upper = lower.replace(/c8/g, 'C8').replace(/c17/g, 'C17');

describe('board serialization is idempotent', () => {
  it('round-trips a lowercase-id board byte-identically', () => {
    expect(serializeBoard(parseBoardSource(lower))).toBe(lower);
  });
  it('round-trips an uppercase-id board byte-identically', () => {
    expect(serializeBoard(parseBoardSource(upper))).toBe(upper);
  });
  it('keeps the body linked regardless of id case', () => {
    expect(parseBoardSource(lower).cards[0].body.trim()).toBe('Body for eight');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/board/idempotency.test.ts`
Expected: FAIL — the lowercase case shows `c8`/`c17` rewritten to `C8`/`C17` (uppercase round-trips fine; lowercase does not).

---

### Task 2: Preserve id case in `parseBoardSource`

**Files:**
- Modify: `src/webview/boardModel.ts` (the card-build + orphan block, currently ~lines 436–449)

- [ ] **Step 1: Preserve the raw id and link bodies case-insensitively**

Find this block:

```ts
  const cards: Card[] = [];
  if (table) {
    for (const row of table.rows) {
      const values: Record<string, string> = {};
      table.header.forEach((h, idx) => {
        values[h] = row[idx] ?? '';
      });
      const id = normalizeLegacyId(values.id || '');
      values.id = id;
      cards.push({ id, values, body: bodyById.get(id) ?? '' });
    }
  }

  const cardIds = new Set(cards.map((c) => c.id));
```

Replace with (keep the raw id; `bodyById` stays keyed by normalized id from the existing line 433, so look it up normalized; compare orphans normalized):

```ts
  const cards: Card[] = [];
  if (table) {
    for (const row of table.rows) {
      const values: Record<string, string> = {};
      table.header.forEach((h, idx) => {
        values[h] = row[idx] ?? '';
      });
      // Preserve the id exactly as authored (idempotent serialize). Body links
      // and orphan checks compare via normalizeLegacyId so c8/C8 still match.
      const rawId = values.id || '';
      values.id = rawId;
      cards.push({ id: rawId, values, body: bodyById.get(normalizeLegacyId(rawId)) ?? '' });
    }
  }

  const cardIds = new Set(cards.map((c) => normalizeLegacyId(c.id)));
```

(Leave line ~433 `bodyById.set(normalizeLegacyId(matches[i].id), …)` unchanged — bodies remain keyed by normalized id.)

- [ ] **Step 2: Run the idempotency test**

Run: `npx jest tests/board/idempotency.test.ts`
Expected: PASS (lowercase + uppercase round-trip; body still linked).

- [ ] **Step 3: Run the id-scheme suite to see the intended breakage**

Run: `npx jest tests/board/idScheme.test.ts`
Expected: FAIL in the "legacy id migration (c17)" block only — it still asserts the old uppercasing. Task 3 updates it.

- [ ] **Step 4: Commit**

```bash
git add src/webview/boardModel.ts tests/board/idempotency.test.ts
git commit -m "fix(board): preserve card id case on parse (idempotent serialize, c28)"
```

---

### Task 3: Update `idScheme.test.ts` legacy-migration block to preserve-case behavior

**Files:**
- Modify: `tests/board/idScheme.test.ts` (the `describe('legacy id migration on parse (c17)', …)` block, lines ~50–88)

- [ ] **Step 1: Rewrite the two `it(...)` cases**

Replace the block body's two tests (the fixture `src` above them stays as-is — it uses lowercase `c8`/`c17`):

```ts
  it('preserves authored (lowercase) card ids and keeps them linked to their bodies', () => {
    const board = parseBoardSource(src)!;
    expect(board.cards.map(c => c.id)).toEqual(['c8', 'c17']);
    expect(board.cards.map(c => c.values.id)).toEqual(['c8', 'c17']);
    expect(board.cards[0].body.trim()).toBe('Body for eight');
    expect(board.cards[1].body.trim()).toBe('Body for seventeen');
    expect(board.orphanBodies).toHaveLength(0);
  });

  it('round-trips authored ids into the table and the body anchors unchanged', () => {
    const out = serializeBoard(parseBoardSource(src)!);
    expect(out).toContain('| Alpha | Todo | c8 |');
    expect(out).toContain('| Beta | Todo | c17 |');
    expect(out).toContain('<!-- board:body id="c8" -->');
    expect(out).toContain('<!-- board:body id="c17" -->');
    expect(out).not.toContain('| C8 |');
    expect(out).not.toContain('id="C17"');
  });
```

Also update the `describe` title to reflect the new behavior:

```ts
describe('legacy id case is preserved on parse (c28)', () => {
```

- [ ] **Step 2: Run the suite**

Run: `npx jest tests/board/idScheme.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 3: Commit**

```bash
git add tests/board/idScheme.test.ts
git commit -m "test(board): assert id case is preserved, not uppercased (c28)"
```

---

### Task 4: Case-aware id minting

**Files:**
- Modify: `src/webview/boardModel.ts` (`mintCardId`, ~line 585; `serializeBoard` de-dup mint, ~line 630)
- Test: `tests/board/idScheme.test.ts` (add one case to the existing `describe('mintCardId', …)`)

- [ ] **Step 1: Add a failing mint test (all-lowercase → lowercase)**

In `tests/board/idScheme.test.ts`, inside `describe('mintCardId', …)`, add:

```ts
  it('mints lowercase when the board uses lowercase ids', () => {
    expect(mintCardId(['c5', 'c6'])).toBe('c7');
  });
  it('mints uppercase for a mixed board', () => {
    expect(mintCardId(['c8', 'C2'])).toBe('C9');
  });
```

Run: `npx jest tests/board/idScheme.test.ts -t mintCardId`
Expected: FAIL on the lowercase case (currently always mints `C7`).

- [ ] **Step 2: Add `idCase` helper and make `mintCardId` case-aware**

In `src/webview/boardModel.ts`, replace `mintCardId` (the function at ~line 585) with:

```ts
/** Pick the id prefix to mint with: lowercase only when the board's ids are all
 *  lowercase `c<n>` (no canonical `C<n>` present); uppercase otherwise / when empty. */
function idCase(existingIds: Iterable<string>): 'c' | 'C' {
  let lower = 0;
  let upper = 0;
  for (const id of existingIds) {
    if (/^c\d+$/.test(id)) lower++;
    else if (/^C\d+$/.test(id)) upper++;
  }
  return lower > 0 && upper === 0 ? 'c' : 'C';
}

/** Next free id, continuing from the highest existing number, in the board's case. */
export function mintCardId(existingIds: Iterable<string>): string {
  const ids = [...existingIds];
  const prefix = idCase(ids);
  const used = new Set<string>(ids);
  let max = 0;
  for (const id of ids) {
    const n = idNumber(id);
    if (n !== null && n > max) max = n;
  }
  let n = max + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
```

- [ ] **Step 3: Make the `serializeBoard` empty-id de-dup mint case-aware**

In `serializeBoard` (~line 620), find:

```ts
  let maxN = 0;
  for (const c of board.cards) {
    const n = idNumber(c.id);
    if (n !== null && n > maxN) maxN = n;
  }
  const seen = new Set<string>();
  const normalizedCards = board.cards.map((c) => {
    let id = c.id || `C${++maxN}`;
```

Replace the first lines so the minted prefix matches the board's case:

```ts
  let maxN = 0;
  for (const c of board.cards) {
    const n = idNumber(c.id);
    if (n !== null && n > maxN) maxN = n;
  }
  const mintPrefix = idCase(board.cards.map((c) => c.id));
  const seen = new Set<string>();
  const normalizedCards = board.cards.map((c) => {
    let id = c.id || `${mintPrefix}${++maxN}`;
```

(The rest of the de-dup block — `-N` suffixing — is unchanged.)

- [ ] **Step 4: Run mint + idempotency tests**

Run: `npx jest tests/board/idScheme.test.ts tests/board/idempotency.test.ts`
Expected: PASS (existing mint cases unchanged: `['C1','C17','C3']→C18`, `['c8','C2']→C9`, `[]→C1`, `['c-ab12']→C1`, `['C5','C6']→C7`; new lowercase case `['c5','c6']→c7`).

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts tests/board/idScheme.test.ts
git commit -m "feat(board): mint card ids in the board's existing case (c28)"
```

---

### Task 5: Full-suite verification + real-file idempotency

**Files:**
- Test (temporary, deleted after): inline check against the real TODO.md

- [ ] **Step 1: Verify the real lowercase TODO.md round-trips identically**

Run:

```bash
cat > tests/_realfile.test.ts <<'TS'
import * as fs from 'fs';
import { parseBoardSource, serializeBoard } from '../src/webview/boardModel';
const md = fs.readFileSync('/Users/aviranrevach/AI Projects Aviran/MD viewer mscode/TODO.md','utf8');
const region = md.match(/<!--\s*board:start[\s\S]*?<!--\s*board:end\s*-->/)![0];
test('real TODO.md board round-trips byte-identically', () => {
  expect(serializeBoard(parseBoardSource(region))).toBe(region);
});
TS
npx jest tests/_realfile.test.ts
rm -f tests/_realfile.test.ts
```

Expected: PASS (no diff). If it fails, the printed diff reveals a non-idempotency beyond id-case — fix it in `serializeBoard`/`parseBoardSource` before continuing.

- [ ] **Step 2: Run the entire suite — no NEW failures**

Run: `npx jest 2>&1 | tail -5`
Expected: only the two pre-existing failures remain — `tests/toggle.test.ts` (type-check) and `tests/board/grouping.test.ts` ("group band color"). Everything else (board parse/serialize/roundtrip/ops/tags/idScheme/idempotency) green.

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "toggle.ts" | head`
Expected: no output (no new type errors; pre-existing toggle.ts excluded).

- [ ] **Step 4: Final commit (if any uncommitted cleanup)**

```bash
git status --short
git add -A 2>/dev/null; git commit -m "chore(board): idempotency verified against real TODO.md (c28)" 2>/dev/null || echo "nothing to commit"
```

---

## Notes for the implementer

- Do **not** change `normalizeLegacyId` itself — it stays as a comparison helper (its direct unit tests at idScheme.test.ts lines 17–30 must remain green).
- Display: card ids now render in their authored case (a lowercase file shows `c8`, not `C8`). This is intended per the spec — the editor shows what's in the file.
- `node_modules` is a symlink in this worktree; jest/tsc work normally.
