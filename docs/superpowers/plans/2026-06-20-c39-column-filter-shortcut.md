# c39 — Column-menu Filter Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Filter** item to a board column's `⋯` menu (status/tags columns only) that opens a scoped mini-filter for that single field, and reorder/collapse the column menu (Filter · Group · Sort-flyout).

**Architecture:** Lift the filter on/off math out of `createFilterPill`'s closure into pure, unit-tested helpers in `boardFilter.ts`. Extract the per-field chip row into a shared `buildFieldFilterRow` in `boardFilterPanel.ts` consumed by both the global funnel panel and a new `openColumnFilter` mini-filter popover. The mini-filter edits the same session `FilterState` via `ctx.getFilter`/`ctx.setFilter`, and its "All filters…" footer calls a new `ctx.openFilterPanel()` hook wired from the chrome's funnel pill.

**Tech Stack:** TypeScript, VS Code webview (vanilla DOM), Jest + ts-jest (jsdom), esbuild. Icons inlined as Phosphor SVG paths.

## Global Constraints

- **Filter item appears only for `status` / `tags` fields** — the only types `applyFilter` understands. Text/ID columns omit it.
- **Phosphor icons, regular weight, matching the existing menu icons:** new menu glyphs use `viewBox="0 0 256 256"`, `fill="currentColor"`, `width="16" height="16"` — same as the other `COL_MENU_ICONS`. Do NOT use the stroke-based 24×24 toolbar `FUNNEL_SVG` for menu items.
- **Filter state is session-only** — never serialized. Edit it only through `ctx.getFilter()` / `ctx.setFilter()`.
- **Reuse existing chip rendering** (`board-column-chip` + `bd-filter-*` classes) — do not hand-roll new chip styles.
- **Multiple boards per document:** never reach the funnel via a global DOM selector; use the per-board `ctx` hook.

---

### Task 1: Pure filter on/off helpers in `boardFilter.ts`

