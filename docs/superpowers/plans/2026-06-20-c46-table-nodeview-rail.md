# c46 Table NodeView + Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give regular markdown tables a Notion-style row affordance — a rail attached to the table's left edge with a reachable `⠿` grip (click → select row + open menu, drag → reorder) plus a visible cell-selection state — by rendering the table through a NodeView whose `contentDOM` is the untouched table.

**Architecture:** Extend the TipTap `Table` extension with a NodeView. The NodeView's `dom` is a wrapper containing a left rail (chrome, `contentEditable=false`) and the real `<table>`; its `contentDOM` is the table's `<tbody>`, so the content model and markdown serialization are unchanged. The rail hosts one reused grip positioned at the hovered row. Row mutations reuse the already-tested `tableRowOps` (pure) and `tableRowTx` (transactions). Cell selection uses ProseMirror's native `CellSelection` (bundled by TipTap's `tableEditing`); we add the styling and create a row selection on grip click.

**Tech Stack:** TypeScript, TipTap/ProseMirror (`@tiptap/extension-table`, `@tiptap/pm/tables`, `@tiptap/pm/state`), jsdom + Jest. No new dependencies.

## Global Constraints

- Regular markdown tables only. Board tables (`.bd-table`) and code blocks are untouched. Column handles are **out of scope** (phase 2).
- `contentDOM` must be the real `<tbody>`; never mutate the table's content from the chrome — markdown round-trip must stay lossless (the c37/c48 guard).
- Reuse existing components: `createMenu` (`./menu`), `createGripIcon` (`./handleIcons`), `placeFloating` via the popover (inside `createMenu`). Do NOT hand-roll a menu or positioning.
- Manual mouse drag (mousedown/mousemove/mouseup); ProseMirror intercepts HTML5 `dragstart`. The drop-line element is parented to `document.body`, never inside the NodeView.
- Header row stays first and present: not draggable, menu = Insert row below only (enforced by `tableRowOps.rowMenuModel` + `tableRowTx` guards).
- The margin block handle (`GlobalDragHandle`, `＋ ⠿`) must keep working for whole-table moves — do not suppress it.
- Run `npx tsc --noEmit` and `npm test`. Baseline has pre-existing failing suite(s) (`tests/board/grouping.test.ts`; a sibling `.worktrees/` checkout may add noise) — add no NEW failures. Run jest with `--testPathIgnorePatterns '/node_modules/' '/.worktrees/'` to scope to this checkout.

---

## File Structure

- `src/webview/tableNodeView.ts` — **create**: the `TableWithRail` extension (Table + addNodeView), the NodeView (wrapper/rail/grip/drag/menu/row-selection), helper `rowCellRange`.
- `src/webview/tableRowOps.ts` — **keep unchanged** (pure: `reorderRows`, `clampInsertIndex`, `rowMenuModel`, `canDragRow`, `ROW_MENU_LABEL`).
- `src/webview/tableRowTx.ts` — **keep unchanged** (transactions: `findTableAround`, `findFirstTable`, `isHeaderRow`, `moveRow`, `duplicateRow`, `insertRowRelative`, `deleteRowAt`).
- `src/webview/editor.ts` — **modify**: import `TableWithRail`, use it in place of `Table.configure(...)`; remove the `createTableRowHandle` import, the `_tableRowHandleDispose` variable, and its calls in `createEditor`/`destroyEditor`.
- `src/webview/tableRowHandle.ts` — **delete** (floating-grip DOM layer, replaced).
- `tests/tableRowHandle.test.ts` — **delete** (replaced by `tableNodeView.test.ts`).
- `tests/tableNodeView.test.ts` — **create**: real-editor DOM + round-trip tests.
- `src/webview/styles/editor.css` — **modify**: rail/grip/drop-line styles, `.selectedCell` + active-cell styling; remove dead `.tbl-row-handle` / `body.tbl-row-active` rules; print-hide.

---

## Task 1: Table NodeView skeleton (wrapper + rail + contentDOM), round-trip safe

**Files:**
- Create: `src/webview/tableNodeView.ts`
- Modify: `src/webview/editor.ts`
- Delete: `src/webview/tableRowHandle.ts`, `tests/tableRowHandle.test.ts`
- Test: `tests/tableNodeView.test.ts`

**Interfaces:**
- Consumes: `@tiptap/extension-table` default `Table`.
- Produces: `TableWithRail` (a TipTap `Node` extension) — drop-in replacement for `Table.configure({ resizable: false })` exporting the same node with an added NodeView.

