# Board Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Notion-style kanban board block inside the MD Editor Plus webview — board state stored as a portable markdown table + per-card body blocks inside HTML comment markers; full read/write UI with drag-drop, side panel, and Properties menu.

**Architecture:** A single Tiptap atom node owns the *raw markdown source* of one board region. The node's NodeView parses that source into an in-memory `Board` model and renders board chrome + cards. Every UI mutation rewrites the in-memory model and re-serializes back to source, which Tiptap-markdown writes through the existing document buffer. The model is a pure module — easy to unit-test. The UI is webview DOM — manually verified.

**Tech stack:** TypeScript, Tiptap v2 (`@tiptap/core`), `tiptap-markdown`, native HTML5 drag-and-drop, Jest (ts-jest, node env). No new runtime dependencies.

**Reference spec:** [docs/superpowers/specs/2026-05-20-board-block-design.md](../specs/2026-05-20-board-block-design.md).

**Phase arc (each phase produces shippable behavior — safe to pause between phases):**

| Phase | Outcome |
|---|---|
| 1 | `Board` model — parse + serialize round-trip, fully tested. |
| 2 | Tiptap atom node + markdown preprocessor — boards round-trip through editor as opaque source. |
| 3 | Read-only board chrome — boards render visually with columns, cards, field chips. |
| 4 | Slash command + block picker — `/board` inserts a working empty board. |
| 5 | Side panel (read display) — clicking a card opens a panel showing fields + body. |
| 6 | Card editing — title, fields, body all writable through the side panel. |
| 7 | Drag-drop — cards between columns, within columns, column reorder. |
| 8 | Column ops — add/rename/delete column, color picker, sort. |
| 9 | Field/properties management — add/hide/reorder/rename/delete fields. |
| 10 | Edge cases + polish — uncategorized column, duplicate ids, read-only mode, conflict sync. |

---

## Phase 1 — `Board` model (parse + serialize)

The model is a pure TypeScript module that converts between a raw markdown source string (everything from `<!-- board:start -->` through `<!-- board:end -->`) and a `Board` object. All later tasks consume this module; getting it right is foundational.

### Task 1: Types and skeleton module

**Files:**
- Create: `src/webview/boardModel.ts`
- Create: `tests/board/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/board/parse.test.ts
import { parseBoardSource } from '../../src/webview/boardModel';

describe('parseBoardSource — minimal', () => {
  it('returns an empty Board when given just start/end markers', () => {
    const source = `<!-- board:start id="b1" -->\n\n<!-- board:end -->`;
    const board = parseBoardSource(source);
    expect(board).toEqual({
      id: 'b1',
      name: '',
      columns: [],
      fields: [
        { name: 'Title', type: 'text', visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
      ],
      cards: [],
    });
  });
});
```

- [ ] **Step 2: Run test, see fail**

```bash
npx jest tests/board/parse.test.ts -t 'minimal'
```

Expected: FAIL (`Cannot find module '../../src/webview/boardModel'`).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/webview/boardModel.ts
export type ColorToken =
  | 'gray' | 'blue' | 'amber' | 'emerald' | 'red' | 'purple';

export type FieldType = 'text' | 'status' | 'date' | 'person' | 'tags';

export interface FieldDef {
  name: string;
  type: FieldType;
  visibleOnCard: boolean;
}

export interface ColumnDef {
  name: string;
  color: ColorToken;
}

export interface Card {
  id: string;
  values: Record<string, string>;
  body: string;
}

export interface Board {
  id: string;
  name: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  cards: Card[];
}

const DEFAULT_FIELDS: FieldDef[] = [
  { name: 'Title', type: 'text', visibleOnCard: true },
  { name: 'Status', type: 'status', visibleOnCard: true },
];

const START_RE = /<!--\s*board:start([\s\S]*?)-->/i;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out[m[1]] = m[2];
  return out;
}

