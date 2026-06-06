import { nextSaveState, describeSaveState, SaveState } from '../src/webview/saveState';

describe('nextSaveState', () => {
  it('local edit moves saved/saving to unsaved', () => {
    expect(nextSaveState('saved', 'localEdit')).toBe('unsaved');
    expect(nextSaveState('saving', 'localEdit')).toBe('unsaved');
  });

  it('save lifecycle transitions', () => {
    expect(nextSaveState('unsaved', 'saveStarted')).toBe('saving');
    expect(nextSaveState('saving', 'saveSucceeded')).toBe('saved');
    expect(nextSaveState('saving', 'saveFailed')).toBe('unsaved');
  });

  it('conflict sticks until resolved — no event escapes it except conflictResolved', () => {
    const events = ['localEdit', 'saveStarted', 'saveSucceeded', 'saveFailed', 'conflictDetected'] as const;
    for (const e of events) {
      expect(nextSaveState('conflict', e)).toBe('conflict');
    }
    expect(nextSaveState('conflict', 'conflictResolved')).toBe('saved');
  });

  it('conflictDetected always wins from any state', () => {
    const states: SaveState[] = ['saved', 'unsaved', 'saving'];
    for (const s of states) {
      expect(nextSaveState(s, 'conflictDetected')).toBe('conflict');
    }
  });
});

describe('describeSaveState', () => {
  it('maps every state to a label, glyph and css class', () => {
    expect(describeSaveState('saved')).toEqual({ label: 'Saved', glyph: '✓', cssClass: 'save-ind-saved' });
    expect(describeSaveState('unsaved')).toEqual({ label: 'Unsaved', glyph: '•', cssClass: 'save-ind-unsaved' });
    expect(describeSaveState('saving')).toEqual({ label: 'Saving…', glyph: '⟳', cssClass: 'save-ind-saving' });
    expect(describeSaveState('conflict')).toEqual({ label: 'Edited elsewhere', glyph: '⚠', cssClass: 'save-ind-conflict' });
  });
});
