import * as vscode from 'vscode';
import { resolveDiffBase, resolveCurrentSide, type GitApiLike, type DiffBase } from './diffBase';
import { openRenderedDiff } from './diffPaneView';

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