- [ ] **Step 1: Write the failing test**

Create `tests/tableNodeView.test.ts`:

```typescript
/**
 * @jest-environment jsdom
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { TableWithRail } from '../src/webview/tableNodeView';

const TABLE_MD = [
  '| H1 | H2 |',
  '| --- | --- |',
  '| a1 | a2 |',
  '| b1 | b2 |',
].join('\n');

function makeEditor(md = TABLE_MD): { editor: Editor; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      TableWithRail.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
      Markdown.configure({ transformCopiedText: true }),
    ],
    content: md,
  });
  return { editor, host };
}

describe('TableWithRail NodeView (c46)', () => {
  it('renders the table inside a .mp-table wrapper with a rail and keeps the rows', () => {
    const { editor, host } = makeEditor();
    const wrap = host.querySelector('.mp-table');
    expect(wrap).toBeTruthy();
    expect(wrap!.querySelector('.mp-table-rail')).toBeTruthy();
    expect(wrap!.querySelectorAll('table tbody tr').length).toBe(3); // header + 2 body
    editor.destroy(); host.remove();
  });

  it('serializes the table losslessly through the NodeView', () => {
    const { editor, host } = makeEditor();
    const out = editor.storage.markdown.getMarkdown() as string;
    expect(out).toContain('H1');
    expect(out).toContain('a1');
    expect(out).toContain('b2');
    editor.destroy(); host.remove();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/tableNodeView.test.ts`
Expected: FAIL — `Cannot find module '../src/webview/tableNodeView'`.

- [ ] **Step 3: Create the NodeView skeleton**

Create `src/webview/tableNodeView.ts`:

```typescript
// c46 — regular markdown tables rendered through a NodeView so a rail can hug
// the table's left edge (reachable row grip) without changing the content
// model. contentDOM is the real <tbody>, so markdown round-trip is unchanged.
import Table from '@tiptap/extension-table';
import { mergeAttributes } from '@tiptap/core';

export const TableWithRail = Table.extend({
  addNodeView() {
    return ({ HTMLAttributes }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'mp-table';

      const rail = document.createElement('div');
      rail.className = 'mp-table-rail';
      rail.contentEditable = 'false';
      rail.setAttribute('aria-hidden', 'true');

      const table = document.createElement('table');
      const attrs = mergeAttributes(HTMLAttributes);
      for (const [k, v] of Object.entries(attrs)) {
        if (v != null) table.setAttribute(k, String(v));
      }
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);

      wrapper.appendChild(rail);
      wrapper.appendChild(table);

      return {
        dom: wrapper,
        contentDOM: tbody,
        ignoreMutation(mutation) {
          const t = mutation.target as Node;
          // Keep rail chrome mutations out of ProseMirror.
          return t === rail || rail.contains(t);
        },
      };
    };
  },
});

export default TableWithRail;
```

- [ ] **Step 4: Wire into the editor**

In `src/webview/editor.ts`:
1. Replace the import `import Table from '@tiptap/extension-table';` with:
```typescript
import { TableWithRail } from './tableNodeView';
```
2. In the `extensions` array, replace `Table.configure({ resizable: false }),` with:
```typescript
      TableWithRail.configure({ resizable: false }),
```
3. Remove the line `import { createTableRowHandle } from './tableRowHandle';`.
4. Remove the declaration block:
```typescript
// Teardown for the regular-table row handle (c46). Attached only to the PRIMARY
// editor (not detached side-panel editors) so there's a single floating grip.
let _tableRowHandleDispose: (() => void) | null = null;
```
5. In `createEditor`, remove the two lines:
```typescript
  _tableRowHandleDispose?.();
  _tableRowHandleDispose = createTableRowHandle(built.editor);
```
6. In `destroyEditor`, remove:
```typescript
  _tableRowHandleDispose?.();
  _tableRowHandleDispose = null;
```

- [ ] **Step 5: Delete the replaced floating-grip module + its test**

```bash
git rm src/webview/tableRowHandle.ts tests/tableRowHandle.test.ts
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest tests/tableNodeView.test.ts`
Expected: PASS (both cases).

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (no references to the deleted module remain).

- [ ] **Step 8: Commit**

