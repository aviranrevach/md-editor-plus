# Board Tags (managed colored multi-select) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn tag columns into a managed multi-select set with colors: each tag has an (editable) color defaulting to its name-hash; the cell becomes a checklist picker with type-to-create; tags are editable as a set (rename/recolor/delete) migrating across every card's comma-list; chips render colored everywhere; existing boards derive their tag set on load.

**Architecture:** A tags field reuses `FieldDef.options` (added for status) as its tag set. The card value stays a comma-separated string of tag names; colors resolve from `options` (via the existing `getStatusOptions` accessor). New tag-list-aware model helpers handle comma-list migration. `field-options` serialization + derive-on-load are extended to tags. A new multi-select picker replaces the free-text cell editor; the existing "Edit options" editor becomes field-type-aware.

**Tech Stack:** TypeScript, Jest + ts-jest (DOM tests via `@jest-environment jsdom`), plain DOM webview.

**Spec:** [docs/superpowers/specs/2026-06-05-board-tags-design.md](../specs/2026-06-05-board-tags-design.md)

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/webview/boardModel.ts` | Modify | `splitTags`/`joinTags`; `addTagOption`/`renameTagOption`/`deleteTagOption`/`toggleTagOnCard`; extend `field-options` parse/serialize to tags; derive-on-load |
| `src/webview/boardTagsPicker.ts` | Create | `openTagsPicker(...)` — multi-select checklist + create-by-typing |
| `src/webview/boardStatusOptions.ts` | Modify | make `openStatusOptionsEditor` field-type-aware (tag helpers for tags) |
| `src/webview/boardTableRender.ts` | Modify | colored tag chips; open the picker; "Edit options" for tags |
| `src/webview/boardSidePanel.ts` | Modify | colored tag chips; open the picker |
| `src/webview/boardProperties.ts` | Modify | "Edit options" menu item for tags |
| `src/webview/styles/board.css` | Modify | colored `.bd-tag` / `.board-tag-chip` |
| `tests/board/tags.test.ts` | Create | model + jsdom tests |

Run: `npx jest tests/board`. Pre-existing `tests/toggle.test.ts` failure is unrelated.

---

## Task 1: Tag-list model helpers

**Files:** Modify `src/webview/boardModel.ts` (add after the status helpers, near `recolorStatusOption`). Create `tests/board/tags.test.ts`.

- [ ] **Step 1: Write failing tests** — create `tests/board/tags.test.ts`:

```ts
import {
  addTagOption, renameTagOption, deleteTagOption, toggleTagOnCard, getStatusOptions,
} from '../../src/webview/boardModel';
import type { Board } from '../../src/webview/boardModel';

function board(): Board {
  return {
    id: 'b1', name: '',
    columns: [{ name: 'Todo', color: 'blue' }],
    fields: [
      { name: 'Title', type: 'text', visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Tags', type: 'tags', visibleOnCard: true,
        options: [{ name: 'backend', color: 'blue' }, { name: 'urgent', color: 'red' }] },
    ],
    cards: [
      { id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Tags:'backend, urgent' }, body:'' },
      { id:'c2', values:{ id:'c2', Title:'B', Status:'Todo', Tags:'backend' }, body:'' },
    ],
    orphanBodies: [], views: [], activeView: 'kanban',
  };
}

