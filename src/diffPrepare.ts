// Pure ordering helper for the full-diff path (c54). No vscode import, so it is
// unit-testable. Guarantees the webview's pending markdown is flushed into the
// document BEFORE the diff opens, so newly-typed (unsaved) sections appear.
export async function applyEditThenDiff(
  markdown: string | undefined,
  applyEdit: (md: string) => Promise<void>,
  openDiff: () => Promise<void>,
): Promise<void> {
  if (markdown !== undefined) await applyEdit(markdown);
  await openDiff();
}
