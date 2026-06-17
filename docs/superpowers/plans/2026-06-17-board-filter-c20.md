# Board Filter (c20) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-only "Filter" control to the board that shows/hides cards by status- and tag-field values, in both table and kanban views.

**Architecture:** A pure, DOM-free `applyFilter(cards, filter, board)` + a `FilterState` type (`src/webview/boardFilter.ts`). The board's webview owner (`boardBlock.ts`) holds the in-memory `FilterState` and exposes `getFilter`/`setFilter` on the renderer context; `setFilter` re-renders the body **without** serializing or saving (it is not a document change). Both renderers run `applyFilter` on the *display* card set only. A `Filter` pill in the board chrome (`boardFilterPanel.ts`) edits the state.

**Tech Stack:** TypeScript, Jest (ts-jest). No new dependencies. `boardFilter.ts` imports no DOM/vscode.

## Global Constraints

- `src/webview/boardFilter.ts` MUST NOT import the DOM or `vscode` — it is pure and unit-tested.
- The filter is **session-only**: never serialized into the markdown, never sent as an `edit`/`save`/`mutate`. Toggling it only re-renders.
- Filtering changes **visibility only**: never reorder cards, never alter card data. Operation/mutation card sets (drag-reorder, delete, add) MUST keep using the full `board.cards`; only *display* reads are filtered.
- Filterable fields = `field.type === 'status' || field.type === 'tags'`. Status values via `getStatusOptions(board, fieldName)`; tag values via `field.options`. A card's value is `card.values[fieldName]` (tags are comma-joined).
- Match rule: AND across active fields; OR within one field's values; tag field matches if any tag is in the set; the `EMPTY_VALUE` sentinel matches a card with no value for that field; an unknown field name in the state is ignored (does not hide anything); an empty `FilterState` shows all cards.
- Run all commands from the worktree root: `/Users/aviranrevach/AI Projects Aviran/MD viewer mscode/.claude/worktrees/feat+board-filter-c20` (`npx jest`/`npx tsc`/`node esbuild.config.js` resolve `node_modules` from the parent repo).
- Pre-existing failures unrelated to this work — do NOT fix, do NOT count as regressions: `tests/toggle.test.ts` (type-check) and `tests/board/grouping.test.ts` ("group band color").

---

## File Structure

- `src/webview/boardFilter.ts` — CREATE. Pure `applyFilter` + `FilterState` + `EMPTY_VALUE`.
- `tests/boardFilter.test.ts` — CREATE.
- `src/webview/boardBlock.ts` — MODIFY. Add `getFilter`/`setFilter` to `BoardRendererCtx`; own the in-memory state; add a `rerender()` (re-render without mutate).
- `src/webview/boardTableRender.ts` — MODIFY. Apply filter before sort/group (one line).
- `src/webview/boardKanbanRender.ts` — MODIFY. Apply filter to the two *display* reads only.
- `src/webview/boardFilterPanel.ts` — CREATE. The `Filter` pill + popover DOM.
- `src/webview/boardChrome.ts` — MODIFY. Mount the pill; refresh it on chrome update.
- `src/webview/styles/board.css` — MODIFY. Pill + panel styles.

---

### Task 1: Pure filter logic + tests

**Files:**
- Create: `src/webview/boardFilter.ts`
- Test: `tests/boardFilter.test.ts`

**Interfaces:**
- Produces:
  - `type FilterState = Record<string, string[]>` — fieldName → allowed values (`[]`/absent = inactive).
  - `const EMPTY_VALUE: string` — sentinel for "no value".
  - `applyFilter(cards: Card[], filter: FilterState, board: Board): Card[]` — visible subset, original order.

- [ ] **Step 1: Write the failing tests**

Create `tests/boardFilter.test.ts`:

