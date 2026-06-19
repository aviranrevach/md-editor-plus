import { placeFloating, type PlacementHandle } from './menuPosition';

export interface PopoverOpts {
  className?: string;
  preferX?: 'left' | 'right';
  parent?: Popover;
  closeOnScroll?: boolean;
  onClose?: () => void;
  // Absolute height ceiling (px) forwarded to placeFloating: the popover caps
  // and scrolls past this instead of growing to fit all its content.
  maxHeight?: number;
}
export interface Popover {
  readonly el: HTMLElement;
  open(anchor: HTMLElement): void;
  close(): void;
  reposition(): void;
  isOpen(): boolean;
}

// Module-level registry: the chain of currently-open popovers (root first).
const openStack: Popover[] = [];
// Module-level set to track popovers that should NOT close on scroll.
const noCloseOnScroll = new WeakSet<Popover>();

function closeFrom(target: EventTarget | null): void {
  // Close every open popover (top-down) whose el does not contain `target`,
  // stopping at the first that does (clicking inside a parent keeps it open).
  for (let i = openStack.length - 1; i >= 0; i--) {
    const pop = openStack[i];
    if (target instanceof Node && pop.el.contains(target)) break;
    pop.close();
  }
}

let listenersWired = false;
function ensureGlobalListeners(): void {
  if (listenersWired) return;
  listenersWired = true;
  document.addEventListener('mousedown', (e) => { if (openStack.length) closeFrom(e.target); }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openStack.length) { e.preventDefault(); openStack[openStack.length - 1].close(); }
  }, true);
  window.addEventListener('scroll', (e) => {
    if (!openStack.length) return;
    const top = openStack[openStack.length - 1];
    const t = e.target as Node | null;
    if (t && top.el.contains(t)) return;          // scrolling inside the popover
    if (!noCloseOnScroll.has(top)) top.close();
  }, { capture: true, passive: true });
}

export function createPopover(opts: PopoverOpts = {}): Popover {
  const el = document.createElement('div');
  if (opts.className) el.className = opts.className;
  let placement: PlacementHandle | null = null;
  let open = false;

  const pop: Popover = {
    el,
    isOpen: () => open,
    reposition: () => placement?.reposition(),
    open(anchor: HTMLElement) {
      if (open) return;
      ensureGlobalListeners();
      // A top-level popover replaces the current stack; a child pushes onto it.
      if (!opts.parent) { while (openStack.length) openStack[openStack.length - 1].close(); }
      document.body.appendChild(el);
      placement = placeFloating(el, anchor, { preferX: opts.preferX, maxHeight: opts.maxHeight });
      open = true;
      openStack.push(pop);
      // Track whether this popover should close on scroll.
      if (opts.closeOnScroll === false) noCloseOnScroll.add(pop);
    },
    close() {
      if (!open) return;
      open = false;
      placement?.destroy();
      placement = null;
      const i = openStack.indexOf(pop);
      if (i >= 0) openStack.splice(i, 1);
      if (el.parentNode) el.parentNode.removeChild(el);
      noCloseOnScroll.delete(pop);
      opts.onClose?.();
    },
  };
  return pop;
}

export function __closeAllForTest(): void {
  while (openStack.length) openStack[openStack.length - 1].close();
}
