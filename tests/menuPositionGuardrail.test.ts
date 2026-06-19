import * as fs from 'fs';
import * as path from 'path';

// Files whose floating menus were migrated to placeFloating(): they must NOT
// hand-roll coordinate positioning. (c34 guardrail — replaces an ESLint rule;
// this repo has no ESLint and forbids new deps.)
const MIGRATED = [
  'boardTagsPicker.ts', 'blockPicker.ts', 'boardTableRender.ts',
  'boardKanbanRender.ts', 'boardProperties.ts', 'boardStatusOptions.ts',
  'boardImagePicker.ts', 'calloutMenu.ts', 'boardSidePanel.ts',
  'imageBubbleMenu.ts', 'aiTransformPanel.ts',
  // c34 follow-up C: newly migrated chrome popovers
  'boardChrome.ts', 'boardFilterPanel.ts',
];
// Intentionally NOT scanned (legitimate manual positioning, not viewport menus):
//   menuPosition.ts (the helper), bubbleMenu.ts (Tippy), tooltip.ts & blockHandle.ts
//   (centered tooltips), index.ts (side-flyout submenu with its own clamp),
//   boardDragShared.ts (drag ghost), outlinePanel.ts (rail markers),
//   mermaidVisualEditDom.ts (canvas overlays), codeBlock.ts (drop indicator).
const dir = path.join(__dirname, '..', 'src', 'webview');

describe('menu positioning guardrail (c34)', () => {
  for (const file of MIGRATED) {
    test(`${file} does not hand-roll coordinate positioning`, () => {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      expect(src).not.toMatch(/\.style\.(left|top)\s*=/);
      expect(src).not.toMatch(/window\.scroll[XY]/);
    });
  }

  test('menuPosition.ts exports placeFloating and computePlacement', () => {
    const src = fs.readFileSync(path.join(dir, 'menuPosition.ts'), 'utf8');
    expect(src).toMatch(/export function placeFloating/);
    expect(src).toMatch(/export function computePlacement/);
  });
});

// ---------------------------------------------------------------------------
// CSS-anchored dropdown tripwire (c34 follow-up C)
//
// The anti-pattern: a CSS rule using `top: calc(100% ...)` to pin a dropdown
// below a button.  After c34 migration, only a fixed set of intentional
// subsystem popovers should still use that pattern.  New ad-hoc dropdowns
// must use placeFloating() instead.
// ---------------------------------------------------------------------------

// Intentional subsystem exclusions — do NOT add viewport-clipped menus here.
// Each entry is the full CSS selector as it appears in the stylesheet.
const CSS_ANCHORED_ALLOWLIST = new Set<string>([
  // Bubble-menu sub-panels (imageBubbleMenu.ts / editor.css) — these float
  // inside a Tippy-managed container that is already viewport-clamped; they
  // are owned by the image / text bubble-menu subsystem, not by placeFloating.
  '#img-replace',          // image bubble menu "Replace with" sub-panel
  '.bm-swatch-panel',      // bubble menu swatch / emoji sub-panel

  // Mermaid visual-editor toolbar popups (mermaidVisualEditDom.ts) — the
  // mermaid editor is an entirely separate subsystem with its own canvas
  // coordinate space; placeFloating() does not apply there.
  '.ProseMirror .mb-more-menu',         // mermaid bubble toolbar "More" dropdown
  '.ProseMirror .mb-copy-menu',         // mermaid toolbar copy-format sub-menu
  '.ProseMirror .mb-vCtx-menu',         // mermaid visual-context toolbar popup
  '.ProseMirror .mb-vEdgeCtx2-cappop',  // mermaid edge-context 2 cap popup
  '.ProseMirror .mb-vCtx-colorpop',     // mermaid visual-context color picker
  '.ProseMirror .mb-vCtx-morepop',      // mermaid visual-context "More" popup
  '.ProseMirror .mb-vCtx2 .mb-vCtx-bigpop',   // mermaid vCtx2 large popover
  '.ProseMirror .mb-vCtx2 .mb-vCtx-morepop',  // mermaid vCtx2 "More" popup
]);

/**
 * Scan a CSS string and return every selector whose rule body contains
 * `top: calc(100%`.  Uses simple line-by-line tracking — no CSS parser
 * dependency needed.
 */
