# Board Table Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the table view group by any status or tag column, rendering stacked sections whose group bands are tinted in the group's color (status options colors / tag hashed colors), with tighter rows, multi-tag cards appearing in every matching group, and a "Remove grouping" control.

**Architecture:** Generalize the table's existing grouping (`applyGroup`) and status sort comparator to be field-type aware using the per-field `getStatusOptions(board, field)` added previously, plus tag multi-bucketing. Color group bands via existing `--board-chip-<token>-bg` CSS variables; expose the model's `autoColor` as `autoColorPublic` for stable tag colors. All changes live in `boardTableRender.ts` + `board.css`, with one tiny model export.

**Tech Stack:** TypeScript, Jest + ts-jest (DOM tests use `@jest-environment jsdom`), plain DOM webview.

**Spec:** [docs/superpowers/specs/2026-06-05-board-grouping-design.md](../specs/2026-06-05-board-grouping-design.md)

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/webview/boardModel.ts` | Modify | export `autoColorPublic(name): ColorToken` |
| `src/webview/boardTableRender.ts` | Modify | field-type-aware `applyGroup`; status `comparatorFor`; `groupColor` helper; colored band render; "Remove grouping" menu item |
| `src/webview/styles/board.css` | Modify | group-band tint rules (10 tokens) + tighter row padding |
| `tests/board/grouping.test.ts` | Create | jsdom + unit tests for the above |

Run all board tests: `npx jest tests/board`. One file: `npx jest tests/board/grouping.test.ts`.

> **Pre-existing failure note:** `tests/toggle.test.ts` fails on an unrelated pre-existing toggle.ts type error. Keep `tests/board` green and feature files type-clean.

---

## Task 1: Export `autoColorPublic` from the model

**Files:**
- Modify: `src/webview/boardModel.ts` (near the private `autoColor` at line 136)
- Test: `tests/board/grouping.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/board/grouping.test.ts`. Start the file with the jsdom docblock as the very first thing (later tasks add `mountTable` DOM tests to this same file), then imports:

```ts
/**
 * @jest-environment jsdom
 */
import { autoColorPublic, COLOR_TOKENS_PUBLIC } from '../../src/webview/boardModel';

