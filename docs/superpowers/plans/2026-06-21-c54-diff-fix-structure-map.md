# c54 — Diff fix + structure-map navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the full-diff so unsaved new sections appear, and add a VS Code-style structure-map rail (heading ticks + viewport box) for navigation.

**Architecture:** Part 1 flushes the webview's pending markdown into the `TextDocument` before opening the native diff, via a small pure ordering helper. Part 2 adds a right-edge rail that renders the *existing* outline data (`getOutline` / `OUTLINE_EVENT` / `coordsAtPos`) as ticks with a draggable viewport box; the position math lives in a pure, unit-tested core with a thin DOM shell around it.

**Tech Stack:** TypeScript, TipTap/ProseMirror (webview), VS Code custom editor API, Jest (ts-jest, `tests/**/*.test.ts`), Phosphor-style inline SVG icons.

## Global Constraints

- Tests live in `tests/**/*.test.ts`; run with `npm test` (jest, ts-jest). Pure modules only (no DOM) run under `testEnvironment: node`.
- Two test suites already fail to compile on main (`toggle.test.ts`, `board/grouping.test.ts`) — pre-existing, unrelated. Do NOT treat them as regressions; 688/688 *other* tests pass.
- Reuse existing primitives — never re-query the DOM for headings, never hand-roll heading collection. Source of truth: `src/webview/extensions/outline.ts` (`getOutline`, `OUTLINE_EVENT`, `OutlineEntry` = `{ pos; level: 1|2|3; text }`).
- New icons: match the toolbar's existing inline-SVG style, `viewBox="0 0 256 256"`, `width/height="16"`.
- Settings persist via a `save…Visible` message → `cfg.update(key, value, ConfigurationTarget.Global)` → fed back through `init.defaults`.
- Never show the OS default scrollbar; the rail uses hide/expand-on-hover styling.
- Commit after each task. End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- `src/diffPrepare.ts` *(create)* — pure ordering helper `applyEditThenDiff`. No vscode import (unit-testable).
- `tests/diffPrepare.test.ts` *(create)* — tests the helper's ordering/short-circuit.
- `src/mdEditorPlusProvider.ts` *(modify)* — use the helper in the `openFullDiff` case; add structure-map button HTML, icon, config plumbing, and `saveStructureMapVisible` handler + `init.defaults`.
- `src/webview/index.ts` *(modify)* — send current markdown with `openFullDiff` (button + conflict-banner); instantiate the structure map.
- `src/webview/structureMapCore.ts` *(create)* — pure `computeMap(input)` math.
- `tests/structureMapCore.test.ts` *(create)* — tests `computeMap`.
- `src/webview/structureMap.ts` *(create)* — DOM shell (`createStructureMap`): outline data → ticks, scroll/resize updates, click/drag/hover, visibility + persistence.
- `src/webview/styles/editor.css` *(modify)* — rail, ticks, viewport box, hover-expand, hide in source mode.
- `package.json` *(modify)* — add `mdEditorPlus.structureMapVisible` config contribution.

---

## Task 1: Diff flush fix

**Files:**
- Create: `src/diffPrepare.ts`
- Test: `tests/diffPrepare.test.ts`
- Modify: `src/mdEditorPlusProvider.ts:259-263` (the `openFullDiff` case)
- Modify: `src/webview/index.ts:304-306` (diff button) and `src/webview/index.ts:360` (conflict-banner open-full-diff)

**Interfaces:**
- Produces: `applyEditThenDiff(markdown: string | undefined, applyEdit: (md: string) => Promise<void>, openDiff: () => Promise<void>): Promise<void>` — awaits `applyEdit(markdown)` first when `markdown !== undefined`, then awaits `openDiff()`.
- Consumes (already exported): `getCurrentMarkdown()` from `./editor` (imported at `index.ts:5`).

- [ ] **Step 1: Write the failing test**

Create `tests/diffPrepare.test.ts`:

