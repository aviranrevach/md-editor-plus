# c19 — Status Management Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix board status options so duplicate-named options can never become linked, options can be drag-reordered, and the existing "Edit options" entry points all benefit at once.

**Architecture:** All status-option edits flow through one chokepoint — the model helpers in `src/webview/boardModel.ts` and the editor in `src/webview/boardStatusOptions.ts`. We add a uniqueness guard + a reorder helper to the model, then surface rename-rejection feedback and a drag-to-reorder grip in the editor. The built-in **Status** field stores its options in `board.columns`, custom status/tags fields in `field.options`; `setStatusOptions` already routes both, so fixes at the chokepoint cover every field kind and both callers (table column header + Properties menu).

**Tech Stack:** TypeScript, jsdom + Jest (`npm test`), no new dependencies. Drag uses the existing `startDrag` / `dropIndicator` helpers in `src/webview/boardDragShared.ts`.

## Global Constraints

- **No disk-format change** — status options still serialize as `name:color` (`field-options="Field=Name:color|..."`). Round-trip (`serializeBoard` → `parseBoardSource`) must stay deep-equal stable.
- **Manual mouse drag only** — use `startDrag` (mousedown/mousemove/mouseup); never the HTML5 drag API (ProseMirror intercepts `dragstart` in this webview).
- **Drop indicator is a separate blue line** (`.bd-drop-line` from `dropIndicator()`), never a row stroke/box highlight.
- **Name comparison for uniqueness is trimmed + case-insensitive.**
- **Tags fields keep their existing merge-on-duplicate-rename behavior** (`renameTagOption`); the new rejection applies to **status** fields only.
- All board model functions are **pure / immutable** — return a new `Board`, never mutate the input.
- Run the full suite with `npm test` (Jest). Per-file: `npx jest tests/board/options-model.test.ts`.

---

### Task 1: Model — reject duplicate names on status rename

**Files:**
- Modify: `src/webview/boardModel.ts` (add `isStatusNameAvailable`, guard `renameStatusOption` near lines 66-81)
- Test: `tests/board/options-model.test.ts`

**Interfaces:**
- Consumes: `getStatusOptions`, `setStatusOptions`, `Board`, `ColumnDef` (existing).
- Produces:
  - `isStatusNameAvailable(board: Board, fieldName: string, name: string, exclude?: string): boolean` — true if `name` (trimmed, case-insensitive) is unused on `fieldName`, ignoring the option named `exclude`.
  - `renameStatusOption(board, fieldName, oldName, newName): Board` — unchanged signature; now returns the board **unchanged** when `newName` collides with another option.

- [ ] **Step 1: Write the failing tests**

Add to `tests/board/options-model.test.ts`, inside (or after) the `describe('status-option mutations migrate card values', ...)` block. First add `isStatusNameAvailable` and `renameStatusOption` to the import on line 1:

```ts
import { parseBoardSource, serializeBoard, getStatusOptions, setStatusOptions, renameStatusOption, deleteStatusOption, addStatusOption, isStatusNameAvailable } from '../../src/webview/boardModel';
```

```ts
describe('status rename uniqueness guard', () => {
  it('isStatusNameAvailable is false for an existing name (case/space-insensitive)', () => {
    const b = makeBoard(); // Status: Todo, Done
    expect(isStatusNameAvailable(b, 'Status', '  done ')).toBe(false);
    expect(isStatusNameAvailable(b, 'Status', 'Backlog')).toBe(true);
  });

  it('isStatusNameAvailable ignores the option being renamed (exclude)', () => {
    const b = makeBoard();
    // Renaming "Todo" to "todo" (case fix) is allowed: only itself matches.
    expect(isStatusNameAvailable(b, 'Status', 'todo', 'Todo')).toBe(true);
  });

  it('renameStatusOption returns the board UNCHANGED when the new name collides', () => {
    const b = makeBoard();
    const next = renameStatusOption(b, 'Status', 'Todo', 'Done'); // Done already exists
    expect(next).toBe(b); // identical reference — no mutation
  });

  it('renameStatusOption allows a case-only change of the same option', () => {
    const next = renameStatusOption(makeBoard(), 'Status', 'Todo', 'todo');
    expect(next.columns[0]).toEqual({ name: 'todo', color: 'blue' });
    expect(next.cards[0].values.Status).toBe('todo');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/board/options-model.test.ts -t "uniqueness guard"`
