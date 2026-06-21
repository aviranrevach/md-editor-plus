import { applyEditThenDiff } from '../src/diffPrepare';

describe('applyEditThenDiff', () => {
  it('applies the edit before opening the diff when markdown is provided', async () => {
    const calls: string[] = [];
    const applyEdit = async (md: string) => { calls.push('apply:' + md); };
    const openDiff = async () => { calls.push('open'); };
    await applyEditThenDiff('NEW SECTION', applyEdit, openDiff);
    expect(calls).toEqual(['apply:NEW SECTION', 'open']);
  });

  it('awaits the edit fully before opening (no interleave)', async () => {
    const calls: string[] = [];
    const applyEdit = (md: string) => new Promise<void>((res) => {
      setTimeout(() => { calls.push('apply-done'); res(); }, 5);
    });
    const openDiff = async () => { calls.push('open'); };
    await applyEditThenDiff('x', applyEdit, openDiff);
    expect(calls).toEqual(['apply-done', 'open']);
  });

  it('skips applyEdit and opens directly when markdown is undefined', async () => {
    const calls: string[] = [];
    const applyEdit = async () => { calls.push('apply'); };
    const openDiff = async () => { calls.push('open'); };
    await applyEditThenDiff(undefined, applyEdit, openDiff);
    expect(calls).toEqual(['open']);
  });
});
