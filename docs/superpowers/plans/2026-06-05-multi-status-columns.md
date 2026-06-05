# Multiple Status Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every status column own its own option set (states), fix clicks/side-panel that wrote to a hardcoded `Status` field, expand the color palette 6→10, and add an "Edit options" editor reachable from the new-column popover, the column-header ⋯, and the properties-panel ⋯.

**Architecture:** Add `options?: ColumnDef[]` to `FieldDef`. The built-in **Status** field keeps storing its options in board-level `board.columns` (no on-disk change, Kanban untouched); additional status fields store options in `FieldDef.options`. A small set of model helpers (`getStatusOptions`/`setStatusOptions`/`renameStatusOption`/`deleteStatusOption`/`addStatusOption`) hide the branch so no UI caller special-cases "Status". A new `board:start` attribute `field-options` round-trips the per-field options. A single reusable options-editor component (`boardStatusOptions.ts`) is wired into all three entry points.

**Tech Stack:** TypeScript, Jest + ts-jest (`testEnvironment: node`; DOM tests opt in via `@jest-environment jsdom`), plain DOM (no framework) in the webview.

**Spec:** [docs/superpowers/specs/2026-06-05-multi-status-columns-design.md](../specs/2026-06-05-multi-status-columns-design.md)

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/webview/boardModel.ts` | Modify | `ColorToken` (+4 tokens), `COLOR_TOKENS`, `FieldDef.options`, status-option helpers, `field-options` parse/serialize |
| `src/webview/styles/board.css` | Modify | Chip/column CSS classes for the 4 new color tokens |
| `src/webview/boardStatusOptions.ts` | Create | Reusable options-editor popover (`openStatusOptionsEditor`) + core list builder (`buildOptionsEditor`) |
| `src/webview/boardTableRender.ts` | Modify | Status cell + dropdown keyed to the actual field; "Edit options" in column-header ⋯ |
| `src/webview/boardSidePanel.ts` | Modify | Status trigger + dropdown keyed to the actual field |
| `src/webview/boardProperties.ts` | Modify | "Edit options" item in field action menu; inline States in new-column popover |
| `src/webview/boardKanbanRender.ts` | Modify | "Edit options" item in the Kanban column menu |
| `tests/board/options-model.test.ts` | Create | Unit tests for helpers + `field-options` round-trip |
| `tests/board/options-editor.test.ts` | Create | jsdom tests for the editor component |
| `tests/board/table.test.ts` | Modify | jsdom tests: second status field targets its own field |

Run all tests with: `npm test`. Run one file with: `npx jest tests/board/options-model.test.ts`.

> **Pre-existing failure note:** `tests/toggle.test.ts` fails on a pre-existing toggle.ts type-check error unrelated to this work. A non-zero `npm test` caused only by that suite is expected; verify your new/edited suites pass individually.

---

## Task 1: Expand the color palette to 10 tokens

**Files:**
- Modify: `src/webview/boardModel.ts:1-2` (`ColorToken`), `src/webview/boardModel.ts:61-62` (`COLOR_TOKENS`)
- Modify: `src/webview/styles/board.css`
- Test: `tests/board/options-model.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/board/options-model.test.ts`:

```ts
import { parseBoardSource, serializeBoard } from '../../src/webview/boardModel';

