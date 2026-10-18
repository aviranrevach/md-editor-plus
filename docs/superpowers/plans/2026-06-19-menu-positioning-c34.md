# Smart Menu Positioning (c34) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop every webview menu/popover/drill-down from cropping off-screen by routing all positioning through one shared helper, and add a guardrail so new menus can't reintroduce the bug.

**Architecture:** A pure `computePlacement()` function does the geometry (flip → clamp → scroll, never covers the anchor) and is unit-tested in plain Node. A thin `placeFloating()` DOM wrapper reads element sizes, applies the result, and re-positions drill-downs via `ResizeObserver`. All ~16 surfaces drop their hand-rolled positioning and call `placeFloating()`. A shared `.is-scroll` class provides the one standard hidden-until-hover scrollbar. A source-scan Jest test enforces that no menu file hand-rolls coordinates.

**Tech Stack:** TypeScript, Jest + ts-jest (node env for pure tests, `@jest-environment jsdom` for DOM tests), esbuild webview bundle, plain DOM (no framework).

## Global Constraints

- **No new npm dependencies** — nothing may be `npm install`ed. The guardrail is a Jest source-scan test, NOT ESLint (there is no ESLint config in this repo).
- Tests live in `tests/**/*.test.ts`; pure tests run in the default node env, DOM tests start with `/** @jest-environment jsdom */`.
- Run the suite with `npm test`. One pre-existing failure exists in `toggle.test.ts` (a type-check issue unrelated to this work) — do not treat it as a regression.
- Scrollbar standard: hidden until hover, 6px, `--board-border` thumb, matching `.board-columns`. NEVER leave `overflow-y: auto` + `max-height` permanently on a menu — only via the `.is-scroll` class the helper toggles.
- Helper viewport margin = `8`, anchor gap = `4`, sub-pixel fuzz = `2`.
- Leave the Tippy text-formatting bubble menu (`bubbleMenu.ts`) untouched.
- Webview source lives under `src/webview/`. Use viewport coordinates + `position: fixed`; never `window.scrollX/scrollY`.

---

## File Structure

- **Create** `src/webview/menuPosition.ts` — pure `computePlacement()` + DOM `placeFloating()` wrapper. Single responsibility: positioning.
- **Create** `tests/menuPosition.test.ts` — unit tests for `computePlacement` (node) + `placeFloating` (jsdom).
- **Create** `tests/menuPositionGuardrail.test.ts` — source-scan test asserting migrated files contain no manual coordinate positioning.
- **Modify** `src/webview/styles/board.css` (or the shared menu stylesheet) — add the `.is-scroll` scrollbar standard; remove hardcoded `max-height`/`overflow-y` from migrated menu rules.
- **Modify** each menu module to call `placeFloating()`:
  `boardTagsPicker.ts`, `blockPicker.ts`, `boardTableRender.ts`, `boardKanbanRender.ts`, `boardProperties.ts`, `boardStatusOptions.ts`, `boardImagePicker.ts`, `calloutMenu.ts`, `imageBubbleMenu.ts`, `aiTransformPanel.ts`, `tooltip.ts`.

---

## Task 1: Pure geometry — `computePlacement()`