describe('autoColorPublic', () => {
  it('returns a valid palette token, deterministically', () => {
    const a = autoColorPublic('backend');
    const b = autoColorPublic('backend');
    expect(a).toBe(b);
    expect(COLOR_TOKENS_PUBLIC).toContain(a);
  });
  it('different names can map to different tokens', () => {
    // not a strict requirement, just sanity that it isn't constant
    const names = ['a','b','c','d','e','f','g','h','i','j','k'];
    const uniq = new Set(names.map(autoColorPublic));
    expect(uniq.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run** `npx jest tests/board/grouping.test.ts -t autoColorPublic` → FAIL (`autoColorPublic` not exported).

- [ ] **Step 3: Implement** — in `src/webview/boardModel.ts`, immediately after the private `autoColor` function (ends ~line 138) add:

```ts
/** Public, stable name→token mapping for color pickers and tag group bands. */
export function autoColorPublic(name: string): ColorToken {
  return autoColor(name);
}
```

- [ ] **Step 4: Run** `npx jest tests/board/grouping.test.ts -t autoColorPublic` → PASS. Then `npx jest tests/board` → all pass.

- [ ] **Step 5: Commit**
```bash
git add src/webview/boardModel.ts tests/board/grouping.test.ts
git commit -m "feat(board): export autoColorPublic for stable tag/group colors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Field-type-aware `applyGroup` (status options order + tag multi-bucket)

**Files:**
- Modify: `src/webview/boardTableRender.ts` — `applyGroup` (lines 705-740)
- Test: `tests/board/grouping.test.ts`

`applyGroup` currently special-cases the literal `'Status'` field and buckets tags by first-tag-only. Generalize it.

- [ ] **Step 1: Add failing tests** to `tests/board/grouping.test.ts` (the jsdom docblock is already at the top from Task 1). Add these imports alongside the existing ones, then the describe block. They mount the table and read group structure from the DOM:

```ts
import { mountTable } from '../../src/webview/boardTableRender';
import type { Board } from '../../src/webview/boardModel';
import type { BoardRendererCtx } from '../../src/webview/boardBlock';

function makeCtx(board: Board) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const boardRef = { current: board };
  const ctx: BoardRendererCtx = {
    root,
    getBoard: () => boardRef.current,
    mutate: (next: Board) => { boardRef.current = next; },
    openSidePanel: () => {}, requestDelete: () => {}, readonly: false,
  } as BoardRendererCtx;
  return { ctx, boardRef };
}
const groupLabels = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('.bd-table-group .board-column-name, .bd-table-group .bd-group-name'))
    .map((n) => n.textContent);

describe('applyGroup via mountTable', () => {
  it('groups by a custom status field in its options order, with empty + unknown handling', () => {
    const board: Board = {
      id: 'b1', name: '',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Impact', type: 'status', visibleOnCard: true,
          options: [{ name: 'Low', color: 'teal' }, { name: 'High', color: 'red' }] },
      ],
      cards: [
        { id: 'c1', values: { id:'c1', Title:'A', Status:'Todo', Impact:'High' }, body:'' },
        { id: 'c2', values: { id:'c2', Title:'B', Status:'Todo', Impact:'Low'  }, body:'' },
        { id: 'c3', values: { id:'c3', Title:'C', Status:'Todo', Impact:'Weird'}, body:'' }, // unknown
        { id: 'c4', values: { id:'c4', Title:'D', Status:'Todo', Impact:''     }, body:'' }, // empty
      ],
      orphanBodies: [], views: [{ name: 'table', groupBy: 'Impact' }], activeView: 'table',
    };
    const { ctx } = makeCtx(board);
    mountTable(ctx);
    // options order Low, High, then Uncategorized (unknown + empty)
    expect(groupLabels(ctx.root)).toEqual(['Low', 'High', 'Uncategorized']);
  });

  it('groups by tags with a multi-tag card appearing in every matching group', () => {
    const board: Board = {
      id: 'b1', name: '',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title', type: 'text', visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Tags',  type: 'tags', visibleOnCard: true },
      ],
      cards: [
        { id: 'c1', values: { id:'c1', Title:'Onboard', Status:'Todo', Tags:'backend, urgent' }, body:'' },
        { id: 'c2', values: { id:'c2', Title:'Patch',   Status:'Todo', Tags:'backend' }, body:'' },
        { id: 'c3', values: { id:'c3', Title:'Alert',   Status:'Todo', Tags:'urgent' }, body:'' },
      ],
      orphanBodies: [], views: [{ name: 'table', groupBy: 'Tags' }], activeView: 'table',
    };
    const { ctx } = makeCtx(board);
    mountTable(ctx);
    expect(groupLabels(ctx.root)).toEqual(['backend', 'urgent']);
    // 'Onboard' (c1) appears under BOTH groups → 2 rows with that title
    const titles = Array.from(ctx.root.querySelectorAll('.bd-table-row'))
      .map((r) => r.querySelector('td')?.textContent ?? '');
    expect(titles.filter((t) => t === 'Onboard').length).toBe(2);
  });
});
```

> Keep all describe blocks in this one file. `BoardRendererCtx` may have more required fields than shown — if tsc complains, fill the minimal stubs (the `as BoardRendererCtx` cast above is a safety net) by mirroring `tests/board/table.test.ts`'s `makeCtx`.

- [ ] **Step 2: Run** `npx jest tests/board/grouping.test.ts -t "applyGroup via mountTable"` → FAIL (custom status groups alphabetical/gray; tag card appears once).

- [ ] **Step 3: Implement** — in `src/webview/boardTableRender.ts`, ensure `getStatusOptions` is imported (it is, from the prior feature). Replace the entire `applyGroup` body (lines 705-740) with:

```ts
function applyGroup(cards: Card[], v: ViewDef, b: Board): Group[] {
  if (!v.groupBy) return [{ key: '', cards }];
  const field = v.groupBy;
  const fdef = b.fields.find(x => x.name === field);
  if (!fdef) return [{ key: '', cards }];

  const bucket = new Map<string, Card[]>();
  const push = (key: string, c: Card) => {
    const arr = bucket.get(key) ?? [];
    arr.push(c);
    bucket.set(key, arr);
  };
  const alpha = (a: string, c: string) => {
    if (a === '—') return 1;
    if (c === '—') return -1;
    return a.localeCompare(c, undefined, { sensitivity: 'base' });
  };

  if (fdef.type === 'tags') {
    for (const c of cards) {
      const tags = (c.values[field] ?? '').split(',').map(s => s.trim()).filter(Boolean);
      if (tags.length === 0) push('—', c);
      else for (const t of tags) push(t, c);
    }
    return Array.from(bucket.keys()).sort(alpha).map(k => ({ key: k, cards: bucket.get(k) ?? [] }));
  }

  if (fdef.type === 'status') {
    const opts = getStatusOptions(b, field);
    const valid = new Set(opts.map(o => o.name));
    for (const c of cards) {
      const raw = c.values[field] ?? '';
      push(valid.has(raw) ? raw : 'Uncategorized', c);
    }
    for (const o of opts) if (!bucket.has(o.name)) bucket.set(o.name, []);
    const keys = opts.map(o => o.name);
    if (bucket.has('Uncategorized')) keys.push('Uncategorized');
    return keys.map(k => ({ key: k, cards: bucket.get(k) ?? [] }));
  }

  // text / date / person — exact value, alphabetical, '—' last
  for (const c of cards) push((c.values[field] ?? '') || '—', c);
  return Array.from(bucket.keys()).sort(alpha).map(k => ({ key: k, cards: bucket.get(k) ?? [] }));
}
```

> Note: status unknown/empty values keep the existing **"Uncategorized"** label (preserves current behavior; works for every status field via `getStatusOptions`). This is the one intentional deviation from the spec's "—" wording — preserving the working label is lower-risk and clearer.

- [ ] **Step 4: Run** `npx jest tests/board/grouping.test.ts` → PASS (both new tests + Task 1). Then `npx jest tests/board` → all pass (the existing Status-grouping behavior is preserved because `getStatusOptions(b,'Status')` === `b.columns`).

- [ ] **Step 5: Commit**
```bash
git add src/webview/boardTableRender.ts tests/board/grouping.test.ts
git commit -m "feat(board): group table by any status (options order) or tag (multi-bucket)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Generalize the status sort comparator