```ts
import { applyFilter, EMPTY_VALUE, type FilterState } from '../src/webview/boardFilter';
import type { Board, Card, FieldDef } from '../src/webview/boardModel';

function field(name: string, type: FieldDef['type']): FieldDef {
  return { name, type, visibleOnCard: true };
}
function card(id: string, values: Record<string, string>): Card {
  return { id, values, body: '' };
}
function board(fields: FieldDef[], cards: Card[]): Board {
  return {
    id: 'b1', name: 'B', columns: [], fields, cards,
    orphanBodies: [], views: [], activeView: 'table',
  };
}

const FIELDS = [field('Status', 'status'), field('Impact', 'status'), field('Tags', 'tags')];
const CARDS = [
  card('c1', { Status: 'Todo',  Impact: 'High', Tags: 'ui,bug' }),
  card('c2', { Status: 'Doing', Impact: 'Low',  Tags: 'bug' }),
  card('c3', { Status: 'Todo',  Impact: '',      Tags: '' }),
];
const b = board(FIELDS, CARDS);

const ids = (cs: Card[]) => cs.map((c) => c.id);

describe('applyFilter', () => {
  it('returns all cards in order for an empty filter', () => {
    expect(ids(applyFilter(CARDS, {}, b))).toEqual(['c1', 'c2', 'c3']);
  });

  it('filters a status field to one value', () => {
    expect(ids(applyFilter(CARDS, { Status: ['Todo'] }, b))).toEqual(['c1', 'c3']);
  });

  it('ORs within a single field (two values)', () => {
    expect(ids(applyFilter(CARDS, { Status: ['Todo', 'Doing'] }, b))).toEqual(['c1', 'c2', 'c3']);
  });

  it('ANDs across two active fields', () => {
    expect(ids(applyFilter(CARDS, { Status: ['Todo'], Impact: ['High'] }, b))).toEqual(['c1']);
  });

  it('matches a tag field if any tag is in the set', () => {
    expect(ids(applyFilter(CARDS, { Tags: ['bug'] }, b))).toEqual(['c1', 'c2']);
  });

  it('matches EMPTY_VALUE for cards with no value (status)', () => {
    expect(ids(applyFilter(CARDS, { Impact: [EMPTY_VALUE] }, b))).toEqual(['c3']);
  });

  it('matches EMPTY_VALUE for cards with no tags', () => {
    expect(ids(applyFilter(CARDS, { Tags: [EMPTY_VALUE] }, b))).toEqual(['c3']);
  });

  it('ORs EMPTY_VALUE with a real value', () => {
    expect(ids(applyFilter(CARDS, { Impact: ['High', EMPTY_VALUE] }, b))).toEqual(['c1', 'c3']);
  });

  it('treats a field with an empty allowed list as inactive', () => {
    expect(ids(applyFilter(CARDS, { Status: [] }, b))).toEqual(['c1', 'c2', 'c3']);
  });

  it('ignores an unknown field name', () => {
    expect(ids(applyFilter(CARDS, { Nope: ['x'] }, b))).toEqual(['c1', 'c2', 'c3']);
  });

  it('preserves input order (visibility only)', () => {
    const reordered = [CARDS[2], CARDS[0], CARDS[1]];
    expect(ids(applyFilter(reordered, { Status: ['Todo', 'Doing'] }, b))).toEqual(['c3', 'c1', 'c2']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/boardFilter.test.ts`
Expected: FAIL — `Cannot find module '../src/webview/boardFilter'`.

- [ ] **Step 3: Implement `src/webview/boardFilter.ts`**

