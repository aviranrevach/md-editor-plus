import type { Editor } from '@tiptap/core';
import { computeMap, type MapHeading } from './structureMapCore';
import { OUTLINE_EVENT, getOutline, type OutlineEntry } from './extensions/outline';

export interface StructureMap {
  setVisible: (visible: boolean) => void;
  isVisible: () => boolean;
  destroy: () => void;
}

interface CreateOpts {
  editor: Editor;
  railEl: HTMLElement;
  toggleBtn: HTMLElement;
  initialVisible: boolean;
  onVisibilityChange: (visible: boolean) => void;
}

const SCROLL_OFFSET = 80; // matches outlinePanel.jumpTo

export function createStructureMap(opts: CreateOpts): StructureMap {
  const { editor, railEl, toggleBtn } = opts;
  let visible = opts.initialVisible;
  let entries: OutlineEntry[] = getOutline(editor.view);

  const ticksLayer = document.createElement('div');
  ticksLayer.className = 'structure-map-ticks';
  const viewportBox = document.createElement('div');
  viewportBox.className = 'structure-map-viewport';
  railEl.replaceChildren(ticksLayer, viewportBox);

  // Map a heading's doc position to its Y in document space.
  function docYOf(pos: number): number | null {
    try {
      return editor.view.coordsAtPos(pos).top + window.scrollY;
    } catch {
      return null;
    }
  }

  function readHeadings(): MapHeading[] {
    const out: MapHeading[] = [];
    for (const e of entries) {
      const docY = docYOf(e.pos);
      if (docY !== null) out.push({ pos: e.pos, level: e.level, docY });
    }
    return out;
  }

  function docHeight(): number {
    return Math.max(document.documentElement.scrollHeight, window.innerHeight);
  }

  function rebuild(): void {
    if (!visible) return;
    const result = computeMap({
      headings: readHeadings(),
      docHeight: docHeight(),
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight,
    });
    ticksLayer.replaceChildren(...result.ticks.map((t) => {
      const tick = document.createElement('div');
      tick.className = `structure-map-tick level-${t.level}`;
      tick.style.top = `${t.topFrac * 100}%`;
      tick.dataset.pos = String(t.pos);
      const label = entries.find((e) => e.pos === t.pos)?.text ?? '';
      tick.dataset.tip = label;
      tick.setAttribute('aria-label', label);
      return tick;
    }));
    positionViewport(result.viewport);
  }

  function positionViewport(v: { topFrac: number; heightFrac: number }): void {
    viewportBox.style.top = `${v.topFrac * 100}%`;
    viewportBox.style.height = `${v.heightFrac * 100}%`;
  }

  // Cheap scroll path: recompute only the viewport box, throttled with rAF.
  let scrollTick = false;
  function onScroll(): void {
    if (!visible || scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      scrollTick = false;
      const result = computeMap({
        headings: [],
        docHeight: docHeight(),
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
      });
      positionViewport(result.viewport);
    });
  }

  function jumpToPos(pos: number): void {
    try {
      const top = editor.view.coordsAtPos(pos).top + window.scrollY - SCROLL_OFFSET;
      window.scrollTo({ top, behavior: 'smooth' });
    } catch { /* position no longer valid */ }
  }

  function jumpToFraction(frac: number): void {
    const top = frac * docHeight() - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  // Click a tick → jump to heading; click empty rail → jump to that proportion.
  function onRailClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const tick = target.closest<HTMLElement>('.structure-map-tick');
    if (tick) {
      jumpToPos(Number(tick.dataset.pos));
      return;
    }
    const rect = railEl.getBoundingClientRect();
    jumpToFraction((e.clientY - rect.top) / rect.height);
  }

  // Drag the viewport box → scroll proportionally (manual mouse drag).
  let dragging = false;
  function onViewportMouseDown(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }
  function onDragMove(e: MouseEvent): void {
    if (!dragging) return;
    const rect = railEl.getBoundingClientRect();
    const frac = (e.clientY - rect.top) / rect.height;
    window.scrollTo({ top: Math.max(0, frac * docHeight() - window.innerHeight / 2) });
  }
  function onDragEnd(): void {
    dragging = false;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }

  function onOutlineChanged(e: Event): void {
    entries = (e as CustomEvent<OutlineEntry[]>).detail;
    rebuild();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', rebuild);
  railEl.addEventListener('click', onRailClick);
  viewportBox.addEventListener('mousedown', onViewportMouseDown);
  editor.view.dom.addEventListener(OUTLINE_EVENT, onOutlineChanged);

  function applyVisibility(): void {
    document.documentElement.classList.toggle('structure-map-visible', visible);
    toggleBtn.classList.toggle('active', visible);
    if (visible) rebuild();
  }

  function setVisible(next: boolean): void {
    if (next === visible) return;
    visible = next;
    applyVisibility();
    opts.onVisibilityChange(visible);
  }

  applyVisibility();

  return {
    setVisible,
    isVisible: () => visible,
    destroy() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', rebuild);
      railEl.removeEventListener('click', onRailClick);
      viewportBox.removeEventListener('mousedown', onViewportMouseDown);
      editor.view.dom.removeEventListener(OUTLINE_EVENT, onOutlineChanged);
    },
  };
}