**Files:**
- Modify: `src/webview/boardTableRender.ts` — `comparatorFor` status branch (lines 885-888)
- Test: `tests/board/grouping.test.ts`

- [ ] **Step 1: Add failing test** to `tests/board/grouping.test.ts`:

```ts
describe('status sort uses the field options order (any status field)', () => {
  it('sorts a custom status field by its options order, not alphabetical', () => {
    const board: Board = {
      id: 'b1', name: '',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Impact', type: 'status', visibleOnCard: true,
          options: [{ name: 'Low', color: 'teal' }, { name: 'High', color: 'red' }] },
      ],
      cards: [
        { id: 'c1', values: { id:'c1', Title:'A', Status:'Todo', Impact:'High' }, body:'' },
        { id: 'c2', values: { id:'c2', Title:'B', Status:'Todo', Impact:'Low'  }, body:'' },
      ],
      // sort by Impact asc, NOT grouped, so row order reflects the comparator
      orphanBodies: [], views: [{ name: 'table', sort: { field: 'Impact', dir: 'asc' } }], activeView: 'table',
    };
    const { ctx } = makeCtx(board);
    mountTable(ctx);
    const titles = Array.from(ctx.root.querySelectorAll('.bd-table-row'))
      .map((r) => r.querySelector('td')?.textContent ?? '');
    // options order is Low(0), High(1) → B (Low) before A (High)
    expect(titles).toEqual(['B', 'A']);
  });
});
```