export function parseBoardSource(source: string): Board {
  const startMatch = source.match(START_RE);
  const attrs = startMatch ? parseAttrs(startMatch[1]) : {};
  return {
    id: attrs.id ?? '',
    name: attrs.name ?? '',
    columns: [],
    fields: DEFAULT_FIELDS.map((f) => ({ ...f })),
    cards: [],
  };
}
```

- [ ] **Step 4: Run test, see pass**

```bash
npx jest tests/board/parse.test.ts -t 'minimal'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts tests/board/parse.test.ts
git commit -m "feat(board): board model skeleton + minimal parse"
```

---

### Task 2: Parse `board:start` attributes (columns, colors, field-types, hidden-fields, name)

**Files:**
- Modify: `src/webview/boardModel.ts`
- Modify: `tests/board/parse.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/board/parse.test.ts`:

```ts
describe('parseBoardSource — start attributes', () => {
  it('parses name, columns, column-colors, field-types, hidden-fields', () => {
    const source = [
      `<!-- board:start`,
      `     id="b-a3f2"`,
      `     name="Sprint 12"`,
      `     columns="Todo|Doing|Done"`,
      `     column-colors="blue|amber|emerald"`,
      `     field-types="Title=text,Status=status,Owner=person,Due=date,Tags=tags"`,
      `     hidden-fields="id" -->`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');

    const board = parseBoardSource(source);

    expect(board.id).toBe('b-a3f2');
    expect(board.name).toBe('Sprint 12');
    expect(board.columns).toEqual([
      { name: 'Todo',  color: 'blue' },
      { name: 'Doing', color: 'amber' },
      { name: 'Done',  color: 'emerald' },
    ]);
    expect(board.fields).toEqual([
      { name: 'Title',  type: 'text',   visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Owner',  type: 'person', visibleOnCard: true },
      { name: 'Due',    type: 'date',   visibleOnCard: true },
      { name: 'Tags',   type: 'tags',   visibleOnCard: true },
    ]);
  });

  it('auto-colors columns when column-colors is absent', () => {
    const source = `<!-- board:start id="b1" columns="A|B" -->\n\n<!-- board:end -->`;
    const board = parseBoardSource(source);
    expect(board.columns).toHaveLength(2);
    // Auto-color is deterministic, but we only assert it's a valid token here.
    const tokens: string[] = ['gray', 'blue', 'amber', 'emerald', 'red', 'purple'];
    expect(tokens).toContain(board.columns[0].color);
    expect(tokens).toContain(board.columns[1].color);
  });

  it('hidden-fields adds id field (hidden) when present in attrs', () => {
    const source =
      `<!-- board:start id="b1" hidden-fields="id" -->\n\n<!-- board:end -->`;
    const board = parseBoardSource(source);
    const idField = board.fields.find((f) => f.name === 'id');
    expect(idField).toEqual({ name: 'id', type: 'text', visibleOnCard: false });
  });
});
```

- [ ] **Step 2: Run tests, see fails**

```bash
npx jest tests/board/parse.test.ts -t 'start attributes'
```

Expected: 3 failures.

- [ ] **Step 3: Implement attribute parsing**

Replace the body of `parseBoardSource` and add helpers in `src/webview/boardModel.ts`:

```ts
const COLOR_TOKENS: ColorToken[] =
  ['gray', 'blue', 'amber', 'emerald', 'red', 'purple'];

function autoColor(name: string): ColorToken {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return COLOR_TOKENS[Math.abs(h) % COLOR_TOKENS.length];
}

function parseFieldTypes(raw: string): Map<string, FieldType> {
  const out = new Map<string, FieldType>();
  for (const pair of raw.split(',')) {
    const [n, t] = pair.split('=').map((s) => s.trim());
    if (n && t && ['text', 'status', 'date', 'person', 'tags'].includes(t)) {
      out.set(n, t as FieldType);
    }
  }
  return out;
}

export function parseBoardSource(source: string): Board {
  const startMatch = source.match(START_RE);
  const attrs = startMatch ? parseAttrs(startMatch[1]) : {};

  const columnNames = attrs.columns ? attrs.columns.split('|') : [];
  const colorTokens = attrs['column-colors']
    ? attrs['column-colors'].split('|')
    : [];
  const columns: ColumnDef[] = columnNames.map((name, i) => {
    const candidate = colorTokens[i] as ColorToken | undefined;
    const color = candidate && COLOR_TOKENS.includes(candidate)
      ? candidate
      : autoColor(name);
    return { name, color };
  });

  const types = parseFieldTypes(attrs['field-types'] ?? '');
  const hidden = new Set(
    (attrs['hidden-fields'] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );

  // Build fields: Title + Status always first, then any others in `field-types`.
  const fields: FieldDef[] = [
    { name: 'Title',  type: 'text',   visibleOnCard: !hidden.has('Title') },
    { name: 'Status', type: 'status', visibleOnCard: !hidden.has('Status') },
  ];
  for (const [name, type] of types) {
    if (name === 'Title' || name === 'Status') continue;
    fields.push({ name, type, visibleOnCard: !hidden.has(name) });
  }
  // Include hidden-only fields (e.g. "id") that weren't in field-types.
  for (const name of hidden) {
    if (!fields.find((f) => f.name === name)) {
      fields.push({ name, type: 'text', visibleOnCard: false });
    }
  }

  return {
    id: attrs.id ?? '',
    name: attrs.name ?? '',
    columns,
    fields,
    cards: [],
  };
}
```

- [ ] **Step 4: Run tests, see pass**

```bash
npx jest tests/board/parse.test.ts
```

Expected: all `parse.test.ts` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts tests/board/parse.test.ts
git commit -m "feat(board): parse start-marker attributes"
```

---

### Task 3: Parse table rows into `Card[]`

**Files:**
- Modify: `src/webview/boardModel.ts`
- Modify: `tests/board/parse.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/board/parse.test.ts`:

```ts
describe('parseBoardSource — table rows', () => {
  const source = [
    `<!-- board:start id="b1" columns="Todo|Doing|Done"`,
    `     field-types="Title=text,Status=status,Owner=person,Due=date,Tags=tags"`,
    `     hidden-fields="id" -->`,
    ``,
    `| id | Title       | Status | Owner   | Due        | Tags         |`,
    `|----|-------------|--------|---------|------------|--------------|`,
    `| c1 | First card  | Doing  | @aviran | 2026-06-01 | feature, ui  |`,
    `| c2 | Second card | Todo   |         |            |              |`,
    ``,
    `<!-- board:end -->`,
  ].join('\n');

  it('parses two cards with field values', () => {
    const board = parseBoardSource(source);
    expect(board.cards).toEqual([
      {
        id: 'c1',
        values: {
          id: 'c1',
          Title: 'First card',
          Status: 'Doing',
          Owner: '@aviran',
          Due: '2026-06-01',
          Tags: 'feature, ui',
        },
        body: '',
      },
      {
        id: 'c2',
        values: {
          id: 'c2',
          Title: 'Second card',
          Status: 'Todo',
          Owner: '',
          Due: '',
          Tags: '',
        },
        body: '',
      },
    ]);
  });

  it('unescapes pipe characters in cell content', () => {
    const src = [
      `<!-- board:start id="b1" -->`,
      ``,
      `| id | Title              |`,
      `|----|--------------------|`,
      `| c1 | a \\| b \\| c        |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const board = parseBoardSource(src);
    expect(board.cards[0].values.Title).toBe('a | b | c');
  });

  it('converts <br> in cells back to newlines', () => {
    const src = [
      `<!-- board:start id="b1" -->`,
      ``,
      `| id | Title           |`,
      `|----|-----------------|`,
      `| c1 | line1<br>line2  |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const board = parseBoardSource(src);
    expect(board.cards[0].values.Title).toBe('line1\nline2');
  });
});
```

- [ ] **Step 2: Run tests, see fails**

```bash
npx jest tests/board/parse.test.ts -t 'table rows'
```

Expected: 3 failures.

- [ ] **Step 3: Implement table parsing**

Add to `src/webview/boardModel.ts` (above `parseBoardSource`):

```ts
const TABLE_LINE = /^\s*\|(.+)\|\s*$/;
const SEPARATOR_LINE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

function splitCells(line: string): string[] {
  // Split on '|' but respect escaped '\|'.
  const cells: string[] = [];
  let buf = '';
  let i = 0;
  // Strip leading/trailing pipes.
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') {
      buf += '|';
      i += 2;
      continue;
    }
    if (ch === '|') {
      cells.push(buf);
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  cells.push(buf);
  return cells.map((c) => c.trim().replace(/<br\s*\/?>(?!\n)/gi, '\n'));
}

function findTableSlice(body: string): { header: string[]; rows: string[][] } | null {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (TABLE_LINE.test(lines[i]) && SEPARATOR_LINE.test(lines[i + 1])) {
      const header = splitCells(lines[i]);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && TABLE_LINE.test(lines[j])) {
        rows.push(splitCells(lines[j]));
        j++;
      }
      return { header, rows };
    }
  }
  return null;
}
```

Then replace the `return { ... cards: [] };` block in `parseBoardSource`:

```ts
const innerStart = source.indexOf('-->', startMatch?.index ?? 0);
const endIdx = source.search(/<!--\s*board:end\s*-->/i);
const body = source.slice(
  innerStart >= 0 ? innerStart + 3 : 0,
  endIdx >= 0 ? endIdx : source.length,
);

const table = findTableSlice(body);
const cards: Card[] = [];
if (table) {
  for (const row of table.rows) {
    const values: Record<string, string> = {};
    table.header.forEach((h, idx) => {
      values[h] = row[idx] ?? '';
    });
    const id = values.id || '';
    cards.push({ id, values, body: '' });
  }
}

return {
  id: attrs.id ?? '',
  name: attrs.name ?? '',
  columns,
  fields,
  cards,
};
```

- [ ] **Step 4: Run tests, see pass**

```bash
npx jest tests/board/parse.test.ts
```

Expected: all `parse.test.ts` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts tests/board/parse.test.ts
git commit -m "feat(board): parse markdown table into Card rows"
```

---

### Task 4: Parse `board:body` sections into `Card.body`

**Files:**
- Modify: `src/webview/boardModel.ts`
- Modify: `tests/board/parse.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('parseBoardSource — bodies', () => {
  it('associates each body block with its card by id', () => {
    const source = [
      `<!-- board:start id="b1" -->`,
      ``,
      `| id | Title       |`,
      `|----|-------------|`,
      `| c1 | First card  |`,
      `| c2 | Second card |`,
      ``,
      `<!-- board:body id="c1" -->`,
      ``,
      `## Goal`,
      `Body for c1`,
      ``,
      `<!-- board:body id="c2" -->`,
      ``,
      `Brief body for c2.`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');

    const board = parseBoardSource(source);
    expect(board.cards[0].body.trim()).toBe('## Goal\nBody for c1');
    expect(board.cards[1].body.trim()).toBe('Brief body for c2.');
  });

  it('leaves body empty for cards without a board:body block', () => {
    const source = [
      `<!-- board:start id="b1" -->`,
      ``,
      `| id | Title |`,
      `|----|-------|`,
      `| c1 | Hi    |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const board = parseBoardSource(source);
    expect(board.cards[0].body).toBe('');
  });
});
```

- [ ] **Step 2: Run tests, see fails**

```bash
npx jest tests/board/parse.test.ts -t 'bodies'
```

Expected: 1 failure (the first; the second should already pass).

- [ ] **Step 3: Implement body parsing**

In `src/webview/boardModel.ts`, replace the body-extraction block in `parseBoardSource`:

```ts
const BODY_RE = /<!--\s*board:body\s+id="([^"]+)"\s*-->/gi;

// ... inside parseBoardSource, after we have `body` and `table`:

const bodyById = new Map<string, string>();
const matches: { id: string; index: number; end: number }[] = [];
let bm: RegExpExecArray | null;
BODY_RE.lastIndex = 0;
while ((bm = BODY_RE.exec(body)) !== null) {
  matches.push({ id: bm[1], index: bm.index, end: bm.index + bm[0].length });
}
for (let i = 0; i < matches.length; i++) {
  const start = matches[i].end;
  const stop = i + 1 < matches.length ? matches[i + 1].index : body.length;
  bodyById.set(matches[i].id, body.slice(start, stop).replace(/^\n+/, '').replace(/\n+$/, '\n'));
}

const cards: Card[] = [];
if (table) {
  for (const row of table.rows) {
    const values: Record<string, string> = {};
    table.header.forEach((h, idx) => {
      values[h] = row[idx] ?? '';
    });
    const id = values.id || '';
    cards.push({ id, values, body: bodyById.get(id) ?? '' });
  }
}
```

- [ ] **Step 4: Run tests, see pass**

```bash
npx jest tests/board/parse.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts tests/board/parse.test.ts
git commit -m "feat(board): associate board:body blocks with cards by id"
```

---

### Task 5: Serialize `Board` → markdown source

**Files:**
- Modify: `src/webview/boardModel.ts`
- Create: `tests/board/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/board/serialize.test.ts
import { serializeBoard } from '../../src/webview/boardModel';
import type { Board } from '../../src/webview/boardModel';

describe('serializeBoard', () => {
  it('emits start marker, table, bodies, end marker for a typical board', () => {
    const board: Board = {
      id: 'b1',
      name: 'Sprint 12',
      columns: [
        { name: 'Todo',  color: 'blue' },
        { name: 'Doing', color: 'amber' },
      ],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'id',     type: 'text',   visibleOnCard: false },
      ],
      cards: [
        { id: 'c1', values: { id: 'c1', Title: 'First', Status: 'Doing' }, body: '## Goal\nDo it.' },
        { id: 'c2', values: { id: 'c2', Title: 'Second', Status: 'Todo'  }, body: '' },
      ],
    };

    const out = serializeBoard(board);

    expect(out).toContain('<!-- board:start');
    expect(out).toContain('id="b1"');
    expect(out).toContain('name="Sprint 12"');
    expect(out).toContain('columns="Todo|Doing"');
    expect(out).toContain('column-colors="blue|amber"');
    expect(out).toContain('field-types="Title=text,Status=status,id=text"');
    expect(out).toContain('hidden-fields="id"');

    // Table contains both rows in order, with the id column.
    expect(out).toMatch(/\|\s*id\s*\|\s*Title\s*\|\s*Status\s*\|/);
    expect(out).toMatch(/\|\s*c1\s*\|\s*First\s*\|\s*Doing\s*\|/);
    expect(out).toMatch(/\|\s*c2\s*\|\s*Second\s*\|\s*Todo\s*\|/);

    // Body only for c1.
    expect(out).toContain('<!-- board:body id="c1" -->');
    expect(out).not.toContain('<!-- board:body id="c2" -->');
    expect(out).toContain('## Goal\nDo it.');

    expect(out).toMatch(/<!-- board:end -->\s*$/);
  });

  it('escapes pipes in cell content and replaces newlines with <br>', () => {
    const board: Board = {
      id: 'b1',
      name: '',
      columns: [],
      fields: [
        { name: 'Title',  type: 'text',   visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
      ],
      cards: [
        { id: 'c1', values: { Title: 'a | b\nc', Status: 'Todo' }, body: '' },
      ],
    };
    const out = serializeBoard(board);
    expect(out).toContain('a \\| b<br>c');
  });
});
```

- [ ] **Step 2: Run tests, see fails**

```bash
npx jest tests/board/serialize.test.ts
```

Expected: FAIL (`serializeBoard is not a function`).

- [ ] **Step 3: Implement `serializeBoard`**

Append to `src/webview/boardModel.ts`:

```ts
function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function serializeStartMarker(board: Board): string {
  const fieldNames = board.fields.map((f) => f.name);
  const hidden = board.fields.filter((f) => !f.visibleOnCard).map((f) => f.name);
  const colors = board.columns.map((c) => c.color).join('|');
  const fieldTypes = board.fields.map((f) => `${f.name}=${f.type}`).join(',');

  const attrs: string[] = [`id="${board.id}"`];
  if (board.name) attrs.push(`name="${board.name}"`);
  if (board.columns.length) {
    attrs.push(`columns="${board.columns.map((c) => c.name).join('|')}"`);
    attrs.push(`column-colors="${colors}"`);
  }
  if (fieldNames.length) attrs.push(`field-types="${fieldTypes}"`);
  if (hidden.length) attrs.push(`hidden-fields="${hidden.join(',')}"`);

  return `<!-- board:start ${attrs.join(' ')} -->`;
}

function serializeTable(board: Board): string {
  const headers = board.fields.map((f) => f.name);
  const header = `| ${headers.join(' | ')} |`;
  const sep = `|${headers.map(() => '---').join('|')}|`;
  const rows = board.cards.map((card) => {
    const cells = headers.map((h) => escapeCell(card.values[h] ?? ''));
    return `| ${cells.join(' | ')} |`;
  });
  return [header, sep, ...rows].join('\n');
}

function serializeBodies(board: Board): string {
  const parts: string[] = [];
  for (const card of board.cards) {
    const body = card.body.trim();
    if (!body) continue;
    parts.push(`<!-- board:body id="${card.id}" -->`);
    parts.push('');
    parts.push(body);
    parts.push('');
  }
  return parts.join('\n');
}

export function serializeBoard(board: Board): string {
  const sections: string[] = [
    serializeStartMarker(board),
    '',
    serializeTable(board),
    '',
  ];
  const bodies = serializeBodies(board);
  if (bodies) {
    sections.push(bodies);
  }
  sections.push('<!-- board:end -->');
  return sections.join('\n');
}
```

- [ ] **Step 4: Run tests, see pass**

```bash
npx jest tests/board/serialize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts tests/board/serialize.test.ts
git commit -m "feat(board): serialize Board to markdown source"
```

---

### Task 6: Round-trip property test

**Files:**
- Create: `tests/board/roundtrip.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/board/roundtrip.test.ts
import { parseBoardSource, serializeBoard } from '../../src/webview/boardModel';

const FIXTURES: { name: string; source: string }[] = [
  {
    name: 'full board with bodies',
    source: [
      `<!-- board:start id="b-a3f2" name="Sprint 12" columns="Todo|Doing|Done" column-colors="blue|amber|emerald" field-types="Title=text,Status=status,Owner=person,Due=date,Tags=tags,id=text" hidden-fields="id" -->`,
      ``,
      `| Title | Status | Owner | Due | Tags | id |`,
      `|---|---|---|---|---|---|`,
      `| Build the kanban block | Doing | @aviran | 2026-06-01 | feature, editor | c1 |`,
      `| Write round-trip tests | Todo |  |  | tests | c2 |`,
      ``,
      `<!-- board:body id="c1" -->`,
      ``,
      `## Goal`,
      `Add the table + comment parser, render the board view, support drag-drop.`,
      ``,
      `- subtask 1`,
      `- subtask 2`,
      ``,
      `<!-- board:body id="c2" -->`,
      ``,
      `Brief notes for c2.`,
      ``,
      `<!-- board:end -->`,
    ].join('\n'),
  },
  {
    name: 'empty board (no cards)',
    source: [
      `<!-- board:start id="b1" columns="Todo|Done" column-colors="blue|emerald" field-types="Title=text,Status=status" -->`,
      ``,
      `| Title | Status |`,
      `|---|---|`,
      ``,
      `<!-- board:end -->`,
    ].join('\n'),
  },
];

describe('board source round-trip', () => {
  for (const fix of FIXTURES) {
    it(`parse(serialize(parse(x))) deep-equals parse(x): ${fix.name}`, () => {
      const a = parseBoardSource(fix.source);
      const b = parseBoardSource(serializeBoard(a));
      expect(b).toEqual(a);
    });
  }
});
```

- [ ] **Step 2: Run test**

```bash
npx jest tests/board/roundtrip.test.ts
```

Expected: PASS. If any fixture fails, **fix the model** until it round-trips. Do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add tests/board/roundtrip.test.ts
git commit -m "test(board): parse(serialize(parse(x))) round-trip property"
```

---

## Phase 2 — Tiptap atom node + markdown preprocessor

The Tiptap node owns one board region. Its only attribute is `source` — the raw markdown of that region (start marker through end marker). The NodeView, added in Phase 3, parses `source` into a `Board` for rendering and calls `updateAttributes({ source })` when the user mutates the model.

### Task 7: Markdown preprocessor — convert board regions to HTML placeholders

Like `preprocessMarkdownCallouts` in [callout.ts](../../src/webview/extensions/callout.ts), we pre-pass the raw markdown to replace each `<!-- board:start ... --> ... <!-- board:end -->` region with a single `<div data-board source="..."></div>` element. The Tiptap parseHTML rule then picks it up.

**Files:**
- Create: `src/webview/extensions/board.ts`
- Create: `tests/board/preprocess.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/board/preprocess.test.ts
import { preprocessMarkdownBoards } from '../../src/webview/extensions/board';

describe('preprocessMarkdownBoards', () => {
  it('wraps each board region in a single <div data-board>', () => {
    const md = [
      `# Hello`,
      ``,
      `<!-- board:start id="b1" -->`,
      ``,
      `| Title | Status |`,
      `|---|---|`,
      `| c1 | Todo |`,
      ``,
      `<!-- board:end -->`,
      ``,
      `Goodbye`,
    ].join('\n');

    const html = preprocessMarkdownBoards(md);
    const matches = html.match(/<div data-board source="[^"]*"><\/div>/g);
    expect(matches).toHaveLength(1);
    expect(html.startsWith('# Hello')).toBe(true);
    expect(html.trim().endsWith('Goodbye')).toBe(true);
  });

  it('encodes quotes inside source so the attribute parses', () => {
    const md = [
      `<!-- board:start id="b1" name="quoted" -->`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const html = preprocessMarkdownBoards(md);
    expect(html).toContain('source="&lt;!-- board:start');
    expect(html).toMatch(/source="[^"]+"/);
  });

  it('passes through markdown without boards unchanged', () => {
    const md = '# Hello\n\nNo boards here.';
    expect(preprocessMarkdownBoards(md)).toBe(md);
  });
});
```

- [ ] **Step 2: Run test, see fail**

```bash
npx jest tests/board/preprocess.test.ts
```

Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement preprocessor**

```ts
// src/webview/extensions/board.ts
import { Node, mergeAttributes } from '@tiptap/core';

const REGION_RE =
  /<!--\s*board:start[\s\S]*?<!--\s*board:end\s*-->/gi;

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function preprocessMarkdownBoards(markdown: string): string {
  return markdown.replace(REGION_RE, (region) => {
    return `<div data-board source="${htmlEscape(region)}"></div>`;
  });
}
```

- [ ] **Step 4: Run test, see pass**

```bash
npx jest tests/board/preprocess.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/extensions/board.ts tests/board/preprocess.test.ts
git commit -m "feat(board): markdown preprocessor for board regions"
```

---

### Task 8: Tiptap atom node — parse/render/serialize source verbatim

**Files:**
- Modify: `src/webview/extensions/board.ts`

- [ ] **Step 1: Add Board node**

Append to `src/webview/extensions/board.ts`:

```ts
const Board = Node.create({
  name: 'board',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      source: {
        default: '',
        parseHTML: (el: HTMLElement) =>
          el.getAttribute('source') ?? '',
        renderHTML: (attrs) => ({ source: attrs.source }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-board]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-board': '' }, HTMLAttributes),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const source = (node.attrs.source as string) || '';
          state.write(source);
          state.ensureNewLine();
          state.write('\n');
        },
      },
    };
  },
});

