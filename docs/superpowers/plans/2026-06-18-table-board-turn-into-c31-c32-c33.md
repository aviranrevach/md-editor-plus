# Plain table block, table→board conversion, AI in dragger Turn-into — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a plain Markdown table block to the "+" / Turn-into menus, let a plain table convert into a Board: Table, and surface a "✨ Using AI" section in the dragger ⠿ Turn-into menu.

**Architecture:** Three fixes slotted into the existing menu systems with one new pure helper. `tableToBoardSource` maps a cell grid into a board source string via the existing `serializeBoard`. A new `table` `BlockDef` and a `convert` on the `board-table` `BlockDef` reuse Tiptap's already-registered table extensions and the board node. A shared `buildAiPanelInput` (extracted from the bubble menu) lets the dragger Turn-into open the existing AI transform panel for a block range.

**Tech Stack:** TypeScript (strict), Tiptap/ProseMirror, Jest, esbuild. VS Code webview.

## Global Constraints

- No new runtime dependencies. Reuse `serializeBoard`/`parseBoardSource` (`src/webview/boardModel.ts`), the AI panel (`src/webview/aiTransformPanel.ts`), and the registered Tiptap table extensions (`src/webview/editor.ts`).
- Tests run with `npm test` (Jest). Pure-logic tests import from `../src/webview/...` and instantiate no editor.
- Table→board mapping rules (verbatim): first column → Title field; every other column → `text` field; a hidden `id` field carries per-row card ids; no Status/typed-field auto-detection; board opens in Table view (`activeView: 'table'`).
- Starter plain table is 3×3 (1 header row + 2 body rows, 3 columns).
- The plain table is its own block — never auto-upgraded to a board.
- One pre-existing failing suite (`toggle.test.ts`, a type-check issue) is unrelated; it must not grow and no new failures may be introduced.
- Frequent commits: one per task. DRY, YAGNI, TDD.

---

### Task 1: `tableToBoardSource` pure helper

**Files:**
- Create: `src/webview/tableToBoard.ts`
- Test: `tests/tableToBoard.test.ts`

**Interfaces:**
- Consumes: `serializeBoard(board: Board): string`, `mintCardId(existing: Iterable<string>): string`, and types `Board`, `FieldDef`, `Card` from `./boardModel`.
- Produces: `tableToBoardSource(rows: string[][], boardId: string): string` — `rows[0]` is the header; returns a board source string in table view.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tableToBoard.test.ts
import { tableToBoardSource } from '../src/webview/tableToBoard';
import { parseBoardSource } from '../src/webview/boardModel';

