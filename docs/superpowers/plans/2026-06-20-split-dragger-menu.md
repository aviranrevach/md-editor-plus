# Split dragger menu (Turn-into flyout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dragger (⠿) action menu's "Turn into" into a single button that reveals its targets in a cascading flyout panel to the right, replacing today's in-place drill-down.

**Architecture:** The flyout is a **child popover** of the action menu's popover (the popover registry already supports parent/child + edge-aware placement via `placeFloating`). The convert-target list (targets + ✨ Using AI) is extracted to a pure helper and reused. Mouse hover / keyboard focus on the "Turn into" row opens/closes the flyout; typing collapses back to today's flat filtered list.

**Tech Stack:** TypeScript, plain DOM (no framework in webview), the existing `Popover`/`placeFloating` primitives, Jest (jsdom) for unit tests.

## Global Constraints

- **Scope: the dragger action menu only** (the `actionMode` / `context.activeBlock` path in [blockPicker.ts](src/webview/blockPicker.ts)). Do NOT change the `+` / slash **insert** menu, block ordering, filtering, or what any conversion does.
- **No new actions.** Keep exactly Turn into / Duplicate / Delete. No Color / Move to / Comment (YAGNI).
- **Reuse, don't reinvent:** `convertActive`, `convertActiveWithAi`, `convertibleTargets` ([blockActions.ts](src/webview/blockActions.ts)), `AI_TRANSFORMS` ([aiTransforms.ts](src/webview/aiTransforms.ts)), `searchBlockActions`, the c43 footer + `footerCloseVerb`, `placeFloating` ([menuPosition.ts](src/webview/menuPosition.ts)), and the `Popover` parent/child registry ([popover.ts](src/webview/popover.ts)). Add no new positioning logic.
- **Theme via tokens only** (`var(--border)`, `var(--text-secondary)`, etc.); no hard-coded hex except the pre-existing delete-red `#e5484d`.
- **Test runner:** `npm test` (Jest). Pre-existing failing suite `tests/board/grouping.test.ts` (a TS type-check error from the c36 merge) is unrelated — leave it; do not let it block. Every other suite stays green. After each task, also run `npm run compile` (this is what F5 builds) and confirm `Webview built.`

---

### Task 1: Extract `turnIntoFlyoutItems()` — the target list, as a pure helper