export default Board;
```

- [ ] **Step 2: Add a round-trip test through Tiptap (manual smoke for now)**

Manual verification — no automated test for the Tiptap-mounted round-trip in this phase. Phase 1 model tests + the preprocessor test already cover the wire format. The full Tiptap round-trip is verified by manual run after Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/webview/extensions/board.ts
git commit -m "feat(board): Tiptap atom node with source attribute"
```

---

### Task 9: Register Board node + preprocessor in editor; smoke-test round-trip

**Files:**
- Modify: `src/webview/editor.ts`
- Modify: `src/webview/index.ts`

The exact wiring depends on the existing editor setup; the engineer should mirror how `Callout` and `Toggle` are wired.

- [ ] **Step 1: Find Callout registration**

```bash
grep -n "Callout" "src/webview/editor.ts"
grep -n "preprocessMarkdownCallouts" "src/webview/editor.ts"
```

Note the import and where the extension is added to the editor.

- [ ] **Step 2: Add Board imports and registration**

In `src/webview/editor.ts`, alongside the Callout imports:

```ts
import Board, { preprocessMarkdownBoards } from './extensions/board';
```

Add `Board` to the editor's `extensions: [...]` array (next to `Callout`).

Wherever `preprocessMarkdownCallouts(md)` is called on incoming markdown, chain `preprocessMarkdownBoards` immediately after (order does not matter; they target disjoint syntax):

```ts
const html = preprocessMarkdownBoards(preprocessMarkdownCallouts(markdown));
```

- [ ] **Step 3: Add `board.css` import**

Create an empty file `src/webview/styles/board.css` with a single class so the import doesn't fail:

```css
/* src/webview/styles/board.css */
.board-block { display: block; }
```

In `src/webview/index.ts`, alongside the other `*.css` imports:

```ts
import boardCss from './styles/board.css';
```

And append `${boardCss}` to wherever the inline CSS is injected (search for `editorCss` to find the injection site).

- [ ] **Step 4: Smoke-test in dev**

```bash
npm run compile
```

Open VSCode with the extension and load a file containing a board region (use the example from the spec). Verify:
- The file content survives a save/reload cycle (no data loss).
- The board renders as a plain empty `<div data-board>` (no chrome yet — that's Phase 3).
- Editing text *around* the board still works normally.

- [ ] **Step 5: Commit**

```bash
git add src/webview/editor.ts src/webview/index.ts src/webview/styles/board.css
git commit -m "feat(board): wire board node + preprocessor into editor"
```

---

## Phase 3 — Read-only board chrome (NodeView)

We implement the NodeView that renders the board chrome (name, columns, cards) from `node.attrs.source`. Cards are not yet interactive; everything is display-only.

### Task 10: NodeView shell — render board name + empty column row

**Files:**
- Create: `src/webview/boardBlock.ts`
- Modify: `src/webview/extensions/board.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Create `boardBlock.ts` with a render function**

```ts
// src/webview/boardBlock.ts
import { parseBoardSource, serializeBoard, type Board } from './boardModel';

export interface BoardView {
  dom: HTMLElement;
  update(source: string): void;
}

export function createBoardView(initialSource: string): BoardView {
  const dom = document.createElement('div');
  dom.className = 'board-block';
  dom.setAttribute('contenteditable', 'false');

  let board = parseBoardSource(initialSource);
  render();

  function render(): void {
    dom.innerHTML = '';
    dom.appendChild(renderChrome(board));
    dom.appendChild(renderColumns(board));
  }

  return {
    dom,
    update(source: string): void {
      board = parseBoardSource(source);
      render();
    },
  };
}

function renderChrome(board: Board): HTMLElement {
  const chrome = document.createElement('div');
  chrome.className = 'board-chrome';
  const name = document.createElement('div');
  name.className = 'board-name';
  name.textContent = board.name || 'Untitled board';
  if (!board.name) name.classList.add('is-placeholder');
  chrome.appendChild(name);
  return chrome;
}

function renderColumns(board: Board): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-columns';
  for (const col of board.columns) {
    row.appendChild(renderColumn(col));
  }
  return row;
}

function renderColumn(col: { name: string; color: string }): HTMLElement {
  const el = document.createElement('div');
  el.className = `board-column color-${col.color}`;
  const head = document.createElement('div');
  head.className = 'board-column-head';
  head.innerHTML = `
    <span class="board-column-dot" style="background:var(--color-${col.color})"></span>
    <span class="board-column-name">${col.name}</span>
  `;
  el.appendChild(head);
  return el;
}
```

- [ ] **Step 2: Hook NodeView into the Board extension**

In `src/webview/extensions/board.ts`, replace the `Board` node definition with one that registers a NodeView:

```ts
import { createBoardView } from '../boardBlock';

const Board = Node.create({
  name: 'board',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      source: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('source') ?? '',
        renderHTML: (attrs) => ({ source: attrs.source }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-board]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-board': '' }, HTMLAttributes)];
  },

  addNodeView() {
    return ({ node }) => {
      const view = createBoardView(node.attrs.source as string);
      return {
        dom: view.dom,
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          view.update(updatedNode.attrs.source as string);
          return true;
        },
        ignoreMutation() {
          return true;
        },
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const source = (node.attrs.source as string) || '';
          state.write(source);
          state.ensureNewLine();
          state.write('\n');
        },
      },
    };
  },
});

