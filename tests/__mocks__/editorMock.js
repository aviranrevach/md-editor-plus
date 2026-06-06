// Stub for src/webview/editor.ts in Jest — avoids pulling in ESM-only
// lowlight which Jest cannot parse.
module.exports = {
  createEditor: () => ({ setEditable: () => {} }),
  setReadOnly: () => {},
  updateContent: () => {},
  flushPendingEdit: () => {},
  destroyEditor: () => {},
  getCurrentMarkdown: () => '',
  setMediaBaseUri: () => {},
  getFrontmatterInfo: () => ({ lines: 0, kind: 'none' }),
  setFrontmatterChangeListener: () => {},
};