```bash
git add src/webview/tableNodeView.ts src/webview/editor.ts tests/tableNodeView.test.ts
git commit -m "feat(c46): Table NodeView with attached rail (round-trip safe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Grip shows on row hover; hidden in read-only

**Files:**
- Modify: `src/webview/tableNodeView.ts`
- Test: `tests/tableNodeView.test.ts`

**Interfaces:**
- Consumes: the NodeView from Task 1; `createGripIcon` from `./handleIcons`.
- Produces: a `.mp-table-rail-grip` element inside the rail, shown (display `flex`) when an editable row is hovered, hidden otherwise. Internal: `resolveRow(target, clientY)` → `{ tr, rowIdx } | null`.

- [ ] **Step 1: Write the failing test**

Add to `tests/tableNodeView.test.ts`:

```typescript
describe('TableWithRail grip hover (c46)', () => {
  function grip(host: HTMLElement) { return host.querySelector('.mp-table-rail-grip') as HTMLElement; }

  it('reveals the grip when a row is hovered', () => {
    const { editor, host } = makeEditor();
    const cell = host.querySelector('table tbody tr td')!;
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    expect(grip(host).style.display).toBe('flex');
    editor.destroy(); host.remove();
  });

  it('keeps the grip hidden in read-only documents', () => {
    const { editor, host } = makeEditor();
    editor.setEditable(false);
    const cell = host.querySelector('table tbody tr td')!;
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    expect(grip(host).style.display).toBe('none');
    editor.destroy(); host.remove();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/tableNodeView.test.ts -t 'grip hover'`
Expected: FAIL — `.mp-table-rail-grip` not found / display not toggled.

- [ ] **Step 3: Add the grip + hover wiring**

In `src/webview/tableNodeView.ts`, add the import:

```typescript
import { createGripIcon } from './handleIcons';
```

Change the NodeView factory to accept `editor` and build the grip + hover handling. Replace the `return ({ HTMLAttributes }) => {` factory body so it reads:

```typescript
    return ({ editor, HTMLAttributes }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'mp-table';

      const rail = document.createElement('div');
      rail.className = 'mp-table-rail';
      rail.contentEditable = 'false';
      rail.setAttribute('aria-hidden', 'true');

      const grip = document.createElement('div');
      grip.className = 'mp-table-rail-grip';
      grip.style.display = 'none';
      grip.appendChild(createGripIcon());
      rail.appendChild(grip);

      const table = document.createElement('table');
      const attrs = mergeAttributes(HTMLAttributes);
      for (const [k, v] of Object.entries(attrs)) {
        if (v != null) table.setAttribute(k, String(v));
      }
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);

      wrapper.appendChild(rail);
      wrapper.appendChild(table);

      let activeTr: HTMLTableRowElement | null = null;

      // Resolve the row under the pointer. Over a cell → its <tr>; over the rail
      // → hit-test row rects by Y (the rail has no cells of its own).
      function resolveRow(target: Element | null, clientY: number): HTMLTableRowElement | null {
        const direct = target?.closest('tr') as HTMLTableRowElement | null;
        if (direct && tbody.contains(direct)) return direct;
        for (const tr of Array.from(tbody.children) as HTMLTableRowElement[]) {
          const r = tr.getBoundingClientRect();
          if (clientY >= r.top && clientY <= r.bottom) return tr;
        }
        return null;
      }

      function positionGrip(tr: HTMLTableRowElement): void {
        const railRect = rail.getBoundingClientRect();
        const r = tr.getBoundingClientRect();
        const gh = grip.offsetHeight || 22;
        grip.style.top = `${r.top - railRect.top + r.height / 2 - gh / 2}px`;
      }

      function onWrapperMove(e: MouseEvent): void {
        if (dragSrc) return;
        if (editor.isDestroyed || !editor.isEditable) { grip.style.display = 'none'; activeTr = null; return; }
        const tr = resolveRow(e.target as Element | null, e.clientY);
        if (!tr) { grip.style.display = 'none'; activeTr = null; return; }
        activeTr = tr;
        grip.style.display = 'flex';
        positionGrip(tr);
      }
      wrapper.addEventListener('mousemove', onWrapperMove);
      wrapper.addEventListener('mouseleave', () => { if (!dragSrc) { grip.style.display = 'none'; activeTr = null; } });

      // Placeholder — drag/click wired in Tasks 3 & 4.
      let dragSrc: unknown = null;

      return {
        dom: wrapper,
        contentDOM: tbody,
        ignoreMutation(mutation) {
          const t = mutation.target as Node;
          return t === rail || rail.contains(t);
        },
        destroy() {
          wrapper.removeEventListener('mousemove', onWrapperMove);
        },
      };
    };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/tableNodeView.test.ts -t 'grip hover'`
Expected: PASS. (jsdom rects are 0, so `resolveRow` succeeds via `target.closest('tr')` when hovering a cell; the rail-only Y hit-test is exercised on F5.)

- [ ] **Step 5: Type-check + commit**

Run: `npx tsc --noEmit` (expected clean).

```bash
git add src/webview/tableNodeView.ts tests/tableNodeView.test.ts
git commit -m "feat(c46): rail grip appears on row hover, hidden when read-only

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Grip click → select the row (CellSelection) + open the row menu

**Files:**
- Modify: `src/webview/tableNodeView.ts`
- Test: `tests/tableNodeView.test.ts`

**Interfaces:**
- Consumes: `getPos` from the NodeView props; `rowMenuModel`/`canDragRow`/`ROW_MENU_LABEL` (`./tableRowOps`); `moveRow`/`duplicateRow`/`insertRowRelative`/`deleteRowAt` (`./tableRowTx`); `createMenu` (`./menu`); `CellSelection` (`@tiptap/pm/tables`).
- Produces: clicking the grip (no drag) dispatches a `CellSelection` across the row and opens a `createMenu` instance with the row actions; `rowCellRange(table, tablePos, rowIdx)` → `{ anchorPos, headPos }`.

- [ ] **Step 1: Write the failing test**

Add to `tests/tableNodeView.test.ts`:

```typescript
import { __closeAllForTest } from '../src/webview/popover';
import { ROW_MENU_LABEL } from '../src/webview/tableRowOps';

describe('TableWithRail row menu (c46)', () => {
  function clickGripOnRow(host: HTMLElement, rowIdx: number): void {
    const rows = host.querySelectorAll('table tbody tr');
    const cell = rows[rowIdx].querySelector('th, td')!;
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    const grip = host.querySelector('.mp-table-rail-grip')!;
    grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 5, clientY: 5 }));
  }
  function labels(): (string | null)[] {
    return Array.from(document.querySelectorAll('.mp-menu .mp-menu-label')).map(el => el.textContent);
  }
  afterEach(() => { __closeAllForTest(); document.querySelectorAll('.mp-menu').forEach(e => e.remove()); });

  it('opens the full menu on a body row', () => {
    const { editor, host } = makeEditor();
    clickGripOnRow(host, 1);
    expect(labels()).toEqual([
      ROW_MENU_LABEL['insert-above'], ROW_MENU_LABEL['insert-below'],
      ROW_MENU_LABEL['duplicate'], ROW_MENU_LABEL['delete'],
    ]);
    editor.destroy(); host.remove();
  });

  it('restricts the header row menu to Insert row below', () => {
    const { editor, host } = makeEditor();
    clickGripOnRow(host, 0);
    expect(labels()).toEqual([ROW_MENU_LABEL['insert-below']]);
    editor.destroy(); host.remove();
  });

  it('Delete row removes the row', () => {
    const { editor, host } = makeEditor();
    const before = host.querySelectorAll('table tbody tr').length;
    clickGripOnRow(host, 1);
    const del = Array.from(document.querySelectorAll('.mp-menu .mp-menu-item'))
      .find(el => el.textContent?.includes(ROW_MENU_LABEL['delete']))!;
    del.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(host.querySelectorAll('table tbody tr').length).toBe(before - 1);
    editor.destroy(); host.remove();
  });

  it('Duplicate row clones it directly below', () => {
    const { editor, host } = makeEditor();
    clickGripOnRow(host, 1);
    const dup = Array.from(document.querySelectorAll('.mp-menu .mp-menu-item'))
      .find(el => el.textContent?.includes(ROW_MENU_LABEL['duplicate']))!;
    dup.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const firsts = Array.from(host.querySelectorAll('table tbody tr'))
      .map(tr => tr.querySelector('th,td')?.textContent);
    expect(firsts).toEqual(['H1', 'a1', 'a1', 'b1']);
    editor.destroy(); host.remove();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/tableNodeView.test.ts -t 'row menu'`
Expected: FAIL — no `.mp-menu` appears on grip click.

- [ ] **Step 3: Implement click → row selection + menu**

In `src/webview/tableNodeView.ts`, add imports:

```typescript
import { CellSelection } from '@tiptap/pm/tables';
import { createMenu, type MenuSection } from './menu';
import { rowMenuModel, canDragRow, ROW_MENU_LABEL, type RowMenuItemKind } from './tableRowOps';
import { moveRow, duplicateRow, insertRowRelative, deleteRowAt, type TableLoc } from './tableRowTx';
```

Add module-level icons + the cell-range helper (top of file, after imports):

```typescript
const DRAG_THRESHOLD_PX = 4;

const RM_ICON: Record<RowMenuItemKind, string> = {
  'insert-above': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  'insert-below': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
  'duplicate': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>',
  'delete': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>',
};

/** Resolved positions of the first and last cell of row `idx`, as required by
 *  CellSelection (each position's nodeAfter is the cell). */
function rowCellRange(table: import('@tiptap/pm/model').Node, tablePos: number, idx: number): { anchorPos: number; headPos: number } | null {
  const row = table.maybeChild(idx);
  if (!row || row.childCount === 0) return null;
  let rowStart = tablePos + 1;
  for (let i = 0; i < idx; i++) rowStart += table.child(i).nodeSize;
  const anchorPos = rowStart + 1; // before the first cell
  let headPos = anchorPos;
  for (let i = 0; i < row.childCount - 1; i++) headPos += row.child(i).nodeSize;
  return { anchorPos, headPos };
}
```

Inside the NodeView factory, declare a per-table menu and wire the grip's mousedown/up (replace the `// Placeholder — drag/click wired in Tasks 3 & 4.` line and the `let dragSrc: unknown = null;` line):

```typescript
      const menu = createMenu({ className: 'mp-table-row-menu' });
      let dragSrc: { rowIdx: number; isHeader: boolean; startX: number; startY: number } | null = null;
      let moved = false;

      function loc(): TableLoc | null {
        const tablePos = getPos?.();
        if (typeof tablePos !== 'number') return null;
        const node = editor.state.doc.nodeAt(tablePos);
        if (!node || node.type.name !== 'table') return null;
        return { tablePos, node };
      }

      function selectRow(rowIdx: number): void {
        const l = loc(); if (!l) return;
        const range = rowCellRange(l.node, l.tablePos, rowIdx);
        if (!range) return;
        const { doc } = editor.state;
        const sel = new CellSelection(doc.resolve(range.anchorPos), doc.resolve(range.headPos));
        editor.view.dispatch(editor.state.tr.setSelection(sel));
      }

      function openMenu(rowIdx: number, isHeader: boolean): void {
        const kinds = rowMenuModel({ isHeader });
        const run = (fn: (l: TableLoc, i: number) => void): void => {
          const l = loc(); if (!l) return; fn(l, rowIdx);
        };
        const make = (kind: RowMenuItemKind) => ({
          icon: RM_ICON[kind],
          label: ROW_MENU_LABEL[kind],
          variant: kind === 'delete' ? ('danger' as const) : undefined,
          onSelect: () => {
            switch (kind) {
              case 'insert-above': run((l, i) => insertRowRelative(editor, l, i, 'above')); break;
              case 'insert-below': run((l, i) => insertRowRelative(editor, l, i, 'below')); break;
              case 'duplicate':    run((l, i) => duplicateRow(editor, l, i)); break;
              case 'delete':       run((l, i) => deleteRowAt(editor, l, i)); break;
            }
          },
        });
        const sections: MenuSection[] = [];
        const inserts = kinds.filter(k => k === 'insert-above' || k === 'insert-below').map(make);
        if (inserts.length) sections.push({ items: inserts });
        if (kinds.includes('duplicate')) sections.push({ items: [make('duplicate')] });
        if (kinds.includes('delete')) sections.push({ items: [make('delete')] });
        menu.open(grip, sections);
      }

      function currentRowIdx(): { rowIdx: number; isHeader: boolean } | null {
        if (!activeTr) return null;
        const rowIdx = Array.from(tbody.children).indexOf(activeTr);
        if (rowIdx < 0) return null;
        return { rowIdx, isHeader: !!activeTr.querySelector('th') };
      }

      function onGripUp(e: MouseEvent): void {
        document.removeEventListener('mousemove', onGripMove, true);
        document.removeEventListener('mouseup', onGripUp, true);
        const src = dragSrc; dragSrc = null;
        grip.classList.remove('mp-table-rail-grip-dragging');
        document.body.style.cursor = '';
        hideDropLine();
        if (!src) return;
        if (!moved) { selectRow(src.rowIdx); openMenu(src.rowIdx, src.isHeader); return; }
        // drag handled in Task 4
        finishDrag(e, src);
      }

      grip.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const info = currentRowIdx();
        if (!info) return;
        e.preventDefault(); e.stopPropagation();
        moved = false;
        dragSrc = { ...info, startX: e.clientX, startY: e.clientY };
        document.addEventListener('mousemove', onGripMove, true);
        document.addEventListener('mouseup', onGripUp, true);
      });
```

Add stubs so the file compiles until Task 4 fills them (place above the `return {` of the NodeView):

```typescript
      let dropLine: HTMLDivElement | null = null;
      function hideDropLine(): void { if (dropLine) { dropLine.remove(); dropLine = null; } }
      function onGripMove(_e: MouseEvent): void { /* Task 4 */ }
      function finishDrag(_e: MouseEvent, _src: { rowIdx: number; isHeader: boolean }): void { /* Task 4 */ }
```

Update `destroy()` to also tear these down:

```typescript
        destroy() {
          wrapper.removeEventListener('mousemove', onWrapperMove);
          document.removeEventListener('mousemove', onGripMove, true);
          document.removeEventListener('mouseup', onGripUp, true);
          hideDropLine();
          menu.close();
        },
```

(Note: the factory signature must now be `({ editor, getPos, HTMLAttributes }) =>`.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/tableNodeView.test.ts -t 'row menu'`
Expected: PASS (all four cases).

- [ ] **Step 5: Type-check + commit**

Run: `npx tsc --noEmit` (expected clean).

```bash
git add src/webview/tableNodeView.ts tests/tableNodeView.test.ts
git commit -m "feat(c46): grip click selects the row and opens the row menu

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Grip drag → reorder the row with a drop line

**Files:**
- Modify: `src/webview/tableNodeView.ts`
- Test: covered by the existing `tests/tableRowTx.test.ts` (`moveRow` logic + round-trip); drag geometry is verified on F5 (jsdom has no layout).

**Interfaces:**
- Consumes: `moveRow` (`./tableRowTx`), `clampInsertIndex` semantics (already inside `reorderRows`); the `dragSrc`/`activeTr` state from Tasks 2–3.
- Produces: filled-in `onGripMove` and `finishDrag`; a `.mp-table-drop-line` element on `document.body` during the drag.

- [ ] **Step 1: Replace the Task-3 stubs with the real drag logic**

In `src/webview/tableNodeView.ts`, replace the stub block:

```typescript
      let dropLine: HTMLDivElement | null = null;
      function hideDropLine(): void { if (dropLine) { dropLine.remove(); dropLine = null; } }
      function onGripMove(_e: MouseEvent): void { /* Task 4 */ }
      function finishDrag(_e: MouseEvent, _src: { rowIdx: number; isHeader: boolean }): void { /* Task 4 */ }
```

with:

```typescript
      let dropLine: HTMLDivElement | null = null;
      function hideDropLine(): void { if (dropLine) { dropLine.remove(); dropLine = null; } }

      // Insert index (row-array terms) for a pointer Y over the table body.
      function dropIndexAt(clientY: number): number | null {
        const rows = Array.from(tbody.children) as HTMLTableRowElement[];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].getBoundingClientRect();
          if (clientY >= r.top && clientY <= r.bottom) return clientY < r.top + r.height / 2 ? i : i + 1;
        }
        if (rows.length) return clientY < rows[0].getBoundingClientRect().top ? 0 : rows.length;
        return null;
      }

      function showDropLine(insertIdx: number): void {
        const rows = Array.from(tbody.children) as HTMLTableRowElement[];
        const idx = Math.max(1, Math.min(insertIdx, rows.length)); // never above the header
        const ref = rows[idx] ?? rows[rows.length - 1];
        const r = ref.getBoundingClientRect();
        const y = idx >= rows.length ? r.bottom : r.top;
        if (!dropLine) { dropLine = document.createElement('div'); dropLine.className = 'mp-table-drop-line'; document.body.appendChild(dropLine); }
        dropLine.style.top = `${y - 1}px`;
        dropLine.style.left = `${r.left}px`;
        dropLine.style.width = `${r.width}px`;
      }

      function onGripMove(e: MouseEvent): void {
        if (!dragSrc) return;
        if (!moved) {
          if (Math.hypot(e.clientX - dragSrc.startX, e.clientY - dragSrc.startY) < DRAG_THRESHOLD_PX) return;
          moved = true;
          if (canDragRow(dragSrc.isHeader)) { grip.classList.add('mp-table-rail-grip-dragging'); document.body.style.cursor = 'grabbing'; }
        }
        if (!canDragRow(dragSrc.isHeader)) return; // header can't be reordered
        e.preventDefault();
        const insertIdx = dropIndexAt(e.clientY);
        if (insertIdx == null || insertIdx === dragSrc.rowIdx || insertIdx === dragSrc.rowIdx + 1) { hideDropLine(); return; }
        showDropLine(insertIdx);
      }

      function finishDrag(e: MouseEvent, src: { rowIdx: number; isHeader: boolean }): void {
        if (!canDragRow(src.isHeader)) return;
        const insertIdx = dropIndexAt(e.clientY);
        if (insertIdx == null) return;
        const l = loc(); if (!l) return;
        moveRow(editor, l, src.rowIdx, insertIdx);
      }
```

- [ ] **Step 2: Verify the reorder logic still passes (existing tests)**

Run: `npx jest tests/tableRowTx.test.ts -t 'moveRow'`
Expected: PASS (logic unchanged — `moveRow` already tested for body reorder and header pinning).

- [ ] **Step 3: Type-check + full NodeView suite**

Run: `npx tsc --noEmit && npx jest tests/tableNodeView.test.ts`
Expected: clean; all NodeView tests still pass (drag adds no jsdom-testable behavior but must not break click/menu).

- [ ] **Step 4: Commit**

```bash
git add src/webview/tableNodeView.ts
git commit -m "feat(c46): drag the rail grip to reorder rows (drop line, header pinned)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Styles — rail, grip, drop line, cell selection; remove dead rules

**Files:**
- Modify: `src/webview/styles/editor.css`
- Test: none (CSS) — verified on F5.

**Interfaces:** none.

- [ ] **Step 1: Remove the dead floating-grip rules**

In `src/webview/styles/editor.css`, delete the entire c46-v1 block added previously — from the comment `/* c46 — regular-table row handle. One floating grip ...` through the `.tbl-drop-line { ... }` rule (the `.tbl-row-handle`, `.tbl-row-handle svg`, `.tbl-row-handle:hover`, `.tbl-row-handle.tbl-row-handle-dragging`, `body.tbl-row-active .drag-handle`, and `.tbl-drop-line` rules). Also remove `.tbl-row-handle` and `.tbl-drop-line` from the `.is-printing` selector list (leaving `.mp-table-rail` and `.mp-table-drop-line` there per Step 3).

- [ ] **Step 2: Add the NodeView styles**

Add near the old block's location:

```css
/* c46 — regular-table NodeView: a rail hugs the table's left edge with a
   reachable row grip; plus a visible cell-selection state. */
.mp-table { position: relative; display: flex; align-items: flex-start; }
.mp-table-rail {
  position: relative;
  flex: 0 0 18px;
  align-self: stretch;        /* full table height — continuous hover zone */
  border-radius: 4px;
  transition: background 0.1s;
}
.mp-table:hover > .mp-table-rail { background: rgba(55, 53, 47, 0.035); }
.mp-table-rail-grip {
  position: absolute;
  left: 1px;
  display: none;              /* set to flex on row hover by the NodeView */
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 22px;
  color: #b3b2af;
  border-radius: 4px;
  cursor: grab;
  transition: background 0.1s, color 0.1s;
  user-select: none;
}
.mp-table-rail-grip svg { width: 11px; height: 17px; display: block; }
.mp-table-rail-grip:hover { background: rgba(55, 53, 47, 0.09); color: #5f5e5b; }
.mp-table-rail-grip.mp-table-rail-grip-dragging { cursor: grabbing; color: #5f5e5b; background: rgba(55, 53, 47, 0.12); }

/* Drop indicator — separate blue line between rows (twin of .cb-drop-line). */
.mp-table-drop-line {
  position: fixed;
  height: 2px;
  background: var(--link);
  border-radius: 2px;
  pointer-events: none;
  z-index: 1100;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--link) 28%, transparent);
}

/* Cell selection — native ProseMirror CellSelection range + active cell. */
.ProseMirror .mp-table td.selectedCell,
.ProseMirror .mp-table th.selectedCell {
  background: color-mix(in srgb, var(--link) 14%, transparent);
  /* prosemirror-tables paints .selectedCell via an ::after overlay already;
     this fill reinforces the range for our theme. */
}
.ProseMirror .mp-table td:focus-within,
.ProseMirror .mp-table th:focus-within {
  outline: 2px solid color-mix(in srgb, var(--link) 55%, transparent);
  outline-offset: -2px;
}
```

- [ ] **Step 3: Keep the handles hidden when printing**

Ensure the `.is-printing` rule lists the new chrome:

```css
.is-printing .mp-table-rail,
.is-printing .mp-table-drop-line {
  display: none !important;
}
```

(Add these two selectors to the existing `.is-printing { ... display:none }` group.)

- [ ] **Step 4: Commit**

```bash
git add src/webview/styles/editor.css
git commit -m "style(c46): rail/grip/drop-line + cell-selection styles; drop dead v1 rules

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Docs, full verification, finalize

**Files:**
- Modify: `CHANGELOG.md`, `README.md`, `TODO.md`

**Interfaces:** none.

- [ ] **Step 1: Update the changelog**

In `CHANGELOG.md`, replace the existing c46 bullet under `## [Unreleased] > ### Added` with:

```markdown
- **Row handle + cell selection for regular tables (c46)** — plain markdown tables now have a Notion-style rail on their left edge. **Hover a row** → a `⠿` grip appears, attached to the table so it's actually reachable. **Click** it to select the whole row and open a menu (Insert row above / below, Duplicate row, Delete row); **drag** it to reorder. Tables also gained a real **cell-selection state**: the active cell is outlined, and you can **drag across cells / shift-click** to select a block. The header row stays first (its menu only offers Insert row below). The margin block handle still moves the whole table. (c46)
```

- [ ] **Step 2: Update the README**

In `README.md`, the c46 line under the Tables section currently reads "Row handle — hover any row …". Replace that paragraph with:

```markdown
**Row handle & selection** — a rail hugs the table's left edge. **Hover a row** → a `⠿` grip appears; **click** it to select the whole row and open a menu (Insert row above / below, Duplicate row, Delete row), or **drag** it to reorder. The active cell is outlined, and you can **drag across cells / shift-click** to select a block. The header row stays first (menu: Insert row below only). The margin handle still moves the whole table.
```

And in the feature-list line, leave the existing `- **Tables** …` bullet as updated previously (it already mentions the row handle).

- [ ] **Step 3: Verify the whole suite + types**

Run: `npx tsc --noEmit && npx jest --testPathIgnorePatterns '/node_modules/' '/.worktrees/'`
Expected: tsc clean; only the pre-existing `tests/board/grouping.test.ts` red; `tableRowOps`, `tableRowTx`, and `tableNodeView` suites green; no new failures.

- [ ] **Step 4: Commit docs**

```bash
git add CHANGELOG.md README.md TODO.md
git commit -m "docs(c46): changelog + readme for the table rail, menu, and cell selection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Manual F5 smoke test (record results, do not auto-merge)**

Open a doc with a plain table and confirm:
- Rail tint appears on table hover; hovering a row shows the grip flush to the edge; you can move onto the grip and **click** it.
- Click → the row's cells highlight and the menu opens; Insert above/below, Duplicate, Delete all work and land correctly.
- Drag the grip → a single blue line shows the target; the row lands there; the header can't be dragged and nothing drops above it.
- Click a cell → it's outlined; drag across cells / shift-click → a block selection highlights.
- Header row grip → menu shows only **Insert row below**.
- Read-only → no grip/rail interaction.
- The margin `＋ ⠿` block handle still drags the whole table; board tables and code blocks are unaffected.

---

## Self-Review

**Spec coverage:**
- Rail attached to edge + reachable grip → Tasks 1–2 (NodeView wrapper/rail + hover). ✓
- Click → select row + menu → Task 3 (`CellSelection` + `createMenu`). ✓
- Drag → reorder, drop line, header pinned → Task 4 (+ existing `moveRow` tests). ✓
- Cell-selection state (active + range) → Task 5 CSS over native `CellSelection`. ✓
- Header invariants → `rowMenuModel` + `tableRowTx` guards (unchanged) surfaced in Task 3. ✓
- Keep block handle for whole table → Task 5 removes the `body.tbl-row-active` suppression. ✓
- Round-trip safe (contentDOM = tbody) → Task 1 round-trip test. ✓
- Remove floating-grip module → Task 1 deletion. ✓
- Columns out of scope → not planned (phase 2). ✓

**Placeholder scan:** The Task-3 stubs are intentional, named, and explicitly replaced in Task 4 (no dangling TODOs at plan end). Every code step shows complete code. ✓

**Type consistency:** `loc()` returns `TableLoc` ({ tablePos, node }) consumed by `tableRowTx` functions (matching their signatures). `rowCellRange` returns `{ anchorPos, headPos }` used only in `selectRow`. `dragSrc` shape `{ rowIdx, isHeader, startX, startY }` is consistent across mousedown/move/up. `RM_ICON`/`ROW_MENU_LABEL` keyed by `RowMenuItemKind`. NodeView factory signature `({ editor, getPos, HTMLAttributes })` consistent from Task 3 on. ✓
