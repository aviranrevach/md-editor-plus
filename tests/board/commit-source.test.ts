import { commitBoardSource } from '../../src/webview/boardCommit';

// Gap A regression: the board NodeView's onMutate used to do
//   const pos = getPos(); if (pos == null) return;
// which SILENTLY dropped the edit whenever getPos() was transiently null
// (common while ProseMirror reconciles a re-rendered doc — e.g. when a second
// tab / external change rebuilds it). The board kept showing the new rows but
// the host document never received them → "Saved" while disk stayed stale.
//
// commitBoardSource must never drop the edit: it retries until getPos() yields
// a position, and only logs (loudly) if it truly can't after its retries.

interface FakeEditor {
  commands: { command: (fn: (p: { tr: FakeTr }) => boolean) => boolean };
}
interface FakeTr { setNodeAttribute: jest.Mock }

function makeEditor(): { editor: FakeEditor; tr: FakeTr; commandCalls: number } {
  const tr: FakeTr = { setNodeAttribute: jest.fn() };
  let commandCalls = 0;
  const editor: FakeEditor = {
    commands: {
      command: (fn) => { commandCalls++; return fn({ tr }); },
    },
  };
  return { editor, tr, get commandCalls() { return commandCalls; } } as any;
}

// Synchronous retry scheduler so tests don't rely on real timers/microtasks.
const syncSchedule = (cb: () => void): void => cb();

describe('commitBoardSource', () => {
  it('commits immediately when getPos() is valid', () => {
    const { editor, tr } = makeEditor();
    const onCommitted = jest.fn();
    commitBoardSource(editor as any, () => 7, 'NEW SOURCE', { onCommitted, schedule: syncSchedule });
    expect(tr.setNodeAttribute).toHaveBeenCalledWith(7, 'source', 'NEW SOURCE');
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it('does NOT drop the edit when getPos() is null at first, then valid (retries)', () => {
    const { editor, tr } = makeEditor();
    let calls = 0;
    const getPos = () => (++calls < 3 ? null : 4); // null, null, then 4
    commitBoardSource(editor as any, getPos, 'ROWS', { schedule: syncSchedule });
    expect(tr.setNodeAttribute).toHaveBeenCalledWith(4, 'source', 'ROWS');
  });

  it('logs loudly (never silently) if getPos() stays null past all retries', () => {
    const { editor, tr } = makeEditor();
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    commitBoardSource(editor as any, () => null, 'LOST?', { schedule: syncSchedule });
    expect(tr.setNodeAttribute).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('updates lastSource (via onCommitted) only when the commit actually lands', () => {
    const { editor } = makeEditor();
    const onCommitted = jest.fn();
    commitBoardSource(editor as any, () => null, 'X', { onCommitted, schedule: syncSchedule });
    expect(onCommitted).not.toHaveBeenCalled(); // never committed → never marks lastSource
  });
});