```ts
// Pure, session-only board filter. No DOM, no vscode — unit-testable.
//
// A FilterState maps a field name to the list of values allowed for that field.
// A card is shown iff it passes EVERY active field (AND across fields); it
// passes a field if its value is in that field's allowed set (OR within a
// field). Tag fields match if ANY of the card's tags is allowed. EMPTY_VALUE
// matches a card that has no value for the field. Filtering never reorders or
// mutates cards.

import type { Board, Card } from './boardModel';

// Sentinel for "no value" — distinct from any real status/tag name (a status
// literally named "__EMPTY__" colliding is treated as negligible).
export const EMPTY_VALUE = '__EMPTY__';

export type FilterState = Record<string, string[]>;

function splitTags(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export function applyFilter(cards: Card[], filter: FilterState, board: Board): Card[] {
  const active = Object.entries(filter).filter(([, vals]) => Array.isArray(vals) && vals.length > 0);
  if (active.length === 0) return cards;

  const typeByName = new Map(board.fields.map((f) => [f.name, f.type]));

  return cards.filter((card) =>
    active.every(([fieldName, allowed]) => {
      const type = typeByName.get(fieldName);
      if (type === undefined) return true; // unknown field → ignored
      if (type === 'tags') {
        const tags = splitTags(card.values[fieldName] ?? '');
        if (tags.length === 0) return allowed.includes(EMPTY_VALUE);
        return tags.some((t) => allowed.includes(t));
      }
      const val = (card.values[fieldName] ?? '').trim();
      if (val === '') return allowed.includes(EMPTY_VALUE);
      return allowed.includes(val);
    }),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/boardFilter.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardFilter.ts tests/boardFilter.test.ts
git commit -m "feat(board): pure session-only card filter (c20)"
```

---

### Task 2: Context plumbing + apply filter in both renderers

Wire the in-memory state and make both renderers filter their display sets. With the state starting empty, rendering is unchanged — this task is verified by the existing suite staying green and a manual "looks identical" check; the visible behavior arrives in Task 3.

**Files:**
- Modify: `src/webview/boardBlock.ts`
- Modify: `src/webview/boardTableRender.ts`
- Modify: `src/webview/boardKanbanRender.ts`

**Interfaces:**
- Consumes: `applyFilter`, `FilterState` from `./boardFilter` (Task 1).
- Produces (on `BoardRendererCtx`): `getFilter(): FilterState` and `setFilter(next: FilterState): void`. `setFilter` updates the state and re-renders the body + chrome **without** calling `mutate`/`onMutate`.

- [ ] **Step 1: Extend `BoardRendererCtx` in `src/webview/boardBlock.ts`**

Add the import near the other `./` imports:

```ts
import type { FilterState } from './boardFilter';
```

In the `export interface BoardRendererCtx { ... }` (starts at line 30), add these two members (e.g. right after `readonly`):

```ts
  /** Session-only display filter (never serialized). */
  getFilter: () => FilterState;
  /** Replace the filter and re-render the body + chrome (no save/mutate). */
  setFilter: (next: FilterState) => void;
```

- [ ] **Step 2: Own the state and add `rerender()` in `boardBlock.ts`**

Just after `let board = parseBoardSource(initialSource);` add:

```ts
  // Session-only filter — visibility only, never serialized. Lives here so a
  // change can re-render the body without going through mutate()/save.
  let filter: FilterState = {};
```

Add a `rerender` function declaration near `mutate` (function declarations hoist, so placement is flexible — put it right after the `mutate` function):

```ts
  // Re-render the body + chrome WITHOUT serializing or saving. Used by the
  // filter, which is view state, not document state.
  function rerender(): void {
    renderer?.update(board);
    chromeHandle.update(board);
  }
```

In the `const ctx: BoardRendererCtx = { ... }` literal, add the two members (e.g. after `readonly: opts.isReadOnly(),`):

```ts
    getFilter: () => filter,
    setFilter: (next: FilterState) => {
      filter = next;
      rerender();
    },
```

(`renderer` and `chromeHandle` are assigned later in the same scope; `rerender` only runs at runtime after both exist — the same late-binding the existing `closeOpenMenu`/`renderer!` code relies on.)

- [ ] **Step 3: Apply filter in the table renderer**

In `src/webview/boardTableRender.ts`, add the import near the other `./` imports:

```ts
import { applyFilter } from './boardFilter';
```

