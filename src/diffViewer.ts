import * as vscode from 'vscode';
import { resolveDiffBase, type GitApiLike, type DiffBase } from './diffBase';

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

  const token = String(++seq);
  bases.set(token, base.content);
  const fileName = document.uri.path.split('/').pop() ?? 'document.md';
  const leftUri = vscode.Uri.from({ scheme: SCHEME, path: '/' + fileName, query: token });
  await vscode.commands.executeCommand(
    'vscode.diff',
    leftUri,
    document.uri,
    `${fileName} — changes since ${base.label}`,
  );
}
