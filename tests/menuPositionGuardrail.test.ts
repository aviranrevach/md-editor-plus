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
