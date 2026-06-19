# Popover + Menu Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a shared `Popover` primitive and `Menu` builder that own menu lifecycle, dismissal, and one-open-at-a-time coexistence, then migrate every click-anchored menu onto them.

**Architecture:** `Popover` (popover.ts) wraps the existing `placeFloating()` (c34) and adds append/show, a single dismissal implementation (outside-click + Escape + scroll), and a central open-popover registry with opt-in nesting. `Menu` (menu.ts) builds list-style menus on top of Popover from a declarative `MenuSection[]` model, with drill-down as a built-in mode. Custom-content popovers use `Popover` directly.

**Tech Stack:** TypeScript, Jest + ts-jest (node + `@jest-environment jsdom`), esbuild webview bundle, plain DOM.

## Global Constraints

- **No new npm dependencies.** Guardrails are Jest source-scan tests (no ESLint in this repo).
- Build on c34's `placeFloating(el, anchor, opts?)` from `src/webview/menuPosition.ts`. Signature: `opts = { margin?: number; gap?: number; preferX?: 'left' | 'right' }`; returns `PlacementHandle = { reposition(): void; destroy(): void }`. Do NOT modify menuPosition.ts.
- Scroll styling is the `.is-scroll` class (c34) — `placeFloating` toggles it; do not hand-roll menu scroll.
- Tests live in `tests/**/*.test.ts`; DOM tests start with `/** @jest-environment jsdom */`. Run `npm test`. Known pre-existing failure: `tests/board/grouping.test.ts` (stale fixture) — not a regression.
- **Excluded from migration:** `bubbleMenu.ts` (Tippy), `tooltip.ts` + block-handle tooltip (centered), mermaid overlays.
- Item activation must use `mousedown` + `preventDefault()` (a row click must not blur/teardown before its handler runs — existing behavior).
- Staging rule (shared repo, concurrent tabs): every commit stages files by explicit path; never `git add -A/./-u`.

---

## File Structure

- **Create** `src/webview/popover.ts` — `createPopover()` + the open-popover registry. One responsibility: floating lifecycle + dismissal + coexistence.
- **Create** `src/webview/menu.ts` — `createMenu()` + the `MenuItem`/`MenuSection` model → DOM, including drill-down.
- **Create** `tests/popover.test.ts`, `tests/menu.test.ts`, `tests/menuDrilldown.test.ts`.
- **Modify** each migrated menu module (one task each) to call `createPopover`/`createMenu`.
- **Modify** `tests/menuPositionGuardrail.test.ts` — extend to assert migrated files route through the component.

---

## Task 1: Popover primitive + registry

**Files:**
- Create: `src/webview/popover.ts`
- Test: `tests/popover.test.ts`

**Interfaces:**
- Consumes: `placeFloating`, `PlacementHandle` from `./menuPosition`.
- Produces:
  ```ts
  export interface PopoverOpts {
    className?: string;
    preferX?: 'left' | 'right';
    parent?: Popover;
    closeOnScroll?: boolean;   // default true
    onClose?: () => void;
  }
  export interface Popover {
    readonly el: HTMLElement;
    open(anchor: HTMLElement): void;
    close(): void;
    reposition(): void;
    isOpen(): boolean;
  }
  export function createPopover(opts?: PopoverOpts): Popover;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/popover.test.ts
/** @jest-environment jsdom */
import { createPopover } from '../src/webview/popover';

beforeEach(() => {
  document.body.innerHTML = '';
  (window as any).innerWidth = 1000;
  (window as any).innerHeight = 800;
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  (window as any).ResizeObserver = class { observe() {} disconnect() {} };
});

function anchorAt(): HTMLElement {
  const a = document.body.appendChild(document.createElement('button'));
  a.getBoundingClientRect = () => ({ top: 40, left: 40, width: 80, height: 24, right: 120, bottom: 64, x: 40, y: 40, toJSON() {} } as DOMRect);
  return a;
}

test('open() appends the el and isOpen() flips; close() removes it', () => {
  const p = createPopover({ className: 'test-pop' });
  const a = anchorAt();
  expect(p.isOpen()).toBe(false);
  p.open(a);
  expect(p.isOpen()).toBe(true);
  expect(document.querySelector('.test-pop')).toBe(p.el);
  expect(p.el.style.position).toBe('fixed');
  p.close();
  expect(p.isOpen()).toBe(false);
  expect(document.querySelector('.test-pop')).toBeNull();
});

test('opening a second top-level popover closes the first', () => {
  const a = anchorAt();
  const p1 = createPopover(); p1.open(a);
  const p2 = createPopover(); p2.open(a);
  expect(p1.isOpen()).toBe(false);
  expect(p2.isOpen()).toBe(true);
});

test('a child (parent set) does NOT close its parent', () => {
  const a = anchorAt();
  const parent = createPopover(); parent.open(a);
  const child = createPopover({ parent }); child.open(a);
  expect(parent.isOpen()).toBe(true);
  expect(child.isOpen()).toBe(true);
});

test('outside mousedown closes the popover; inside does not', () => {
  const a = anchorAt();
  const p = createPopover(); p.open(a);
  p.el.appendChild(document.createElement('span'));
  // inside click
  (p.el.firstChild as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(p.isOpen()).toBe(true);
  // outside click
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(p.isOpen()).toBe(false);
});

test('outside click closes a child but not the parent it is nested under', () => {
  const a = anchorAt();
  const parent = createPopover(); parent.open(a);
  const child = createPopover({ parent }); child.open(a);
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(child.isOpen()).toBe(false);
  expect(parent.isOpen()).toBe(false); // both outside → both close
});

test('Escape closes the topmost popover; close() is idempotent + fires onClose once', () => {
  const a = anchorAt();
  let closes = 0;
  const p = createPopover({ onClose: () => closes++ });
  p.open(a);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(p.isOpen()).toBe(false);
  p.close(); // idempotent
  expect(closes).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/popover.test.ts`
