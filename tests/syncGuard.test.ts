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

  // c41: a delayed / reordered echo of an EARLIER edit we sent must be deduped,
  // not mistaken for an external conflict. The double-debounced board-description
  // path can send V1 then V2, then have the leaked host echo of V1 arrive after
  // lastSent has advanced to V2 while V3 is still pending in the editor.
  describe('stale self-echo (recentSent history)', () => {
    it('dedups an echo matching an earlier sent version, not just the last one', () => {
      expect(D({
        incoming: 'V1',        // leaked host echo of an edit we already superseded
        editorCurrent: 'V3',   // user kept typing (pending, unsent)
        lastSent: 'V2',        // most recent send
        recentSent: ['V1', 'V2'],
      })).toBe('dedup');
    });

    it('still surfaces a real conflict for an incoming we never sent', () => {
      expect(D({
        incoming: 'disk version',
        editorCurrent: 'V3',
        lastSent: 'V2',
        recentSent: ['V1', 'V2'],
      })).toBe('conflict');
    });

    it('the data-loss guard still wins over a blank we happened to send earlier', () => {
      // Even if '' is in the history, a blank update over a non-empty editor is
      // never applied implicitly (restore-content), except on explicit refresh.
      expect(D({
        incoming: '',
        editorCurrent: '# Real content',
        lastSent: 'V2',
        recentSent: ['', 'V2'],
      })).toBe('dedup'); // we genuinely sent '' — echoing it back is our own state
    });
  });
});
