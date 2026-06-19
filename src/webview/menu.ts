import { createPopover, type Popover, type PopoverOpts } from './popover';

export interface MenuItem {
  icon?: string; label: string;
  variant?: 'danger';
  disabled?: boolean;
  checked?: boolean;
  trailing?: HTMLElement;
  submenu?: () => MenuSection[];
  onSelect?: () => void;
}
export interface MenuSection { label?: string; items: MenuItem[]; }
export interface Menu { readonly popover: Popover; open(anchor: HTMLElement, sections: MenuSection[]): void; close(): void; }

export function createMenu(opts: PopoverOpts = {}): Menu {
  const popover = createPopover({ ...opts, className: ['mp-menu', opts.className].filter(Boolean).join(' ') });

  let stack: MenuSection[][] = [];

  function renderItem(item: MenuItem): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mp-menu-item' + (item.variant === 'danger' ? ' is-danger' : '');
    if (item.disabled) row.disabled = true;
    if (item.icon) {
      const ic = document.createElement('span'); ic.className = 'mp-menu-icon'; ic.innerHTML = item.icon;
      row.appendChild(ic);
    }
    const label = document.createElement('span'); label.className = 'mp-menu-label'; label.textContent = item.label;
    row.appendChild(label);
    if (item.checked) { const c = document.createElement('span'); c.className = 'mp-menu-check'; c.textContent = '✓'; row.appendChild(c); }
    if (item.submenu) { const ca = document.createElement('span'); ca.className = 'mp-menu-caret'; ca.textContent = '›'; row.appendChild(ca); }
    if (item.trailing) {
      item.trailing.classList.add('mp-menu-trailing');
      // clicks on the trailing control must not activate the row
      item.trailing.addEventListener('mousedown', (e) => e.stopPropagation());
      row.appendChild(item.trailing);
    }
    if (item.submenu) {
      row.addEventListener('mousedown', (e) => { e.preventDefault(); stack.push(item.submenu!()); renderCurrent(); });
    } else if (!item.disabled) {
      row.addEventListener('mousedown', (e) => { e.preventDefault(); item.onSelect?.(); popover.close(); });
    }
    return row;
  }

  function renderCurrent(): void {
    popover.el.innerHTML = '';
    if (stack.length > 1) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'mp-menu-item mp-menu-back';
      back.innerHTML = '<span class="mp-menu-caret mp-menu-caret-back">‹</span><span class="mp-menu-label">Back</span>';
      back.addEventListener('mousedown', (e) => { e.preventDefault(); stack.pop(); renderCurrent(); });
      popover.el.appendChild(back);
      const div = document.createElement('div'); div.className = 'mp-menu-divider'; popover.el.appendChild(div);
    }
    const sections = stack[stack.length - 1];
    sections.forEach((section, i) => {
      if (i > 0) { const d = document.createElement('div'); d.className = 'mp-menu-divider'; popover.el.appendChild(d); }
      if (section.label) { const s = document.createElement('div'); s.className = 'mp-menu-section'; s.textContent = section.label; popover.el.appendChild(s); }
      for (const item of section.items) popover.el.appendChild(renderItem(item));
    });
  }

  return {
    popover,
    open(anchor, sections) { stack = [sections]; renderCurrent(); popover.open(anchor); },
    close() { popover.close(); },
  };
}
