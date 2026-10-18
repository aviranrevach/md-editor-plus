// The ⋯ ("more") menu in the selection bubble menu. Kept free of DOM and editor
// references so the item list and dispatch are unit-testable; bubbleMenu.ts
// renders MORE_MENU_ITEMS and supplies the callbacks in MoreMenuDeps.

export type MoreMenuId = 'turn-into' | 'turn-into-ai' | 'copy' | 'copy-plain';

export interface MoreMenuItem {
  id: MoreMenuId;
  label: string;
  /** true → the row opens a sub-panel (shown with a trailing chevron). */
  chevron: boolean;
}

export const MORE_MENU_ITEMS: readonly MoreMenuItem[] = [
  { id: 'turn-into',    label: 'Turn into',          chevron: true  },
  { id: 'turn-into-ai', label: 'Turn into using AI', chevron: true  },
  { id: 'copy',         label: 'Copy',               chevron: false },
  { id: 'copy-plain',   label: 'Copy as plain text', chevron: false },
];

export interface MoreMenuDeps {
  openTurnInto: () => void;
  openTurnIntoAi: () => void;
  copyRich: () => void;
  copyPlain: () => void;
}

/** Dispatch a click on a ⋯-menu row to the matching dependency. Unknown ids are ignored. */
export function runMoreMenuAction(id: string, deps: MoreMenuDeps): void {
  switch (id) {
    case 'turn-into':    deps.openTurnInto();   break;
    case 'turn-into-ai': deps.openTurnIntoAi(); break;
    case 'copy':         deps.copyRich();       break;
    case 'copy-plain':   deps.copyPlain();      break;
    default: /* ignore */ break;
  }
}