Find this line (≈ line 448, inside `mountTable`'s render):

```ts
    const sortedCards = applySort(b.cards, v, b);
```

Replace with:

```ts
    const sortedCards = applySort(applyFilter(b.cards, ctx.getFilter(), b), v, b);
```

Do NOT change any other `b.cards` / `cur.cards` usage (row drag, drop-target lookup, mutations stay on the full set).

- [ ] **Step 4: Apply filter to the kanban DISPLAY reads only**

In `src/webview/boardKanbanRender.ts`, add the import near the other `./` imports:

```ts
import { applyFilter } from './boardFilter';
```

In `renderColumns` (≈ line 49), find:

```ts
  const orphans = board.cards.filter((c) => !validNames.has(c.values.Status || ''));
```

Replace with:

```ts
  const visible = applyFilter(board.cards, ctx.getFilter(), board);
  const orphans = visible.filter((c) => !validNames.has(c.values.Status || ''));
```

In `renderColumn` (≈ line 130), find:

```ts
  const cards = board.cards.filter((c) => (c.values.Status || '') === col.name);
```

Replace with:

```ts
  const visible = applyFilter(board.cards, ctx.getFilter(), board);
  const cards = visible.filter((c) => (c.values.Status || '') === col.name);
```

Do NOT change the other `board.cards` usages (drag at ~307/~521, add at ~376, delete/move at ~842/~855, etc.) — those are operations and must see every card.

- [ ] **Step 5: Type-check and build**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "toggle.ts"`
Expected: no output.

Run: `node esbuild.config.js`
Expected: `Webview built.`

- [ ] **Step 6: Run the suite — no new failures**

Run: `npx jest 2>&1 | tail -6`
Expected: only the two pre-existing failures (`tests/toggle.test.ts`, `tests/board/grouping.test.ts`); `boardFilter` (11) passes.

- [ ] **Step 7: Commit**

```bash
git add src/webview/boardBlock.ts src/webview/boardTableRender.ts src/webview/boardKanbanRender.ts
git commit -m "feat(board): plumb session filter through ctx + both renderers (c20)"
```

---

### Task 3: The Filter pill + popover

**Files:**
- Create: `src/webview/boardFilterPanel.ts`
- Modify: `src/webview/boardChrome.ts`
- Modify: `src/webview/styles/board.css`

**Interfaces:**
- Consumes: `BoardRendererCtx` (`getBoard`/`getFilter`/`setFilter`), `applyFilter`/`EMPTY_VALUE`/`FilterState` from `./boardFilter`, `getStatusOptions` + `Board`/`ColumnDef` from `./boardModel`.
- Produces: `createFilterPill(ctx: BoardRendererCtx): { el: HTMLElement; refresh: () => void }`.

- [ ] **Step 1: Create `src/webview/boardFilterPanel.ts`**

```ts
// The board "Filter" pill + popover. Edits the session-only FilterState that
// boardBlock owns via ctx.getFilter()/ctx.setFilter(). Visibility only; the
// renderers do the actual hiding. Hidden entirely when the board has no
// status/tag fields to filter on.

import type { BoardRendererCtx } from './boardBlock';
import type { Board, ColumnDef } from './boardModel';
import { getStatusOptions } from './boardModel';
import { applyFilter, EMPTY_VALUE } from './boardFilter';

interface FilterableField { name: string; values: ColumnDef[]; }

function filterableFields(board: Board): FilterableField[] {
  const out: FilterableField[] = [];
  for (const f of board.fields) {
    if (f.type === 'status') out.push({ name: f.name, values: getStatusOptions(board, f.name) });
    else if (f.type === 'tags') out.push({ name: f.name, values: f.options ?? [] });
  }
  return out;
}

export interface FilterPill { el: HTMLElement; refresh: () => void; }

export function createFilterPill(ctx: BoardRendererCtx): FilterPill {
  const wrap = document.createElement('div');
  wrap.className = 'bd-filter';

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'bd-filter-pill';
  pill.setAttribute('aria-haspopup', 'true');
  pill.title = 'Filter cards by status or tag';
  wrap.appendChild(pill);

  const panel = document.createElement('div');
  panel.className = 'bd-filter-panel bd-hidden';
  panel.setAttribute('role', 'dialog');
  wrap.appendChild(panel);

  let outsideHandler: ((e: MouseEvent) => void) | null = null;

  function closePanel(): void {
    panel.classList.add('bd-hidden');
    pill.classList.remove('is-open');
    if (outsideHandler) {
      document.removeEventListener('mousedown', outsideHandler, true);
      outsideHandler = null;
    }
  }

  function openPanel(): void {
    buildPanel();
    panel.classList.remove('bd-hidden');
    pill.classList.add('is-open');
    outsideHandler = (e: MouseEvent) => {
      if (!wrap.contains(e.target as Node)) closePanel();
    };
    // Capture phase so opening this pill also closes any other open popover
    // (their own outside-mousedown listeners fire and dismiss them).
    document.addEventListener('mousedown', outsideHandler, true);
  }

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.classList.contains('bd-hidden')) openPanel();
    else closePanel();
  });

  function setFieldValue(field: string, value: string, on: boolean): void {
    const cur: Record<string, string[]> = { ...ctx.getFilter() };
    const set = new Set(cur[field] ?? []);
    if (on) set.add(value);
    else set.delete(value);
    if (set.size === 0) delete cur[field];
    else cur[field] = [...set];
    ctx.setFilter(cur); // re-renders body + calls refresh() (pill label)
    buildPanel();       // rebuild chips to reflect the new selection
  }

  function buildPanel(): void {
    panel.innerHTML = '';
    const board = ctx.getBoard();
    const filter = ctx.getFilter();

    const head = document.createElement('div');
    head.className = 'bd-filter-head';
    const title = document.createElement('span');
    title.className = 'bd-filter-title';
    title.textContent = 'Filter';
    head.appendChild(title);
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'bd-filter-clear';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      ctx.setFilter({});
      buildPanel();
    });
    head.appendChild(clear);
    panel.appendChild(head);

    for (const f of filterableFields(board)) {
      const sel = new Set(filter[f.name] ?? []);
      const row = document.createElement('div');
      row.className = 'bd-filter-field';

      const label = document.createElement('div');
      label.className = 'bd-filter-field-label';
      label.textContent = f.name;
      row.appendChild(label);

      const chips = document.createElement('div');
      chips.className = 'bd-filter-chips';

      const mkChip = (value: string, display: string, token: string): void => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `bd-opt-pchip color-${token}` + (sel.has(value) ? ' is-selected' : '');
        chip.textContent = display;
        chip.addEventListener('click', () => setFieldValue(f.name, value, !sel.has(value)));
        chips.appendChild(chip);
      };

      for (const opt of f.values) mkChip(opt.name, opt.name, opt.color);
      mkChip(EMPTY_VALUE, '(Empty)', 'gray');

      row.appendChild(chips);
      panel.appendChild(row);
    }
  }

  function refresh(): void {
    const board = ctx.getBoard();
    if (filterableFields(board).length === 0) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';

    const filter = ctx.getFilter();
    const activeN = Object.values(filter).filter((v) => Array.isArray(v) && v.length > 0).length;
    if (activeN === 0) {
      pill.classList.remove('is-active');
      pill.textContent = 'Filter';
    } else {
      pill.classList.add('is-active');
      const hidden = board.cards.length - applyFilter(board.cards, filter, board).length;
      pill.textContent = hidden > 0 ? `Filter · ${activeN} · ${hidden} hidden` : `Filter · ${activeN}`;
    }
  }

  refresh();
  return { el: wrap, refresh };
}
```

- [ ] **Step 2: Mount the pill in `src/webview/boardChrome.ts`**

Add the import near the top (after the existing `./` imports):

```ts
import { createFilterPill, type FilterPill } from './boardFilterPanel';
```

In `renderChrome`, immediately after `chrome.appendChild(name);` (≈ line 55) add:

```ts
  // Filter pill — view-only control, shown for readonly boards too. Hidden by
  // its own refresh() when the board has no status/tag fields.
  const filterPill: FilterPill = createFilterPill(ctx);
  chrome.appendChild(filterPill.el);
