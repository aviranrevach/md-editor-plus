// src/webview/readonlyState.ts
//
// Single source of truth for read-only mode. Flips the editor's editability
// and keeps every read-only affordance (the <html> class that hides the caret,
// the settings toggle-switch, the toolbar pill) in sync. State is transient —
// it is never persisted, so every document opens editable (c44).

export interface ReadOnlyDeps {
  /** documentElement — gets the `read-only` class toggled (drives caret CSS). */
  root: HTMLElement;
  /** the settings `.toggle-switch` button (role="switch"); null-safe. */
  toggleSwitch: HTMLElement | null;
  /** the toolbar pill; shown only while read-only; null-safe. */
  pill: HTMLElement | null;
  /** the save indicator; hidden while read-only so the pill takes its place. */
  saveIndicator?: HTMLElement | null;
  /** flips the editor's editability (wraps editor.setEditable). */
  setEditable: (editable: boolean) => void;
}

export interface ReadOnlyController {
  set(on: boolean): void;
  get(): boolean;
}

export function createReadOnlyController(deps: ReadOnlyDeps): ReadOnlyController {
  let state = false;

  function set(on: boolean): void {
    state = on;
    deps.root.classList.toggle('read-only', on);
    if (deps.toggleSwitch) {
      deps.toggleSwitch.classList.toggle('on', on);
      deps.toggleSwitch.setAttribute('aria-checked', String(on));
    }
    if (deps.pill) deps.pill.hidden = !on;
    // The pill replaces the save indicator while read-only (they share the spot).
    if (deps.saveIndicator) deps.saveIndicator.hidden = on;
    deps.setEditable(!on);
  }

  return { set, get: () => state };
}
