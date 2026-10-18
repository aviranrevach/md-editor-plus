# C2 — Block Dragger Action Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the block dragger's "convert" picker with a consistent Notion-style action menu — **Turn into / Duplicate / Delete** with one unified search box — so every block type (callout, board, toggle, image, …) exposes the same basic actions and a way to convert.

**Architecture:** Two pure, unit-tested helpers carry the logic — `duplicateBoardSource` (clone a board's `source` with a fresh board id) in `boardModel.ts`, and `convertibleTargets` / `searchBlockActions` in a new DOM-free `blockActions.ts`. The block picker (`blockPicker.ts`) gains an "action mode" (triggered when opened over a block) that renders the action menu and a flat "Turn into" list, removing the old callout auto-drill trap. UI wiring is verified by building the extension and exercising it manually (the test runner is Node-only — no DOM/editor harness).

**Tech Stack:** TypeScript, TipTap/ProseMirror, Jest (Node env, pure-function tests), VS Code webview extension.

---

## File Structure

- **`src/webview/boardModel.ts`** (modify) — add `mintBoardId()` and `duplicateBoardSource()` next to the existing `mintCardId` / `parseBoardSource` / `serializeBoard`. Pure, no DOM.
- **`src/webview/blockActions.ts`** (create) — pure helpers describing the action menu: the three actions, the flattened convert targets, and the unified search. Imports only the `BlockDef` *type*, so it stays DOM-free and unit-testable.
- **`src/webview/blockPicker.ts`** (modify) — add action mode (render action menu + flat "Turn into" list), wire Duplicate/Delete/convert, remove the callout auto-drill. Consumes the two helpers above.
- **`src/webview/styles/board.css`** (modify) — styling for the action rows / separators (reuses existing `.block-picker-*` classes where possible).
- **`tests/board/duplicate.test.ts`** (create) — tests for board duplication.
- **`tests/blockActions.test.ts`** (create) — tests for the action/search helpers.
- **`CHANGELOG.md`** (modify) — document the feature.

---

## Task 1: Board duplication helper (`duplicateBoardSource`)

A board node stores its entire model in a single `source` string attr (`src/webview/extensions/board.ts:34-45`). Card ids (`C<n>`) are scoped *inside* each board's own `<!-- board:start -->…<!-- board:end -->` region, so they never collide across boards — only the board `id` must be unique at the document level. Duplication is therefore: parse → assign a fresh board id → re-serialize.

**Files:**
- Modify: `src/webview/boardModel.ts` (add after `mintCardId`, which ends at line 596)
- Test: `tests/board/duplicate.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/board/duplicate.test.ts`:

```typescript
import { parseBoardSource, duplicateBoardSource, mintBoardId } from '../../src/webview/boardModel';

const SRC = [
  '<!-- board:start id="b-src1" name="My Board" columns="Todo|Doing|Done" column-colors="blue|amber|emerald" field-types="Title=text,Status=status,id=text" hidden-fields="id" -->',
  '',
  '| Title | Status | id |',
  '|---|---|---|',
  '| Alpha | Todo | C1 |',
  '| Beta | Doing | C2 |',
  '',
  '<!-- board:body id="C1" -->',
  '',
  'Body for Alpha',
  '',
  '<!-- board:end -->',
].join('\n');

describe('mintBoardId', () => {
  it('returns a b- prefixed id not in the taken set', () => {
    const id = mintBoardId(['b-aaaa', 'b-bbbb']);
    expect(id).toMatch(/^b-[a-z0-9]{1,4}$/);
    expect(['b-aaaa', 'b-bbbb']).not.toContain(id);
  });
});

describe('duplicateBoardSource', () => {
  it('gives the copy a fresh board id, different from the source', () => {
    const out = duplicateBoardSource(SRC, []);
    const orig = parseBoardSource(SRC);
    const dup = parseBoardSource(out);
    expect(dup.id).not.toBe(orig.id);
    expect(dup.id).toMatch(/^b-/);
  });

  it('never reuses an id already present in the document', () => {
    // Force a collision space of exactly the source id + one other; the new id must avoid both.
    const out = duplicateBoardSource(SRC, ['b-other']);
    const dup = parseBoardSource(out);
    expect(['b-src1', 'b-other']).not.toContain(dup.id);
  });

  it('preserves cards, their ids, values, and bodies verbatim', () => {
    const dup = parseBoardSource(duplicateBoardSource(SRC, []));
    expect(dup.cards.map(c => c.id)).toEqual(['C1', 'C2']);
    expect(dup.cards.map(c => c.values.id)).toEqual(['C1', 'C2']);
    expect(dup.cards[0].body.trim()).toBe('Body for Alpha');
    expect(dup.name).toBe('My Board');
    expect(dup.columns.map(c => c.name)).toEqual(['Todo', 'Doing', 'Done']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/board/duplicate.test.ts`
Expected: FAIL — `duplicateBoardSource` / `mintBoardId` are not exported from boardModel.

- [ ] **Step 3: Implement the helpers**

In `src/webview/boardModel.ts`, add immediately after the `mintCardId` function (after line 596):

```typescript
// Generate a board id (`b-<4 base36 chars>`) not present in `taken`.
// Matches the creation scheme in blockPicker.insertBoardWith, but guarantees
// it differs from existing boards so duplicates never collide at the document
// level (board:start id="…").
export function mintBoardId(taken: Iterable<string>): string {
  const used = new Set(taken);
  let id = `b-${Math.random().toString(36).slice(2, 6)}`;
  while (used.has(id)) id = `b-${Math.random().toString(36).slice(2, 6)}`;
  return id;
}

// Duplicate a board's `source`: parse it, assign a fresh unique board id, and
// re-serialize. Card ids are scoped inside this board's own region, so they are
// preserved as-is — only the board id must be unique across the document.
export function duplicateBoardSource(source: string, takenBoardIds: Iterable<string>): string {
  const board = parseBoardSource(source);
  const taken = new Set(takenBoardIds);
  taken.add(board.id); // never reuse the source board's own id
  const dup: Board = { ...board, id: mintBoardId(taken) };
  return serializeBoard(dup);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/board/duplicate.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts tests/board/duplicate.test.ts
git commit -m "feat(board): duplicateBoardSource + mintBoardId helpers (c2)"
```

---

## Task 2: Action/search helpers (`blockActions.ts`)

These pure functions decide what the action menu shows. `convertibleTargets` flattens `BLOCK_DEFS` into the "Turn into" list (only defs that can actually convert — this is what kills the old silent "insert a new block instead" bug). `searchBlockActions` powers the unified search box. The module imports only the `BlockDef` **type**, so it pulls in no DOM code and runs under the Node test env.

**Files:**
- Create: `src/webview/blockActions.ts`
- Test: `tests/blockActions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/blockActions.test.ts`:

```typescript
import type { BlockDef } from '../src/webview/blockPicker';
import { convertibleTargets, searchBlockActions, BLOCK_ACTIONS } from '../src/webview/blockActions';

// Minimal fixtures exercising the three relevant shapes:
//  - a def with its own convert()        -> a target
//  - a def with subItems that convert     -> each sub is a target (callout-like)
//  - a def with no convert and no subItems -> excluded (toggle-like)
const noop = () => {};
const DEFS: BlockDef[] = [
  { id: 'paragraph', label: 'Paragraph', description: 'Plain text', iconHtml: '', section: 'text',
    insert: noop, convert: noop },
  { id: 'heading1', label: 'Heading 1', description: 'Big heading', iconHtml: '', section: 'text',
    aliases: ['h1', 'title'], insert: noop, convert: noop },
  { id: 'callout', label: 'Callout', description: 'Highlighted box', iconHtml: '', section: 'media',
    subItems: [
      { id: 'callout-note', label: 'Note', description: 'Info', iconHtml: '', section: 'media', convert: noop },
      { id: 'callout-warning', label: 'Warning', description: 'Heads-up', iconHtml: '', section: 'media', convert: noop },
    ] },
  { id: 'toggle', label: 'Toggle', description: 'Collapsible', iconHtml: '', section: 'media', insert: noop },
];

describe('convertibleTargets', () => {
  it('flattens callout sub-items and excludes defs without convert', () => {
    const ids = convertibleTargets(DEFS).map(t => t.id);
    expect(ids).toEqual(['paragraph', 'heading1', 'callout-note', 'callout-warning']);
    expect(ids).not.toContain('toggle');
    expect(ids).not.toContain('callout'); // parent itself has no convert
  });
});

describe('searchBlockActions', () => {
  it('empty query returns all three actions and no flat targets', () => {
    const r = searchBlockActions('', DEFS);
    expect(r.actions).toEqual(BLOCK_ACTIONS);
    expect(r.targets).toEqual([]);
  });

  it('"dup" matches the Duplicate action only', () => {
    const r = searchBlockActions('dup', DEFS);
    expect(r.actions.map(a => a.id)).toEqual(['duplicate']);
    expect(r.targets).toEqual([]);
  });

  it('"h1" surfaces the Heading 1 target via alias, no actions', () => {
    const r = searchBlockActions('h1', DEFS);
    expect(r.actions).toEqual([]);
    expect(r.targets.map(t => t.id)).toEqual(['heading1']);
  });

  it('"warning" surfaces the flattened warning callout target', () => {
    const r = searchBlockActions('warning', DEFS);
    expect(r.targets.map(t => t.id)).toEqual(['callout-warning']);
  });

  it('"delete" matches the Delete action', () => {
    const r = searchBlockActions('delete', DEFS);
    expect(r.actions.map(a => a.id)).toEqual(['delete']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/blockActions.test.ts`
Expected: FAIL — cannot find module `../src/webview/blockActions`.

- [ ] **Step 3: Implement `blockActions.ts`**

Create `src/webview/blockActions.ts`:

```typescript
import type { BlockDef } from './blockPicker';

export type ActionId = 'turn-into' | 'duplicate' | 'delete';

export interface ActionItem {
  id: ActionId;
  label: string;
}

// The three actions the dragger menu offers, in display order.
export const BLOCK_ACTIONS: ActionItem[] = [
  { id: 'turn-into', label: 'Turn into' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'delete',    label: 'Delete' },
];

// Flatten BLOCK_DEFS into the set of "turn into" targets:
//  - a def with its own convert() is a target
//  - a def with subItems contributes each sub-item that has convert()
//    (e.g. the five callout types)
// Defs that are insert-only (Toggle, Divider, Boards, Whiteboard, Image) are
// excluded — converting *into* them isn't supported, so offering them would
// silently insert a new block instead.
export function convertibleTargets(defs: BlockDef[]): BlockDef[] {
  const out: BlockDef[] = [];
  for (const def of defs) {
    if (def.subItems?.length) {
      for (const sub of def.subItems) {
        if (sub.convert) out.push(sub);
      }
    } else if (def.convert) {
      out.push(def);
    }
  }
  return out;
}

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.toLowerCase();
  return fields.some(f => !!f && f.toLowerCase().includes(q));
}

export interface ActionSearchResult {
  actions: ActionItem[]; // matching top-level actions
  targets: BlockDef[];   // matching flattened "turn into" targets
}

// Unified search for the action menu:
//  - empty query  -> all three actions, no flat targets (UI shows the grouped
//                    menu with "Turn into ›")
//  - non-empty    -> actions whose label matches + convert targets whose
//                    label/description/aliases match (so "h1" jumps straight
//                    to Heading 1, "warning" to a Warning callout, etc.)
export function searchBlockActions(query: string, defs: BlockDef[]): ActionSearchResult {
  const q = query.trim();
  if (!q) return { actions: BLOCK_ACTIONS, targets: [] };
  const actions = BLOCK_ACTIONS.filter(a => matches(q, a.label));
  const targets = convertibleTargets(defs).filter(
    t => matches(q, t.label, t.description, ...(t.aliases ?? [])),
  );
  return { actions, targets };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/blockActions.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/blockActions.ts tests/blockActions.test.ts
git commit -m "feat(blocks): pure action-menu + unified-search helpers (c2)"
```

---

## Task 3: Action mode in the block picker (render + Turn into + Delete)

Rework `blockPicker.ts` so that opening over a block (`context.activeBlock` set) shows the action menu instead of the full block list. This task wires **Turn into** (reusing existing `convert()`) and **Delete** (reusing existing `deleteActiveBlock`), and removes the callout auto-drill. Duplicate is added in Task 4.

There is no DOM/editor test harness, so this task is verified by building and exercising the extension.

**Files:**
- Modify: `src/webview/blockPicker.ts`

- [ ] **Step 1: Import the helpers**

At the top of `src/webview/blockPicker.ts`, after the existing imports (line 2), add:

```typescript
import {
  BLOCK_ACTIONS,
  convertibleTargets,
  searchBlockActions,
  type ActionId,
} from './blockActions';
```

- [ ] **Step 2: Add action-mode state and an action icon**

In `createBlockPicker` (after the existing state declarations at lines 448-452), add:

```typescript
  let actionMode = false;   // opened over a block (dragger) -> show action menu
  let turnIntoOpen = false; // inside the flat "Turn into" target list
  // Each rendered row registers its activation callback here, indexed to match
  // the DOM order used by arrow-key navigation. Lets Enter activate any row
  // type (action OR convert target) without a per-type branch in keydown.
  let activeRows: Array<() => void> = [];
```

Add a "turn into" arrow icon to the `ICO` map (insert before the closing `};` at line 146):

```typescript
  turnInto: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M224,128a8,8,0,0,1-8,8H59.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"/></svg>`,
```

- [ ] **Step 3: Add the action-menu renderers**

Insert these functions in `createBlockPicker`, immediately before `renderRow` (before line 557):

```typescript
  // Build one selectable row. `activate` is what runs on click or Enter.
  function makeRow(iconHtml: string, label: string, activate: () => void,
                   opts: { caret?: boolean; current?: boolean; danger?: boolean } = {}): HTMLElement {
    const row = document.createElement('div');
    row.className = 'block-picker-item';
    if (opts.current) row.classList.add('current');
    if (opts.danger) row.classList.add('block-picker-delete');
    row.dataset.idx = String(activeRows.length);
    const check = opts.current ? '<span class="block-picker-current-mark">✓</span>' : '';
    const caret = opts.caret ? '<span class="block-picker-caret">›</span>' : '';
    row.innerHTML = `<span class="block-picker-icon">${iconHtml}</span><span class="block-picker-label">${label}</span>${check}${caret}`;
    row.addEventListener('mousedown', (e) => { e.preventDefault(); activate(); });
    list.appendChild(row);
    activeRows.push(activate);
    return row;
  }

  function runAction(id: ActionId): void {
    if (id === 'turn-into') { openTurnInto(); return; }
    if (id === 'delete')    { deleteActiveBlock(); return; }
    if (id === 'duplicate') { duplicateActiveBlock(); return; }
  }

  const ACTION_ICONS: Record<ActionId, string> = {
    'turn-into': ICO.turnInto,
    'duplicate': ICO.image,  // replaced below in Step 4 of Task 4 with a copy icon
    'delete':    ICO.trash,
  };

  // The dragger action menu. Empty search -> grouped (Turn into › / Duplicate /
  // Delete). Non-empty -> matching actions + flattened convert targets.
  function renderActionMenu(): void {
    list.innerHTML = '';
    activeRows = [];
    const { actions, targets } = searchBlockActions(input.value, BLOCK_DEFS);

    actions.forEach((a) => {
      makeRow(ACTION_ICONS[a.id], a.label, () => runAction(a.id),
        { caret: a.id === 'turn-into' && !input.value.trim() });
      // After "Turn into" in the empty grouped view, add a separator before the
      // remaining actions so it reads as a group.
      if (a.id === 'turn-into' && !input.value.trim() && actions.length > 1) {
        const sep = document.createElement('div');
        sep.className = 'block-picker-sep';
        list.appendChild(sep);
      }
    });

    if (targets.length) {
      const sep = document.createElement('div');
      sep.className = 'block-picker-sep';
      list.appendChild(sep);
      targets.forEach((t) => {
        makeRow(t.iconHtml, t.label, () => convertActive(t), { current: isActiveItem(t) });
      });
    }

    if (!activeRows.length) {
      const empty = document.createElement('div');
      empty.className = 'block-picker-empty';
      empty.textContent = 'No matching actions';
      list.appendChild(empty);
    }
    activeIdx = 0;
    updateActive();
  }

  // The flat "Turn into" target list (reached via the Turn into row).
  function renderTurnInto(): void {
    list.innerHTML = '';
    activeRows = [];
    const back = document.createElement('div');
    back.className = 'block-picker-back';
    back.innerHTML = `<span class="block-picker-back-icon">‹</span><span class="block-picker-back-label">Turn into</span>`;
    back.addEventListener('mousedown', (e) => { e.preventDefault(); closeTurnInto(); });
    list.appendChild(back);

    const q = input.value.toLowerCase().trim();
    const items = convertibleTargets(BLOCK_DEFS).filter(
      t => !q || t.label.toLowerCase().includes(q) ||
           t.description.toLowerCase().includes(q) ||
           (t.aliases ?? []).some(a => a.toLowerCase().includes(q)),
    );
    items.forEach((t) => {
      makeRow(t.iconHtml, t.label, () => convertActive(t), { current: isActiveItem(t) });
    });
    activeIdx = 0;
    updateActive();
  }

  function openTurnInto(): void {
    turnIntoOpen = true;
    input.value = '';
    input.placeholder = 'Turn into…';
    renderTurnInto();
    input.focus();
  }

  function closeTurnInto(): void {
    turnIntoOpen = false;
    input.value = '';
    input.placeholder = 'Search actions…';
    renderActionMenu();
    input.focus();
  }

  // Convert the active block into the target type, or no-op if it already is.
  function convertActive(target: BlockDef): void {
    const ab = context.activeBlock;
    if (!ab) { close(); return; }
    if (isActiveItem(target)) { close(); return; }
    if (target.convert) target.convert(editor, ab.blockPos);
    close();
    setTimeout(() => { editor.commands.focus(); editor.commands.scrollIntoView(); }, 30);
  }
```

> Note: `duplicateActiveBlock` is referenced here but added in Task 4. Until then it will be a TypeScript error — that's expected; Tasks 3 and 4 are committed together is NOT required, but if you build between them, add a temporary `function duplicateActiveBlock(): void { close(); }` stub and remove it in Task 4. (Subagent executing this plan: implement Task 4 before building.)

- [ ] **Step 4: Route `open()` into action mode and drop the callout auto-drill**

Replace the entire `open()` function (lines 706-733) with:

```typescript
  function open(anchorEl: HTMLElement, insertPos: number, ctx: PickerContext = {}): void {
    currentPos = insertPos;
    context = ctx;
    drillParent = null;
    turnIntoOpen = false;
    searchEl.style.display = '';
    input.value = '';

    if (ctx.activeBlock) {
      // Dragger over a block: show the consistent action menu (Turn into /
      // Duplicate / Delete) for every block type. No more callout auto-drill.
      actionMode = true;
      input.placeholder = 'Search actions…';
      renderActionMenu();
    } else {
      // + button / ⌘/ : insert a new block.
      actionMode = false;
      input.placeholder = 'Filter blocks…';
      filtered = BLOCK_DEFS;
      renderList(BLOCK_DEFS);
    }
    el.classList.add('open');
    positionPopover(anchorEl);
  }
```

- [ ] **Step 5: Route the search input and keyboard through action mode**

Replace the `input` "input" handler (lines 675-678) with:

```typescript
  input.addEventListener('input', () => {
    if (actionMode) {
      if (turnIntoOpen) renderTurnInto();
      else renderActionMenu();
      return;
    }
    filtered = filterBlocks(input.value, currentSource());
    renderList(filtered);
  });
```

In the `keydown` handler (lines 680-704), replace the `Enter` and `Escape` branches so they cover action mode. The full replacement handler:

```typescript
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const max = actionMode ? activeRows.length - 1 : filtered.length - 1;
      activeIdx = Math.min(activeIdx + 1, max);
      updateActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      updateActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (actionMode) {
        activeRows[activeIdx]?.();
      } else if (filtered[activeIdx]) {
        select(filtered[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      if (actionMode && turnIntoOpen) {
        e.preventDefault();
        closeTurnInto();
      } else if (drillParent) {
        drillParent = null;
        input.placeholder = 'Filter blocks…';
        input.value = '';
        filtered = BLOCK_DEFS;
        renderList(filtered);
        input.focus();
      } else {
        close();
      }
    }
  });
```

Note: in action mode, arrow nav indexes over `.block-picker-item` rows. The `.block-picker-back` row in the Turn into view is NOT a `.block-picker-item`, so `updateActive()` (lines 569-573, which queries `.block-picker-item`) and `activeRows` stay aligned. Good.

- [ ] **Step 6: Reset action state in `close()`**

In `close()` (lines 748-754), add the two new flags:

```typescript
  function close(): void {
    el.classList.remove('open');
    drillParent = null;
    actionMode = false;
    turnIntoOpen = false;
    context = {};
    input.value = '';
    searchEl.style.display = '';
  }
```

- [ ] **Step 7: Build and verify (after Task 4 supplies `duplicateActiveBlock`)**

Run: `npm run compile` (or the project's build — check `package.json` scripts)
Expected: TypeScript compiles with no errors.

Manual smoke (do this once Task 4 is in): open a document, click the ⠿ dragger on a **callout** → the action menu (Turn into / Duplicate / Delete) appears, *not* the callout type list. Click **Turn into** → flat list with the current callout type checkmarked; pick **Paragraph** → callout becomes a paragraph keeping its text. Press **Esc** in Turn into → back to the action menu. Type **`h1`** in the search → Heading 1 appears directly; Enter converts.

- [ ] **Step 8: Commit (with Task 4)**

Committed together with Task 4 (see Task 4 Step 5).

---

## Task 4: Duplicate action (generic + board)

Add `duplicateActiveBlock`: insert a copy of the captured block right below it. Normal blocks copy verbatim; boards get a fresh id via `duplicateBoardSource`.

**Files:**
- Modify: `src/webview/blockPicker.ts`

- [ ] **Step 1: Import the board helpers**

Add to the `boardModel` imports (or create the import if none exists) at the top of `blockPicker.ts`:

```typescript
import { parseBoardSource, duplicateBoardSource } from './boardModel';
```

- [ ] **Step 2: Add a copy icon**

In the `ICO` map, add (next to `trash`):

```typescript
  copy: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg>`,
```

Then in `ACTION_ICONS` (added in Task 3 Step 3) change the `duplicate` entry from `ICO.image` to:

```typescript
    'duplicate': ICO.copy,
```

- [ ] **Step 3: Implement `duplicateActiveBlock`**

Add this function in `createBlockPicker`, immediately after `deleteActiveBlock` (after line 555). If you added a temporary stub in Task 3, replace it:

```typescript
  // Collect every board id currently in the document, so a duplicated board
  // gets an id that doesn't clash with any existing one.
  function collectBoardIds(): string[] {
    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'board') {
        try { ids.push(parseBoardSource(node.attrs.source as string).id); }
        catch { /* malformed source — skip */ }
      }
      return true;
    });
    return ids;
  }

  function duplicateActiveBlock(): void {
    const ab = context.activeBlock;
    if (!ab) { close(); return; }
    editor.chain().focus().command(({ tr, dispatch }) => {
      const node = tr.doc.nodeAt(ab.blockPos);
      if (!node) return false;
      const insertAt = ab.blockPos + node.nodeSize;
      let copy;
      if (node.type.name === 'board') {
        // Boards must get a fresh id; everything else copies verbatim.
        const newSource = duplicateBoardSource(node.attrs.source as string, collectBoardIds());
        copy = node.type.create({ ...node.attrs, source: newSource }, node.content, node.marks);
      } else {
        copy = node.copy(node.content);
      }
      if (dispatch) tr.insert(insertAt, copy);
      return true;
    }).run();
    close();
    setTimeout(() => { editor.commands.focus(); editor.commands.scrollIntoView(); }, 30);
  }
```

- [ ] **Step 4: Build and run the full manual smoke**

Run: `npm run compile`
Expected: compiles cleanly (no stub, no missing-symbol errors).

Manual verification (run the extension):
- **Callout:** dragger → Turn into / Duplicate / Delete all present and working.
- **Paragraph/heading/list/quote/code/image/toggle:** dragger → same menu; Duplicate makes an identical block below; Delete removes it.
- **Board (kanban + table):** dragger → Duplicate creates a second board below. Edit one board's cards, **save, close, reopen** → the two boards are independent and both render (no card loss, no id clash).
- **Unified search:** type `dup`→Duplicate, `del`→Delete, `warning`→Warning callout target, empty→grouped menu.

- [ ] **Step 5: Commit (Tasks 3 + 4 together)**

```bash
git add src/webview/blockPicker.ts
git commit -m "feat(blocks): Notion-style dragger action menu — Turn into / Duplicate / Delete (c2)"
```

---

## Task 5: Action-menu styling

The new rows reuse existing `.block-picker-item`, `.block-picker-sep`, `.block-picker-caret`, `.block-picker-current-mark`, and `.block-picker-delete` classes, so most styling is already covered. This task adds the small bits that are new: the "No matching actions" empty state, and confirming the danger styling on Delete reads well in the action context.

**Files:**
- Modify: `src/webview/styles/board.css` (or wherever `.block-picker` lives — confirm with `grep -rn "block-picker-delete" src/webview/styles/`)

- [ ] **Step 1: Add the empty-state style**

Append near the other `.block-picker-*` rules:

```css
.block-picker-empty {
  padding: 10px 14px;
  font-size: 13px;
  color: var(--vscode-descriptionForeground, #888);
  opacity: 0.8;
}
```

- [ ] **Step 2: Build and visually confirm**

Run: `npm run compile`
Then in the running extension: open the action menu, type a nonsense query (e.g. `zzz`) → "No matching actions" shows, muted. Confirm Turn into / Duplicate read normally and Delete is visually distinct (existing `.block-picker-delete` red treatment).

- [ ] **Step 3: Commit**

```bash
git add src/webview/styles/board.css
git commit -m "style(blocks): empty state for the dragger action menu (c2)"
```

---

## Task 6: Changelog + final verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: the new `duplicate` and `blockActions` suites pass. (Note: per project memory, one pre-existing `toggle.test.ts` type-check failure is unrelated to this work — confirm it is the *only* failure and matches that known issue.)

- [ ] **Step 2: Add the changelog entry**

Under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md`, add:

```markdown
- **Block dragger menu is consistent for every block type** — clicking the ⠿ handle now opens one Notion-style action menu: **Turn into**, **Duplicate**, and **Delete**, for callouts, boards, toggles, images — everything. Previously some blocks (callouts especially) dropped you straight into their own options with no way back out to convert and no Duplicate/Delete. One search box at the top filters everything at once: leave it empty for the grouped menu, or type to jump straight to an action or a turn-into target (`h1` → Heading 1, `warning` → Warning callout). **Duplicate** copies the block right below it; duplicating a **board** mints a fresh board id so the copy stays independent and saves cleanly.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(c2): changelog for the block dragger action menu"
```

- [ ] **Step 4: Update TODO.md (optional, on the shared file)**

If appropriate, flip C2's Status from `Todo` to `Done` in `TODO.md`. Note this file is shared across tabs and may have uncommitted changes — coordinate before committing it.

---

## Self-Review

**Spec coverage:**
- Two distinct modes (insert vs action) → Task 3 Step 4 (`open()` branches on `activeBlock`). ✓
- Action menu (Turn into / Duplicate / Delete) → Tasks 2-4. ✓
- Unified search (empty=grouped, `dup`, `h1`, `warning`) → Task 2 + Task 3 Step 5. ✓
- Turn into lists only convertible targets; current type checkmarked → `convertibleTargets` (Task 2) + `isActiveItem` (Task 3). ✓
- Callout auto-drill removed → Task 3 Step 4. ✓
- Duplicate verbatim for normal blocks, fresh ids for boards → Tasks 1 + 4. ✓
- Navigation (arrows/Enter; Esc back from Turn into, Esc closes menu) → Task 3 Step 5. ✓
- Files: blockPicker.ts, boardModel.ts/boardOps.ts, styles → covered (boardOps.ts proved unnecessary — the pure helper lives in boardModel.ts, which is where `mintCardId`/`parseBoardSource`/`serializeBoard` already are; noted as a refinement). ✓
- Testing: pure units TDD'd; UI manually verified (no DOM harness) → Tasks 1, 2, 4. ✓
- Out of scope (Color/Copy link/Move to; convert *into* toggle/board; ⌘D/Del accelerators) → not implemented, as specified. ✓

**Refinement vs spec:** The spec proposed re-minting card ids on board duplicate. Investigation showed card ids are scoped inside each board's own `source` region, so they never collide across boards — only the board id must be fresh. The plan therefore re-mints only the board id (simpler, less risk near the known board-parse fragility). Behaviorally identical for the user.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows real code. The one cross-task dependency (`duplicateActiveBlock` referenced in Task 3, defined in Task 4) is called out explicitly with a stub option and a "do Task 4 before building" instruction.

**Type consistency:** `ActionId`, `ActionItem`, `BLOCK_ACTIONS`, `convertibleTargets`, `searchBlockActions`, `ActionSearchResult` are defined in Task 2 and used with matching signatures in Task 3. `duplicateBoardSource(source, takenBoardIds)` / `mintBoardId(taken)` defined in Task 1, called in Task 4 as `duplicateBoardSource(node.attrs.source, collectBoardIds())`. `makeRow` / `runAction` / `convertActive` / `duplicateActiveBlock` / `collectBoardIds` consistently named across Tasks 3-4.
