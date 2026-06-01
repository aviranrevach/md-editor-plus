# Board Table View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second view ("Table") to the existing kanban board block, with inline cell editing, sort, group-by, resizable column widths, and row/column reorder. View choice persists in the markdown source via new `<!-- board:view -->` marker sections.

**Architecture:** Extend the board's existing model with a `views` array + `activeView`. Split the current `boardBlock.ts` (~1100 lines) into a controller + two renderer modules (`boardKanbanRender.ts` extracted, `boardTableRender.ts` new). Share mutation logic (`boardOps.ts`) and drag chrome (`boardDragShared.ts`) between renderers. The view switcher lives inside a redesigned `⋯` menu that replaces the existing Properties button.

**Tech Stack:** TypeScript, Jest (ts-jest, node env), JSDOM for DOM-touching tests (per-file via `@jest-environment jsdom`), Tiptap (board is a Tiptap node), pure DOM (no framework in renderers).

**Spec:** `docs/superpowers/specs/2026-05-23-board-table-view-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/webview/boardModel.ts` | extended | Add `ViewDef` type, extend `Board` with `views` + `activeView`, parse + serialize `<!-- board:view -->` markers |
| `src/webview/boardOps.ts` | **NEW** | Pure mutations on `Board` (`addCard`, `deleteCard`, `setField`, `addField`, `hideField`, `showField`, `setViewSort`, `setViewGroup`, `setViewWidth`, etc.) |
| `src/webview/boardDragShared.ts` | **NEW** | Manual mousedown/move/up drag pattern + blue-line drop indicator helper, used by both renderers |
| `src/webview/boardKanbanRender.ts` | **NEW (extracted)** | Current kanban DOM/drag/columns/add-card code, pulled out of `boardBlock.ts` and adapted to the renderer contract |
| `src/webview/boardTableRender.ts` | **NEW** | Table renderer: header, body, group headers, inline editors, sort/group/widths/reorder |
| `src/webview/boardBlock.ts` | slimmed | Tiptap node + DOM root + chrome (name, ⋯ menu) + picks renderer based on `board.activeView` + side-panel lifecycle |
| `src/webview/boardSidePanel.ts` | unchanged | Side panel (existing, shared) |
| `src/webview/boardProperties.ts` | small changes | Accept a `viewName` scope so hide/reorder writes to the correct view |
| `src/webview/styles/board.css` | extended | Add table styles (`.bd-table`, `.bd-table-cell`, `.bd-table-group`, etc.) |
| `src/webview/blockPicker.ts` | extended | Split existing `/board` entry into `/board kanban` and `/board table` |
| `tests/board/parse.test.ts` | extended | Add `board:view` and `active-view` parsing fixtures |
| `tests/board/serialize.test.ts` | extended | Add round-trip for views, including "no spurious diff" for kanban-only boards |
| `tests/board/ops.test.ts` | **NEW** | Unit tests for every `boardOps` function |
| `tests/board/table.test.ts` | **NEW** | JSDOM tests for table renderer (sort, group, cells, drag) |

---

## Task 1: Extend the data model with `ViewDef`

**Files:**
- Modify: `src/webview/boardModel.ts`

- [ ] **Step 1: Add the new types**

At the top of `boardModel.ts`, after the existing `Card` interface:

```ts
export interface ViewDef {
  name: string;
  // table-only (kanban ignores):
  columns?:  string[];
  hidden?:   string[];
  sort?:     { field: string; dir: 'asc' | 'desc' };
  groupBy?:  string;
  widths?:   Record<string, number>;
  // Unknown attributes preserved verbatim on round-trip.
  extras?:   Record<string, string>;
}
```

Extend `Board`:

```ts
export interface Board {
  id: string;
  name: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  cards: Card[];
  orphanBodies: { id: string; body: string }[];
  views: ViewDef[];        // NEW — empty array if no board:view sections
  activeView: string;      // NEW — defaults to 'kanban'
}
```

- [ ] **Step 2: Run the existing test suite to see what breaks**

Run: `npm test -- tests/board`
Expected: TypeScript fails to compile because existing fixtures don't construct `views` / `activeView`.

- [ ] **Step 3: Update existing test fixtures to include defaults**

In every existing test in `tests/board/*.test.ts` that constructs a `Board` object literally, add:
```ts
views: [],
activeView: 'kanban',
```

In `boardModel.ts`'s `parseBoardSource`, the constructed Board must also include the defaults — find the `return { ... }` at the end of `parseBoardSource` and add `views: [], activeView: 'kanban',`.

- [ ] **Step 4: Run tests to confirm green again**