Expected: FAIL — `createPopover` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/webview/popover.ts
import { placeFloating, type PlacementHandle } from './menuPosition';

export interface PopoverOpts {
  className?: string;
  preferX?: 'left' | 'right';
  parent?: Popover;
  closeOnScroll?: boolean;
  onClose?: () => void;
}
export interface Popover {
  readonly el: HTMLElement;
  open(anchor: HTMLElement): void;
  close(): void;
  reposition(): void;
  isOpen(): boolean;
}

// Module-level registry: the chain of currently-open popovers (root first).
const openStack: Popover[] = [];

function closeFrom(target: EventTarget | null): void {
  // Close every open popover (top-down) whose el does not contain `target`,
  // stopping at the first that does (clicking inside a parent keeps it open).
  for (let i = openStack.length - 1; i >= 0; i--) {
    const pop = openStack[i];
    if (target instanceof Node && pop.el.contains(target)) break;
    pop.close();
  }
}

let listenersWired = false;
function ensureGlobalListeners(): void {
  if (listenersWired) return;
  listenersWired = true;
  document.addEventListener('mousedown', (e) => { if (openStack.length) closeFrom(e.target); }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openStack.length) { e.preventDefault(); openStack[openStack.length - 1].close(); }
  }, true);
  window.addEventListener('scroll', (e) => {
    if (!openStack.length) return;
    const top = openStack[openStack.length - 1];
    const t = e.target as Node | null;
    if (t && top.el.contains(t)) return;          // scrolling inside the popover
    if ((top as any).__closeOnScroll) top.close();
  }, { capture: true, passive: true });
}

