# Visual-Edit Init Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three first-paint issues in the mermaid visual editor — canvas-sizing race, dot-grid spacing miscalibration, and low-contrast node fills — that affect every pinned mermaid block but were surfaced acutely by the `/whiteboard` slash entry.

**Architecture:** Three surgical patches in two files. Theme tweak in `mermaidRenderer.ts`. Helper + two call-site updates + rAF wrap of initial canvas init in `mermaidVisualEditDom.ts`. Each fix ships as its own commit. Test where unit-testable (helper, theme values); manual smoke for the rest.

**Tech Stack:** TypeScript, mermaid v11, jest (`testEnvironment` node by default, per-file jsdom pragma when DOM is needed).

**Spec:** [docs/superpowers/specs/2026-05-25-visual-edit-init-polish-design.md](docs/superpowers/specs/2026-05-25-visual-edit-init-polish-design.md)

---

## Task 1: Fix 3 — theme contrast (TDD)

Bump the `light` theme's node fill from `#eef2ff` to `#dbeafe` so flowchart nodes pop against the visual-edit backdrop and against white-background previews. Export `THEME_VARS` so the test can import it.

**Files:**
- Modify: `src/webview/mermaidRenderer.ts` — add `export` to `THEME_VARS`, change two values in the `light` entry
- Create: `tests/mermaid/theme-vars.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `tests/mermaid/theme-vars.test.ts`:

```ts
// Locks in the light-theme node fill values so casual edits can't
// silently revert the contrast fix. Other theme variables are
// intentionally not asserted — this test is single-purpose.

import { THEME_VARS } from '../../src/webview/mermaidRenderer';