Run: `npm test -- tests/board`
Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts tests/board/
git commit -m "feat(board): add ViewDef type and views/activeView fields to Board (defaults only)"
```

---

## Task 2: Parse `<!-- board:view -->` markers

**Files:**
- Modify: `src/webview/boardModel.ts`
- Modify: `tests/board/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/board/parse.test.ts`:

```ts
describe('parseBoardSource — board:view markers', () => {
  it('parses a board:view section into the views array', () => {
    const md = [
      '<!-- board:start id="b1" name="X"',
      '     columns="Todo|Doing"',
      '     field-types="Title=text,Status=status,Owner=person"',
      '     active-view="table" -->',
      '<!-- board:view name="table"',
      '     columns="Title,Status,Owner"',
      '     hidden="id"',
      '     sort="Owner,desc"',
      '     group="Status"',
      '     widths="Title=240,Status=120" -->',
      '',
      '| id | Title | Status | Owner |',
      '|----|-------|--------|-------|',
      '| c1 | A     | Todo   |       |',
      '',
      '<!-- board:end -->',
    ].join('\n');

    const b = parseBoardSource(md);
    expect(b.activeView).toBe('table');
    expect(b.views).toHaveLength(1);
    const v = b.views[0];
    expect(v.name).toBe('table');
    expect(v.columns).toEqual(['Title', 'Status', 'Owner']);
    expect(v.hidden).toEqual(['id']);
    expect(v.sort).toEqual({ field: 'Owner', dir: 'desc' });
    expect(v.groupBy).toBe('Status');
    expect(v.widths).toEqual({ Title: 240, Status: 120 });
  });

  it('returns empty views array when no board:view sections present', () => {
    const md = [
      '<!-- board:start id="b1" name="X" columns="Todo" field-types="Title=text,Status=status" -->',
      '| id | Title | Status |',
      '|----|-------|--------|',
      '| c1 | A     | Todo   |',
      '<!-- board:end -->',
    ].join('\n');
    const b = parseBoardSource(md);
    expect(b.views).toEqual([]);
    expect(b.activeView).toBe('kanban');
  });

  it('preserves unknown board:view attributes in extras', () => {
    const md = [
      '<!-- board:start id="b1" name="X" columns="Todo" field-types="Title=text,Status=status" -->',
      '<!-- board:view name="table" mystery="future-attr" -->',
      '| id | Title | Status |',
      '|----|-------|--------|',
      '| c1 | A     | Todo   |',
      '<!-- board:end -->',
    ].join('\n');
    const b = parseBoardSource(md);
    expect(b.views[0].extras).toEqual({ mystery: 'future-attr' });
  });
});
```

- [ ] **Step 2: Run the test to verify failures**

Run: `npm test -- tests/board/parse.test.ts -t "board:view markers"`
Expected: all three tests FAIL (views is empty, activeView always 'kanban').

- [ ] **Step 3: Implement the parser**

In `boardModel.ts`, find the existing region parser (likely splits the slice on `<!-- board:body ... -->`). Before the body split, add a step that scans for `<!-- board:view ... -->` markers and removes them from the slice, parsing each into a `ViewDef`.

Add this helper near the existing attribute parsing helpers:

```ts
function parseViewMarker(raw: string): ViewDef {
  // raw looks like: name="table" columns="A,B" hidden="id" sort="A,desc" group="A" widths="A=100,B=50" mystery="..."
  const knownKeys = new Set(['name', 'columns', 'hidden', 'sort', 'group', 'widths']);
  const attrs = parseAttrs(raw); // reuse existing helper; if not exported, copy its logic
  const view: ViewDef = { name: attrs.name ?? 'kanban' };
  if (attrs.columns) view.columns = attrs.columns.split(',').map(s => s.trim()).filter(Boolean);
  if (attrs.hidden)  view.hidden  = attrs.hidden.split(',').map(s => s.trim()).filter(Boolean);
  if (attrs.sort) {
    const [field, dir] = attrs.sort.split(',').map(s => s.trim());
    if (field && (dir === 'asc' || dir === 'desc')) view.sort = { field, dir };
  }
  if (attrs.group) view.groupBy = attrs.group.trim();
  if (attrs.widths) {
    const widths: Record<string, number> = {};
    for (const pair of attrs.widths.split(',')) {
      const [name, px] = pair.split('=').map(s => s.trim());
      const n = parseInt(px ?? '', 10);
      if (name && Number.isFinite(n)) widths[name] = n;
    }
    if (Object.keys(widths).length > 0) view.widths = widths;
  }
  const extras: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (!knownKeys.has(k)) extras[k] = v;
  }
  if (Object.keys(extras).length > 0) view.extras = extras;
  return view;
}
```

In the main parser, after extracting the region slice and before splitting on `board:body`, run:

```ts
const viewRegex = /<!--\s*board:view\s+([^]*?)-->/g;
const views: ViewDef[] = [];
let viewMatch: RegExpExecArray | null;
const sliceWithoutViews = slice.replace(viewRegex, (_full, attrsRaw: string) => {
  views.push(parseViewMarker(attrsRaw));
  return '';
});
// use `sliceWithoutViews` for the rest of the body/table extraction
```

Also parse `active-view` from `board:start`:

```ts
const activeView = startAttrs['active-view']?.trim() || 'kanban';
```

Return both in the final Board object:

```ts
return {
  ...,
  views,
  activeView,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/board/parse.test.ts -t "board:view markers"`
Expected: PASS for all three.

- [ ] **Step 5: Run the full board test suite to check nothing regressed**

Run: `npm test -- tests/board`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardModel.ts tests/board/parse.test.ts
git commit -m "feat(board): parse board:view marker sections and active-view attribute"
```

---

## Task 3: Serialize `board:view` markers (with no-spurious-diff invariant)

**Files:**
- Modify: `src/webview/boardModel.ts`
- Modify: `tests/board/serialize.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/board/serialize.test.ts`:

```ts
describe('serializeBoard — views', () => {
  it('emits no board:view section when views array is empty (kanban-only)', () => {
    const b: Board = {
      id: 'b1', name: 'X',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
      ],
      cards: [{ id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo' }, body: '' }],
      orphanBodies: [],
      views: [],
      activeView: 'kanban',
    };
    const out = serializeBoard(b);
    expect(out).not.toContain('board:view');
    expect(out).not.toContain('active-view');
  });

  it('emits active-view on board:start when not the default', () => {
    const b: Board = {
      id: 'b1', name: 'X',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
      ],
      cards: [],
      orphanBodies: [],
      views: [],
      activeView: 'table',
    };
    const out = serializeBoard(b);
    expect(out).toContain('active-view="table"');
  });

  it('emits a board:view section with all populated fields', () => {
    const b: Board = {
      id: 'b1', name: 'X',
      columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
      ],
      cards: [],
      orphanBodies: [],
      views: [{
        name: 'table',
        columns: ['Title', 'Status'],
        hidden: ['id'],
        sort: { field: 'Title', dir: 'asc' },
        groupBy: 'Status',
        widths: { Title: 200, Status: 100 },
      }],
      activeView: 'table',
    };
    const out = serializeBoard(b);
    expect(out).toContain('<!-- board:view name="table"');
    expect(out).toContain('columns="Title,Status"');
    expect(out).toContain('hidden="id"');
    expect(out).toContain('sort="Title,asc"');
    expect(out).toContain('group="Status"');
    expect(out).toContain('widths="Title=200,Status=100"');
  });

  it('preserves extras on round-trip', () => {
    const md = [
      '<!-- board:start id="b1" name="X" columns="Todo" field-types="Title=text,Status=status" -->',
      '<!-- board:view name="table" mystery="future" -->',
      '| id | Title | Status |',
      '|----|-------|--------|',
      '| c1 | A     | Todo   |',
      '<!-- board:end -->',
    ].join('\n');
    const b1 = parseBoardSource(md);
    const out = serializeBoard(b1);
    expect(out).toContain('mystery="future"');
    const b2 = parseBoardSource(out);
    expect(b2.views[0].extras).toEqual({ mystery: 'future' });
  });
});
```

(Top of `serialize.test.ts` needs `import { parseBoardSource } from '../../src/webview/boardModel';` for the round-trip test if not already imported.)

- [ ] **Step 2: Run to verify failures**

Run: `npm test -- tests/board/serialize.test.ts -t "views"`
Expected: FAIL on all four (no view serialization exists).

- [ ] **Step 3: Implement the serializer changes**

In `boardModel.ts`'s `serializeBoard`:

(a) When building `board:start` attrs, conditionally append `active-view="..."` when `board.activeView !== 'kanban'`.

(b) After the `board:start` line and before the table, emit one line per view in `board.views`:

```ts
function serializeView(v: ViewDef): string {
  const parts: string[] = [`name="${v.name}"`];
  if (v.columns && v.columns.length > 0) parts.push(`columns="${v.columns.join(',')}"`);
  if (v.hidden  && v.hidden.length  > 0) parts.push(`hidden="${v.hidden.join(',')}"`);
  if (v.sort)    parts.push(`sort="${v.sort.field},${v.sort.dir}"`);
  if (v.groupBy) parts.push(`group="${v.groupBy}"`);
  if (v.widths && Object.keys(v.widths).length > 0) {
    const widthStr = Object.entries(v.widths).map(([k, n]) => `${k}=${n}`).join(',');
    parts.push(`widths="${widthStr}"`);
  }
  if (v.extras) {
    for (const [k, val] of Object.entries(v.extras)) parts.push(`${k}="${val}"`);
  }
  return `<!-- board:view ${parts.join(' ')} -->`;
}
```

In `serializeBoard`, after the start marker and before the table, push `board.views.map(serializeView)` lines (one per line, blank line after the last for readability — matches the existing spacing pattern).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/board/serialize.test.ts -t "views"`
Expected: all four PASS.

- [ ] **Step 5: Run the full board suite + check round-trip**

Run: `npm test -- tests/board`
Expected: all green, including the existing `roundtrip.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardModel.ts tests/board/serialize.test.ts
git commit -m "feat(board): serialize board:view sections + active-view attribute"
```

---

## Task 4: Extract `boardOps.ts` (pure mutations)

**Files:**
- Create: `src/webview/boardOps.ts`
- Create: `tests/board/ops.test.ts`
- Modify: `src/webview/boardBlock.ts` (later, in Task 7 — for now just add the module)

- [ ] **Step 1: Write the failing tests**

Create `tests/board/ops.test.ts`:

```ts
import type { Board, ViewDef } from '../../src/webview/boardModel';
import * as ops from '../../src/webview/boardOps';

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: 'b1', name: 'X',
    columns: [
      { name: 'Todo',  color: 'blue' },
      { name: 'Doing', color: 'amber' },
    ],
    fields: [
      { name: 'Title',  type: 'text',   visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Owner',  type: 'person', visibleOnCard: true },
    ],
    cards: [
      { id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo',  Owner: 'X' }, body: '' },
      { id: 'c2', values: { id: 'c2', Title: 'B', Status: 'Doing', Owner: 'Y' }, body: '' },
    ],
    orphanBodies: [],
    views: [],
    activeView: 'kanban',
    ...overrides,
  };
}

describe('boardOps.setViewSort', () => {
  it('creates a view if missing and sets sort', () => {
    const b = makeBoard();
    ops.setViewSort(b, 'table', { field: 'Title', dir: 'asc' });
    expect(b.views).toHaveLength(1);
    expect(b.views[0]).toEqual({ name: 'table', sort: { field: 'Title', dir: 'asc' } });
  });
  it('clears sort when passed null', () => {
    const b = makeBoard({ views: [{ name: 'table', sort: { field: 'X', dir: 'asc' } }] });
    ops.setViewSort(b, 'table', null);
    expect(b.views[0].sort).toBeUndefined();
  });
});

describe('boardOps.setViewGroup', () => {
  it('creates view + sets groupBy', () => {
    const b = makeBoard();
    ops.setViewGroup(b, 'table', 'Status');
    expect(b.views[0].groupBy).toBe('Status');
  });
  it('clears groupBy when passed null', () => {
    const b = makeBoard({ views: [{ name: 'table', groupBy: 'Status' }] });
    ops.setViewGroup(b, 'table', null);
    expect(b.views[0].groupBy).toBeUndefined();
  });
});

describe('boardOps.setViewWidth', () => {
  it('sets a width on the view', () => {
    const b = makeBoard();
    ops.setViewWidth(b, 'table', 'Title', 240);
    expect(b.views[0].widths).toEqual({ Title: 240 });
  });
  it('removes a width entry when passed null', () => {
    const b = makeBoard({ views: [{ name: 'table', widths: { Title: 240, Status: 100 } }] });
    ops.setViewWidth(b, 'table', 'Title', null);
    expect(b.views[0].widths).toEqual({ Status: 100 });
  });
});

describe('boardOps.hideFieldInView', () => {
  it('adds field to view.hidden', () => {
    const b = makeBoard();
    ops.hideFieldInView(b, 'table', 'Owner');
    expect(b.views[0].hidden).toEqual(['Owner']);
  });
});

describe('boardOps.deleteField', () => {
  it('removes field from fields and from every card values map', () => {
    const b = makeBoard();
    ops.deleteField(b, 'Owner');
    expect(b.fields.find(f => f.name === 'Owner')).toBeUndefined();
    expect(b.cards[0].values.Owner).toBeUndefined();
  });
  it('clears sort + group in every view that referenced it', () => {
    const b = makeBoard({
      views: [
        { name: 'table', sort: { field: 'Owner', dir: 'asc' }, groupBy: 'Owner', widths: { Owner: 100 } },
        { name: 'kanban' },
      ],
    });
    ops.deleteField(b, 'Owner');
    expect(b.views[0].sort).toBeUndefined();
    expect(b.views[0].groupBy).toBeUndefined();
    expect(b.views[0].widths?.Owner).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npm test -- tests/board/ops.test.ts`
Expected: module not found (boardOps doesn't exist yet).

- [ ] **Step 3: Implement `boardOps.ts`**

Create `src/webview/boardOps.ts`:

```ts
import type { Board, ViewDef } from './boardModel';

function ensureView(board: Board, viewName: string): ViewDef {
  let v = board.views.find(x => x.name === viewName);
  if (!v) {
    v = { name: viewName };
    board.views.push(v);
  }
  return v;
}

/** Drop a view from the array if it now has only the `name` key and nothing else meaningful. */
function pruneView(board: Board, viewName: string): void {
  const idx = board.views.findIndex(x => x.name === viewName);
  if (idx < 0) return;
  const v = board.views[idx];
  const empty = !v.columns && !v.hidden && !v.sort && !v.groupBy && !v.widths && !v.extras;
  if (empty) board.views.splice(idx, 1);
}

export function setViewSort(
  board: Board,
  viewName: string,
  sort: { field: string; dir: 'asc' | 'desc' } | null,
): void {
  const v = ensureView(board, viewName);
  if (sort) v.sort = sort;
  else      delete v.sort;
  pruneView(board, viewName);
}

export function setViewGroup(board: Board, viewName: string, groupBy: string | null): void {
  const v = ensureView(board, viewName);
  if (groupBy) v.groupBy = groupBy;
  else         delete v.groupBy;
  pruneView(board, viewName);
}

export function setViewWidth(
  board: Board,
  viewName: string,
  field: string,
  px: number | null,
): void {
  const v = ensureView(board, viewName);
  if (!v.widths) v.widths = {};
  if (px === null) delete v.widths[field];
  else             v.widths[field] = px;
  if (v.widths && Object.keys(v.widths).length === 0) delete v.widths;
  pruneView(board, viewName);
}

export function hideFieldInView(board: Board, viewName: string, field: string): void {
  const v = ensureView(board, viewName);
  v.hidden = Array.from(new Set([...(v.hidden ?? []), field]));
  pruneView(board, viewName);
}

export function showFieldInView(board: Board, viewName: string, field: string): void {
  const v = board.views.find(x => x.name === viewName);
  if (!v?.hidden) return;
  v.hidden = v.hidden.filter(n => n !== field);
  if (v.hidden.length === 0) delete v.hidden;
  pruneView(board, viewName);
}

export function deleteField(board: Board, field: string): void {
  board.fields = board.fields.filter(f => f.name !== field);
  for (const card of board.cards) delete card.values[field];
  // Clean every view that referenced this field.
  for (const v of board.views) {
    if (v.columns) v.columns = v.columns.filter(n => n !== field);
    if (v.hidden)  v.hidden  = v.hidden.filter(n => n !== field);
    if (v.sort?.field    === field) delete v.sort;
    if (v.groupBy        === field) delete v.groupBy;
    if (v.widths?.[field] !== undefined) delete v.widths[field];
  }
  // After cleanup, prune empty views.
  board.views = board.views.filter(v =>
    v.columns || v.hidden || v.sort || v.groupBy || v.widths || v.extras
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/board/ops.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardOps.ts tests/board/ops.test.ts
git commit -m "feat(board): boardOps module with pure view-aware mutations"
```

---

## Task 5: Extract `boardDragShared.ts` (drop indicator + drag plumbing)

**Files:**
- Create: `src/webview/boardDragShared.ts`
- Create: `tests/board/drag-shared.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/board/drag-shared.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { dropIndicator } from '../../src/webview/boardDragShared';

describe('dropIndicator', () => {
  it('creates a single 2px blue line element with the expected class', () => {
    const ind = dropIndicator();
    expect(ind.tagName).toBe('DIV');
    expect(ind.classList.contains('bd-drop-line')).toBe(true);
    expect(ind.dataset.role).toBe('drop-indicator');
  });
  it('show(x,y,w,h) sets position + size + visible class', () => {
    const ind = dropIndicator();
    ind.show(10, 20, 100, 2);
    expect(ind.style.left).toBe('10px');
    expect(ind.style.top).toBe('20px');
    expect(ind.style.width).toBe('100px');
    expect(ind.style.height).toBe('2px');
    expect(ind.classList.contains('bd-drop-line-visible')).toBe(true);
  });
  it('hide() removes the visible class', () => {
    const ind = dropIndicator();
    ind.show(0, 0, 50, 2);
    ind.hide();
    expect(ind.classList.contains('bd-drop-line-visible')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/board/drag-shared.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement `boardDragShared.ts`**

Create `src/webview/boardDragShared.ts`:

```ts
/** A drop indicator element with show/hide helpers. */
export interface DropIndicator extends HTMLDivElement {
  show: (left: number, top: number, width: number, height: number) => void;
  hide: () => void;
}

export function dropIndicator(): DropIndicator {
  const el = document.createElement('div') as DropIndicator;
  el.className = 'bd-drop-line';
  el.dataset.role = 'drop-indicator';
  el.style.position = 'absolute';
  el.style.pointerEvents = 'none';
  el.style.left = '0';
  el.style.top = '0';
  el.style.width = '0';
  el.style.height = '0';
  el.show = (left, top, width, height) => {
    el.style.left   = `${left}px`;
    el.style.top    = `${top}px`;
    el.style.width  = `${width}px`;
    el.style.height = `${height}px`;
    el.classList.add('bd-drop-line-visible');
  };
  el.hide = () => {
    el.classList.remove('bd-drop-line-visible');
  };
  return el;
}

/** Threshold in CSS pixels before a mousedown promotes to a drag. */
export const DRAG_THRESHOLD_PX = 4;

/** Minimal manual drag wiring. Caller owns its own state.
 *
 * Usage:
 *   const cleanup = startDrag(e, { onMove, onDrop, onCancel });
 *   // cleanup unwires automatically on mouseup; call it manually only to cancel.
 */
export function startDrag(
  startEvent: MouseEvent,
  opts: {
    onMove:   (e: MouseEvent) => void;
    onDrop:   (e: MouseEvent) => void;
    onCancel?:() => void;
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
    cleanup();
    if (moved) opts.onDrop(e);
    else       opts.onCancel?.();
  };
  const cleanup = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup',   onUp,   true);
  };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup',   onUp,   true);
  return cleanup;
}
```

- [ ] **Step 4: Add the drop-indicator CSS**

Append to `src/webview/styles/board.css`:

```css
/* Shared drop indicator — a 2px line, always blue, never an outline on rows. */
.bd-drop-line {
  background: var(--link);
  border-radius: 1px;
  opacity: 0;
  transition: opacity 80ms ease;
  z-index: 30;
}
.bd-drop-line-visible { opacity: 1; }
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test -- tests/board/drag-shared.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardDragShared.ts tests/board/drag-shared.test.ts src/webview/styles/board.css
git commit -m "feat(board): boardDragShared with dropIndicator + startDrag helpers"
```

---

## Task 6: Define the renderer contract + extract `boardKanbanRender.ts`

This is the riskiest refactor — the existing kanban renderer is moving modules but its behavior must stay byte-identical. We do it in two commits: first the contract + an empty extracted module, then the actual extraction.

**Files:**
- Create: `src/webview/boardKanbanRender.ts`
- Modify: `src/webview/boardBlock.ts`

- [ ] **Step 1: Add the renderer contract at the top of `boardBlock.ts`**

Near the top of `boardBlock.ts`, after the existing imports:

```ts
import type { Board } from './boardModel';

export interface BoardRendererCtx {
  root:           HTMLElement;
  getBoard:       () => Board;
  mutate:         (fn: (b: Board) => void) => void;
  openSidePanel:  (cardId: string) => void;
  openProperties: () => void;
  readonly:       boolean;
}

export interface BoardRendererOps {
  update:  (next: Board) => void;
  destroy: () => void;
}
```

(If `boardBlock.ts` doesn't naturally need these exported, extract them into `src/webview/boardRenderer.ts`. For now exporting from `boardBlock.ts` is fine — keeps related types together.)

- [ ] **Step 2: Create `boardKanbanRender.ts` as a thin wrapper**

Create the file with a placeholder `mountKanban` that just delegates back to the existing in-file render function. This lets us land the module without behavior change.

```ts
import type { BoardRendererCtx, BoardRendererOps } from './boardBlock';
import { renderKanbanLegacy } from './boardBlock';

export function mountKanban(ctx: BoardRendererCtx): BoardRendererOps {
  return renderKanbanLegacy(ctx);
}
```

In `boardBlock.ts`, find the current top-level render function (whatever it's called — probably named `render` or inlined inside the Tiptap node config). **Add a named export** wrapping it as `renderKanbanLegacy(ctx)` that takes the same arguments. The actual render code stays in place.

- [ ] **Step 3: Compile, manually verify**

Run: `npm run compile`
Expected: build succeeds. No tests can verify this yet — manual sanity: load the extension, open a board, confirm it still renders.

- [ ] **Step 4: Commit (intermediate)**

```bash
git add src/webview/boardKanbanRender.ts src/webview/boardBlock.ts
git commit -m "refactor(board): introduce renderer contract; mountKanban delegates to legacy code"
```

- [ ] **Step 5: Move the legacy render body into `boardKanbanRender.ts`**

Cut the body of `renderKanbanLegacy` from `boardBlock.ts` and paste it into `boardKanbanRender.ts`'s `mountKanban`. Adjust imports accordingly. Remove `renderKanbanLegacy` from `boardBlock.ts`.

The `mountKanban` body must:
- Use `ctx.getBoard()` everywhere it currently reads `board` directly.
- Use `ctx.mutate(fn)` everywhere it currently writes.
- Use `ctx.openSidePanel(id)` when opening a card.
- Use `ctx.openProperties()` when opening properties.
- Return `{ update, destroy }`. `update` re-renders given a new board; `destroy` removes event listeners and detaches the DOM from `ctx.root`.

- [ ] **Step 6: Compile + manually verify behavior**

Run: `npm run compile`
Expected: build succeeds. Manually: load the extension, open a board, verify kanban renders identically (drag-drop, add card, column rename, side panel open, properties popover).

- [ ] **Step 7: Commit**

```bash
git add src/webview/boardKanbanRender.ts src/webview/boardBlock.ts
git commit -m "refactor(board): move kanban renderer body into boardKanbanRender.ts"
```

---

## Task 7: Slim `boardBlock.ts` to a controller; pick renderer by `activeView`

**Files:**
- Modify: `src/webview/boardBlock.ts`

- [ ] **Step 1: Add the controller logic**

In `boardBlock.ts`, after parsing the board and before rendering, add:

```ts
import { mountKanban } from './boardKanbanRender';
// import { mountTable } from './boardTableRender';  // added in Task 9

let renderer: BoardRendererOps | null = null;
let currentBoard = parseBoardSource(source);

const ctx: BoardRendererCtx = {
  root: previewRoot,                                  // the existing render container
  getBoard: () => currentBoard,
  mutate: (fn) => {
    fn(currentBoard);
    debouncedSerialize();                              // existing path
    renderer?.update(currentBoard);
  },
  openSidePanel: (id) => openSidePanel(id),
  openProperties: () => openProperties(),
  readonly: isReadonly(),
};

function mountForActiveView(): void {
  renderer?.destroy();
  if (currentBoard.activeView === 'table') {
    // Will be wired in Task 9.
    renderer = mountKanban(ctx);  // placeholder; falls back to kanban for now
  } else {
    renderer = mountKanban(ctx);
  }
}

mountForActiveView();
```

(Replace whatever existing direct-mount-kanban call lives at the bottom of `boardBlock.ts` with `mountForActiveView()`.)

- [ ] **Step 2: Compile + manually verify**

Run: `npm run compile`
Expected: build succeeds. Manual: open a board, verify kanban still works.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardBlock.ts
git commit -m "refactor(board): boardBlock controller picks renderer by activeView (still kanban-only)"
```

---

## Task 8: Replace Properties button with `⋯` menu; add view segmented control

**Files:**
- Modify: `src/webview/boardBlock.ts` (or wherever the board header chrome is built)
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Add the ⋯ menu DOM**

Find where the Properties button is currently created in the chrome. Replace it with:

```ts
function buildHeaderMore(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'bd-more';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bd-more-btn';
  btn.setAttribute('aria-label', 'More');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>`;
  const menu = document.createElement('div');
  menu.className = 'bd-more-menu bd-hidden';
  menu.setAttribute('role', 'menu');

  // View segmented control (top of menu)
  const viewRow = document.createElement('div');
  viewRow.className = 'bd-more-view';
  const seg = document.createElement('div');
  seg.className = 'bd-view-seg';
  const mkSeg = (name: 'kanban' | 'table', label: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bd-view-seg-btn';
    b.dataset.view = name;
    b.textContent = label;
    return b;
  };
  const kanbanBtn = mkSeg('kanban', 'Kanban');
  const tableBtn  = mkSeg('table',  'Table');
  seg.append(kanbanBtn, tableBtn);
  viewRow.appendChild(seg);
  menu.appendChild(viewRow);

  // Separator
  const sep = document.createElement('div');
  sep.className = 'bd-more-sep';
  menu.appendChild(sep);

  // Properties placeholder — mount existing buildPropertiesPopover content here
  const propsHost = document.createElement('div');
  propsHost.className = 'bd-more-props';
  menu.appendChild(propsHost);

  wrap.append(btn, menu);
  return wrap;
}
```

Wire the click:
- `btn.click` → toggles `menu.bd-hidden`. Sets `aria-expanded`.
- Outside click closes (document mousedown listener; remove on close).
- `kanbanBtn.click` → `ctx.mutate(b => { b.activeView = 'kanban'; })`, close menu, call `mountForActiveView()`.
- `tableBtn.click` → same for `'table'`.

Reflect active state:

```ts
function refreshViewSeg() {
  const cur = currentBoard.activeView;
  kanbanBtn.classList.toggle('bd-view-seg-active', cur === 'kanban');
  tableBtn .classList.toggle('bd-view-seg-active', cur === 'table');
}
```

Call `refreshViewSeg()` on menu open and after `ctx.mutate`.

- [ ] **Step 2: Move the existing Properties popover content into `propsHost`**

Find the existing `buildPropertiesPopover` (or equivalent) invocation. Instead of attaching its element next to the Properties button, attach it inside `propsHost`. Hide the now-removed standalone Properties button.

- [ ] **Step 3: Add CSS**

Append to `src/webview/styles/board.css`:

```css
.bd-more { position: relative; display: inline-flex; }
.bd-more-btn {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--bg);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 7px;
  cursor: pointer;
}
.bd-more-btn:hover { background: var(--block-hover); color: var(--text-primary); }
.bd-more-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 240px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
  padding: 8px;
  z-index: 6;
}
.bd-more-menu.bd-hidden { display: none; }
.bd-more-sep { height: 1px; background: var(--border); margin: 8px 0; }
.bd-more-view { padding: 4px 6px 8px 6px; }
.bd-view-seg {
  display: inline-flex; gap: 1px; padding: 3px;
  background: var(--seg-bg);
  border-radius: 7px;
  width: 100%;
}
.bd-view-seg-btn {
  flex: 1;
  padding: 5px 12px;
  background: transparent;
  border: none;
  border-radius: 5px;
  font: 500 12px ui-sans-serif, sans-serif;
  color: var(--text-secondary);
  cursor: pointer;
}
.bd-view-seg-btn.bd-view-seg-active {
  background: var(--seg-active-bg);
  color: var(--text-primary);
  box-shadow: var(--seg-active-shadow);
  font-weight: 600;
}
.bd-hidden { display: none !important; }
```

- [ ] **Step 4: Manual verification**

Run: `npm run compile`. Open the extension, open a board. The ⋯ menu opens, shows Kanban / Table segmented control + Properties below, switches view (still falls back to kanban for both — table renderer is Task 9).

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardBlock.ts src/webview/styles/board.css
git commit -m "feat(board): replace Properties button with ⋯ menu containing view switch + props"
```

---

## Task 9: `boardTableRender.ts` skeleton (mount, destroy, empty table)

**Files:**
- Create: `src/webview/boardTableRender.ts`
- Create: `tests/board/table.test.ts`
- Modify: `src/webview/boardBlock.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Write the failing test**

Create `tests/board/table.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { mountTable } from '../../src/webview/boardTableRender';
import type { Board } from '../../src/webview/boardModel';

function makeBoard(): Board {
  return {
    id: 'b1', name: 'X',
    columns: [{ name: 'Todo', color: 'blue' }, { name: 'Doing', color: 'amber' }],
    fields: [
      { name: 'Title',  type: 'text',   visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Owner',  type: 'person', visibleOnCard: true },
    ],
    cards: [],
    orphanBodies: [],
    views: [],
    activeView: 'table',
  };
}

describe('mountTable', () => {
  it('renders a table with one header per visible field', () => {
    const root = document.createElement('div');
    let b = makeBoard();
    const ops = mountTable({
      root, getBoard: () => b, mutate: () => {},
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    const ths = root.querySelectorAll('thead th');
    // gutter + 3 fields = 4 cells
    expect(ths).toHaveLength(4);
    expect(ths[1].textContent).toContain('Title');
    expect(ths[2].textContent).toContain('Status');
    expect(ths[3].textContent).toContain('Owner');
    ops.destroy();
    expect(root.children).toHaveLength(0);
  });

  it('shows empty state when board has no cards', () => {
    const root = document.createElement('div');
    let b = makeBoard();
    mountTable({
      root, getBoard: () => b, mutate: () => {},
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    expect(root.textContent).toContain('No cards');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/board/table.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement skeleton**

Create `src/webview/boardTableRender.ts`:

```ts
import type { Board, ViewDef, FieldDef } from './boardModel';
import type { BoardRendererCtx, BoardRendererOps } from './boardBlock';

export function mountTable(ctx: BoardRendererCtx): BoardRendererOps {
  const root = ctx.root;
  root.classList.add('bd-table-host');
  let detached = false;

  function render() {
    if (detached) return;
    const b = ctx.getBoard();
    const v = b.views.find(x => x.name === 'table') ?? { name: 'table' };
    root.innerHTML = '';

    const visibleFields = computeVisibleFields(b, v);
    const widths = v.widths ?? {};

    if (b.cards.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bd-table-empty';
      empty.textContent = 'No cards. Click + Add card to get started.';
      root.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'bd-table';

    // colgroup with widths
    const colgroup = document.createElement('colgroup');
    const gutterCol = document.createElement('col');
    gutterCol.style.width = '36px';
    colgroup.appendChild(gutterCol);
    for (const f of visibleFields) {
      const col = document.createElement('col');
      col.style.width = `${widths[f.name] ?? 160}px`;
      colgroup.appendChild(col);
    }
    table.appendChild(colgroup);

    // thead
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th'));  // gutter
    for (const f of visibleFields) {
      const th = document.createElement('th');
      th.textContent = f.name;
      th.dataset.field = f.name;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    // tbody — empty rows in this task (real cells in Task 10/11)
    const tbody = document.createElement('tbody');
    for (const card of b.cards) {
      const tr = document.createElement('tr');
      tr.className = 'bd-table-row';
      tr.dataset.cardId = card.id;
      const gutter = document.createElement('td');
      gutter.className = 'bd-table-gutter';
      tr.appendChild(gutter);
      for (const f of visibleFields) {
        const td = document.createElement('td');
        td.className = 'bd-table-cell';
        td.dataset.field = f.name;
        td.textContent = card.values[f.name] ?? '';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    root.appendChild(table);
  }

  function computeVisibleFields(b: Board, v: ViewDef): FieldDef[] {
    const hidden = new Set(v.hidden ?? []);
    const order  = v.columns ?? b.fields.map(f => f.name);
    const out: FieldDef[] = [];
    for (const name of order) {
      const f = b.fields.find(x => x.name === name);
      if (f && !hidden.has(name)) out.push(f);
    }
    return out;
  }

  render();

  return {
    update: (_next) => render(),
    destroy: () => {
      detached = true;
      root.innerHTML = '';
      root.classList.remove('bd-table-host');
    },
  };
}
```

- [ ] **Step 4: Wire it up in `boardBlock.ts`**

In `mountForActiveView`, replace the table-branch placeholder:

```ts
import { mountTable } from './boardTableRender';
// ...
function mountForActiveView(): void {
  renderer?.destroy();
  renderer = currentBoard.activeView === 'table'
    ? mountTable(ctx)
    : mountKanban(ctx);
}
```

- [ ] **Step 5: Add base table CSS**

Append to `src/webview/styles/board.css`:

```css
.bd-table-host { padding: 8px 10px 12px 10px; overflow-x: auto; }
.bd-table { border-collapse: collapse; table-layout: fixed; font: 13px ui-sans-serif, sans-serif; }
.bd-table thead th {
  text-align: left;
  padding: 8px 10px;
  font: 600 10.5px ui-sans-serif, sans-serif;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--border);
  position: relative;
}
.bd-table tbody td { padding: 8px 10px; border-bottom: 1px solid var(--border-soft, #f0f0f0); vertical-align: middle; }
.bd-table-row:hover { background: var(--block-hover); }
.bd-table-gutter { width: 36px; }
.bd-table-empty { padding: 60px 0; text-align: center; color: var(--text-secondary); font-size: 13px; }
```

- [ ] **Step 6: Run tests + compile**

Run: `npm test -- tests/board/table.test.ts && npm run compile`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/webview/boardTableRender.ts src/webview/boardBlock.ts src/webview/styles/board.css tests/board/table.test.ts
git commit -m "feat(board): table renderer skeleton (headers + rows + empty state)"
```

---

## Task 10: Inline cell editors — `text` and `person`

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `tests/board/table.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/board/table.test.ts`:

```ts
describe('mountTable — text cell editing', () => {
  it('click on a text cell makes it contenteditable; Enter commits via mutate', () => {
    const root = document.createElement('div');
    const b: Board = {
      ...makeBoard(),
      cards: [{ id: 'c1', values: { id: 'c1', Title: 'Hello', Status: 'Todo', Owner: '' }, body: '' }],
    };
    const mutations: Array<(b: Board) => void> = [];
    mountTable({
      root,
      getBoard: () => b,
      mutate: (fn) => { mutations.push(fn); fn(b); },
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });

    const titleCell = root.querySelector<HTMLElement>('.bd-table-cell[data-field="Title"]')!;
    titleCell.click();
    expect(titleCell.getAttribute('contenteditable')).toBe('true');
    titleCell.textContent = 'World';
    titleCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(mutations.length).toBeGreaterThan(0);
    expect(b.cards[0].values.Title).toBe('World');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/board/table.test.ts -t "text cell editing"`
Expected: FAIL (cell has no editor wired).

- [ ] **Step 3: Implement the text/person editor**

In `boardTableRender.ts`, factor the cell rendering into a helper:

```ts
function renderCell(td: HTMLTdElement, card: Card, field: FieldDef, b: Board, ctx: BoardRendererCtx): void {
  td.dataset.field = field.name;
  td.className = `bd-table-cell bd-cell-${field.type}`;
  const value = card.values[field.name] ?? '';
  switch (field.type) {
    case 'text':
    case 'person':
      td.textContent = value;
      if (!ctx.readonly) {
        td.addEventListener('click', () => beginInlineText(td, card, field, ctx));
      }
      return;
    // other types added in later tasks; for now they render plain text:
    default:
      td.textContent = value;
  }
}

function beginInlineText(
  td: HTMLTdElement, card: Card, field: FieldDef, ctx: BoardRendererCtx,
): void {
  if (td.getAttribute('contenteditable') === 'true') return;
  td.setAttribute('contenteditable', 'true');
  td.classList.add('bd-cell-editing');
  td.focus();
  // Place caret at end.
  const range = document.createRange();
  range.selectNodeContents(td);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  const commit = () => {
    const next = (td.textContent ?? '').trim();
    td.removeAttribute('contenteditable');
    td.classList.remove('bd-cell-editing');
    cleanup();
    if (next !== (card.values[field.name] ?? '')) {
      ctx.mutate(b => {
        const c = b.cards.find(x => x.id === card.id);
        if (c) c.values[field.name] = next;
      });
    }
  };
  const cancel = () => {
    td.textContent = card.values[field.name] ?? '';
    td.removeAttribute('contenteditable');
    td.classList.remove('bd-cell-editing');
    cleanup();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Tab') { e.preventDefault(); commit(); /* TODO: jump to next cell (later) */ }
  };
  const onBlur = () => commit();
  function cleanup() {
    td.removeEventListener('keydown', onKey);
    td.removeEventListener('blur',    onBlur);
  }
  td.addEventListener('keydown', onKey);
  td.addEventListener('blur',    onBlur);
}
```

Replace the body-row inner loop in `render()`:

```ts
for (const f of visibleFields) {
  const td = document.createElement('td') as HTMLTdElement;
  renderCell(td, card, f, b, ctx);
  tr.appendChild(td);
}
```

- [ ] **Step 4: Add CSS**

```css
.bd-cell-editing { background: var(--bg); outline: 2px solid var(--link); outline-offset: -2px; }
.bd-table-cell { cursor: text; }
.bd-cell-status, .bd-cell-date, .bd-cell-tags { cursor: pointer; }
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/board/table.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardTableRender.ts tests/board/table.test.ts src/webview/styles/board.css
git commit -m "feat(board): inline text/person cell editing in table view"
```

---

## Task 11: Inline cell editor — `status` (chip dropdown)

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `tests/board/table.test.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Write the failing test**

Add to `tests/board/table.test.ts`:

```ts
describe('mountTable — status cell', () => {
  it('renders a chip with the column color', () => {
    const root = document.createElement('div');
    const b: Board = {
      ...makeBoard(),
      cards: [{ id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Doing', Owner: '' }, body: '' }],
    };
    mountTable({
      root, getBoard: () => b, mutate: (fn) => fn(b),
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    const cell = root.querySelector('.bd-cell-status .bd-chip')!;
    expect(cell.textContent).toContain('Doing');
    expect(cell.classList.contains('bd-chip-amber')).toBe(true);
  });

  it('click opens a dropdown with every column option, click an option mutates', () => {
    const root = document.createElement('div');
    const b: Board = {
      ...makeBoard(),
      cards: [{ id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo', Owner: '' }, body: '' }],
    };
    mountTable({
      root, getBoard: () => b, mutate: (fn) => fn(b),
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    const cell = root.querySelector<HTMLElement>('.bd-cell-status')!;
    cell.click();
    const items = root.querySelectorAll('.bd-status-pop .bd-status-item');
    expect(items).toHaveLength(2);   // Todo, Doing
    (items[1] as HTMLElement).click();
    expect(b.cards[0].values.Status).toBe('Doing');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/board/table.test.ts -t "status cell"`
Expected: FAIL.

- [ ] **Step 3: Implement the status renderer + dropdown**

In `renderCell`'s switch, add a `status` branch:

```ts
case 'status': {
  const colDef = b.columns.find(c => c.name === value);
  const chip = document.createElement('span');
  chip.className = `bd-chip bd-chip-${colDef?.color ?? 'gray'}`;
  chip.textContent = value || '—';
  td.appendChild(chip);
  if (!ctx.readonly) {
    td.addEventListener('click', (e) => {
      e.stopPropagation();
      openStatusDropdown(td, card, b, ctx);
    });
  }
  return;
}
```

Add the dropdown helper:

```ts
function openStatusDropdown(
  anchor: HTMLElement, card: Card, b: Board, ctx: BoardRendererCtx,
): void {
  const existing = document.querySelector('.bd-status-pop');
  existing?.remove();
  const pop = document.createElement('div');
  pop.className = 'bd-status-pop';
  for (const col of b.columns) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `bd-status-item bd-chip bd-chip-${col.color}`;
    item.textContent = col.name;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.mutate(bb => {
        const c = bb.cards.find(x => x.id === card.id);
        if (c) c.values.Status = col.name;
      });
      pop.remove();
    });
    pop.appendChild(item);
  }
  // Position below anchor
  const r = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = `${r.left}px`;
  pop.style.top  = `${r.bottom + 4}px`;
  document.body.appendChild(pop);
  const closeOnOutside = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) {
      pop.remove();
      document.removeEventListener('mousedown', closeOnOutside, true);
    }
  };
  document.addEventListener('mousedown', closeOnOutside, true);
}
```

- [ ] **Step 4: Add chip + dropdown CSS**

```css
.bd-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 9px; border-radius: 11px;
  font: 500 11.5px ui-sans-serif, sans-serif;
}
.bd-chip-blue    { background: #dbeafe; color: #1e40af; }
.bd-chip-amber   { background: #fef3c7; color: #92400e; }
.bd-chip-emerald { background: #d1fae5; color: #065f46; }
.bd-chip-red     { background: #fee2e2; color: #b91c1c; }
.bd-chip-purple  { background: #ede9fe; color: #5b21b6; }
.bd-chip-gray    { background: #f3f4f6; color: #525252; }

.bd-status-pop {
  display: flex; flex-direction: column; gap: 2px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  padding: 6px; box-shadow: 0 12px 28px rgba(0,0,0,0.12);
  z-index: 7; min-width: 140px;
}
.bd-status-item { text-align: left; border: none; cursor: pointer; }
```

- [ ] **Step 5: Run tests + commit**

Run: `npm test -- tests/board/table.test.ts`
Expected: PASS.

```bash
git add src/webview/boardTableRender.ts tests/board/table.test.ts src/webview/styles/board.css
git commit -m "feat(board): inline status chip + dropdown in table view"
```

---

## Task 12: Inline cell editors — `date` and `tags`

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `tests/board/table.test.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Write the failing tests**

```ts
describe('mountTable — date cell', () => {
  it('renders Jun 1 pill', () => {
    const root = document.createElement('div');
    const b: Board = {
      ...makeBoard(),
      fields: [
        ...makeBoard().fields,
        { name: 'Due', type: 'date', visibleOnCard: true },
      ],
      cards: [{ id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo', Owner: '', Due: '2026-06-01' }, body: '' }],
    };
    mountTable({
      root, getBoard: () => b, mutate: (fn) => fn(b),
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    const cell = root.querySelector('.bd-cell-date .bd-date')!;
    expect(cell.textContent).toContain('Jun 1');
  });
  it('past date renders overdue', () => {
    const root = document.createElement('div');
    const b: Board = {
      ...makeBoard(),
      fields: [
        ...makeBoard().fields,
        { name: 'Due', type: 'date', visibleOnCard: true },
      ],
      cards: [{ id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo', Owner: '', Due: '2020-01-01' }, body: '' }],
    };
    mountTable({
      root, getBoard: () => b, mutate: () => {},
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    const cell = root.querySelector('.bd-cell-date .bd-date')!;
    expect(cell.classList.contains('bd-date-overdue')).toBe(true);
    expect(cell.textContent).toContain('overdue');
  });
});

describe('mountTable — tags cell', () => {
  it('renders one chip per tag', () => {
    const root = document.createElement('div');
    const b: Board = {
      ...makeBoard(),
      fields: [
        ...makeBoard().fields,
        { name: 'Tags', type: 'tags', visibleOnCard: true },
      ],
      cards: [{ id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo', Owner: '', Tags: 'feature, editor' }, body: '' }],
    };
    mountTable({
      root, getBoard: () => b, mutate: () => {},
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    const chips = root.querySelectorAll('.bd-cell-tags .bd-tag');
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toBe('feature');
    expect(chips[1].textContent).toBe('editor');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/board/table.test.ts -t "date cell|tags cell"`
Expected: FAIL.

- [ ] **Step 3: Implement date + tags renderers**

In `renderCell` switch, add:

```ts
case 'date': {
  const dateStr = value;
  if (!dateStr) {
    td.textContent = '—';
    td.classList.add('bd-cell-empty');
  } else {
    const pill = document.createElement('span');
    pill.className = 'bd-date';
    const d = new Date(dateStr + 'T00:00:00');
    pill.textContent = isNaN(d.getTime()) ? dateStr : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (!isNaN(d.getTime()) && d.getTime() < startOfToday()) {
      pill.classList.add('bd-date-overdue');
      pill.textContent += ' · overdue';
    }
    td.appendChild(pill);
  }
  if (!ctx.readonly) {
    td.addEventListener('click', (e) => { e.stopPropagation(); openDatePicker(td, card, field, ctx); });
  }
  return;
}
case 'tags': {
  const tags = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (tags.length === 0) {
    td.textContent = '—';
    td.classList.add('bd-cell-empty');
  } else {
    for (const t of tags) {
      const chip = document.createElement('span');
      chip.className = 'bd-tag';
      chip.textContent = t;
      td.appendChild(chip);
    }
  }
  if (!ctx.readonly) {
    td.addEventListener('click', (e) => { e.stopPropagation(); openTagsEditor(td, card, field, ctx); });
  }
  return;
}
```

Helpers:

```ts
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function openDatePicker(anchor: HTMLElement, card: Card, field: FieldDef, ctx: BoardRendererCtx): void {
  const input = document.createElement('input');
  input.type = 'date';
  input.value = card.values[field.name] ?? '';
  input.className = 'bd-date-input';
  const r = anchor.getBoundingClientRect();
  input.style.position = 'fixed';
  input.style.left = `${r.left}px`;
  input.style.top  = `${r.top}px`;
  document.body.appendChild(input);
  input.focus();
  const commit = () => {
    const v = input.value;
    input.remove();
    document.removeEventListener('mousedown', onOutside, true);
    if (v !== (card.values[field.name] ?? '')) {
      ctx.mutate(b => {
        const c = b.cards.find(x => x.id === card.id);
        if (c) c.values[field.name] = v;
      });
    }
  };
  const onOutside = (e: MouseEvent) => { if (e.target !== input) commit(); };
  input.addEventListener('change', commit);
  document.addEventListener('mousedown', onOutside, true);
}

function openTagsEditor(anchor: HTMLElement, card: Card, field: FieldDef, ctx: BoardRendererCtx): void {
  // Minimal v1: an inline contenteditable that takes "tag, tag, tag" comma-separated text.
  const td = anchor;
  td.innerHTML = '';
  td.textContent = (card.values[field.name] ?? '');
  td.setAttribute('contenteditable', 'true');
  td.focus();
  const commit = () => {
    td.removeAttribute('contenteditable');
    const next = (td.textContent ?? '')
      .split(',').map(s => s.trim()).filter(Boolean).join(', ');
    if (next !== (card.values[field.name] ?? '')) {
      ctx.mutate(b => {
        const c = b.cards.find(x => x.id === card.id);
        if (c) c.values[field.name] = next;
      });
    }
    cleanup();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); td.removeAttribute('contenteditable'); cleanup(); }
  };
  const onBlur = () => commit();
  function cleanup() {
    td.removeEventListener('keydown', onKey);
    td.removeEventListener('blur',    onBlur);
  }
  td.addEventListener('keydown', onKey);
  td.addEventListener('blur',    onBlur);
}
```

- [ ] **Step 4: Add CSS**

```css
.bd-date { display: inline-block; padding: 2px 8px; border-radius: 5px; background: var(--bg-secondary); color: var(--text-secondary); font: 500 11.5px ui-sans-serif, sans-serif; }
.bd-date-overdue { background: #fee2e2; color: #b91c1c; }
.bd-tag { display: inline-block; padding: 1px 7px; background: var(--bg-secondary); color: var(--text-secondary); border-radius: 4px; font-size: 11px; margin-right: 4px; }
.bd-cell-empty { color: #c0c0c0; }
.bd-date-input { font: 13px ui-sans-serif, sans-serif; padding: 4px 6px; border: 1px solid var(--link); border-radius: 5px; background: var(--bg); }
```

- [ ] **Step 5: Run + commit**

```bash
npm test -- tests/board/table.test.ts
git add src/webview/boardTableRender.ts tests/board/table.test.ts src/webview/styles/board.css
git commit -m "feat(board): inline date + tags cells in table view"
```

---

## Task 13: Sort (header click cycles unsorted → asc → desc, render-time sort)

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `tests/board/table.test.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Write the failing tests**

```ts
describe('mountTable — sort', () => {
  it('clicking a header cycles sort and persists via mutate', () => {
    const root = document.createElement('div');
    const b: Board = makeBoard();
    const mutations: number[] = [];
    mountTable({
      root, getBoard: () => b,
      mutate: (fn) => { mutations.push(1); fn(b); },
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    const titleHeader = root.querySelector<HTMLElement>('thead th[data-field="Title"]')!;

    titleHeader.click(); // unsorted → asc
    expect(b.views.find(v => v.name === 'table')?.sort).toEqual({ field: 'Title', dir: 'asc' });

    titleHeader.click(); // asc → desc
    expect(b.views.find(v => v.name === 'table')?.sort).toEqual({ field: 'Title', dir: 'desc' });

    titleHeader.click(); // desc → unsorted
    expect(b.views.find(v => v.name === 'table')?.sort).toBeUndefined();
  });

  it('renders rows in sorted order for asc + desc on a text field', () => {
    const root = document.createElement('div');
    const b: Board = {
      ...makeBoard(),
      cards: [
        { id: 'c1', values: { id: 'c1', Title: 'banana', Status: 'Todo', Owner: '' }, body: '' },
        { id: 'c2', values: { id: 'c2', Title: 'apple',  Status: 'Todo', Owner: '' }, body: '' },
        { id: 'c3', values: { id: 'c3', Title: 'cherry', Status: 'Todo', Owner: '' }, body: '' },
      ],
      views: [{ name: 'table', sort: { field: 'Title', dir: 'asc' } }],
    };
    mountTable({
      root, getBoard: () => b, mutate: (fn) => fn(b),
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    const rows = Array.from(root.querySelectorAll<HTMLElement>('tbody tr.bd-table-row'));
    expect(rows.map(r => r.dataset.cardId)).toEqual(['c2', 'c1', 'c3']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/board/table.test.ts -t "sort"`
Expected: FAIL.

- [ ] **Step 3: Add sort cycle + render-time sort**

In `render()`, sort the cards before iterating:

```ts
const sortedCards = applySort(b.cards, v, b);
for (const card of sortedCards) { ... }
```

Add the helpers:

```ts
function applySort(cards: Card[], v: ViewDef, b: Board): Card[] {
  if (!v.sort) return cards;
  const { field, dir } = v.sort;
  const f = b.fields.find(x => x.name === field);
  if (!f) return cards;
  const cmp = comparatorFor(f, b);
  const sorted = [...cards].sort((a, c) => cmp(a.values[field] ?? '', c.values[field] ?? ''));
  if (dir === 'desc') sorted.reverse();
  return sorted;
}

function comparatorFor(f: FieldDef, b: Board): (a: string, c: string) => number {
  if (f.type === 'date') {
    return (a, c) => {
      if (!a && !c) return 0;
      if (!a) return 1;        // empty last
      if (!c) return -1;
      return new Date(a).getTime() - new Date(c).getTime();
    };
  }
  if (f.type === 'status') {
    const order = new Map(b.columns.map((col, i) => [col.name, i]));
    return (a, c) => (order.get(a) ?? 1e9) - (order.get(c) ?? 1e9);
  }
  if (f.type === 'tags') {
    return (a, c) => {
      const aa = (a.split(',')[0] ?? '').trim().toLowerCase();
      const cc = (c.split(',')[0] ?? '').trim().toLowerCase();
      if (!aa && !cc) return 0;
      if (!aa) return 1;
      if (!cc) return -1;
      return aa.localeCompare(cc);
    };
  }
  // text, person
  return (a, c) => a.localeCompare(c, undefined, { sensitivity: 'base' });
}
```

In the header rendering, add the click cycle + caret:

```ts
th.addEventListener('click', (e) => {
  if (ctx.readonly) return;
  if ((e.target as HTMLElement).classList.contains('bd-col-resizer')) return;
  ctx.mutate(bb => {
    const view = bb.views.find(x => x.name === 'table');
    const cur = view?.sort;
    const nextDir: 'asc' | 'desc' | null =
      !cur || cur.field !== f.name ? 'asc' :
      cur.dir === 'asc'            ? 'desc' :
                                     null;
    if (nextDir === null) {
      if (view) delete view.sort;
    } else {
      // Use the boardOps helper from Task 4:
      // ops.setViewSort(bb, 'table', { field: f.name, dir: nextDir });
      // Inlined here to avoid the import dependency in the renderer:
      const v2 = bb.views.find(x => x.name === 'table') ?? (() => { const nv: ViewDef = { name: 'table' }; bb.views.push(nv); return nv; })();
      v2.sort = { field: f.name, dir: nextDir };
    }
  });
});

// Inside the header build, add the caret:
if (v.sort?.field === f.name) {
  const caret = document.createElement('span');
  caret.className = 'bd-sort-caret';
  caret.textContent = v.sort.dir === 'asc' ? ' ▲' : ' ▼';
  th.appendChild(caret);
}
```

Better — import `boardOps` and use `setViewSort` properly:

```ts
import { setViewSort } from './boardOps';
// ...
ctx.mutate(bb => setViewSort(bb, 'table', nextDir ? { field: f.name, dir: nextDir } : null));
```

- [ ] **Step 4: Add caret CSS**

```css
.bd-sort-caret { color: var(--link); font-size: 9px; margin-left: 4px; }
```

- [ ] **Step 5: Run tests + commit**

```bash
npm test -- tests/board/table.test.ts
git add src/webview/boardTableRender.ts tests/board/table.test.ts src/webview/styles/board.css
git commit -m "feat(board): table sort (cycle on header click, render-time sort, persist to view)"
```

---

## Task 14: Group-by (header click menu, group headers, render-time grouping)

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `tests/board/table.test.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Write the failing test**

```ts
describe('mountTable — group', () => {
  it('renders group headers in board.columns order when grouped by Status', () => {
    const root = document.createElement('div');
    const b: Board = {
      ...makeBoard(),
      cards: [
        { id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Doing', Owner: '' }, body: '' },
        { id: 'c2', values: { id: 'c2', Title: 'B', Status: 'Todo',  Owner: '' }, body: '' },
        { id: 'c3', values: { id: 'c3', Title: 'C', Status: 'Doing', Owner: '' }, body: '' },
      ],
      views: [{ name: 'table', groupBy: 'Status' }],
    };
    mountTable({
      root, getBoard: () => b, mutate: (fn) => fn(b),
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    const groupHeaders = Array.from(root.querySelectorAll<HTMLElement>('tbody tr.bd-table-group .bd-group-name'));
    expect(groupHeaders.map(h => h.textContent)).toEqual(['Todo', 'Doing']);
  });

  it('cards with invalid status go into Uncategorized group', () => {
    const root = document.createElement('div');
    const b: Board = {
      ...makeBoard(),
      cards: [
        { id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Bogus', Owner: '' }, body: '' },
      ],
      views: [{ name: 'table', groupBy: 'Status' }],
    };
    mountTable({
      root, getBoard: () => b, mutate: (fn) => fn(b),
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    const groupHeaders = Array.from(root.querySelectorAll<HTMLElement>('tbody tr.bd-table-group .bd-group-name'));
    expect(groupHeaders.map(h => h.textContent)).toEqual(['Todo', 'Doing', 'Uncategorized']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/board/table.test.ts -t "group"`
Expected: FAIL.

- [ ] **Step 3: Implement grouping**

In `render()`, after `applySort`, group if needed:

```ts
const sortedCards = applySort(b.cards, v, b);
const groups = applyGroup(sortedCards, v, b);
// groups: Array<{ key: string; cards: Card[] }>
```

Helpers:

```ts
interface Group { key: string; cards: Card[]; }

function applyGroup(cards: Card[], v: ViewDef, b: Board): Group[] {
  if (!v.groupBy) return [{ key: '', cards }];
  const field = v.groupBy;
  const fdef = b.fields.find(x => x.name === field);
  if (!fdef) return [{ key: '', cards }];

  // Bucket
  const bucket = new Map<string, Card[]>();
  for (const c of cards) {
    let key = c.values[field] ?? '';
    if (field === 'Status' && !b.columns.some(col => col.name === key)) key = 'Uncategorized';
    if (fdef.type === 'tags') key = (key.split(',')[0] ?? '').trim();
    key = key || '—';
    const arr = bucket.get(key) ?? [];
    arr.push(c);
    bucket.set(key, arr);
  }

  let keys = Array.from(bucket.keys());
  if (field === 'Status') {
    // Order by board.columns, then Uncategorized last.
    const colOrder = b.columns.map(col => col.name);
    keys = keys.sort((a, c) => {
      if (a === 'Uncategorized') return 1;
      if (c === 'Uncategorized') return -1;
      return colOrder.indexOf(a) - colOrder.indexOf(c);
    });
    // For empty columns: include them as empty groups so they appear.
    for (const col of b.columns) {
      if (!bucket.has(col.name)) { bucket.set(col.name, []); keys.splice(colOrder.indexOf(col.name), 0, col.name); }
    }
  } else {
    keys.sort((a, c) => {
      if (a === '—') return 1;
      if (c === '—') return -1;
      return a.localeCompare(c, undefined, { sensitivity: 'base' });
    });
  }

  return keys.map(k => ({ key: k, cards: bucket.get(k) ?? [] }));
}
```

In the body render, iterate groups:

```ts
const collapsed = new Set<string>();  // in-memory only
for (const g of groups) {
  if (v.groupBy) {
    const head = document.createElement('tr');
    head.className = 'bd-table-group';
    const td = document.createElement('td');
    td.colSpan = visibleFields.length + 1;
    td.innerHTML = `
      <div class="bd-group-row">
        <span class="bd-group-left">
          <span class="bd-group-caret">${collapsed.has(g.key) ? '▸' : '▾'}</span>
          <span class="bd-group-name">${g.key}</span>
          <span class="bd-group-count">${g.cards.length}</span>
        </span>
        <button type="button" class="bd-group-add">+ Add card</button>
      </div>
    `;
    head.appendChild(td);
    head.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.bd-group-add')) return;
      if (collapsed.has(g.key)) collapsed.delete(g.key);
      else                       collapsed.add(g.key);
      render();
    });
    tbody.appendChild(head);
  }
  if (collapsed.has(g.key)) continue;
  for (const card of g.cards) {
    // existing row rendering
  }
}
```

Wire group-by from the column ⋯ menu. (For this task we wire only the data and grouping. The column ⋯ menu wiring is small; add it inline in `th`:)

```ts
const headerMenuBtn = document.createElement('button');
headerMenuBtn.className = 'bd-col-menu-btn';
headerMenuBtn.textContent = '⋯';
headerMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openColumnMenu(headerMenuBtn, f, ctx);
});
th.appendChild(headerMenuBtn);

function openColumnMenu(anchor: HTMLElement, f: FieldDef, ctx: BoardRendererCtx) {
  const existing = document.querySelector('.bd-col-menu');
  existing?.remove();
  const menu = document.createElement('div');
  menu.className = 'bd-col-menu';
  const mkItem = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = 'bd-col-menu-item';
    b.textContent = label;
    b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); menu.remove(); });
    menu.appendChild(b);
  };
  mkItem('Sort ascending',     () => ctx.mutate(b => setViewSort (b, 'table', { field: f.name, dir: 'asc' })));
  mkItem('Sort descending',    () => ctx.mutate(b => setViewSort (b, 'table', { field: f.name, dir: 'desc' })));
  mkItem('Clear sort',         () => ctx.mutate(b => setViewSort (b, 'table', null)));
  mkItem('Group by this',      () => ctx.mutate(b => setViewGroup(b, 'table', f.name)));
  mkItem('Reset column width', () => ctx.mutate(b => setViewWidth(b, 'table', f.name, null)));
  mkItem('Hide column',        () => ctx.mutate(b => hideFieldInView(b, 'table', f.name)));
  const r = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${r.left}px`;
  menu.style.top  = `${r.bottom + 4}px`;
  document.body.appendChild(menu);
  const close = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('mousedown', close, true); }
  };
  document.addEventListener('mousedown', close, true);
}
```

Import the ops:

```ts
import { setViewSort, setViewGroup, setViewWidth, hideFieldInView } from './boardOps';
```

- [ ] **Step 4: CSS**

```css
.bd-table-group td { background: var(--bg-secondary); padding: 6px 10px; font: 500 12px ui-sans-serif, sans-serif; }
.bd-group-row { display: flex; align-items: center; justify-content: space-between; }
.bd-group-left { display: inline-flex; align-items: center; gap: 6px; }
.bd-group-caret { color: var(--text-secondary); font-size: 10px; cursor: pointer; }
.bd-group-name  { font-weight: 500; color: var(--text-primary); }
.bd-group-count { color: var(--text-secondary); font-size: 11px; }
.bd-group-add   { color: var(--link); background: transparent; border: none; cursor: pointer; font: 500 12px ui-sans-serif, sans-serif; }

.bd-col-menu-btn { background: transparent; border: none; color: var(--text-secondary); font-size: 14px; padding: 0 4px; cursor: pointer; opacity: 0; }
.bd-table thead th:hover .bd-col-menu-btn { opacity: 1; }
.bd-col-menu { display: flex; flex-direction: column; gap: 1px; padding: 6px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 12px 28px rgba(0,0,0,0.12); z-index: 7; min-width: 180px; }
.bd-col-menu-item { text-align: left; border: none; background: transparent; padding: 6px 10px; border-radius: 5px; cursor: pointer; font: 500 12.5px ui-sans-serif, sans-serif; color: var(--text-primary); }
.bd-col-menu-item:hover { background: var(--block-hover); }
```

- [ ] **Step 5: Run tests + commit**

```bash
npm test -- tests/board/table.test.ts
git add src/webview/boardTableRender.ts tests/board/table.test.ts src/webview/styles/board.css
git commit -m "feat(board): table group-by + column ⋯ menu (sort/group/hide/reset width)"
```

---

## Task 15: Add card (flat + grouped)

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `tests/board/table.test.ts`

- [ ] **Step 1: Test**

```ts
describe('mountTable — add card', () => {
  it('flat: clicking the trailing add-card row appends a card and focuses Title cell', () => {
    const root = document.createElement('div');
    const b: Board = makeBoard();
    mountTable({
      root, getBoard: () => b, mutate: (fn) => fn(b),
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    const addRow = root.querySelector<HTMLElement>('.bd-table-addrow')!;
    addRow.click();
    expect(b.cards.length).toBe(1);
    const titleCell = root.querySelector<HTMLElement>('.bd-table-cell[data-field="Title"]');
    // After re-render, the new row's title cell exists and is focused / editable.
    expect(titleCell).toBeTruthy();
  });

  it('grouped: clicking + Add card on a group sets that field to the group value', () => {
    const root = document.createElement('div');
    const b: Board = {
      ...makeBoard(),
      views: [{ name: 'table', groupBy: 'Status' }],
    };
    mountTable({
      root, getBoard: () => b, mutate: (fn) => fn(b),
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    // Click + Add card on the second group ("Doing")
    const addBtns = root.querySelectorAll<HTMLElement>('.bd-group-add');
    addBtns[1].click();
    expect(b.cards.length).toBe(1);
    expect(b.cards[0].values.Status).toBe('Doing');
  });
});
```

- [ ] **Step 2: Run, see fail**

Run: `npm test -- tests/board/table.test.ts -t "add card"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add helper to boardOps:

```ts
// boardOps.ts — append:
export function addCard(board: Board, presets: Partial<Record<string, string>> = {}): string {
  const id = nextCardId(board);
  const values: Record<string, string> = { id };
  for (const f of board.fields) {
    values[f.name] = presets[f.name] ?? '';
  }
  if (!values.Status) values.Status = board.columns[0]?.name ?? '';
  board.cards.push({ id, values, body: '' });
  return id;
}
function nextCardId(board: Board): string {
  const used = new Set(board.cards.map(c => c.id));
  let i = board.cards.length + 1;
  while (used.has(`c${i}`)) i++;
  return `c${i}`;
}
```

Add a test for `addCard` in `tests/board/ops.test.ts`:

```ts
describe('boardOps.addCard', () => {
  it('appends a card with empty values + auto Status', () => {
    const b = makeBoard();
    const id = ops.addCard(b);
    expect(b.cards.length).toBe(3);
    expect(b.cards[2].id).toBe(id);
    expect(b.cards[2].values.Status).toBe('Todo');
  });
  it('honors presets', () => {
    const b = makeBoard();
    ops.addCard(b, { Status: 'Doing', Title: 'X' });
    expect(b.cards[2].values.Status).toBe('Doing');
    expect(b.cards[2].values.Title).toBe('X');
  });
});
```

In `boardTableRender.ts`, add the add-row at the end of the body when flat, or wire each group header's `.bd-group-add`:

```ts
// After all groups rendered:
if (!v.groupBy && !ctx.readonly) {
  const addRow = document.createElement('tr');
  addRow.className = 'bd-table-addrow';
  const td = document.createElement('td');
  td.colSpan = visibleFields.length + 1;
  td.textContent = '+ Add card';
  td.addEventListener('click', () => {
    ctx.mutate(bb => {
      const newId = addCard(bb);
      pendingFocus.id = newId;
      pendingFocus.field = 'Title';
    });
  });
  addRow.appendChild(td);
  tbody.appendChild(addRow);
}

// Inside group header rendering, wire .bd-group-add:
head.querySelector<HTMLElement>('.bd-group-add')?.addEventListener('click', (e) => {
  e.stopPropagation();
  ctx.mutate(bb => {
    const newId = addCard(bb, { [v.groupBy!]: g.key === 'Uncategorized' ? '' : g.key });
    pendingFocus.id = newId;
    pendingFocus.field = 'Title';
  });
});
```

Add at the top of `mountTable`:

```ts
const pendingFocus: { id: string | null; field: string | null } = { id: null, field: null };
```

At the end of `render()`:

```ts
if (pendingFocus.id) {
  const tr = root.querySelector<HTMLElement>(`tr.bd-table-row[data-card-id="${pendingFocus.id}"]`);
  const td = tr?.querySelector<HTMLElement>(`.bd-table-cell[data-field="${pendingFocus.field}"]`);
  pendingFocus.id = null;
  pendingFocus.field = null;
  if (td) td.click();
}
```

Import:

```ts
import { addCard } from './boardOps';
```

- [ ] **Step 4: CSS**

```css
.bd-table-addrow td { padding: 9px 10px; color: var(--link); cursor: pointer; font: 500 12px ui-sans-serif, sans-serif; }
.bd-table-addrow:hover td { background: var(--block-hover); }
```

- [ ] **Step 5: Run + commit**

```bash
npm test -- tests/board
git add src/webview/boardOps.ts src/webview/boardTableRender.ts tests/board/ops.test.ts tests/board/table.test.ts src/webview/styles/board.css
git commit -m "feat(board): add card in table view (flat + grouped, focus Title on insert)"
```

---

## Task 16: Resizable column widths

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `tests/board/table.test.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Test**

```ts
describe('mountTable — resize', () => {
  it('mousedown on the right edge of a header starts resize; mousemove updates width; mouseup commits', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const b: Board = makeBoard();
    mountTable({
      root, getBoard: () => b, mutate: (fn) => fn(b),
      openSidePanel: () => {}, openProperties: () => {}, readonly: false,
    });
    const resizer = root.querySelector<HTMLElement>('thead th[data-field="Title"] .bd-col-resizer')!;
    const startRect = resizer.getBoundingClientRect();
    resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: startRect.left, clientY: startRect.top, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: startRect.left + 50, clientY: startRect.top, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup',   { clientX: startRect.left + 50, clientY: startRect.top, bubbles: true }));
    expect(b.views[0].widths?.Title).toBeGreaterThan(160);
    root.remove();
  });
});
```

- [ ] **Step 2: Run, see fail**

Run: `npm test -- tests/board/table.test.ts -t "resize"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Inside the th building loop, append the resizer:

```ts
const resizer = document.createElement('div');
resizer.className = 'bd-col-resizer';
resizer.addEventListener('mousedown', (e) => {
  e.preventDefault(); e.stopPropagation();
  const start = e.clientX;
  const col = table.querySelectorAll('colgroup col')[1 + visibleFields.indexOf(f)] as HTMLTableColElement;
  const startW = parseInt(col.style.width, 10) || 160;
  const onMove = (ev: MouseEvent) => {
    const next = Math.max(60, startW + (ev.clientX - start));
    col.style.width = `${next}px`;
  };
  const onUp = (ev: MouseEvent) => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup',   onUp,   true);
    const next = Math.max(60, startW + (ev.clientX - start));
    ctx.mutate(bb => setViewWidth(bb, 'table', f.name, next));
  };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup',   onUp,   true);
});
th.appendChild(resizer);
```

- [ ] **Step 4: CSS**

```css
.bd-col-resizer {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 4px;
  cursor: col-resize;
}
.bd-col-resizer:hover { background: var(--link); opacity: 0.3; }
```

- [ ] **Step 5: Run + commit**

```bash
npm test -- tests/board/table.test.ts
git add src/webview/boardTableRender.ts tests/board/table.test.ts src/webview/styles/board.css
git commit -m "feat(board): resizable column widths in table view"
```

---

## Task 17: Row reorder (drag the ⋮ handle, blue-line drop indicator)

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `src/webview/boardOps.ts`
- Modify: `src/webview/styles/board.css`
- Modify: `tests/board/ops.test.ts`

- [ ] **Step 1: Add `moveCard` to boardOps + test**

In `tests/board/ops.test.ts`:

```ts
describe('boardOps.moveCard', () => {
  it('reorders cards array to put fromId at the position before beforeId', () => {
    const b = makeBoard();   // cards: c1, c2
    // Add a 3rd:
    b.cards.push({ id: 'c3', values: { id: 'c3', Title: 'C', Status: 'Todo', Owner: '' }, body: '' });
    ops.moveCard(b, 'c3', 'c2');  // put c3 before c2
    expect(b.cards.map(c => c.id)).toEqual(['c1', 'c3', 'c2']);
  });
  it('null beforeId moves to end', () => {
    const b = makeBoard();
    ops.moveCard(b, 'c1', null);
    expect(b.cards.map(c => c.id)).toEqual(['c2', 'c1']);
  });
});
```

In `boardOps.ts`:

```ts
export function moveCard(board: Board, fromId: string, beforeId: string | null): void {
  const fromIdx = board.cards.findIndex(c => c.id === fromId);
  if (fromIdx < 0) return;
  const [card] = board.cards.splice(fromIdx, 1);
  if (beforeId === null) { board.cards.push(card); return; }
  const insertIdx = board.cards.findIndex(c => c.id === beforeId);
  if (insertIdx < 0) { board.cards.push(card); return; }
  board.cards.splice(insertIdx, 0, card);
}
```

- [ ] **Step 2: Run + verify ops test passes**

Run: `npm test -- tests/board/ops.test.ts -t "moveCard"`
Expected: PASS.

- [ ] **Step 3: Wire the drag in the table renderer**

Inside the body row build (when NOT sorted and NOT readonly):

```ts
if (!v.sort && !ctx.readonly) {
  const grip = document.createElement('span');
  grip.className = 'bd-row-grip';
  grip.textContent = '⋮';
  grip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startRowDrag(e, card, g, tbody, ctx, v);
  });
  gutter.appendChild(grip);
}
```

Helper near the top of `mountTable`:

```ts
import { startDrag, dropIndicator } from './boardDragShared';
import { moveCard } from './boardOps';

function startRowDrag(
  e: MouseEvent,
  card: Card,
  group: Group,
  tbody: HTMLTableSectionElement,
  ctx: BoardRendererCtx,
  v: ViewDef,
): void {
  const ind = dropIndicator();
  tbody.parentElement!.appendChild(ind);
  let dropBeforeId: string | null = null;
  startDrag(e, {
    onMove: (ev) => {
      // Find the row under cursor in this group; compute "before which row"
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('tr.bd-table-row') as HTMLElement | null;
      if (!target) { ind.hide(); return; }
      const targetCardId = target.dataset.cardId!;
      const targetCard = group.cards.find(c => c.id === targetCardId);
      if (!targetCard) {
        // Cross-group drop — reject with red flash
        ind.classList.add('bd-drop-line-reject');
        const r = target.getBoundingClientRect();
        ind.show(r.left, r.top, r.width, 2);
        return;
      }
      ind.classList.remove('bd-drop-line-reject');
      const r = target.getBoundingClientRect();
      const above = ev.clientY < r.top + r.height / 2;
      const y = above ? r.top : r.bottom;
      ind.show(r.left, y - 1, r.width, 2);
      dropBeforeId = above ? targetCardId : (group.cards[group.cards.indexOf(targetCard) + 1]?.id ?? null);
    },
    onDrop: () => {
      ind.remove();
      if (dropBeforeId !== null && !ind.classList.contains('bd-drop-line-reject')) {
        ctx.mutate(bb => moveCard(bb, card.id, dropBeforeId));
      }
    },
    onCancel: () => ind.remove(),
  });
}
```

- [ ] **Step 4: CSS**

```css
.bd-row-grip { color: transparent; cursor: grab; font-size: 14px; padding: 0 4px; }
.bd-table-row:hover .bd-row-grip { color: var(--text-secondary); }
.bd-drop-line-reject { background: #ef4444 !important; }
```

- [ ] **Step 5: Run + manual test + commit**

Run: `npm test -- tests/board`
Expected: PASS.

```bash
git add src/webview/boardOps.ts src/webview/boardTableRender.ts tests/board/ops.test.ts src/webview/styles/board.css
git commit -m "feat(board): table row reorder via ⋮ drag (blue line drop indicator)"
```

---

## Task 18: Properties popover view-awareness

**Files:**
- Modify: `src/webview/boardProperties.ts`
- Modify: `src/webview/boardBlock.ts`

- [ ] **Step 1: Add a `viewName` arg to the props popover constructor**

In `boardProperties.ts`, find the function that builds the popover. Add a parameter `viewName: string` (defaults to `'kanban'` for back-compat). When the "hide column" toggle is flipped, call `hideFieldInView(board, viewName, fieldName)` (or `showFieldInView`) instead of mutating `hidden-fields` directly.

When the field reorder drag commits, write to `views.find(v => v.name === viewName).columns` (creating the view if missing — use `setViewColumns` helper added below).

- [ ] **Step 2: Add `setViewColumns` to boardOps + test**

```ts
// tests/board/ops.test.ts
describe('boardOps.setViewColumns', () => {
  it('persists column order on the view', () => {
    const b = makeBoard();
    ops.setViewColumns(b, 'table', ['Owner', 'Title', 'Status']);
    expect(b.views[0].columns).toEqual(['Owner', 'Title', 'Status']);
  });
});
```

```ts
// boardOps.ts
export function setViewColumns(board: Board, viewName: string, columns: string[]): void {
  const v = ensureView(board, viewName);
  v.columns = columns;
  pruneView(board, viewName);
}
```

- [ ] **Step 3: In `boardBlock.ts`, pass the active view name when opening Properties**

```ts
function openProperties(): void {
  const v = currentBoard.activeView;
  openPropertiesPopover(currentBoard, v, /* existing args */);
}
```

- [ ] **Step 4: Run + commit**

```bash
npm test -- tests/board
git add src/webview/boardProperties.ts src/webview/boardOps.ts src/webview/boardBlock.ts tests/board/ops.test.ts
git commit -m "feat(board): properties popover writes to active view's columns/hidden"
```

---

## Task 19: Auto-clear sort/group on field hide/delete

**Files:**
- Modify: `src/webview/boardOps.ts`
- Modify: `tests/board/ops.test.ts`

- [ ] **Step 1: Tests**

```ts
describe('boardOps.hideFieldInView — auto-clear sort/group', () => {
  it('clears sort if it referenced the hidden field', () => {
    const b = makeBoard({
      views: [{ name: 'table', sort: { field: 'Owner', dir: 'asc' } }],
    });
    ops.hideFieldInView(b, 'table', 'Owner');
    expect(b.views[0].sort).toBeUndefined();
  });
  it('clears groupBy if it referenced the hidden field', () => {
    const b = makeBoard({
      views: [{ name: 'table', groupBy: 'Owner' }],
    });
    ops.hideFieldInView(b, 'table', 'Owner');
    expect(b.views[0].groupBy).toBeUndefined();
  });
});
```

(The `deleteField` test from Task 4 already covers cross-view auto-clear; verify it still passes.)

- [ ] **Step 2: Run, see fail**

Run: `npm test -- tests/board/ops.test.ts -t "auto-clear"`
Expected: FAIL.

- [ ] **Step 3: Update `hideFieldInView` to auto-clear**

```ts
export function hideFieldInView(board: Board, viewName: string, field: string): void {
  const v = ensureView(board, viewName);
  v.hidden = Array.from(new Set([...(v.hidden ?? []), field]));
  if (v.sort?.field === field) delete v.sort;
  if (v.groupBy    === field) delete v.groupBy;
  pruneView(board, viewName);
}
```

- [ ] **Step 4: Run + commit**

```bash
npm test -- tests/board/ops.test.ts
git add src/webview/boardOps.ts tests/board/ops.test.ts
git commit -m "feat(board): auto-clear sort/group on field hide; covers field-delete already in Task 4"
```

---

## Task 20: Slash menu — split `/board` into `/board kanban` and `/board table`

**Files:**
- Modify: `src/webview/blockPicker.ts`

- [ ] **Step 1: Find the existing `/board` entry**

Open `src/webview/blockPicker.ts`, locate the array of slash entries, find the `board` one.

- [ ] **Step 2: Replace with two entries**

```ts
{
  label: 'Board: Kanban',
  keyword: 'board kanban',
  template: emptyBoardMarkdown({ activeView: 'kanban' }),
},
{
  label: 'Board: Table',
  keyword: 'board table',
  template: emptyBoardMarkdown({ activeView: 'table' }),
},
```

Add the helper next to the entries:

```ts
function emptyBoardMarkdown(opts: { activeView: 'kanban' | 'table' }): string {
  const av = opts.activeView === 'table' ? ' active-view="table"' : '';
  const viewBlock = opts.activeView === 'table'
    ? '\n<!-- board:view name="table" -->\n'
    : '';
  const id = `b-${Math.random().toString(36).slice(2, 6)}`;
  return [
    `<!-- board:start id="${id}" name="" columns="Todo|Doing|Done" column-colors="blue|amber|emerald" field-types="Title=text,Status=status" hidden-fields="id"${av} -->`,
    viewBlock,
    '| id | Title    | Status |',
    '|----|----------|--------|',
    '| c1 | New card | Todo   |',
    '',
    '<!-- board:end -->',
  ].join('\n');
}
```

If there's an existing template helper, replace the single entry with the two new ones using it instead.

- [ ] **Step 3: Compile + manual test**

Run: `npm run compile`. Manually: open the editor, type `/board`, both entries appear. Pick Table → board inserts with table view active.

- [ ] **Step 4: Commit**

```bash
git add src/webview/blockPicker.ts
git commit -m "feat(board): slash menu has Board: Kanban and Board: Table entries"
```

---

## Task 21: Read-only mode wiring for table

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `tests/board/table.test.ts`

- [ ] **Step 1: Test**

```ts
describe('mountTable — readonly', () => {
  it('no inline editors, no drag handles, no add-card', () => {
    const root = document.createElement('div');
    const b: Board = {
      ...makeBoard(),
      cards: [{ id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo', Owner: '' }, body: '' }],
    };
    mountTable({
      root, getBoard: () => b, mutate: () => {},
      openSidePanel: () => {}, openProperties: () => {}, readonly: true,
    });
    const titleCell = root.querySelector<HTMLElement>('.bd-table-cell[data-field="Title"]')!;
    titleCell.click();
    expect(titleCell.getAttribute('contenteditable')).not.toBe('true');
    expect(root.querySelector('.bd-row-grip')).toBeNull();
    expect(root.querySelector('.bd-table-addrow')).toBeNull();
    expect(root.querySelector('.bd-col-resizer')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, see fail**

Run: `npm test -- tests/board/table.test.ts -t "readonly"`
Expected: FAIL on at least one assertion (grip / add-row likely render unconditionally today).

- [ ] **Step 3: Gate all interactive bits behind `!ctx.readonly`**

Audit every spot in `boardTableRender.ts` that creates a handler / drag affordance / add button / resizer. Wrap with `if (!ctx.readonly)`. The cell-click handlers already check this; ensure column ⋯ menu, sort cycle, grip, resizer, add-row, group ⋯ all skip when readonly.

- [ ] **Step 4: Run + commit**

```bash
npm test -- tests/board/table.test.ts
git add src/webview/boardTableRender.ts tests/board/table.test.ts
git commit -m "feat(board): table renderer respects readonly mode"
```

---

## Task 22: Column reorder (drag the header cell, blue-line drop indicator between cols)

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Implementation**

In each `th` build, attach mousedown:

```ts
th.addEventListener('mousedown', (e) => {
  if (ctx.readonly) return;
  const t = e.target as HTMLElement;
  if (t.closest('.bd-col-resizer') || t.closest('.bd-col-menu-btn')) return;
  e.preventDefault();
  startColumnDrag(e, f, root, visibleFields, ctx);
});
```

```ts
function startColumnDrag(
  e: MouseEvent,
  f: FieldDef,
  root: HTMLElement,
  visibleFields: FieldDef[],
  ctx: BoardRendererCtx,
): void {
  const headRow = root.querySelector('thead tr')!;
  const ths = Array.from(headRow.querySelectorAll('th'));
  const ind = dropIndicator();
  root.appendChild(ind);
  let dropIdx = visibleFields.indexOf(f);
  startDrag(e, {
    onMove: (ev) => {
      // Find which column gap we're nearest to.
      let chosen = visibleFields.length;
      for (let i = 0; i < visibleFields.length; i++) {
        const rect = ths[i + 1].getBoundingClientRect();   // +1 for gutter
        const mid = rect.left + rect.width / 2;
        if (ev.clientX < mid) { chosen = i; break; }
      }
      dropIdx = chosen;
      const targetRect = chosen === visibleFields.length
        ? ths[visibleFields.length].getBoundingClientRect()
        : ths[chosen + 1].getBoundingClientRect();
      const x = chosen === visibleFields.length ? targetRect.right : targetRect.left;
      const tableTop = root.querySelector('table')!.getBoundingClientRect().top;
      const tableBottom = root.querySelector('table')!.getBoundingClientRect().bottom;
      ind.show(x - 1, tableTop, 2, tableBottom - tableTop);
    },
    onDrop: () => {
      ind.remove();
      ctx.mutate(bb => {
        const v = bb.views.find(x => x.name === 'table') ?? (() => { const nv = { name: 'table' as const, columns: visibleFields.map(x => x.name) }; bb.views.push(nv); return nv; })();
        const cur = v.columns ?? visibleFields.map(x => x.name);
        const fromIdx = cur.indexOf(f.name);
        if (fromIdx < 0) return;
        const next = [...cur];
        next.splice(fromIdx, 1);
        next.splice(dropIdx > fromIdx ? dropIdx - 1 : dropIdx, 0, f.name);
        v.columns = next;
      });
    },
    onCancel: () => ind.remove(),
  });
}
```

- [ ] **Step 2: CSS**

```css
.bd-table thead th { cursor: grab; }
.bd-table thead th .bd-col-resizer { cursor: col-resize; }
```

- [ ] **Step 3: Manual + commit**

Run: `npm run compile && npm test -- tests/board`
Expected: PASS.

```bash
git add src/webview/boardTableRender.ts src/webview/styles/board.css
git commit -m "feat(board): column reorder in table view via header drag"
```

---

## Task 23: Final polish — group-add wiring, focus management, scroll container

**Files:**
- Modify: `src/webview/boardTableRender.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Verify and tighten**

Manually open the editor with various boards and run through the spec's edge cases:
- Hide a field that's the sort key → sort clears.
- Hide all fields → degenerate but no crash.
- Group by Status with empty Done column → empty group renders.
- Group by tags, multi-tag card → appears in first-tag group only.
- Resize a column past 60 px floor.
- Sort + group together — sort within groups, group order unaffected.

Fix any bugs found.

- [ ] **Step 2: Sticky table header (small win)**

```css
.bd-table thead th { position: sticky; top: 0; background: var(--bg); z-index: 2; }
.bd-table-host { max-height: 600px; overflow-y: auto; overflow-x: auto; }
```

- [ ] **Step 3: Run all tests + commit**

```bash
npm test
git add src/webview/boardTableRender.ts src/webview/styles/board.css
git commit -m "polish(board): sticky header, final pass on table edge cases"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| Storage / `board:view` markers | Tasks 1, 2, 3 |
| `ViewDef` type + `Board.views/activeView` | Task 1 |
| ⋯ menu replacing Properties button | Task 8 |
| Kanban/Table segmented control | Task 8 |
| Slash menu split | Task 20 |
| Table header (sort caret, resize handle, ⋯ menu) | Tasks 9, 13, 14, 16 |
| Table body (gutter, cells, hover affordances) | Tasks 9, 10, 11, 12 |
| Cell renderers (text, status, date, person, tags) | Tasks 10, 11, 12 |
| Inline editors | Tasks 10, 11, 12 |
| Sort | Task 13 |
| Group | Task 14 |
| Add card (flat + grouped) | Task 15 |
| Column widths | Task 16 |
| Row reorder | Task 17 |
| Column reorder | Task 22 |
| Properties view-awareness | Task 18 |
| Auto-clear on hide/delete | Tasks 4, 19 |
| Read-only mode | Task 21 |
| Empty state | Task 9 |
| Renderer contract + file split | Tasks 6, 7 |
| Shared drag chrome | Task 5 |
| `boardOps` extraction | Task 4 (+ extensions in 15, 17, 18) |

No spec section unaccounted for.

**Placeholder scan:** No "TBD" / "TODO" / "similar to" left in the plan body. The `Tab` key in Task 10's inline-text editor has a `/* TODO: jump to next cell (later) */` comment — that's a documented intentional v2 deferral, not a placeholder.

**Type consistency:**
- `BoardRendererCtx` / `BoardRendererOps` exported from `boardBlock.ts` (Task 6), imported by both renderers (Tasks 6, 9).
- `setViewSort` / `setViewGroup` / `setViewWidth` / `setViewColumns` / `hideFieldInView` / `showFieldInView` / `deleteField` / `addCard` / `moveCard` all defined in `boardOps.ts`, all used with matching signatures in renderer + properties code.
- `Group` interface declared in Task 14, used in Task 17's `startRowDrag`.

All good.
