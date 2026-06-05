import {
  COLOR_TOKENS_PUBLIC as PALETTE,
  getStatusOptions,
  addStatusOption, renameStatusOption, recolorStatusOption, deleteStatusOption,
} from './boardModel';
import type { Board, ColumnDef, ColorToken } from './boardModel';

export interface OptionsEditorConfig {
  getOptions: () => ColumnDef[];
  onAdd: () => void;
  onRename: (oldName: string, newName: string) => void;
  onRecolor: (name: string, color: ColorToken) => void;
  onDelete: (name: string) => void;
}

/** Render the editable list of states into `host`. Pure DOM, no board knowledge. */
export function buildOptionsEditor(host: HTMLElement, cfg: OptionsEditorConfig): void {
  host.innerHTML = '';
  host.className = 'bd-opt-editor';

  for (const opt of cfg.getOptions()) {
    const row = document.createElement('div');
    row.className = 'bd-opt-row';

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = `bd-opt-swatch color-${opt.color}`;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      openPalette(row, opt.color, (tok) => cfg.onRecolor(opt.name, tok));
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
    del.addEventListener('click', (e) => { e.stopPropagation(); cfg.onDelete(opt.name); });
    row.appendChild(del);

    host.appendChild(row);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'bd-opt-add';
  add.textContent = '+ Add option';
  add.addEventListener('click', (e) => { e.stopPropagation(); cfg.onAdd(); });
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
    sw.addEventListener('click', (e) => { e.stopPropagation(); pick(tok); pal.remove(); });
    pal.appendChild(sw);
  }
  anchor.appendChild(pal);
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

  const rect = anchor.getBoundingClientRect();
  pop.style.position = 'absolute';
  pop.style.top = `${rect.bottom + window.scrollY + 4}px`;
  pop.style.left = `${rect.left + window.scrollX}px`;

  const rerender = () => buildOptionsEditor(pop, {
    getOptions: () => getStatusOptions(getBoard(), fieldName),
    onAdd:     () => { onChange(addStatusOption(getBoard(), fieldName, 'New')); rerender(); },
    onRename:  (o, n) => { onChange(renameStatusOption(getBoard(), fieldName, o, n)); rerender(); },
    onRecolor: (n, c) => { onChange(recolorStatusOption(getBoard(), fieldName, n, c)); rerender(); },
    onDelete:  (n) => { onChange(deleteStatusOption(getBoard(), fieldName, n)); rerender(); },
  });
  rerender();

  function onOutside(e: MouseEvent) {
    if (!pop.contains(e.target as Node) && e.target !== anchor) close();
  }
  function close() {
    pop.remove();
    document.removeEventListener('mousedown', onOutside, true);
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
}
