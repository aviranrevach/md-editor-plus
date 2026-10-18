# Whiteboard slash-menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/whiteboard` slash-menu entry that drops a pre-pinned, three-node mermaid block onto the page and auto-opens the visual-edit palette in a single transaction.

**Architecture:** A new `BLOCK_DEFS` entry in [blockPicker.ts](src/webview/blockPicker.ts) inserts a `codeBlock` with `language: 'mermaid'` whose source is a flowchart with three nodes and a `%% mb-positions:` sidecar. One animation frame after insertion, the picker calls `__mbOpenVisualMode()` — a function exposed by the mermaid NodeView in [mermaidBlock.ts](src/webview/extensions/mermaidBlock.ts) — to flip the block into visual mode. No schema changes, no new node types.

**Tech Stack:** TypeScript, tiptap, ProseMirror, mermaid, jest (`testEnvironment: 'node'`, no jsdom needed for these tests since we mock the editor).

**Spec:** [docs/superpowers/specs/2026-05-25-whiteboard-slash-menu-design.md](docs/superpowers/specs/2026-05-25-whiteboard-slash-menu-design.md)

---

## Task 1: `freshWhiteboardSource()` source builder (TDD)

Build the starter mermaid source as a pure function and verify it parses cleanly through the existing `mermaidVisualEdit` pipeline.

**Files:**
- Create: `tests/mermaid/whiteboard-source.test.ts`
- Modify: `src/webview/blockPicker.ts` (add exported `freshWhiteboardSource` helper near the bottom, next to the existing `freshBoardSource` at line 595)

- [ ] **Step 1.1: Write the failing test file**

Create `tests/mermaid/whiteboard-source.test.ts`:

