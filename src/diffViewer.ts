import * as vscode from 'vscode';
import { resolveDiffBase, diffSidePaths, type GitApiLike, type DiffBase } from './diffBase';

const SCHEME = 'md-editor-plus-diff';
// token -> base (left) content. Read-only docs served to vscode.diff's left pane.
const bases = new Map<string, string>();
let seq = 0;

/** Register the read-only content provider that serves the diff's base side. */
export function registerDiffContentProvider(context: vscode.ExtensionContext): void {
  const provider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri) { return bases.get(uri.query) ?? ''; },
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
  );
}

/** Adapt the built-in vscode.git extension's (untyped) API to GitApiLike, or null. */
async function getGitApi(): Promise<GitApiLike | null> {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext) return null;
  try {
    const exports = ext.isActive ? ext.exports : await ext.activate();
    const api = exports?.getAPI?.(1);
    return (api ?? null) as GitApiLike | null;
  } catch {
    return null;
  }
}

/** Resolve the diff base (HEAD → on-disk → snapshot) for a document, for the diff map (c55). */
export async function resolveBaseForDocument(
  document: vscode.TextDocument,
  snapshot: string,
): Promise<DiffBase> {
  const gitApi = await getGitApi();
  return resolveDiffBase({
    fsPath: document.uri.fsPath,
    uri: document.uri,
    gitApi,
    snapshot,
  });
}

/** Open VS Code's native diff editor: base (left) vs the live document (right). */
export async function openFullDiff(
  document: vscode.TextDocument,
  msg: { baseContent?: string; baseLabel?: string },
  snapshot: string,
): Promise<void> {
  const explicitBase: DiffBase | undefined =
    msg.baseContent !== undefined
      ? { content: msg.baseContent, label: msg.baseLabel ?? 'On disk' }
      : undefined;
  const gitApi = explicitBase ? null : await getGitApi();
  const base = await resolveDiffBase({
    fsPath: document.uri.fsPath,
    uri: document.uri,
    explicitBase,
    gitApi,
    snapshot,
  });

  // Serve BOTH sides from the read-only scheme. The right side is a point-in-time
  // snapshot of the live document (already flushed by the caller), NOT document.uri
  // itself — feeding document.uri would let the *.md custom editor claim the pane
  // and render a webview instead of a text diff (c54).
  const baseToken = String(++seq);
  bases.set(baseToken, base.content);
  const curToken = String(++seq);
  bases.set(curToken, document.getText());

  const fileName = document.uri.path.split('/').pop() ?? 'document.md';
  const { leftPath, rightPath } = diffSidePaths(fileName, base.label);
  const leftUri = vscode.Uri.from({ scheme: SCHEME, path: leftPath, query: baseToken });
  const rightUri = vscode.Uri.from({ scheme: SCHEME, path: rightPath, query: curToken });

  // The synthetic paths have no .md extension (so the custom editor skips them),
  // which also drops markdown syntax highlighting — restore it explicitly.
  try {
    const [l, r] = await Promise.all([
      vscode.workspace.openTextDocument(leftUri),
      vscode.workspace.openTextDocument(rightUri),
    ]);
    await vscode.languages.setTextDocumentLanguage(l, 'markdown');
    await vscode.languages.setTextDocumentLanguage(r, 'markdown');
  } catch {
    // highlighting is best-effort; the diff still works as plain text
  }

  await vscode.commands.executeCommand(
    'vscode.diff',
    leftUri,
    rightUri,
    `${fileName} — changes since ${base.label}`,
  );
}