describe('10-color palette', () => {
  it('parses and preserves a new color token (teal) on a column', () => {
    const src = `<!-- board:start id="b1" columns="A|B" column-colors="teal|indigo" field-types="Title=text,Status=status" -->\n\n<!-- board:end -->`;
    const board = parseBoardSource(src);
    expect(board.columns).toEqual([
      { name: 'A', color: 'teal' },
      { name: 'B', color: 'indigo' },
    ]);
    // round-trips
    expect(serializeBoard(board)).toContain('column-colors="teal|indigo"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/board/options-model.test.ts -t "new color token"`
Expected: FAIL — `teal`/`indigo` are not valid tokens, so they fall back to `autoColor` and the `toEqual` fails.

- [ ] **Step 3: Implement the palette expansion**

In `src/webview/boardModel.ts` replace lines 1-2:

```ts
export type ColorToken =
  | 'gray' | 'blue' | 'amber' | 'emerald' | 'red' | 'purple'
  | 'orange' | 'teal' | 'indigo' | 'pink';
```

Replace lines 61-62:

```ts
const COLOR_TOKENS: ColorToken[] =
  ['gray', 'blue', 'amber', 'emerald', 'red', 'purple', 'orange', 'teal', 'indigo', 'pink'];
```

- [ ] **Step 4: Add CSS for the four new tokens**

In `src/webview/styles/board.css`, find the existing `color-purple` chip/column rules and add equivalents for the new tokens directly below them. Match the existing pattern exactly (same selectors that `color-purple` uses — e.g. `.board-column-chip.color-orange`, `.board-column.color-orange`, `.board-color-swatch.color-orange`, etc.). Use these values:

```css
/* --- added: 4 new palette tokens (orange, teal, indigo, pink) --- */
.color-orange { --chip-bg: #fcebe0; --chip-fg: #bc5a26; --dot: #e8743b; }
.color-teal   { --chip-bg: #dcf2f0; --chip-fg: #147a76; --dot: #16a6a0; }
.color-indigo { --chip-bg: #e7e7fb; --chip-fg: #4242a8; --dot: #5b5bd6; }
.color-pink   { --chip-bg: #fbe6f1; --chip-fg: #b23380; --dot: #d6499b; }
```

> If the existing tokens do NOT use CSS variables (`--chip-bg` etc.) but instead set `background`/`color`/swatch backgrounds directly per selector, mirror that exact structure for each new token instead of the variable block above. Inspect the `color-purple` rules first and copy their shape.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/board/options-model.test.ts -t "new color token"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardModel.ts src/webview/styles/board.css tests/board/options-model.test.ts
git commit -m "feat(board): expand status color palette 6 -> 10 tokens

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add `FieldDef.options` and the status-option accessors

**Files:**
- Modify: `src/webview/boardModel.ts:6-10` (`FieldDef`)
- Modify: `src/webview/boardModel.ts` (add helpers near the interfaces)
- Test: `tests/board/options-model.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/board/options-model.test.ts`:

```ts
import {
  getStatusOptions, setStatusOptions,
} from '../../src/webview/boardModel';
import type { Board } from '../../src/webview/boardModel';

function makeBoard(): Board {
  return {
    id: 'b1', name: '',
    columns: [{ name: 'Todo', color: 'blue' }, { name: 'Done', color: 'emerald' }],
    fields: [
      { name: 'Title',  type: 'text',   visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Impact', type: 'status', visibleOnCard: true, options: [{ name: 'Low', color: 'gray' }] },
    ],
    cards: [{ id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo', Impact: 'Low' }, body: '' }],
    orphanBodies: [], views: [], activeView: 'kanban',
  };
}

describe('status-option accessors', () => {
  it('getStatusOptions returns board.columns for the built-in Status field', () => {
    expect(getStatusOptions(makeBoard(), 'Status')).toEqual([
      { name: 'Todo', color: 'blue' }, { name: 'Done', color: 'emerald' },
    ]);
  });
  it('getStatusOptions returns field.options for additional status fields', () => {
    expect(getStatusOptions(makeBoard(), 'Impact')).toEqual([{ name: 'Low', color: 'gray' }]);
  });
  it('getStatusOptions returns [] for a status field with no options', () => {
    const b = makeBoard();
    b.fields.push({ name: 'Risk', type: 'status', visibleOnCard: true });
    expect(getStatusOptions(b, 'Risk')).toEqual([]);
  });
  it('setStatusOptions writes board.columns for Status, immutably', () => {
    const b = makeBoard();
    const next = setStatusOptions(b, 'Status', [{ name: 'X', color: 'red' }]);
    expect(next.columns).toEqual([{ name: 'X', color: 'red' }]);
    expect(b.columns).toHaveLength(2); // original untouched
  });
  it('setStatusOptions writes field.options for additional status fields, immutably', () => {
    const b = makeBoard();
    const next = setStatusOptions(b, 'Impact', [{ name: 'High', color: 'red' }]);
    expect(next.fields.find(f => f.name === 'Impact')!.options).toEqual([{ name: 'High', color: 'red' }]);
    expect(b.fields.find(f => f.name === 'Impact')!.options).toEqual([{ name: 'Low', color: 'gray' }]);
  });
}); 
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/board/options-model.test.ts -t "status-option accessors"`
Expected: FAIL — `getStatusOptions`/`setStatusOptions` are not exported.

- [ ] **Step 3: Implement the interface change and helpers**

In `src/webview/boardModel.ts` replace lines 6-10 (`FieldDef`):

```ts
export interface FieldDef {
  name: string;
  type: FieldType;
  visibleOnCard: boolean;
  options?: ColumnDef[];   // states for status fields other than the built-in "Status"
}
```

Add these helpers immediately after the `Board` interface (after line 44):

```ts
/** Read the option list (states) for any status field. */
export function getStatusOptions(board: Board, fieldName: string): ColumnDef[] {
  if (fieldName === 'Status') return board.columns;
  return board.fields.find((f) => f.name === fieldName)?.options ?? [];
}

/** Return a new Board with the option list for a status field replaced. */
export function setStatusOptions(board: Board, fieldName: string, options: ColumnDef[]): Board {
  if (fieldName === 'Status') {
    return { ...board, columns: options };
  }
  return {
    ...board,
    fields: board.fields.map((f) => (f.name === fieldName ? { ...f, options } : f)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/board/options-model.test.ts -t "status-option accessors"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts tests/board/options-model.test.ts
git commit -m "feat(board): per-field status options + get/set accessors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Rename / delete / add status-option mutation helpers

These migrate card values, so they live in the model and are unit-tested.

**Files:**
- Modify: `src/webview/boardModel.ts` (add helpers after `setStatusOptions`)
- Test: `tests/board/options-model.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/board/options-model.test.ts`:

```ts
import {
  renameStatusOption, deleteStatusOption, addStatusOption,
} from '../../src/webview/boardModel';

describe('status-option mutations migrate card values', () => {
  it('renameStatusOption renames the option and updates cards holding it (Status)', () => {
    const next = renameStatusOption(makeBoard(), 'Status', 'Todo', 'Backlog');
    expect(next.columns[0]).toEqual({ name: 'Backlog', color: 'blue' });
    expect(next.cards[0].values.Status).toBe('Backlog');
  });
  it('renameStatusOption works on an additional field and leaves other fields alone', () => {
    const next = renameStatusOption(makeBoard(), 'Impact', 'Low', 'Minor');
    expect(next.fields.find(f => f.name === 'Impact')!.options).toEqual([{ name: 'Minor', color: 'gray' }]);
    expect(next.cards[0].values.Impact).toBe('Minor');
    expect(next.cards[0].values.Status).toBe('Todo');
  });
  it('deleteStatusOption removes the option and clears matching card values', () => {
    const next = deleteStatusOption(makeBoard(), 'Impact', 'Low');
    expect(next.fields.find(f => f.name === 'Impact')!.options).toEqual([]);
    expect(next.cards[0].values.Impact).toBe('');
  });
  it('addStatusOption appends an option with a distinct color', () => {
    const next = addStatusOption(makeBoard(), 'Impact', 'High');
    const opts = next.fields.find(f => f.name === 'Impact')!.options!;
    expect(opts.map(o => o.name)).toEqual(['Low', 'High']);
    expect(opts[1].color).not.toBe(opts[0].color);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/board/options-model.test.ts -t "migrate card values"`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement the mutation helpers**

Add after `setStatusOptions` in `src/webview/boardModel.ts`:

```ts
/** Rename a status option and migrate every card value holding the old name. */
export function renameStatusOption(
  board: Board, fieldName: string, oldName: string, newName: string,
): Board {
  const opts = getStatusOptions(board, fieldName).map(
    (o) => (o.name === oldName ? { ...o, name: newName } : o),
  );
  const b = setStatusOptions(board, fieldName, opts);
  return {
    ...b,
    cards: b.cards.map((c) =>
      c.values[fieldName] === oldName
        ? { ...c, values: { ...c.values, [fieldName]: newName } }
        : c,
    ),
  };
}

/** Delete a status option and clear it from any card that held it. */
export function deleteStatusOption(board: Board, fieldName: string, name: string): Board {
  const opts = getStatusOptions(board, fieldName).filter((o) => o.name !== name);
  const b = setStatusOptions(board, fieldName, opts);
  return {
    ...b,
    cards: b.cards.map((c) =>
      c.values[fieldName] === name
        ? { ...c, values: { ...c.values, [fieldName]: '' } }
        : c,
    ),
  };
}

/** Append a status option, auto-picking a color not already used. */
export function addStatusOption(board: Board, fieldName: string, name: string): Board {
  const opts = getStatusOptions(board, fieldName);
  const used = opts.map((o) => o.color);
  const color = COLOR_TOKENS.find((t) => !used.includes(t)) ?? autoColor(name);
  return setStatusOptions(board, fieldName, [...opts, { name, color }]);
}

/** Change the color of one status option. */
export function recolorStatusOption(
  board: Board, fieldName: string, name: string, color: ColorToken,
): Board {
  const opts = getStatusOptions(board, fieldName).map(
    (o) => (o.name === name ? { ...o, color } : o),
  );
  return setStatusOptions(board, fieldName, opts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/board/options-model.test.ts -t "migrate card values"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts tests/board/options-model.test.ts
git commit -m "feat(board): rename/delete/add/recolor status-option helpers w/ card migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Serialize + parse the `field-options` attribute

**Files:**
- Modify: `src/webview/boardModel.ts` — `parseBoardSource` (after fields are built, ~line 214) and `serializeStartMarker` (~line 285-304)
- Test: `tests/board/options-model.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/board/options-model.test.ts`:

```ts
describe('field-options round-trip', () => {
  const src = [
    `<!-- board:start id="b1" columns="Todo|Done" column-colors="blue|emerald" field-types="Title=text,Status=status,Impact=status,Risk Level=status" field-options="Impact=Low:gray|High:red;Risk Level=R1:orange|R2:teal" -->`,
    ``,
    `| Title | Status | Impact | Risk Level |`,
    `|---|---|---|---|`,
    `| A | Todo | Low | R1 |`,
    ``,
    `<!-- board:end -->`,
  ].join('\n');

  it('parses per-field options, including a field name with a space and new color tokens', () => {
    const b = parseBoardSource(src);
    expect(b.fields.find(f => f.name === 'Impact')!.options).toEqual([
      { name: 'Low', color: 'gray' }, { name: 'High', color: 'red' },
    ]);
    expect(b.fields.find(f => f.name === 'Risk Level')!.options).toEqual([
      { name: 'R1', color: 'orange' }, { name: 'R2', color: 'teal' },
    ]);
    // The built-in Status field never carries `options`.
    expect(b.fields.find(f => f.name === 'Status')!.options).toBeUndefined();
  });

  it('serialize -> parse is stable (deep-equal)', () => {
    const a = parseBoardSource(src);
    const round = parseBoardSource(serializeBoard(a));
    expect(round).toEqual(a);
  });

  it('a board with no additional status fields emits no field-options attribute', () => {
    const plain = `<!-- board:start id="b1" columns="Todo" column-colors="blue" field-types="Title=text,Status=status" -->\n\n| Title | Status |\n|---|---|\n\n<!-- board:end -->`;
    const out = serializeBoard(parseBoardSource(plain));
    expect(out).not.toContain('field-options');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/board/options-model.test.ts -t "field-options round-trip"`
Expected: FAIL — `options` is `undefined` for Impact/Risk Level (parse doesn't read `field-options` yet).

- [ ] **Step 3: Implement parsing**

Add this helper near `parseFieldTypes` in `src/webview/boardModel.ts` (after line 174):

```ts
function parseFieldOptions(raw: string): Map<string, ColumnDef[]> {
  const out = new Map<string, ColumnDef[]>();
  if (!raw) return out;
  for (const chunk of raw.split(';')) {
    const eq = chunk.indexOf('=');
    if (eq < 0) continue;
    const fieldName = chunk.slice(0, eq).trim();
    if (!fieldName) continue;
    const opts: ColumnDef[] = [];
    for (const optChunk of chunk.slice(eq + 1).split('|')) {
      if (!optChunk) continue;
      const colon = optChunk.lastIndexOf(':');
      const name = (colon >= 0 ? optChunk.slice(0, colon) : optChunk).trim();
      const tok = colon >= 0 ? optChunk.slice(colon + 1).trim() : '';
      if (!name) continue;
      const color = COLOR_TOKENS.includes(tok as ColorToken)
        ? (tok as ColorToken)
        : autoColor(name);
      opts.push({ name, color });
    }
    out.set(fieldName, opts);
  }
  return out;
}
```

In `parseBoardSource`, after the `fields` array is fully built (immediately before the `const innerStart = ...` line, ~line 215), add:

```ts
  const fieldOptions = parseFieldOptions(attrs['field-options'] ?? '');
  for (const f of fields) {
    if (f.type === 'status' && f.name !== 'Status') {
      const opts = fieldOptions.get(f.name);
      if (opts) f.options = opts;
    }
  }
```

- [ ] **Step 4: Implement serialization**

In `serializeStartMarker` (`src/webview/boardModel.ts`), after the `fieldTypes` line (~line 289) add:

```ts
  const fieldOptionsParts: string[] = [];
  for (const f of board.fields) {
    if (f.type === 'status' && f.name !== 'Status' && f.options && f.options.length) {
      const opts = f.options.map((o) => `${o.name}:${o.color}`).join('|');
      fieldOptionsParts.push(`${f.name}=${opts}`);
    }
  }
```

Then, inside the same function where other attrs are pushed (after the `field-types` push at ~line 297), add:

```ts
  if (fieldOptionsParts.length) {
    attrs.push(`field-options="${fieldOptionsParts.join(';')}"`);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/board/options-model.test.ts -t "field-options round-trip"`
Expected: PASS

- [ ] **Step 6: Run the full existing board suite for regressions**

Run: `npx jest tests/board`
Expected: PASS for all board suites (parse, serialize, roundtrip, table, ops, etc.). The new `options` key is optional and only attached to additional status fields, so existing fixtures are unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/webview/boardModel.ts tests/board/options-model.test.ts
git commit -m "feat(board): round-trip per-field status options via field-options attr

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Status cell + dropdown target the actual field (table view)

**Files:**
- Modify: `src/webview/boardTableRender.ts:933-949` (status case), `src/webview/boardTableRender.ts:1080-1125` (`openStatusDropdown`)
- Test: `tests/board/table.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/board/table.test.ts` inside the `status chip + dropdown` describe block (after the existing "clicking a column option mutates Status" test). First, extend `makeBoard` usage with a second status field by passing overrides in the test itself:

```ts
it('a second status field renders its own options and writes its own value', () => {
  const board = makeBoard({
    fields: [
      { name: 'Title',  type: 'text',   visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Impact', type: 'status', visibleOnCard: true,
        options: [{ name: 'Low', color: 'gray' }, { name: 'High', color: 'red' }] },
    ],
    cards: [
      { id: 'c1', values: { id: 'c1', Title: 'Alpha', Status: 'Todo', Impact: 'Low' }, body: '' },
    ],
  });
  const { ctx, boardRef } = makeCtx(board);
  const ops = mountTable(ctx);

  const impactCell = ctx.root.querySelector(
    'td.bd-table-cell[data-field="Impact"]',
  ) as HTMLElement;
  expect(impactCell).not.toBeNull();
  impactCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  const dropdown = document.querySelector('.board-status-dropdown')!;
  const options = dropdown.querySelectorAll('.board-status-option');
  // Impact has its own 2 options (Low/High), NOT the board's Status columns.
  expect(options).toHaveLength(2);

  (options[1] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(boardRef.current.cards[0].values.Impact).toBe('High');
  expect(boardRef.current.cards[0].values.Status).toBe('Todo'); // untouched

  ops.destroy();
});
```

> If `makeCtx`/`mountTable` are not already imported/defined at that point in the file, reuse the file's existing `makeBoard`/`makeCtx` helpers (defined at the top of `table.test.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/board/table.test.ts -t "second status field"`
Expected: FAIL — the dropdown renders `board.columns` (2 Status columns) and the click writes `Status`, so `Impact` stays `Low` and `options.length` may mismatch.

- [ ] **Step 3: Update the status cell render**

In `src/webview/boardTableRender.ts`, add the import for the helper at the top with the other `boardModel` imports:

```ts
import { getStatusOptions } from './boardModel';
```

Replace the `status` case body (lines 933-949) with:

```ts
    case 'status': {
      const opts = getStatusOptions(ctx.getBoard(), field.name);
      const colDef = opts.find((c) => c.name === value);
      if (value) {
        td.appendChild(buildChip(value, colDef?.color ?? 'gray'));
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'bd-cell-empty';
        placeholder.textContent = '—';
        td.appendChild(placeholder);
      }
      if (!ctx.readonly) {
        td.addEventListener('click', (e) => {
          e.stopPropagation();
          openStatusDropdown(td, card, field, ctx);
        });
      }
      return;
    }
```

- [ ] **Step 4: Update `openStatusDropdown` to take the field**

Replace the signature and body of `openStatusDropdown` (lines 1080-1125). Change the signature to:

```ts
function openStatusDropdown(anchor: HTMLElement, card: Card, field: FieldDef, ctx: BoardRendererCtx): void {
```

Inside, replace the `for (const col of ctx.getBoard().columns) {` loop header with:

```ts
  for (const col of getStatusOptions(ctx.getBoard(), field.name)) {
```

And replace the mutate block that hardcodes `Status` (the `c.id === card.id ? { ...c, values: { ...c.values, Status: col.name } }` part) with:

```ts
      ctx.mutate({
        ...cur,
        cards: cur.cards.map((c) =>
          c.id === card.id
            ? { ...c, values: { ...c.values, [field.name]: col.name } }
            : c,
        ),
      });
```

> Ensure `FieldDef` is imported in this file (it already imports board types — add `FieldDef` to the existing `boardModel` type import if not present).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/board/table.test.ts -t "second status field"`
Expected: PASS

- [ ] **Step 6: Run the whole table suite (no regression of the existing Status tests)**

Run: `npx jest tests/board/table.test.ts`
Expected: PASS — the existing "mutates Status" test still passes because `getStatusOptions(board, 'Status')` returns `board.columns`.

- [ ] **Step 7: Commit**

```bash
git add src/webview/boardTableRender.ts tests/board/table.test.ts
git commit -m "fix(board): table status dropdown targets its own field, not hardcoded Status

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Status trigger + dropdown target the actual field (side panel)

The side panel has no jsdom test harness today; verify by reading and a manual check. Keep the change mechanical and mirror Task 5.

**Files:**
- Modify: `src/webview/boardSidePanel.ts:341-342` (`renderPropRow` status branch), `:369-397` (`renderStatusChipTrigger`), `:412-456` (`openStatusDropdown`)

- [ ] **Step 1: Thread the field through `renderStatusChipTrigger`**

In `renderPropRow` (around line 341), change the status branch to pass the field:

```ts
} else if (field.type === 'status') {
  row.appendChild(renderStatusChipTrigger(board, card, field));
}
```

- [ ] **Step 2: Update `renderStatusChipTrigger` to read the field's value + options**

Add the import at the top of `boardSidePanel.ts` (with the other `boardModel` imports):

```ts
import { getStatusOptions } from './boardModel';
```

Change the signature to `function renderStatusChipTrigger(board: Board, card: Card, field: FieldDef): HTMLElement {` and replace the two hardcoded `Status` reads:

```ts
  const status = card.values[field.name] || '';
  const col = getStatusOptions(board, field.name).find((c) => c.name === status);
```

and update the click handler to pass the field:

```ts
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      openStatusDropdown(trigger, field);
    });
```

- [ ] **Step 3: Update `openStatusDropdown` (side panel) to take the field**

Change the signature to `function openStatusDropdown(anchor: HTMLElement, field: FieldDef): void {`. Replace `for (const col of board.columns) {` with:

```ts
  for (const col of getStatusOptions(board, field.name)) {
```

Replace the `card.values.Status === col.name` check with `card.values[field.name] === col.name`, and replace the commit `{ ...c, values: { ...c.values, Status: col.name } }` with `{ ...c, values: { ...c.values, [field.name]: col.name } }`.

> Confirm `FieldDef` is imported in `boardSidePanel.ts`; add it to the existing type import if missing.

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.webview.json --noEmit`
Expected: No errors in `boardSidePanel.ts`.

- [ ] **Step 5: Manual verification**

Build/run the extension, open a board with a second status field, open a card's side panel, and confirm: the second status property shows its own current value, the dropdown lists its own options, and picking one updates only that field (not Status). (Use the project `run` skill if available.)

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardSidePanel.ts
git commit -m "fix(board): side-panel status trigger/dropdown target their own field

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Reusable options editor component

**Files:**
- Create: `src/webview/boardStatusOptions.ts`
- Test: `tests/board/options-editor.test.ts` (create)

The component has two layers:
- `buildOptionsEditor(host, cfg)` — renders the rows (swatch → palette, editable name, × delete, + add) into `host` from a plain `ColumnDef[]`, calling back on each edit. No board knowledge.
- `openStatusOptionsEditor(anchor, board, fieldName, onChange)` — a popover wrapper that wires `buildOptionsEditor` to the model helpers (`addStatusOption`/`renameStatusOption`/`recolorStatusOption`/`deleteStatusOption`) and calls `onChange(nextBoard)`.

- [ ] **Step 1: Write the failing test**

Create `tests/board/options-editor.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { buildOptionsEditor } from '../../src/webview/boardStatusOptions';
import type { ColumnDef } from '../../src/webview/boardModel';

function render(options: ColumnDef[], cb: any) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  buildOptionsEditor(host, {
    getOptions: () => options,
    onAdd: cb.onAdd ?? (() => {}),
    onRename: cb.onRename ?? (() => {}),
    onRecolor: cb.onRecolor ?? (() => {}),
    onDelete: cb.onDelete ?? (() => {}),
  });
  return host;
}

describe('buildOptionsEditor', () => {
  const opts: ColumnDef[] = [{ name: 'Low', color: 'gray' }, { name: 'High', color: 'red' }];

  it('renders one row per option plus an add control', () => {
    const host = render(opts, {});
    expect(host.querySelectorAll('.bd-opt-row')).toHaveLength(2);
    expect(host.querySelector('.bd-opt-add')).not.toBeNull();
  });

  it('clicking × calls onDelete with the option name', () => {
    const deleted: string[] = [];
    const host = render(opts, { onDelete: (n: string) => deleted.push(n) });
    (host.querySelectorAll('.bd-opt-delete')[1] as HTMLElement).click();
    expect(deleted).toEqual(['High']);
  });

  it('clicking + add calls onAdd', () => {
    let added = 0;
    const host = render(opts, { onAdd: () => { added++; } });
    (host.querySelector('.bd-opt-add') as HTMLElement).click();
    expect(added).toBe(1);
  });

  it('picking a palette swatch calls onRecolor with (name, token)', () => {
    const calls: any[] = [];
    const host = render(opts, { onRecolor: (n: string, c: string) => calls.push([n, c]) });
    // open the palette on row 0, then click the "teal" swatch
    (host.querySelectorAll('.bd-opt-swatch')[0] as HTMLElement).click();
    const tealSwatch = host.querySelector('.bd-opt-palette .color-teal') as HTMLElement;
    tealSwatch.click();
    expect(calls).toEqual([['Low', 'teal']]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/board/options-editor.test.ts`
Expected: FAIL — module `boardStatusOptions` does not exist.

- [ ] **Step 3: Implement the component**

Create `src/webview/boardStatusOptions.ts`:

```ts
import {
  COLOR_TOKENS_PUBLIC as PALETTE,
  getStatusOptions,
  addStatusOption, renameStatusOption, recolorStatusOption, deleteStatusOption,
} from './boardModel';
import type { Board, ColumnDef, ColorToken } from './boardModel';

export interface OptionsEditorConfig {
  getOptions: () => ColumnDef[];
  onAdd: () => void;
  onRename: (oldName: string, newName: string) => void;
  onRecolor: (name: string, color: ColorToken) => void;
  onDelete: (name: string) => void;
}

/** Render the editable list of states into `host`. Pure DOM, no board knowledge. */
export function buildOptionsEditor(host: HTMLElement, cfg: OptionsEditorConfig): void {
  host.innerHTML = '';
  host.className = 'bd-opt-editor';

  for (const opt of cfg.getOptions()) {
    const row = document.createElement('div');
    row.className = 'bd-opt-row';

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = `bd-opt-swatch color-${opt.color}`;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      openPalette(row, opt.color, (tok) => cfg.onRecolor(opt.name, tok));
    });
    row.appendChild(swatch);

    const name = document.createElement('input');
    name.className = 'bd-opt-name';
    name.value = opt.name;
    const commit = () => {
      const v = name.value.trim();
      if (v && v !== opt.name) cfg.onRename(opt.name, v);
    };
    name.addEventListener('blur', commit);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
      if (e.key === 'Escape') { name.value = opt.name; name.blur(); }
    });
    row.appendChild(name);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'bd-opt-delete';
    del.textContent = '×';
    del.addEventListener('click', (e) => { e.stopPropagation(); cfg.onDelete(opt.name); });
    row.appendChild(del);

    host.appendChild(row);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'bd-opt-add';
  add.textContent = '+ Add option';
  add.addEventListener('click', (e) => { e.stopPropagation(); cfg.onAdd(); });
  host.appendChild(add);
}

function openPalette(anchor: HTMLElement, current: ColorToken, pick: (c: ColorToken) => void): void {
  anchor.querySelectorAll('.bd-opt-palette').forEach((n) => n.remove());
  const pal = document.createElement('div');
  pal.className = 'bd-opt-palette';
  for (const tok of PALETTE) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = `bd-opt-pchip color-${tok}` + (tok === current ? ' is-selected' : '');
    sw.addEventListener('click', (e) => { e.stopPropagation(); pick(tok); pal.remove(); });
    pal.appendChild(sw);
  }
  anchor.appendChild(pal);
}

/**
 * Popover wrapper: edits a status field's options on a real Board, mutating via
 * the model helpers and reporting each change through `onChange`.
 */
export function openStatusOptionsEditor(
  anchor: HTMLElement,
  getBoard: () => Board,
  fieldName: string,
  onChange: (next: Board) => void,
): void {
  document.querySelectorAll('.bd-opt-popover').forEach((n) => n.remove());
  const pop = document.createElement('div');
  pop.className = 'bd-opt-popover';
  document.body.appendChild(pop);

  const rect = anchor.getBoundingClientRect();
  pop.style.position = 'absolute';
  pop.style.top = `${rect.bottom + window.scrollY + 4}px`;
  pop.style.left = `${rect.left + window.scrollX}px`;

  const rerender = () => buildOptionsEditor(pop, {
    getOptions: () => getStatusOptions(getBoard(), fieldName),
    onAdd:     () => { onChange(addStatusOption(getBoard(), fieldName, 'New')); rerender(); },
    onRename:  (o, n) => { onChange(renameStatusOption(getBoard(), fieldName, o, n)); rerender(); },
    onRecolor: (n, c) => { onChange(recolorStatusOption(getBoard(), fieldName, n, c)); rerender(); },
    onDelete:  (n) => { onChange(deleteStatusOption(getBoard(), fieldName, n)); rerender(); },
  });
  rerender();

  function onOutside(e: MouseEvent) {
    if (!pop.contains(e.target as Node) && e.target !== anchor) close();
  }
  function close() {
    pop.remove();
    document.removeEventListener('mousedown', onOutside, true);
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
}
```

- [ ] **Step 4: Export the palette from the model**

The component imports `COLOR_TOKENS_PUBLIC`. In `src/webview/boardModel.ts`, add a public export next to the private `COLOR_TOKENS` (after line 62):

```ts
/** Public, ordered palette for color pickers. */
export const COLOR_TOKENS_PUBLIC: ColorToken[] = COLOR_TOKENS;
```

- [ ] **Step 5: Add CSS for the editor**

In `src/webview/styles/board.css` add (reuse existing popover/menu styling cues; keep it minimal):

```css
.bd-opt-editor { display: flex; flex-direction: column; gap: 2px; padding: 6px; min-width: 220px; }
.bd-opt-row { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 7px; }
.bd-opt-row:hover { background: var(--bd-hover, #f5f7fa); }
.bd-opt-swatch { width: 14px; height: 14px; border-radius: 4px; border: 0; padding: 0; cursor: pointer; background: var(--dot, #888); }
.bd-opt-name { flex: 1; border: 0; background: transparent; font: inherit; color: inherit; outline: none; padding: 1px 4px; border-radius: 5px; }
.bd-opt-name:focus { background: var(--bd-input-focus, #eef4ff); }
.bd-opt-delete { border: 0; background: transparent; color: #c2c8d0; font-weight: 700; cursor: pointer; }
.bd-opt-add { border: 0; background: transparent; color: #2b6cff; text-align: left; padding: 6px; cursor: pointer; border-top: 1px solid #f1f3f5; margin-top: 4px; }
.bd-opt-palette { position: absolute; display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; padding: 9px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 14px 36px rgba(20,30,50,.2); z-index: 20; }
.bd-opt-pchip { width: 22px; height: 22px; border-radius: 6px; border: 0; cursor: pointer; background: var(--dot, #888); }
.bd-opt-pchip.is-selected { box-shadow: 0 0 0 2px #fff, 0 0 0 3px #2a2f38; }
.bd-opt-popover { background: #fff; border: 1px solid #e5e7eb; border-radius: 11px; box-shadow: 0 16px 40px rgba(20,30,50,.18); z-index: 19; }
```

> The swatch/chip background uses the same `--dot` variable the Task 1 color classes define. If Task 1 mirrored direct backgrounds instead of variables, set `.bd-opt-swatch`/`.bd-opt-pchip` backgrounds via the per-token `color-*` rules instead.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/board/options-editor.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/webview/boardStatusOptions.ts src/webview/boardModel.ts src/webview/styles/board.css tests/board/options-editor.test.ts
git commit -m "feat(board): reusable status options editor (add/rename/recolor/delete)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: "Edit options" in the properties-panel field action menu

**Files:**
- Modify: `src/webview/boardProperties.ts:242-303` (`openFieldActionMenu`)
- Test: `tests/board/options-editor.test.ts` (add a wiring test) — optional jsdom assert that the menu shows the item for status fields.

- [ ] **Step 1: Write the failing test**

Append to `tests/board/options-editor.test.ts`:

```ts
import { openFieldActionMenu } from '../../src/webview/boardProperties';
import type { Board, FieldDef } from '../../src/webview/boardModel';

function fieldMenuBoard(): Board {
  return {
    id: 'b1', name: '',
    columns: [{ name: 'Todo', color: 'blue' }],
    fields: [
      { name: 'Title',  type: 'text',   visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Notes',  type: 'text',   visibleOnCard: true },
    ],
    cards: [], orphanBodies: [], views: [], activeView: 'kanban',
  };
}

describe('field action menu — Edit options', () => {
  const anchor = () => { const a = document.createElement('button'); document.body.appendChild(a); return a; };
  const labels = () =>
    Array.from(document.querySelectorAll('.board-field-action-label')).map((n) => n.textContent);

  it('shows "Edit options" for a status field', () => {
    const b = fieldMenuBoard();
    openFieldActionMenu(anchor(), b, b.fields[1], () => {});
    expect(labels()).toContain('Edit options');
  });

  it('does NOT show "Edit options" for a non-status field', () => {
    const b = fieldMenuBoard();
    openFieldActionMenu(anchor(), b, b.fields[2], () => {});
    expect(labels()).not.toContain('Edit options');
  });
});
```

> Add `/** @jest-environment jsdom */` is already at the top of the file from Task 7.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/board/options-editor.test.ts -t "Edit options"`
Expected: FAIL — no such menu item.

- [ ] **Step 3: Implement the menu item**

In `src/webview/boardProperties.ts`, add the import:

```ts
import { openStatusOptionsEditor } from './boardStatusOptions';
```

In `openFieldActionMenu`, after the `Rename` item (line 273) add (note: enabled for status even when `isLocked`, since editing Status states is allowed):

```ts
  if (field.type === 'status') {
    addItem(ICON_EDIT, 'Edit options', '', false, () => {
      openStatusOptionsEditor(anchor, () => board, field.name, onChange);
    });
  }
```

> `openStatusOptionsEditor` takes a `getBoard` function; here the menu only has the static `board` it was opened with, so pass `() => board`. Each edit calls `onChange(next)`; the editor re-renders from the latest board it can see via this closure — acceptable for a short-lived menu. (If the host re-renders the menu on change, that's fine too.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/board/options-editor.test.ts -t "Edit options"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardProperties.ts tests/board/options-editor.test.ts
git commit -m "feat(board): Edit options entry in properties-panel field menu (status only)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: "Edit options" in the table column-header ⋯ (and Kanban column menu)

The table column-header ⋯ uses its own menu, `openColumnMenu` at [boardTableRender.ts:742](../../../src/webview/boardTableRender.ts#L742), built with a local `mkItem(icon, label, fn, opts)` helper. (Title/Status/Description gate *rename* via `isLockedName`, but "Edit options" should be enabled for the Status field.) The Kanban column chrome already edits the Status options via its own column menu, so a Kanban entry is optional polish.

**Files:**
- Modify: `src/webview/boardTableRender.ts:742-811+` (`openColumnMenu`) — add an "Edit options" `mkItem` for status fields.

- [ ] **Step 1: Add "Edit options" to the table column menu**

In `src/webview/boardTableRender.ts`, add the import (with the other imports):

```ts
import { openStatusOptionsEditor } from './boardStatusOptions';
```

Add an entry to the `ICON` map inside `openColumnMenu` (reuse the rename pencil glyph):

```ts
    editOptions: `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M227.32,73.37,182.63,28.69a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.32,96a16,16,0,0,0,0-22.63ZM48,179.31,76.69,208H48ZM92.69,208,48,163.31,134,77.32,178.69,122ZM192,108.69,147.31,64l24-24L216,84.69Z"/></svg>`,
```

Immediately after the `mkItem(ICON.rename, 'Rename', …)` call (~line 782), add:

```ts
  if (f.type === 'status') {
    mkItem(ICON.editOptions, 'Edit options', () => {
      openStatusOptionsEditor(anchor, ctx.getBoard, f.name, ctx.mutate);
    });
  }
```

> `anchor`, `ctx.getBoard`, and `ctx.mutate` are all already parameters/fields in scope here. `openStatusOptionsEditor` accepts `getBoard: () => Board`, so passing `ctx.getBoard` directly is correct and gives the editor live board state.

- [ ] **Step 2: (Optional) Kanban column menu entry**

The Kanban column chrome already edits Status options (rename/recolor/delete columns). Adding a single "Edit options" shortcut is optional. If included: in `src/webview/boardKanbanRender.ts` import `openStatusOptionsEditor` and, inside `openColumnMenu` (~line 749-882), add one row using that file's existing `row(...)` helper that calls `openStatusOptionsEditor(dots, () => board, 'Status', mutate)` (use the anchor/`mutate` already in scope). Skip if it complicates the existing chrome.

- [ ] **Step 3: Type-check + manual verification**

Run: `npx tsc -p tsconfig.webview.json --noEmit`
Expected: no errors.

Manual: in Table view, open the ⋯ on the Status column and on an added status column → "Edit options" appears and opens the editor; edits update the chips live. The ⋯ on a Text/Date column shows no "Edit options".

- [ ] **Step 4: Commit**

```bash
git add src/webview/boardTableRender.ts src/webview/boardKanbanRender.ts
git commit -m "feat(board): Edit options entry in table column-header menu (status only)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Inline States section when creating a status column

**Files:**
- Modify: `src/webview/boardProperties.ts:604-695` (`promptNewField`)
- Test: `tests/board/options-editor.test.ts` (add a creation-flow test)

When the user picks **Status** in the new-column popover, instead of committing immediately, reveal an inline States editor seeded with defaults and a **Create column** button. Other types commit immediately as today.

- [ ] **Step 1: Write the failing test**

Append to `tests/board/options-editor.test.ts`:

```ts
import { promptNewField } from '../../src/webview/boardProperties';

describe('new-column popover — status seeds + creates with options', () => {
  it('picking Status reveals a States editor and Create button; Create adds a status field with options', () => {
    const board = fieldMenuBoard();
    let created: { board: Board; name: string } | null = null;
    const a = document.createElement('button'); document.body.appendChild(a);

    promptNewField(a, board, (next, name) => { created = { board: next, name }; });

    // pick the "Status" type row
    const rows = Array.from(document.querySelectorAll('.board-add-field-type-row')) as HTMLElement[];
    const statusRow = rows.find((r) => /status/i.test(r.textContent || ''))!;
    statusRow.click();

    // inline editor + Create button appear; not yet committed
    expect(document.querySelector('.bd-opt-editor')).not.toBeNull();
    expect(created).toBeNull();

    const createBtn = document.querySelector('.board-add-field-create') as HTMLElement;
    expect(createBtn).not.toBeNull();
    createBtn.click();

    expect(created).not.toBeNull();
    const field = created!.board.fields.find((f) => f.name === created!.name)!;
    expect(field.type).toBe('status');
    expect((field.options ?? []).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/board/options-editor.test.ts -t "status seeds"`
Expected: FAIL — picking Status commits immediately; no `.bd-opt-editor`/`.board-add-field-create`.

- [ ] **Step 3: Implement the inline status flow**

In `src/webview/boardProperties.ts`, add the import:

```ts
import { buildOptionsEditor } from './boardStatusOptions';
import type { ColumnDef } from './boardModel';
```

Add a module-level default near the top of the file:

```ts
const DEFAULT_STATUS_OPTIONS: ColumnDef[] = [
  { name: 'Todo',        color: 'blue' },
  { name: 'In progress', color: 'amber' },
  { name: 'Done',        color: 'emerald' },
];
```

In `promptNewField`, change the per-type row handler so non-status types keep calling `commit(t)` immediately, but `status` opens the inline editor. Replace the `row.addEventListener('click', () => commit(t));` line with:

```ts
    row.addEventListener('click', () => {
      if (t === 'status') showStatusSetup();
      else commit(t);
    });
```

Add `showStatusSetup` inside `promptNewField` (before the `commit` definition). It replaces the type list with the editor + Create button, editing a local working copy of options:

```ts
  function showStatusSetup(): void {
    list.remove();
    sectionLabel.textContent = 'States';

    const working: ColumnDef[] = DEFAULT_STATUS_OPTIONS.map((o) => ({ ...o }));
    const editorHost = document.createElement('div');
    pop.appendChild(editorHost);

    const rerender = () => buildOptionsEditor(editorHost, {
      getOptions: () => working,
      onAdd: () => {
        const used = working.map((o) => o.color);
        const color = (['gray','blue','amber','emerald','red','purple','orange','teal','indigo','pink'] as const)
          .find((c) => !used.includes(c)) ?? 'gray';
        working.push({ name: 'New', color });
        rerender();
      },
      onRename: (o, n) => { const t2 = working.find((w) => w.name === o); if (t2) t2.name = n; rerender(); },
      onRecolor: (n, c) => { const t2 = working.find((w) => w.name === n); if (t2) t2.color = c; rerender(); },
      onDelete: (n) => { const i = working.findIndex((w) => w.name === n); if (i >= 0) working.splice(i, 1); rerender(); },
    });
    rerender();

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'board-add-field-create';
    createBtn.textContent = 'Create column';
    createBtn.addEventListener('click', () => commitStatus(working));
    pop.appendChild(createBtn);
  }

  function commitStatus(options: ColumnDef[]): void {
    const base = FIELD_TYPE_LABELS.status;
    let name = base;
    let n = 2;
    while (board.fields.some((f) => f.name === name)) name = `${base} ${n++}`;
    onChange(
      {
        ...board,
        fields: [...board.fields, { name, type: 'status', visibleOnCard: true, options }],
        cards: board.cards.map((c) => ({ ...c, values: { ...c.values, [name]: '' } })),
      },
      name,
    );
    closePop();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/board/options-editor.test.ts -t "status seeds"`
Expected: PASS

- [ ] **Step 5: Run the full board + editor suites**

Run: `npx jest tests/board`
Expected: PASS (all suites). The `promptNewField` change preserves immediate commit for non-status types.

- [ ] **Step 6: Manual verification of the whole feature**

Build/run the extension and verify end-to-end:
- Add a status column → States section appears, defaults editable, Create makes the column.
- Click cells in the new column → its own options show; picking sets that column (Status unchanged).
- Edit options from the column ⋯, the properties ⋯, and at creation — all change the same states.
- Rename a state → cards update; delete a state → cards clear it; recolor → chips recolor.
- Reload the board (close/reopen the file) → the second column's states and values persist.

- [ ] **Step 7: Commit**

```bash
git add src/webview/boardProperties.ts tests/board/options-editor.test.ts
git commit -m "feat(board): define states inline when creating a status column

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run `npx jest tests/board` — all board suites pass.
- [ ] Run `npx tsc -p tsconfig.webview.json --noEmit` — no type errors.
- [ ] `npm test` — only the known-unrelated `tests/toggle.test.ts` may fail; everything else green.
- [ ] Manual end-to-end pass per Task 10 Step 6.
