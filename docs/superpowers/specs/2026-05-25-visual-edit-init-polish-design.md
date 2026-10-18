# Visual-edit init polish — design

Three surgical fixes to the mermaid visual editor's first-paint
behavior. None of them are whiteboard-specific — they affect every
pinned mermaid block that opens in visual mode — but they were
surfaced acutely by the new `/whiteboard` slash-menu entry.

## Why

After the `/whiteboard` insert ships, the visual editor opens
immediately on a freshly inserted block. Three rough edges become
glaringly obvious in that flow:

1. **Square canvas, content cropped at the right.** The visual
   editor's initial `fitSvgViewBoxToNodes` reads
   `preview.getBoundingClientRect()` before the browser has done a
   layout pass that includes the `.mb-visual-active` class
   (`min-height: 560px`). The pane reports stale dimensions; the
   aspect-ratio expansion math computes a too-narrow viewBox; that
   wrong viewBox gets stamped as `lockedViewBox` forever. Symptoms:
   square canvas in a wide pane, third node falls off the right
   edge, dragging a node past the edge clips it.

2. **Huge dots on first paint.** `installDotGrid` calls
   `gridSpacingForScale(1)`, where the `1` should mean "1 SVG user
   unit per 1 screen pixel." But mermaid sets a viewBox that's
   typically much smaller than the host (e.g., a 400-unit viewBox
   in a 1700-pixel pane → 1 SVG unit = ~4.25 screen pixels). So
   the function returns a spacing of 16 SVG units expecting that
   to be ~22 screen pixels, when the actual on-screen spacing is
   ~68 px. The dots only look right once the user zooms.

3. **Low-contrast node fills.** The `light` theme's
   `primaryColor` and `mainBkg` are both `#eef2ff` (Tailwind
   `indigo-50`). That's so close to the visual-edit backdrop
   `#f6f7f9` that the nodes don't visually pop. Reads as
   "see-through" even though the fill is fully opaque.

These are pre-existing issues in the visual edit subsystem. They
just had nowhere acute to land until `/whiteboard` made
"insert a block and immediately edit visually" a one-click flow.

## What ships

Three fixes, three commits, single spec. No new abstractions, no
new files in production code, no schema changes.

### Fix 1 — Canvas-sizing race

Wrap the initial `fitSvgViewBoxToNodes` + `installDotGrid` + lock
capture in `createVisualEditor` in a single `requestAnimationFrame`
so the browser does a layout pass first. Also add a `destroyed`
flag so rapid Esc within the rAF window doesn't initialize a
torn-down block.

Before (`mermaidVisualEditDom.ts:1958-1968`):

```ts
fitSvgViewBoxToNodes(opts.previewPane);
installDotGrid(opts.previewPane);
let lockedViewBox: string | null = null;
const initialSvg = opts.previewPane.querySelector<SVGSVGElement>(
  '.mb-svg-host svg',
);
if (initialSvg) lockedViewBox = initialSvg.getAttribute('viewBox');
opts.block.dataset.mbViewportLocked = 'true';
toolbar.setViewportLocked(true);
```

After:

```ts
let destroyed = false;
let lockedViewBox: string | null = null;
requestAnimationFrame(() => {
  if (destroyed) return;
  fitSvgViewBoxToNodes(opts.previewPane);
  installDotGrid(opts.previewPane);
  const initialSvg = opts.previewPane.querySelector<SVGSVGElement>(
    '.mb-svg-host svg',
  );
  if (initialSvg) lockedViewBox = initialSvg.getAttribute('viewBox');
  opts.block.dataset.mbViewportLocked = 'true';
  toolbar.setViewportLocked(true);
});
```

And in `destroy()` (existing function near the end of
`createVisualEditor`):

```ts
destroyed = true;
```

**Why a single rAF is sufficient.** rAF callbacks fire right
before paint, which means the browser has already done style
recalc + layout for any DOM changes queued before the rAF. Adding
the `.mb-visual-active` class happens synchronously at the top of
`createVisualEditor`; one rAF later, layout reflects that class.

**Gap behavior.** Between `createVisualEditor` returning and the
rAF firing (≤16ms):
- `viewportLocked` and the `mbViewportLocked` data attribute
  remain unset. `restoreLockedViewBox` early-returns on falsy
  `lockedViewBox`, doing nothing.
