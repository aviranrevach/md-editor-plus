// Pure save-state model. The indicator is a function of this state, so it can
// never claim "Saved" while edits are pending or a conflict is unresolved.
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict';

export type SaveEvent =
  | 'localEdit'
  | 'saveStarted'
  | 'saveSucceeded'
  | 'saveFailed'
  | 'conflictDetected'
  | 'conflictResolved';

export function nextSaveState(current: SaveState, event: SaveEvent): SaveState {
  // A detected conflict overrides everything; it persists until explicitly resolved.
  if (event === 'conflictDetected') return 'conflict';
  if (current === 'conflict') return event === 'conflictResolved' ? 'saved' : 'conflict';
  switch (event) {
    case 'localEdit':        return 'unsaved';
    case 'saveStarted':      return 'saving';
    case 'saveSucceeded':    return 'saved';
    case 'saveFailed':       return 'unsaved';
    case 'conflictResolved': return 'saved';
  }
}

export interface SaveStateView {
  label: string;
  glyph: string;
  cssClass: string;
}

export function describeSaveState(state: SaveState): SaveStateView {
  switch (state) {
    case 'saved':    return { label: 'Saved',            glyph: '✓', cssClass: 'save-ind-saved' };
    case 'unsaved':  return { label: 'Unsaved',          glyph: '•', cssClass: 'save-ind-unsaved' };
    case 'saving':   return { label: 'Saving…',     glyph: '⟳', cssClass: 'save-ind-saving' };
    case 'conflict': return { label: 'Edited elsewhere', glyph: '⚠', cssClass: 'save-ind-conflict' };
  }
}