Today the convert targets + the AI-dedupe live inline in `renderTurnInto` ([blockPicker.ts:773-811](src/webview/blockPicker.ts#L773-L811)). Extract that selection logic into a pure, tested helper so the flyout (Task 2) and any caller build the same list. No behavior change yet — `renderTurnInto` is refactored to call it.

**Files:**
- Modify: `src/webview/blockActions.ts` (add `turnIntoFlyoutItems`)
- Modify: `src/webview/blockPicker.ts` (`renderTurnInto` uses it)
- Test: `tests/blockActions.test.ts`

**Interfaces:**
- Consumes: `convertibleTargets(defs: BlockDef[]): BlockDef[]` and `AI_TRANSFORMS: AiTransform[]` (each has `id: string`, `label: string`, `iconHtml: string`).
- Produces: `turnIntoFlyoutItems(defs: BlockDef[]): { targets: BlockDef[]; aiItems: AiTransform[] }` — `targets` is `convertibleTargets(defs)`; `aiItems` is `AI_TRANSFORMS` minus any whose `id` matches a deterministic target id (the existing dedupe).

- [ ] **Step 1: Write the failing test**

Add to `tests/blockActions.test.ts` (create the file if absent; import style mirrors `tests/blockPicker.test.ts`):

```typescript
import { turnIntoFlyoutItems, convertibleTargets } from '../src/webview/blockActions';
import { BLOCK_DEFS } from '../src/webview/blockPicker';
import { AI_TRANSFORMS } from '../src/webview/aiTransforms';

describe('turnIntoFlyoutItems', () => {
  it('returns the convertible targets verbatim', () => {
    const { targets } = turnIntoFlyoutItems(BLOCK_DEFS);
    expect(targets.map(t => t.id)).toEqual(convertibleTargets(BLOCK_DEFS).map(t => t.id));
  });

  it('drops AI transforms that duplicate a deterministic target id', () => {
    const targetIds = new Set(convertibleTargets(BLOCK_DEFS).map(t => t.id));
    const { aiItems } = turnIntoFlyoutItems(BLOCK_DEFS);
    expect(aiItems.length).toBeGreaterThan(0);
    expect(aiItems.every(a => !targetIds.has(a.id))).toBe(true);
  });

  it('keeps AI transforms that have no deterministic equivalent', () => {
    const { aiItems } = turnIntoFlyoutItems(BLOCK_DEFS);
    // AI_TRANSFORMS minus the deterministic dupes
    const targetIds = new Set(convertibleTargets(BLOCK_DEFS).map(t => t.id));
    const expected = AI_TRANSFORMS.filter(a => !targetIds.has(a.id)).map(a => a.id);
    expect(aiItems.map(a => a.id)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- blockActions`
Expected: FAIL — `turnIntoFlyoutItems is not a function`.

- [ ] **Step 3: Implement the helper**

In `src/webview/blockActions.ts`, add (import `AI_TRANSFORMS` + its type at the top):

```typescript
import { AI_TRANSFORMS, type AiTransform } from './aiTransforms';

// The Turn-into flyout's contents: every deterministic convert target, plus
// the AI transforms that DON'T duplicate one of those targets (offering an AI
// "Table" next to the real Table converter is confusing).
export function turnIntoFlyoutItems(defs: BlockDef[]): { targets: BlockDef[]; aiItems: AiTransform[] } {
  const targets = convertibleTargets(defs);
  const deterministic = new Set(targets.map(t => t.id));
  const aiItems = AI_TRANSFORMS.filter(a => !deterministic.has(a.id));
  return { targets, aiItems };
}
```

(If `aiTransforms.ts` imports from `blockActions.ts`, avoid a cycle by importing only the type and the `AI_TRANSFORMS` value — they are leaf data. Verify no circular import after adding; if one appears, keep the dedupe in `blockPicker` instead and export a `dedupeAiTargets(targets, ai)` pure helper from `blockActions.ts` that both call. Pick whichever avoids the cycle; the test targets the same observable result either way.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- blockActions`
Expected: PASS (3 cases).

- [ ] **Step 5: Refactor `renderTurnInto` to use it (no behavior change)**

In `blockPicker.ts` `renderTurnInto` ([:782-807](src/webview/blockPicker.ts#L782-L807)), replace the inline `convertibleTargets(...)` filtering and the inline AI dedupe with:

```typescript
    const { targets, aiItems: allAi } = turnIntoFlyoutItems(BLOCK_DEFS);
    const q = input.value.toLowerCase().trim();
    const items = targets.filter(
      t => !q || t.label.toLowerCase().includes(q) ||
           t.description.toLowerCase().includes(q) ||
           (t.aliases ?? []).some(a => a.toLowerCase().includes(q)),
    );
    items.forEach((t) => makeRow(t.iconHtml, t.label, () => convertActive(t), { current: isActiveItem(t) }));

    const aiItems = allAi.filter((t) => !q || t.label.toLowerCase().includes(q));
    if (aiItems.length) {
      const sub = document.createElement('div');
      sub.className = 'block-picker-section-label';
      sub.textContent = '✨ Using AI';
      list.appendChild(sub);
      aiItems.forEach((t) => makeRow(t.iconHtml, t.label, () => convertActiveWithAi(t.id, t.label)));
    }
```

Add the import: `import { searchBlockActions, convertibleTargets, turnIntoFlyoutItems, type ActionId } from './blockActions';` (extend the existing import line — keep what's already imported).

- [ ] **Step 6: Verify the full suite + compile**

Run: `npm test` → `blockActions` green, everything else unchanged (only `board/grouping` red).
Run: `npm run compile` → `Webview built.`

- [ ] **Step 7: Commit**

```bash
git add src/webview/blockActions.ts src/webview/blockPicker.ts tests/blockActions.test.ts
git commit -m "refactor: extract turnIntoFlyoutItems() for the dragger Turn-into list"
```

---

### Task 2: The Turn-into flyout (mouse) — child popover, hover open/close, convert

Build the flyout as a child popover anchored to the "Turn into" row. Render targets + ✨ Using AI via Task 1's helper. Open on hover of "Turn into", close on hover of other rows / on convert / on typing / on picker close. Remove the old drill-down. Mouse-complete; keyboard is Task 3.

**Files:**
- Modify: `src/webview/blockPicker.ts` (flyout popover + render + hover wiring; remove `openTurnInto`/`closeTurnInto`/`renderTurnInto`/`turnIntoOpen`)
- Modify: `src/webview/styles/editor.css` (add `.block-picker-flyout`)

**Interfaces:**
- Consumes: `turnIntoFlyoutItems(BLOCK_DEFS)` (Task 1); `convertActive(t)`, `convertActiveWithAi(id,label)`, `isActiveItem(t)`, `makeRow(...)`, `footerCloseVerb(bool)`, `createPopover`, `placeFloating`.
- Produces: a module-scoped flyout controller inside `createBlockPicker` with `openFlyout(rowEl: HTMLElement)`, `closeFlyout()`, and `isFlyoutOpen(): boolean`, plus a `flyoutRows: Array<() => void>` and `flyoutIdx` that Task 3 drives. The action-menu "Turn into" row carries `data-turn-into="1"`.

- [ ] **Step 1: Create the flyout popover + its element (lazy, once)**

Near where the main `popover` is created ([:588](src/webview/blockPicker.ts#L588)), add a lazily-created child popover. It reuses `.block-picker` styling plus a `.block-picker-flyout` modifier, caps height at 440 and prefers the right side:

```typescript
  let flyoutPop: Popover | null = null;
  let flyoutList: HTMLElement | null = null;
  let flyoutRows: Array<() => void> = [];
  let flyoutIdx = 0;

  function ensureFlyout(): Popover {
    if (flyoutPop) return flyoutPop;
    flyoutPop = createPopover({
      className: 'block-picker block-picker-flyout',
      parent: popover!,            // child: keeps the action menu open, shares dismissal
      preferX: 'right',
      maxHeight: 440,
    });
    flyoutList = document.createElement('div');
    flyoutList.className = 'block-picker-list';
    flyoutPop.el.appendChild(flyoutList);
    return flyoutPop;
  }

  function isFlyoutOpen(): boolean { return !!flyoutPop?.isOpen(); }
```

- [ ] **Step 2: Render + open the flyout against the Turn-into row**

```typescript
  function renderFlyout(): void {
    const list = flyoutList!;
    list.innerHTML = '';
    flyoutRows = [];
    const { targets, aiItems } = turnIntoFlyoutItems(BLOCK_DEFS);

    const makeFlyRow = (iconHtml: string, label: string, activate: () => void, current = false) => {
      const row = document.createElement('div');
      row.className = 'block-picker-item';
      if (current) row.classList.add('current');
      row.dataset.idx = String(flyoutRows.length);
      const check = current ? '<span class="block-picker-current-mark">✓</span>' : '';
      row.innerHTML = `<span class="block-picker-icon">${iconHtml}</span><span class="block-picker-label">${label}</span>${check}`;
      row.addEventListener('mousedown', (e) => { e.preventDefault(); activate(); });
      list.appendChild(row);
      flyoutRows.push(activate);
    };

    targets.forEach((t) => makeFlyRow(t.iconHtml, t.label, () => convertActive(t), isActiveItem(t)));
    if (aiItems.length) {
      const sub = document.createElement('div');
      sub.className = 'block-picker-section-label';
      sub.textContent = '✨ Using AI';
      list.appendChild(sub);
      aiItems.forEach((t) => makeFlyRow(t.iconHtml, t.label, () => convertActiveWithAi(t.id, t.label)));
    }
    flyoutIdx = 0;
    updateFlyoutActive();
  }

  function updateFlyoutActive(): void {
    flyoutList!.querySelectorAll<HTMLElement>('.block-picker-item').forEach((row, i) => {
      row.classList.toggle('active', i === flyoutIdx);
    });
  }

  function openFlyout(rowEl: HTMLElement): void {
    ensureFlyout();
    if (!flyoutPop!.isOpen()) flyoutPop!.open(rowEl);  // positions right/flip-left via placeFloating
    renderFlyout();
    footVerb.textContent = footerCloseVerb(true);      // action-panel footer: esc Back
  }

  function closeFlyout(): void {
    if (flyoutPop?.isOpen()) flyoutPop.close();
    footVerb.textContent = footerCloseVerb(false);     // esc Close
  }
```

(`footVerb` is the c43 footer-verb node already queried in this scope. `updateActive` is the action-panel highlighter.)

- [ ] **Step 3: Replace the drill-down with hover wiring in `renderActionMenu`**

In `renderActionMenu` ([:734-770](src/webview/blockPicker.ts#L734-L770)): the "Turn into" row no longer drills down. Tag it and wire hover so highlighting it opens the flyout, and hovering any other action closes it. Change the `runAction` for `turn-into` to open the flyout instead of `openTurnInto`. Concretely, after building each action row, add hover handlers; for the turn-into row set `data-turn-into="1"` and give it the `caret` so the `›` shows. Replace the `makeRow(... a.id==='turn-into' ...)` block with:

```typescript
    actions.forEach((a) => {
      const isTurn = a.id === 'turn-into' && !input.value.trim();
      const row = makeRow(ACTION_ICONS[a.id], a.label,
        () => runAction(a.id),
        { caret: isTurn, danger: a.id === 'delete' });
      if (isTurn) {
        row.dataset.turnInto = '1';
        row.addEventListener('mouseenter', () => openFlyout(row));
      } else {
        row.addEventListener('mouseenter', () => closeFlyout());
      }
      if (isTurn && actions.length > 1) {
        const sep = document.createElement('div');
        sep.className = 'block-picker-sep';
        list.appendChild(sep);
      }
    });
```

And in `runAction` ([:720-724](src/webview/blockPicker.ts#L720-L724)) change the turn-into branch:

```typescript
  function runAction(id: ActionId): void {
    if (id === 'turn-into') { const row = list.querySelector<HTMLElement>('[data-turn-into="1"]'); if (row) openFlyout(row); return; }
    if (id === 'delete')    { deleteActiveBlock(); return; }
    if (id === 'duplicate') { duplicateActiveBlock(); return; }
  }
```

- [ ] **Step 4: Close the flyout on typing, re-render, and picker close**

- In the `input` `'input'` handler ([:978-986](src/webview/blockPicker.ts#L978-L986)): when `actionMode`, call `closeFlyout()` then `renderActionMenu()` (drop the `turnIntoOpen ? renderTurnInto` branch entirely).
- In `resetState` ([:1021-1029](src/webview/blockPicker.ts#L1021-L1029)): call `closeFlyout()` and delete the `turnIntoOpen = false` line (the flag is gone).
- Delete `openTurnInto`, `closeTurnInto`, `renderTurnInto`, and the `turnIntoOpen` declaration ([:599](src/webview/blockPicker.ts#L599)). Remove the `Escape`/`turnIntoOpen` branch in the keydown handler ([:1006-1008](src/webview/blockPicker.ts#L1006-L1008)) — Task 3 rewrites keydown; for now make Escape just `close()` when not drilled (`drillParent`).

- [ ] **Step 5: Add the flyout CSS**

In `src/webview/styles/editor.css`, after the `.block-picker-footer` rules, add:

```css
/* Turn-into flyout: a child of the action menu, offset to its right. Reuses
   .block-picker chrome; no search field, no footer of its own. */
.block-picker-flyout {
  width: 230px;
  margin-left: 8px;   /* visual gap from the action panel; placeFloating sets left/top */
}
```

(The 8px gap is cosmetic; `placeFloating` sets `position/left/top`. If the gap fights the fixed positioning, drop `margin-left` and add `gap` via the anchor instead — implementer's call; the panels must not visually touch.)

- [ ] **Step 6: Verify (F5) — mouse only**

Run `npm run compile` (expect `Webview built.`), then F5. Open the dragger menu on a paragraph. Confirm in light + dark:
- Hover **Turn into** → flyout opens to the right with the targets + ✨ Using AI; footer reads **esc Back**.
- Hover **Duplicate**/**Delete** → flyout closes; footer reads **esc Close**.
- Click a target → block converts, menu closes.
- Near the right screen edge → flyout flips to the left of the action panel.
- A long list scrolls inside the flyout.
- Click outside / Escape → everything dismisses; no orphaned flyout left on screen.

- [ ] **Step 7: Run the suite + commit**

Run: `npm test` (only `board/grouping` red).

```bash
git add src/webview/blockPicker.ts src/webview/styles/editor.css
git commit -m "feat: Turn-into opens a flyout panel (mouse) instead of drilling down"
```

---

### Task 3: Keyboard navigation across the two panels

Add cross-panel keyboard control: a panel-focus state, `→` to enter the flyout, `←`/`Esc` to leave it, `↑↓` routing to the active panel, `Enter` activating the active panel's highlighted row.

**Files:**
- Modify: `src/webview/blockPicker.ts` (the `input` keydown handler + a `panel` state)

**Interfaces:**
- Consumes: `openFlyout(rowEl)`, `closeFlyout()`, `isFlyoutOpen()`, `flyoutRows`, `flyoutIdx`, `updateFlyoutActive()`, `activeRows`, `activeIdx`, `updateActive()` (Task 2).
- Produces: a `flyoutFocused` boolean controlling which panel `↑↓`/Enter drive.

- [ ] **Step 1: Add the panel-focus flag**

Near the other picker state ([:580](src/webview/blockPicker.ts#L580)), add:

```typescript
  let flyoutFocused = false;   // true → ↑↓/Enter drive the flyout, not the action list
```

Reset it to `false` in `closeFlyout()` (Task 2) and `resetState()`.

- [ ] **Step 2: Rewrite the keydown handler for the action-menu case**

Replace the keydown handler body ([:988-1019](src/webview/blockPicker.ts#L988-L1019)) so that, when `actionMode`:

```typescript
  input.addEventListener('keydown', e => {
    if (actionMode) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (flyoutFocused) { flyoutIdx = Math.min(flyoutIdx + 1, flyoutRows.length - 1); updateFlyoutActive(); }
        else { activeIdx = Math.min(activeIdx + 1, activeRows.length - 1); updateActive(); syncFlyoutToHighlight(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (flyoutFocused) { flyoutIdx = Math.max(flyoutIdx - 1, 0); updateFlyoutActive(); }
        else { activeIdx = Math.max(activeIdx - 1, 0); updateActive(); syncFlyoutToHighlight(); }
      } else if (e.key === 'ArrowRight') {
        const row = list.querySelector<HTMLElement>('[data-turn-into="1"]');
        if (!flyoutFocused && row && activeRows[activeIdx] === undefined ? false : row && isTurnIntoHighlighted()) {
          e.preventDefault(); openFlyout(row); flyoutFocused = true; flyoutIdx = 0; updateFlyoutActive();
        }
      } else if (e.key === 'ArrowLeft') {
        if (flyoutFocused) { e.preventDefault(); flyoutFocused = false; closeFlyout(); input.focus(); updateActive(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (flyoutFocused) flyoutRows[flyoutIdx]?.();
        else activeRows[activeIdx]?.();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (flyoutFocused) { flyoutFocused = false; closeFlyout(); input.focus(); updateActive(); }
        else close();
      }
      return;
    }
    // ---- insert-menu (non-action) case: unchanged from today ----
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, filtered.length - 1); updateActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0); updateActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIdx]) select(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      if (drillParent) {
        e.preventDefault();
        drillParent = null; input.placeholder = 'Filter blocks…'; input.value = '';
        filtered = BLOCK_DEFS; renderList(filtered); input.focus();
      } else { close(); }
    }
  });
```

- [ ] **Step 3: Add the two small helpers used above**

```typescript
  // Is the action highlight currently on the Turn-into row?
  function isTurnIntoHighlighted(): boolean {
    const rows = list.querySelectorAll<HTMLElement>('.block-picker-item');
    return rows[activeIdx]?.dataset.turnInto === '1';
  }
  // When arrowing the action list, open the flyout as Turn-into gains the
  // highlight and close it as the highlight leaves (mirrors hover).
  function syncFlyoutToHighlight(): void {
    const row = list.querySelector<HTMLElement>('[data-turn-into="1"]');
    if (isTurnIntoHighlighted() && row) openFlyout(row);
    else closeFlyout();
  }
```

Simplify the `ArrowRight` guard in Step 2 to use the helper (replace the messy ternary):

```typescript
      } else if (e.key === 'ArrowRight') {
        const row = list.querySelector<HTMLElement>('[data-turn-into="1"]');
        if (!flyoutFocused && isTurnIntoHighlighted() && row) {
          e.preventDefault(); openFlyout(row); flyoutFocused = true; flyoutIdx = 0; updateFlyoutActive();
        }
      }
