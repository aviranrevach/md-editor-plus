// Stub for src/webview/editor.ts in Jest — avoids pulling in ESM-only
// lowlight which Jest cannot parse.
//
// Tracks how many times each editor factory is called so tests can assert
// wiring (e.g. the board side panel must build a DETACHED editor for the
// description body, never the primary `createEditor` — see c37 save-wipe bug).
const calls = { createEditor: 0, createDetachedEditor: 0 };

module.exports = {
  __calls: calls,
  __reset: () => { calls.createEditor = 0; calls.createDetachedEditor = 0; },
  createEditor: () => { calls.createEditor++; return { setEditable: () => {} }; },
  createDetachedEditor: () => {
    calls.createDetachedEditor++;
    return { editor: { setEditable: () => {} }, flush: () => {}, destroy: () => {} };
  },
  setReadOnly: () => {},
  updateContent: () => {},
  flushPendingEdit: () => {},
  destroyEditor: () => {},
  getCurrentMarkdown: () => '',
  setMediaBaseUri: () => {},
  getFrontmatterInfo: () => ({ lines: 0, kind: 'none' }),
  setFrontmatterChangeListener: () => {},
};