- [ ] **Step 2: Run** `npx jest tests/board/grouping.test.ts -t "status sort uses the field options"` → FAIL (comparator uses `board.columns`, where neither Low/High exists → both `1e9`, so order is input order A,B).

- [ ] **Step 3: Implement** — replace the `status` branch in `comparatorFor` (lines 885-888):

```ts
  if (f.type === 'status') {
    const order = new Map(getStatusOptions(b, f.name).map((col, i) => [col.name, i] as const));
    return (a, c) => (order.get(a) ?? 1e9) - (order.get(c) ?? 1e9);
  }
```

- [ ] **Step 4: Run** `npx jest tests/board/grouping.test.ts -t "status sort uses the field options"` → PASS. Then `npx jest tests/board` → all pass.

- [ ] **Step 5: Commit**
```bash
git add src/webview/boardTableRender.ts tests/board/grouping.test.ts
git commit -m "fix(board): status sort orders by the field's own options (any status field)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Colored group bands + tighter rows

**Files:**
- Modify: `src/webview/boardTableRender.ts` — group header render (lines 394-401) + add a `groupColor` helper
- Modify: `src/webview/styles/board.css`
- Test: `tests/board/grouping.test.ts`

- [ ] **Step 1: Add failing test** to `tests/board/grouping.test.ts`:

```ts
describe('group band color', () => {
  it('tints the band by the status option color and colors the chip', () => {
    const board: Board = {
      id: 'b1', name: '',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Impact', type: 'status', visibleOnCard: true,
          options: [{ name: 'Low', color: 'teal' }, { name: 'High', color: 'red' }] },
      ],
      cards: [{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Impact:'High' }, body:'' }],
      orphanBodies: [], views: [{ name: 'table', groupBy: 'Impact' }], activeView: 'table',
    };
    const { ctx } = makeCtx(board);
    mountTable(ctx);
    const highRow = Array.from(ctx.root.querySelectorAll('.bd-group-row'))
      .find((r) => /High/.test(r.textContent || ''))!;
    expect(highRow.classList.contains('bd-group-band')).toBe(true);
    expect(highRow.classList.contains('color-red')).toBe(true);
    // the chip is colored too (not gray)
    const chip = highRow.querySelector('.bd-group-chip')!;
    expect(chip.classList.contains('color-red')).toBe(true);
  });

  it('uses a neutral band (no color class) for the Uncategorized group', () => {
    const board: Board = {
      id: 'b1', name: '',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title', type: 'text', visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Impact', type: 'status', visibleOnCard: true, options: [{ name: 'Low', color: 'teal' }] },
      ],
      cards: [{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Impact:'??' }, body:'' }],
      orphanBodies: [], views: [{ name: 'table', groupBy: 'Impact' }], activeView: 'table',
    };
    const { ctx } = makeCtx(board);
    mountTable(ctx);
    const uncat = Array.from(ctx.root.querySelectorAll('.bd-group-row'))
      .find((r) => /Uncategorized/.test(r.textContent || ''))!;
    expect(uncat.classList.contains('bd-group-band')).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx jest tests/board/grouping.test.ts -t "group band color"` → FAIL (no `bd-group-band`/color class; chip is gray for non-Status).

- [ ] **Step 3: Implement the `groupColor` helper** — add near `applyGroup` in `boardTableRender.ts`, and import `autoColorPublic`:

Add to the existing `./boardModel` import: `autoColorPublic`. Then:

```ts
/** The color token for a group key, or null for a neutral band. */
function groupColor(b: Board, field: string, key: string): ColorToken | null {
  const f = b.fields.find(x => x.name === field);
  if (!f) return null;
  if (f.type === 'status') {
    if (key === 'Uncategorized') return null;
    return getStatusOptions(b, field).find(o => o.name === key)?.color ?? null;
  }
  if (f.type === 'tags' && key !== '—') return autoColorPublic(key);
  return null;
}
```
(Ensure `ColorToken` is imported as a type in this file; add it to the `./boardModel` type import if missing.)

- [ ] **Step 4: Use it in the group header render** — replace lines 394-401 (the `let chipColor = 'gray'; if (v.groupBy === 'Status') {...}` block and the chip className line) with:

```ts
        // Color comes from the grouped field: status option color, tag hash, else neutral.
        const gc = groupColor(b, v.groupBy!, g.key);
        const chipColor = gc ?? 'gray';
        if (gc) row.classList.add('bd-group-band', `color-${gc}`);
        const chip = document.createElement('span');
        chip.className = `board-column-chip color-${chipColor} bd-group-chip`;
