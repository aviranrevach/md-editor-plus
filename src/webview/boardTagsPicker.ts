import { getStatusOptions, addTagOption, toggleTagOnCard, sanitizeTagName } from './boardModel';
import type { Board } from './boardModel';
import { buildChip } from './boardSidePanel';
import { createPopover } from './popover';

/**
 * Multi-select tag picker: a checklist of the field's tag options (toggle each
 * on/off for the given card) plus a filter input that offers "+ Create '<x>'".
 */
export function openTagsPicker(
  anchor: HTMLElement,
  getBoard: () => Board,
  fieldName: string,
  cardId: string,
  onChange: (next: Board) => void,
): void {
  const popover = createPopover({ className: 'bd-tags-pop' });
  const pop = popover.el;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'bd-tags-filter';
  input.placeholder = 'Filter or create…';

  const list = document.createElement('div');
  list.className = 'bd-tags-list';

  const cardTags = (): string[] => {
    const c = getBoard().cards.find(x => x.id === cardId);
    return (c?.values[fieldName] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  };

  const render = () => {
    list.innerHTML = '';
    const q = input.value.trim().toLowerCase();
    const opts = getStatusOptions(getBoard(), fieldName);
    const have = new Set(cardTags());
    for (const o of opts.filter(o => o.name.toLowerCase().includes(q))) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bd-tags-opt';
      row.appendChild(buildChip(o.name, o.color));
      if (have.has(o.name)) {
        const ck = document.createElement('span');
        ck.className = 'bd-tags-check';
        ck.textContent = '✓';
        row.appendChild(ck);
      }
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        onChange(toggleTagOnCard(getBoard(), fieldName, cardId, o.name));
        render();
      });
      list.appendChild(row);
    }
    const typed = input.value.trim();
    const exists = opts.some(o => o.name.toLowerCase() === typed.toLowerCase());
    if (typed && !exists) {
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'bd-tags-create';
      create.textContent = `+ Create "${typed}"`;
      create.addEventListener('click', (e) => {
        e.stopPropagation();
        const clean = sanitizeTagName(typed);
        if (!clean) return;
        const withOpt = addTagOption(getBoard(), fieldName, clean);
        onChange(toggleTagOnCard(withOpt, fieldName, cardId, clean));
        input.value = '';
        render();
      });
      list.appendChild(create);
    }
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (list.querySelector('.bd-tags-create, .bd-tags-opt') as HTMLElement | null)?.click();
    }
  });

  pop.append(input, list);
  render();
  popover.open(anchor);
  input.focus();
}
