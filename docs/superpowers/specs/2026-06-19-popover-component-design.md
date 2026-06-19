# Popover + Menu component — design

**Status:** Approved 2026-06-19
**Follow-up to:** c34 (shared menu positioning). Built on `placeFloating()` + the `.is-scroll` scrollbar standard, which live on `feature/menu-positioning-c34`.

## Problem

c34 unified menu *positioning*, but every floating menu still hand-rolls the rest of its plumbing. An audit of ~12 menu modules found:

- **Lifecycle** (create → append → `placeFloating` → `destroy`/remove) copy-pasted everywhere.
- **Dismissal** — the same capture-phase `mousedown` + `contains()` block copy-pasted ~10 times; Escape and scroll-close are inconsistent (some menus have them, most don't).
- **Coexistence** ("one open at a time") done three different ad-hoc ways: nuke-stale via `querySelectorAll().forEach(remove)` (which skips `placement.destroy()` — the c34 leak), a bespoke registry in `boardChrome`, and capture-phase luck in `boardFilterPanel`.
- **Item/row construction** — **8 hand-rolled variants** of the same icon + label + (caret / checkmark / danger / trailing-control) row.
- **Drill-down** — 3–4 different mechanisms (state+rerender, pre-rendered view toggle, DOM swap, sibling popover).

## Goals

1. One `Popover` primitive that owns lifecycle, dismissal, and coexistence — used by every floating surface.
2. One `Menu` builder on top of it that replaces the 8 row builders and standardizes drill-down.
3. Structurally fix the "nuke-without-destroy" leak from c34.
4. Migrate every click-anchored menu onto it for one consistent behavior.

## Non-goals

- The **text bubble menu** (`bubbleMenu.ts`) stays on Tippy — selection-anchored, editor-aware, doesn't fit an element-anchored primitive.
- **Tooltips** (`tooltip.ts`, block-handle tooltip) stay separate — centered, not anchored popovers.
- **Mermaid visual-editor overlays** stay separate — canvas-coordinate subsystem.
- No redesign of any menu's *contents* or visuals; this is a structural extraction.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Shape | `Popover` primitive + `Menu` builder (two units). Drill-down is a Menu mode, not a separate component. |
| Coexistence | Central registry with opt-in nesting (`parent`). |
| Migration | Build + migrate ALL click-anchored menus this ticket. |
| Bubble menu | Left on Tippy (out of scope). |
| Menu vs raw Popover | List-style menus → `Menu`; custom-content popovers (status-options editor, image manager, properties panel) → `Popover` directly. |

## Design

### Architecture

```
placeFloating()   ← c34, positioning only
      ▲
   Popover (popover.ts)   ← lifecycle + dismissal + coexistence
      ▲
    Menu (menu.ts)        ← declarative rows/sections/dividers/variants + drill-down
```

### 1. `src/webview/popover.ts` — the primitive

```ts
export interface PopoverOpts {
  className?: string;          // class(es) applied to the popover root el
  preferX?: 'left' | 'right';  // forwarded to placeFloating
  parent?: Popover;            // opt-in nesting: opening this does NOT close `parent`
  closeOnScroll?: boolean;     // default true; outside-scroll dismisses
  onClose?: () => void;        // called once per close()
}

export interface Popover {
  readonly el: HTMLElement;            // caller fills this with content
  open(anchor: HTMLElement): void;     // append to body, placeFloating, register, wire dismissal
  close(): void;                       // placement.destroy() + remove listeners + unregister + remove el + onClose
  reposition(): void;                  // re-run placeFloating (rarely needed; Menu drill-down relies on the observer)
  isOpen(): boolean;
}

export function createPopover(opts?: PopoverOpts): Popover;
```

Behavior:
- `open(anchor)`: if no `parent`, the registry (§3) closes the current top-level popover first. Append `el` to `document.body`, apply `className`, call `placeFloating(el, anchor, { preferX })`, push onto the registry stack, and install ONE shared dismissal handler.
- **Dismissal** (single implementation, replacing the copy-paste):
  - Capture-phase `document.mousedown`: close the deepest open popover(s) whose `el` (and whose descendants in the stack) do not contain the target. A click inside a child popover never closes its ancestor.
  - `Escape`: close the topmost popover.
  - `scroll` (capture, passive) when `closeOnScroll`: close if the scroll originates outside the popover.
- `close()`: idempotent. Runs `placement.destroy()`, removes the dismissal listeners, pops from the registry, removes `el` from the DOM, fires `onClose`.
- `reposition()`: delegates to the placement handle's `reposition()`.

### 2. `src/webview/menu.ts` — the Menu builder

```ts
export interface MenuItem {
  icon?: string;                    // inline SVG/HTML string
  label: string;
  variant?: 'danger';
  disabled?: boolean;
  checked?: boolean;                // trailing ✓ (marks the current value)
  trailing?: HTMLElement;           // e.g. a visibility toggle, kept interactive
  submenu?: () => MenuSection[];    // drill-down: renders a › and pushes a sub-view
  onSelect?: () => void;            // ignored when submenu is present
}
export interface MenuSection { label?: string; items: MenuItem[]; }

export interface Menu {
  readonly popover: Popover;
  open(anchor: HTMLElement, sections: MenuSection[]): void;
  close(): void;
}
export function createMenu(opts?: PopoverOpts): Menu;
```

- Renders sections (optional uppercase label + divider between sections) and rows via ONE internal `renderItem(MenuItem)` (icon | label | trailing `checked`✓ / `caret`› / custom `trailing`), with `danger` and `disabled` states. This replaces all 8 hand-rolled builders.
- **Drill-down** (standardized on the block-picker pattern): an internal stack of `MenuSection[]`. Selecting an item with `submenu` pushes its result and re-renders the same `el` (adding an auto **‹ back** row); selecting back pops. Re-rendering changes `el`'s height, which `placeFloating`'s ResizeObserver (c34) re-positions — so a drill-down near a screen edge re-flips/caps automatically. The callout menu's pre-rendered view toggle and the properties add-field's DOM-swap both collapse into this.
- Item activation uses `mousedown` + `preventDefault` (preserves the existing behavior where a row click must not blur/teardown mid-handler).

### 3. Coexistence registry (inside `popover.ts`)

A module-level stack `open: Popover[]`.
- Opening a popover with no `parent`: close all popovers currently on the stack (each via its own `close()`), then push.
- Opening with `parent`: push without closing (the parent stays open). The stack thus represents a nesting chain.
- Capture-phase outside-`mousedown`: walk the stack top-down, closing each popover whose `el` does not contain the target, stopping at the first that does (so clicking inside a parent closes only its children).
- Every path uses `close()`, so `placement.destroy()` always runs — no leaked observers/listeners.

### 4. Migration

Every click-anchored menu is rebuilt:

- **Via `Menu`** (declarative list): tags picker, block picker + Turn-into + image sub-actions, table column menu, table status dropdown, kanban column menu, board field-action menu, callout menu, board view switcher (`.bd-more-menu` list portion), filter quick-actions, the Actions ⋯ dots panel + its submenu.
- **Via `Popover`** (custom content): status-options editor + palette, board image manager, the Properties panel (drag handles + toggles), the add-property type picker → status setup (drill-down via Menu where it's a list; custom where it's the options editor).
- **Excluded:** `bubbleMenu.ts`, `tooltip.ts` + block-handle tooltip, mermaid overlays.
- The kanban color picker and `openPalette` (sibling popovers today) become child `Popover`s with `parent` set.

Migration is mechanical per menu: replace the bespoke create/append/placeFloating/outside-click/coexistence block with `createPopover`/`createMenu`, and (for list menus) express items as a `MenuSection[]` model.

### 5. Testing

- **Registry** (jsdom): opening a top-level popover closes the previous one and calls its `placement.destroy()`; opening a child with `parent` keeps the parent open; outside-click closes children but not the containing parent; `close()` is idempotent and always destroys.
- **Popover lifecycle** (jsdom): `open` appends + positions (placeFloating stubbed/geometry-stubbed) + wires listeners; `close` removes el + listeners; Escape closes topmost.
- **Menu rendering** (jsdom): sections → label + divider; item variants (danger/disabled/checked/trailing/caret); `onSelect` fires on activate; `submenu` pushes a view with a back row; back pops.
- **Drill-down**: push/pop stack depth; back row present only below the root.
- **Guardrail extension** (`menuPositionGuardrail.test.ts` family): migrated menu files route through `createPopover`/`createMenu` — assert they no longer call `document.body.appendChild` + `placeFloating` directly, nor hand-roll `document.addEventListener('mousedown', …, true)` dismissal.

## Follow-up / out of scope

- Keyboard arrow-key navigation within menus (nice-to-have; not in this ticket).
- Folding the bubble menu off Tippy (separate effort, if ever).
