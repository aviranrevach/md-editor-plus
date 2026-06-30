import { resolveDiffBase, resolveCurrentSide, diffSidePaths } from '../src/diffBase';

const opts = (over: Record<string, unknown> = {}) =>
  ({ fsPath: '/w/TODO.md', uri: {}, gitApi: null, snapshot: 'SNAP', ...over }) as Parameters<typeof resolveDiffBase>[0];

describe('resolveDiffBase', () => {
  it('uses explicit base verbatim (conflict-banner case)', async () => {
    expect(await resolveDiffBase(opts({ explicitBase: { content: 'DISK', label: 'On disk' } })))
      .toEqual({ content: 'DISK', label: 'On disk' });
  });

  it('returns git HEAD content when repo + show succeed', async () => {
    const gitApi = { getRepository: () => ({ show: async () => 'HEAD CONTENT' }) };
    const r = await resolveDiffBase(opts({ gitApi }));
    expect(r.content).toBe('HEAD CONTENT');
    expect(r.label).toContain('HEAD');
  });

  it('falls back to snapshot when the git extension is absent', async () => {
    expect((await resolveDiffBase(opts({ gitApi: null }))).content).toBe('SNAP');
  });

  it('falls back to snapshot when getRepository returns null', async () => {
    const gitApi = { getRepository: () => null };
    expect((await resolveDiffBase(opts({ gitApi }))).content).toBe('SNAP');
  });

  it('falls back to snapshot (labelled) when show rejects (untracked file)', async () => {
    const gitApi = { getRepository: () => ({ show: async () => { throw new Error('not in HEAD'); } }) };
    const r = await resolveDiffBase(opts({ gitApi }));
    expect(r.content).toBe('SNAP');
    expect(r.label).toBe('when you opened it');
  });
});

describe('diffSidePaths', () => {
  // The custom editor claims these globs; both diff sides MUST avoid them so VS
  // Code renders a text diff instead of two MD Editor Plus webviews (c54).
  const MD_EXT = /\.(md|markdown|mdown|mkd|mdx)$/i;

  it('produces side paths whose basenames do not match any markdown extension', () => {
    const { leftPath, rightPath } = diffSidePaths('demo-tester.md', 'HEAD (last commit)');
    expect(MD_EXT.test(leftPath)).toBe(false);
    expect(MD_EXT.test(rightPath)).toBe(false);
  });

  it('keeps the original filename and label visible for readability', () => {
    const { leftPath, rightPath } = diffSidePaths('notes.markdown', 'when you opened it');
    expect(leftPath).toBe('/notes.markdown (when you opened it)');
    expect(rightPath).toBe('/notes.markdown (current)');
  });

  it('dodges the extension even for awkward filenames', () => {
    const { leftPath, rightPath } = diffSidePaths('a.mdx', 'HEAD (last commit)');
    expect(MD_EXT.test(leftPath)).toBe(false);
    expect(MD_EXT.test(rightPath)).toBe(false);
  });
});

describe('resolveCurrentSide (c56)', () => {
  it('prefers the webview live markdown over the document text', () => {
    expect(resolveCurrentSide('WEBVIEW EDITS', 'DOC TEXT')).toBe('WEBVIEW EDITS');
  });

  it('falls back to the document text when the webview supplied nothing', () => {
    expect(resolveCurrentSide(undefined, 'DOC TEXT')).toBe('DOC TEXT');
  });

  it('treats an empty webview as a valid current state (?? not ||)', () => {
    // The user cleared the doc — the empty buffer must win, not fall through.
    expect(resolveCurrentSide('', 'DOC TEXT')).toBe('');
  });
});
