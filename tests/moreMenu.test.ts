import { MORE_MENU_ITEMS, runMoreMenuAction, type MoreMenuDeps } from '../src/webview/moreMenu';

describe('MORE_MENU_ITEMS', () => {
  it('lists the four actions in order', () => {
    expect(MORE_MENU_ITEMS.map(i => i.id)).toEqual([
      'turn-into', 'turn-into-ai', 'copy', 'copy-plain',
    ]);
  });

  it('marks only the two turn-into rows with a chevron', () => {
    expect(MORE_MENU_ITEMS.filter(i => i.chevron).map(i => i.id)).toEqual([
      'turn-into', 'turn-into-ai',
    ]);
  });

  it('gives every row a non-empty label', () => {
    for (const item of MORE_MENU_ITEMS) expect(item.label.length).toBeGreaterThan(0);
  });
});

describe('runMoreMenuAction', () => {
  function deps(): MoreMenuDeps & { [k: string]: jest.Mock } {
    return {
      openTurnInto: jest.fn(),
      openTurnIntoAi: jest.fn(),
      copyRich: jest.fn(),
      copyPlain: jest.fn(),
    };
  }

  it.each([
    ['turn-into', 'openTurnInto'],
    ['turn-into-ai', 'openTurnIntoAi'],
    ['copy', 'copyRich'],
    ['copy-plain', 'copyPlain'],
  ])('routes %s to %s exactly once', (id, fn) => {
    const d = deps();
    runMoreMenuAction(id, d);
    expect(d[fn]).toHaveBeenCalledTimes(1);
    const others = ['openTurnInto', 'openTurnIntoAi', 'copyRich', 'copyPlain'].filter(k => k !== fn);
    for (const k of others) expect(d[k]).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown id', () => {
    const d = deps();
    runMoreMenuAction('nope', d);
    for (const k of ['openTurnInto', 'openTurnIntoAi', 'copyRich', 'copyPlain']) {
      expect(d[k]).not.toHaveBeenCalled();
    }
  });
});
