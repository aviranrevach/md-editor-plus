import {
  COLOR_TOKENS_PUBLIC as PALETTE,
  getStatusOptions,
  addStatusOption, renameStatusOption, recolorStatusOption, deleteStatusOption,
  addTagOption, renameTagOption, deleteTagOption,
} from './boardModel';
import type { Board, ColumnDef, ColorToken } from './boardModel';
import { placeFloating } from './menuPosition';
import type { PlacementHandle } from './menuPosition';

export interface OptionsEditorConfig {
  getOptions: () => ColumnDef[];
  onAdd: () => void;
  onRename: (oldName: string, newName: string) => void;
  onRecolor: (name: string, color: ColorToken) => void;
  onDelete: (name: string) => void;
}

/**
 * If a `.bd-opt-name` input currently has focus and its value has changed,
 * blur it so the rename commit handler fires before any other mutation runs.
 */
function flushPendingRename(): void {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.classList.contains('bd-opt-name')) {
    active.blur();
  }
}

/** Render the editable list of states into `host`. Pure DOM, no board knowledge. */
export function buildOptionsEditor(host: HTMLElement, cfg: OptionsEditorConfig): void {
  host.innerHTML = '';
  // Use classList.add (not className=) so a host that's also a styled popover
  // (.bd-opt-popover, which carries position/border/shadow) keeps its class.
  host.classList.add('bd-opt-editor');

  for (const opt of cfg.getOptions()) {
    const row = document.createElement('div');
    row.className = 'bd-opt-row';

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = `bd-opt-swatch color-${opt.color}`;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      flushPendingRename();
      // Read the live name from the row's input (may differ from opt.name after a rename).
      const liveName = (row.querySelector('.bd-opt-name') as HTMLInputElement).value;
      openPalette(row, opt.color, (tok) => cfg.onRecolor(liveName, tok));
    });
    row.appendChild(swatch);

    const name = document.createElement('input');
    name.className = 'bd-opt-name';
    name.value = opt.name;
    const commit = () => {
      const v = name.value.trim();
      if (v && v !== opt.name) cfg.onRename(opt.name, v);
    };
    name.addEventListener('blur', commit);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
      if (e.key === 'Escape') { name.value = opt.name; name.blur(); }
    });
    row.appendChild(name);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'bd-opt-delete';
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      flushPendingRename();
      // Read the live name — may have been updated by the flush above.
      const liveName = (row.querySelector('.bd-opt-name') as HTMLInputElement).value;
      cfg.onDelete(liveName);
    });
    row.appendChild(del);

    host.appendChild(row);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'bd-opt-add';
  add.textContent = '+ Add option';
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    flushPendingRename();
    cfg.onAdd();
  });
  host.appendChild(add);
}

function openPalette(anchor: HTMLElement, current: ColorToken, pick: (c: ColorToken) => void): void {
  anchor.querySelectorAll('.bd-opt-palette').forEach((n) => n.remove());
  const pal = document.createElement('div');
  pal.className = 'bd-opt-palette';
  for (const tok of PALETTE) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = `bd-opt-pchip color-${tok}` + (tok === current ? ' is-selected' : '');
    sw.addEventListener('click', (e) => { e.stopPropagation(); pick(tok); pal.remove(); outsideHandler && document.removeEventListener('click', outsideHandler, true); });
    pal.appendChild(sw);
  }
  anchor.appendChild(pal);

  // One-shot capture-phase outside-click dismissal (no listener leak across opens).
  let outsideHandler: ((e: MouseEvent) => void) | null = null;
  outsideHandler = (e: MouseEvent) => {
    if (!pal.contains(e.target as Node)) {
      pal.remove();
      document.removeEventListener('click', outsideHandler!, true);
    }
  };
  // Defer by a tick so this open-click doesn't immediately close the palette.
  setTimeout(() => document.addEventListener('click', outsideHandler!, true), 0);
}

/**
 * Popover wrapper: edits a status field's options on a real Board, mutating via
 * the model helpers and reporting each change through `onChange`.
 */
export function openStatusOptionsEditor(
  anchor: HTMLElement,
  getBoard: () => Board,
  fieldName: string,
  onChange: (next: Board) => void,
): void {
  document.querySelectorAll('.bd-opt-popover').forEach((n) => n.remove());
  const pop = document.createElement('div');
  pop.className = 'bd-opt-popover';
  document.body.appendChild(pop);

  const placement: PlacementHandle = placeFloating(pop, anchor);

  const isTags = () => getBoard().fields.find(f => f.name === fieldName)?.type === 'tags';

  const rerender = () => buildOptionsEditor(pop, {
    getOptions: () => getStatusOptions(getBoard(), fieldName),
    onAdd: () => {
      const existing = getStatusOptions(getBoard(), fieldName).map((o) => o.name);
      let label = 'New';
      let counter = 2;
      while (existing.includes(label)) { label = `New ${counter}`; counter++; }
      onChange(isTags() ? addTagOption(getBoard(), fieldName, label) : addStatusOption(getBoard(), fieldName, label));
      rerender();
    },
    onRename:  (o, n) => { onChange(isTags() ? renameTagOption(getBoard(), fieldName, o, n) : renameStatusOption(getBoard(), fieldName, o, n)); rerender(); },
    onRecolor: (n, c) => { onChange(recolorStatusOption(getBoard(), fieldName, n, c)); rerender(); },
    onDelete:  (n) => { onChange(isTags() ? deleteTagOption(getBoard(), fieldName, n) : deleteStatusOption(getBoard(), fieldName, n)); rerender(); },
  });
  rerender();

  function onOutside(e: MouseEvent) {
    if (!pop.contains(e.target as Node) && e.target !== anchor) close();
  }
  function close() {
    placement.destroy();
    pop.remove();
    document.removeEventListener('mousedown', onOutside, true);
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
}