export function createPopover(opts: PopoverOpts = {}): Popover {
  const el = document.createElement('div');
  if (opts.className) el.className = opts.className;
  let placement: PlacementHandle | null = null;
  let open = false;

  const pop: Popover & { __closeOnScroll?: boolean } = {
    el,
    isOpen: () => open,
    reposition: () => placement?.reposition(),
    open(anchor: HTMLElement) {
      if (open) return;
      ensureGlobalListeners();
      // A top-level popover replaces the current stack; a child pushes onto it.
      if (!opts.parent) { while (openStack.length) openStack[openStack.length - 1].close(); }
      document.body.appendChild(el);
      placement = placeFloating(el, anchor, { preferX: opts.preferX });
      open = true;
      openStack.push(pop);
    },
    close() {
      if (!open) return;
      open = false;
      placement?.destroy();
      placement = null;
      const i = openStack.indexOf(pop);
      if (i >= 0) openStack.splice(i, 1);
      if (el.parentNode) el.parentNode.removeChild(el);
      opts.onClose?.();
    },
  };
  pop.__closeOnScroll = opts.closeOnScroll !== false;
  return pop;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/popover.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/popover.ts tests/popover.test.ts
git commit -m "feat(popover): Popover primitive + open-popover registry with opt-in nesting"
```

---

## Task 2: Menu builder — rows, sections, variants

**Files:**
- Create: `src/webview/menu.ts`
- Test: `tests/menu.test.ts`

**Interfaces:**
- Consumes: `createPopover`, `Popover`, `PopoverOpts` from `./popover`.
- Produces:
  ```ts
  export interface MenuItem {
    icon?: string; label: string;
    variant?: 'danger';
    disabled?: boolean;
    checked?: boolean;
    trailing?: HTMLElement;
    submenu?: () => MenuSection[];
    onSelect?: () => void;
  }
  export interface MenuSection { label?: string; items: MenuItem[]; }
  export interface Menu { readonly popover: Popover; open(anchor: HTMLElement, sections: MenuSection[]): void; close(): void; }
  export function createMenu(opts?: PopoverOpts): Menu;
  ```
  Each rendered row is `<button class="mp-menu-item">` containing `.mp-menu-icon`, `.mp-menu-label`, and an optional trailing node (`.mp-menu-check` ✓ / `.mp-menu-caret` › / the `trailing` element). Sections render an optional `.mp-menu-section` label and a `.mp-menu-divider` between sections. Danger → `is-danger`; disabled → `disabled` attribute.

- [ ] **Step 1: Write the failing test**

```ts
// tests/menu.test.ts
/** @jest-environment jsdom */
import { createMenu } from '../src/webview/menu';

beforeEach(() => {
  document.body.innerHTML = '';
  (window as any).innerWidth = 1000; (window as any).innerHeight = 800;
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  (window as any).ResizeObserver = class { observe() {} disconnect() {} };
});
function anchorAt(): HTMLElement {
  const a = document.body.appendChild(document.createElement('button'));
  a.getBoundingClientRect = () => ({ top: 40, left: 40, width: 80, height: 24, right: 120, bottom: 64, x: 40, y: 40, toJSON() {} } as DOMRect);
  return a;
}

test('renders sections, labels, dividers, and item variants', () => {
  const m = createMenu();
  m.open(anchorAt(), [
    { label: 'Group A', items: [
      { icon: 'I', label: 'Plain', onSelect() {} },
      { label: 'Current', checked: true, onSelect() {} },
    ]},
    { items: [ { label: 'Delete', variant: 'danger', onSelect() {} } ] },
  ]);
  const el = m.popover.el;
  expect(el.querySelectorAll('.mp-menu-item').length).toBe(3);
  expect(el.querySelector('.mp-menu-section')?.textContent).toBe('Group A');
  expect(el.querySelectorAll('.mp-menu-divider').length).toBe(1);
  expect(el.querySelector('.mp-menu-check')).toBeTruthy();
  expect(el.querySelector('.mp-menu-item.is-danger')).toBeTruthy();
});

test('clicking an item fires onSelect and closes the menu', () => {
  const m = createMenu();
  let picked = '';
  m.open(anchorAt(), [{ items: [{ label: 'Pick me', onSelect() { picked = 'yes'; } }] }]);
  const row = m.popover.el.querySelector('.mp-menu-item') as HTMLElement;
  row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(picked).toBe('yes');
  expect(m.popover.isOpen()).toBe(false);
});

test('a disabled item does not fire onSelect or close', () => {
  const m = createMenu();
  let fired = false;
  m.open(anchorAt(), [{ items: [{ label: 'Nope', disabled: true, onSelect() { fired = true; } }] }]);
  const row = m.popover.el.querySelector('.mp-menu-item') as HTMLElement;
  row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(fired).toBe(false);
  expect(m.popover.isOpen()).toBe(true);
});

test('trailing element is rendered and its clicks do not close the menu', () => {
  const m = createMenu();
  const toggle = document.createElement('button'); toggle.className = 'my-toggle';
  m.open(anchorAt(), [{ items: [{ label: 'Has toggle', trailing: toggle }] }]);
  expect(m.popover.el.querySelector('.my-toggle')).toBe(toggle);
  toggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(m.popover.isOpen()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/menu.test.ts`
Expected: FAIL — `createMenu` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/webview/menu.ts
import { createPopover, type Popover, type PopoverOpts } from './popover';

export interface MenuItem {
  icon?: string; label: string;
  variant?: 'danger';
  disabled?: boolean;
  checked?: boolean;
  trailing?: HTMLElement;
  submenu?: () => MenuSection[];
  onSelect?: () => void;
}
export interface MenuSection { label?: string; items: MenuItem[]; }
export interface Menu { readonly popover: Popover; open(anchor: HTMLElement, sections: MenuSection[]): void; close(): void; }

export function createMenu(opts: PopoverOpts = {}): Menu {
  const popover = createPopover({ ...opts, className: ['mp-menu', opts.className].filter(Boolean).join(' ') });

  function renderItem(item: MenuItem): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mp-menu-item' + (item.variant === 'danger' ? ' is-danger' : '');
    if (item.disabled) row.disabled = true;
    if (item.icon) {
      const ic = document.createElement('span'); ic.className = 'mp-menu-icon'; ic.innerHTML = item.icon;
      row.appendChild(ic);
    }
    const label = document.createElement('span'); label.className = 'mp-menu-label'; label.textContent = item.label;
    row.appendChild(label);
    if (item.checked) { const c = document.createElement('span'); c.className = 'mp-menu-check'; c.textContent = '✓'; row.appendChild(c); }
    if (item.submenu) { const ca = document.createElement('span'); ca.className = 'mp-menu-caret'; ca.textContent = '›'; row.appendChild(ca); }
    if (item.trailing) {
      item.trailing.classList.add('mp-menu-trailing');
      // clicks on the trailing control must not activate the row
      item.trailing.addEventListener('mousedown', (e) => e.stopPropagation());
      row.appendChild(item.trailing);
    }
    if (!item.disabled && !item.submenu) {
      row.addEventListener('mousedown', (e) => { e.preventDefault(); item.onSelect?.(); popover.close(); });
    }
    return row;
  }

  function render(sections: MenuSection[]): void {
    popover.el.innerHTML = '';
    sections.forEach((section, i) => {
      if (i > 0) { const d = document.createElement('div'); d.className = 'mp-menu-divider'; popover.el.appendChild(d); }
      if (section.label) { const s = document.createElement('div'); s.className = 'mp-menu-section'; s.textContent = section.label; popover.el.appendChild(s); }
      for (const item of section.items) popover.el.appendChild(renderItem(item));
    });
  }

  return {
    popover,
    open(anchor, sections) { render(sections); popover.open(anchor); },
    close() { popover.close(); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/menu.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/webview/menu.ts tests/menu.test.ts
git commit -m "feat(menu): declarative Menu builder (rows/sections/dividers/variants) on Popover"
```

---

## Task 3: Menu drill-down (view stack + back row)

**Files:**
- Modify: `src/webview/menu.ts`
- Test: `tests/menuDrilldown.test.ts`

**Interfaces:**
- Consumes: Task 2's `createMenu`, `MenuItem.submenu`.
- Produces: clicking an item with `submenu` pushes its `MenuSection[]` and prepends an auto **‹ back** row (`.mp-menu-back`); clicking back pops. Root view has no back row.

- [ ] **Step 1: Write the failing test**

```ts
// tests/menuDrilldown.test.ts
/** @jest-environment jsdom */
import { createMenu } from '../src/webview/menu';

beforeEach(() => {
  document.body.innerHTML = '';
  (window as any).innerWidth = 1000; (window as any).innerHeight = 800;
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
  (window as any).ResizeObserver = class { observe() {} disconnect() {} };
});
function anchorAt(): HTMLElement {
  const a = document.body.appendChild(document.createElement('button'));
  a.getBoundingClientRect = () => ({ top: 40, left: 40, width: 80, height: 24, right: 120, bottom: 64, x: 40, y: 40, toJSON() {} } as DOMRect);
  return a;
}

test('selecting a submenu item pushes a sub-view with a back row; back pops', () => {
  const m = createMenu();
  m.open(anchorAt(), [{ items: [
    { label: 'Turn into', submenu: () => [{ items: [{ label: 'Heading', onSelect() {} }, { label: 'Quote', onSelect() {} }] }] },
  ]}]);
  const el = m.popover.el;
  expect(el.querySelector('.mp-menu-back')).toBeNull(); // root has no back

  (el.querySelector('.mp-menu-item') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(el.querySelector('.mp-menu-back')).toBeTruthy();
  expect(Array.from(el.querySelectorAll('.mp-menu-label')).map(n => n.textContent)).toContain('Heading');
  expect(m.popover.isOpen()).toBe(true); // drilling does not close

  (el.querySelector('.mp-menu-back') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(el.querySelector('.mp-menu-back')).toBeNull(); // back to root
  expect(Array.from(el.querySelectorAll('.mp-menu-label')).map(n => n.textContent)).toContain('Turn into');
});

test('selecting a leaf inside a sub-view fires onSelect and closes', () => {
  const m = createMenu();
  let picked = '';
  m.open(anchorAt(), [{ items: [
    { label: 'More', submenu: () => [{ items: [{ label: 'Leaf', onSelect() { picked = 'leaf'; } }] }] },
  ]}]);
  const el = m.popover.el;
  (el.querySelector('.mp-menu-item') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const leaf = Array.from(el.querySelectorAll('.mp-menu-item')).find(n => n.textContent?.includes('Leaf')) as HTMLElement;
  leaf.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(picked).toBe('leaf');
  expect(m.popover.isOpen()).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/menuDrilldown.test.ts`
Expected: FAIL — submenu items don't push a view yet.

- [ ] **Step 3: Implement** (rework `createMenu` internals to a view stack)

Replace the `render` + return block in `menu.ts` with a stack-based renderer:

```ts
  let stack: MenuSection[][] = [];

  function renderCurrent(): void {
    popover.el.innerHTML = '';
    if (stack.length > 1) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'mp-menu-item mp-menu-back';
      back.innerHTML = '<span class="mp-menu-caret mp-menu-caret-back">‹</span><span class="mp-menu-label">Back</span>';
      back.addEventListener('mousedown', (e) => { e.preventDefault(); stack.pop(); renderCurrent(); });
      popover.el.appendChild(back);
      const div = document.createElement('div'); div.className = 'mp-menu-divider'; popover.el.appendChild(div);
    }
    const sections = stack[stack.length - 1];
    sections.forEach((section, i) => {
      if (i > 0) { const d = document.createElement('div'); d.className = 'mp-menu-divider'; popover.el.appendChild(d); }
      if (section.label) { const s = document.createElement('div'); s.className = 'mp-menu-section'; s.textContent = section.label; popover.el.appendChild(s); }
      for (const item of section.items) popover.el.appendChild(renderItem(item));
    });
  }
```

Update `renderItem` so a `submenu` item pushes instead of selecting:

```ts
    if (item.submenu) {
      row.addEventListener('mousedown', (e) => { e.preventDefault(); stack.push(item.submenu!()); renderCurrent(); });
    } else if (!item.disabled) {
      row.addEventListener('mousedown', (e) => { e.preventDefault(); item.onSelect?.(); popover.close(); });
    }
```

Update the returned `open`:

```ts
    open(anchor, sections) { stack = [sections]; renderCurrent(); popover.open(anchor); },
```

(Re-rendering changes `el`'s height; `placeFloating`'s ResizeObserver re-positions automatically — no manual `reposition()` call needed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/menu.test.ts tests/menuDrilldown.test.ts`
Expected: PASS (both suites — Task 2 tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/webview/menu.ts tests/menuDrilldown.test.ts
git commit -m "feat(menu): drill-down via view stack with auto back row"
```

---

## Task 4: Menu styling (`.mp-menu` scrollbar + rows)

**Files:**
- Modify: `src/webview/styles/board.css` (add near the `.is-scroll` block)

**Interfaces:** consumes the class names from Tasks 2–3 (`.mp-menu`, `.mp-menu-item`, `.mp-menu-icon`, `.mp-menu-label`, `.mp-menu-check`, `.mp-menu-caret`, `.mp-menu-section`, `.mp-menu-divider`, `.mp-menu-back`, `is-danger`).

- [ ] **Step 1: Add the styles**

```css
/* ===== Shared Menu component (menu.ts) ===== */
.mp-menu {
  min-width: 200px; background: var(--bg); color: var(--text, inherit);
  border: 1px solid var(--border); border-radius: 10px; padding: 6px;
  box-shadow: 0 12px 28px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08); z-index: 1100;
}
.mp-menu-item {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 7px 10px; border: 0; border-radius: 6px; background: transparent;
  font: inherit; font-size: 13px; color: inherit; text-align: left; cursor: pointer;
}
.mp-menu-item:hover:not(:disabled) { background: var(--block-hover, rgba(127,127,127,0.10)); }
.mp-menu-item:disabled { opacity: 0.45; cursor: default; }
.mp-menu-item.is-danger { color: #d23f3f; }
.mp-menu-icon { width: 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-secondary, #888); flex-shrink: 0; }
.mp-menu-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-menu-check, .mp-menu-caret { color: var(--text-secondary, #888); flex-shrink: 0; }
.mp-menu-trailing { flex-shrink: 0; }
.mp-menu-section { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary, #888); padding: 6px 10px 4px; }
.mp-menu-divider { height: 1px; background: var(--border); margin: 5px 4px; }
.mp-menu-back .mp-menu-label { color: var(--text-secondary, #888); }
```

- [ ] **Step 2: Verify it compiles into the bundle**

Run: `npm run compile`
Expected: `Webview built.`, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/styles/board.css
git commit -m "feat(menu): styles for the shared Menu component"
```

---

## Task 5 (TEMPLATE A — list menu): migrate the Tags picker to `Menu`

**Files:**
- Modify: `src/webview/boardTagsPicker.ts`
- Test: `tests/tagsPickerPosition.test.ts` (existing — must stay green)

This is the canonical example for migrating a **list-style** menu. The tags picker today hand-rolls create/append/`placeFloating`/outside-click. Replace it with `createMenu`, expressing the rows as a `MenuSection[]` model. Keep the filter input + "Create" behavior.

**Interfaces:** Consumes `createMenu` (Task 2), `MenuSection`/`MenuItem` (Task 2). NOTE: the tags picker has a filter `<input>` and re-renders on type — it builds its own content into `menu.popover.el` rather than only using `open(anchor, sections)`. Use the lower-level `createPopover` if the input + dynamic list is cleaner; the canonical list path below uses `Menu` for the option rows and a manually-inserted input.

- [ ] **Step 1: Implement the migration**

Add import: `import { createMenu } from './menu';` (remove the now-unused `placeFloating` import if present).

Replace the body of `openTagsPicker` so it:
1. `const menu = createMenu({ className: 'bd-tags-pop' });`
2. Builds the filter `<input>` and the option rows. Because the list re-renders on input, build a `render()` that computes `MenuSection[]` from the current filter and calls an internal re-render. Simplest: keep using `createPopover` directly here (the input makes it custom content) — see Template B (Task 6) — OR render options as a single `MenuSection` and re-open on each keystroke. **Chosen:** use `createPopover` directly for the tags picker (custom content: input + live list), since it is not a static list. This still removes the hand-rolled lifecycle/dismissal.

Concretely, replace lines 16–24 and 91–97 of `boardTagsPicker.ts`:

Old (positioning + outside-click):
```ts
  document.querySelectorAll('.bd-tags-pop').forEach(n => n.remove());
  const pop = document.createElement('div');
  pop.className = 'bd-tags-pop';
  document.body.appendChild(pop);
  const placement: PlacementHandle = placeFloating(pop, anchor);
  ...
  function onOutside(e: MouseEvent) { if (!pop.contains(e.target as Node) && e.target !== anchor) close(); }
  function close() { placement.destroy(); pop.remove(); document.removeEventListener('mousedown', onOutside, true); }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
```

New:
```ts
  const popover = createPopover({ className: 'bd-tags-pop' });
  const pop = popover.el;        // existing code appends input + list into `pop`
  function close() { popover.close(); }
  // ... build input + list into pop exactly as before ...
  popover.open(anchor);          // replaces appendChild + placeFloating + outside-click wiring
```

Import: `import { createPopover } from './popover';`.

- [ ] **Step 2: Run the existing positioning test + board tests**

Run: `npx jest tests/tagsPickerPosition.test.ts tests/board`
Expected: PASS (positioning test still asserts fixed + on-screen; board tests green except the known `grouping` failure).

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardTagsPicker.ts
git commit -m "refactor(popover): migrate tags picker to createPopover"
```

---

## Task 6 (TEMPLATE B — custom-content popover): migrate the status-options editor

**Files:**
- Modify: `src/webview/boardStatusOptions.ts`

Canonical example for a **custom-content** popover (the options editor: swatch + name input + delete rows — not a simple item list). Replace its lifecycle/dismissal with `createPopover`, keep the bespoke content building.

- [ ] **Step 1: Implement**

Add `import { createPopover } from './popover';` (remove `placeFloating` import).

In `openStatusOptionsEditor`, replace:
```ts
  document.querySelectorAll('.bd-opt-popover').forEach((n) => n.remove());
  const pop = document.createElement('div'); pop.className = 'bd-opt-popover';
  document.body.appendChild(pop);
  const placement = placeFloating(pop, anchor);
  ... outside-click block + close() with placement.destroy()+pop.remove() ...
```
with:
```ts
  const popover = createPopover({ className: 'bd-opt-popover' });
  const pop = popover.el;
  const close = () => popover.close();
  // ... build the options editor into `pop` exactly as before ...
  popover.open(anchor);
```

`openPalette` becomes a child popover so it doesn't dismiss the editor:
```ts
  const palette = createPopover({ className: 'bd-opt-palette', parent: popoverOfTheEditor });
```
(Thread the editor's `Popover` to `openPalette` as a `parent` arg, or open the palette as a top-level child of the editor. If wiring the parent through is awkward, give `openPalette` its own `createPopover({ parent })` where `parent` is passed in.)

- [ ] **Step 2: Verify**

Run: `npm run compile && npx jest tests/board`
Expected: clean compile; board tests pass (except known `grouping`).

- [ ] **Step 3: Commit**

```bash
git add src/webview/boardStatusOptions.ts
git commit -m "refactor(popover): migrate status-options editor + palette to createPopover (palette nested)"
```

---

## Tasks 7–16: migrate remaining menus (one task each)

Each task: replace the menu's hand-rolled create/append/`placeFloating`/outside-click/coexistence with `createMenu` (list menus → build a `MenuSection[]` from the existing item definitions) or `createPopover` (custom content), following Template A (Task 5) or Template B (Task 6). Remove the now-dead positioning + outside-click code. Verify with `npm run compile` and the listed existing tests; commit staging only that file.

For each: read the file, identify the menu function(s), pick Menu vs Popover, and apply the template. Use `parent:` for any sub-popover that must not dismiss its opener (color pickers, type pickers, nested action menus).

- [ ] **Task 7 — block picker + Turn-into + image sub-actions** (`blockPicker.ts`): the biggest. List menu with drill-down → `createMenu`; express BLOCK_DEFS / action items / turn-into / image sub-actions as `MenuSection[]` with `submenu` for the drill-downs; the filter input + inline fields stay as custom additions to `popover.el`. Verify: `npx jest tests/blockPicker.test.ts tests/blockPickerImage.test.ts tests/blockPickerTable.test.ts`. Commit `blockPicker.ts`.
- [ ] **Task 8 — table column menu + status dropdown** (`boardTableRender.ts`): column menu → `createMenu`; status dropdown → `createMenu` (option rows with `checked`). The date picker (`openDatePicker`) → `createPopover` (single input). Verify: `npx jest tests/board`. Commit `boardTableRender.ts`.
- [ ] **Task 9 — kanban column menu + color picker** (`boardKanbanRender.ts`): column menu → `createMenu`; color picker → `createPopover` with `parent` = the column menu's popover. Verify: `npm run compile && npx jest tests/board`. Commit `boardKanbanRender.ts`.
- [ ] **Task 10 — properties menu + field-action menu + add-field picker** (`boardProperties.ts`): field-action menu → `createMenu` (danger Delete, disabled when locked); properties menu (drag handles + toggles) → `createPopover` custom content with each row's `trailing` toggle; add-field picker → `createMenu` with `submenu` for the status setup drill-down. The field-action's "Edit options" opens the status-options editor as a child (`parent`). Verify: `npm run compile && npx jest tests/board`. Commit `boardProperties.ts`.
- [ ] **Task 11 — callout menu** (`calloutMenu.ts`): type list + emoji grid → `createMenu` with the emoji picker as a `submenu` drill-down (collapsing the pre-rendered view toggle). Verify: `npx jest tests/callout.test.ts`. Commit `calloutMenu.ts`.
- [ ] **Task 12 — board view switcher** (`boardChrome.ts`): `.bd-more-menu` → `createPopover` custom content (the Kanban/Table toggle + the properties panel render + delete). Drop its bespoke `registerMenuClose` registry (the Popover registry replaces it); nested sub-popovers use `parent`. Verify: `npm run compile && npx jest tests/board`. Commit `boardChrome.ts`.
- [ ] **Task 13 — board image manager** (`boardImagePicker.ts`): `createPopover` custom content. Verify: `npm run compile && npx jest tests/board tests/boardImageLinks.test.ts`. Commit `boardImagePicker.ts`.
- [ ] **Task 14 — filter panel** (`boardFilterPanel.ts`): `createPopover` custom content (filter chips); drop its capture-phase coexistence comment/handler. Verify: `npm run compile && npx jest tests/boardFilter.test.ts`. Commit `boardFilterPanel.ts`.
- [ ] **Task 15 — Actions dots panel + submenu** (`index.ts`): dots panel → `createMenu` (or `createPopover` if content is mixed); the actions submenu → child `createMenu`/`createPopover` with `parent` = the dots panel (replaces `positionSubmenu` + `closeAllActionsPanels`). Leave the filename hover-panel out unless trivially convertible (centered design — note if skipped). Verify: `npm run compile`. Commit `index.ts`.
- [ ] **Task 16 — AI transform panel** (`aiTransformPanel.ts`): it is a CSS-centered modal (not anchored). LEAVE positioning as-is; only adopt the registry if it should close when another popover opens. If no change is warranted, this task is a no-op — note that and skip. Verify: `npm run compile`.

---

## Task 17: Guardrail — migrated menus route through the component

**Files:**
- Modify: `tests/menuPositionGuardrail.test.ts`

- [ ] **Step 1: Add the check**

Append a describe block: for the migrated files (boardTagsPicker, blockPicker, boardTableRender, boardKanbanRender, boardProperties, boardStatusOptions, boardImagePicker, calloutMenu, boardChrome, boardFilterPanel), assert each source:
- imports from `./popover` or `./menu` (`expect(src).toMatch(/from '\.\/(popover|menu)'/)`),
- no longer calls `placeFloating(` directly (`expect(src).not.toMatch(/placeFloating\(/)`) — the component owns it,
- no longer hand-rolls dismissal (`expect(src).not.toMatch(/addEventListener\('mousedown'[^)]*true\)/)`).

```ts
describe('migrated menus route through the Popover/Menu component (popover ticket)', () => {
  const VIA_COMPONENT = [
    'boardTagsPicker.ts','blockPicker.ts','boardTableRender.ts','boardKanbanRender.ts',
    'boardProperties.ts','boardStatusOptions.ts','boardImagePicker.ts','calloutMenu.ts',
    'boardChrome.ts','boardFilterPanel.ts',
  ];
  const dir = path.join(__dirname, '..', 'src', 'webview');
  for (const f of VIA_COMPONENT) {
    test(`${f} uses createPopover/createMenu, not raw placeFloating or hand-rolled dismissal`, () => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src).toMatch(/from '\.\/(popover|menu)'/);
      expect(src).not.toMatch(/\bplaceFloating\s*\(/);
      expect(src).not.toMatch(/addEventListener\(\s*['"]mousedown['"][^)]*,\s*true\s*\)/);
    });
  }
});
```

- [ ] **Step 2: Run it**

Run: `npx jest tests/menuPositionGuardrail.test.ts`
Expected: PASS once Tasks 5–14 are complete. If a file FAILS, that file still hand-rolls — fix the migration, not the test.

- [ ] **Step 3: Commit**

```bash
git add tests/menuPositionGuardrail.test.ts
git commit -m "test(popover): guardrail — migrated menus route through createPopover/createMenu"
```

---

## Task 18: Full suite + compile + docs

- [ ] **Step 1: Full suite**

Run: `npx jest --testPathIgnorePatterns='/.claude/worktrees/'`
Expected: all green except the known pre-existing `tests/board/grouping.test.ts`. Confirm the new `popover`, `menu`, `menuDrilldown` suites pass and no migrated menu's existing tests regressed.

- [ ] **Step 2: Compile**

Run: `npm run compile`
Expected: clean build.

- [ ] **Step 3: Manual check (real app, F5)**

Open each migrated menu near screen edges; confirm: opens, positions/flips/caps (c34 behavior preserved), outside-click + Escape dismiss, opening one closes others, drill-downs (Turn-into, callout emoji, add-field status setup) push/back correctly, nested pickers (color/type/palette) don't dismiss their opener. Dark + light theme.

- [ ] **Step 4: Docs**

Update `CHANGELOG.md` under `[Unreleased]` (internal refactor note — menus now share one Popover/Menu component). No user-facing behavior change beyond consistency.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog — shared Popover/Menu component"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** Popover primitive (T1) ✓; Menu builder rows/sections/variants (T2) ✓; drill-down (T3) ✓; styles (T4) ✓; coexistence registry + nesting (T1, tested) ✓; Menu-vs-raw-Popover split (T5 template A / T6 template B, applied per menu T7–16) ✓; migrate all click-anchored menus (T5–16) ✓; bubble/tooltip/mermaid excluded (Global Constraints; T16 notes AI panel) ✓; guardrail (T17) ✓; tests (T1–3, T17, T18) ✓.
- **Placeholder scan:** Tasks 7–16 are per-menu and describe the approach + verification rather than full before/after code, because writing complete diffs for 10 menus would be unwieldy and each is a mechanical application of the fully-shown Templates A (T5) and B (T6). The executing agent reads each file and applies the template. This is a deliberate, flagged decision — not a TODO.
- **Type consistency:** `PopoverOpts`/`Popover`/`createPopover` (T1) and `MenuItem`/`MenuSection`/`Menu`/`createMenu` (T2–3) names are used identically across tasks and the guardrail.
- **Note for executor:** Tasks 5–6 are the canonical templates — implement and review them before 7–16 so the pattern is proven on one list menu and one custom-content popover first.