- `applyPositionsOverlay` at `mermaidVisualEditDom.ts:3771` runs
  its own `fitSvgViewBoxToNodes` when unlocked — duplicating our
  intended work harmlessly; the second pass inside the rAF only
  improves on it.
- No other call site reacts to the data attribute synchronously
  after `createVisualEditor` returns.

### Fix 2 — Dot-grid spacing

Compute the SVG's natural viewBox-to-host scale and multiply it
into the value passed to `gridSpacingForScale`. Affects two call
sites: initial install in `installDotGrid`, and zoom updates in
`applyViewport`.

Add a helper near the other grid helpers (around line 3370):

```ts
function naturalSvgScale(host: HTMLElement): number {
  const svg = host.querySelector<SVGSVGElement>('.mb-svg-host svg');
  if (!svg) return 1;
  const vb = svg.viewBox?.baseVal;
  const hostWidth = svg.getBoundingClientRect().width;
  if (!vb || vb.width <= 0 || hostWidth <= 0) return 1;
  return hostWidth / vb.width;
}
```

Call-site 1 — `installDotGrid` (line 3395):

```ts
// Before
const spacing = gridSpacingForScale(1);
// After
const spacing = gridSpacingForScale(naturalSvgScale(host));
```

Call-site 2 — `applyViewport` (line 153):

```ts
// Before
updateDotGrid(opts.previewPane, viewport.scale);
// After
updateDotGrid(
  opts.previewPane,
  viewport.scale * naturalSvgScale(opts.previewPane),
);
```

The `gridSpacingForScale` function itself is unchanged. Its
contract — "given the SVG-units-to-screen-pixels ratio, pick a
spacing that yields ~22 screen pixels between dots" — was
correct; the callers just weren't passing the right ratio.

**Cost.** `naturalSvgScale` calls `getBoundingClientRect`, which
forces a synchronous layout. Inside `installDotGrid` it runs once
during the rAF from Fix 1 (layout is happening anyway). Inside
`applyViewport` it runs once per zoom event — not a hot path.

### Fix 3 — Theme contrast

Bump the `light` theme's node fill from Tailwind `indigo-50`
(`#eef2ff`) to Tailwind `blue-100` (`#dbeafe`). Single line each
for two variables in `mermaidRenderer.ts:33-47`:

```ts
// Before
primaryColor: '#eef2ff',
mainBkg:      '#eef2ff',
// After
primaryColor: '#dbeafe',
mainBkg:      '#dbeafe',
```

**Why `#dbeafe`:**
- Tailwind `blue-100` — one shade more saturated than the current
  `indigo-50`, still well below the visually-aggressive `blue-200`.
- Pairs with the existing `#6366f1` indigo border (Tailwind blue
  and indigo families share enough hue to read as cohesive).
- Contrast with the visual-edit backdrop `#f6f7f9` jumps from
  ~1.02:1 luminance ratio to ~1.15:1 — nodes pop without becoming
  loud.
- Text contrast: `#1a1a1a` on `#dbeafe` ≈ 13:1, still WCAG AAA.

**What stays the same:**
- All other `light` theme variables (border, line, secondary,
  tertiary, cluster, note colors).
- The `dark`, `claude`, and `sepia` themes. Each already has
  enough fill-vs-background contrast.