describe('tag-list model helpers', () => {
  it('addTagOption appends with an auto-color default and dedupes', () => {
    const b = addTagOption(board(), 'Tags', 'deploy');
    const opts = getStatusOptions(b, 'Tags');
    expect(opts.map(o => o.name)).toEqual(['backend', 'urgent', 'deploy']);
    expect(opts[2].color).toBeTruthy();
    // existing name is a no-op
    expect(getStatusOptions(addTagOption(b, 'Tags', 'deploy'), 'Tags')).toHaveLength(3);
  });

  it('renameTagOption renames the option and remaps it inside every card list', () => {
    const b = renameTagOption(board(), 'Tags', 'backend', 'infra');
    expect(getStatusOptions(b, 'Tags').map(o => o.name)).toEqual(['infra', 'urgent']);
    expect(b.cards[0].values.Tags).toBe('infra, urgent');
    expect(b.cards[1].values.Tags).toBe('infra');
  });

  it('deleteTagOption removes the option and strips it from card lists', () => {
    const b = deleteTagOption(board(), 'Tags', 'backend');
    expect(getStatusOptions(b, 'Tags').map(o => o.name)).toEqual(['urgent']);
    expect(b.cards[0].values.Tags).toBe('urgent');
    expect(b.cards[1].values.Tags).toBe('');
  });

  it('toggleTagOnCard adds then removes a tag for one card, preserving others', () => {
    let b = toggleTagOnCard(board(), 'Tags', 'c2', 'urgent');
    expect(b.cards[1].values.Tags).toBe('backend, urgent');
    expect(b.cards[0].values.Tags).toBe('backend, urgent'); // untouched
    b = toggleTagOnCard(b, 'Tags', 'c2', 'urgent');
    expect(b.cards[1].values.Tags).toBe('backend');
  });
});
```

- [ ] **Step 2: Run** `npx jest tests/board/tags.test.ts -t "tag-list model helpers"` → FAIL (helpers not exported).

- [ ] **Step 3: Implement** — in `src/webview/boardModel.ts`, after the status helpers add:

```ts
function splitTags(v: string): string[] {
  return v.split(',').map(s => s.trim()).filter(Boolean);
}
function joinTags(tags: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) { if (t && !seen.has(t)) { seen.add(t); out.push(t); } }
  return out.join(', ');
}

/** Append a tag option (auto-colored by name); no-op if it already exists. */
export function addTagOption(board: Board, field: string, name: string): Board {
  const opts = getStatusOptions(board, field);
  if (opts.some(o => o.name === name)) return board;
  return setStatusOptions(board, field, [...opts, { name, color: autoColor(name) }]);
}

/** Rename a tag option and remap it inside every card's comma-list. */
export function renameTagOption(board: Board, field: string, oldName: string, newName: string): Board {
  const opts = getStatusOptions(board, field).map(o => o.name === oldName ? { ...o, name: newName } : o);
  const b = setStatusOptions(board, field, opts);
  return {
    ...b,
    cards: b.cards.map(c => {
      const tags = splitTags(c.values[field] ?? '');
      if (!tags.includes(oldName)) return c;
      return { ...c, values: { ...c.values, [field]: joinTags(tags.map(t => t === oldName ? newName : t)) } };
    }),
  };
}

/** Delete a tag option and strip it from every card's comma-list. */
export function deleteTagOption(board: Board, field: string, name: string): Board {
  const opts = getStatusOptions(board, field).filter(o => o.name !== name);
  const b = setStatusOptions(board, field, opts);
  return {
    ...b,
    cards: b.cards.map(c => {
      const tags = splitTags(c.values[field] ?? '');
      if (!tags.includes(name)) return c;
      return { ...c, values: { ...c.values, [field]: joinTags(tags.filter(t => t !== name)) } };
    }),
  };
}

/** Toggle a tag on/off for a single card. */
export function toggleTagOnCard(board: Board, field: string, cardId: string, name: string): Board {
  return {
    ...board,
    cards: board.cards.map(c => {
      if (c.id !== cardId) return c;
      const tags = splitTags(c.values[field] ?? '');
      const next = tags.includes(name) ? tags.filter(t => t !== name) : [...tags, name];
      return { ...c, values: { ...c.values, [field]: joinTags(next) } };
    }),
  };
}
```

`getStatusOptions`/`setStatusOptions`/`autoColor` already exist in this file. Recolor reuses the existing `recolorStatusOption` (options-only) — no tag-specific variant needed.

- [ ] **Step 4: Run** `npx jest tests/board/tags.test.ts -t "tag-list model helpers"` → PASS. Then `npx jest tests/board` → all pass.

- [ ] **Step 5: Commit**
```bash
git add src/webview/boardModel.ts tests/board/tags.test.ts
git commit -m "feat(board): tag-list model helpers (add/rename/delete/toggle)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Serialize/parse tag options + derive-on-load

**Files:** Modify `src/webview/boardModel.ts` (parse attach loop ~line 318-322; derive after cards built; serialize guard ~line 403). Test: `tests/board/tags.test.ts`.