```

In the `function update(nextBoard: Board): void { ... }` body (after `refreshViewSeg?.();` / before the closing brace), add:

```ts
    filterPill.refresh();
```

- [ ] **Step 3: Add styles to `src/webview/styles/board.css`**

Append at the end of the file:

```css
/* ---- Board filter pill + popover (c20) ---- */
.bd-filter { position: relative; display: inline-flex; }

.bd-filter-pill {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.12));
  border-radius: 13px;
  background: transparent;
  color: var(--text-secondary, #6b6b6b);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
}
.bd-filter-pill:hover { background: var(--toolbar-btn-hover, var(--block-hover)); color: var(--text-primary); }
.bd-filter-pill.is-active {
  background: var(--accent-soft, rgba(35,131,226,0.12));
  border-color: var(--accent, #2383e2);
  color: var(--accent, #2383e2);
}
.bd-filter-pill.is-open { background: var(--toolbar-btn-hover, var(--block-hover)); }

.bd-filter-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  min-width: 240px;
  max-width: 320px;
  padding: 8px;
  background: var(--menu-bg, #fff);
  border: 1px solid var(--border-color, rgba(0,0,0,0.12));
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.18);
}

.bd-filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 8px;
}
.bd-filter-title { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.bd-filter-clear {
  border: none; background: none; cursor: pointer;
  font-size: 12px; color: var(--accent, #2383e2); padding: 0;
}
.bd-filter-clear:hover { text-decoration: underline; }

.bd-filter-field { padding: 6px 4px; }
.bd-filter-field-label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--text-secondary, #8a8a8a); margin-bottom: 6px;
}
.bd-filter-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.bd-filter-chips .bd-opt-pchip { cursor: pointer; opacity: 0.55; }
.bd-filter-chips .bd-opt-pchip.is-selected { opacity: 1; }
```

(`.bd-hidden`, `.bd-opt-pchip`, and `color-<token>` are already defined and styled elsewhere in `board.css` — reused here.)

- [ ] **Step 4: Type-check and build**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "toggle.ts"`
Expected: no output.

Run: `node esbuild.config.js`
Expected: `Webview built.`

- [ ] **Step 5: Confirm bundled**

Run: `grep -c "bd-filter-pill" dist/webview.js`
Expected: non-zero.

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardFilterPanel.ts src/webview/boardChrome.ts src/webview/styles/board.css
git commit -m "feat(board): Filter pill + popover in chrome (c20)"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite — no new failures**

Run: `npx jest 2>&1 | tail -6`
Expected: only the two pre-existing failures (`tests/toggle.test.ts`, `tests/board/grouping.test.ts`); `boardFilter` (11) passes.

- [ ] **Step 2: Type-check clean**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "toggle.ts" | head`
Expected: no output.

- [ ] **Step 3: Bundle present**

Run: `grep -c "bd-filter-pill\|applyFilter" dist/webview.js`
Expected: non-zero.

- [ ] **Step 4: Manual smoke test (document for the human)**

In the Extension Development Host, open a markdown file with a board:
1. **Table view** — click the `Filter` pill, pick `Status = Todo`. Only Todo rows show; pill reads `Filter · 1 · N hidden`. Add `Impact = High` → AND narrows further. Click `Clear` → all rows return.
2. **Kanban view** — switch views; the same filter still applies (cards hidden across columns). Drag a visible card to another column → it moves correctly and no hidden card is lost (the move only touches the dragged card).
3. **(Empty)** — select `Impact = (Empty)` → only cards with no Impact show.
4. **No status/tag fields** — on a board with only text fields, the pill is absent.
5. **Reopen** — close and reopen the file → filter is cleared (session-only); the markdown on disk is unchanged (no diff).

---

## Notes for the implementer

- `boardFilter.ts` must not import the DOM or `vscode` (its tests rely on that).
- Never serialize the filter or send it as an edit/save/mutate. `setFilter` → `rerender()` only.
- In kanban, only the two *display* reads (orphans in `renderColumns`, `cards` in `renderColumn`) get `applyFilter`. Every mutation/operation path keeps the full `board.cards` — getting this wrong silently drops cards on drag/delete.
- The pill is shown for readonly boards too (filtering is view-only and harmless); its `refresh()` hides it when there are no status/tag fields.
