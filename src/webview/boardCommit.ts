// Commits a board's serialized source into the ProseMirror document by setting
// the board node's `source` attribute.
//
// Gap A data-loss fix: the previous inline code did
//   const pos = getPos(); if (pos == null) return;
// which SILENTLY dropped the edit whenever getPos() returned null. getPos() can
// be transiently null while ProseMirror reconciles a re-rendered document (e.g.
// when an external/concurrent change rebuilds the doc). When that happened the
// board kept rendering the new rows but the host TextDocument never received
// them — so the document stayed "clean" and the editor reported "Saved" while
// the rows were never written to disk.
//
// This helper never drops the edit: it retries on a microtask until getPos()
// yields a position, and only if it still can't after a bounded number of
// attempts does it log loudly (so a true failure is visible, never silent).

type CommandRunner = (fn: (props: { tr: { setNodeAttribute(pos: number, name: string, value: unknown): void } }) => boolean) => boolean;

interface CommitTarget {
  commands: { command: CommandRunner };
}

export interface CommitOptions {
  /** Called once, synchronously, when the attribute is actually written. Used to
   *  sync the NodeView's `lastSource` so it doesn't echo-render our own edit. */
  onCommitted?: () => void;
  /** Defer a retry. Defaults to queueMicrotask; injectable for tests. */
  schedule?: (cb: () => void) => void;
  /** How many extra attempts after the first. */
  retries?: number;
}

const defaultSchedule: (cb: () => void) => void =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (cb) => Promise.resolve().then(cb);

export function commitBoardSource(
  editor: CommitTarget,
  getPos: (() => number | null | undefined) | undefined,
  nextSource: string,
  opts: CommitOptions = {},
): void {
  const schedule = opts.schedule ?? defaultSchedule;
  const retries = opts.retries ?? 5;

  const attempt = (left: number): void => {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) {
      if (left > 0) { schedule(() => attempt(left - 1)); return; }
      // Never silent: a dropped edit is data loss, so make it loud.
      console.error(
        '[md-editor-plus] board edit NOT committed: getPos() stayed null after retries — ' +
        'the board change was not written to the document (potential data loss).',
        { sourceChars: nextSource.length },
      );
      return;
    }
    // Mark lastSource BEFORE dispatching: editor.commands.command runs onUpdate
    // synchronously, which drives the NodeView's update() echo check.
    opts.onCommitted?.();
    editor.commands.command(({ tr }) => {
      tr.setNodeAttribute(pos, 'source', nextSource);
      return true;
    });
  };

  attempt(retries);
}
