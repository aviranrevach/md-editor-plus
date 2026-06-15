import { decideExternalUpdate } from '../src/webview/syncGuard';

// Guards the data-loss bug: an external 'update' message must never silently
// replace a non-empty editor with empty content. The decision function is the
// pure core of the webview's 'update' handler.
describe('decideExternalUpdate', () => {
  const D = (over: Partial<Parameters<typeof decideExternalUpdate>[0]>) =>
    decideExternalUpdate({
      incoming: '',
      editorCurrent: '',
      lastSent: null,
      isRefresh: false,
      ...over,
    });

  it('dedups the echo of our own last-sent edit', () => {
    expect(D({ incoming: 'hello', editorCurrent: 'hello', lastSent: 'hello' })).toBe('dedup');
  });

  // THE BUG: an empty 'update' arrives right after open (no local edit yet, so
  // lastSent is null). Old behavior applied it → setContent('') wiped the doc.
  it('never applies an empty update over a non-empty editor right after open', () => {
    const decision = D({ incoming: '', editorCurrent: '# Real content', lastSent: null });
    expect(decision).not.toBe('apply');
    expect(decision).toBe('restore-content');
  });

  it('treats a whitespace-only incoming as empty for the guard', () => {
    expect(D({ incoming: '   \n  ', editorCurrent: '# Real content', lastSent: null }))
      .toBe('restore-content');
  });

  it('guards an empty update even after the user has edited (lastSent set)', () => {
    expect(D({ incoming: '', editorCurrent: 'edited body', lastSent: 'edited body' }))
      .toBe('restore-content');
  });

  it('still surfaces a real conflict when local edits differ from a non-empty incoming', () => {
    expect(D({ incoming: 'disk version', editorCurrent: 'my unsaved edits', lastSent: 'older' }))
      .toBe('conflict');
  });

  it('applies a normal non-empty external change when there are no local edits', () => {
    expect(D({ incoming: 'new disk content', editorCurrent: 'old', lastSent: 'old' }))
      .toBe('apply');
  });

  it('lets an explicit user refresh empty the editor (refresh bypasses the guard)', () => {
    expect(D({ incoming: '', editorCurrent: '# Real content', lastSent: null, isRefresh: true }))
      .toBe('apply');
  });

  it('applies an empty update when the editor is already empty (no loss possible)', () => {
    expect(D({ incoming: '', editorCurrent: '', lastSent: null })).toBe('apply');
  });
});
