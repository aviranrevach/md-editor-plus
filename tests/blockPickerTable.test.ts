import { BLOCK_DEFS, filterBlocks } from '../src/webview/blockPicker';
import { convertibleTargets } from '../src/webview/blockActions';
import { AI_TRANSFORMS } from '../src/webview/aiTransforms';

describe('plain table block', () => {
  it('exists as its own block distinct from Board: Table', () => {
    const ids = BLOCK_DEFS.map(b => b.id);
    expect(ids).toContain('table');
    expect(ids).toContain('board-table');
  });

  it('lives in the "lists" section, alongside the board blocks', () => {
    const table = BLOCK_DEFS.find(b => b.id === 'table');
    expect(table?.section).toBe('lists');
  });

  it('surfaces both plain and board table when searching "table"', () => {
    const hits = filterBlocks('table').map(b => b.id);
    expect(hits).toContain('table');
    expect(hits).toContain('board-table');
  });

  it('is a convertible Turn-into target', () => {
    expect(convertibleTargets(BLOCK_DEFS).some(t => t.id === 'table')).toBe(true);
  });
});

describe('Turn-into "Using AI" section', () => {
  // The dragger Turn-into hides AI targets that already have a deterministic
  // converter, so Table / Board: Table are not offered twice (the AI duplicate
  // routed through the example-seeded prompt and produced a nonsensical board).
  const deterministicIds = new Set(convertibleTargets(BLOCK_DEFS).map(t => t.id));
  const aiOnly = AI_TRANSFORMS.filter(t => !deterministicIds.has(t.id)).map(t => t.id);

  it('drops AI duplicates of deterministic converters', () => {
    expect(aiOnly).not.toContain('table');
    expect(aiOnly).not.toContain('board-table');
  });

  it('keeps the AI-only transforms', () => {
    expect(aiOnly).toEqual(
      expect.arrayContaining(['ask', 'kanban', 'mermaid', 'summary', 'action-items', 'outline', 'timeline']),
    );
  });
});