```ts
import { applyEditThenDiff } from '../src/diffPrepare';

describe('applyEditThenDiff', () => {
  it('applies the edit before opening the diff when markdown is provided', async () => {
    const calls: string[] = [];
    const applyEdit = async (md: string) => { calls.push('apply:' + md); };
    const openDiff = async () => { calls.push('open'); };
    await applyEditThenDiff('NEW SECTION', applyEdit, openDiff);
    expect(calls).toEqual(['apply:NEW SECTION', 'open']);
  });

  it('awaits the edit fully before opening (no interleave)', async () => {
    const calls: string[] = [];
    const applyEdit = (md: string) => new Promise<void>((res) => {
      setTimeout(() => { calls.push('apply-done'); res(); }, 5);
    });
    const openDiff = async () => { calls.push('open'); };
    await applyEditThenDiff('x', applyEdit, openDiff);
    expect(calls).toEqual(['apply-done', 'open']);
  });

  it('skips applyEdit and opens directly when markdown is undefined', async () => {
    const calls: string[] = [];
    const applyEdit = async () => { calls.push('apply'); };
    const openDiff = async () => { calls.push('open'); };
    await applyEditThenDiff(undefined, applyEdit, openDiff);
    expect(calls).toEqual(['open']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/diffPrepare.test.ts`
Expected: FAIL — `Cannot find module '../src/diffPrepare'`.

- [ ] **Step 3: Write the helper**

Create `src/diffPrepare.ts`:

```ts
// Pure ordering helper for the full-diff path (c54). No vscode import, so it is
// unit-testable. Guarantees the webview's pending markdown is flushed into the
// document BEFORE the diff opens, so newly-typed (unsaved) sections appear.
export async function applyEditThenDiff(
  markdown: string | undefined,
  applyEdit: (md: string) => Promise<void>,
  openDiff: () => Promise<void>,
): Promise<void> {
  if (markdown !== undefined) await applyEdit(markdown);
  await openDiff();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/diffPrepare.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Wire the provider**

In `src/mdEditorPlusProvider.ts`, add the import near the existing diff import (`import { openFullDiff } from './diffViewer';`):

```ts
import { applyEditThenDiff } from './diffPrepare';
```

Replace the `openFullDiff` case (currently lines 259-263):

```ts
      if (msg.type === 'openFullDiff') {
        const m = msg as unknown as { baseContent?: string; baseLabel?: string; markdown?: string };
        await applyEditThenDiff(
          m.markdown,
          (md) => this._applyEdit(document, md),
          () => openFullDiff(document, { baseContent: m.baseContent, baseLabel: m.baseLabel }, openSnapshot),
        );
        return;
      }
```

- [ ] **Step 6: Wire the webview**

In `src/webview/index.ts`, the diff button (lines 304-306):

```ts
  document.getElementById('diff-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openFullDiff', markdown: getCurrentMarkdown() });
  });
```

And the conflict-banner full-diff trigger (line 360) — add the current markdown so its right side is current too:

```ts
      onOpenFullDiff: () => vscode.postMessage({ type: 'openFullDiff', baseContent: disk, baseLabel: 'On disk', markdown: getCurrentMarkdown() }),
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.webview.json`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/diffPrepare.ts tests/diffPrepare.test.ts src/mdEditorPlusProvider.ts src/webview/index.ts
git commit -m "fix(c54): flush pending edits before opening full diff

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Structure-map math core

**Files:**
- Create: `src/webview/structureMapCore.ts`
- Test: `tests/structureMapCore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MapHeading { pos: number; level: 1 | 2 | 3; docY: number; }
  export interface MapInput {
    headings: MapHeading[];
    docHeight: number;       // total scrollable content height (px)
    scrollY: number;         // window.scrollY
    viewportHeight: number;  // window.innerHeight
  }
  export interface MapTick { pos: number; level: 1 | 2 | 3; topFrac: number; }
  export interface MapResult {
    ticks: MapTick[];                              // topFrac in [0,1]
    viewport: { topFrac: number; heightFrac: number }; // both in [0,1]
  }
  export function computeMap(input: MapInput): MapResult;
  ```
- Consumed by: Task 3 (`structureMap.ts`).

- [ ] **Step 1: Write the failing test**

Create `tests/structureMapCore.test.ts`:

```ts
import { computeMap } from '../src/webview/structureMapCore';