```ts
// Tests for the slash-menu Whiteboard starter source.
// Pure data — node env, no DOM, mirrors tests/mermaid/lines.test.ts.

import { freshWhiteboardSource } from '../../src/webview/blockPicker';
import { parseMermaid, serializeMermaid, canEdit, getPositions } from '../../src/webview/mermaidVisualEdit';

describe('freshWhiteboardSource', () => {
  it('parses to 3 nodes A/B/C with labels Idea/Next/Done', () => {
    const src = freshWhiteboardSource();
    const ast = parseMermaid(src);
    const nodes = ast.lines
      .filter((l) => l.kind === 'node')
      .map((l) => (l as { kind: 'node'; node: { id: string; label: string } }).node);
    expect(nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
    expect(nodes.map((n) => n.label)).toEqual(['Idea', 'Next', 'Done']);
  });

  it('parses to 2 edges A->B and B->C', () => {
    const src = freshWhiteboardSource();
    const ast = parseMermaid(src);
    const edges = ast.lines
      .filter((l) => l.kind === 'edge')
      .map((l) => (l as { kind: 'edge'; edge: { from: string; to: string } }).edge);
    expect(edges.map((e) => `${e.from}->${e.to}`)).toEqual(['A->B', 'B->C']);
  });

  it('pins positions for A/B/C at the documented coordinates', () => {
    const ast = parseMermaid(freshWhiteboardSource());
    expect(getPositions(ast)).toEqual({
      A: [120, 80],
      B: [320, 80],
      C: [520, 80],
    });
  });

  it('canEdit returns true (visual editor accepts the starter)', () => {
    expect(canEdit(freshWhiteboardSource())).toBe(true);
  });

  it('serialize(parse(src)) === src — round-trip is byte-clean', () => {
    const src = freshWhiteboardSource();
    expect(serializeMermaid(parseMermaid(src))).toBe(src);
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

```
npm test -- whiteboard-source
```

Expected: `Module '"../../src/webview/blockPicker"' has no exported member 'freshWhiteboardSource'`. (Or all 5 tests fail with import error.)

- [ ] **Step 1.3: Implement `freshWhiteboardSource`**

Open [src/webview/blockPicker.ts](src/webview/blockPicker.ts). Just above the existing `freshBoardSource` function at line 595, add:

```ts
export function freshWhiteboardSource(): string {
  return [
    'flowchart LR',
    '    %% mb-positions: {"A":[120,80],"B":[320,80],"C":[520,80]}',
    '    A[Idea]',
    '    B[Next]',
    '    C[Done]',
    '    A --> B',
    '    B --> C',
  ].join('\n');
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

```
npm test -- whiteboard-source
```

Expected: 5 passing.

If the round-trip test fails because `serializeMermaid` emits different whitespace/indent than the input, adjust the input string to match `serializeMermaid`'s canonical output — re-running the test will tell you which line differs. The most likely culprit is leading-spaces on node/edge lines (the serializer at [mermaidVisualEdit.ts:933](src/webview/mermaidVisualEdit.ts#L933) uses 4-space indent).

- [ ] **Step 1.5: Commit**

```bash
git add tests/mermaid/whiteboard-source.test.ts src/webview/blockPicker.ts
git commit -m "feat(whiteboard): add freshWhiteboardSource() — 3-node pre-pinned starter for the upcoming slash-menu entry"
```

---

## Task 2: `insertWhiteboard()` insert action (TDD with mocked editor)

The editor instance can't be mounted in jest (lowlight is ESM-only and the codebase stubs `editor.ts` via `tests/__mocks__/editorMock.js`). So we test `insertWhiteboard` against a hand-built mock editor that records chain calls.

**Files:**
- Create: `tests/mermaid/whiteboard-insert.test.ts`
- Modify: `src/webview/blockPicker.ts` (add exported `insertWhiteboard` helper next to `freshWhiteboardSource`)

- [ ] **Step 2.1: Write the failing test file**

Create `tests/mermaid/whiteboard-insert.test.ts`:

```ts
// Tests for the slash-menu Whiteboard insert action.
// Uses a hand-built mock editor — the real tiptap editor isn't loadable in jest
// because lowlight is ESM-only and editor.ts is stubbed via the editorMock.

import { insertWhiteboard, freshWhiteboardSource } from '../../src/webview/blockPicker';

type InsertedContent = ReadonlyArray<unknown>;

// Build a minimal mock editor exposing the surface insertWhiteboard touches:
//   editor.chain().focus().insertContentAt(pos, content).run()
//   editor.view.nodeDOM(pos)
function buildMockEditor(opts: { nodeDom?: HTMLElement | null } = {}) {
  const calls: { pos: number; content: InsertedContent }[] = [];
  const chain = {
    focus() { return this; },
    insertContentAt(pos: number, content: InsertedContent) {
      calls.push({ pos, content });
      return this;
    },
    run() { return true; },
  };
  const view = {
    nodeDOM: jest.fn((_pos: number) => opts.nodeDom ?? null),
  };
  return {
    editor: {
      chain: () => chain,
      view,
      // The rest of the Editor surface — unused by insertWhiteboard.
    } as unknown as import('@tiptap/core').Editor,
    calls,
    view,
  };
}

// Synchronously fire requestAnimationFrame so we don't need fake timers.
beforeEach(() => {
  (global as { requestAnimationFrame: (cb: FrameRequestCallback) => number })
    .requestAnimationFrame = (cb) => { cb(0); return 0; };
});

describe('insertWhiteboard', () => {
  it('inserts a codeBlock(mermaid) + paragraph at the given position', () => {
    const { editor, calls } = buildMockEditor();
    insertWhiteboard(editor, 42);
    expect(calls).toHaveLength(1);
    expect(calls[0].pos).toBe(42);
    expect(calls[0].content).toEqual([
      {
        type: 'codeBlock',
        attrs: { language: 'mermaid' },
        content: [{ type: 'text', text: freshWhiteboardSource() }],
      },
      { type: 'paragraph' },
    ]);
  });

  it('looks up the inserted block DOM via editor.view.nodeDOM(pos)', () => {
    const { editor, view } = buildMockEditor();
    insertWhiteboard(editor, 42);
    expect(view.nodeDOM).toHaveBeenCalledTimes(1);
    expect(view.nodeDOM).toHaveBeenCalledWith(42);
  });

  it('invokes __mbOpenVisualMode on the returned DOM element', () => {
    const open = jest.fn();
    const dom = Object.assign(document.createElement('div'), { __mbOpenVisualMode: open });
    const { editor } = buildMockEditor({ nodeDom: dom });
    insertWhiteboard(editor, 42);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('is a safe no-op when nodeDOM returns null (no throw)', () => {
    const { editor } = buildMockEditor({ nodeDom: null });
    expect(() => insertWhiteboard(editor, 42)).not.toThrow();
  });

  it('is a safe no-op when the DOM has no __mbOpenVisualMode hook (no throw)', () => {
    const dom = document.createElement('div'); // no hook attached
    const { editor } = buildMockEditor({ nodeDom: dom });
    expect(() => insertWhiteboard(editor, 42)).not.toThrow();
  });
});
```

Note: this test uses `document.createElement` and `jest.fn()`. The jest `testEnvironment` is `node`, which doesn't have `document`. The simplest fix is to add a `@jest-environment jsdom` pragma at the top of THIS file only (other mermaid tests stay on node env). Add this as the very first line of the file:

```ts
/**
 * @jest-environment jsdom
 */
```

- [ ] **Step 2.2: Run the test to verify it fails**

```
npm test -- whiteboard-insert
```

Expected: `Module '"../../src/webview/blockPicker"' has no exported member 'insertWhiteboard'`. All 5 tests fail on import.

- [ ] **Step 2.3: Implement `insertWhiteboard`**

In [src/webview/blockPicker.ts](src/webview/blockPicker.ts), just below `freshWhiteboardSource` (added in Task 1), add:

```ts
export function insertWhiteboard(editor: Editor, pos: number): void {
  const source = freshWhiteboardSource();
  editor
    .chain()
    .focus()
    .insertContentAt(pos, [
      {
        type: 'codeBlock',
        attrs: { language: 'mermaid' },
        content: [{ type: 'text', text: source }],
      },
      { type: 'paragraph' },
    ])
    .run();

  requestAnimationFrame(() => {
    const dom = (editor as unknown as {
      view: { nodeDOM: (pos: number) => (HTMLElement & { __mbOpenVisualMode?: () => void }) | null };
    }).view.nodeDOM(pos);
    dom?.__mbOpenVisualMode?.();
  });
}
```

- [ ] **Step 2.4: Run the test to verify it passes**

```
npm test -- whiteboard-insert
```

Expected: 5 passing.

- [ ] **Step 2.5: Commit**

```bash
git add tests/mermaid/whiteboard-insert.test.ts src/webview/blockPicker.ts
git commit -m "feat(whiteboard): add insertWhiteboard() — inserts the starter block + schedules visual-mode auto-open on the next frame"
```

---

## Task 3: Wire the slash-menu `BLOCK_DEFS` entry (no new tests — visual)

The two helpers exist; now hook them into the picker so `/whiteboard` actually surfaces in the UI.

**Files:**
- Modify: `src/webview/blockPicker.ts` — add a `whiteboard` glyph to the `ICO` object (line 70-85) and append a new entry to `BLOCK_DEFS` (between `board-table` at line 324 and the closing `]` at line 325)

- [ ] **Step 3.1: Add the whiteboard icon**

In [src/webview/blockPicker.ts](src/webview/blockPicker.ts), inside the `ICO` constant (between the existing `board:` entry on line 84 and the closing `}` on line 85), add:

```ts
  whiteboard: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M200,144a31.9,31.9,0,0,0-25.8,13.2L131.1,140.6a32,32,0,0,0,0-25.2L174.2,98.8a32,32,0,1,0-5.9-14.8L125.1,100.6a32,32,0,1,0,0,54.8l43.2,16.6A32,32,0,1,0,200,144Zm0-104a16,16,0,1,1-16,16A16,16,0,0,1,200,40ZM72,144a16,16,0,1,1,16-16A16,16,0,0,1,72,144Zm128,72a16,16,0,1,1,16-16A16,16,0,0,1,200,216Z"/></svg>`,
```

- [ ] **Step 3.2: Append the BLOCK_DEFS entry**

After the existing `board-table` entry that ends at line 324 (the entry whose `insert: (editor, pos) => insertBoardWith('table', editor, pos)` closes with `},`), add:

```ts
  {
    id: 'whiteboard',
    label: 'Whiteboard',
    description: 'Freeform diagram canvas — drag, connect, style',
    iconHtml: ICO.whiteboard,
    section: 'media',
    aliases: ['mermaid', 'diagram', 'flowchart', 'graph', 'canvas'],
    insert: (editor, pos) => insertWhiteboard(editor, pos),
  },