```

(Leave the rest of the chip/dot/name/count construction below unchanged.)

- [ ] **Step 5: Add CSS** to `src/webview/styles/board.css`:

```css
/* Grouped-table: tint the whole group band in the group's color. */
.bd-group-band.color-gray    { background: var(--board-chip-gray-bg); }
.bd-group-band.color-blue    { background: var(--board-chip-blue-bg); }
.bd-group-band.color-amber   { background: var(--board-chip-amber-bg); }
.bd-group-band.color-emerald { background: var(--board-chip-green-bg); }
.bd-group-band.color-red     { background: var(--board-chip-red-bg); }
.bd-group-band.color-purple  { background: var(--board-chip-purple-bg); }
.bd-group-band.color-orange  { background: var(--board-chip-orange-bg); }
.bd-group-band.color-teal    { background: var(--board-chip-teal-bg); }
.bd-group-band.color-indigo  { background: var(--board-chip-indigo-bg); }
.bd-group-band.color-pink    { background: var(--board-chip-pink-bg); }
```

> Verify the exact `--board-chip-<token>-bg` variable names by reading board.css first (note `emerald` maps to the `green` variable, matching the existing chip convention). If the variables differ, use the actual names.

- [ ] **Step 6: Tighter rows** — in `board.css`, find the data-cell rule `.bd-table-cell` (or `.bd-table-row td`) and reduce its vertical padding modestly (e.g. from its current value to `5px`/`6px` top-bottom). Read the current value first; make a small reduction that visibly shortens rows without cramping. Keep horizontal padding unchanged.

- [ ] **Step 7: Run** `npx jest tests/board/grouping.test.ts -t "group band color"` → PASS. Then `npx jest tests/board` → all pass. Then `npx tsc -p tsconfig.webview.json --noEmit` → no new errors in touched files.

- [ ] **Step 8: Commit**
```bash
git add src/webview/boardTableRender.ts src/webview/styles/board.css tests/board/grouping.test.ts
git commit -m "feat(board): tint group bands by group color; tighter table rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: "Remove grouping" menu item

**Files:**
- Modify: `src/webview/boardTableRender.ts` — `openColumnMenu`, the `mkItem(ICON.group, 'Group by this', ...)` at line 809
- Test: `tests/board/grouping.test.ts`

- [ ] **Step 1: Add failing test** to `tests/board/grouping.test.ts`:

