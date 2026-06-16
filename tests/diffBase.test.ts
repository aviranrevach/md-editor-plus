import { resolveDiffBase } from '../src/diffBase';

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
