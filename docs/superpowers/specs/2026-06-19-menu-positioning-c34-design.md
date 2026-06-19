# c34 — Smart menu positioning (no more off-screen cropping)

**Status:** Design approved 2026-06-19
**Ticket:** c34 (Urgent!!) — "Fix all the menu drill-downs (and regular menus) that get cropped because they're out of the screen, and make sure this doesn't happen again."

## Problem

Every floating surface in the webview hand-rolls its own positioning. An Explore pass found ~16 menus/popovers using **7 different positioning patterns**, with no shared helper:

- Some have solid dual-axis flip logic (table column menu).
- Several use `window.scrollX/scrollY` math that breaks inside scrolled/fixed containers, clamping only the right edge.
- At least one (the Tags picker) has **zero edge detection** and will run straight off-screen near a viewport edge.
- Drill-downs (Turn into, block picker) swap content *inside the same popover*, changing its height after it's positioned — and nothing re-checks the edge afterward.

The result: menus get cropped near screen edges, and because the logic is duplicated 16 ways, the bug recurs every time a new menu is added.

There are also **three inconsistent scrollbar treatments** (`.board-columns`, `.cb-content`, `.bubble-into`) at different widths/visibility, and one menu showed a phantom scrollbar when its items already fit.

## Goals

1. One shared positioning behavior every floating surface uses.
2. Menus never crop off-screen and never cover their own anchor.
3. A single scrollbar standard for menus.
4. A guardrail so new menus can't reintroduce the bug.

## Non-goals

- **Not** building a full `Popover` component in this ticket (teed up as a follow-up — see below).
- **Not** migrating the Tippy-based text bubble menu (it already flips correctly; we only ensure our helper matches its feel).
- No visual redesign of menu contents.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Scope | Central helper + migrate all menus + guardrail |
| Overflow behavior | Flip → clamp → scroll |
| Cover anchor | Never — pick roomier side, cap to that gap |
| Scrollbar | Standard hide-until-hover class; `overflow: visible` until true overflow |
| Guardrail | Both ESLint rule **and** edge-case test suite |
| DS structure | Primitives now (`placeFloating` + scrollbar), `Popover` component later |
| Tippy bubble menu | Leave as-is |
| Rollout | All 16 surfaces migrated in one pass |

## Design

### 1. The positioning primitive — `src/webview/menuPosition.ts`

```ts
interface PlaceOpts {
  margin?: number;        // viewport safe margin, default 8
  gap?: number;           // distance from anchor, default 4
  preferX?: 'left' | 'right';   // default 'left' (left-aligned to anchor)
  matchWidth?: boolean;   // optional: set el width to anchor width
}

interface PlacementHandle {
  reposition(): void;     // re-run the cascade (call after content changes)
  destroy(): void;        // disconnect observers + listeners
}

function placeFloating(el: HTMLElement, anchor: HTMLElement | DOMRect, opts?: PlaceOpts): PlacementHandle;
```

Behavior — measured against the real viewport, in a `requestAnimationFrame` after the element is in the DOM:

1. **Position model:** `position: fixed` + viewport coordinates. This kills the `window.scrollX/Y` bugs that break inside scrolled containers.
2. **Measure natural size** with no height cap (`max-height: none`, default `overflow: visible`).
3. **Pick a vertical side that never covers the anchor:**
   - `spaceBelow = viewportH - anchor.bottom - gap - margin`
   - `spaceAbove = anchor.top - gap - margin`
   - Fits below → below. Else fits above → above. Else → the **roomier** side.
4. **Cap + scroll only on true overflow:** if natural height `> avail + FUZZ` (FUZZ ≈ 2px to avoid sub-pixel false positives), set `max-height: avail`, add the `is-scroll` class (enables `overflow-y: auto`). Otherwise leave it uncapped with no scrollbar.
5. **Horizontal:** left-aligned to the anchor; if the right edge would cross `viewportW - margin`, right-align to the anchor (grow leftward).
6. **Clamp:** after side/flip decisions, clamp `left`/`top` into `[margin, viewport - size - margin]` so a corner anchor can't push it out.
7. **Re-position on change:** attach a `ResizeObserver` on `el` so drill-downs that swap content (changing height) re-run the cascade. `reposition()` is also exposed for manual calls; `destroy()` cleans up.

### 2. The scrollbar standard

A shared class (working name `.menu-scroll`) + the `is-scroll` state, replacing the three inconsistent bars. Matches the `.board-columns` hide-until-hover treatment:

- Default: `overflow: visible`, no bar.
- `.is-scroll`: `overflow-y: auto`, `scrollbar-width: thin`, thumb transparent until `:hover`, 6px wide, rounded, `--board-border` thumb on hover. Dark-theme variant included.
- **Never** leave `overflow-y: auto` + `max-height` permanently on — that caused the phantom scrollbar.

(See the project scrollbar memory for the canonical rule.)

### 3. Migration — all ~16 surfaces, one pass

Each menu's bespoke positioning block is replaced with a `placeFloating()` call; each scroll container adopts the standard class. Inventory (file → creator):

- Block Picker / Turn Into / Action Menu — `blockPicker.ts`
- Callout Menu — `calloutMenu.ts`
- Image Bubble Menu — `imageBubbleMenu.ts`
- Board Properties + Field Action Menu — `boardProperties.ts` (drop `positionAnchored`)
- Status Options Editor + Color Palette — `boardStatusOptions.ts`
- Tags Picker — `boardTagsPicker.ts` (**currently unclamped**)
- Kanban column menu + add-card menu — `boardKanbanRender.ts`
- Table column menu + status dropdown — `boardTableRender.ts`
- Board Image Manager — `boardImagePicker.ts`
- Tooltip — `tooltip.ts` (centering variant; may keep its own placement but adopt the clamp helper)
- AI Transform Panel — `aiTransformPanel.ts`

**Excluded:** the text-formatting bubble menu (Tippy) stays as-is.

Outside-click dismissal and the "one panel open at a time" coexistence stay where they are for now (each menu keeps its own) — consolidating them is the follow-up component's job.

### 4. Guardrail

1. **ESLint rule** (custom, in the repo's lint config): flags assignment to `el.style.left` / `el.style.top` in combination with `getBoundingClientRect()` within `src/webview/**` menu files, with the message: *"Position floating elements with placeFloating() (src/webview/menuPosition.ts), not manual coordinates."* Tippy file path is exempted.
2. **Edge-case test suite:** for each migrated menu, mount it with the anchor at all four viewport corners + a taller-than-viewport case, and assert:
   - the element's rect is fully within `[margin, viewport - margin]` on both axes,
   - the element does not vertically overlap its anchor,
   - the `is-scroll` class is present **iff** content exceeds the available side.

## Follow-up (separate ticket, not c34)

Extract a **`Popover` component** that bundles `placeFloating` + the scrollbar standard + outside-click dismissal + one-open-at-a-time coexistence, then move each menu to own only its *content*. Low-risk and mostly mechanical once every menu already routes through the helper.

## Testing strategy

- Unit tests for `placeFloating` geometry (pure-ish: feed anchor rects + element sizes, assert computed top/left/side/scroll).
- The edge-case suite above per migrated menu.
- Manual: open each menu near every screen edge in both light and dark themes; resize the window with a menu open; drill into Turn Into near the bottom edge and confirm it re-positions.