```ts
describe('Remove grouping menu item', () => {
  const colMenuLabels = (root: HTMLElement, fieldName: string) => {
    const th = Array.from(root.querySelectorAll('th'))
      .find((h) => (h.textContent || '').includes(fieldName))!;
    (th.querySelector('.bd-col-menu-btn') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return Array.from(document.querySelectorAll('.bd-col-menu-label')).map((n) => n.textContent);
  };
  const baseBoard = (groupBy?: string): Board => ({
    id: 'b1', name: '',
    columns: [{ name: 'Todo', color: 'blue' }],
    fields: [
      { name: 'Title', type: 'text', visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Impact', type: 'status', visibleOnCard: true, options: [{ name: 'Low', color: 'teal' }] },
    ],
    cards: [{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Impact:'Low' }, body:'' }],
    orphanBodies: [], views: [{ name: 'table', ...(groupBy ? { groupBy } : {}) }], activeView: 'table',
  });

  it('shows "Remove grouping" on the actively-grouped column', () => {
    const { ctx } = makeCtx(baseBoard('Impact'));
    mountTable(ctx);
    expect(colMenuLabels(ctx.root, 'Impact')).toContain('Remove grouping');
  });

  it('shows "Group by this" on a column that is not the active group', () => {
    const { ctx } = makeCtx(baseBoard('Impact'));
    mountTable(ctx);
    expect(colMenuLabels(ctx.root, 'Status')).toContain('Group by this');
  });

  it('clicking "Remove grouping" clears view.groupBy', () => {
    const { ctx, boardRef } = makeCtx(baseBoard('Impact'));
    mountTable(ctx);
    colMenuLabels(ctx.root, 'Impact'); // opens the menu
    const item = Array.from(document.querySelectorAll('.bd-col-menu-item'))
      .find((n) => /Remove grouping/.test(n.textContent || '')) as HTMLElement;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(boardRef.current.views.find(v => v.name === 'table')?.groupBy).toBeUndefined();
  });
});
```

> Confirm the column-menu button class is `.bd-col-menu-btn`, items `.bd-col-menu-item`, labels `.bd-col-menu-label` (from the existing `openColumnMenu`). Adjust selectors to the actual DOM if different.

- [ ] **Step 2: Run** `npx jest tests/board/grouping.test.ts -t "Remove grouping menu item"` → FAIL (only "Group by this" exists).

- [ ] **Step 3: Implement** — `setViewGroup` is already imported from `./boardOps`. Replace the existing single `mkItem(ICON.group, 'Group by this', () => {...})` (line 809) with a conditional that depends on whether THIS field is the active table group:

```ts
  const tableGroupBy = ctx.getBoard().views.find(x => x.name === 'table')?.groupBy;
  if (tableGroupBy === f.name) {
    mkItem(ICON.group, 'Remove grouping', () => {
      collapsedGroups.clear();
      const cur = ctx.getBoard();
      const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
      setViewGroup(b2, 'table', null);
      ctx.mutate(b2);
    });
  } else {
    mkItem(ICON.group, 'Group by this', () => {
      collapsedGroups.clear();
      const cur = ctx.getBoard();
      const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
      setViewGroup(b2, 'table', f.name);
      ctx.mutate(b2);
    });
  }
```

(Preserve the exact body of the existing "Group by this" handler — copy it verbatim into the `else`.)

- [ ] **Step 4: Run** `npx jest tests/board/grouping.test.ts -t "Remove grouping menu item"` → PASS. Then `npx jest tests/board` → all pass. Then `npx tsc -p tsconfig.webview.json --noEmit` → no new errors in touched files.

- [ ] **Step 5: Commit**
```bash
git add src/webview/boardTableRender.ts tests/board/grouping.test.ts
git commit -m "feat(board): Remove grouping entry on the actively-grouped column

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `npx jest tests/board` — all board suites pass.
- [ ] `npx tsc -p tsconfig.webview.json --noEmit` — no errors in feature files.
- [ ] Manual: open a board in the app, add a second status column + a tag column; group the table by each (column ⋯ → Group by this). Confirm: bands are tinted in the right colors and order; a multi-tag card shows under each of its tags; rows are tighter; "Remove grouping" appears on the grouped column and clears it; existing Status grouping/sorting still works.

## Risks
- **Multi-bucket drag:** a tag-grouped card appears in multiple `lastGroups` buckets; row drag finds the first matching group. Leave drag behavior as-is (don't attempt cross-group tag mutation via drag in this task) — note any oddity for follow-up.
- **Tag group counts overlap** (sum > card count) — intended, matches Notion; don't "fix".
- Keep changes additive; do not regress text/date/person grouping or the built-in Status path (`getStatusOptions(b,'Status') === b.columns`).
