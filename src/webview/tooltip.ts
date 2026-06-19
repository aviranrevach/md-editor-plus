let tipEl: HTMLElement | null = null;
let showTimer: number | null = null;
let activeTarget: HTMLElement | null = null;

const SHOW_DELAY_MS = 350;

function findTipTarget(target: EventTarget | null): HTMLElement | null {
  let el = target as HTMLElement | null;
  while (el && el !== document.body) {
    if (el.dataset && (el.dataset.tip || el.dataset.tipHtml)) return el;
    el = el.parentElement;
  }
  return null;
}

function clearShowTimer(): void {
  if (showTimer !== null) {
    window.clearTimeout(showTimer);
    showTimer = null;
  }
}

function position(target: HTMLElement): void {
  if (!tipEl) return;
  tipEl.style.visibility = 'hidden';
  tipEl.classList.add('visible');

  const r  = target.getBoundingClientRect();
  const tr = tipEl.getBoundingClientRect();
  const margin = 8;

  let left = r.left + r.width / 2 - tr.width / 2;
  let top  = r.top - tr.height - margin;
  let placement: 'top' | 'bottom' = 'top';

  if (top < margin) {
    top = r.bottom + margin;
    placement = 'bottom';
  }

  top = Math.max(margin, Math.min(top, window.innerHeight - tr.height - margin));

  const maxLeft = window.innerWidth - tr.width - margin;
  if (left < margin) left = margin;
  if (left > maxLeft) left = maxLeft;

  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top  = `${Math.round(top)}px`;
  tipEl.dataset.placement = placement;
  tipEl.style.visibility = 'visible';
}

function show(target: HTMLElement): void {
  if (!tipEl) return;
  const html = target.dataset.tipHtml;
  const text = target.dataset.tip;
  if (html) {
    tipEl.classList.add('rich');
    tipEl.innerHTML = html;
  } else if (text) {
    tipEl.classList.remove('rich');
    tipEl.textContent = text;
  } else {
    return;
  }
  activeTarget = target;
  position(target);
}

function hide(): void {
  clearShowTimer();
  activeTarget = null;
  if (!tipEl) return;
  tipEl.classList.remove('visible');
}

function onOver(e: Event): void {
  const target = findTipTarget(e.target);
  if (!target) return;
  if (target === activeTarget) return;
  clearShowTimer();
  showTimer = window.setTimeout(() => show(target), SHOW_DELAY_MS);
}

function onOut(e: Event): void {
  const target = findTipTarget(e.target);
  if (!target) return;
  const related = (e as MouseEvent).relatedTarget as Node | null;
  if (related && target.contains(related)) return;
  hide();
}

export function initTooltips(): void {
  if (tipEl) return;
  tipEl = document.createElement('div');
  tipEl.className = 'app-tooltip';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);

  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('mouseout', onOut, true);
  document.addEventListener('focusin', onOver, true);
  document.addEventListener('focusout', onOut, true);
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}