function findCssAnchoredSelectors(css: string): string[] {
  const lines = css.split('\n');
  let lastSelector = '';
  const found: string[] = [];

  for (const line of lines) {
    // A selector line: starts with . or # and ends with { (possibly with
    // other content after, but the { signals the block open).
    if (/^\s*[.#][^{]+\{/.test(line)) {
      lastSelector = line.trim().replace(/\s*\{.*/, '').trim();
    }
    if (/top:\s*calc\(100%/.test(line)) {
      found.push(lastSelector);
    }
  }
  return found;
}

describe('CSS-anchored dropdown tripwire (c34)', () => {
  const stylesDir = path.join(__dirname, '..', 'src', 'webview', 'styles');

  test('board.css has no CSS-anchored dropdowns (all migrated to placeFloating)', () => {
    const css = fs.readFileSync(path.join(stylesDir, 'board.css'), 'utf8');
    const found = findCssAnchoredSelectors(css);
    expect(found).toHaveLength(0);
  });

  test('editor.css CSS-anchored dropdowns are all in the intentional allowlist', () => {
    const css = fs.readFileSync(path.join(stylesDir, 'editor.css'), 'utf8');
    const found = findCssAnchoredSelectors(css);

    const unexpected = found.filter(sel => !CSS_ANCHORED_ALLOWLIST.has(sel));
    expect(unexpected).toHaveLength(0);
    // Failure message guidance — Jest will print the `unexpected` array above,
    // but add a descriptive comment here for when the test is read in CI logs:
    // "A new CSS-anchored dropdown was added (top: calc(100%...)). Route it
    // through placeFloating() instead of CSS positioning, or add it to
    // CSS_ANCHORED_ALLOWLIST if it is an intentional subsystem popover."
  });

  test('editor.css CSS-anchored allowlist has no unexpected additions (allowlist integrity)', () => {
    // Verify the allowlist itself hasn't grown beyond what currently exists —
    // this catches someone expanding the allowlist without a review comment.
    const css = fs.readFileSync(path.join(stylesDir, 'editor.css'), 'utf8');
    const found = new Set(findCssAnchoredSelectors(css));
    const allowlistNotInCss = [...CSS_ANCHORED_ALLOWLIST].filter(sel => !found.has(sel));
    expect(allowlistNotInCss).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Chrome popover no-self-position check (c34 follow-up C)
//
// After migration, placeFloating() owns the position of these three panels.
// Their CSS rule bodies must NOT contain top / right / bottom / left offsets
// (they keep visual styling only).  `.settings-panel` may keep `position:
// fixed` — that is intentional — but must not have coordinate offsets.
// ---------------------------------------------------------------------------

/**
 * Extract the first rule body for the given selector from a CSS string.
 * Returns the text between the opening { and matching closing }.
 */
function extractRuleBody(css: string, selector: string): string {
  const lines = css.split('\n');
  let inBlock = false;
  let body = '';
  let depth = 0;

  for (const line of lines) {
    if (!inBlock) {
      const trimmedSelector = line.trim().replace(/\s*\{.*/, '').trim();
      if (trimmedSelector === selector && line.includes('{')) {
        inBlock = true;
        depth = 1;
        body = line + '\n';
        continue;
      }
    } else {
      body += line + '\n';
      depth += (line.match(/\{/g) || []).length;
      depth -= (line.match(/\}/g) || []).length;
      if (depth <= 0) break;
    }
  }
  return body;
}

describe('chrome popover CSS self-position check (c34)', () => {
  // placeFloating() sets top/left at runtime; CSS must not fight it.
  const COORD_PROPS = /(?:^|;|\{)\s*(top|right|bottom|left)\s*:/m;

  test('.bd-more-menu rule body has no coordinate offsets (placeFloating owns it)', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'webview', 'styles', 'board.css'), 'utf8'
    );
    const body = extractRuleBody(css, '.bd-more-menu');
    expect(body).not.toMatch(COORD_PROPS);
  });

  test('.bd-filter-panel rule body has no coordinate offsets (placeFloating owns it)', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'webview', 'styles', 'board.css'), 'utf8'
    );
    const body = extractRuleBody(css, '.bd-filter-panel');
    expect(body).not.toMatch(COORD_PROPS);
  });

  test('.settings-panel rule body has no coordinate offsets (position:fixed is OK; offsets are not)', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'webview', 'styles', 'editor.css'), 'utf8'
    );
    const body = extractRuleBody(css, '.settings-panel');
    // `position: fixed` is intentional — strip it before checking for offsets.
    const bodyWithoutPositionFixed = body.replace(/position\s*:\s*fixed\s*;?/g, '');
    expect(bodyWithoutPositionFixed).not.toMatch(COORD_PROPS);
  });
});