```

- [ ] **Step 3.3: Compile-check**

```
npx tsc -p tsconfig.webview.json --noEmit
```

Expected: exit code 0, no output. (The entry uses already-typed fields from the `BlockDef` interface; `ICO.whiteboard` matches the existing pattern.)

- [ ] **Step 3.4: Run the full test suite to confirm no regressions**

```
npm test
```

Expected: all existing tests + the 10 new tests pass. (No new tests added in this task, but Task 1 + Task 2 tests should still pass with the updated file.)

- [ ] **Step 3.5: Commit**

```bash
git add src/webview/blockPicker.ts
git commit -m "feat(whiteboard): surface /whiteboard in the slash menu — Media & blocks section, aliases mermaid/diagram/flowchart/graph/canvas"
```

---

## Task 4: NodeView hook — attach `__mbOpenVisualMode` (no new tests — covered by manual smoke)

The slash-menu insert calls `dom.__mbOpenVisualMode?.()`, but no NodeView attaches it yet. Add the one-line attachment. The spec explicitly puts unit-test coverage out of scope for this line (full NodeView mocking isn't worth the cost); manual verification in Task 5 covers it end-to-end.

**Files:**
- Modify: `src/webview/extensions/mermaidBlock.ts` — add one line inside `buildMermaidView`, right before the `return { dom, contentDOM, … }` at line 382.

- [ ] **Step 4.1: Add the hook attachment**

Open [src/webview/extensions/mermaidBlock.ts](src/webview/extensions/mermaidBlock.ts). Find the `return {` at line 382 inside `buildMermaidView`. Immediately above that line, add:

```ts
  (dom as Element & { __mbOpenVisualMode?: () => void }).__mbOpenVisualMode = () => {
    if (canEdit(currentSource())) setVisualEditing(true);
  };
```

The names `canEdit`, `currentSource`, and `setVisualEditing` are already in scope at that location — `canEdit` is imported at line 22, `currentSource` is a closure at line 142 (approximately), and `setVisualEditing` is defined at line 193.

- [ ] **Step 4.2: Compile-check**

```
npx tsc -p tsconfig.webview.json --noEmit
```

Expected: exit code 0, no output.

- [ ] **Step 4.3: Run the full test suite**

```
npm test
```

Expected: all tests pass.

- [ ] **Step 4.4: Commit**

```bash
git add src/webview/extensions/mermaidBlock.ts
git commit -m "feat(whiteboard): expose __mbOpenVisualMode on the mermaid NodeView dom — lets the slash-menu insert auto-flip into visual mode"
```

---

## Task 5: Build, full verification, manual smoke

Locks down that nothing else regressed and the user-facing flow actually works.

**Files:** none (verification only)

- [ ] **Step 5.1: Type-check and bundle**

```
npm run compile
```

Expected: exits 0. The `compile` script runs `tsc -p tsconfig.json` and then esbuild — both must succeed. If esbuild surfaces an unused-import warning for `canEdit` in `mermaidBlock.ts` (already imported pre-change), ignore it.

- [ ] **Step 5.2: Run the full test suite**

```
npm test
```

Expected: all tests pass, including the 10 new ones from Tasks 1–2. Note any flaky tests but don't proceed if any of the new ones fail.

- [ ] **Step 5.3: Manual smoke — `/whiteboard` end-to-end**

Launch the extension (F5 in VS Code, or `code --extensionDevelopmentPath="$(pwd)"` from CLI). Open `demo.md` or any markdown file. With the cursor on an empty line:

1. Type `/whiteboard`. The "Whiteboard" entry should appear under **Media & blocks**, with the new icon.
2. Press Enter. The block should land with three labelled nodes (`Idea`, `Next`, `Done`) on a horizontal row, edges connecting them, and the visual-edit palette already open over the canvas. **No second click required.**
3. Drag the `Idea` node. The position pin should update — same behaviour as any other pinned mermaid block (verify via existing visual-edit experience).
4. Press Cmd/Ctrl+Z once. The entire block should disappear in a single undo step (the chain is one transaction; the visual-mode flip is UI-only, not a PM transaction).
5. Type `/mermaid` (an alias). The same Whiteboard entry should appear. Press Enter — second instance inserts and auto-opens independently of any other whiteboard on the page.

If any step fails, do NOT proceed to Step 5.4. Triage:
- Block appears but palette doesn't open → check that Task 4's hook attachment is in the right spot (inside `buildMermaidView`, after `setVisualEditing` is defined).
- Block opens but layout is wrong → confirm the `%% mb-positions:` sidecar is present in the inserted source (View Source toggle).
- Block doesn't appear in the picker at all → confirm Task 3's BLOCK_DEFS entry is in the array, not after the closing `]`.

- [ ] **Step 5.4: Final commit (only if Step 5.3 surfaced fixes)**

If Step 5.3 was clean, no commit needed — Tasks 1–4 already shipped everything. If you had to amend code, commit those fixes with a clear message describing what manual smoke revealed.

- [ ] **Step 5.5: Push the branch (only when the user asks)**

`git push` is not part of this plan. Stop here and let the user decide whether to push, open a PR, or keep iterating locally.
