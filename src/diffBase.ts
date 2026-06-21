// Pure base-content resolver for the full diff viewer (c24). No vscode import,
// so it is unit-testable. The vscode glue lives in diffViewer.ts.

export interface DiffBase { content: string; label: string; }

/** Minimal structural shape of the bits of the VS Code Git API we use. */
export interface GitRepoLike { show(ref: string, path: string): Promise<string>; }
export interface GitApiLike { getRepository(uri: unknown): GitRepoLike | null; }

export interface ResolveDiffBaseOptions {
  fsPath: string;
  uri: unknown;                 // passed through to gitApi.getRepository
  explicitBase?: DiffBase;      // banner case: use verbatim
  gitApi: GitApiLike | null;    // null when the git extension is unavailable
  snapshot: string;             // content captured when the editor opened
}

/**
 * Synthetic paths for the two diff sides. Both deliberately end in `)` (not a
 * markdown extension) so the `*.md`/`*.markdown`/… custom editor does NOT claim
 * them — that is what forces VS Code to render its real text diff instead of two
 * rendered MD Editor Plus webviews (c54).
 */
export function diffSidePaths(fileName: string, baseLabel: string): { leftPath: string; rightPath: string } {
  return {
    leftPath: `/${fileName} (${baseLabel})`,
    rightPath: `/${fileName} (current)`,
  };
}

/** Left-side content for the diff: explicit > git HEAD > open-snapshot. */
export async function resolveDiffBase(opts: ResolveDiffBaseOptions): Promise<DiffBase> {
  if (opts.explicitBase) return opts.explicitBase;
  const repo = opts.gitApi ? opts.gitApi.getRepository(opts.uri) : null;
  if (repo) {
    try {
      const head = await repo.show('HEAD', opts.fsPath);
      return { content: head, label: 'HEAD (last commit)' };
    } catch {
      // untracked / new file — fall through to the snapshot
    }
  }
  return { content: opts.snapshot, label: 'when you opened it' };
}
