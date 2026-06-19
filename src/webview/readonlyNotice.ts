// src/webview/readonlyNotice.ts
//
// The "you tried to edit a locked file" notification: a dark, top-right card
// that appears when the user attempts to type while read-only (c44). One at a
// time — a second trigger re-arms the auto-dismiss timer instead of stacking.

export interface ReadOnlyNoticeDeps {
  /** where the card is appended (e.g. document.body). */
  container: HTMLElement;
  /** called when the user clicks "Enable editing". */
  onEnableEditing: () => void;
  /** auto-dismiss delay in ms (default 4000). */
  autoDismissMs?: number;
}

export interface ReadOnlyNotice {
  show(): void;
  destroy(): void;
}

export function createReadOnlyNotice(deps: ReadOnlyNoticeDeps): ReadOnlyNotice {
  const dismissMs = deps.autoDismissMs ?? 4000;
  let el: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function hide(): void {
    if (timer) { clearTimeout(timer); timer = undefined; }
    el?.remove();
    el = null;
  }

  function build(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'readonly-notice';
    card.setAttribute('role', 'status');

    const row = document.createElement('div');
    row.className = 'readonly-notice-row';
    // The message stays on one line (CSS white-space: nowrap), "read-only" bold.
    row.innerHTML = '<span class="readonly-notice-ic">\u{1F512}</span>'
      + '<span class="readonly-notice-msg">This file is <b>read-only</b>. Enable editing?</span>';
    const x = document.createElement('span');
    x.className = 'readonly-notice-x';
    x.textContent = '✕';
    x.addEventListener('click', hide);
    row.appendChild(x);

    const acts = document.createElement('div');
    acts.className = 'readonly-notice-acts';
    const dismiss = document.createElement('button');
    dismiss.className = 'readonly-notice-dismiss';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', hide);
    const enable = document.createElement('button');
    enable.className = 'readonly-notice-enable';
    enable.textContent = 'Enable editing';
    enable.addEventListener('click', () => { deps.onEnableEditing(); hide(); });
    acts.append(dismiss, enable);

    card.append(row, acts);
    return card;
  }

  function show(): void {
    if (!el) {
      el = build();
      deps.container.appendChild(el);
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(hide, dismissMs);
  }

  return { show, destroy: hide };
}