Move the on-set math (currently trapped in `createFilterPill`'s closure: `NONE_ON`, `onSetOf`, `allValuesOf`, and the toggle logic) into pure, exported functions so both the global panel and the mini-filter share one source of truth.

**Files:**
- Modify: `src/webview/boardFilter.ts`
- Test: `tests/boardFilter.test.ts`

**Interfaces:**
- Consumes: `FilterState`, `EMPTY_VALUE` (already in this file).
- Produces:
  - `NONE_ON: string`
  - `allFieldValues(optionNames: string[]): string[]`
  - `onValues(filter: FilterState, fieldName: string, optionNames: string[]): Set<string>`
  - `toggleFilterValue(filter: FilterState, fieldName: string, optionNames: string[], value: string): FilterState`
  - `clearFilterField(filter: FilterState, fieldName: string): FilterState`

- [ ] **Step 1: Write the failing tests**

Append to `tests/boardFilter.test.ts`:

```typescript
import {
  NONE_ON, allFieldValues, onValues, toggleFilterValue, clearFilterField,
} from '../src/webview/boardFilter';

describe('filter on/off helpers', () => {
  const opts = ['Todo', 'Doing', 'Done'];
  const all = [...opts, EMPTY_VALUE];

  it('allFieldValues appends EMPTY_VALUE', () => {
    expect(allFieldValues(opts)).toEqual(['Todo', 'Doing', 'Done', EMPTY_VALUE]);
  });

  it('onValues defaults to all-on when the field has no entry', () => {
    expect([...onValues({}, 'Status', opts)].sort()).toEqual([...all].sort());
  });

  it('onValues reads the stored set and drops NONE_ON', () => {
    expect([...onValues({ Status: ['Todo'] }, 'Status', opts)]).toEqual(['Todo']);
    expect([...onValues({ Status: [NONE_ON] }, 'Status', opts)]).toEqual([]);
  });

  it('toggling one value off an all-on field stores the remaining on-set', () => {
    expect(toggleFilterValue({}, 'Status', opts, 'Done').Status!.sort())
      .toEqual(['Doing', EMPTY_VALUE, 'Todo'].sort());
  });

  it('toggling the last value on clears the field (back to all-on)', () => {
    const partial: FilterState = { Status: ['Todo'] };
    // turn every remaining value on → field becomes inactive (deleted)
    let next = toggleFilterValue(partial, 'Status', opts, 'Doing');
    next = toggleFilterValue(next, 'Status', opts, 'Done');
    next = toggleFilterValue(next, 'Status', opts, EMPTY_VALUE);
    expect(next.Status).toBeUndefined();
  });

  it('toggling the only remaining value off stores [NONE_ON]', () => {
    expect(toggleFilterValue({ Status: ['Todo'] }, 'Status', opts, 'Todo').Status)
      .toEqual([NONE_ON]);
  });

  it('toggleFilterValue does not mutate its input', () => {
    const input: FilterState = { Status: ['Todo'] };
    toggleFilterValue(input, 'Status', opts, 'Doing');
    expect(input).toEqual({ Status: ['Todo'] });
  });

  it('clearFilterField removes only the named field', () => {
    expect(clearFilterField({ Status: ['Todo'], Impact: ['High'] }, 'Status'))
      .toEqual({ Impact: ['High'] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/boardFilter.test.ts`
Expected: FAIL — `NONE_ON`/`allFieldValues`/etc. are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/webview/boardFilter.ts`:

```typescript
// Sentinel stored when EVERY value of a field is toggled off: a value no card
// has, so applyFilter hides every card. Distinct from EMPTY_VALUE.
export const NONE_ON = '__none__';

// All selectable values for a field = its option names + the (Empty) sentinel.
export function allFieldValues(optionNames: string[]): string[] {
  return [...optionNames, EMPTY_VALUE];
}

// The values currently ON for a field. No entry → all on (default). Otherwise
// the stored set, minus the NONE_ON sentinel.
export function onValues(
  filter: FilterState, fieldName: string, optionNames: string[],
): Set<string> {
  const raw = filter[fieldName];
  return raw === undefined
    ? new Set(allFieldValues(optionNames))
    : new Set(raw.filter((v) => v !== NONE_ON));
}

// Pure toggle of one value. Returns a new FilterState (never mutates input):
// all on → field deleted (show everything); all off → [NONE_ON] (hide all);
// otherwise the on-set is stored.
export function toggleFilterValue(
  filter: FilterState, fieldName: string, optionNames: string[], value: string,
): FilterState {
  const next: FilterState = { ...filter };
  const on = onValues(filter, fieldName, optionNames);
  if (on.has(value)) on.delete(value);
  else on.add(value);
  const all = allFieldValues(optionNames);
  if (on.size === all.length) delete next[fieldName];
  else if (on.size === 0) next[fieldName] = [NONE_ON];
  else next[fieldName] = [...on];
  return next;
}

// Pure: reset a single field (back to all-on). Never mutates input.
export function clearFilterField(filter: FilterState, fieldName: string): FilterState {
  const next: FilterState = { ...filter };
  delete next[fieldName];
  return next;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/boardFilter.test.ts`
Expected: PASS (all existing `applyFilter` tests + the new helper tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardFilter.ts tests/boardFilter.test.ts
git commit -m "feat: pure filter on/off helpers (toggle/clear/onValues)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extract `buildFieldFilterRow` and refactor the global panel

Replace the closure-local `onSetOf` / `allValuesOf` / `toggleValue` in `boardFilterPanel.ts` with the Task 1 helpers, and lift the per-field chip-row rendering into an exported `buildFieldFilterRow` used by both the global panel and (Task 4) the mini-filter.

**Files:**
- Modify: `src/webview/boardFilterPanel.ts`
- Test: `tests/boardColumnFilter.test.ts` (create)

**Interfaces:**
- Consumes: `onValues`, `toggleFilterValue` from `boardFilter.ts` (Task 1); `BoardRendererCtx`, `EMPTY_VALUE`, `filterableFields`, `FilterableField`.
- Produces:
  - `export function buildFieldFilterRow(ctx: BoardRendererCtx, f: FilterableField, onChange: () => void): HTMLElement`
  - `export function filterableFields(board: Board): FilterableField[]` (promote existing fn to exported)
  - `export interface FilterableField { name: string; values: ColumnDef[]; }` (promote to exported)

- [ ] **Step 1: Write the failing test**

Create `tests/boardColumnFilter.test.ts`:

```typescript
/** @jest-environment jsdom */
import { buildFieldFilterRow, filterableFields } from '../src/webview/boardFilterPanel';
import type { BoardRendererCtx } from '../src/webview/boardBlock';
import type { Board } from '../src/webview/boardModel';

function makeBoard(): Board {
  return {
    id: 'b1', name: 'B', columns: [],
    fields: [{ name: 'Status', type: 'status', visibleOnCard: true }],
    cards: [
      { id: 'c1', values: { Status: 'Todo' }, body: '' },
      { id: 'c2', values: { Status: 'Done' }, body: '' },
    ],
    orphanBodies: [], views: [], activeView: 'table',
  };
}

function makeCtx(board: Board): BoardRendererCtx {
  let filter = {};
  return {
    root: document.createElement('div'),
    getBoard: () => board,
    mutate: () => {},
    openSidePanel: () => {},
    requestDelete: () => {},
    readonly: false,
    getFilter: () => filter,
    setFilter: (next) => { filter = next; },
  } as unknown as BoardRendererCtx;
}

describe('buildFieldFilterRow', () => {
  it('renders one chip per status option plus an (Empty) chip', () => {
    const board = makeBoard();
    const f = filterableFields(board)[0];
    const row = buildFieldFilterRow(makeCtx(board), f, () => {});
    const chips = row.querySelectorAll('.bd-filter-chip');
    // Todo + Done + (Empty)
    expect(chips.length).toBe(3);
    expect(row.querySelector('.bd-filter-field-label')!.textContent).toBe('Status');
  });

  it('clicking a selected chip turns its value off in the shared filter', () => {
    const board = makeBoard();
    const ctx = makeCtx(board);
    const f = filterableFields(board)[0];
    let changed = 0;
    const row = buildFieldFilterRow(ctx, f, () => { changed++; });
    // first chip = "Todo", on by default → click turns it off
    (row.querySelector('.bd-filter-chip') as HTMLButtonElement).click();
    expect(changed).toBe(1);
    expect(ctx.getFilter().Status).not.toContain('Todo');
    expect(ctx.getFilter().Status).toContain('Done');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/boardColumnFilter.test.ts`
Expected: FAIL — `buildFieldFilterRow` / `filterableFields` not exported.

- [ ] **Step 3: Refactor `boardFilterPanel.ts`**

Update the import line (add the Task 1 helpers):

```typescript
import { applyFilter, EMPTY_VALUE, onValues, toggleFilterValue, clearFilterField } from './boardFilter';
```

Export the field interface and discovery fn (change `interface`/`function` to `export interface`/`export function`):

```typescript
export interface FilterableField { name: string; values: ColumnDef[]; }

export function filterableFields(board: Board): FilterableField[] {
  const out: FilterableField[] = [];
  for (const f of board.fields) {
    if (f.type === 'status') out.push({ name: f.name, values: getStatusOptions(board, f.name) });
    else if (f.type === 'tags') out.push({ name: f.name, values: f.options ?? [] });
  }
  return out;
}
```

Delete the now-unused locals `NONE_ON`, `allValuesOf`, `onSetOf` (lines ~28–38) — they live in `boardFilter.ts` now.

Add the shared row builder (place it above `createFilterPill`):

```typescript
// One field's filter row (label + value chips). Shared by the global funnel
// panel and the per-column mini-filter. `onChange` fires after a toggle so the
// caller can rebuild its own container to reflect the new selection.
export function buildFieldFilterRow(
  ctx: BoardRendererCtx, f: FilterableField, onChange: () => void,
): HTMLElement {
  const optionNames = f.values.map((v) => v.name);
  const on = onValues(ctx.getFilter(), f.name, optionNames);

  const row = document.createElement('div');
  row.className = 'bd-filter-field';

  const label = document.createElement('div');
  label.className = 'bd-filter-field-label';
  label.textContent = f.name;
  row.appendChild(label);

  const chips = document.createElement('div');
  chips.className = 'bd-filter-chips';

  const mkChip = (value: string, display: string, token: string, isEmpty: boolean): void => {
    const isOn = on.has(value);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `board-column-chip color-${token} bd-filter-chip`
      + (isOn ? ' is-selected' : ' bd-filter-hollow')
      + (isEmpty ? ' bd-filter-empty' : '');
    const dot = document.createElement('span');
    dot.className = 'board-column-chip-dot';
    chip.appendChild(dot);
    const name = document.createElement('span');
    name.textContent = display;
    chip.appendChild(name);
    chip.addEventListener('click', () => {
      ctx.setFilter(toggleFilterValue(ctx.getFilter(), f.name, optionNames, value));
      onChange();
    });
    chips.appendChild(chip);
  };

  for (const opt of f.values) mkChip(opt.name, opt.name, opt.color, false);
  mkChip(EMPTY_VALUE, '(Empty)', 'gray', true);

  row.appendChild(chips);
  return row;
}
```

Now make `createFilterPill` reuse it. Inside `buildPanel()`, replace the entire `for (const f of filterableFields(board)) { ... }` block (the row/chips construction, lines ~135–172) with:

```typescript
    for (const f of filterableFields(board)) {
      panel.appendChild(buildFieldFilterRow(ctx, f, buildPanel));
    }
```

Delete the now-unused closure-local `toggleValue` function (lines ~93–103). The header/count code (`applyFilter`, the `Clear` button calling `ctx.setFilter({})`) stays as-is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/boardColumnFilter.test.ts tests/boardFilter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardFilterPanel.ts tests/boardColumnFilter.test.ts
git commit -m "refactor: share buildFieldFilterRow between funnel panel + (future) mini-filter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `ctx.openFilterPanel` hook (funnel pill ⇄ context)

Expose an `open()` on the funnel pill and wire it onto a per-board `ctx.openFilterPanel` so the mini-filter's "All filters…" can open the full funnel without a global DOM lookup.

**Files:**
- Modify: `src/webview/boardBlock.ts:31-44` (the `BoardRendererCtx` interface)
- Modify: `src/webview/boardFilterPanel.ts` (`FilterPill` interface + return)
- Modify: `src/webview/boardChrome.ts:56-59`

**Interfaces:**
- Consumes: `createFilterPill` (Task 2 leaves it intact), `BoardRendererCtx`.
- Produces:
  - `BoardRendererCtx.openFilterPanel?: () => void`
  - `FilterPill.open: () => void`

- [ ] **Step 1: Add the optional hook to the context type**

In `src/webview/boardBlock.ts`, inside `interface BoardRendererCtx`, after `setFilter`:

```typescript
  /** Replace the filter and re-render the body + chrome (no save/mutate). */
  setFilter: (next: FilterState) => void;
  /** Open the global (multi-field) filter funnel for THIS board. Wired by chrome. */
  openFilterPanel?: () => void;
```

- [ ] **Step 2: Expose `open()` on the funnel pill**

In `src/webview/boardFilterPanel.ts`, extend the interface:

```typescript
export interface FilterPill { el: HTMLElement; refresh: () => void; open: () => void; }
```

At the end of `createFilterPill`, change the return to include `open` (open only if not already open):

```typescript
  refresh();
  return {
    el: wrap,
    refresh,
    open: () => { if (!popover?.isOpen()) openPanel(); },
  };
```

- [ ] **Step 3: Wire the hook in chrome**

In `src/webview/boardChrome.ts`, right after `chrome.appendChild(filterPill.el);`:

```typescript
  const filterPill: FilterPill = createFilterPill(ctx);
  chrome.appendChild(filterPill.el);
  // Let per-column mini-filters ("All filters…") open this board's funnel.
  ctx.openFilterPanel = () => filterPill.open();
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: No new errors in `boardBlock.ts`, `boardFilterPanel.ts`, or `boardChrome.ts`. (Note: a pre-existing `toggle.ts` type error may surface from the working tree — ignore that file; it is unrelated to this change.)

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardBlock.ts src/webview/boardFilterPanel.ts src/webview/boardChrome.ts
git commit -m "feat: ctx.openFilterPanel hook to open a board's funnel from elsewhere

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `openColumnFilter` mini-filter popover + CSS

Build the scoped mini-filter: a popover anchored to a column header with a header (field name + Clear), the shared chip row, and an "All filters…" footer.

**Files:**
- Modify: `src/webview/boardFilterPanel.ts`
- Modify: `src/webview/styles/board.css` (after the `.bd-filter-*` block, ~line 1863)
- Test: `tests/boardColumnFilter.test.ts` (extend)

**Interfaces:**
- Consumes: `createPopover`, `buildFieldFilterRow`, `filterableFields` (Task 2), `clearFilterField` (Task 1), `BoardRendererCtx.openFilterPanel` (Task 3), module-local `FUNNEL_SVG`.
- Produces: `export function openColumnFilter(anchor: HTMLElement, ctx: BoardRendererCtx, fieldName: string): void`

- [ ] **Step 1: Write the failing test**

Append to `tests/boardColumnFilter.test.ts`:

```typescript
import { openColumnFilter } from '../src/webview/boardFilterPanel';

describe('openColumnFilter', () => {
  it('renders header (field name + Clear), the chip row, and an All filters… footer', () => {
    const board = makeBoard();
    const ctx = makeCtx(board);
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    openColumnFilter(anchor, ctx, 'Status');

    const panel = document.querySelector('.bd-col-filter-panel')!;
    expect(panel).toBeTruthy();
    expect(panel.querySelector('.bd-filter-title')!.textContent).toBe('Status');
    expect(panel.querySelectorAll('.bd-filter-chip').length).toBe(3);
    expect(panel.querySelector('.bd-col-filter-foot')!.textContent).toContain('All filters');
  });

  it('Clear resets only this field', () => {
    const board = makeBoard();
    const ctx = makeCtx(board);
    ctx.setFilter({ Status: ['Todo'] });
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    openColumnFilter(anchor, ctx, 'Status');
    (document.querySelector('.bd-filter-clear') as HTMLButtonElement).click();
    expect(ctx.getFilter().Status).toBeUndefined();
  });

  it('All filters… calls ctx.openFilterPanel', () => {
    const board = makeBoard();
    const ctx = makeCtx(board);
    let opened = 0;
    ctx.openFilterPanel = () => { opened++; };
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    openColumnFilter(anchor, ctx, 'Status');
    (document.querySelector('.bd-col-filter-foot') as HTMLButtonElement).click();
    expect(opened).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/boardColumnFilter.test.ts`
Expected: FAIL — `openColumnFilter` not exported.

- [ ] **Step 3: Implement `openColumnFilter`**

Append to `src/webview/boardFilterPanel.ts` (and ensure `clearFilterField` is in the `./boardFilter` import — it was added in Task 2):

```typescript
// Scoped per-column mini-filter. Opened from a column's ⋯ menu. Edits the same
// session FilterState the funnel uses; "All filters…" jumps to the full funnel.
export function openColumnFilter(
  anchor: HTMLElement, ctx: BoardRendererCtx, fieldName: string,
): void {
  const f = filterableFields(ctx.getBoard()).find((x) => x.name === fieldName);
  if (!f) return;

  const popover = createPopover({ className: 'bd-filter-panel bd-col-filter-panel' });
  popover.el.setAttribute('role', 'dialog');

  function build(): void {
    popover.el.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'bd-filter-head';
    const title = document.createElement('span');
    title.className = 'bd-filter-title';
    title.textContent = f!.name;
    head.appendChild(title);
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'bd-filter-clear';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      ctx.setFilter(clearFilterField(ctx.getFilter(), f!.name));
      build();
    });
    head.appendChild(clear);
    popover.el.appendChild(head);

    popover.el.appendChild(buildFieldFilterRow(ctx, f!, build));

    const foot = document.createElement('button');
    foot.type = 'button';
    foot.className = 'bd-col-filter-foot';
    foot.innerHTML = FUNNEL_SVG + '<span>All filters…</span>';
    foot.addEventListener('click', () => {
      popover.close();
      ctx.openFilterPanel?.();
    });
    popover.el.appendChild(foot);
  }

  build();
  popover.open(anchor);
}
```

- [ ] **Step 4: Add the footer CSS**

In `src/webview/styles/board.css`, after the `.bd-filter-chip.bd-filter-empty.bd-filter-hollow` rule (~line 1863):

```css
.bd-col-filter-panel { min-width: 200px; max-width: 280px; }
.bd-col-filter-foot {
  display: flex; align-items: center; gap: 6px; width: 100%;
  margin-top: 8px; padding: 8px 2px 0;
  border: none; border-top: 1px solid var(--border-color, rgba(0,0,0,0.08));
  background: none; cursor: pointer;
  font-family: inherit; font-size: 12px; color: var(--accent, #2383e2);
}
.bd-col-filter-foot:hover { text-decoration: underline; }
.bd-col-filter-foot svg { width: 13px; height: 13px; flex: none; }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/boardColumnFilter.test.ts`
Expected: PASS (all three new `openColumnFilter` cases + the Task 2 cases).

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardFilterPanel.ts src/webview/styles/board.css tests/boardColumnFilter.test.ts
git commit -m "feat: scoped per-column mini-filter popover (openColumnFilter)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Column-menu Filter item, Sort flyout, and reorder

Wire the mini-filter into the column `⋯` menu, add the Phosphor Funnel + Sort icons, collapse the three sort items into a `Sort ›` submenu, and reorder into two sections.

**Files:**
- Modify: `src/webview/boardTableRender.ts` (`COL_MENU_ICONS` ~970-983 and `openColumnMenu` 985-1085)
- Test: manual (F5) — menu construction is declarative; covered by type-check + visual check.

**Interfaces:**
- Consumes: `openColumnFilter` from `boardFilterPanel.ts` (Task 4), existing `setViewSort`/`setViewGroup`/`setViewWidth`/`hideFieldInView`, `createMenu` sections + `submenu`.
- Produces: (no new exports)

- [ ] **Step 1: Import `openColumnFilter`**

In `src/webview/boardTableRender.ts`, add to the existing `boardFilterPanel`/`boardFilter` import area (the file already `import { applyFilter } from './boardFilter';`). Add:

```typescript
import { openColumnFilter } from './boardFilterPanel';
```

- [ ] **Step 2: Add the Funnel + Sort icons (Phosphor regular, 16px)**

In the `COL_MENU_ICONS` object, add two entries:

```typescript
  filter: `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M230.6,49.53A15.81,15.81,0,0,0,216,40H40A16,16,0,0,0,28.19,66.76l.08.09L96,139.17V216a16,16,0,0,0,24.87,13.3l32-21.34A16,16,0,0,0,160,194.66V139.17l67.74-72.32.08-.09A15.8,15.8,0,0,0,230.6,49.53ZM40,56h0Zm106.18,74.58A8,8,0,0,0,144,136v58.66L112,216V136a8,8,0,0,0-2.16-5.47L40,56H216Z"/></svg>`,
  sort: `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,181.66l-32,32a8,8,0,0,1-11.32,0l-32-32A8,8,0,0,1,144,168h24V96a8,8,0,0,1,16,0v72h24a8,8,0,0,1,5.66,13.66ZM82.34,42.34a8,8,0,0,0-11.32,0l-32,32A8,8,0,0,0,44,88H68v72a8,8,0,0,0,16,0V88h24a8,8,0,0,0,5.66-13.66Z"/></svg>`,
```

- [ ] **Step 3: Rewrite `openColumnMenu` body (sections + Sort submenu)**

Replace the entire `const items = [ ... ];` array and the final `createMenu(...).open(...)` call (lines ~992-1084) with two sections:

```typescript
  // Section 1 — "shape what you see": Filter (status/tags only), Group, Sort flyout.
  const viewItems = [
    ...(f.type === 'status' || f.type === 'tags' ? [{
      icon: COL_MENU_ICONS.filter,
      label: 'Filter',
      onSelect: () => { openColumnFilter(anchor, ctx, f.name); },
    }] : []),
    tableGroupBy === f.name
      ? {
          icon: COL_MENU_ICONS.group,
          label: 'Remove grouping',
          onSelect: () => {
            collapsedGroups.clear();
            const cur = ctx.getBoard();
            const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
            setViewGroup(b2, 'table', null);
            ctx.mutate(b2);
          },
        }
      : {
          icon: COL_MENU_ICONS.group,
          label: 'Group by this',
          onSelect: () => {
            collapsedGroups.clear();
            const cur = ctx.getBoard();
            const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
            setViewGroup(b2, 'table', f.name);
            ctx.mutate(b2);
          },
        },
    {
      icon: COL_MENU_ICONS.sort,
      label: 'Sort',
      submenu: () => [{ items: [
        {
          icon: COL_MENU_ICONS.sortAsc,
          label: 'Ascending',
          onSelect: () => {
            const cur = ctx.getBoard();
            const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
            setViewSort(b2, 'table', { field: f.name, dir: 'asc' });
            ctx.mutate(b2);
          },
        },
        {
          icon: COL_MENU_ICONS.sortDesc,
          label: 'Descending',
          onSelect: () => {
            const cur = ctx.getBoard();
            const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
            setViewSort(b2, 'table', { field: f.name, dir: 'desc' });
            ctx.mutate(b2);
          },
        },
        {
          icon: COL_MENU_ICONS.sortClear,
          label: 'Clear sort',
          onSelect: () => {
            const cur = ctx.getBoard();
            const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
            setViewSort(b2, 'table', null);
            ctx.mutate(b2);
          },
        },
      ] }],
    },
  ];

  // Section 2 — field / column management.
  const fieldItems = [
    {
      icon: COL_MENU_ICONS.rename,
      label: 'Rename',
      disabled: isLockedName,
      onSelect: () => {
        requestHeaderRename(f.name);
        ctx.mutate({ ...ctx.getBoard() });
      },
    },
    ...(f.type === 'status' || f.type === 'tags' ? [{
      icon: COL_MENU_ICONS.editOptions,
      label: 'Edit options',
      onSelect: () => {
        openStatusOptionsEditor(anchor, ctx.getBoard, f.name, ctx.mutate);
      },
    }] : []),
    {
      icon: COL_MENU_ICONS.resetWidth,
      label: 'Reset column width',
      onSelect: () => {
        const cur = ctx.getBoard();
        const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
        setViewWidth(b2, 'table', f.name, null);
        ctx.mutate(b2);
      },
    },
    {
      icon: COL_MENU_ICONS.hide,
      label: 'Hide column',
      onSelect: () => {
        const cur = ctx.getBoard();
        const b2: Board = { ...cur, views: cur.views.map(v2 => ({ ...v2 })) };
        hideFieldInView(b2, 'table', f.name);
        ctx.mutate(b2);
      },
    },
  ];

  createMenu({ className: 'bd-col-menu' }).open(anchor, [
    { items: viewItems },
    { items: fieldItems },
  ]);
```

- [ ] **Step 4: Type-check + run the full suite**

Run: `npx tsc -p tsconfig.json --noEmit && npx jest tests/boardFilter.test.ts tests/boardColumnFilter.test.ts`
Expected: No new type errors in `boardTableRender.ts`; filter tests PASS. (Ignore any pre-existing `toggle.ts` error from the working tree.)

- [ ] **Step 5: Manual verification (F5)**

Open the extension (F5), open a board (`demo-table.md`):
- The STATUS column `⋯` menu shows: **Filter · Group by this · Sort ›** — divider — **Rename · Edit options · Reset column width · Hide column**.
- **Filter** opens the mini-filter anchored to the header; toggling a chip hides rows AND updates the toolbar funnel's count badge.
- **Clear** in the mini-filter resets only that field; **All filters…** closes it and opens the toolbar funnel.
- **Sort ›** drills into Ascending / Descending / Clear sort.
- A text/ID column's menu has **no Filter** item and **no Edit options**.

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardTableRender.ts
git commit -m "feat: c39 column-menu Filter shortcut + Sort flyout + reorder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Docs (before any push/release)

Per project convention, update docs **before** pushing or bumping the version:

- [ ] **CHANGELOG.md** — add a c39 entry: "Column menu: per-column Filter shortcut (scoped mini-filter), Sort collapsed into a flyout, reordered menu."
- [ ] **README** — if it documents the board column menu, note the new Filter item.
- [ ] **TODO.md** — flip c39 row Status to Done (and update the stale screenshot note if desired).

---

## Self-Review

**Spec coverage:**
- Filter item, status/tags only → Task 5 (conditional) + Task 4.
- Scoped mini-filter (header + Clear + chips + All filters…) → Task 4.
- Shared chip rendering / one source of truth → Tasks 1 + 2.
- Same session FilterState, count stays in sync → Tasks 2 (setFilter) + 3 (funnel open).
- "All filters…" → full funnel, multi-board safe → Task 3 hook + Task 4 wiring.
- Menu reorder + Sort flyout → Task 5.
- Phosphor regular icons, matching weight → Task 5 Step 2 (Global Constraints).
- Tests for pure helpers + shared row → Tasks 1, 2, 4.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `toggleFilterValue` / `clearFilterField` / `onValues` / `allFieldValues` / `NONE_ON` defined in Task 1, consumed with identical signatures in Tasks 2 & 4. `buildFieldFilterRow(ctx, f, onChange)` defined in Task 2, consumed in Task 4. `FilterPill.open` / `ctx.openFilterPanel` defined in Task 3, consumed in Task 4. `openColumnFilter(anchor, ctx, fieldName)` defined in Task 4, consumed in Task 5. Consistent throughout.