const base = { docHeight: 1000, scrollY: 0, viewportHeight: 200 };

describe('computeMap', () => {
  it('maps heading docY to a fraction of the document height', () => {
    const r = computeMap({ ...base, headings: [
      { pos: 1, level: 1, docY: 0 },
      { pos: 9, level: 2, docY: 500 },
      { pos: 20, level: 3, docY: 1000 },
    ]});
    expect(r.ticks.map(t => t.topFrac)).toEqual([0, 0.5, 1]);
    expect(r.ticks.map(t => t.level)).toEqual([1, 2, 3]);
  });

  it('computes the viewport box from scroll position', () => {
    const r = computeMap({ ...base, headings: [], scrollY: 250 });
    expect(r.viewport.topFrac).toBeCloseTo(0.25);
    expect(r.viewport.heightFrac).toBeCloseTo(0.2);
  });

  it('clamps the viewport box to [0,1] at the bottom', () => {
    const r = computeMap({ ...base, headings: [], scrollY: 900 });
    expect(r.viewport.topFrac + r.viewport.heightFrac).toBeLessThanOrEqual(1);
    expect(r.viewport.topFrac).toBeCloseTo(0.8);
  });

  it('fills the rail when the whole document fits in the viewport', () => {
    const r = computeMap({ headings: [], docHeight: 150, scrollY: 0, viewportHeight: 200 });
    expect(r.viewport.topFrac).toBe(0);
    expect(r.viewport.heightFrac).toBe(1);
  });

  it('returns no ticks for an empty document', () => {
    expect(computeMap({ ...base, headings: [] }).ticks).toEqual([]);
  });

  it('handles a single heading', () => {
    const r = computeMap({ ...base, headings: [{ pos: 1, level: 1, docY: 300 }] });
    expect(r.ticks).toEqual([{ pos: 1, level: 1, topFrac: 0.3 }]);
  });

  it('clamps tick fractions into [0,1] when docY exceeds docHeight', () => {
    const r = computeMap({ ...base, headings: [{ pos: 1, level: 1, docY: 1500 }] });
    expect(r.ticks[0].topFrac).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/structureMapCore.test.ts`
Expected: FAIL — `Cannot find module '../src/webview/structureMapCore'`.

- [ ] **Step 3: Implement the core**

Create `src/webview/structureMapCore.ts`:

```ts
// Pure math for the structure-map rail (c54). No DOM / no editor — the shell in
// structureMap.ts supplies docY (from coordsAtPos) and the window metrics.

export interface MapHeading { pos: number; level: 1 | 2 | 3; docY: number; }
export interface MapInput {
  headings: MapHeading[];
  docHeight: number;
  scrollY: number;
  viewportHeight: number;
}
export interface MapTick { pos: number; level: 1 | 2 | 3; topFrac: number; }
export interface MapResult {
  ticks: MapTick[];
  viewport: { topFrac: number; heightFrac: number };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function computeMap(input: MapInput): MapResult {
  const { headings, docHeight, scrollY, viewportHeight } = input;
  const safeHeight = docHeight > 0 ? docHeight : 1;

  const ticks: MapTick[] = headings.map((h) => ({
    pos: h.pos,
    level: h.level,
    topFrac: clamp01(h.docY / safeHeight),
  }));

  // Whole document visible → the viewport box fills the rail.
  const heightFrac = clamp01(viewportHeight / safeHeight);
  let topFrac = clamp01(scrollY / safeHeight);
  if (topFrac + heightFrac > 1) topFrac = clamp01(1 - heightFrac);

  return { ticks, viewport: { topFrac, heightFrac } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/structureMapCore.test.ts`
Expected: PASS (7 passing).

- [ ] **Step 5: Commit**

```bash
git add src/webview/structureMapCore.ts tests/structureMapCore.test.ts
git commit -m "feat(c54): structure-map position math core

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Structure-map DOM shell

**Files:**
- Create: `src/webview/structureMap.ts`

**Interfaces:**
- Consumes: `computeMap`, `MapHeading` from `./structureMapCore`; `getOutline`, `OUTLINE_EVENT`, `OutlineEntry` from `./extensions/outline`; TipTap `Editor`.
- Produces:
  ```ts
  export interface StructureMap {
    setVisible: (visible: boolean) => void;
    isVisible: () => boolean;
    destroy: () => void;
  }
  export function createStructureMap(opts: {
    editor: Editor;
    railEl: HTMLElement;            // the fixed rail container (already in the DOM)
    toggleBtn: HTMLElement;
    initialVisible: boolean;
    onVisibilityChange: (visible: boolean) => void;
  }): StructureMap;
  ```
- Consumed by: Task 6 (`index.ts`).

- [ ] **Step 1: Implement the shell**

Create `src/webview/structureMap.ts`:

```ts
import type { Editor } from '@tiptap/core';
import { computeMap, type MapHeading } from './structureMapCore';
import { OUTLINE_EVENT, getOutline, type OutlineEntry } from './extensions/outline';

export interface StructureMap {
  setVisible: (visible: boolean) => void;
  isVisible: () => boolean;
  destroy: () => void;
}

interface CreateOpts {
  editor: Editor;
  railEl: HTMLElement;
  toggleBtn: HTMLElement;
  initialVisible: boolean;
  onVisibilityChange: (visible: boolean) => void;
}

const SCROLL_OFFSET = 80; // matches outlinePanel.jumpTo

export function createStructureMap(opts: CreateOpts): StructureMap {
  const { editor, railEl, toggleBtn } = opts;
  let visible = opts.initialVisible;
  let entries: OutlineEntry[] = getOutline(editor.view);

  const ticksLayer = document.createElement('div');
  ticksLayer.className = 'structure-map-ticks';
  const viewportBox = document.createElement('div');
  viewportBox.className = 'structure-map-viewport';
  railEl.replaceChildren(ticksLayer, viewportBox);

  // Map a heading's doc position to its Y in document space.
  function docYOf(pos: number): number | null {
    try {
      return editor.view.coordsAtPos(pos).top + window.scrollY;
    } catch {
      return null;
    }
  }

  function readHeadings(): MapHeading[] {
    const out: MapHeading[] = [];
    for (const e of entries) {
      const docY = docYOf(e.pos);
      if (docY !== null) out.push({ pos: e.pos, level: e.level, docY });
    }
    return out;
  }

  function docHeight(): number {
    return Math.max(document.documentElement.scrollHeight, window.innerHeight);
  }

  function rebuild(): void {
    if (!visible) return;
    const result = computeMap({
      headings: readHeadings(),
      docHeight: docHeight(),
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight,
    });
    ticksLayer.replaceChildren(...result.ticks.map((t) => {
      const tick = document.createElement('div');
      tick.className = `structure-map-tick level-${t.level}`;
      tick.style.top = `${t.topFrac * 100}%`;
      tick.dataset.pos = String(t.pos);
      const label = entries.find((e) => e.pos === t.pos)?.text ?? '';
      tick.dataset.tip = label;
      tick.setAttribute('aria-label', label);
      return tick;
    }));
    positionViewport(result.viewport);
  }

  function positionViewport(v: { topFrac: number; heightFrac: number }): void {
    viewportBox.style.top = `${v.topFrac * 100}%`;
    viewportBox.style.height = `${v.heightFrac * 100}%`;
  }

  // Cheap scroll path: recompute only the viewport box, throttled with rAF.
  let scrollTick = false;
  function onScroll(): void {
    if (!visible || scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      scrollTick = false;
      const result = computeMap({
        headings: [],
        docHeight: docHeight(),
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
      });
      positionViewport(result.viewport);
    });
  }

  function jumpToPos(pos: number): void {
    try {
      const top = editor.view.coordsAtPos(pos).top + window.scrollY - SCROLL_OFFSET;
      window.scrollTo({ top, behavior: 'smooth' });
    } catch { /* position no longer valid */ }
  }

  function jumpToFraction(frac: number): void {
    const top = frac * docHeight() - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  // Click a tick → jump to heading; click empty rail → jump to that proportion.
  function onRailClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const tick = target.closest<HTMLElement>('.structure-map-tick');
    if (tick) {
      jumpToPos(Number(tick.dataset.pos));
      return;
    }
    const rect = railEl.getBoundingClientRect();
    jumpToFraction((e.clientY - rect.top) / rect.height);
  }

  // Drag the viewport box → scroll proportionally (manual mouse drag).
  let dragging = false;
  function onViewportMouseDown(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }
  function onDragMove(e: MouseEvent): void {
    if (!dragging) return;
    const rect = railEl.getBoundingClientRect();
    const frac = (e.clientY - rect.top) / rect.height;
    window.scrollTo({ top: Math.max(0, frac * docHeight() - window.innerHeight / 2) });
  }
  function onDragEnd(): void {
    dragging = false;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }

  function onOutlineChanged(e: Event): void {
    entries = (e as CustomEvent<OutlineEntry[]>).detail;
    rebuild();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', rebuild);
  railEl.addEventListener('click', onRailClick);
  viewportBox.addEventListener('mousedown', onViewportMouseDown);
  editor.view.dom.addEventListener(OUTLINE_EVENT, onOutlineChanged);

  function applyVisibility(): void {
    document.documentElement.classList.toggle('structure-map-visible', visible);
    toggleBtn.classList.toggle('active', visible);
    if (visible) rebuild();
  }

  function setVisible(next: boolean): void {
    if (next === visible) return;
    visible = next;
    applyVisibility();
    opts.onVisibilityChange(visible);
  }

  applyVisibility();

  return {
    setVisible,
    isVisible: () => visible,
    destroy() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', rebuild);
      railEl.removeEventListener('click', onRailClick);
      viewportBox.removeEventListener('mousedown', onViewportMouseDown);
      editor.view.dom.removeEventListener(OUTLINE_EVENT, onOutlineChanged);
    },
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.webview.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/structureMap.ts
git commit -m "feat(c54): structure-map DOM shell (ticks, viewport, jump/drag)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rail styling

**Files:**
- Modify: `src/webview/styles/editor.css` (append a new section at end of file)

**Interfaces:**
- Consumes: DOM produced by Task 3 — `.structure-map`, `.structure-map-ticks`, `.structure-map-tick.level-{1,2,3}`, `.structure-map-viewport`; the `structure-map-visible` and `source-mode-active` classes on `documentElement`.

- [ ] **Step 1: Append the styles**

Add to the end of `src/webview/styles/editor.css`:

```css
/* ── Structure map (c54): right-edge navigation rail ───────────────────────
   Hidden by default; shown when documentElement has .structure-map-visible.
   Hidden in Code (source) view. Hide/expand-on-hover — never an OS scrollbar. */
.structure-map {
  position: fixed;
  top: 56px;            /* clears the toolbar */
  right: 0;
  bottom: 0;
  width: 14px;
  z-index: 90;          /* below toolbar/popovers (100/200), above content */
  display: none;
  cursor: pointer;
  opacity: 0.55;
  transition: width 0.15s ease, opacity 0.15s ease, background 0.15s ease;
}
html.structure-map-visible .structure-map { display: block; }
html.source-mode-active .structure-map { display: none; }

.structure-map:hover {
  width: 22px;
  opacity: 1;
  background: color-mix(in srgb, var(--fg, #444) 4%, transparent);
}

.structure-map-ticks { position: absolute; inset: 0; }

.structure-map-tick {
  position: absolute;
  right: 4px;
  height: 2px;
  border-radius: 1px;
  background: var(--fg, #444);
  transform: translateY(-50%);
}
.structure-map-tick.level-1 { width: 9px;  opacity: 0.85; }
.structure-map-tick.level-2 { width: 6px;  opacity: 0.6;  }
.structure-map-tick.level-3 { width: 4px;  opacity: 0.4;  }

.structure-map-viewport {
  position: absolute;
  right: 0;
  left: 0;
  min-height: 18px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent, #4c8bf5) 22%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #4c8bf5) 45%, transparent);
  cursor: grab;
}
.structure-map-viewport:active { cursor: grabbing; }
```

- [ ] **Step 2: Verify CSS variables exist**

Run: `grep -n -- "--accent\|--fg\b" src/webview/styles/editor.css src/webview/styles/notion-*.css`
Expected: at least one definition for each. If `--accent` or `--fg` is absent, the `color-mix` fallbacks (`#4c8bf5` / `#444`) still render — no action needed, but note which fallback is active.

- [ ] **Step 3: Commit**

```bash
git add src/webview/styles/editor.css
git commit -m "style(c54): structure-map rail, ticks, viewport box

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Provider plumbing (button, icon, config, persistence)

**Files:**
- Modify: `src/mdEditorPlusProvider.ts` — icon constant, toolbar button HTML, rail container element, `init.defaults`, `saveStructureMapVisible` handler.
- Modify: `package.json` — config contribution.

**Interfaces:**
- Produces (consumed by Task 6 via `init.defaults` and DOM ids): toolbar button `#structure-map-btn`, rail element `.structure-map#structure-map`, `defaults.structureMapVisible: boolean`, message `{ type: 'saveStructureMapVisible', value: boolean }`.

- [ ] **Step 1: Add the config contribution**

In `package.json`, immediately after the `mdEditorPlus.outlineVisible` block (it ends at the line with its `"description"`), add:

```json
        "mdEditorPlus.structureMapVisible": {
          "type": "boolean",
          "default": false,
          "description": "Show the structure map (right-edge navigation rail) by default"
        },
```

- [ ] **Step 2: Add the icon constant**

In `src/mdEditorPlusProvider.ts`, right after the `iOutline` definition (line 822), add a map-style icon. It mirrors `iOutline`'s stroke treatment (its toolbar neighbour) — a vertical rail of ticks with a viewport box:

```ts
    const iStructureMap = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="20" stroke-linecap="round" viewBox="0 0 256 256"><line x1="176" y1="52" x2="216" y2="52"/><line x1="176" y1="100" x2="204" y2="100"/><line x1="176" y1="148" x2="216" y2="148"/><line x1="176" y1="196" x2="204" y2="196"/><rect x="40" y="84" width="80" height="88" rx="10" fill="currentColor" fill-opacity="0.18" stroke-width="16"/></svg>`;
```

- [ ] **Step 3: Add the toolbar button**

In `src/mdEditorPlusProvider.ts`, the outline button is at line 859. Add the structure-map button immediately after it:

```html
    <button class="toolbar-icon" id="outline-btn" data-tip="Outline (⌘⇧O)">${iOutline}</button>
    <button class="toolbar-icon" id="structure-map-btn" data-tip="Structure map">${iStructureMap}</button>
```

- [ ] **Step 4: Add the rail container element**

The outline panel element is at line 1003 (`<div class="outline-panel hidden" id="outline-panel"></div>`). Add the rail container right after it:

```html
  <div class="outline-panel hidden" id="outline-panel"></div>
  <div class="structure-map" id="structure-map" aria-hidden="true"></div>
```

- [ ] **Step 5: Add the init default**

In `sendInit` (the `defaults` object, after the `outlineVisible` line at 186):

```ts
          outlineVisible:      cfg.get<boolean>('outlineVisible', false),
          structureMapVisible: cfg.get<boolean>('structureMapVisible', false),
```

- [ ] **Step 6: Add the persistence handler**

After the `saveOutlineVisible` handler (ends at line 471), add:

```ts
      if (msg.type === 'saveStructureMapVisible') {
        const value = (msg as unknown as { value?: unknown }).value;
        if (typeof value !== 'boolean') return;
        const cfg = vscode.workspace.getConfiguration('mdEditorPlus');
        await cfg.update('structureMapVisible', value, vscode.ConfigurationTarget.Global);
        return;
      }
```

- [ ] **Step 7: Type-check + validate package.json**

Run: `npx tsc --noEmit -p tsconfig.json && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"`
Expected: no TS errors, `package.json OK`.

- [ ] **Step 8: Commit**

```bash
git add src/mdEditorPlusProvider.ts package.json
git commit -m "feat(c54): structure-map toolbar button + config plumbing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire the structure map into the webview

**Files:**
- Modify: `src/webview/index.ts` — import + instantiate `createStructureMap` near the existing outline-panel init (lines 1093-1117).

**Interfaces:**
- Consumes: `createStructureMap` (Task 3); `msg.defaults?.structureMapVisible` (Task 5); `editorInstance` (already in scope at the outline init); the `#structure-map-btn` and `#structure-map` DOM ids (Task 5).
- Note: extend the local `defaults` type (the interface with `outlineVisible?: boolean;` at `index.ts:87`) with `structureMapVisible?: boolean;`.

- [ ] **Step 1: Add the import**

Near the outline import (`import { createOutlinePanel, OutlinePanel } from './outlinePanel';`, line 16):

```ts
import { createStructureMap } from './structureMap';
```

- [ ] **Step 2: Extend the defaults type**

At `index.ts:87`, add the field beside `outlineVisible?: boolean;`:

```ts
  outlineVisible?: boolean;
  structureMapVisible?: boolean;
```

- [ ] **Step 3: Instantiate after the outline init**

Immediately after the outline `try { … } catch { … }` block (which ends at line 1117), add a sibling block:

```ts
      try {
        const mapBtn  = document.getElementById('structure-map-btn') as HTMLElement | null;
        const mapRail = document.getElementById('structure-map') as HTMLElement | null;
        if (mapBtn && mapRail) {
          const map = createStructureMap({
            editor: editorInstance,
            railEl: mapRail,
            toggleBtn: mapBtn,
            initialVisible: Boolean(msg.defaults?.structureMapVisible),
            onVisibilityChange: (visible) => {
              vscode.postMessage({ type: 'saveStructureMapVisible', value: visible });
            },
          });
          mapBtn.addEventListener('click', () => map.setVisible(!map.isVisible()));
        }
      } catch (err) {
        console.error('[md-editor-plus] structure map init failed', err);
      }
```

- [ ] **Step 4: Type-check + full test run**

Run: `npx tsc --noEmit -p tsconfig.webview.json && npm test`
Expected: no TS errors; the new `diffPrepare` and `structureMapCore` suites pass; only the two pre-existing failing suites (`toggle.test.ts`, `board/grouping.test.ts`) remain red.

- [ ] **Step 5: Build the webview bundle**

Run: `npm run build` (or the project's webview bundle script — check `package.json` scripts if `build` is absent).
Expected: bundle succeeds, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/webview/index.ts
git commit -m "feat(c54): wire structure map into the editor webview

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual verification (F5)

After Task 6, verify in the Extension Development Host (the project's "finish before testing" rule — do this once, at the end):

1. **Diff fix** — open a tracked `.md`, type a brand-new `## Section`, do NOT save, click **Show Diff**. The new section appears as an addition in the native diff. ✅
2. **Structure map** — click the new toolbar button. The right-edge rail appears with heading ticks (H1 widest/boldest → H3 faintest) and a translucent viewport box.
3. Scroll — the viewport box tracks position smoothly. Click a tick — jumps to that heading. Drag the box — scrolls proportionally. Hover a tick — heading-text tooltip.
4. Switch to **Code** view — the rail disappears; back to **Preview** — it returns.
5. Toggle off, reload the editor — the off state persists.

---

## Self-Review

- **Spec coverage:** Part 1 diff fix → Task 1. Structure map: reuse outline data → Tasks 2/3; placement/rail → Task 4; ticks + viewport math → Task 2; interactions (click/drag/hover) → Task 3; lifecycle (OUTLINE_EVENT/scroll/resize) → Task 3; visibility + persistence + toolbar toggle → Tasks 5/6; hide in Code view → Task 4 CSS. All covered.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `applyEditThenDiff` signature identical in Task 1 helper, test, and provider call. `computeMap`/`MapInput`/`MapHeading`/`MapResult` consistent across Task 2 (def) and Task 3 (use). `createStructureMap` options object matches between Task 3 (def) and Task 6 (call). Message `saveStructureMapVisible` + config key `structureMapVisible` consistent across Tasks 5/6. DOM ids `structure-map-btn` / `structure-map` consistent across Tasks 4/5/6.
