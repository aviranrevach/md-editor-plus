// Pure DOM modal for the fullscreen / zoom view of a rendered mermaid SVG.
// Knows nothing about ProseMirror or mermaid the library — takes an SVG
// string and a title, returns a close function.

interface FullscreenOptions {
  svg:   string;
  title: string;
}

export function openMermaidFullscreen({ svg, title }: FullscreenOptions): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'mmd-fs';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${title} — fullscreen view`);

  overlay.innerHTML = `
    <div class="mmd-fs-bar">
      <div class="mmd-fs-title" aria-hidden="true">mermaid · ${escapeHtml(title)}</div>
      <div class="mmd-fs-tools" role="group" aria-label="Zoom controls">
        <button type="button" class="mmd-fs-tool" data-action="zoom-out" aria-label="Zoom out">−</button>
        <span class="mmd-fs-zoom" aria-live="polite">100%</span>
        <button type="button" class="mmd-fs-tool" data-action="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" class="mmd-fs-tool" data-action="reset" aria-label="Reset zoom">⤾</button>
      </div>
      <button type="button" class="mmd-fs-close" data-action="close">Close · Esc</button>
    </div>
    <div class="mmd-fs-stage" tabindex="0">
      <div class="mmd-fs-canvas">${svg}</div>
    </div>
  `;

  document.body.appendChild(overlay);

  const stage   = overlay.querySelector<HTMLElement>('.mmd-fs-stage')!;
  const canvas  = overlay.querySelector<HTMLElement>('.mmd-fs-canvas')!;
  const zoomEl  = overlay.querySelector<HTMLElement>('.mmd-fs-zoom')!;

  let zoom = 1;
  let panX = 0;
  let panY = 0;
  const MIN = 0.25;
  const MAX = 4;
  const STEP = 0.25;

  function applyTransform(): void {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    zoomEl.textContent = `${Math.round(zoom * 100)}%`;
  }
  function clamp(z: number): number { return Math.min(MAX, Math.max(MIN, z)); }
  function setZoom(next: number): void {
    zoom = clamp(next);
    applyTransform();
  }
  function reset(): void {
    zoom = 1; panX = 0; panY = 0; applyTransform();
  }

  overlay.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close')    { close(); return; }
    if (action === 'zoom-in')  { setZoom(zoom + STEP); return; }
    if (action === 'zoom-out') { setZoom(zoom - STEP); return; }
    if (action === 'reset')    { reset(); return; }
    // Click on the backdrop (not on canvas / bar) closes too.
    if (target === overlay) close();
  });

  stage.addEventListener('wheel', (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom + (e.deltaY < 0 ? STEP : -STEP));
  }, { passive: false });

  // Drag-to-pan
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  stage.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    stage.classList.add('mmd-fs-dragging');
  });
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup',   onUp,   true);
  function onMove(e: MouseEvent): void {
    if (!dragging) return;
    panX += e.clientX - lastX;
    panY += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    applyTransform();
  }
  function onUp(): void {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('mmd-fs-dragging');
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom + STEP); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoom - STEP); return; }
    if (e.key === '0')                 { e.preventDefault(); reset(); return; }
    if (e.key === 'ArrowLeft')         { panX += 40; applyTransform(); return; }
    if (e.key === 'ArrowRight')        { panX -= 40; applyTransform(); return; }
    if (e.key === 'ArrowUp')           { panY += 40; applyTransform(); return; }
    if (e.key === 'ArrowDown')         { panY -= 40; applyTransform(); return; }
  }
  document.addEventListener('keydown', onKey, true);

  // Focus the stage for keyboard control
  requestAnimationFrame(() => stage.focus({ preventScroll: true }));

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown',   onKey, true);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup',   onUp,   true);
    overlay.remove();
  }
  return close;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;'  :
    c === '>' ? '&gt;'  :
    c === '"' ? '&quot;' :
    '&#39;'
  ));
}
