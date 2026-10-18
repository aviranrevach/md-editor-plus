import type { BlockDef } from '../src/webview/blockPicker';
import { convertibleTargets, searchBlockActions, BLOCK_ACTIONS, turnIntoFlyoutItems } from '../src/webview/blockActions';
import { BLOCK_DEFS } from '../src/webview/blockPicker';
import { AI_TRANSFORMS } from '../src/webview/aiTransforms';

const noop = () => {};
const DEFS: BlockDef[] = [
  { id: 'paragraph', label: 'Paragraph', description: 'Plain text', iconHtml: '', section: 'text',
    insert: noop, convert: noop },
  { id: 'heading1', label: 'Heading 1', description: 'Big heading', iconHtml: '', section: 'text',
    aliases: ['h1', 'title'], insert: noop, convert: noop },
  { id: 'callout', label: 'Callout', description: 'Highlighted box', iconHtml: '', section: 'media',
    subItems: [
      { id: 'callout-note', label: 'Note', description: 'Info', iconHtml: '', section: 'media', convert: noop },
      { id: 'callout-warning', label: 'Warning', description: 'Heads-up', iconHtml: '', section: 'media', convert: noop },
    ] },
  { id: 'toggle', label: 'Toggle', description: 'Collapsible', iconHtml: '', section: 'media', insert: noop },
];

describe('convertibleTargets', () => {
  it('flattens callout sub-items and excludes defs without convert', () => {
    const ids = convertibleTargets(DEFS).map(t => t.id);
    expect(ids).toEqual(['paragraph', 'heading1', 'callout-note', 'callout-warning']);
    expect(ids).not.toContain('toggle');
    expect(ids).not.toContain('callout');
  });
});

describe('searchBlockActions', () => {
  it('empty query returns all three actions and no flat targets', () => {
    const r = searchBlockActions('', DEFS);
    expect(r.actions).toEqual(BLOCK_ACTIONS);
    expect(r.targets).toEqual([]);
  });

  it('"dup" matches the Duplicate action only', () => {
    const r = searchBlockActions('dup', DEFS);
    expect(r.actions.map(a => a.id)).toEqual(['duplicate']);
    expect(r.targets).toEqual([]);
  });

  it('"h1" surfaces the Heading 1 target via alias, no actions', () => {
    const r = searchBlockActions('h1', DEFS);
    expect(r.actions).toEqual([]);
    expect(r.targets.map(t => t.id)).toEqual(['heading1']);
  });

  it('"warning" surfaces the flattened warning callout target', () => {
    const r = searchBlockActions('warning', DEFS);
    expect(r.targets.map(t => t.id)).toEqual(['callout-warning']);
  });

  it('"delete" matches the Delete action', () => {
    const r = searchBlockActions('delete', DEFS);
    expect(r.actions.map(a => a.id)).toEqual(['delete']);
  });
});

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