describe('THEME_VARS.light node fills', () => {
  it('primaryColor is #dbeafe', () => {
    expect(THEME_VARS.light.primaryColor).toBe('#dbeafe');
  });

  it('mainBkg is #dbeafe', () => {
    expect(THEME_VARS.light.mainBkg).toBe('#dbeafe');
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

```
npm test -- theme-vars
```

Expected: `Module '"../../src/webview/mermaidRenderer"' has no exported member 'THEME_VARS'`.

- [ ] **Step 1.3: Export `THEME_VARS` and change the two values**

In [src/webview/mermaidRenderer.ts](src/webview/mermaidRenderer.ts):

1. Find the line `const THEME_VARS: Record<DiagramTheme, ThemeVarSet> = {` (around line 33). Change `const` to `export const`:

```ts
export const THEME_VARS: Record<DiagramTheme, ThemeVarSet> = {
```

2. Inside the `light` entry (around lines 34–47), change both occurrences of `'#eef2ff'`:

```ts
  light: {
    background:       '#ffffff',
    primaryColor:     '#dbeafe',
    primaryTextColor: '#1a1a1a',
    primaryBorderColor: '#6366f1',
    secondaryColor:   '#ecfeff',
    tertiaryColor:    '#f0fdf4',
    lineColor:        '#4b5563',
    textColor:        '#1a1a1a',
    mainBkg:          '#dbeafe',
    clusterBkg:       '#f5f5f7',
    noteBkgColor:     '#fff8c5',
    noteTextColor:    '#9a6700',
  },
```

Leave `dark`, `claude`, `sepia` entries unchanged.

- [ ] **Step 1.4: Run the test to verify it passes**

```
npm test -- theme-vars
```

Expected: 2 passing.

- [ ] **Step 1.5: Run the full test suite to confirm no regressions**

```
npm test
```

Expected: full suite passes. Pre-existing toggle.test.ts suite-load failure (unrelated TS errors in `toggle.ts` / `sourceBubbleMenu.ts`) is acceptable.

- [ ] **Step 1.6: Commit**

```bash
git add src/webview/mermaidRenderer.ts tests/mermaid/theme-vars.test.ts
git commit -m "feat(mermaid): bump light theme node fill to #dbeafe — better contrast with visual-edit backdrop and white previews"
```

---

## Task 2: Fix 2 — dot-grid spacing (TDD)

Add a `naturalSvgScale(host)` helper that returns the SVG's natural viewBox-to-host ratio, and pass that ratio (multiplied by viewport zoom where applicable) to `gridSpacingForScale`. Affects two call sites.

**Files:**
- Modify: `src/webview/mermaidVisualEditDom.ts` — add `naturalSvgScale` helper near the existing grid helpers; update one line in `installDotGrid`; update one line in `applyViewport`
- Create: `tests/mermaid/dot-grid-scale.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `tests/mermaid/dot-grid-scale.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
// Tests for naturalSvgScale — the helper that translates between
// SVG user units and on-screen pixels for dot-grid sizing.

import { naturalSvgScale } from '../../src/webview/mermaidVisualEditDom';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Builds the same DOM shape installDotGrid sees in production:
// outer .mb-preview > .mb-svg-host > <svg>.
function makePreviewWithSvg(opts: {
  viewBox?: string;
  hostWidth?: number;
} = {}): HTMLElement {
  const preview = document.createElement('div');
  preview.className = 'mb-preview';
  if (opts.viewBox !== undefined) {
    const svgHost = document.createElement('div');
    svgHost.className = 'mb-svg-host';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', opts.viewBox);
    if (opts.hostWidth !== undefined) {
      // jsdom returns zero from getBoundingClientRect by default. Override
      // so the helper can read a non-zero host width.
      Object.defineProperty(svg, 'getBoundingClientRect', {
        value: () => ({
          width: opts.hostWidth, height: 0,
          x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0,
          toJSON: () => ({}),
        }),
      });
    }
    svgHost.appendChild(svg);
    preview.appendChild(svgHost);
  }
  return preview;
}

describe('naturalSvgScale', () => {
  it('returns 1 when no SVG is present in the host', () => {
    const host = document.createElement('div');
    expect(naturalSvgScale(host)).toBe(1);
  });

  it('returns 1 when the SVG has zero-width viewBox', () => {
    const host = makePreviewWithSvg({ viewBox: '0 0 0 100', hostWidth: 400 });
    expect(naturalSvgScale(host)).toBe(1);
  });

  it('returns hostWidth / vbWidth for a wide viewBox (host=400, vb=100 → 4)', () => {
    const host = makePreviewWithSvg({ viewBox: '0 0 100 100', hostWidth: 400 });
    expect(naturalSvgScale(host)).toBe(4);
  });

  it('returns hostWidth / vbWidth for a narrow viewBox (host=100, vb=400 → 0.25)', () => {
    const host = makePreviewWithSvg({ viewBox: '0 0 400 100', hostWidth: 100 });
    expect(naturalSvgScale(host)).toBe(0.25);
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

```
npm test -- dot-grid-scale
```

Expected: `Module '"../../src/webview/mermaidVisualEditDom"' has no exported member 'naturalSvgScale'`.

- [ ] **Step 2.3: Add the `naturalSvgScale` helper**

In [src/webview/mermaidVisualEditDom.ts](src/webview/mermaidVisualEditDom.ts), find the block of `DOT_GRID_*` constants (around line 3361–3364). Just before `function gridSpacingForScale` (around line 3366), add the new exported helper:

```ts
/** Returns the SVG's natural user-units → screen-pixels ratio so the
    dot grid can be sized to a consistent on-screen density. Returns 1
    as a safe fallback when the SVG isn't ready yet. Callers pass the
    outer .mb-preview host; the helper drills into .mb-svg-host > svg. */
export function naturalSvgScale(host: HTMLElement): number {
  const svg = host.querySelector<SVGSVGElement>('.mb-svg-host svg');
  if (!svg) return 1;
  const vb = svg.viewBox?.baseVal;
  const hostWidth = svg.getBoundingClientRect().width;
  if (!vb || vb.width <= 0 || hostWidth <= 0) return 1;
  return hostWidth / vb.width;
}
```

- [ ] **Step 2.4: Update the `installDotGrid` call site**

In the same file, find `installDotGrid` (around line 3374). Around line 3395 there's:

```ts
const spacing = gridSpacingForScale(1);
```

Change to:

```ts
const spacing = gridSpacingForScale(naturalSvgScale(host));
```

- [ ] **Step 2.5: Update the `applyViewport` call site**

In the same file, find `applyViewport` (around line 145). Around line 153 there's:

```ts
updateDotGrid(opts.previewPane, viewport.scale);
```

Change to:

```ts
updateDotGrid(opts.previewPane, viewport.scale * naturalSvgScale(opts.previewPane));
```

- [ ] **Step 2.6: Run the test to verify it passes**

```
npm test -- dot-grid-scale
```

Expected: 4 passing.

- [ ] **Step 2.7: Compile-check + full suite**

```
npx tsc -p tsconfig.webview.json --noEmit
npm test
```

Expected: no NEW TypeScript errors (pre-existing toggle.ts / sourceBubbleMenu.ts errors are acceptable). All tests pass.

- [ ] **Step 2.8: Commit**

```bash
git add src/webview/mermaidVisualEditDom.ts tests/mermaid/dot-grid-scale.test.ts
git commit -m "fix(mermaid): dot-grid spacing now scales with the SVG's natural viewBox-to-host ratio — first-paint dots match the post-zoom density instead of being ~4× too coarse"
```

---

## Task 3: Fix 1 — canvas-sizing race (no new tests — covered by manual smoke)

Wrap the initial `fitSvgViewBoxToNodes` + `installDotGrid` + lock capture inside `createVisualEditor` in a single `requestAnimationFrame`. Add a `destroyed` flag so a rapid Esc within the rAF window doesn't initialize a torn-down block.

**Files:**
- Modify: `src/webview/mermaidVisualEditDom.ts` — wrap lines 1958–1968 in `requestAnimationFrame`; add `destroyed` flag at the same scope; set `destroyed = true` as the first line inside the existing `destroy()` at line 2075

- [ ] **Step 3.1: Add the `destroyed` flag and wrap the initial init in rAF**

In [src/webview/mermaidVisualEditDom.ts](src/webview/mermaidVisualEditDom.ts), locate the block at lines 1955–1968 (the "Initial layout" + lock capture section). The existing code:

```ts
  // Initial layout: expand the SVG to fill the preview pane so users have
  // free canvas around the diagram for dropping new nodes. This runs BEFORE
  // the viewport gets locked, so the SVG has time to size itself once.
  fitSvgViewBoxToNodes(opts.previewPane);
  installDotGrid(opts.previewPane);
  // Capture the viewBox we just settled on — this is what "locked" means.
  // Every subsequent mermaid re-render will get its viewBox stamped back to
  // this value, so structural mutations (adding nodes/edges/stickies) don't
  // cause mermaid's auto-layout to zoom or pan the canvas.
  let lockedViewBox: string | null = null;
  const initialSvg = opts.previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
  if (initialSvg) lockedViewBox = initialSvg.getAttribute('viewBox');
  opts.block.dataset.mbViewportLocked = 'true';
  toolbar.setViewportLocked(true);
```

Replace with:

```ts
  // Initial layout deferred one animation frame so the .mb-visual-active
  // class added at the top of createVisualEditor has applied to layout —
  // otherwise preview.getBoundingClientRect() inside fitSvgViewBoxToNodes
  // returns stale (often zero) dimensions and the captured lockedViewBox
  // is wrong forever. A `destroyed` flag guards against a torn-down block
  // (rapid Esc within ~16ms).
  let destroyed = false;
  let lockedViewBox: string | null = null;
  requestAnimationFrame(() => {
    if (destroyed) return;
    fitSvgViewBoxToNodes(opts.previewPane);
    installDotGrid(opts.previewPane);
    const initialSvg = opts.previewPane.querySelector<SVGSVGElement>('.mb-svg-host svg');
    if (initialSvg) lockedViewBox = initialSvg.getAttribute('viewBox');
    opts.block.dataset.mbViewportLocked = 'true';
    toolbar.setViewportLocked(true);
  });
```

`lockedViewBox` stays declared at the outer scope so `restoreLockedViewBox` (at line 1970) can read it; it remains `null` until the rAF fires, and `restoreLockedViewBox` already early-returns on falsy `lockedViewBox`.

- [ ] **Step 3.2: Set `destroyed = true` inside `destroy()`**

In the same file, find the `destroy()` method at line 2075 (it starts with `destroy(): void {` and is the destroy method of the returned `VisualEditorHandle`). Add `destroyed = true;` as the FIRST line inside the function body:

```ts
    destroy(): void {
      destroyed = true;
      opts.block.classList.remove('mb-visual-active');
      delete opts.block.dataset.mbViewportLocked;
      // ... rest unchanged
```

- [ ] **Step 3.3: Compile-check**

```
npx tsc -p tsconfig.webview.json --noEmit
```

Expected: no NEW TypeScript errors.

- [ ] **Step 3.4: Run the full test suite**

```
npm test
```

Expected: all tests pass. No new tests in this task; existing visual-edit AST tests don't exercise the createVisualEditor mount path, so they keep passing.

- [ ] **Step 3.5: Commit**

```bash
git add src/webview/mermaidVisualEditDom.ts
git commit -m "fix(mermaid): defer initial canvas-sizing in createVisualEditor by one rAF — closes the layout race where lockedViewBox captured stale dimensions before .mb-visual-active was reflected in layout"
```

---

## Task 4: Build + full verification (manual smoke = user)

Locks down that the three commits compose correctly. The manual-smoke checks come from the spec's "Manual verification" section and need a VS Code GUI — they're listed here so the user can run them after the implementer finishes.

**Files:** none (verification only)

- [ ] **Step 4.1: Type-check + bundle**

```
npm run compile
```

Expected: exits 0. The script runs `tsc -p tsconfig.json` (extension host) and `esbuild` (webview). The webview-only TS errors in `toggle.ts` / `sourceBubbleMenu.ts` predate this work and don't block the bundle.

- [ ] **Step 4.2: Full test suite**

```
npm test
```

Expected: all tests pass, including:
- Task 1's 2 new tests in `theme-vars.test.ts`
- Task 2's 4 new tests in `dot-grid-scale.test.ts`
- All pre-existing tests

The pre-existing `toggle.test.ts` suite-load failure is acceptable.

- [ ] **Step 4.3: Hand off to user for manual smoke**

Stop here. Report the three commits' SHAs to the controller and request the user run the 7 manual checks from the spec:

1. Fresh `/whiteboard` insert — all 3 nodes visible with margin, dots at ~20px, nodes pop against backdrop.
2. Drag `Done` 200px right — stays visible, no clipping.
3. Zoom in (+ control) — dots maintain consistent density.
4. Zoom out (− control) — same.
5. Existing diagrams in `demo.md` / `mermaid-test.md` — render with new blue fills.
6. Existing pinned-position non-whiteboard diagrams (if any) — fill the pane on first open of visual mode.
7. Rapid Esc within ~50ms of inserting a whiteboard — clean exit, no console errors.

Do NOT push or open a PR. Wait for user direction.