describe('tableToBoardSource', () => {
  it('maps the header row to text fields plus a hidden id', () => {
    const src = tableToBoardSource(
      [['Feature', 'Owner'], ['Dark mode', 'Aviran']],
      'b-test',
    );
    const board = parseBoardSource(src);
    expect(board.fields.map(f => f.name)).toEqual(['Feature', 'Owner', 'id']);
    expect(board.fields.every(f => f.type === 'text')).toBe(true);
    expect(board.fields.find(f => f.name === 'id')!.visibleOnCard).toBe(false);
    expect(board.activeView).toBe('table');
  });

  it('maps each body row to a card with cell values', () => {
    const src = tableToBoardSource(
      [['Feature', 'Owner'], ['Dark mode', 'Aviran'], ['Export PDF', 'Gilad']],
      'b-test',
    );
    const board = parseBoardSource(src);
    expect(board.cards).toHaveLength(2);
    expect(board.cards[0].values.Feature).toBe('Dark mode');
    expect(board.cards[0].values.Owner).toBe('Aviran');
    expect(board.cards[1].values.Feature).toBe('Export PDF');
    expect(board.cards[0].id).not.toBe(board.cards[1].id);
  });

  it('gives blank headers a fallback name', () => {
    const board = parseBoardSource(tableToBoardSource([['', 'Notes'], ['a', 'b']], 'b-test'));
    expect(board.fields[0].name).toBe('Column 1');
  });

  it('produces a parseable starter board for an empty grid', () => {
    const board = parseBoardSource(tableToBoardSource([], 'b-empty'));
    expect(board.id).toBe('b-empty');
    expect(board.fields[0].name).toBe('Title');
    expect(board.cards).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tableToBoard`
Expected: FAIL — `Cannot find module '../src/webview/tableToBoard'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/webview/tableToBoard.ts
import {
  type Board,
  type FieldDef,
  type Card,
  serializeBoard,
  mintCardId,
} from './boardModel';

// Map a 2-D grid of cell strings (first row = header) into a board source
// string in table view. First column becomes the Title field; every other
// column is a plain text field; a hidden `id` field carries per-row card ids.
// No Status/typed-field detection — the user retypes a column later. An empty
// or header-less grid yields a parseable single-field starter board.
export function tableToBoardSource(rows: string[][], boardId: string): string {
  const header = rows[0] ?? [];
  const bodyRows = rows.slice(1);

  const names = header.map((h, i) => h.trim() || `Column ${i + 1}`);
  if (names.length === 0) names.push('Title');

  const fields: FieldDef[] = names.map((name) => ({
    name,
    type: 'text',
    visibleOnCard: true,
  }));
  fields.push({ name: 'id', type: 'text', visibleOnCard: false });

  const ids = new Set<string>();
  const cards: Card[] = bodyRows.map((cells) => {
    const id = mintCardId(ids);
    ids.add(id);
    const values: Record<string, string> = { id };
    names.forEach((name, i) => { values[name] = (cells[i] ?? '').trim(); });
    return { id, values, body: '' };
  });

  const board: Board = {
    id: boardId,
    name: '',
    columns: [],          // no kanban lanes — opens in table view
    fields,
    cards,
    orphanBodies: [],
    views: [{ name: 'table' }],
    activeView: 'table',
  };
  return serializeBoard(board);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tableToBoard`
Expected: PASS (4 tests). If `parseBoardSource` forces a field literally named `Status` to type `status`, that is why the first test uses neutral names (`Feature`, `Owner`) — keep it that way.

- [ ] **Step 5: Commit**

```bash
git add src/webview/tableToBoard.ts tests/tableToBoard.test.ts
git commit -m "feat(c31): tableToBoardSource — map a cell grid into a table-view board"
```

---

### Task 2: `board-table` convert (plain table → Board)

**Files:**
- Modify: `src/webview/blockPicker.ts` (imports near line 1-8; add module-level helpers; add `convert` to the `board-table` `BlockDef` at ~line 400-406)

**Interfaces:**
- Consumes: `tableToBoardSource` (Task 1); `mintBoardId`, `parseBoardSource` from `./boardModel`; `Node as ProseMirrorNode` from `@tiptap/pm/model`.
- Produces: a `convert(editor, blockPos)` on `board-table` so it appears as a Turn-into target (via `convertibleTargets`, which selects any def with `convert`).

- [ ] **Step 1: Add imports and module-level helpers**

In `src/webview/blockPicker.ts`, extend the `boardModel` import and add the pm/model import:

```ts
import { parseBoardSource, duplicateBoardSource, mintBoardId } from './boardModel';
import { tableToBoardSource } from './tableToBoard';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
```

Add these helpers next to `replaceBlockWith` (after line ~104, module scope):

```ts
// Every board id currently in the doc — so a converted board gets a fresh id.
function existingBoardIds(editor: Editor): string[] {
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

// Read a ProseMirror table node into a row-major grid of trimmed cell text.
function tableNodeToMatrix(node: ProseMirrorNode): string[][] {
  const rows: string[][] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => { cells.push((cell.textContent ?? '').trim()); });
    rows.push(cells);
  });
  return rows;
}

// Turn the block at blockPos into a Board: Table. A table maps cell-by-cell;
// any other block seeds a one-card board from its text so nothing is dropped.
function convertTableToBoard(editor: Editor, blockPos: number): void {
  const boardId = mintBoardId(existingBoardIds(editor));
  editor.chain().focus().command(({ tr, state, dispatch }) => {
    const node = tr.doc.nodeAt(blockPos);
    if (!node) return false;
    const boardType = state.schema.nodes.board;
    if (!boardType) return false;
    let matrix: string[][];
    if (node.type.name === 'table') {
      matrix = tableNodeToMatrix(node);
    } else {
      const text = (node.textContent ?? '').trim();
      matrix = text ? [['Title'], [text]] : [];
    }
    const source = tableToBoardSource(matrix, boardId);
    const boardNode = boardType.create({ source });
    if (dispatch) tr.replaceWith(blockPos, blockPos + node.nodeSize, boardNode);
    return true;
  }).run();
}
```

- [ ] **Step 2: Add the `convert` to the board-table def**

In the `board-table` `BlockDef` (~line 400-406), add the `convert` line:

```ts
  {
    id: 'board-table',
    label: 'Board: Table',
    description: 'Table board: rows, columns, inline editing',
    iconHtml: ICO.board,
    section: 'lists',
    aliases: ['board', 'database', 'board table'],
    insert: (editor, pos) => insertBoardWith('table', editor, pos),
    convert: (editor, blockPos) => convertTableToBoard(editor, blockPos),
  },
```

(Note: the `table` and `grid` aliases are intentionally dropped here — that is Task 3's disambiguation. Apply it now since you are editing this def.)

- [ ] **Step 3: Type-check and run the full suite**

Run: `npm run compile && npm test`
Expected: compiles clean; suite green except the known pre-existing `toggle.test.ts` failure. No new failures.

- [ ] **Step 4: Manual smoke**

Build the extension, open a markdown file, insert a small table, open the dragger ⠿ → Turn into → **Board: Table**. Expected: the table becomes a board in table view with one card per body row, first column as Title.

- [ ] **Step 5: Commit**

```bash
git add src/webview/blockPicker.ts
git commit -m "feat(c31): convert a plain table into a Board: Table from Turn-into"
```

---

### Task 3: Plain `table` block in the + / Turn-into menus

**Files:**
- Modify: `src/webview/blockPicker.ts` (add `ICO.table`; add table insert/convert helpers; add the `table` `BlockDef`)
- Test: `tests/blockPickerTable.test.ts`

**Interfaces:**
- Consumes: `filterBlocks` and `BLOCK_DEFS` from `./blockPicker`; `convertibleTargets` from `./blockActions`.
- Produces: a `table` `BlockDef` with `insert` (3×3 starter) and `convert` (wrap block text into the first cell).

- [ ] **Step 1: Write the failing test**

```ts
// tests/blockPickerTable.test.ts
import { BLOCK_DEFS, filterBlocks } from '../src/webview/blockPicker';
import { convertibleTargets } from '../src/webview/blockActions';

describe('plain table block', () => {
  it('exists as its own block distinct from Board: Table', () => {
    const ids = BLOCK_DEFS.map(b => b.id);
    expect(ids).toContain('table');
    expect(ids).toContain('board-table');
  });

  it('surfaces both plain and board table when searching "table"', () => {
    const hits = filterBlocks('table').map(b => b.id);
    expect(hits).toContain('table');
    expect(hits).toContain('board-table');
  });

  it('is a convertible Turn-into target', () => {
    expect(convertibleTargets(BLOCK_DEFS).some(t => t.id === 'table')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- blockPickerTable`
Expected: FAIL — `expect(ids).toContain('table')` fails (no plain table block yet).

- [ ] **Step 3: Add the icon and helpers**

Add to the `ICO` object (`src/webview/blockPicker.ts` ~line 131-154):

```ts
  table: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48ZM40,112H80v32H40Zm56,0H216v32H96ZM216,64V96H40V64ZM40,160H80v32H40Zm176,32H96V160H216v32Z"/></svg>`,
```

Add table-builder helpers near the other block helpers (module scope, after `convertToList`):

```ts
function tableCellNode(text: string, header: boolean) {
  return {
    type: header ? 'tableHeader' : 'tableCell',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  };
}
function tableRowJson(cells: string[], header: boolean) {
  return { type: 'tableRow', content: cells.map((c) => tableCellNode(c, header)) };
}
function starterTableJson(firstCell = '') {
  return {
    type: 'table',
    content: [
      tableRowJson(['Column 1', 'Column 2', 'Column 3'], true),
      tableRowJson([firstCell, '', ''], false),
      tableRowJson(['', '', ''], false),
    ],
  };
}
function insertStarterTable(editor: Editor, pos: number): void {
  editor.chain().focus().insertContentAt(pos, starterTableJson()).run();
}
function convertToTable(editor: Editor, blockPos: number): void {
  editor.chain().focus().command(({ tr, state, dispatch }) => {
    const node = tr.doc.nodeAt(blockPos);
    if (!node) return false;
    if (!state.schema.nodes.table) return false;
    const text = (node.textContent ?? '').trim();
    const newNode = state.schema.nodeFromJSON(starterTableJson(text));
    if (dispatch) tr.replaceWith(blockPos, blockPos + node.nodeSize, newNode);
    return true;
  }).run();
}
```

- [ ] **Step 4: Add the `table` BlockDef**

Insert this entry into `BLOCK_DEFS` just before the `board-kanban` entry (~line 390):

```ts
  {
    id: 'table',
    label: 'Table',
    description: 'Simple grid — a plain markdown table',
    iconHtml: ICO.table,
    section: 'other',
    aliases: ['table', 'grid', 'markdown table', 'rows', 'columns'],
    isActive: (t) => t === 'table',
    insert: (editor, pos) => insertStarterTable(editor, pos),
    convert: (editor, blockPos) => convertToTable(editor, blockPos),
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- blockPickerTable`
Expected: PASS (3 tests).

- [ ] **Step 6: Type-check + manual smoke**

Run: `npm run compile`
Then in the app: type `/table` in the + menu → see **Table** and **Board: Table**; pick **Table** → a 3×3 table appears. On a paragraph, dragger ⠿ → Turn into → **Table** wraps its text into the first cell.

- [ ] **Step 7: Commit**

```bash
git add src/webview/blockPicker.ts tests/blockPickerTable.test.ts
git commit -m "feat(c32): plain Markdown table block in the + and Turn-into menus"
```

---

### Task 4: Extract a shared AI-launch helper

**Files:**
- Modify: `src/webview/aiSelection.ts` (add `buildAiPanelInput`)
- Modify: `src/webview/bubbleMenu.ts` (`openAiPanel` ~line 290-313 uses the helper)

**Interfaces:**
- Consumes: existing `summarizeSelection`, `locateAnchors`, `truncateAnchor` (same file); `getDocumentPath` from `./docContext`; `AiTarget` from `./aiTransforms`.
- Produces: `buildAiPanelInput(editor, target, label, from, to): AiPanelInput` — the exact payload `aiTransformPanel.open(...)` expects.

- [ ] **Step 1: Add the helper to `aiSelection.ts`**

```ts
import type { Editor } from '@tiptap/core';
import type { AiTarget } from './aiTransforms';
import { getDocumentPath } from './docContext';

export interface AiPanelInput {
  target: AiTarget;
  targetLabel: string;
  filePath: string;
  startText: string;
  endText: string;
  startLine: number;
  endLine: number;
  summary: string;
}

// Build the AI-transform panel payload for an arbitrary document range. Shared
// by the selection bubble menu and the dragger "Turn into" so both compute
// anchors and line hints identically.
export function buildAiPanelInput(
  editor: Editor, target: AiTarget, label: string, from: number, to: number,
): AiPanelInput {
  const slice = editor.state.doc.textBetween(from, to, '\n', '\n');
  const nonEmpty = slice.split('\n').filter((l) => l.trim().length > 0);
  const startRaw = nonEmpty[0] ?? '';
  const endRaw   = nonEmpty[nonEmpty.length - 1] ?? startRaw;
  const md = editor.storage.markdown.getMarkdown() as string;
  const { startLine, endLine } = locateAnchors(md, startRaw, endRaw);
  return {
    target,
    targetLabel: label,
    filePath: getDocumentPath() || 'this file',
    startText: truncateAnchor(startRaw),
    endText: truncateAnchor(endRaw),
    startLine,
    endLine,
    summary: summarizeSelection(slice),
  };
}
```

(If `aiSelection.ts` already imports any of these symbols, merge — do not duplicate import lines.)

- [ ] **Step 2: Use it in `bubbleMenu.ts`**

Replace the body of `openAiPanel` (lines ~290-319) so it builds the payload from the current selection via the helper, preserving the trailing `closeAi/closeInto/setTextSelection`:

```ts
  function openAiPanel(target: AiTarget, label: string): void {
    const { from, to } = editor.state.selection;
    aiTransformPanel.open(buildAiPanelInput(editor, target, label, from, to));
    closeAi();
    closeInto();
    // Collapse the selection so the bubble menu hides behind the panel.
    editor.commands.setTextSelection(to);
  }
```

Add the import (merge with the existing `./aiSelection` import):

```ts
import { summarizeSelection, locateAnchors, truncateAnchor, buildAiPanelInput } from './aiSelection';
```

Remove now-unused imports only if the compiler flags them.

- [ ] **Step 3: Type-check + run the AI/bubble suite**

Run: `npm run compile && npm test`
Expected: compiles clean; all previously-green suites (including anything under `tests/ai/`) stay green. Behavior is identical — this is a pure extraction.

- [ ] **Step 4: Commit**

```bash
git add src/webview/aiSelection.ts src/webview/bubbleMenu.ts
git commit -m "refactor: extract buildAiPanelInput for reuse across Turn-into surfaces"
```

---

### Task 5: "✨ Using AI" section in the dragger Turn-into

**Files:**
- Modify: `src/webview/blockPicker.ts` (imports; create an AI panel in `createBlockPicker`; extend `renderTurnInto` ~line 626-646; add `convertActiveWithAi`)

**Interfaces:**
- Consumes: `AI_TRANSFORMS`, `type AiTarget` from `./aiTransforms`; `createAiTransformPanel` from `./aiTransformPanel`; `buildAiPanelInput` from `./aiSelection` (Task 4); `context.activeBlock` (`{ blockPos, typeName, attrs }`).
- Produces: AI rows in the dragger Turn-into that open the existing AI panel for the active block's range.

- [ ] **Step 1: Add imports**

```ts
import { AI_TRANSFORMS, type AiTarget } from './aiTransforms';
import { createAiTransformPanel } from './aiTransformPanel';
import { buildAiPanelInput } from './aiSelection';
```

- [ ] **Step 2: Create the panel and the AI-convert function inside `createBlockPicker`**

After the existing `const context: PickerContext = {};` / state declarations (~line 460), add:

```ts
  const aiTransformPanel = createAiTransformPanel();

  function convertActiveWithAi(target: AiTarget, label: string): void {
    const ab = context.activeBlock;
    if (!ab) { close(); return; }
    const node = editor.state.doc.nodeAt(ab.blockPos);
    const from = ab.blockPos;
    const to = node ? ab.blockPos + node.nodeSize : ab.blockPos;
    aiTransformPanel.open(buildAiPanelInput(editor, target, label, from, to));
    close();
  }
```

- [ ] **Step 3: Append the AI section in `renderTurnInto`**

In `renderTurnInto` (~line 626-646), after the existing `items.forEach(...)` block that renders convert targets and **before** `activeIdx = 0; updateActive();`, add:

```ts
    const aiItems = AI_TRANSFORMS.filter(
      (t) => !q || t.label.toLowerCase().includes(q),
    );
    if (aiItems.length) {
      const sub = document.createElement('div');
      sub.className = 'block-picker-section-label';
      sub.textContent = '✨ Using AI';
      list.appendChild(sub);
      aiItems.forEach((t) => {
        makeRow(t.iconHtml, t.label, () => convertActiveWithAi(t.id, t.label));
      });
    }
```

(`q` is the existing lowercased query already computed at the top of `renderTurnInto`.)

- [ ] **Step 4: Type-check**

Run: `npm run compile`
Expected: compiles clean.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: green except the known pre-existing `toggle.test.ts` failure; no new failures.

- [ ] **Step 6: Manual smoke**

In the app: open the dragger ⠿ on any block → **Turn into**. Expected: the regular targets, then an **✨ Using AI** label followed by the AI targets (Ask AI…, Table, Board: Kanban, Board: Table, …). Clicking one opens the AI transform panel scoped to that block. Filtering by typing narrows both regular and AI rows.

- [ ] **Step 7: Commit**

```bash
git add src/webview/blockPicker.ts
git commit -m "feat(c33): add ✨ Using AI section to the dragger Turn-into menu"
```

---

## Self-Review

**Spec coverage:**
- c32 (plain table in + / Turn-into) → Task 3 (and alias disambiguation folded into Task 2/3). ✓
- c31 (table → Board: Table) → Task 1 (mapping) + Task 2 (convert wiring). ✓
- c33 (AI in dragger Turn-into) → Task 4 (shared launcher) + Task 5 (UI section). ✓
- Out-of-scope items (reverse conversion, kanban↔table view switch, typed-field detection) are not implemented. ✓

**Type consistency:** `tableToBoardSource(rows, boardId)` defined in Task 1 is called with the same signature in Task 2. `buildAiPanelInput(editor, target, label, from, to)` defined in Task 4 is called identically in Task 5 and the refactored bubble menu. `convertibleTargets` selects any def with `convert`, so the Task 2/3 `convert` methods are what list them as Turn-into targets. `context.activeBlock` shape (`blockPos`/`typeName`/`attrs`) matches existing usage in `isActiveItem`.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the command and expected outcome.
