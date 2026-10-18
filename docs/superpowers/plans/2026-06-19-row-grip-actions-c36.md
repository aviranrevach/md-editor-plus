# Row-Grip Actions (c36) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board-table row grip do everything to a row — click opens a row-actions menu (Open / Duplicate / Insert above / Insert below / Delete), drag still reorders, and cross-group drops re-assign the group field instead of being silently rejected.

**Architecture:** Add pure row mutations to `boardOps` (unit-testable). Extend the shared `startDrag` helper with an `onClick` callback so a no-movement release on the grip is distinguishable from a drag and from an external cancel. Wire a row-actions menu (built with the existing `createMenu` component, positioned by the existing popover/`placeFloating` infra) into the table's delegated grip handler, and replace the cross-group drop rejection with a field re-assignment.

**Tech Stack:** TypeScript, jsdom + Jest tests, ProseMirror-hosted webview. No new dependencies.

## Global Constraints

- Board table view only. Regular markdown tables are out of scope (tracked as c46).
- Reuse existing components: `createMenu`/`createPopover` (`menu.ts`/`popover.ts`) and `placeFloating` (`menuPosition.ts`). Do NOT hand-roll a menu or positioning.
- All board mutations go through `ctx.mutate(nextBoard)` with a shallow-cloned board (`{ ...cur, cards: [...] }`) — never mutate the board returned by `ctx.getBoard()` in place at the call site.
- Read-only: the grip is not rendered when `ctx.readonly` (today's behavior) — no extra guard needed.
- Delete is immediate, no confirmation dialog.
- Run the full suite with `npm test`. Baseline has 2 pre-existing failing suites (`tests/toggle.test.ts`, `tests/board/grouping.test.ts`) that are stale type-checks unrelated to this work — 562 real tests pass. Do not "fix" those here; just confirm your new/changed tests pass and you add no new failures.

---

## File Structure

- `src/webview/boardOps.ts` — **modify**: add `deleteCard`, `duplicateCard`, `insertCardAt`, `moveCardToGroup`. Add `Card` to the type import.
- `src/webview/boardDragShared.ts` — **modify**: add optional `onClick` to `startDrag` opts; fire it on a no-movement release.
- `src/webview/boardTableRender.ts` — **modify**: grip rendering (always clickable), grip delegated handler (click → menu, drag only when not sorted), `startRowDrag` (forward `onClick`, allow cross-group drops), new `openRowMenu` + `groupKeyToValue` helpers.
- `tests/board/ops.test.ts` — **modify**: unit tests for the four new `boardOps` functions.
- `tests/board/drag-shared.test.ts` — **modify**: test for `startDrag` `onClick`.
- `tests/board/table.test.ts` — **modify**: DOM tests for the grip menu (open, Delete, Duplicate, sorted-state).

---

## Task 1: boardOps row mutations

**Files:**
- Modify: `src/webview/boardOps.ts`
- Test: `tests/board/ops.test.ts`

**Interfaces:**
- Consumes: existing `addCard(board, presets)`, `moveCard(board, fromId, beforeId)`, `mintCardId(ids)` (from `boardModel`).
- Produces:
  - `deleteCard(board: Board, id: string): void`
  - `duplicateCard(board: Board, id: string): string` — returns new card id
  - `insertCardAt(board: Board, beforeId: string | null, presets?: Partial<Record<string, string>>): string` — returns new card id
  - `moveCardToGroup(board: Board, cardId: string, groupByField: string, value: string, beforeId: string | null): void`

- [ ] **Step 1: Write failing tests**

Add to `tests/board/ops.test.ts` (the file already has a `makeBoard()` factory with cards `c1` Status=Todo and `c2` Status=Doing — reuse it):

```typescript
describe('boardOps.deleteCard', () => {
  it('removes the card with the given id', () => {
    const b = makeBoard();
    ops.deleteCard(b, 'c1');
    expect(b.cards.map(c => c.id)).toEqual(['c2']);
  });
  it('is a no-op for an unknown id', () => {
    const b = makeBoard();
    ops.deleteCard(b, 'nope');
    expect(b.cards).toHaveLength(2);
  });
});

describe('boardOps.duplicateCard', () => {
  it('inserts a clone directly after the source with a fresh id', () => {
    const b = makeBoard();
    const newId = ops.duplicateCard(b, 'c1');
    expect(newId).not.toBe('c1');
    expect(b.cards.map(c => c.id)).toEqual(['c1', newId, 'c2']);
  });
  it('deep-copies values (incl. id) and body without aliasing', () => {
    const b = makeBoard();
    b.cards[0].body = 'hello';
    const newId = ops.duplicateCard(b, 'c1');
    const clone = b.cards.find(c => c.id === newId)!;
    expect(clone.values).toEqual({ ...b.cards[0].values, id: newId });
    expect(clone.values).not.toBe(b.cards[0].values);
    expect(clone.body).toBe('hello');
    clone.values.Title = 'changed';
    expect(b.cards[0].values.Title).toBe('A'); // original untouched
  });
});

describe('boardOps.insertCardAt', () => {
  it('inserts a blank card before the anchor and returns its id', () => {
    const b = makeBoard();
    const id = ops.insertCardAt(b, 'c2', {});
    expect(b.cards.map(c => c.id)).toEqual(['c1', id, 'c2']);
  });
  it('appends at the end when beforeId is null', () => {
    const b = makeBoard();
    const id = ops.insertCardAt(b, null, {});
    expect(b.cards[b.cards.length - 1].id).toBe(id);
  });
  it('applies presets to the new card', () => {
    const b = makeBoard();
    const id = ops.insertCardAt(b, 'c1', { Status: 'Doing' });
    expect(b.cards.find(c => c.id === id)!.values.Status).toBe('Doing');
  });
});

describe('boardOps.moveCardToGroup', () => {
  it('sets the group field and moves the card before the anchor', () => {
    const b = makeBoard(); // c1 Status=Todo, c2 Status=Doing
    ops.moveCardToGroup(b, 'c1', 'Status', 'Doing', 'c2');
    const c1 = b.cards.find(c => c.id === 'c1')!;
    expect(c1.values.Status).toBe('Doing');
    expect(b.cards.map(c => c.id)).toEqual(['c1', 'c2']); // c1 placed before c2
  });
  it('appends within the group when beforeId is null', () => {
    const b = makeBoard();
    ops.moveCardToGroup(b, 'c1', 'Status', 'Doing', null);
    expect(b.cards.map(c => c.id)).toEqual(['c2', 'c1']);
    expect(b.cards.find(c => c.id === 'c1')!.values.Status).toBe('Doing');
  });
  it('does not alias the original values object', () => {
    const b = makeBoard();
    const before = b.cards.find(c => c.id === 'c1')!.values;
    ops.moveCardToGroup(b, 'c1', 'Status', 'Doing', null);
    const after = b.cards.find(c => c.id === 'c1')!.values;
    expect(after).not.toBe(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/board/ops.test.ts -t 'deleteCard|duplicateCard|insertCardAt|moveCardToGroup'`
Expected: FAIL — `ops.deleteCard is not a function` (and the others).

- [ ] **Step 3: Implement the four functions**

In `src/webview/boardOps.ts`, change the type import at the top from:

```typescript
import type { Board, ViewDef } from './boardModel';
```
to:
```typescript
import type { Board, Card, ViewDef } from './boardModel';
```

Then add these functions (place them right after the existing `moveCard` function):

```typescript
export function deleteCard(board: Board, id: string): void {
  board.cards = board.cards.filter(c => c.id !== id);
}

export function duplicateCard(board: Board, id: string): string {
  const idx = board.cards.findIndex(c => c.id === id);
  if (idx < 0) return id;
  const src = board.cards[idx];
  const newId = mintCardId(board.cards.map(c => c.id));
  const clone: Card = { id: newId, values: { ...src.values, id: newId }, body: src.body };
  board.cards.splice(idx + 1, 0, clone);
  return newId;
}

/** Create a blank card (via addCard) and position it before `beforeId`
 *  (or at the end when null). Returns the new card id. */
export function insertCardAt(
  board: Board,
  beforeId: string | null,
  presets: Partial<Record<string, string>> = {},
): string {
  const id = addCard(board, presets);
  moveCard(board, id, beforeId);
  return id;
}

/** Re-assign a card's group field to `value`, then position it before
 *  `beforeId` (or at the end of the array when null). Used for cross-group
 *  drag in the table. */
export function moveCardToGroup(
  board: Board,
  cardId: string,
  groupByField: string,
  value: string,
  beforeId: string | null,
): void {
  const idx = board.cards.findIndex(c => c.id === cardId);
  if (idx < 0) return;
  board.cards[idx] = {
    ...board.cards[idx],
    values: { ...board.cards[idx].values, [groupByField]: value },
  };
  moveCard(board, cardId, beforeId);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/board/ops.test.ts`
Expected: PASS (all describe blocks, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardOps.ts tests/board/ops.test.ts
git commit -m "feat(c36): boardOps row mutations (delete/duplicate/insert/moveToGroup)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: startDrag onClick callback

**Files:**
- Modify: `src/webview/boardDragShared.ts`
- Test: `tests/board/drag-shared.test.ts`

**Interfaces:**
- Produces: `startDrag(startEvent, { onMove, onDrop, onCancel?, onClick? })` — `onClick` fires once on mouseup when the pointer never moved past `DRAG_THRESHOLD_PX`. A no-movement release fires `onCancel` (cleanup) **and then** `onClick`. The returned cancel function (external cancel) fires only `onCancel`, never `onClick`.

- [ ] **Step 1: Write the failing test**

Add to `tests/board/drag-shared.test.ts` (it already uses jsdom and dispatches MouseEvents — match its style):

```typescript
describe('startDrag onClick', () => {
  it('fires onClick (not onDrop) on a release with no movement', () => {
    const onDrop = jest.fn();
    const onClick = jest.fn();
    const down = new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true });
    startDrag(down, { onMove: () => {}, onDrop, onClick });
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 10, clientY: 10, bubbles: true }));
    expect(onDrop).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('fires onDrop (not onClick) once moved past threshold', () => {
    const onDrop = jest.fn();
    const onClick = jest.fn();
    const down = new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true });
    startDrag(down, { onMove: () => {}, onDrop, onClick });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100, bubbles: true }));
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('external cancel fires onCancel but never onClick', () => {
    const onCancel = jest.fn();
    const onClick = jest.fn();
    const down = new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true });
    const cancel = startDrag(down, { onMove: () => {}, onDrop: () => {}, onCancel, onClick });
    cancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

Confirm the test file imports `startDrag` (add `import { startDrag } from '../../src/webview/boardDragShared';` if not already present).

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/board/drag-shared.test.ts -t 'onClick'`
Expected: FAIL — `onClick` is invoked 0 times (the option is currently ignored).

- [ ] **Step 3: Implement**

In `src/webview/boardDragShared.ts`, update the `startDrag` opts type and the `onUp` handler:

```typescript
export function startDrag(
  startEvent: MouseEvent,
  opts: {
    onMove:    (e: MouseEvent) => void;
    onDrop:    (e: MouseEvent) => void;
    onCancel?: () => void;
    onClick?:  () => void;
  },
): () => void {
  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  let moved = false;

  const onMove = (e: MouseEvent) => {
    if (!moved) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      moved = true;
    }
    opts.onMove(e);
  };

  const onUp = (e: MouseEvent) => {
    teardown();
    if (moved) {
      opts.onDrop(e);
    } else {
      // No movement: clean up (onCancel) then treat as a click.
      opts.onCancel?.();
      opts.onClick?.();
    }
  };

  const teardown = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup',   onUp,   true);
  };

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup',   onUp,   true);

  // Returned cancel — unwires AND fires onCancel (never onClick).
  return () => {
    teardown();
    opts.onCancel?.();
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/board/drag-shared.test.ts`
Expected: PASS (new onClick tests + all pre-existing drag-shared tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardDragShared.ts tests/board/drag-shared.test.ts
git commit -m "feat(c36): startDrag onClick for no-movement releases

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Cross-group drag re-assigns the group field

**Files:**
- Modify: `src/webview/boardTableRender.ts` (`startRowDrag`, plus a new `groupKeyToValue` helper)
- Test: covered by `boardOps.moveCardToGroup` (Task 1) + manual verification (jsdom can't drive `elementFromPoint`, which the drag's `onMove` relies on)

**Interfaces:**
- Consumes: `moveCardToGroup` (Task 1), the `Group` interface (`{ key: string; cards: Card[] }`), `startDrag` `onClick` (Task 2).
- Produces: `startRowDrag(e, card, group, ctx, groups, groupBy, onClick)` — extended signature; `groupKeyToValue(key: string): string`.

- [ ] **Step 1: Add the group-key → field-value helper**

In `src/webview/boardTableRender.ts`, add near `applyGroup` (around line 846):

```typescript
/** Map a rendered group key back to the stored field value. The empty/
 *  catch-all buckets render as '—' (generic/tags) or 'Uncategorized'
 *  (status); both mean "no value". Mirrors the add-row preset at the
 *  group header. */
function groupKeyToValue(key: string): string {
  return (key === '—' || key === 'Uncategorized') ? '' : key;
}
```

- [ ] **Step 2: Extend `startRowDrag` to allow cross-group drops**

Replace the entire `startRowDrag` function (currently lines ~206-253) with:

```typescript
function startRowDrag(
  e: MouseEvent,
  card: Card,
  group: Group,
  ctx: BoardRendererCtx,
  groups: Group[],
  groupBy: string | undefined,
  onClick: () => void,
): () => void {
  const ind = dropIndicator();
  ind.style.position = 'fixed';
  document.body.appendChild(ind);
  let dropBeforeId: string | null = null;
  let dropGroupKey: string | null = null;   // null = same group (reorder only)
  let hasValidDrop = false;
  return startDrag(e, {
    onMove: (ev) => {
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('tr.bd-table-row') as HTMLElement | null;
      if (!target) { ind.hide(); hasValidDrop = false; return; }
      const targetCardId = target.dataset.cardId!;
      const targetGroup = groups.find(g => g.cards.some(c => c.id === targetCardId));
      if (!targetGroup) { ind.hide(); hasValidDrop = false; return; }
      hasValidDrop = true;
      ind.classList.remove('bd-drop-line-reject');
      const r = target.getBoundingClientRect();
      const above = ev.clientY < r.top + r.height / 2;
      const y = above ? r.top : r.bottom;
      ind.show(r.left, y - 1, r.width, 2);
      const idxInGroup = targetGroup.cards.findIndex(c => c.id === targetCardId);
      dropBeforeId = above ? targetCardId : (targetGroup.cards[idxInGroup + 1]?.id ?? null);
      // Cross-group only matters when the view is grouped and the target
      // group differs from the card's source group.
      dropGroupKey = (groupBy && targetGroup.key !== group.key) ? targetGroup.key : null;
    },
    onDrop: () => {
      ind.remove();
      suppressNextClick();
      if (!hasValidDrop) return;
      const cur = ctx.getBoard();
      const b2: Board = { ...cur, cards: [...cur.cards] };
      if (dropGroupKey !== null && groupBy) {
        moveCardToGroup(b2, card.id, groupBy, groupKeyToValue(dropGroupKey), dropBeforeId);
      } else {
        moveCard(b2, card.id, dropBeforeId);
      }
      ctx.mutate(b2);
    },
    onCancel: () => ind.remove(),
    onClick,
  });
}
```

Update the import line at the top of the file to include `moveCardToGroup`:

```typescript
import { setViewSort, setViewGroup, setViewWidth, setViewColumns, hideFieldInView, addCard, moveCard, moveCardToGroup } from './boardOps';
```

(The grip handler call site that passes the new arguments is updated in Task 4 — until then the file will not compile, so Tasks 3 and 4 share a commit. Do the commit at the end of Task 4.)

- [ ] **Step 3: Verify the moveCardToGroup unit tests still pass**

Run: `npx jest tests/board/ops.test.ts -t 'moveCardToGroup'`
Expected: PASS (logic unchanged from Task 1).

No commit here — proceed directly to Task 4 (they compile and ship together).

---

## Task 4: Row-actions menu + grip click + sorted-state grip

**Files:**
- Modify: `src/webview/boardTableRender.ts` (grip rendering, grip delegated handler, new `openRowMenu`)
- Test: `tests/board/table.test.ts`

**Interfaces:**
- Consumes: `createMenu` (`./menu`), `deleteCard`/`duplicateCard`/`insertCardAt` (Task 1), `startDrag` `onClick` (Task 2), extended `startRowDrag` (Task 3).
- Produces: `openRowMenu(anchor: HTMLElement, card: Card, ctx: BoardRendererCtx)`.

- [ ] **Step 1: Write failing DOM tests**

Add to `tests/board/table.test.ts` (reuses its `makeBoard()` / `makeCtx()` factories):

```typescript
// Helper: simulate a plain click (mousedown + mouseup, no movement) on an element.
function clickNoDrag(el: Element): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 5, clientY: 5 }));
}

describe('row grip actions menu', () => {
  it('opens a menu with the full action set on grip click (unsorted)', () => {
    const { ctx } = makeCtx(makeBoard());
    mountTable(ctx);
    const grip = ctx.root.querySelector('.bd-row-grip')!;
    clickNoDrag(grip);
    const labels = Array.from(document.querySelectorAll('.mp-menu .mp-menu-label'))
      .map(el => el.textContent);
    expect(labels).toEqual([
      'Open in side panel', 'Duplicate', 'Insert row above', 'Insert row below', 'Delete row',
    ]);
  });

  it('Delete row removes the card', () => {
    const { ctx, boardRef } = makeCtx(makeBoard());
    mountTable(ctx);
    const firstGrip = ctx.root.querySelector('tr.bd-table-row .bd-row-grip')!;
    clickNoDrag(firstGrip);
    const del = Array.from(document.querySelectorAll('.mp-menu .mp-menu-item'))
      .find(el => el.textContent?.includes('Delete row'))!;
    del.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(boardRef.current.cards.map(c => c.id)).toEqual(['c2']);
  });

  it('Duplicate adds a clone directly after the source', () => {
    const { ctx, boardRef } = makeCtx(makeBoard());
    mountTable(ctx);
    const firstGrip = ctx.root.querySelector('tr.bd-table-row .bd-row-grip')!;
    clickNoDrag(firstGrip);
    const dup = Array.from(document.querySelectorAll('.mp-menu .mp-menu-item'))
      .find(el => el.textContent?.includes('Duplicate'))!;
    dup.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(boardRef.current.cards).toHaveLength(3);
    expect(boardRef.current.cards[0].id).toBe('c1');
    expect(boardRef.current.cards[1].id).not.toBe('c1'); // clone sits after source
  });

  it('omits Insert items and drops drag affordance when the view is sorted', () => {
    const board = makeBoard({ views: [{ name: 'table', sort: { field: 'Title', dir: 'asc' } }] });
    const { ctx } = makeCtx(board);
    mountTable(ctx);
    const grip = ctx.root.querySelector('.bd-row-grip')!;
    expect(grip.hasAttribute('data-board-drag')).toBe(false);
    clickNoDrag(grip);
    const labels = Array.from(document.querySelectorAll('.mp-menu .mp-menu-label'))
      .map(el => el.textContent);
    expect(labels).toEqual(['Open in side panel', 'Duplicate', 'Delete row']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/board/table.test.ts -t 'row grip actions menu'`
Expected: FAIL — clicking the grip opens no menu (`.mp-menu` not found), so `labels` is `[]`.

- [ ] **Step 3: Add the `openRowMenu` helper and a shared menu instance**

In `src/webview/boardTableRender.ts`, add the import for `createMenu` near the other imports:

```typescript
import { createMenu } from './menu';
import type { MenuSection } from './menu';
```

Add a module-level menu singleton and the opener (place after the imports / near other module-level helpers):

```typescript
// One reused menu instance for all row grips (matches the column-menu pattern;
// opening it dismisses any other floating panel via the popover registry).
const rowMenu = createMenu({ className: 'bd-row-menu' });

// Inline icons (stroke-based, 16px) for the row-actions menu.
const RM_ICON = {
  open: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M21 3l-9 9M10 5H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>',
  insert: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>',
};

function openRowMenu(anchor: HTMLElement, card: Card, ctx: BoardRendererCtx): void {
  const board = ctx.getBoard();
  const v = board.views.find(x => x.name === 'table');
  const sorted = !!v?.sort;
  const groupBy = v?.groupBy;
  // Preset the group field so inserted rows land in the same group as `card`.
  const insertPresets: Partial<Record<string, string>> = groupBy
    ? { [groupBy]: card.values[groupBy] ?? '' }
    : {};

  const cloneBoard = (): Board => ({ ...ctx.getBoard(), cards: [...ctx.getBoard().cards] });

  const sections: MenuSection[] = [
    { items: [
      { icon: RM_ICON.open, label: 'Open in side panel', onSelect: () => ctx.openSidePanel(card.id) },
    ] },
    { items: [
      { icon: RM_ICON.duplicate, label: 'Duplicate', onSelect: () => {
        const b2 = cloneBoard(); duplicateCard(b2, card.id); ctx.mutate(b2);
      } },
      ...(sorted ? [] : [
        { icon: RM_ICON.insert, label: 'Insert row above', onSelect: () => {
          const b2 = cloneBoard(); insertCardAt(b2, card.id, insertPresets); ctx.mutate(b2);
        } },
        { icon: RM_ICON.insert, label: 'Insert row below', onSelect: () => {
          const b2 = cloneBoard();
          const after = b2.cards[b2.cards.findIndex(c => c.id === card.id) + 1]?.id ?? null;
          insertCardAt(b2, after, insertPresets); ctx.mutate(b2);
        } },
      ]),
    ] },
    { items: [
      { icon: RM_ICON.trash, label: 'Delete row', variant: 'danger', onSelect: () => {
        const b2 = cloneBoard(); deleteCard(b2, card.id); ctx.mutate(b2);
      } },
    ] },
  ];

  rowMenu.open(anchor, sections);
}
```

Update the `boardOps` import line to also pull the row mutations (combine with the Task 3 edit):

```typescript
import { setViewSort, setViewGroup, setViewWidth, setViewColumns, hideFieldInView, addCard, moveCard, moveCardToGroup, deleteCard, duplicateCard, insertCardAt } from './boardOps';
```

- [ ] **Step 4: Make the grip always clickable (rendering)**

Replace the grip-rendering block (currently lines ~556-569, inside the per-card loop) with:

```typescript
const grip = document.createElement('span');
grip.className = 'bd-row-grip';
if (v.sort) {
  // Sorted: order is computed, so dragging to reorder is meaningless — no
  // drag affordance. The grip stays clickable for the row-actions menu.
  grip.title = 'Row actions';
} else {
  grip.setAttribute('data-board-drag', '');
  grip.title = 'Drag to reorder · click for actions';
}
grip.innerHTML = `<svg viewBox="0 0 8 14" width="8" height="14"><circle cx="2" cy="3" r="1"/><circle cx="6" cy="3" r="1"/><circle cx="2" cy="7" r="1"/><circle cx="6" cy="7" r="1"/><circle cx="2" cy="11" r="1"/><circle cx="6" cy="11" r="1"/></svg>`;
gutter.appendChild(grip);
```

(Note: this drops the `bd-row-grip-disabled` class. Its CSS rule becomes dead — leave it; removing styles is out of scope for c36.)

- [ ] **Step 5: Update the grip delegated handler (click → menu; drag only when not sorted)**

Replace the grip branch in `onDocMousedown` (currently lines ~767-787) with:

```typescript
const gripEl = target.closest('.bd-row-grip') as HTMLElement | null;
if (gripEl) {
  const tr = gripEl.closest('tr.bd-table-row') as HTMLElement | null;
  const cardId = tr?.dataset.cardId;
  if (!cardId) return;
  const b = ctx.getBoard();
  const card = b.cards.find(c => c.id === cardId);
  if (!card) return;
  e.preventDefault();
  e.stopPropagation();
  const openMenu = (): void => openRowMenu(gripEl, card, ctx);
  if (gripEl.hasAttribute('data-board-drag')) {
    const v = b.views.find(x => x.name === 'table');
    // First matching bucket (a multi-tag card can appear in several); moveCard
    // works by id on the global array so there's no duplication/loss.
    const group = lastGroups.find(g => g.cards.some(c => c.id === cardId)) ?? { key: '', cards: [card] };
    tr?.classList.add('bd-tr-dragging');
    cancelRowDrag = startRowDrag(e, card, group, ctx, lastGroups, v?.groupBy, openMenu);
    document.addEventListener('mouseup', () => tr?.classList.remove('bd-tr-dragging'), { once: true });
  } else {
    // Sorted view: no drag, but a click still opens the menu.
    startDrag(e, { onMove: () => {}, onDrop: () => {}, onClick: openMenu });
  }
  return;
}
```

Confirm `startDrag` is imported at the top of the file (it is — `startRowDrag` already uses it; if the import is indirect, add `import { startDrag, dropIndicator } from './boardDragShared';`).

- [ ] **Step 6: Run the table tests to verify they pass**

Run: `npx jest tests/board/table.test.ts -t 'row grip actions menu'`
Expected: PASS (all four cases).

- [ ] **Step 7: Type-check + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` clean; suite shows only the 2 pre-existing failing suites (`toggle.test.ts`, `grouping.test.ts`) and your new tests passing. No new failures.

- [ ] **Step 8: Commit (Tasks 3 + 4 together)**

```bash
git add src/webview/boardTableRender.ts tests/board/table.test.ts
git commit -m "feat(c36): row-grip click opens actions menu + cross-group drag

Click the table row grip to open Open/Duplicate/Insert/Delete; drag still
reorders and now re-assigns the group field on cross-group drops. Insert
items hidden when sorted; grip clickable in every view state.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Manual verification + docs

**Files:**
- Modify: `CHANGELOG.md` (and `README.md` if it lists board features) — per the "docs before push" rule.

**Interfaces:** none.

- [ ] **Step 1: Manual smoke test (F5 the extension)**

Open a markdown file with a board in table view and confirm:
- Hover a row → grip appears. **Click** it → menu opens beside the grip (never clipped off-screen).
- **Open in side panel** opens the card panel; **Duplicate** adds a row right below; **Insert above/below** add blank rows in the right place; **Delete row** removes it immediately.
- **Drag** the grip → still reorders within a group.
- Group the table by Status → drag a row from one group into another → its Status changes to the target group (and dropping into "Uncategorized" clears Status).
- Sort the table → grip has no drag, but click still opens the menu and the Insert items are gone.
- Toggle read-only → no grip at all.

- [ ] **Step 2: Update the changelog**

Add an entry under the current version in `CHANGELOG.md`:

```markdown
- **Board table row actions (c36):** click the row grip to open a menu — Open in side panel, Duplicate, Insert row above/below, Delete. Dragging a row between groups now re-assigns the group field (like kanban). The grip stays usable when the table is sorted.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs(c36): changelog for row-grip actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Click opens menu → Task 4. Drag reorders (unchanged) → Task 4 (draggable branch). Cross-group re-assign → Tasks 1+3. Menu option B contents → Task 4. Insert hidden when sorted → Task 4 (`sorted` branch). Grip clickable when sorted → Tasks 4 (rendering + handler). Read-only no grip → unchanged (grip only rendered when `!ctx.readonly`, preserved). `boardOps` additions → Task 1. Reuse createMenu/placeFloating → Task 4 (`createMenu`; `placeFloating` is inside `popover.open`). Immediate delete → Task 4 (no confirm). Tests incl. round-trip class → ops + table tests. All spec sections map to a task. ✓
- Empty-group key mapping ('—'/'Uncategorized' → '') → Task 3 `groupKeyToValue`. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `deleteCard`/`duplicateCard`/`insertCardAt`/`moveCardToGroup` signatures match between Task 1 (definition), Task 3 (`moveCardToGroup` usage), and Task 4 (menu usage). `startDrag` `onClick` defined in Task 2 and consumed in Tasks 3–4. `startRowDrag`'s extended 7-arg signature defined in Task 3 and called with exactly those args in Task 4. `openRowMenu(anchor, card, ctx)` defined and called consistently. ✓