Expected: FAIL — `isStatusNameAvailable` is not exported / `renameStatusOption` still mutates on collision.

- [ ] **Step 3: Implement the guard**

In `src/webview/boardModel.ts`, add the predicate just above `renameStatusOption` (currently line 66):

```ts
/** True if `name` (trimmed, case-insensitive) is free to use on a status field,
 *  ignoring the option named `exclude` (the one being renamed). */
export function isStatusNameAvailable(
  board: Board, fieldName: string, name: string, exclude?: string,
): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const target = norm(name);
  return !getStatusOptions(board, fieldName).some(
    (o) => o.name !== exclude && norm(o.name) === target,
  );
}
```

Then add the early-return guard as the first line inside `renameStatusOption`:

```ts
export function renameStatusOption(
  board: Board, fieldName: string, oldName: string, newName: string,
): Board {
  if (!isStatusNameAvailable(board, fieldName, newName, oldName)) return board;
  const opts = getStatusOptions(board, fieldName).map(
    (o) => (o.name === oldName ? { ...o, name: newName } : o),
  );
  // ...unchanged remainder (setStatusOptions + card migration)...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/board/options-model.test.ts`
Expected: PASS — new block green and all pre-existing options-model tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts tests/board/options-model.test.ts
git commit -m "fix(c19): reject duplicate names on status rename"
```

---

### Task 2: Model — reorderStatusOption helper

**Files:**
- Modify: `src/webview/boardModel.ts` (add `reorderStatusOption` near the other status helpers, ~line 113)
- Test: `tests/board/options-model.test.ts`

**Interfaces:**
- Consumes: `getStatusOptions`, `setStatusOptions`, `Board`.
- Produces: `reorderStatusOption(board: Board, fieldName: string, from: number, to: number): Board` — returns a new board with the option at index `from` moved to index `to`; returns the board **unchanged** for out-of-range or `from === to`.

- [ ] **Step 1: Write the failing tests**

Add `reorderStatusOption` to the import on line 1, then append:

```ts
describe('reorderStatusOption', () => {
  it('moves a Status option and rewrites board.columns (drives kanban order)', () => {
    const next = reorderStatusOption(makeBoard(), 'Status', 1, 0); // Done before Todo
    expect(next.columns.map(c => c.name)).toEqual(['Done', 'Todo']);
  });

  it('moves an option on an additional status field', () => {
    const b = makeBoard();
    b.fields.find(f => f.name === 'Impact')!.options =
      [{ name: 'Low', color: 'gray' }, { name: 'High', color: 'red' }, { name: 'Mid', color: 'blue' }];
    const next = reorderStatusOption(b, 'Impact', 2, 0); // Mid to front
    expect(next.fields.find(f => f.name === 'Impact')!.options!.map(o => o.name))
      .toEqual(['Mid', 'Low', 'High']);
  });

  it('returns the board unchanged for a no-op or out-of-range move', () => {
    const b = makeBoard();
    expect(reorderStatusOption(b, 'Status', 0, 0)).toBe(b);
    expect(reorderStatusOption(b, 'Status', 5, 0)).toBe(b);
  });

  it('reordered options survive a serialize -> parse round-trip', () => {
    const src = [
      `<!-- board:start id="b1" columns="Todo|Done" column-colors="blue|emerald" field-types="Title=text,Status=status,Impact=status" field-options="Impact=Low:gray|High:red" -->`,
      ``, `| Title | Status | Impact |`, `|---|---|---|`, `| A | Todo | Low |`, ``,
      `<!-- board:end -->`,
    ].join('\n');
    const b = reorderStatusOption(parseBoardSource(src), 'Impact', 1, 0); // High, Low
    const round = parseBoardSource(serializeBoard(b));
    expect(round.fields.find(f => f.name === 'Impact')!.options!.map(o => o.name))
      .toEqual(['High', 'Low']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/board/options-model.test.ts -t "reorderStatusOption"`
Expected: FAIL — `reorderStatusOption` not exported.

- [ ] **Step 3: Implement the helper**

In `src/webview/boardModel.ts`, add after `recolorStatusOption` (~line 113):

```ts
/** Move the status option at index `from` to index `to`. Pure array reorder. */
export function reorderStatusOption(
  board: Board, fieldName: string, from: number, to: number,
): Board {
  const opts = [...getStatusOptions(board, fieldName)];
  if (from < 0 || from >= opts.length || to < 0 || to >= opts.length || from === to) {
    return board;
  }
  const [moved] = opts.splice(from, 1);
  opts.splice(to, 0, moved);
  return setStatusOptions(board, fieldName, opts);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/board/options-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts tests/board/options-model.test.ts
git commit -m "feat(c19): reorderStatusOption model helper"
```

---

### Task 3: Editor — rename rejection feedback (revert + flash)

**Files:**
- Modify: `src/webview/boardStatusOptions.ts` (`OptionsEditorConfig.onRename` return type; `commit()` in `buildOptionsEditor`; `onRename` wrapper in `openStatusOptionsEditor`)
- Modify: `src/webview/styles/board.css` (add `.bd-opt-name--reject` + shake keyframes near line 1710)
- Test: `tests/board/options-editor.test.ts`

**Interfaces:**
- Consumes: `isStatusNameAvailable`, `renameStatusOption`, `renameTagOption` (model).
- Produces: `OptionsEditorConfig.onRename: (oldName: string, newName: string) => boolean` — returns `true` when the rename was applied, `false` when rejected (caller reverts the input). Existing callers that returned an `Array.prototype.push` result (a truthy number) remain compatible.

- [ ] **Step 1: Write the failing test**

Add to `tests/board/options-editor.test.ts` inside `describe('buildOptionsEditor — rename', ...)`:

```ts
it('reverts the input and flashes when onRename returns false (rejected)', () => {
  const host = render(opts(), { onRename: () => false });
  const input = host.querySelectorAll('.bd-opt-name')[0] as HTMLInputElement;
  input.focus(); input.value = 'High'; input.dispatchEvent(new Event('blur'));
  expect(input.value).toBe('Low');                       // reverted to original
  expect(input.classList.contains('bd-opt-name--reject')).toBe(true);
});

it('keeps the typed value when onRename returns true (accepted)', () => {
  const host = render(opts(), { onRename: () => true });
  const input = host.querySelectorAll('.bd-opt-name')[0] as HTMLInputElement;
  input.focus(); input.value = 'Minor'; input.dispatchEvent(new Event('blur'));
  expect(input.value).toBe('Minor');
  expect(input.classList.contains('bd-opt-name--reject')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/board/options-editor.test.ts -t "rejected"`
Expected: FAIL — current `commit()` ignores the return value, so `input.value` stays `'High'` and no class is added.

- [ ] **Step 3: Update the editor + config type**

In `src/webview/boardStatusOptions.ts`, change the `onRename` type in `OptionsEditorConfig`:

```ts
  onRename: (oldName: string, newName: string) => boolean;
```

Replace the `commit` closure inside `buildOptionsEditor` (currently lines 56-60):

```ts
    const commit = () => {
      const v = name.value.trim();
      if (!v || v === opt.name) return;
      const applied = cfg.onRename(opt.name, v);
      if (!applied) {
        name.value = opt.name;
        name.classList.remove('bd-opt-name--reject');
        void name.offsetWidth;                  // restart the CSS animation
        name.classList.add('bd-opt-name--reject');
      }
    };
    name.addEventListener('animationend', () => name.classList.remove('bd-opt-name--reject'));
```

Update the `onRename` wrapper in `openStatusOptionsEditor` (currently line 133) to return a boolean and reject duplicate status names:

```ts
    onRename: (o, n) => {
      if (isTags()) { onChange(renameTagOption(getBoard(), fieldName, o, n)); rerender(); return true; }
      if (!isStatusNameAvailable(getBoard(), fieldName, n, o)) return false;
      onChange(renameStatusOption(getBoard(), fieldName, o, n));
      rerender();
      return true;
    },
```

Add `isStatusNameAvailable` to the model import at the top of the file (lines 1-6):

```ts
import {
  COLOR_TOKENS_PUBLIC as PALETTE,
  getStatusOptions, isStatusNameAvailable,
  addStatusOption, renameStatusOption, recolorStatusOption, deleteStatusOption,
  addTagOption, renameTagOption, deleteTagOption,
} from './boardModel';
```

- [ ] **Step 4: Add the CSS**

In `src/webview/styles/board.css`, after the `.bd-opt-name:focus` rule (line 1711):

```css
@keyframes bd-opt-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-3px); }
  40%, 80% { transform: translateX(3px); }
}
.bd-opt-name--reject {
  animation: bd-opt-shake .22s ease;
  box-shadow: 0 0 0 1px var(--board-chip-red-dot);
  border-radius: 5px;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/board/options-editor.test.ts`
Expected: PASS — new tests green; the pre-existing rename tests (which use `push`, returning a truthy number) stay green.

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardStatusOptions.ts src/webview/styles/board.css tests/board/options-editor.test.ts
git commit -m "feat(c19): reject-and-flash on duplicate status rename in the editor"
```

---

### Task 4: Editor — drag-to-reorder grip

**Files:**
- Modify: `src/webview/boardStatusOptions.ts` (add `onReorder` to config; render a grip per row; add pure index helpers + `startReorderDrag`; wire `onReorder` in `openStatusOptionsEditor`)
- Modify: `src/webview/styles/board.css` (`.bd-opt-grip` styles)
- Test: `tests/board/options-editor.test.ts` (grip renders + pure index helpers)

**Interfaces:**
- Consumes: `startDrag`, `dropIndicator`, `DRAG_THRESHOLD_PX` from `./boardDragShared`; `reorderStatusOption` from `./boardModel`.
- Produces:
  - `OptionsEditorConfig.onReorder?: (from: number, to: number) => void`.
  - `dropInsertionIndex(rects: { top: number; bottom: number }[], clientY: number): number` — returns insertion index `0..rects.length`.
  - `insertionToFinalIndex(from: number, insertion: number): number | null` — converts an insertion slot to the post-removal target index, or `null` when the move is a no-op.

- [ ] **Step 1: Write the failing tests**

Add `dropInsertionIndex` and `insertionToFinalIndex` to the import on line 4, then add:

```ts
import { buildOptionsEditor, dropInsertionIndex, insertionToFinalIndex } from '../../src/webview/boardStatusOptions';
```

```ts
describe('reorder index math', () => {
  const rects = [
    { top: 0,  bottom: 20 },
    { top: 20, bottom: 40 },
    { top: 40, bottom: 60 },
  ];
  it('dropInsertionIndex picks the slot by the row mid-line', () => {
    expect(dropInsertionIndex(rects, 5)).toBe(0);   // above mid of row 0
    expect(dropInsertionIndex(rects, 15)).toBe(1);  // below mid of row 0
    expect(dropInsertionIndex(rects, 55)).toBe(3);  // below last row
  });
  it('insertionToFinalIndex converts slots and detects no-ops', () => {
    expect(insertionToFinalIndex(0, 0)).toBeNull();   // same slot
    expect(insertionToFinalIndex(0, 1)).toBeNull();   // slot just after itself
    expect(insertionToFinalIndex(0, 2)).toBe(1);      // move down one
    expect(insertionToFinalIndex(2, 0)).toBe(0);      // move to top
  });
});

describe('buildOptionsEditor — grip', () => {
  it('renders a drag grip on every option row', () => {
    const host = document.createElement('div');
    buildOptionsEditor(host, {
      getOptions: () => [{ name: 'Low', color: 'gray' }, { name: 'High', color: 'red' }],
      onAdd: () => {}, onRename: () => true, onRecolor: () => {}, onDelete: () => {},
    });
    expect(host.querySelectorAll('.bd-opt-row .bd-opt-grip')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/board/options-editor.test.ts -t "reorder index math"`
Expected: FAIL — helpers not exported; grip not rendered.

- [ ] **Step 3: Add the pure helpers**

In `src/webview/boardStatusOptions.ts`, add the drag imports at the top:

```ts
import { startDrag, dropIndicator, DRAG_THRESHOLD_PX } from './boardDragShared';
```

Add these exported pure functions near the top of the file (below the imports):

```ts
/** Insertion slot (0..n) for a pointer Y over a vertical list of row rects. */
export function dropInsertionIndex(rects: { top: number; bottom: number }[], clientY: number): number {
  for (let i = 0; i < rects.length; i++) {
    const mid = (rects[i].top + rects[i].bottom) / 2;
    if (clientY < mid) return i;
  }
  return rects.length;
}

/** Convert an insertion slot to the index after the dragged row is removed.
 *  Returns null when the move would not change order. */
export function insertionToFinalIndex(from: number, insertion: number): number | null {
  if (insertion === from || insertion === from + 1) return null;
  return insertion > from ? insertion - 1 : insertion;
}
```

- [ ] **Step 4: Render the grip + wire the drag**

Add `onReorder` to `OptionsEditorConfig`:

```ts
  onReorder?: (from: number, to: number) => void;
```

In `buildOptionsEditor`, iterate with an index and prepend a grip to each row. Change the loop header from `for (const opt of cfg.getOptions())` to:

```ts
  const optList = cfg.getOptions();
  optList.forEach((opt, index) => {
    const row = document.createElement('div');
    row.className = 'bd-opt-row';

    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'bd-opt-grip';
    grip.textContent = '⠿';                 // ⠿
    grip.tabIndex = -1;
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startReorderDrag(e, host, index, cfg);
    });
    row.appendChild(grip);
    // ...existing swatch / name / del creation, unchanged...
    host.appendChild(row);
  });
```

(Keep the swatch/name/del bodies exactly as they are; only the loop header, the grip, and the closing `});` change. The `del` and `swatch` handlers that read the live name from the row still work.)

Add the drag wiring helper near the other module-private functions:

```ts
function startReorderDrag(e: MouseEvent, host: HTMLElement, fromIndex: number, cfg: OptionsEditorConfig): void {
  const rows = Array.from(host.querySelectorAll('.bd-opt-row')) as HTMLElement[];
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const indicator = dropIndicator();
  host.appendChild(indicator);

  startDrag(e, {
    thresholdPx: DRAG_THRESHOLD_PX,
    onMove: (ev) => {
      const rects = rows.map((r) => r.getBoundingClientRect());
      const slot = dropInsertionIndex(rects, ev.clientY);
      const hostRect = host.getBoundingClientRect();
      const y = slot < rects.length ? rects[slot].top : rects[rects.length - 1].bottom;
      indicator.show(0, y - hostRect.top, host.clientWidth, 2);
    },
    onDrop: (ev) => {
      indicator.remove();
      const rects = rows.map((r) => r.getBoundingClientRect());
      const slot = dropInsertionIndex(rects, ev.clientY);
      const to = insertionToFinalIndex(fromIndex, slot);
      if (to !== null) cfg.onReorder?.(fromIndex, to);
    },
    onCancel: () => indicator.remove(),
  });
}
```

Wire `onReorder` in `openStatusOptionsEditor`'s config object (alongside `onAdd`/`onRename`/etc.):

```ts
    onReorder: (from, to) => { onChange(reorderStatusOption(getBoard(), fieldName, from, to)); rerender(); },
```

Add `reorderStatusOption` to the model import in this file.

- [ ] **Step 5: Add the grip CSS**

In `src/webview/styles/board.css`, after `.bd-opt-row:hover` (line 1708):

```css
.bd-opt-grip {
  border: 0; background: transparent; color: var(--board-text-muted);
  cursor: grab; padding: 0 2px; font-size: 12px; line-height: 1; opacity: 0;
}
.bd-opt-row:hover .bd-opt-grip { opacity: .55; }
.bd-opt-grip:active { cursor: grabbing; }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest tests/board/options-editor.test.ts`
Expected: PASS — index-math + grip tests green; all earlier editor tests still green (adding a grip before the swatch does not break `.bd-opt-swatch`/`.bd-opt-name`/`.bd-opt-delete` selectors).

- [ ] **Step 7: Commit**

```bash
git add src/webview/boardStatusOptions.ts src/webview/styles/board.css tests/board/options-editor.test.ts
git commit -m "feat(c19): drag-to-reorder status options with a grip + drop line"
```

---

### Task 5: Full suite, docs, and manual verification

**Files:**
- Modify: `CHANGELOG.md` (Unreleased → Fixed)
- Verify only: app behavior via F5

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS for all c19 tests. Note: 2 suites (`toggle.test.ts`, `board/grouping.test.ts`) are **pre-existing** compile failures unrelated to this work — confirm the count of failures did not increase and that `options-model.test.ts` + `options-editor.test.ts` are green.

- [ ] **Step 2: Type-check / build**

Run: `npm run compile` (or the project's build script)
Expected: no TypeScript errors from the changed files.

- [ ] **Step 3: Update CHANGELOG**

Add to the `## [Unreleased]` → `### Fixed` list in `CHANGELOG.md` (Fixed is the right section; this fixes broken status behavior):

```markdown
- **Status options no longer get "linked" — and you can reorder them (c19)** — editing a board status used to be able to silently change a *different* status with the same name, there was no way to reorder statuses, and the behavior differed by entry point. Three fixes, all at the shared options editor so every entry point (the table column header **and** the ⋯ → Properties → Edit options menu) and every field kind (the built-in **Status** and custom status fields) get them at once: (1) two options on a field can never share a name — renaming onto an existing name is rejected with a brief shake instead of merging them; (2) **drag a status by its grip to reorder it** (a blue drop-line shows where it lands), which for the built-in Status also sets the kanban column order; (3) the Properties-menu "Edit options" path is confirmed working end-to-end. (c19)
```

- [ ] **Step 4: Commit docs**

```bash
git add CHANGELOG.md
git commit -m "docs(c19): changelog for status management fix"
```

- [ ] **Step 5: Manual verification (F5)**

Launch the extension (F5) and open a markdown file with a board, then confirm:
1. **Table column header** → click a status column's `⋮` → **Edit options**: rename one option to exactly match another → the input **shakes and reverts**, and the other option is untouched.
2. **Add** a new option, rename it to a unique name → it stays independent (recoloring it does **not** change any other option).
3. **Drag** an option by its grip → a **blue line** shows the drop position; release → order changes. For the built-in **Status** field, the **kanban columns reorder** to match.
4. Repeat (1)–(3) via **⋯ → Properties → (field) ⋮ → Edit options** — identical behavior.

Report results. If a real gap surfaces in the Properties path, fold a minimal fix into a follow-up commit and note it in the spec's #3 section.

---

## Self-Review

**Spec coverage:**
- #1 synced bug (unique names) → Task 1 (model guard) + Task 3 (editor reject/flash). ✔
- #2 reorder → Task 2 (model helper) + Task 4 (grip drag). ✔
- #3 main-menu verification → Task 5 Step 5 (manual) + existing shared-editor tests in `options-editor.test.ts`. ✔
- Round-trip / no disk-format change → Task 2 round-trip test + Global Constraints. ✔
- Kanban column order for built-in Status → Task 2 test + Task 5 manual. ✔

**Type consistency:** `onRename` returns `boolean` (Tasks 3 & used in 4's grip test stub); `onReorder?: (from, to) => void` (Task 4); model `reorderStatusOption(board, fieldName, from, to)` and `isStatusNameAvailable(board, fieldName, name, exclude?)` used consistently across tasks. `dropInsertionIndex` / `insertionToFinalIndex` signatures match between definition (Task 4 Step 3) and tests (Task 4 Step 1).

**Placeholder scan:** none — every code/test step shows full content.
