import * as vscode from 'vscode';
import { resolveDiffBase, resolveCurrentSide, type GitApiLike, type DiffBase } from './diffBase';
import { openRenderedDiff } from './diffPaneView';

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

/** Open the rendered two-pane diff: base (left) vs current (right), in the editor (c57). */
export async function openFullDiff(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  msg: { baseContent?: string; baseLabel?: string; currentMarkdown?: string },
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
  const current = resolveCurrentSide(msg.currentMarkdown, document.getText());
  await openRenderedDiff(context, document, base, current);
}