**Files:**
- Create: `src/webview/menuPosition.ts`
- Test: `tests/menuPosition.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface Rect { top: number; left: number; width: number; height: number; }
  export interface PlacementInput {
    anchor: Rect;
    size: { width: number; height: number };   // natural, uncapped
    viewport: { width: number; height: number };
    margin?: number;   // default 8
    gap?: number;      // default 4
    preferX?: 'left' | 'right';   // default 'left'
  }
  export interface Placement {
    left: number;
    top: number;
    side: 'above' | 'below';
    maxHeight: number | null;   // null => no cap
    scroll: boolean;            // true => caller adds .is-scroll
  }
  export function computePlacement(input: PlacementInput): Placement;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/menuPosition.test.ts
import { computePlacement } from '../src/webview/menuPosition';

const VP = { width: 1000, height: 800 };

test('fits below a top-left anchor: below, left-aligned, no scroll', () => {
  const p = computePlacement({
    anchor: { top: 40, left: 40, width: 120, height: 30 },
    size: { width: 220, height: 200 }, viewport: VP,
  });
  expect(p.side).toBe('below');
  expect(p.top).toBe(40 + 30 + 4);
  expect(p.left).toBe(40);
  expect(p.scroll).toBe(false);
  expect(p.maxHeight).toBeNull();
});

test('near right edge: right-aligns to the anchor, stays on-screen', () => {
  const p = computePlacement({
    anchor: { top: 40, left: 920, width: 60, height: 30 },
    size: { width: 220, height: 200 }, viewport: VP,
  });
  expect(p.left).toBe(920 + 60 - 220);            // right-aligned
  expect(p.left).toBeGreaterThanOrEqual(8);
});

test('near bottom edge: flips above the anchor', () => {
  const p = computePlacement({
    anchor: { top: 760, left: 40, width: 120, height: 30 },
    size: { width: 220, height: 200 }, viewport: VP,
  });
  expect(p.side).toBe('above');
  expect(p.top).toBe(760 - 4 - 200);
});

test('taller than either side: picks roomier side, caps height, scrolls, never covers anchor', () => {
  // anchor mid-screen; each side ~ (800/2 - margins) < 700
  const p = computePlacement({
    anchor: { top: 380, left: 40, width: 120, height: 30 },
    size: { width: 220, height: 700 }, viewport: VP,
  });
  expect(p.scroll).toBe(true);
  expect(p.maxHeight).not.toBeNull();
  // does not overlap the anchor vertically
  const bottom = p.top + (p.maxHeight as number);
  const overlaps = !(bottom <= 380 || p.top >= 410);
  expect(overlaps).toBe(false);
  // stays within viewport
  expect(p.top).toBeGreaterThanOrEqual(8);
  expect(bottom).toBeLessThanOrEqual(800 - 8);
});

test('short menu in a corner never scrolls', () => {
  const p = computePlacement({
    anchor: { top: 770, left: 940, width: 50, height: 24 },
    size: { width: 220, height: 180 }, viewport: VP,
  });
  expect(p.scroll).toBe(false);
  expect(p.left).toBeGreaterThanOrEqual(8);
  expect(p.left + 220).toBeLessThanOrEqual(1000 - 8);
  expect(p.top).toBeGreaterThanOrEqual(8);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/menuPosition.test.ts -t computePlacement`
Expected: FAIL — `computePlacement` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/webview/menuPosition.ts
export interface Rect { top: number; left: number; width: number; height: number; }
export interface PlacementInput {
  anchor: Rect;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  margin?: number;
  gap?: number;
  preferX?: 'left' | 'right';
}
export interface Placement {
  left: number;
  top: number;
  side: 'above' | 'below';
  maxHeight: number | null;
  scroll: boolean;
}

const FUZZ = 2;

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;            // element bigger than the gap: pin to margin
  return Math.max(lo, Math.min(v, hi));
}