- [ ] **Step 1: Add failing tests** to `tests/board/tags.test.ts`:

```ts
import { parseBoardSource, serializeBoard } from '../../src/webview/boardModel';

describe('tag options serialize + derive-on-load', () => {
  it('round-trips stored tag options (names + colors), including a space in a name', () => {
    const src = [
      `<!-- board:start id="b1" columns="Todo" column-colors="blue" field-types="Title=text,Status=status,Tag Set=tags" field-options="Tag Set=backend:teal|urgent:red" -->`,
      ``,
      `| Title | Status | Tag Set |`,
      `|---|---|---|`,
      `| A | Todo | backend, urgent |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const a = parseBoardSource(src);
    const f = a.fields.find(x => x.name === 'Tag Set')!;
    expect(f.options).toEqual([{ name: 'backend', color: 'teal' }, { name: 'urgent', color: 'red' }]);
    expect(parseBoardSource(serializeBoard(a))).toEqual(a); // stable round-trip
  });

  it('derives a tag set from existing tag values when none is stored, auto-colored', () => {
    const src = [
      `<!-- board:start id="b1" columns="Todo" column-colors="blue" field-types="Title=text,Status=status,Tags=tags" -->`,
      ``,
      `| Title | Status | Tags |`,
      `|---|---|---|`,
      `| A | Todo | backend, urgent |`,
      `| B | Todo | backend |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const a = parseBoardSource(src);
    const f = a.fields.find(x => x.name === 'Tags')!;
    expect(f.options!.map(o => o.name)).toEqual(['backend', 'urgent']); // first-seen order
    expect(f.options!.every(o => typeof o.color === 'string')).toBe(true);
    expect(parseBoardSource(serializeBoard(a))).toEqual(a);
  });
});
```

- [ ] **Step 2: Run** `npx jest tests/board/tags.test.ts -t "tag options serialize"` → FAIL (tags fields don't get options parsed/derived).

- [ ] **Step 3: Implement parse attach** — broaden the attach loop (lines 318-322) to tags:

```ts
  const fieldOptions = parseFieldOptions(attrs['field-options'] ?? '');
  for (const f of fields) {
    if ((f.type === 'status' && f.name !== 'Status') || f.type === 'tags') {
      const opts = fieldOptions.get(f.name);
      if (opts) f.options = opts;
    }
  }
```

- [ ] **Step 4: Implement derive-on-load** — after `cards` are fully built (just before the `return { ... }` at the end of `parseBoardSource`), add:

```ts
  // Tags fields: ensure every tag present in a card is in the field's option set
  // (auto-colored), so existing boards are immediately colored + managed.
  for (const f of fields) {
    if (f.type !== 'tags') continue;
    const opts = [...(f.options ?? [])];
    const seen = new Set(opts.map(o => o.name));
    for (const c of cards) {
      for (const t of (c.values[f.name] ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
        if (!seen.has(t)) { seen.add(t); opts.push({ name: t, color: autoColor(t) }); }
      }
    }
    if (opts.length) f.options = opts;
  }
```

- [ ] **Step 5: Implement serialize** — broaden the `field-options` emit guard (line 403):

```ts
    if (((f.type === 'status' && f.name !== 'Status') || f.type === 'tags') && f.options && f.options.length) {
```

- [ ] **Step 6: Run** `npx jest tests/board/tags.test.ts -t "tag options serialize"` → PASS. Then `npx jest tests/board` → run the WHOLE board suite.

> **Expected fixture impact:** existing round-trip/parse fixtures that contain a **tags field with tag values** (e.g. `tests/board/roundtrip.test.ts` "full board with bodies" has `Tags` = `feature, editor` / `tests`) will now parse with derived `options` on that field and serialize a `field-options` attribute. The deep-equal round-trip tests still hold (both sides derive identically). But any test that asserts the **exact `fields` shape** of a tags field that has tag values, expecting **no `options`**, must be updated to include the derived options — this is the new intended behavior (mirrors how the palette test was updated in the status work). Update such assertions; do NOT weaken the round-trip tests. A parse test with an *empty* board (no card rows) keeps `options` undefined and needs no change.

- [ ] **Step 7: Commit**
```bash
git add src/webview/boardModel.ts tests/board/tags.test.ts tests/board/*.test.ts
git commit -m "feat(board): serialize tag options + derive tag set on load

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Colored tag chips (table + side panel + CSS)

**Files:** Modify `src/webview/boardTableRender.ts` (`case 'tags'` lines 1014-1033), `src/webview/boardSidePanel.ts` (`renderTagsEditor` chip creation, lines 468-497), `src/webview/styles/board.css`. Test: `tests/board/tags.test.ts`.

- [ ] **Step 1: Add failing test** to `tests/board/tags.test.ts` (jsdom). Add the docblock as the FIRST line of the file if not present, and the table harness (mirror `tests/board/table.test.ts`'s `makeCtx`). Then:

```ts
import { mountTable } from '../../src/webview/boardTableRender';
import type { BoardRendererCtx } from '../../src/webview/boardBlock';

function ctxFor(b: Board) {
  const root = document.createElement('div'); document.body.appendChild(root);
  const ref = { current: b };
  const ctx = { root, getBoard: () => ref.current, mutate: (n: Board) => { ref.current = n; },
    openSidePanel: () => {}, requestDelete: () => {}, readonly: false } as BoardRendererCtx;
  return { ctx, ref };
}

describe('tag chip color', () => {
  it('renders each tag chip with its option color class', () => {
    const b: Board = {
      id:'b1', name:'', columns:[{name:'Todo',color:'blue'}],
      fields:[
        { name:'Title', type:'text', visibleOnCard:true },
        { name:'Status', type:'status', visibleOnCard:true },
        { name:'Tags', type:'tags', visibleOnCard:true,
          options:[{name:'backend',color:'teal'},{name:'urgent',color:'red'}] },
      ],
      cards:[{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Tags:'backend, urgent' }, body:'' }],
      orphanBodies:[], views:[], activeView:'table',
    };
    const { ctx } = ctxFor(b);
    mountTable(ctx);
    const cell = ctx.root.querySelector('td[data-field="Tags"]')!;
    const chips = Array.from(cell.querySelectorAll('.bd-tag'));
    expect(chips.map(c => c.className)).toEqual([
      expect.stringContaining('color-teal'),
      expect.stringContaining('color-red'),
    ]);
  });
});
```

> If the file isn't jsdom yet (Tasks 1-2 are node-env model tests), move all imports under a leading `/** @jest-environment jsdom */` docblock — jsdom is a superset that runs the model tests fine.

- [ ] **Step 2: Run** `npx jest tests/board/tags.test.ts -t "tag chip color"` → FAIL (chips are bare `.bd-tag`).

- [ ] **Step 3: Color chips in the table** — in `boardTableRender.ts` `case 'tags'`, resolve each tag's color via `getStatusOptions` (already imported) with an `autoColorPublic` fallback (already imported):

```ts
    case 'tags': {
      const tags = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
      if (tags.length === 0) {
        const placeholder = document.createElement('span');
        placeholder.className = 'bd-cell-empty';
        placeholder.textContent = '—';
        td.appendChild(placeholder);
      } else {
        const opts = getStatusOptions(ctx.getBoard(), field.name);
        for (const t of tags) {
          const color = opts.find(o => o.name === t)?.color ?? autoColorPublic(t);
          const chip = document.createElement('span');
          chip.className = `bd-tag color-${color}`;
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
(The `openTagsEditor` call is replaced in Task 4 — leave it for now so this task is self-contained.)

- [ ] **Step 4: Color chips in the side panel** — in `renderTagsEditor` (`boardSidePanel.ts`), `currentBoard` is available. Compute the color for each chip in BOTH the readonly branch and `renderChips`, and add the class. Add a local near the top of the function:

```ts
  const colorFor = (t: string) =>
    getStatusOptions(currentBoard!, fieldName).find(o => o.name === t)?.color ?? autoColorPublic(t);
```
Then where chips are created (`chip.className = 'board-tag-chip';`) change to `chip.className = 'board-tag-chip color-' + colorFor(tag);` in both spots. Import `getStatusOptions` and `autoColorPublic` (and confirm `currentBoard` is the in-scope module board ref).

- [ ] **Step 5: Add CSS** to `src/webview/styles/board.css` for all 10 tokens (reuse the existing `--board-chip-<token>-bg/-fg`; `emerald`→`green`):

```css
.bd-tag.color-gray, .board-tag-chip.color-gray       { background: var(--board-chip-gray-bg);   color: var(--board-chip-gray-fg); }
.bd-tag.color-blue, .board-tag-chip.color-blue       { background: var(--board-chip-blue-bg);   color: var(--board-chip-blue-fg); }
.bd-tag.color-amber, .board-tag-chip.color-amber     { background: var(--board-chip-amber-bg);  color: var(--board-chip-amber-fg); }
.bd-tag.color-emerald, .board-tag-chip.color-emerald { background: var(--board-chip-green-bg);  color: var(--board-chip-green-fg); }
.bd-tag.color-red, .board-tag-chip.color-red         { background: var(--board-chip-red-bg);    color: var(--board-chip-red-fg); }
.bd-tag.color-purple, .board-tag-chip.color-purple   { background: var(--board-chip-purple-bg); color: var(--board-chip-purple-fg); }
.bd-tag.color-orange, .board-tag-chip.color-orange   { background: var(--board-chip-orange-bg); color: var(--board-chip-orange-fg); }
.bd-tag.color-teal, .board-tag-chip.color-teal       { background: var(--board-chip-teal-bg);   color: var(--board-chip-teal-fg); }
.bd-tag.color-indigo, .board-tag-chip.color-indigo   { background: var(--board-chip-indigo-bg); color: var(--board-chip-indigo-fg); }
.bd-tag.color-pink, .board-tag-chip.color-pink       { background: var(--board-chip-pink-bg);   color: var(--board-chip-pink-fg); }
```
(Verify the exact variable names by reading board.css first.)

- [ ] **Step 6: Run** `npx jest tests/board/tags.test.ts -t "tag chip color"` → PASS. Then `npx jest tests/board` → all pass. Then `npx tsc -p tsconfig.webview.json --noEmit` → no new errors in touched files.

- [ ] **Step 7: Commit**
```bash
git add src/webview/boardTableRender.ts src/webview/boardSidePanel.ts src/webview/styles/board.css tests/board/tags.test.ts
git commit -m "feat(board): render tag chips in their option color

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Multi-select tags picker (cell + side panel)

**Files:** Create `src/webview/boardTagsPicker.ts`. Modify `src/webview/boardTableRender.ts` (open the picker instead of `openTagsEditor`) and `src/webview/boardSidePanel.ts` (open the picker from the tags row). Test: `tests/board/tags.test.ts`.

- [ ] **Step 1: Add failing tests** to `tests/board/tags.test.ts`:

```ts
describe('tags picker', () => {
  const mk = (): Board => ({
    id:'b1', name:'', columns:[{name:'Todo',color:'blue'}],
    fields:[
      { name:'Title', type:'text', visibleOnCard:true },
      { name:'Status', type:'status', visibleOnCard:true },
      { name:'Tags', type:'tags', visibleOnCard:true,
        options:[{name:'backend',color:'teal'},{name:'urgent',color:'red'}] },
    ],
    cards:[{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Tags:'backend' }, body:'' }],
    orphanBodies:[], views:[], activeView:'table',
  });

  it('clicking a tags cell opens a checklist; toggling adds/removes the tag', () => {
    const { ctx, ref } = ctxFor(mk());
    mountTable(ctx);
    (ctx.root.querySelector('td[data-field="Tags"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const pop = document.querySelector('.bd-tags-pop')!;
    const rows = Array.from(pop.querySelectorAll('.bd-tags-opt')) as HTMLElement[];
    expect(rows.length).toBe(2);
    // 'urgent' is currently OFF — click it ON
    const urgent = rows.find(r => /urgent/.test(r.textContent || ''))!;
    urgent.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ref.current.cards[0].values.Tags).toBe('backend, urgent');
  });

  it('typing a new tag and creating it adds an auto-colored option and toggles it on', () => {
    const { ctx, ref } = ctxFor(mk());
    mountTable(ctx);
    (ctx.root.querySelector('td[data-field="Tags"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = document.querySelector('.bd-tags-pop input') as HTMLInputElement;
    input.value = 'deploy';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const create = document.querySelector('.bd-tags-create') as HTMLElement;
    create.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const f = ref.current.fields.find(x => x.name === 'Tags')!;
    expect(f.options!.map(o => o.name)).toContain('deploy');
    expect(ref.current.cards[0].values.Tags).toBe('backend, deploy');
  });
});
```

> Confirm/choose the class names: popover `.bd-tags-pop`, option rows `.bd-tags-opt`, the create row `.bd-tags-create`, and a text `input` inside the popover. Use these exact names in the implementation.

- [ ] **Step 2: Run** `npx jest tests/board/tags.test.ts -t "tags picker"` → FAIL (no picker).

- [ ] **Step 3: Create `src/webview/boardTagsPicker.ts`:**

```ts
import { getStatusOptions, addTagOption, toggleTagOnCard } from './boardModel';
import type { Board } from './boardModel';
import { buildChip } from './boardSidePanel';

/**
 * Multi-select tag picker: a checklist of the field's tag options (toggle each
 * on/off for the given card) plus a filter input that offers "+ Create '<x>'".
 */
export function openTagsPicker(
  anchor: HTMLElement,
  getBoard: () => Board,
  fieldName: string,
  cardId: string,
  onChange: (next: Board) => void,
): void {
  document.querySelectorAll('.bd-tags-pop').forEach(n => n.remove());
  const pop = document.createElement('div');
  pop.className = 'bd-tags-pop';
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.position = 'absolute';
  pop.style.top = `${rect.bottom + window.scrollY + 4}px`;
  pop.style.left = `${rect.left + window.scrollX}px`;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'bd-tags-filter';
  input.placeholder = 'Filter or create…';

  const list = document.createElement('div');
  list.className = 'bd-tags-list';

  const cardTags = (): string[] => {
    const c = getBoard().cards.find(x => x.id === cardId);
    return (c?.values[fieldName] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  };

  const render = () => {
    list.innerHTML = '';
    const q = input.value.trim().toLowerCase();
    const opts = getStatusOptions(getBoard(), fieldName);
    const have = new Set(cardTags());
    const matches = opts.filter(o => o.name.toLowerCase().includes(q));
    for (const o of matches) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bd-tags-opt';
      row.appendChild(buildChip(o.name, o.color));
      if (have.has(o.name)) {
        const ck = document.createElement('span');
        ck.className = 'bd-tags-check';
        ck.textContent = '✓';
        row.appendChild(ck);
      }
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        onChange(toggleTagOnCard(getBoard(), fieldName, cardId, o.name));
        render();
      });
      list.appendChild(row);
    }
    const typed = input.value.trim();
    const exists = opts.some(o => o.name.toLowerCase() === typed.toLowerCase());
    if (typed && !exists) {
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'bd-tags-create';
      create.textContent = `+ Create "${typed}"`;
      create.addEventListener('click', (e) => {
        e.stopPropagation();
        const withOpt = addTagOption(getBoard(), fieldName, typed);
        onChange(toggleTagOnCard(withOpt, fieldName, cardId, typed));
        input.value = '';
        render();
      });
      list.appendChild(create);
    }
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (list.querySelector('.bd-tags-create, .bd-tags-opt') as HTMLElement | null)?.click();
    }
  });

  pop.append(input, list);
  render();
  input.focus();

  function onOutside(e: MouseEvent) {
    if (!pop.contains(e.target as Node) && e.target !== anchor) close();
  }
  function close() { pop.remove(); document.removeEventListener('mousedown', onOutside, true); }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
}
```

- [ ] **Step 4: Wire the table cell** — in `boardTableRender.ts` `case 'tags'`, replace the click handler `openTagsEditor(td, card, field, ctx)` with:
```ts
        td.addEventListener('click', (e) => {
          e.stopPropagation();
          openTagsPicker(td, ctx.getBoard, field.name, card.id, ctx.mutate);
        });
```
Add `import { openTagsPicker } from './boardTagsPicker';`. Then DELETE the now-unused `openTagsEditor` function (and any now-unused helpers it alone used) — confirm no other caller via grep.

- [ ] **Step 5: Wire the side panel** — in `boardSidePanel.ts` `renderTagsEditor`, replace the free-text `input`/`renderChips` interaction with: render the colored chips (Task 3 styling) and, when not readonly, a click target that opens the picker:
```ts
openTagsPicker(wrap, () => currentBoard!, fieldName, card.id, commitBoard);
```
`commitBoard(next: Board)` already exists in this file ([boardSidePanel.ts:114](../../../src/webview/boardSidePanel.ts#L114)) and is the whole-board commit (used for `promptNewField`/`openFieldActionMenu`); use it as `onChange`. Add `import { openTagsPicker } from './boardTagsPicker';`. Keep the readonly branch as plain colored chips. Remove the old comma/Enter input + `renderChips` logic. The function currently takes `(card, fieldName, rawValue)` — `card.id` is available via the in-scope `currentCard`/the passed card; confirm and use the card's id.

- [ ] **Step 6: Add CSS** to `board.css` for the picker (reuse popover/menu cues; minimal):
```css
.bd-tags-pop { position:absolute; z-index:20; min-width:220px; background:var(--board-bg-card,#fff); border:1px solid var(--board-border,#e5e7eb); border-radius:11px; box-shadow:0 16px 40px rgba(20,30,50,.18); padding:6px; }
.bd-tags-filter { width:100%; box-sizing:border-box; border:0; border-bottom:1px solid var(--board-border-soft,#f1f3f5); background:transparent; color:inherit; font:inherit; padding:6px 8px; outline:none; }
.bd-tags-list { display:flex; flex-direction:column; gap:2px; padding-top:4px; max-height:240px; overflow:auto; }
.bd-tags-opt, .bd-tags-create { display:flex; align-items:center; gap:8px; width:100%; border:0; background:transparent; padding:6px 8px; border-radius:7px; cursor:pointer; text-align:left; font:inherit; color:inherit; }
.bd-tags-opt:hover, .bd-tags-create:hover { background:var(--board-hover,#f5f7fa); }
.bd-tags-check { margin-left:auto; color:#2b6cff; }
.bd-tags-create { color:#2b6cff; }
```
(Match the variable names other board popovers use — read board.css.)

- [ ] **Step 7: Run** `npx jest tests/board/tags.test.ts -t "tags picker"` → PASS. Then `npx jest tests/board` → all pass. Then `npx tsc -p tsconfig.webview.json --noEmit` → no new errors in touched files.

- [ ] **Step 8: Commit**
```bash
git add src/webview/boardTagsPicker.ts src/webview/boardTableRender.ts src/webview/boardSidePanel.ts src/webview/styles/board.css tests/board/tags.test.ts
git commit -m "feat(board): multi-select tags picker with create-by-typing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: "Edit options" for tags (field-type-aware editor)

**Files:** Modify `src/webview/boardStatusOptions.ts` (`openStatusOptionsEditor`), `src/webview/boardProperties.ts` (line 282 gate), `src/webview/boardTableRender.ts` (line 807 gate). Test: `tests/board/tags.test.ts`.

- [ ] **Step 1: Add failing tests** to `tests/board/tags.test.ts`:

```ts
import { openFieldActionMenu } from '../../src/webview/boardProperties';

describe('Edit options works for tags', () => {
  const mk = (): Board => ({
    id:'b1', name:'', columns:[{name:'Todo',color:'blue'}],
    fields:[
      { name:'Title', type:'text', visibleOnCard:true },
      { name:'Status', type:'status', visibleOnCard:true },
      { name:'Tags', type:'tags', visibleOnCard:true,
        options:[{name:'backend',color:'teal'},{name:'urgent',color:'red'}] },
    ],
    cards:[{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Tags:'backend, urgent' }, body:'' }],
    orphanBodies:[], views:[], activeView:'kanban',
  });

  it('shows "Edit options" for a tags field in the field action menu', () => {
    const b = mk();
    const a = document.createElement('button'); document.body.appendChild(a);
    openFieldActionMenu(a, b, b.fields[2], () => {});
    const labels = Array.from(document.querySelectorAll('.board-field-action-label')).map(n => n.textContent);
    expect(labels).toContain('Edit options');
  });

  it('renaming a tag via the editor migrates card values (comma-list aware)', () => {
    const b = mk();
    let latest: Board = b;
    const a = document.createElement('button'); document.body.appendChild(a);
    // open the editor directly through the exported wrapper
    const { openStatusOptionsEditor } = require('../../src/webview/boardStatusOptions');
    openStatusOptionsEditor(a, () => latest, 'Tags', (n: Board) => { latest = n; });
    const nameInput = document.querySelector('.bd-opt-popover .bd-opt-name') as HTMLInputElement;
    nameInput.focus(); nameInput.value = 'infra'; nameInput.dispatchEvent(new Event('blur'));
    expect(latest.fields.find(f => f.name === 'Tags')!.options!.map(o => o.name)).toEqual(['infra', 'urgent']);
    expect(latest.cards[0].values.Tags).toBe('infra, urgent'); // comma-list migrated
  });
});
```

- [ ] **Step 2: Run** `npx jest tests/board/tags.test.ts -t "Edit options works for tags"` → FAIL (menu gate is status-only; editor uses status helpers that don't migrate comma-lists).

- [ ] **Step 3: Make the editor field-type-aware** — in `src/webview/boardStatusOptions.ts`, import the tag helpers:
```ts
import { addTagOption, renameTagOption, deleteTagOption } from './boardModel';
```
In `openStatusOptionsEditor`, determine the field type once and dispatch add/rename/delete to the right helper (recolor + getOptions stay shared):
```ts
  const fieldType = () => getBoard().fields.find(f => f.name === fieldName)?.type;
  const isTags = () => fieldType() === 'tags';
```
Then in the `buildOptionsEditor` config:
- `onAdd`: keep the unique-"New" label logic; call `isTags() ? addTagOption(getBoard(), fieldName, label) : addStatusOption(getBoard(), fieldName, label)`.
- `onRename`: `isTags() ? renameTagOption(...) : renameStatusOption(...)`.
- `onDelete`: `isTags() ? deleteTagOption(...) : deleteStatusOption(...)`.
- `onRecolor`: unchanged (`recolorStatusOption` — options-only, correct for both).
- `getOptions`: unchanged (`getStatusOptions`).

- [ ] **Step 4: Extend the menu gates** — in `boardProperties.ts` line 282 change `if (field.type === 'status')` to `if (field.type === 'status' || field.type === 'tags')`. In `boardTableRender.ts` line 807 change `if (f.type === 'status')` (the one guarding the `Edit options` `mkItem`, confirm by reading) to `if (f.type === 'status' || f.type === 'tags')`. Do NOT touch the other `f.type === 'status'` checks (grouping/comparator/applyGroup).

- [ ] **Step 5: Run** `npx jest tests/board/tags.test.ts -t "Edit options works for tags"` → PASS. Then `npx jest tests/board` → all pass. Then `npx tsc -p tsconfig.webview.json --noEmit` → no new errors in touched files.

- [ ] **Step 6: Commit**
```bash
git add src/webview/boardStatusOptions.ts src/webview/boardProperties.ts src/webview/boardTableRender.ts tests/board/tags.test.ts
git commit -m "feat(board): Edit options for tags (comma-list-aware rename/delete)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification
- [ ] `npx jest tests/board` — all board suites pass.
- [ ] `npx tsc -p tsconfig.webview.json --noEmit` — no errors in feature files.
- [ ] Manual: open a board with a Tags column. Confirm chips are colored; clicking a cell opens the checklist; toggling adds/removes; typing creates an auto-colored tag; "Edit options" (column ⋯ and properties ⋯) recolors/renames/deletes and the change propagates across cards; reload the file and the tag set + colors persist; grouping by the tag still works.

## Risks
- **Existing-fixture churn** (Task 2): tag fields with values now carry derived options → update assertions that expected the old optionless shape; keep round-trip deep-equal tests intact.
- **Side-panel rewrite** (Task 4 Step 5) is the largest UI change — reuse the same whole-board commit the status editor already uses there; verify readonly still renders plain colored chips.
- **Removing `openTagsEditor`** — grep to confirm no other caller before deleting.
- Keep the built-in Status path and other field types untouched.