```

- [ ] **Step 4: Verify (F5) — keyboard**

`npm run compile` → `Webview built.`, then F5. Open the dragger menu (click the ⠿). Without the mouse:
- `↓`/`↑` move through Turn into / Duplicate / Delete; the flyout opens automatically when the highlight is on **Turn into** and closes when it leaves; footer flips **Back**/**Close** to match.
- On Turn into, `→` moves focus into the flyout (its first row highlights); `↑↓` now move within targets; `Enter` converts; `←` or `Esc` returns to the action list (flyout closes).
- `Enter` on Duplicate/Delete still runs them; `Esc` from the action list closes the menu.
- Typing still collapses to the flat filtered list and arrows/Enter work there.

- [ ] **Step 5: Run the suite + commit**

Run: `npm test` (only `board/grouping` red).

```bash
git add src/webview/blockPicker.ts
git commit -m "feat: keyboard nav across the action menu and Turn-into flyout"
```

---

## After all tasks

- [ ] **Docs before push** (project rule): add a CHANGELOG entry (Changed) describing the flyout; update the README's dragger/Turn-into description if it implies a drill-down. Do this before the merge/push.

## Self-Review (completed during planning)

- **Spec coverage:** flyout reveal model (T2 hover + T3 keyboard) ✓; Turn into stays one button with caret (T2) ✓; targets + ✨ Using AI from today's list (T1 helper, T2 render) ✓; typing collapses to flat list (T2 Step 4) ✓; footer verb flips to Back (T2 openFlyout/closeFlyout) ✓; right-placement + left-flip + cap/scroll via placeFloating child popover (T2 Step 1) ✓; `→`/`←`/`↑↓`/Enter/Esc (T3) ✓; click-Turn-into opens+focuses flyout (T2 runAction opens; T3 Enter/→ focus) ✓; drill-down removed (T2 Step 4) ✓; dragger-only scope, no new actions (global constraints) ✓; insert menu untouched (T3 keeps the non-action branch) ✓.
- **Placeholder scan:** none — code given for every code step; the one implementer's-discretion note (flyout gap) has a concrete default.
- **Type consistency:** `turnIntoFlyoutItems(defs) → { targets: BlockDef[]; aiItems: AiTransform[] }` consistent across T1 definition/test and T2 consumption; `openFlyout(rowEl)`, `closeFlyout()`, `isFlyoutOpen()`, `flyoutRows`, `flyoutIdx`, `updateFlyoutActive()`, `flyoutFocused`, `isTurnIntoHighlighted()`, `syncFlyoutToHighlight()` named identically in T2 and T3; reuses `footVerb`/`footerCloseVerb` from c43 verbatim.