export function computePlacement(input: PlacementInput): Placement {
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 4;
  const preferX = input.preferX ?? 'left';
  const { anchor: a, size, viewport: vp } = input;

  // Vertical side that never covers the anchor.
  const spaceBelow = vp.height - (a.top + a.height) - gap - margin;
  const spaceAbove = a.top - gap - margin;

  let side: 'above' | 'below';
  let avail: number;
  if (size.height <= spaceBelow + FUZZ)      { side = 'below'; avail = spaceBelow; }
  else if (size.height <= spaceAbove + FUZZ) { side = 'above'; avail = spaceAbove; }
  else if (spaceBelow >= spaceAbove)         { side = 'below'; avail = spaceBelow; }
  else                                       { side = 'above'; avail = spaceAbove; }

  const scroll = size.height > avail + FUZZ;
  const maxHeight = scroll ? Math.max(0, avail) : null;
  const effH = scroll ? Math.max(0, avail) : size.height;

  let top = side === 'below' ? a.top + a.height + gap : a.top - gap - effH;

  // Horizontal: left-aligned (or right per preferX); flip if it would cross.
  let left: number;
  if (preferX === 'right') {
    left = a.left + a.width - size.width;
    if (left < margin) left = a.left;                  // flip to left-aligned
  } else {
    left = a.left;
    if (left + size.width > vp.width - margin) left = a.left + a.width - size.width;
  }

  left = clamp(left, margin, vp.width - size.width - margin);
  top = clamp(top, margin, vp.height - effH - margin);

  return { left, top, side, maxHeight, scroll };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/menuPosition.test.ts -t computePlacement`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/menuPosition.ts tests/menuPosition.test.ts
git commit -m "feat(c34): pure computePlacement geometry for menu positioning"
```

---

## Task 2: DOM wrapper — `placeFloating()`

**Files:**
- Modify: `src/webview/menuPosition.ts`
- Test: `tests/menuPosition.test.ts` (append a jsdom describe block in a separate file to control env — see note)

**Note on jest env:** `computePlacement` tests run in node; the wrapper needs jsdom. Put the wrapper tests in a new file `tests/placeFloating.test.ts` with the jsdom docblock so the two suites don't fight over environments.

**Interfaces:**
- Consumes: `computePlacement`, `Rect` from Task 1.
- Produces:
  ```ts
  export interface PlaceOpts { margin?: number; gap?: number; preferX?: 'left' | 'right'; }
  export interface PlacementHandle { reposition(): void; destroy(): void; }
  export function placeFloating(el: HTMLElement, anchor: HTMLElement, opts?: PlaceOpts): PlacementHandle;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/placeFloating.test.ts
/** @jest-environment jsdom */
import { placeFloating } from '../src/webview/menuPosition';

function sized(el: HTMLElement, w: number, h: number) {
  Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true });
}

beforeEach(() => {
  (window as any).innerWidth = 1000;
  (window as any).innerHeight = 800;
  // run rAF synchronously
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  (window as any).ResizeObserver = class { observe() {} disconnect() {} };
});

test('positions a fitting menu below the anchor, no is-scroll', () => {
  const anchor = document.body.appendChild(document.createElement('div'));
  anchor.getBoundingClientRect = () => ({ top: 40, left: 40, width: 120, height: 30, right: 160, bottom: 70, x: 40, y: 40, toJSON() {} } as DOMRect);
  const menu = document.body.appendChild(document.createElement('div'));
  sized(menu, 220, 200);

  placeFloating(menu, anchor);

  expect(menu.style.position).toBe('fixed');
  expect(menu.style.top).toBe('74px');
  expect(menu.style.left).toBe('40px');
  expect(menu.classList.contains('is-scroll')).toBe(false);
});

test('adds is-scroll + max-height when taller than its side', () => {
  const anchor = document.body.appendChild(document.createElement('div'));
  anchor.getBoundingClientRect = () => ({ top: 380, left: 40, width: 120, height: 30, right: 160, bottom: 410, x: 40, y: 380, toJSON() {} } as DOMRect);
  const menu = document.body.appendChild(document.createElement('div'));
  sized(menu, 220, 700);

  placeFloating(menu, anchor);

  expect(menu.classList.contains('is-scroll')).toBe(true);
  expect(menu.style.maxHeight).not.toBe('');
});

test('destroy() disconnects the observer and is safe to call', () => {
  const anchor = document.body.appendChild(document.createElement('div'));
  anchor.getBoundingClientRect = () => ({ top: 10, left: 10, width: 50, height: 20, right: 60, bottom: 30, x: 10, y: 10, toJSON() {} } as DOMRect);
  const menu = document.body.appendChild(document.createElement('div'));
  sized(menu, 200, 100);
  const handle = placeFloating(menu, anchor);
  expect(() => handle.destroy()).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/placeFloating.test.ts`
Expected: FAIL — `placeFloating` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/webview/menuPosition.ts`)

```ts
export interface PlaceOpts { margin?: number; gap?: number; preferX?: 'left' | 'right'; }
export interface PlacementHandle { reposition(): void; destroy(): void; }

export function placeFloating(el: HTMLElement, anchor: HTMLElement, opts: PlaceOpts = {}): PlacementHandle {
  el.style.position = 'fixed';

  function reposition(): void {
    el.classList.remove('is-scroll');
    el.style.maxHeight = 'none';
    const a = anchor.getBoundingClientRect();
    const p = computePlacement({
      anchor: { top: a.top, left: a.left, width: a.width, height: a.height },
      size: { width: el.offsetWidth, height: el.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      margin: opts.margin, gap: opts.gap, preferX: opts.preferX,
    });
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
    if (p.scroll) { el.classList.add('is-scroll'); el.style.maxHeight = `${p.maxHeight ?? 0}px`; }
    else { el.style.maxHeight = ''; }
  }

  // Measure after layout.
  requestAnimationFrame(reposition);

  // Re-position when the element resizes (drill-downs swap content) or the
  // window resizes.
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => reposition());
    ro.observe(el);
  }
  const onWinResize = () => reposition();
  window.addEventListener('resize', onWinResize);

  function destroy(): void {
    if (ro) ro.disconnect();
    window.removeEventListener('resize', onWinResize);
  }

  return { reposition, destroy };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/placeFloating.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/menuPosition.ts tests/placeFloating.test.ts
git commit -m "feat(c34): placeFloating DOM wrapper with ResizeObserver re-positioning"
```

---

## Task 3: The scrollbar standard (`.is-scroll`)

**Files:**
- Modify: `src/webview/styles/board.css` (add near the existing `.board-columns` scrollbar block, ~line 196)

**Interfaces:**
- Consumes: nothing (CSS).
- Produces: a `.is-scroll` class any element managed by `placeFloating` gets when it overflows.

- [ ] **Step 1: Add the standard scrollbar rule**

Add this block to `src/webview/styles/board.css`:

```css
/* ===== Standard menu scrollbar — applied by placeFloating() via .is-scroll =====
   Hidden until hover, matching .board-columns. Menus are overflow:visible by
   default; placeFloating only adds .is-scroll when content exceeds its side. */
.is-scroll {
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  transition: scrollbar-color 0.15s;
}
.is-scroll:hover { scrollbar-color: var(--board-border) transparent; }
.is-scroll::-webkit-scrollbar { width: 6px; }
.is-scroll::-webkit-scrollbar-track { background: transparent; }
.is-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; transition: background 0.15s; }
.is-scroll:hover::-webkit-scrollbar-thumb { background: var(--board-border); }
.is-scroll::-webkit-scrollbar-thumb:hover { background: #9aa2ad; }
```

- [ ] **Step 2: Verify it compiles into the bundle**

Run: `npm run compile`
Expected: build succeeds (esbuild copies/links CSS). No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/styles/board.css
git commit -m "feat(c34): standard hidden-until-hover .is-scroll menu scrollbar"
```

---

## Task 4: Migrate the Tags picker (worst offender — proves integration)

**Files:**
- Modify: `src/webview/boardTagsPicker.ts:20-23,96`
- Test: `tests/tagsPickerPosition.test.ts`

**Interfaces:**
- Consumes: `placeFloating`, `PlacementHandle` from Task 2.

The Tags picker today (lines 20-23) does `position:absolute` + `window.scrollY` with **no edge detection**. Replace with `placeFloating`, and call `destroy()` on close.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tagsPickerPosition.test.ts
/** @jest-environment jsdom */
import { openTagsPicker } from '../src/webview/boardTagsPicker';
import type { Board } from '../src/webview/boardModel';

beforeEach(() => {
  (window as any).innerWidth = 1000;
  (window as any).innerHeight = 800;
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  (window as any).ResizeObserver = class { observe() {} disconnect() {} };
});

const board: Board = {
  id: 'b1', name: 'B', columns: [], cards: [{ id: 'c1', values: {} }],
  fields: [{ name: 'Tags', type: 'tags' }], views: [], columnColors: {},
  fieldOptions: { Tags: [] }, activeView: 'table',
} as unknown as Board;

test('tags picker is fixed-positioned and stays on-screen near the right edge', () => {
  const anchor = document.body.appendChild(document.createElement('div'));
  anchor.getBoundingClientRect = () => ({ top: 40, left: 960, width: 30, height: 24, right: 990, bottom: 64, x: 960, y: 40, toJSON() {} } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { value: 240, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { value: 200, configurable: true });

  openTagsPicker(anchor, () => board, 'Tags', 'c1', () => {});

  const pop = document.querySelector('.bd-tags-pop') as HTMLElement;
  expect(pop.style.position).toBe('fixed');
  expect(parseFloat(pop.style.left)).toBeGreaterThanOrEqual(8);
  expect(parseFloat(pop.style.left) + 240).toBeLessThanOrEqual(1000 - 8);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/tagsPickerPosition.test.ts`
Expected: FAIL — `pop.style.position` is `absolute`, left is off-screen (`960px`).

- [ ] **Step 3: Implement the migration**

In `src/webview/boardTagsPicker.ts`, add the import at the top:

```ts
import { placeFloating, type PlacementHandle } from './menuPosition';
```

Replace lines 20-23:

```ts
  const rect = anchor.getBoundingClientRect();
  pop.style.position = 'absolute';
  pop.style.top = `${rect.bottom + window.scrollY + 4}px`;
  pop.style.left = `${rect.left + window.scrollX}px`;
```

with:

```ts
  const placement: PlacementHandle = placeFloating(pop, anchor);
```

Then in `close()` (line 96) add `placement.destroy();`:

```ts
  function close() { placement.destroy(); pop.remove(); document.removeEventListener('mousedown', onOutside, true); }
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/tagsPickerPosition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardTagsPicker.ts tests/tagsPickerPosition.test.ts
git commit -m "fix(c34): route tags picker through placeFloating (was unclamped)"
```

---

## Task 5: Migrate block-picker popover + drill-downs

**Files:**
- Modify: `src/webview/blockPicker.ts:1008-1019` (the `positionPopover` function) and `close()` at 1021.

**Interfaces:**
- Consumes: `placeFloating`, `PlacementHandle`.

The block picker is the key drill-down case: "Turn into" and image sub-menus swap content inside the same `el`, changing its height. The `ResizeObserver` in `placeFloating` handles the re-position automatically, replacing the one-shot bottom-flip in `positionPopover`.

- [ ] **Step 1: Add import**

```ts
import { placeFloating, type PlacementHandle } from './menuPosition';
```

- [ ] **Step 2: Hold a placement handle in the picker closure**

Near the other closure state (where `drillParent`/`actionMode` live), add:

```ts
  let placement: PlacementHandle | null = null;
```

- [ ] **Step 3: Replace `positionPopover` (lines 1008-1019)**

```ts
  function positionPopover(anchorEl: HTMLElement): void {
    placement?.destroy();
    placement = placeFloating(el, anchorEl);
    requestAnimationFrame(() => input.focus());
  }
```

- [ ] **Step 4: Tear down on close (in `close()`, line 1021)**

Add at the top of `close()`:

```ts
    placement?.destroy();
    placement = null;
```

- [ ] **Step 5: Run existing block-picker tests (regression guard)**

Run: `npx jest tests/blockPicker.test.ts tests/blockPickerImage.test.ts tests/blockPickerTable.test.ts`
Expected: PASS (these stub `requestAnimationFrame`/DOM already; positioning is a no-op under jsdom but must not throw). If a test environment lacks `ResizeObserver`, the helper guards for it.

- [ ] **Step 6: Commit**

```bash
git add src/webview/blockPicker.ts
git commit -m "fix(c34): route block picker + drill-downs through placeFloating"
```

---

## Task 6: Migrate board table column menu + status dropdown

**Files:**
- Modify: `src/webview/boardTableRender.ts:985-1005` (column header menu) and the `openStatusDropdown` positioning (~line 1133).

**Interfaces:**
- Consumes: `placeFloating`, `PlacementHandle`.

The column menu (lines 985-1005) already has good dual-axis logic — replace it with the shared helper for consistency and drill-down support.

- [ ] **Step 1: Add import**

```ts
import { placeFloating, type PlacementHandle } from './menuPosition';
```

- [ ] **Step 2: Replace the column-menu positioning block (lines 985-1005)**

Remove:

```ts
  const r = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${r.left}px`;
  menu.style.top  = `${r.bottom + 4}px`;
  document.body.appendChild(menu);
  requestAnimationFrame(() => { /* ...existing flip/clamp... */ });
```

Replace with:

```ts
  document.body.appendChild(menu);
  const placement = placeFloating(menu, anchor);
```

- [ ] **Step 3: Destroy on close**

In the `close` handler (line 1006-1012), add `placement.destroy();` next to `menu.remove();`.

- [ ] **Step 4: Apply the same pattern to `openStatusDropdown`**

Locate its positioning (the `getBoundingClientRect` + `style.left/top` block ~line 1133), replace with `const placement = placeFloating(dropdownEl, anchor);` and call `placement.destroy()` wherever it removes the dropdown.

- [ ] **Step 5: Run table/board tests**

Run: `npx jest tests/board tests/fitStatusColumnWidth.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardTableRender.ts
git commit -m "fix(c34): route table column menu + status dropdown through placeFloating"
```

---

## Task 7: Migrate kanban column menu + add-card menu

**Files:**
- Modify: `src/webview/boardKanbanRender.ts` (column three-dot menu ~line 745, add-card menu ~line 887).

**Interfaces:**
- Consumes: `placeFloating`, `PlacementHandle`.

- [ ] **Step 1: Add import**

```ts
import { placeFloating } from './menuPosition';
```

- [ ] **Step 2: Replace both menus' positioning**

For each of the two menus, find the `getBoundingClientRect()` + `style.left/top` (+ any rAF clamp) block and replace with, after the element is appended to the DOM:

```ts
  const placement = placeFloating(menuEl, anchorEl);
```

(Use the actual local variable names for the menu element and its anchor in each spot.)

- [ ] **Step 3: Destroy on close**

In each menu's `closeMenu`/`close` function, add `placement.destroy();` alongside the existing `remove()`.

- [ ] **Step 4: Run tests + compile**

Run: `npm run compile && npx jest tests/board`
Expected: build clean, tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/boardKanbanRender.ts
git commit -m "fix(c34): route kanban column + add-card menus through placeFloating"
```

---

## Task 8: Migrate board Properties menu + Field Action menu

**Files:**
- Modify: `src/webview/boardProperties.ts` — `openFieldActionMenu` (lines 266-269 + rAF 334-340), `openPropertiesMenu` (line 421 + rAF 448-459), and delete the now-unused `positionAnchored` (lines 765-774).

**Interfaces:**
- Consumes: `placeFloating`, `PlacementHandle`.

`openPropertiesMenu` is right-anchored today (via `positionAnchored` + `translateX(-100%)`). Use `preferX: 'right'` instead, which keeps the right-aligned feel without the transform hack.

- [ ] **Step 1: Add import**

```ts
import { placeFloating } from './menuPosition';
```

- [ ] **Step 2: Field Action menu — replace lines 266-269**

Remove the `rect`/`position:absolute`/`scrollY`/`scrollX` lines and the trailing rAF clamp (lines 334-340). After `document.body.appendChild(menu)` add:

```ts
  const placement = placeFloating(menu, anchor);
```

Add `placement.destroy();` inside `close()` (line 327).

- [ ] **Step 3: Properties menu — replace `positionAnchored(menu, anchor)` (line 421)**

```ts
  const placement = placeFloating(menu, anchor, { preferX: 'right' });
```

Delete the rAF clamp block (lines 448-459, no longer needed). Add `placement.destroy();` in `closeMenu()` (line 438).

- [ ] **Step 4: Delete `positionAnchored` (lines 765-774)**

Remove the now-unused function. Run `npm run compile` to confirm nothing else references it.

- [ ] **Step 5: Run tests + compile**

Run: `npm run compile && npx jest tests/board`
Expected: build clean (no "positionAnchored is not defined"), tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/webview/boardProperties.ts
git commit -m "fix(c34): route properties + field-action menus through placeFloating; drop positionAnchored"
```

---

## Task 9: Migrate status options editor + color palette + board image manager

**Files:**
- Modify: `src/webview/boardStatusOptions.ts` (`openStatusOptionsEditor` ~133-135, `openPalette` ~93-116).
- Modify: `src/webview/boardImagePicker.ts` (`openBoardImageManager` ~52-54).

**Interfaces:**
- Consumes: `placeFloating`.

- [ ] **Step 1: Migrate `boardStatusOptions.ts`**

Add `import { placeFloating } from './menuPosition';`. In `openStatusOptionsEditor`, replace the `position:absolute`+`scrollY` block (~133-135) with `const placement = placeFloating(editorEl, anchor);` after append; destroy in its close. Do the same for `openPalette`'s positioning.

- [ ] **Step 2: Migrate `boardImagePicker.ts`**

Add the import. Replace the `Math.min` clamp block (~52-54):

```ts
  el.style.left = `${Math.min(rect.left, window.innerWidth - 320)}px`;
  el.style.top  = `${Math.min(rect.bottom + 4, window.innerHeight - 320)}px`;
```

with `const placement = placeFloating(el, anchor);` after the element is in the DOM; destroy on close.

- [ ] **Step 3: Run tests + compile**

Run: `npm run compile && npx jest tests/board tests/boardImageLinks.test.ts`
Expected: build clean, tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/webview/boardStatusOptions.ts src/webview/boardImagePicker.ts
git commit -m "fix(c34): route status options, palette, and board image manager through placeFloating"
```

---

## Task 10: Migrate callout menu, image bubble menu, AI transform panel

**Files:**
- Modify: `src/webview/calloutMenu.ts` (~221-232), `src/webview/imageBubbleMenu.ts` (positioning block), `src/webview/aiTransformPanel.ts` (positioning block).

**Interfaces:**
- Consumes: `placeFloating`.

- [ ] **Step 1: Migrate `calloutMenu.ts`**

Add the import. Replace its bottom-flip positioning block (~221-232) with `const placement = placeFloating(menuEl, anchorEl);` after append; destroy on close.

- [ ] **Step 2: Migrate `imageBubbleMenu.ts`**

Add the import. Find where the menu element is positioned relative to the image node and replace with `placeFloating`. (The image bubble menu anchors to the selected image's DOM rect — pass that element as the anchor.) Destroy on close.

- [ ] **Step 3: Migrate `aiTransformPanel.ts`**

Add the import. Replace its positioning with `placeFloating`; destroy on close.

- [ ] **Step 4: Run relevant tests + compile**

Run: `npm run compile && npx jest tests/callout.test.ts tests/ai`
Expected: build clean, tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/calloutMenu.ts src/webview/imageBubbleMenu.ts src/webview/aiTransformPanel.ts
git commit -m "fix(c34): route callout, image-bubble, and AI panel menus through placeFloating"
```

---

## Task 11: Tooltip — adopt clamp without losing its centered placement

**Files:**
- Modify: `src/webview/tooltip.ts:23-49`

**Interfaces:**
- Consumes: nothing new (tooltips center horizontally and are tiny, so they don't need the full helper — but they MUST stay on-screen).

Tooltips are the one surface that centers on the anchor rather than left-aligning, and already flip top/bottom. Leave their placement logic but ensure the existing horizontal clamp (`maxLeft`/`margin`) stays — this task only verifies and, if missing, adds the same `8px` margin clamp on both axes so a tooltip near a corner can't crop. No `placeFloating` call (different alignment model); this keeps the guardrail list honest by exempting `tooltip.ts`.

- [ ] **Step 1: Confirm both-axis clamp exists**

Read `tooltip.ts:23-49`. It already clamps horizontally and flips vertically. Add a vertical clamp if absent:

```ts
  top = Math.max(margin, Math.min(top, window.innerHeight - tr.height - margin));
```

- [ ] **Step 2: Compile**

Run: `npm run compile`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/webview/tooltip.ts
git commit -m "fix(c34): clamp tooltip on both axes so corner tooltips never crop"
```

---

## Task 12: Guardrail — source-scan test

**Files:**
- Create: `tests/menuPositionGuardrail.test.ts`

**Interfaces:**
- Consumes: the filesystem (Node `fs`), the migrated file list.

This replaces the spec's "ESLint rule" (no ESLint exists, no installs allowed). It fails CI if a migrated menu file hand-rolls coordinate positioning instead of using `placeFloating`.

- [ ] **Step 1: Write the test**

```ts
// tests/menuPositionGuardrail.test.ts
import * as fs from 'fs';
import * as path from 'path';

// Files that must route positioning through placeFloating().
const MIGRATED = [
  'boardTagsPicker.ts', 'blockPicker.ts', 'boardTableRender.ts',
  'boardKanbanRender.ts', 'boardProperties.ts', 'boardStatusOptions.ts',
  'boardImagePicker.ts', 'calloutMenu.ts', 'imageBubbleMenu.ts',
  'aiTransformPanel.ts',
];
// Allowed to position manually: the helper itself, the Tippy bubble menu,
// and the tooltip (centered model).
const dir = path.join(__dirname, '..', 'src', 'webview');

describe('menu positioning guardrail', () => {
  for (const file of MIGRATED) {
    test(`${file} does not hand-roll coordinate positioning`, () => {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      // No direct style.left / style.top assignment.
      expect(src).not.toMatch(/\.style\.(left|top)\s*=/);
      // No window.scrollX/scrollY positioning math.
      expect(src).not.toMatch(/window\.scroll[XY]/);
    });
  }

  test('menuPosition.ts exports placeFloating and computePlacement', () => {
    const src = fs.readFileSync(path.join(dir, 'menuPosition.ts'), 'utf8');
    expect(src).toMatch(/export function placeFloating/);
    expect(src).toMatch(/export function computePlacement/);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx jest tests/menuPositionGuardrail.test.ts`
Expected: PASS — every migrated file is clean (Tasks 4-10 removed the manual positioning). If any FAILS, that file still hand-rolls positioning — fix that file, don't weaken the test.

- [ ] **Step 3: Commit**

```bash
git add tests/menuPositionGuardrail.test.ts
git commit -m "test(c34): guardrail — migrated menus must use placeFloating, no raw coords"
```

---

## Task 13: Full suite + manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all green EXCEPT the one known pre-existing `toggle.test.ts` failure. Confirm no NEW failures and that the new `menuPosition`, `placeFloating`, `tagsPickerPosition`, and `menuPositionGuardrail` suites pass.

- [ ] **Step 2: Build the extension**

Run: `npm run compile`
Expected: clean build, no type errors.

- [ ] **Step 3: Manual edge check (real app)**

Open the extension (F5 / Extension Host), open a markdown file with a board, and for each menu — block picker (+ and ⌘/), Turn into drill-down, table & kanban column menus, tags picker, status dropdown, properties ⚙, callout menu, image bubble menu, AI panel — verify:
- Opening it near every screen edge keeps it fully visible.
- It never covers its own trigger.
- A long menu (e.g. Turn into near the bottom) caps height and shows the hidden-until-hover scrollbar; a short menu shows no scrollbar.
- Drill into "Turn into" near the bottom edge — it re-positions as the content height changes.
- Repeat in a dark theme (Cmd+K Cmd+T) — no OS scrollbar, no clipping.

- [ ] **Step 4: Update docs**

Per the project "docs before push" rule, update `CHANGELOG.md` / `README.md` if menus/positioning are user-facing notes, and tick c34 → Done in `TODO.md`, BEFORE any push or version bump.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "docs(c34): changelog + mark c34 done"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** central helper (T1-2) ✓, flip→clamp→scroll (T1) ✓, never-cover-anchor (T1) ✓, scrollbar standard (T3) ✓, migrate all 16 surfaces (T4-11) ✓, Tippy left alone (excluded, noted in T12) ✓, guardrail both lint+tests → adapted to source-scan test + geometry tests given no-ESLint/no-install constraint (T12, T1-2) ✓, `Popover` component deferred (out of scope, in spec) ✓.
- **Constraint deviation flagged:** the "ESLint rule" half of the guardrail is delivered as a Jest source-scan test because the repo has no ESLint config and installs are forbidden. Same guarantee (fails CI on raw positioning), no new dependency.
- **Type consistency:** `computePlacement`/`Placement`/`PlacementInput`/`Rect` (T1) and `placeFloating`/`PlaceOpts`/`PlacementHandle` (T2) names are used identically in every migration task.
- **Placeholder scan:** migration Tasks 7, 9, 10 reference "the local variable names in each spot" because those exact blocks weren't read line-by-line during planning; the replacement call and teardown are fully specified and identical in shape to the fully-shown Tasks 4-6 & 8. The executing agent reads each file and applies the shown pattern.