- Sticky notes (hard-coded yellow `#fef6a9` in the visual
  editor's own icon and rendering), edges (`lineColor`),
  subgraph clusters (`clusterBkg`), mermaid note callouts
  (`noteBkgColor`).

**Cache invalidation.** The renderer caches SVGs by
`${theme}::${hash(source)}` at `mermaidRenderer.ts:183`. The
in-memory cache lives in a module-scope `Map`, cleared on every
fresh webview load. First paint after the user reloads the
extension re-renders against the new theme — no explicit bust
needed.

**Scope.** Every existing mermaid block in any user's markdown
file will render with the new fill next time they open the file.
That's intentional — the contrast issue exists outside
visual-edit too. Worth being explicit that this isn't
visual-edit-only.

## Files changed

- `src/webview/mermaidVisualEditDom.ts`
  - Wrap initial init in a single rAF + add `destroyed` guard
    (Fix 1)
  - Add `naturalSvgScale` helper, update two call sites
    (Fix 2)
- `src/webview/mermaidRenderer.ts`
  - Export `THEME_VARS` (so the new theme test can import it)
  - Change two values in the `light` entry (Fix 3)
- `tests/mermaid/dot-grid-scale.test.ts` *(new)*
  - 3 tests for `naturalSvgScale`. Jsdom env.
- `tests/mermaid/theme-vars.test.ts` *(new)*
  - 1 test asserting the light theme fills. Node env.

`naturalSvgScale` is exported from `mermaidVisualEditDom.ts` so
the new dot-grid-scale test can import it. Matches the existing
pattern there (`applyPositionsOverlay`, `applyStylesOverlay`,
`applyStandaloneLinesOverlay` are all named exports from the same
file).

## Order of work

Three commits, in this order:

1. **Fix 3 first** (theme). Smallest blast radius, easiest to
   eyeball, gives immediate quality-of-life win on every
   diagram.
2. **Fix 2 second** (dot-grid). Affects only visual-edit, builds
   on Fix 3's verification.
3. **Fix 1 last** (the race). Biggest behavioral change. Doing
   it last means by the time we manual-smoke it, dots are at the
   right density and nodes pop — easier to see whether the
   canvas-sizing fix is working.

## Testing

### `tests/mermaid/dot-grid-scale.test.ts` (new, jsdom env)

Tests the exported `naturalSvgScale` helper:

- Returns `1` when no SVG is present in the host.
- Returns `1` when the SVG has no viewBox or zero-width viewBox
  (covers the defensive early-return).
- Returns `hostWidth / vbWidth` for a normal SVG. Two cases —
  wide viewBox (host=400, vb=100 → 4) and narrow
  (host=100, vb=400 → 0.25). Mock the SVG's `getBoundingClientRect`
  via `Object.defineProperty` since jsdom returns 0 by default.

### `tests/mermaid/theme-vars.test.ts` (new, node env)

Imports the now-exported `THEME_VARS` and asserts the two `light`
values:

```ts
expect(THEME_VARS.light.primaryColor).toBe('#dbeafe');
expect(THEME_VARS.light.mainBkg).toBe('#dbeafe');
```

Locks in the value so a casual edit can't silently revert it. No
broader theme correctness test — the other variables aren't part
of this change.

### What we explicitly don't test

- That `lockedViewBox` matches the rendered SVG's natural viewBox
  after layout. Requires a real browser; jsdom doesn't compute SVG
  bounding boxes properly.
- That dots appear at ~22 px on screen. Same reason.
- That nodes look distinct against the backdrop. Human-eye
  judgment.

Manual verification (below) covers the rest.

## Manual verification

After all three commits land + `npm run compile` + `npm test`:

1. **Fresh whiteboard insert.** Type `/whiteboard`, Enter. All
   three nodes visible with margin on all sides. Dots at ~20 px
   on screen. Node fills clearly distinct from the grey
   backdrop.
2. **Drag a node toward the edge.** Drag `Done` 200 px right.
   Node stays visible; canvas accommodates by expanding the
   viewBox; no clipping.
3. **Zoom in (+ control).** Dots tighten on screen but maintain
   consistent visual density. No sudden discontinuities.
4. **Zoom out (− control).** Dots coarsen, same density rule.
   Lock + restore behave correctly.
5. **Existing diagrams.** Open `demo.md` or `mermaid-test.md`.
   Diagrams render with the new slightly-more-saturated blue
   fills.
6. **Existing pinned-position diagrams.** If a `.md` with a
   non-whiteboard pinned mermaid block exists, open it and
   switch to visual mode — canvas fills the pane on first open.
7. **Rapid Esc.** Insert a whiteboard, press Esc within ~50 ms.
   Visual mode exits cleanly, no console errors. Verifies the
   `destroyed` guard.

If step 1 still shows a square canvas or huge dots, the race
fix didn't land correctly — re-check the rAF wrap in
`createVisualEditor`.

## Out of scope

- Restyling sticky notes, edges, clusters, or mermaid note
  callouts.
- Theme changes for `dark` / `claude` / `sepia`.
- Refactoring `fitSvgViewBoxToNodes` or `gridSpacingForScale`
  themselves. Their contracts are correct; only the callers
  needed fixing.
- Auto-fit on every drag (canvas auto-expand). Drag-out behavior
  improves transitively from Fix 1 because the lock now captures
  a viewBox sized to the pane, not a tight viewBox sized to
  initial content — but full "infinite canvas" feel needs
  separate design.