export default Board;
```

- [ ] **Step 3: Add baseline CSS**

Replace the contents of `src/webview/styles/board.css`:

```css
.board-block {
  display: block;
  margin: 1.5em 0;
  border: 1px solid var(--block-border, #e3e2de);
  border-radius: 8px;
  padding: 16px;
  background: var(--block-bg, #f7f6f3);
  position: relative;
}
.board-chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.board-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text, #1f1f1c);
}
.board-name.is-placeholder { color: var(--text-muted, #9b9b97); }
.board-columns {
  display: flex;
  gap: 12px;
  overflow-x: auto;
}
.board-column {
  flex: 0 0 260px;
  background: var(--block-bg-2, #fff);
  border: 1px solid var(--block-border, #e3e2de);
  border-radius: 6px;
  padding: 10px;
}
.board-column-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted, #6b6b66);
  margin-bottom: 8px;
}
.board-column-dot {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block;
}
:root {
  --color-gray: #9b9b97;
  --color-blue: #2383e2;
  --color-amber: #d97706;
  --color-emerald: #059669;
  --color-red: #dc2626;
  --color-purple: #7c3aed;
}
```

- [ ] **Step 4: Smoke-test**

```bash
npm run compile
```

Reload a board-containing .md file. Expect the chrome (name + column headers) to appear. No cards yet.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardBlock.ts src/webview/extensions/board.ts src/webview/styles/board.css
git commit -m "feat(board): NodeView shell with chrome and column headers"
```

---

### Task 11: Render cards inside columns

**Files:**
- Modify: `src/webview/boardBlock.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Group cards by status, render card faces**

In `boardBlock.ts`, replace `renderColumn` and add card rendering:

```ts
function renderColumn(board: Board, col: { name: string; color: string }): HTMLElement {
  const el = document.createElement('div');
  el.className = `board-column color-${col.color}`;
  el.dataset.column = col.name;

  const cards = board.cards.filter((c) => (c.values.Status || '') === col.name);

  const head = document.createElement('div');
  head.className = 'board-column-head';
  head.innerHTML = `
    <span class="board-column-dot" style="background:var(--color-${col.color})"></span>
    <span class="board-column-name">${escapeHtml(col.name)}</span>
    <span class="board-column-count">${cards.length}</span>
  `;
  el.appendChild(head);

  const list = document.createElement('div');
  list.className = 'board-card-list';
  for (const card of cards) {
    list.appendChild(renderCard(board, card));
  }
  el.appendChild(list);
  return el;
}

function renderCard(board: Board, card: Card): HTMLElement {
  const el = document.createElement('div');
  el.className = 'board-card';
  el.dataset.cardId = card.id;

  const title = document.createElement('div');
  title.className = 'board-card-title';
  title.textContent = card.values.Title || 'Untitled';
  el.appendChild(title);

  const preview = bodyPreview(card.body);
  if (preview) {
    const p = document.createElement('div');
    p.className = 'board-card-preview';
    p.textContent = preview;
    el.appendChild(p);
  }

  const chips = renderChips(board, card);
  if (chips) el.appendChild(chips);
  return el;
}

function bodyPreview(body: string): string {
  if (!body) return '';
  // Strip simple markdown: leading #, *, -, [task] markers.
  const lines = body
    .split('\n')
    .map((l) => l.replace(/^\s*[#>\-*]\s*\[.\]\s*/, '').replace(/^\s*[#>\-*]\s*/, '').trim())
    .filter(Boolean);
  return lines[0] || '';
}

function renderChips(board: Board, card: Card): HTMLElement | null {
  const visible = board.fields.filter(
    (f) => f.visibleOnCard && f.name !== 'Title' && f.name !== 'Status',
  );
  if (visible.length === 0) return null;
  const row = document.createElement('div');
  row.className = 'board-card-chips';
  for (const f of visible) {
    const val = (card.values[f.name] || '').trim();
    if (!val) continue;
    row.appendChild(renderChip(f, val));
  }
  return row.children.length ? row : null;
}

function renderChip(f: FieldDef, val: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `board-chip chip-${f.type}`;
  if (f.type === 'tags') {
    chip.innerHTML = val
      .split(',')
      .map((t) => `<span class="board-tag">${escapeHtml(t.trim())}</span>`)
      .join('');
  } else if (f.type === 'date') {
    chip.textContent = formatDate(val);
    if (isOverdue(val)) chip.classList.add('is-overdue');
  } else if (f.type === 'person') {
    const initial = val.replace(/^@/, '').charAt(0).toUpperCase();
    chip.innerHTML = `<span class="board-avatar">${escapeHtml(initial)}</span><span>${escapeHtml(val)}</span>`;
  } else {
    chip.textContent = val;
  }
  return chip;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isOverdue(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

Update `renderColumns` to pass the `board` argument:

```ts
function renderColumns(board: Board): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-columns';
  for (const col of board.columns) {
    row.appendChild(renderColumn(board, col));
  }
  return row;
}
```

Add `Card, FieldDef` to the top-of-file import:

```ts
import { parseBoardSource, serializeBoard, type Board, type Card, type FieldDef } from './boardModel';
```

- [ ] **Step 2: Style cards**

Append to `src/webview/styles/board.css`:

```css
.board-card-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 24px;
}
.board-card {
  background: var(--block-bg-2, #fff);
  border: 1px solid var(--block-border, #e3e2de);
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.board-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
.board-card-title { font-size: 13px; font-weight: 500; line-height: 1.35; }
.board-card-preview {
  font-size: 12px; color: var(--text-muted, #6b6b66);
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.board-card-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.board-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; padding: 2px 8px; border-radius: 10px;
  background: var(--block-bg, #f7f6f3); color: var(--text, #1f1f1c);
}
.board-chip.is-overdue { background: #fee2e2; color: #991b1b; }
.board-avatar {
  width: 16px; height: 16px; border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  color: white; font-size: 10px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
}
.board-column-count {
  margin-left: auto;
  font-size: 11px;
  background: var(--block-border, #e3e2de);
  border-radius: 10px;
  padding: 1px 7px;
}
```

- [ ] **Step 3: Smoke-test**

```bash
npm run compile
```

Open a board file. Expect cards to render in their columns with title, body preview, and field chips.

- [ ] **Step 4: Commit**

```bash
git add src/webview/boardBlock.ts src/webview/styles/board.css
git commit -m "feat(board): render card faces with chips and body preview"
```

---

### Task 12: Show a placeholder card and uncategorized column when applicable

**Files:**
- Modify: `src/webview/boardBlock.ts`

- [ ] **Step 1: Implement empty-column placeholder + uncategorized fallback**

In `boardBlock.ts`, modify `renderColumns`:

```ts
function renderColumns(board: Board): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-columns';
  const validNames = new Set(board.columns.map((c) => c.name));
  for (const col of board.columns) {
    row.appendChild(renderColumn(board, col));
  }
  const orphans = board.cards.filter((c) => !validNames.has(c.values.Status || ''));
  if (orphans.length) {
    row.appendChild(renderUncategorized(board, orphans));
  }
  return row;
}

function renderUncategorized(board: Board, cards: Card[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'board-column color-gray board-column-uncategorized';
  el.dataset.column = '';
  const head = document.createElement('div');
  head.className = 'board-column-head';
  head.innerHTML = `
    <span class="board-column-dot" style="background:var(--color-gray)"></span>
    <span class="board-column-name">Uncategorized</span>
    <span class="board-column-count">${cards.length}</span>
  `;
  el.appendChild(head);
  const list = document.createElement('div');
  list.className = 'board-card-list';
  for (const card of cards) list.appendChild(renderCard(board, card));
  el.appendChild(list);
  return el;
}
```

- [ ] **Step 2: Smoke-test**

Create a file with a card whose `Status` cell is `Wrong`. Reload and verify it appears in an "Uncategorized" column on the right.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardBlock.ts
git commit -m "feat(board): uncategorized column for invalid status values"
```

---

## Phase 4 — `/board` insert (slash command + block picker)

### Task 13: Add `/board` to block picker

**Files:**
- Modify: `src/webview/blockPicker.ts`

- [ ] **Step 1: Find existing entry shape**

Read `src/webview/blockPicker.ts`. Find the `BLOCKS` (or equivalent) array containing entries like `callout`, `toggle`. Note the `id`, `label`, `iconHtml`, `section`, and `insert` fields used.

- [ ] **Step 2: Add board entry**

In the `ICO` object, add:

```ts
board: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM104,200H40V56h64Zm32-144v144H120V56Zm80,0V200H152V56Z"/></svg>`,
```

Add a new entry to the picker's entries array (next to `callout` / `toggle`). The exact shape depends on the existing layout — mirror the `callout` entry. The `insert` should call into a small helper:

```ts
{
  id: 'board',
  label: 'Board',
  description: 'Kanban board with columns and cards',
  iconHtml: ICO.board,
  section: 'other',
  aliases: ['kanban', 'tasks', 'project'],
  insert: (editor, pos) => {
    const id = `b-${Math.random().toString(36).slice(2, 6)}`;
    const source = freshBoardSource(id);
    editor.chain().focus().insertContentAt(pos, {
      type: 'board',
      attrs: { source },
    }).run();
    // Focus the board's name input on the next tick so the user can type immediately.
    requestAnimationFrame(() => {
      const dom = document.querySelector(`.board-block .board-name`) as HTMLElement | null;
      if (dom) {
        dom.focus();
        // Place caret at end.
        const range = document.createRange();
        range.selectNodeContents(dom);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    });
  },
},
```

Add the `freshBoardSource` helper (at the bottom of `blockPicker.ts`):

```ts
function freshBoardSource(id: string): string {
  return [
    `<!-- board:start id="${id}" name="" columns="Todo|Doing|Done" column-colors="blue|amber|emerald" field-types="Title=text,Status=status,id=text" hidden-fields="id" -->`,
    ``,
    `| Title    | Status | id |`,
    `|----------|--------|----|`,
    `| New card | Todo   | c1 |`,
    ``,
    `<!-- board:end -->`,
  ].join('\n');
}
```

- [ ] **Step 3: Smoke-test**

`npm run compile`, then in a doc type `/board` and pick the entry. Expect a 3-column board with one card titled "New card" in the Todo column.

- [ ] **Step 4: Commit**

```bash
git add src/webview/blockPicker.ts
git commit -m "feat(board): /board slash command inserts an empty kanban"
```

---

### Task 14: Test block picker entry shape

**Files:**
- Modify: `tests/blockPicker.test.ts`

- [ ] **Step 1: Add a test asserting the `board` entry exists**

Read the existing `tests/blockPicker.test.ts` to find the exported list (likely `BLOCKS` or similar) and adapt the import below if the name differs.

```ts
import { BLOCKS } from '../src/webview/blockPicker';

describe('board block picker entry', () => {
  const board = BLOCKS.find((b) => b.id === 'board');

  it('is registered', () => {
    expect(board).toBeDefined();
  });

  it('has the expected label and aliases', () => {
    expect(board!.label).toBe('Board');
    expect(board!.aliases).toEqual(expect.arrayContaining(['kanban', 'tasks', 'project']));
  });

  it('lives in the "other" section', () => {
    expect(board!.section).toBe('other');
  });

  it('declares an insert handler (not a sub-menu)', () => {
    expect(typeof board!.insert).toBe('function');
    expect(board!.subItems).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run**

```bash
npx jest tests/blockPicker.test.ts -t 'board block picker'
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/blockPicker.test.ts
git commit -m "test(board): block picker entry shape"
```

---

## Phase 5 — Side panel (read-only display)

The side panel is a `<div>` injected at the document level (sibling of the editor root), positioned `fixed` to the right edge. It reads the currently-open card from a small store and renders fields + body. Editing comes in Phase 6.

### Task 15: Side panel shell + open/close lifecycle

**Files:**
- Create: `src/webview/boardSidePanel.ts`
- Modify: `src/webview/boardBlock.ts`
- Modify: `src/webview/styles/board.css`
- Modify: `src/webview/index.ts`

- [ ] **Step 1: Implement the panel module**

```ts
// src/webview/boardSidePanel.ts
import type { Board, Card } from './boardModel';

export interface SidePanelHost {
  // Called when the panel mutates the card (Phase 6 wires this up).
  onChange?: (next: Card) => void;
}

let panel: HTMLElement | null = null;
let currentBoard: Board | null = null;
let currentCard: Card | null = null;
let host: SidePanelHost | null = null;

export function initBoardSidePanel(): void {
  if (panel) return;
  panel = document.createElement('aside');
  panel.className = 'board-side-panel';
  panel.style.display = 'none';
  document.body.appendChild(panel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel && panel.style.display !== 'none') {
      closeBoardSidePanel();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!panel || panel.style.display === 'none') return;
    if (panel.contains(e.target as Node)) return;
    // Click on a card opens a new panel; don't auto-close in that case.
    const onCard = (e.target as HTMLElement).closest('.board-card');
    if (onCard) return;
    closeBoardSidePanel();
  });
}

export function openBoardSidePanel(board: Board, card: Card, h?: SidePanelHost): void {
  initBoardSidePanel();
  currentBoard = board;
  currentCard = card;
  host = h ?? null;
  renderPanel();
  panel!.style.display = 'block';
}

export function closeBoardSidePanel(): void {
  if (!panel) return;
  panel.style.display = 'none';
  currentBoard = null;
  currentCard = null;
  host = null;
}

function renderPanel(): void {
  if (!panel || !currentBoard || !currentCard) return;
  const board = currentBoard;
  const card = currentCard;

  panel.innerHTML = '';
  const close = document.createElement('button');
  close.className = 'board-panel-close';
  close.type = 'button';
  close.textContent = '×';
  close.addEventListener('click', closeBoardSidePanel);
  panel.appendChild(close);

  const title = document.createElement('div');
  title.className = 'board-panel-title';
  title.textContent = card.values.Title || 'Untitled';
  panel.appendChild(title);

  for (const field of board.fields) {
    if (field.name === 'Title') continue;
    if (!field.visibleOnCard && field.name === 'id') continue; // hide id by default
    const row = document.createElement('div');
    row.className = 'board-panel-field';
    const label = document.createElement('span');
    label.className = 'board-panel-field-label';
    label.textContent = field.name;
    const value = document.createElement('span');
    value.className = 'board-panel-field-value';
    value.textContent = card.values[field.name] || '';
    row.append(label, value);
    panel.appendChild(row);
  }

  const body = document.createElement('div');
  body.className = 'board-panel-body';
  body.textContent = card.body || 'No description.';
  panel.appendChild(body);
}
```

- [ ] **Step 2: Wire click → open from `boardBlock.ts`**

In `renderCard`:

```ts
el.addEventListener('click', () => {
  openBoardSidePanel(board, card);
});
```

Add the import at the top of `boardBlock.ts`:

```ts
import { openBoardSidePanel } from './boardSidePanel';
```

- [ ] **Step 3: Style the panel**

Append to `src/webview/styles/board.css`:

```css
.board-side-panel {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: 420px;
  background: var(--block-bg-2, #fff);
  border-left: 1px solid var(--block-border, #e3e2de);
  box-shadow: -8px 0 24px rgba(0,0,0,0.08);
  padding: 20px;
  overflow-y: auto;
  z-index: 100;
}
.board-panel-close {
  position: absolute; top: 12px; right: 14px;
  background: transparent; border: 0; font-size: 22px;
  cursor: pointer; color: var(--text-muted, #6b6b66);
}
.board-panel-title { font-size: 18px; font-weight: 600; margin: 8px 0 16px; }
.board-panel-field { display: flex; gap: 8px; padding: 6px 0; font-size: 13px; }
.board-panel-field-label { width: 80px; color: var(--text-muted, #6b6b66); }
.board-panel-field-value { flex: 1; }
.board-panel-body {
  margin-top: 16px;
  border-top: 1px solid var(--block-border, #e3e2de);
  padding-top: 16px;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.5;
}
```

- [ ] **Step 4: Initialize panel on editor boot**

In `src/webview/index.ts`, after the editor is created, add:

```ts
import { initBoardSidePanel } from './boardSidePanel';
// ... after editor mount:
initBoardSidePanel();
```

- [ ] **Step 5: Smoke-test**

Click a card; the panel slides in showing fields and body. `Esc` or click outside closes it.

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardSidePanel.ts src/webview/boardBlock.ts \
        src/webview/styles/board.css src/webview/index.ts
git commit -m "feat(board): side panel — read-only card details"
```

---

### Task 16: Render card body in side panel via nested Tiptap (read-only)

**Files:**
- Modify: `src/webview/boardSidePanel.ts`

- [ ] **Step 1: Replace plain-text body rendering with a Tiptap instance**

Replace the body section in `renderPanel`:

```ts
import { createEditor } from './editor';

// in renderPanel(), replace the `body` block:
const body = document.createElement('div');
body.className = 'board-panel-body';
panel.appendChild(body);
if (card.body) {
  // createEditor expects a container + markdown + editable flag.
  // Mirror the signature; engineer adjusts if createEditor has a different shape.
  createEditor(body, card.body, /* editable */ false);
} else {
  body.textContent = 'No description.';
  body.classList.add('is-empty');
}
```

If the existing `createEditor` does not accept an `editable` parameter, add one (it should be threaded into Tiptap's `editable` option). Search:

```bash
grep -n "createEditor" src/webview/editor.ts
```

…and align the signature.

- [ ] **Step 2: Smoke-test**

Open a card whose `board:body` contains headings and a bullet list. Expect formatted output in the panel.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardSidePanel.ts src/webview/editor.ts
git commit -m "feat(board): side panel renders body via nested Tiptap (read-only)"
```

---

## Phase 6 — Card editing (write-back through model)

We introduce a single write path: every UI mutation calls `updateBoard(nextBoard)`, which re-serializes and calls Tiptap's `updateAttributes({ source })`.

### Task 17: Add `updateBoard` plumbing in `boardBlock.ts`

**Files:**
- Modify: `src/webview/boardBlock.ts`
- Modify: `src/webview/extensions/board.ts`

- [ ] **Step 1: Add an `onMutate` callback to `BoardView`**

In `boardBlock.ts`:

```ts
export interface BoardView {
  dom: HTMLElement;
  update(source: string): void;
}

export interface BoardViewOptions {
  onMutate(nextSource: string): void;
}

export function createBoardView(initialSource: string, opts: BoardViewOptions): BoardView {
  const dom = document.createElement('div');
  dom.className = 'board-block';
  dom.setAttribute('contenteditable', 'false');

  let board = parseBoardSource(initialSource);
  render();

  function mutate(next: Board): void {
    board = next;
    opts.onMutate(serializeBoard(board));
    render();
  }

  function render(): void {
    dom.innerHTML = '';
    dom.appendChild(renderChrome(board));
    dom.appendChild(renderColumns(board, mutate));
  }

  return {
    dom,
    update(source: string): void {
      board = parseBoardSource(source);
      render();
    },
  };
}
```

Thread `mutate` through to render functions so card click handlers (and later, drag-drop) can call it. For now, just pass `mutate` into `renderColumns` / `renderColumn` / `renderCard` even though only the side panel will consume it in this task.

- [ ] **Step 2: Wire `onMutate` from the Tiptap NodeView**

In `extensions/board.ts`:

```ts
addNodeView() {
  return ({ node, editor, getPos }) => {
    const view = createBoardView(node.attrs.source as string, {
      onMutate(nextSource) {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return;
        editor.commands.command(({ tr }) => {
          tr.setNodeAttribute(pos, 'source', nextSource);
          return true;
        });
      },
    });
    return {
      dom: view.dom,
      update(updatedNode) {
        if (updatedNode.type !== node.type) return false;
        view.update(updatedNode.attrs.source as string);
        return true;
      },
      ignoreMutation() { return true; },
    };
  };
},
```

- [ ] **Step 3: Smoke-test**

Click a card; nothing crashes (the side panel still opens read-only). Source is unchanged. This task is plumbing — no user-visible behavior yet.

- [ ] **Step 4: Commit**

```bash
git add src/webview/boardBlock.ts src/webview/extensions/board.ts
git commit -m "feat(board): onMutate write-back plumbing through NodeView"
```

---

### Task 18: Edit title and simple-field values from the side panel

**Files:**
- Modify: `src/webview/boardSidePanel.ts`
- Modify: `src/webview/boardBlock.ts`

- [ ] **Step 1: Thread `mutate` into the side panel**

Extend `openBoardSidePanel` to accept a mutator:

```ts
export function openBoardSidePanel(
  board: Board,
  card: Card,
  onChange: (next: Card) => void,
): void { /* same body, but store onChange and call it on edits */ }
```

In `boardBlock.ts` card click:

```ts
el.addEventListener('click', () => {
  openBoardSidePanel(board, card, (nextCard) => {
    const next: Board = {
      ...board,
      cards: board.cards.map((c) => (c.id === nextCard.id ? nextCard : c)),
    };
    mutate(next);
  });
});
```

- [ ] **Step 2: Make title + text/date/person fields contenteditable**

In `renderPanel`, replace the static `title.textContent = ...` with an input-style contenteditable:

```ts
title.contentEditable = 'true';
title.textContent = card.values.Title || '';
title.addEventListener('blur', () => {
  const next = { ...card, values: { ...card.values, Title: title.textContent || '' } };
  onChange(next);
});
```

For the field rows, use a contenteditable span for `text`/`person`, and an `<input type="date">` for `date`:

```ts
if (field.type === 'date') {
  const input = document.createElement('input');
  input.type = 'date';
  input.value = card.values[field.name] || '';
  input.addEventListener('change', () => {
    const next = { ...card, values: { ...card.values, [field.name]: input.value } };
    onChange(next);
  });
  row.appendChild(input);
} else {
  value.contentEditable = 'true';
  value.addEventListener('blur', () => {
    const next = { ...card, values: { ...card.values, [field.name]: value.textContent || '' } };
    onChange(next);
  });
  row.appendChild(value);
}
```

- [ ] **Step 3: Smoke-test**

Open a card; edit title, owner, due date; blur the field. Switch the editor to source view (`mdEditorPlus.openSourceView`). Verify the table cell has updated.

- [ ] **Step 4: Commit**

```bash
git add src/webview/boardSidePanel.ts src/webview/boardBlock.ts
git commit -m "feat(board): edit title, text, person, and date fields from side panel"
```

---

### Task 19: Status dropdown editor in side panel

**Files:**
- Modify: `src/webview/boardSidePanel.ts`

- [ ] **Step 1: Render a select for status**

In the field-row loop:

```ts
if (field.type === 'status') {
  const select = document.createElement('select');
  for (const col of board.columns) {
    const opt = document.createElement('option');
    opt.value = col.name;
    opt.textContent = col.name;
    if (card.values.Status === col.name) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    const next = { ...card, values: { ...card.values, Status: select.value } };
    onChange(next);
  });
  row.appendChild(select);
}
```

- [ ] **Step 2: Smoke-test**

Open a card in "Todo", change the Status select to "Done", close the panel. Verify the card now lives in the Done column.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardSidePanel.ts
git commit -m "feat(board): status field editor (column dropdown)"
```

---

### Task 20: Tags multi-select editor

**Files:**
- Modify: `src/webview/boardSidePanel.ts`

- [ ] **Step 1: Render chip input**

For `field.type === 'tags'`, render:
- Existing tags as removable chips
- An input where pressing Enter or comma adds a new tag (after stripping commas from the input)
- `onChange` fires each time the chip list changes; the cell is rebuilt as `tags.join(', ')`

Pseudocode:

```ts
if (field.type === 'tags') {
  const wrap = document.createElement('div');
  wrap.className = 'board-tag-input';
  const tags = (card.values[field.name] || '').split(',').map((t) => t.trim()).filter(Boolean);
  const renderChips = () => {
    wrap.querySelectorAll('.board-tag-chip').forEach((n) => n.remove());
    tags.forEach((tag, i) => {
      const chip = document.createElement('span');
      chip.className = 'board-tag-chip';
      chip.innerHTML = `${tag}<button type="button" aria-label="Remove">×</button>`;
      chip.querySelector('button')!.addEventListener('click', () => {
        tags.splice(i, 1); commit();
      });
      wrap.insertBefore(chip, input);
    });
  };
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Add tag…';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const t = input.value.replace(/,/g, '').trim();
      if (t && !tags.includes(t)) { tags.push(t); }
      input.value = '';
      commit();
    }
  });
  const commit = () => {
    const next = { ...card, values: { ...card.values, [field.name]: tags.join(', ') } };
    onChange(next);
    renderChips();
  };
  wrap.appendChild(input);
  renderChips();
  row.appendChild(wrap);
}
```

Add the corresponding CSS to `board.css`:

```css
.board-tag-input { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.board-tag-chip {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--block-bg, #f7f6f3); border-radius: 10px; padding: 1px 8px;
  font-size: 12px;
}
.board-tag-chip button {
  background: transparent; border: 0; cursor: pointer;
  font-size: 14px; line-height: 1; color: var(--text-muted, #6b6b66);
}
.board-tag-input input {
  border: 0; flex: 1; min-width: 60px; background: transparent;
  font-size: 12px;
}
.board-tag-input input:focus { outline: none; }
```

- [ ] **Step 2: Smoke-test**

Open a card, add and remove tags. Save the file and verify the table cell.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardSidePanel.ts src/webview/styles/board.css
git commit -m "feat(board): tags multi-select editor"
```

---

### Task 21: Edit body via writable nested Tiptap

**Files:**
- Modify: `src/webview/boardSidePanel.ts`

- [ ] **Step 1: Mount a writable Tiptap instance for the body and stream back to the model**

Replace the read-only body mount from Task 16 with a writable one. The exact `createEditor` signature decides the shape; assume it returns an object with a `getMarkdown()` method and an `onUpdate` hook. Pseudocode:

```ts
const body = document.createElement('div');
body.className = 'board-panel-body editable';
panel.appendChild(body);
const sub = createEditor(body, card.body, true);
sub.onUpdate(() => {
  const next = { ...card, body: sub.getMarkdown() };
  onChange(next);
});
```

If `createEditor` doesn't already expose those hooks, extend it. Keep the API close to what `index.ts` already uses for the top-level editor.

- [ ] **Step 2: Smoke-test**

Edit body in the side panel — type headings, lists, code blocks. Switch to source view and verify the `board:body` block matches.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardSidePanel.ts src/webview/editor.ts
git commit -m "feat(board): writable nested Tiptap for card body"
```

---

## Phase 7 — Drag-drop

Native HTML5 drag-and-drop. We attach `draggable="true"` to each card, listen for `dragstart`/`dragover`/`drop`, and on a successful drop mutate the model.

### Task 22: Drag a card to another column (Status change)

**Files:**
- Modify: `src/webview/boardBlock.ts`

- [ ] **Step 1: Implement DnD between columns**

In `renderCard`:

```ts
el.draggable = true;
el.addEventListener('dragstart', (e) => {
  e.dataTransfer!.setData('text/board-card-id', card.id);
  e.dataTransfer!.effectAllowed = 'move';
  el.classList.add('is-dragging');
});
el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
```

In `renderColumn`, add drop listeners on the card list:

```ts
list.addEventListener('dragover', (e) => {
  e.preventDefault();
  list.classList.add('is-drop-target');
});
list.addEventListener('dragleave', () => list.classList.remove('is-drop-target'));
list.addEventListener('drop', (e) => {
  e.preventDefault();
  list.classList.remove('is-drop-target');
  const id = e.dataTransfer!.getData('text/board-card-id');
  if (!id) return;
  const next: Board = {
    ...board,
    cards: board.cards.map((c) =>
      c.id === id ? { ...c, values: { ...c.values, Status: col.name } } : c,
    ),
  };
  mutate(next);
});
```

Add CSS for `.is-dragging` (opacity 0.5) and `.is-drop-target` (dashed outline).

- [ ] **Step 2: Smoke-test**

Drag a card from Todo to Done. Verify it lands in the Done column and the source-view `Status` cell updates.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardBlock.ts src/webview/styles/board.css
git commit -m "feat(board): drag cards between columns to change status"
```

---

### Task 23: Drag within-column reordering

**Files:**
- Modify: `src/webview/boardBlock.ts`

- [ ] **Step 1: Track drop position using insertion line**

Add to each card a top + bottom `dragover` zone. When the user drags over the top half of card `B`, insert before `B`; over the bottom half, insert after.

```ts
el.addEventListener('dragover', (e) => {
  e.preventDefault();
  const rect = el.getBoundingClientRect();
  const before = (e.clientY - rect.top) < rect.height / 2;
  el.classList.toggle('drop-before', before);
  el.classList.toggle('drop-after', !before);
});
el.addEventListener('dragleave', () => {
  el.classList.remove('drop-before', 'drop-after');
});
el.addEventListener('drop', (e) => {
  e.preventDefault();
  const id = e.dataTransfer!.getData('text/board-card-id');
  if (!id || id === card.id) {
    el.classList.remove('drop-before', 'drop-after');
    return;
  }
  const before = el.classList.contains('drop-before');
  el.classList.remove('drop-before', 'drop-after');
  // Compute new ordering: remove dragged, re-insert relative to current card.
  const others = board.cards.filter((c) => c.id !== id);
  const targetIdx = others.findIndex((c) => c.id === card.id);
  const insertAt = before ? targetIdx : targetIdx + 1;
  const dragged = board.cards.find((c) => c.id === id)!;
  const movedStatus = { ...dragged, values: { ...dragged.values, Status: col.name } };
  others.splice(insertAt, 0, movedStatus);
  mutate({ ...board, cards: others });
});
```

Add CSS:

```css
.board-card.drop-before { border-top: 2px solid var(--color-blue); }
.board-card.drop-after  { border-bottom: 2px solid var(--color-blue); }
```

- [ ] **Step 2: Smoke-test**

Reorder cards within Todo. Save → reload → order is preserved.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardBlock.ts src/webview/styles/board.css
git commit -m "feat(board): within-column reordering via drag-drop"
```

---

### Task 24: Drag column headers to reorder columns

**Files:**
- Modify: `src/webview/boardBlock.ts`

- [ ] **Step 1: Make `.board-column-head` draggable**

Set `column.draggable = true` (note: the column root, not the head, so the whole column drags). Add `dragstart`/`dragover`/`drop` handlers that swap entries in `board.columns` (and `column-colors` follows automatically because we pair by index).

```ts
el.draggable = true;
el.addEventListener('dragstart', (e) => {
  e.dataTransfer!.setData('text/board-column-name', col.name);
  e.dataTransfer!.effectAllowed = 'move';
});
el.addEventListener('dragover', (e) => {
  if (e.dataTransfer!.types.includes('text/board-column-name')) {
    e.preventDefault();
  }
});
el.addEventListener('drop', (e) => {
  const draggedName = e.dataTransfer!.getData('text/board-column-name');
  if (!draggedName || draggedName === col.name) return;
  e.preventDefault();
  const cols = [...board.columns];
  const fromIdx = cols.findIndex((c) => c.name === draggedName);
  const toIdx = cols.findIndex((c) => c.name === col.name);
  const [moved] = cols.splice(fromIdx, 1);
  cols.splice(toIdx, 0, moved);
  mutate({ ...board, columns: cols });
});
```

If column-drag conflicts with card-drag, distinguish by `dataTransfer` payload type (`text/board-card-id` vs `text/board-column-name`) before reacting.

- [ ] **Step 2: Smoke-test**

Drag the Done column to be first. Save → reload → order persists.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardBlock.ts
git commit -m "feat(board): reorder columns via drag"
```

---

## Phase 8 — Column ops (add, rename, color, delete, add-card)

### Task 25: "+ Add card" button per column

**Files:**
- Modify: `src/webview/boardBlock.ts`

- [ ] **Step 1: Append an add-card button to each column**

At the end of `renderColumn`:

```ts
const add = document.createElement('button');
add.type = 'button';
add.className = 'board-add-card';
add.textContent = '+ Add card';
add.addEventListener('click', () => {
  const id = `c-${Math.random().toString(36).slice(2, 6)}`;
  const newCard: Card = {
    id,
    values: { id, Title: '', Status: col.name },
    body: '',
  };
  mutate({ ...board, cards: [...board.cards, newCard] });
  // After re-render, open the new card immediately so the user can type a title.
  queueMicrotask(() => {
    openBoardSidePanel(board /* note: stale board */, newCard, (next) => {
      mutate({ ...board, cards: board.cards.map((c) => c.id === id ? next : c) });
    });
  });
});
el.appendChild(add);
```

Add a CSS rule for `.board-add-card` (full-width subtle button, hover background).

- [ ] **Step 2: Smoke-test**

Click "+ Add card" in Doing. Verify a new card appears in Doing and the side panel opens for it.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardBlock.ts src/webview/styles/board.css
git commit -m "feat(board): + Add card per column"
```

---

### Task 26: "+" column at end of row to add a status

**Files:**
- Modify: `src/webview/boardBlock.ts`

- [ ] **Step 1: Append an add-column button after the column row**

In `renderColumns`, after the loop:

```ts
const addCol = document.createElement('button');
addCol.type = 'button';
addCol.className = 'board-add-column';
addCol.textContent = '+';
addCol.addEventListener('click', () => {
  const name = prompt('Column name', 'New');
  if (!name) return;
  if (board.columns.some((c) => c.name === name)) {
    alert('A column with that name already exists.');
    return;
  }
  const color = nextColor(board.columns.map((c) => c.color));
  mutate({ ...board, columns: [...board.columns, { name, color }] });
});
row.appendChild(addCol);

function nextColor(used: string[]): ColorToken {
  const all: ColorToken[] = ['blue', 'amber', 'emerald', 'red', 'purple', 'gray'];
  return all.find((c) => !used.includes(c)) ?? 'gray';
}
```

`prompt` is a stopgap. A nicer inline-add UI lands in a later polish task; for now this is sufficient.

Import `ColorToken` at top of file.

- [ ] **Step 2: Smoke-test**

Click "+". Add a column named "Review". Verify it appears and you can drag cards to it.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardBlock.ts
git commit -m "feat(board): add column via + button"
```

---

### Task 27: Rename column inline (propagates to card values)

**Files:**
- Modify: `src/webview/boardBlock.ts`

- [ ] **Step 1: Make the column name contenteditable**

In `renderColumn`, replace the static `board-column-name` span:

```ts
const nameEl = document.createElement('span');
nameEl.className = 'board-column-name';
nameEl.contentEditable = 'true';
nameEl.textContent = col.name;
nameEl.addEventListener('blur', () => {
  const newName = nameEl.textContent?.trim();
  if (!newName || newName === col.name) {
    nameEl.textContent = col.name;
    return;
  }
  if (board.columns.some((c) => c.name === newName)) {
    nameEl.textContent = col.name;
    return;
  }
  const cols = board.columns.map((c) => c.name === col.name ? { ...c, name: newName } : c);
  const cards = board.cards.map((c) =>
    (c.values.Status || '') === col.name
      ? { ...c, values: { ...c.values, Status: newName } }
      : c,
  );
  mutate({ ...board, columns: cols, cards });
});
nameEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    nameEl.blur();
  }
});
```

(Replace the existing `<span class="board-column-name">...` template in the existing `innerHTML` — build the head with discrete elements instead of `innerHTML` since we need event listeners.)

- [ ] **Step 2: Smoke-test**

Click the "Todo" column name → it becomes editable. Rename to "Backlog". All cards previously in Todo now show Status=Backlog (verify in source view).

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardBlock.ts
git commit -m "feat(board): rename column inline; propagate to Status values"
```

---

### Task 28: Column ⋯ menu — change color, delete, sort

**Files:**
- Modify: `src/webview/boardBlock.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Add a ⋯ button + popover**

In each column head, append:

```ts
const dots = document.createElement('button');
dots.type = 'button';
dots.className = 'board-column-dots';
dots.textContent = '⋯';
dots.addEventListener('click', (e) => openColumnMenu(e, board, col, mutate));
head.appendChild(dots);
```

Implement `openColumnMenu` near the top of the file. It opens a small popover with three rows:
1. **Change color** — shows a row of color swatches; click sets `col.color`.
2. **Sort cards by title** — sorts only the cards in this column.
3. **Delete column** — if any cards exist, prompts for "Move to (column dropdown)" or "Delete cards"; then removes the column.

Use a simple absolutely-positioned `<div>` for the popover; `mousedown` outside closes it.

- [ ] **Step 2: Style the menu and color swatches**

Add to `board.css`:

```css
.board-column-dots {
  margin-left: 4px; background: transparent; border: 0;
  cursor: pointer; color: var(--text-muted, #6b6b66);
}
.board-column-menu {
  position: absolute;
  background: var(--block-bg-2, #fff);
  border: 1px solid var(--block-border, #e3e2de);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  padding: 4px 0;
  font-size: 13px;
  z-index: 110;
}
.board-column-menu button {
  display: block; width: 100%; padding: 6px 12px;
  background: transparent; border: 0; text-align: left; cursor: pointer;
}
.board-column-menu button:hover { background: var(--block-bg, #f7f6f3); }
.board-color-swatches { display: flex; gap: 4px; padding: 6px 12px; }
.board-color-swatch {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid transparent; cursor: pointer;
}
.board-color-swatch.is-selected { border-color: var(--text, #1f1f1c); }
```

- [ ] **Step 3: Smoke-test**

For an existing column, change color → all cards in that column visibly retint. Sort by title. Delete a non-empty column → choose "Move to Done" → cards land in Done.

- [ ] **Step 4: Commit**

```bash
git add src/webview/boardBlock.ts src/webview/styles/board.css
git commit -m "feat(board): column ⋯ menu — color, sort, delete"
```

---

### Task 29: Inline board name editing (chrome)

**Files:**
- Modify: `src/webview/boardBlock.ts`

- [ ] **Step 1: Make `.board-name` contenteditable**

```ts
function renderChrome(board: Board, mutate: (next: Board) => void): HTMLElement {
  const chrome = document.createElement('div');
  chrome.className = 'board-chrome';
  const name = document.createElement('div');
  name.className = 'board-name';
  name.contentEditable = 'true';
  name.textContent = board.name || '';
  name.dataset.placeholder = 'Untitled board';
  if (!board.name) name.classList.add('is-placeholder');
  name.addEventListener('input', () => {
    name.classList.toggle('is-placeholder', !name.textContent);
  });
  name.addEventListener('blur', () => {
    const next = name.textContent || '';
    if (next !== board.name) mutate({ ...board, name: next });
  });
  chrome.appendChild(name);
  return chrome;
}
```

CSS for placeholder:

```css
.board-name.is-placeholder::before {
  content: attr(data-placeholder);
  color: var(--text-muted, #9b9b97);
}
```

Update the call site in `render()` to pass `mutate`.

After `/board` insert, the engineer can focus the name input by adding a one-shot timer in the insert flow (Task 13). For now, manual click-to-edit is enough.

- [ ] **Step 2: Smoke-test**

Edit name; blur. Verify source has `name="..."`.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardBlock.ts src/webview/styles/board.css
git commit -m "feat(board): inline-editable board name in chrome"
```

---

## Phase 9 — Field/properties management

### Task 30: Properties button + menu shell

**Files:**
- Create: `src/webview/boardProperties.ts`
- Modify: `src/webview/boardBlock.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Build the Properties popover**

```ts
// src/webview/boardProperties.ts
import type { Board, FieldDef, FieldType } from './boardModel';

export function openPropertiesMenu(
  anchor: HTMLElement,
  board: Board,
  onChange: (next: Board) => void,
): void {
  closeOpen();
  const menu = document.createElement('div');
  menu.className = 'board-properties-menu';
  document.body.appendChild(menu);
  positionAnchored(menu, anchor);

  const list = document.createElement('div');
  list.className = 'board-properties-list';
  menu.appendChild(list);
  for (const field of board.fields) {
    list.appendChild(renderFieldRow(board, field, onChange));
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'board-properties-add';
  add.textContent = '+ Add field';
  add.addEventListener('click', () => promptNewField(board, onChange));
  menu.appendChild(add);

  document.addEventListener('mousedown', onOutside, true);
  function onOutside(e: MouseEvent) {
    if (!menu.contains(e.target as Node) && e.target !== anchor) {
      closeOpen();
    }
  }

  function closeOpen() {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
  }
}

function renderFieldRow(board: Board, field: FieldDef, onChange: (next: Board) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-properties-row';

  const name = document.createElement('span');
  name.className = 'board-properties-name';
  name.textContent = field.name;

  const type = document.createElement('span');
  type.className = 'board-properties-type';
  type.textContent = field.type;

  const visToggle = document.createElement('input');
  visToggle.type = 'checkbox';
  visToggle.checked = field.visibleOnCard;
  visToggle.disabled = field.name === 'Title' || field.name === 'Status';
  visToggle.addEventListener('change', () => {
    const fields = board.fields.map((f) =>
      f.name === field.name ? { ...f, visibleOnCard: visToggle.checked } : f,
    );
    onChange({ ...board, fields });
  });

  row.append(name, type, visToggle);
  return row;
}

function promptNewField(board: Board, onChange: (next: Board) => void): void {
  const name = prompt('Field name');
  if (!name) return;
  if (board.fields.some((f) => f.name === name)) {
    alert('A field with that name already exists.');
    return;
  }
  const type = prompt('Type (text / status / date / person / tags)', 'text') as FieldType;
  if (!['text','status','date','person','tags'].includes(type)) return;
  onChange({
    ...board,
    fields: [...board.fields, { name, type, visibleOnCard: true }],
    cards: board.cards.map((c) => ({ ...c, values: { ...c.values, [name]: '' } })),
  });
}

function positionAnchored(menu: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'absolute';
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;
}
```

- [ ] **Step 2: Wire Properties button into chrome**

In `renderChrome`:

```ts
const props = document.createElement('button');
props.type = 'button';
props.className = 'board-properties-btn';
props.textContent = 'Properties';
props.addEventListener('click', () => openPropertiesMenu(props, board, mutate));
chrome.appendChild(props);
```

Import `openPropertiesMenu` from `./boardProperties`.

- [ ] **Step 3: Smoke-test**

Click Properties → menu opens listing Title, Status, id. Toggle "show on card" for a field; verify card chips update.

- [ ] **Step 4: Commit**

```bash
git add src/webview/boardProperties.ts src/webview/boardBlock.ts src/webview/styles/board.css
git commit -m "feat(board): Properties menu — list fields, toggle visibility, add field"
```

---

### Task 31: Rename and delete fields from Properties

**Files:**
- Modify: `src/webview/boardProperties.ts`

- [ ] **Step 1: Make field name inline-editable**

In `renderFieldRow`:

```ts
name.contentEditable = field.name !== 'Title' && field.name !== 'Status' ? 'true' : 'false';
name.addEventListener('blur', () => {
  const next = name.textContent?.trim();
  if (!next || next === field.name) { name.textContent = field.name; return; }
  if (board.fields.some((f) => f.name === next)) { name.textContent = field.name; return; }
  // Rename field across the model.
  const fields = board.fields.map((f) => f.name === field.name ? { ...f, name: next } : f);
  const cards = board.cards.map((c) => {
    const v: Record<string, string> = { ...c.values };
    v[next] = v[field.name] || '';
    delete v[field.name];
    return { ...c, values: v };
  });
  onChange({ ...board, fields, cards });
});
```

- [ ] **Step 2: Add a delete button (disabled for Title/Status)**

```ts
const del = document.createElement('button');
del.type = 'button';
del.textContent = '×';
del.disabled = field.name === 'Title' || field.name === 'Status';
del.addEventListener('click', () => {
  if (!confirm(`Delete field "${field.name}"? Values will be lost.`)) return;
  const fields = board.fields.filter((f) => f.name !== field.name);
  const cards = board.cards.map((c) => {
    const v = { ...c.values };
    delete v[field.name];
    return { ...c, values: v };
  });
  onChange({ ...board, fields, cards });
});
row.appendChild(del);
```

- [ ] **Step 3: Smoke-test**

Rename "Owner" → "Assignee". Verify in source view that the column header changed and values stayed. Delete a field; verify the column is gone.

- [ ] **Step 4: Commit**

```bash
git add src/webview/boardProperties.ts
git commit -m "feat(board): rename and delete fields from Properties menu"
```

---

### Task 32: Reorder fields with a drag handle

**Files:**
- Modify: `src/webview/boardProperties.ts`

- [ ] **Step 1: Add a drag handle and handlers**

Prepend a handle:

```ts
const handle = document.createElement('span');
handle.className = 'board-properties-handle';
handle.textContent = '⋮⋮';
handle.draggable = true;
row.prepend(handle);
row.dataset.fieldName = field.name;
handle.addEventListener('dragstart', (e) => {
  e.dataTransfer!.setData('text/board-field-name', field.name);
});
row.addEventListener('dragover', (e) => {
  if (e.dataTransfer!.types.includes('text/board-field-name')) e.preventDefault();
});
row.addEventListener('drop', (e) => {
  const from = e.dataTransfer!.getData('text/board-field-name');
  if (!from || from === field.name) return;
  // Title must always be first; Status must be second; can't move them.
  if (from === 'Title' || from === 'Status' || field.name === 'Title' || field.name === 'Status') return;
  const fields = [...board.fields];
  const fromIdx = fields.findIndex((f) => f.name === from);
  const toIdx = fields.findIndex((f) => f.name === field.name);
  const [moved] = fields.splice(fromIdx, 1);
  fields.splice(toIdx, 0, moved);
  onChange({ ...board, fields });
});
```

- [ ] **Step 2: Smoke-test**

Drag a custom field above another. Save → reload → order preserved in table.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardProperties.ts
git commit -m "feat(board): reorder fields by drag in Properties menu"
```

---

### Task 33: "+ Add field" inline picker (replaces the `prompt` stopgap)

**Files:**
- Modify: `src/webview/boardProperties.ts`
- Modify: `src/webview/styles/board.css`

- [ ] **Step 1: Replace `prompt(...)` with an inline popover**

Replace `promptNewField` with a popover that contains:
- A text input for the name
- A select for the type
- "Add" and "Cancel" buttons

Style with the same `.board-column-menu`-style classes.

- [ ] **Step 2: Smoke-test**

Add a "Priority" field of type `text`. Open a card; the new field appears in the side panel.

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardProperties.ts src/webview/styles/board.css
git commit -m "feat(board): inline picker for + Add field"
```

---

## Phase 10 — Edge cases, polish, and integration

### Task 34: Duplicate-id auto-suffix on save

**Files:**
- Modify: `src/webview/boardModel.ts`
- Modify: `tests/board/serialize.test.ts`

- [ ] **Step 1: Add failing test**

```ts
it('auto-suffixes duplicate ids on serialize', () => {
  const board: Board = {
    id: 'b1', name: '', columns: [],
    fields: [
      { name: 'Title', type: 'text', visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'id', type: 'text', visibleOnCard: false },
    ],
    cards: [
      { id: 'c1', values: { id: 'c1', Title: 'A', Status: '' }, body: '' },
      { id: 'c1', values: { id: 'c1', Title: 'B', Status: '' }, body: '' },
      { id: 'c1', values: { id: 'c1', Title: 'C', Status: '' }, body: '' },
    ],
  };
  const out = serializeBoard(board);
  expect(out).toMatch(/\|\s*c1\s*\|\s*A\s*\|/);
  expect(out).toMatch(/\|\s*c1-2\s*\|\s*B\s*\|/);
  expect(out).toMatch(/\|\s*c1-3\s*\|\s*C\s*\|/);
});
```

- [ ] **Step 2: Implement de-dup in `serializeBoard`**

In `serializeBoard`, before building the table, run:

```ts
const seen = new Set<string>();
board = { ...board, cards: board.cards.map((c) => {
  let id = c.id || `c-${Math.random().toString(36).slice(2, 6)}`;
  if (!seen.has(id)) { seen.add(id); return { ...c, id, values: { ...c.values, id } }; }
  let n = 2;
  while (seen.has(`${id}-${n}`)) n++;
  const next = `${id}-${n}`;
  seen.add(next);
  return { ...c, id: next, values: { ...c.values, id: next } };
}) };
```

- [ ] **Step 3: Run tests, see pass**

```bash
npx jest tests/board/serialize.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/webview/boardModel.ts tests/board/serialize.test.ts
git commit -m "feat(board): auto-suffix duplicate card ids on serialize"
```

---

### Task 35: Read-only mode honored everywhere

**Files:**
- Modify: `src/webview/boardBlock.ts`
- Modify: `src/webview/boardSidePanel.ts`
- Modify: `src/webview/boardProperties.ts`

- [ ] **Step 1: Thread `isReadOnly` from the editor into the board view**

The existing read-only state is reachable from the editor (search `setReadOnly` in [editor.ts](../../src/webview/editor.ts)). Expose a `isReadOnly()` getter. Pass through `BoardViewOptions`:

```ts
export interface BoardViewOptions {
  onMutate(nextSource: string): void;
  isReadOnly(): boolean;
}
```

In `addNodeView`, wire it from `editor.isEditable === false`.

- [ ] **Step 2: Suppress interactive UI when read-only**

In `boardBlock.ts`, skip rendering:
- `+ Add card`
- `+ Add column`
- Column ⋯ menu
- Card / column draggable=true
- Inline editable name / column-name

In `boardSidePanel.ts`, set all contenteditable to `false`, hide tag-input/`<input>` controls, and gate `onChange` so it no-ops.

In `boardProperties.ts`, render rows but hide the add/delete/rename/drag affordances.

- [ ] **Step 3: Smoke-test**

Enable read-only via the dots-menu. Verify no interactive affordances remain, but clicking a card still opens the side panel in display mode.

- [ ] **Step 4: Commit**

```bash
git add src/webview/boardBlock.ts src/webview/boardSidePanel.ts \
        src/webview/boardProperties.ts src/webview/extensions/board.ts
git commit -m "feat(board): respect read-only mode across all board UI"
```

---

### Task 35.5: Preserve orphan `board:body` blocks on round-trip

The spec says: *"Bodies whose `id` has no matching row are preserved on round-trip but not rendered."* The current parse drops orphans silently.

**Files:**
- Modify: `src/webview/boardModel.ts`
- Modify: `tests/board/roundtrip.test.ts`

- [ ] **Step 1: Add failing round-trip test**

Append to `tests/board/roundtrip.test.ts`:

```ts
it('preserves orphan board:body blocks on round-trip', () => {
  const source = [
    `<!-- board:start id="b1" -->`,
    ``,
    `| id | Title | Status |`,
    `|---|---|---|`,
    `| c1 | First | Todo |`,
    ``,
    `<!-- board:body id="c1" -->`,
    ``,
    `Body for c1`,
    ``,
    `<!-- board:body id="ghost" -->`,
    ``,
    `Body for a deleted card`,
    ``,
    `<!-- board:end -->`,
  ].join('\n');
  const a = parseBoardSource(source);
  const out = serializeBoard(a);
  expect(out).toContain('<!-- board:body id="ghost" -->');
  expect(out).toContain('Body for a deleted card');
});
```

- [ ] **Step 2: Run, see fail**

```bash
npx jest tests/board/roundtrip.test.ts -t 'orphan'
```

Expected: FAIL (orphan body is dropped).

- [ ] **Step 3: Extend the model**

Add to `Board`:

```ts
export interface Board {
  id: string;
  name: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  cards: Card[];
  orphanBodies: { id: string; body: string }[];  // preserved verbatim
}
```

Update `parseBoardSource` after building `cards`:

```ts
const cardIds = new Set(cards.map((c) => c.id));
const orphanBodies: { id: string; body: string }[] = [];
for (const [bid, body] of bodyById.entries()) {
  if (!cardIds.has(bid)) {
    orphanBodies.push({ id: bid, body });
    // eslint-disable-next-line no-console
    console.warn(`[board] orphan board:body id="${bid}" (no matching card row)`);
  }
}
return { id: /*...*/, name: /*...*/, columns, fields, cards, orphanBodies };
```

Also update the initial empty-board return from Task 1 to include `orphanBodies: []`.

Update `serializeBodies` to also emit orphans (after cards):

```ts
function serializeBodies(board: Board): string {
  const parts: string[] = [];
  for (const card of board.cards) {
    const body = card.body.trim();
    if (!body) continue;
    parts.push(`<!-- board:body id="${card.id}" -->`);
    parts.push('');
    parts.push(body);
    parts.push('');
  }
  for (const orphan of board.orphanBodies) {
    parts.push(`<!-- board:body id="${orphan.id}" -->`);
    parts.push('');
    parts.push(orphan.body.trim());
    parts.push('');
  }
  return parts.join('\n');
}
```

Update every other place that constructs a `Board` literal in the codebase (the `freshBoardSource` helper in `blockPicker.ts` is a string, not an object, so it's unaffected) — search:

```bash
grep -rn "fields:" src/webview/boardModel.ts src/webview/boardBlock.ts src/webview/boardSidePanel.ts
```

Add `orphanBodies: []` (or `orphanBodies: board.orphanBodies` for spreads) wherever a `Board` is constructed/spread to preserve existing orphans through mutations.

- [ ] **Step 4: Run, see pass**

```bash
npx jest tests/board/roundtrip.test.ts
```

All round-trip tests should pass.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardModel.ts src/webview/boardBlock.ts \
        src/webview/boardSidePanel.ts tests/board/roundtrip.test.ts
git commit -m "feat(board): preserve orphan board:body blocks on round-trip"
```

---

### Task 36: External-edit sync — reparse on update

**Files:**
- Modify: `src/webview/extensions/board.ts`

The existing conflict banner + refresh flow re-runs `updateContent` on the editor. Because each board's `source` lives in the node attrs (which Tiptap rebuilds from the new markdown), the NodeView's `update()` callback will fire with the new source. Verify this:

- [ ] **Step 1: Manual test**

Open a board file in the extension. In another editor (or VSCode itself in source view), edit a status cell directly. Save. Switch back to the block view. Verify the change is reflected after the refresh prompt.

- [ ] **Step 2: If the NodeView doesn't update, force re-parse**

If the NodeView doesn't pick up changes (because Tiptap reuses the existing node when the doc looks similar), gate on `node.attrs.source` strict-equality in `update`:

```ts
update(updatedNode) {
  if (updatedNode.type !== node.type) return false;
  const next = updatedNode.attrs.source as string;
  if (next === lastSource) return true;
  lastSource = next;
  view.update(next);
  return true;
},
```

- [ ] **Step 3: Commit**

```bash
git add src/webview/extensions/board.ts
git commit -m "feat(board): refresh NodeView on external source changes"
```

---

### Task 37: End-to-end integration test (manual scenario script)

**Files:**
- Create: `tests/board/integration-script.md`

This is a manual checklist the engineer (and future-you) runs after the feature lands.

- [ ] **Step 1: Write the script**

```markdown
# Board integration manual test

1. Create a new .md file. Insert `/board`. A 3-column kanban appears with one "New card" in Todo.
2. Rename the board to "Test board". Switch to source view; confirm `name="Test board"`.
3. Click the card. Side panel opens. Type a title. Add a description ("body") with a heading and a list.
4. Add an "Owner" field via Properties → Add field → type=person. Set its value to `@me` in the side panel.
5. Add a "Due" field via Properties → Add field → type=date. Set to today + 1 day.
6. Add 2 more cards. Drag one from Todo to Done.
7. Drag the Done column to be first.
8. Switch to source view. Verify the file is a clean markdown table + bodies + markers — no JSON blobs.
9. Close VSCode. Reopen the file. Everything renders identically.
10. Open the file in another markdown viewer (e.g. GitHub preview). Verify the table is readable and the bodies render as normal markdown.
11. In the dots menu, enable read-only. Verify no edits, drags, or `+` buttons.
12. Disable read-only. Edit a status cell directly in source view (e.g. type "Doing" instead of "Done"). Save. Switch back to block view — the card moved.
```

- [ ] **Step 2: Run through every step**

Note any issues. Open a fix task for each one before merging.

- [ ] **Step 3: Commit**

```bash
git add tests/board/integration-script.md
git commit -m "test(board): manual integration script for end-to-end scenarios"
```

---

### Task 38: Final review — round-trip the spec example through the running editor

- [ ] **Step 1: Copy the spec's example markdown into a test file**

Paste the storage example from [the spec](../specs/2026-05-20-board-block-design.md) into `board-demo.md` at the project root.

- [ ] **Step 2: Open in the running extension**

Verify:
- Both cards render with correct fields.
- `Sprint 12` shows as the board name.
- `c1`'s body shows `## Goal` heading and bullet list when the side panel opens.
- Columns are in the order `Todo | Doing | Done` with colors `blue | amber | emerald`.

- [ ] **Step 3: Switch to source view, then back**

The source must remain byte-identical (allowing for whitespace normalization in the table) across the round-trip.

- [ ] **Step 4: Commit `board-demo.md` (optional fixture)**

```bash
git add board-demo.md
git commit -m "docs(board): demo file for manual verification"
```

---

## Done

After Task 38, the v1 board feature is complete. The data model is fully tested, the UI is manually verified end-to-end, and the markdown stays human-readable in any viewer.

Future work (per spec's "Out of scope") includes table/timeline views, card relations, formulas, templates, comments, member auto-complete, task-list auto-promotion, and CSV export — each a follow-up plan keyed off the same `Board` model.
