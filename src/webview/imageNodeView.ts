// NodeView for the body image: renders the <img>, a selection outline, and
// Notion-style resize grips on the left/right edges. All the *actions*
// (replace/size presets/compress/reveal/remove) live in the image bubble menu
// (imageBubbleMenu.ts), which reuses the editor's bubble-menu chrome. This view
// only owns the image element and freeform drag-resize.
//
// Resize commits to the node's `width` attribute, which the markdown serializer
// turns into a portable <img width> tag.
import type { Editor } from '@tiptap/core';
import { resolveImageSrc } from './mediaResolve';
import { clampWidth } from './imageMarkdown';

export const IMAGE_MIN_WIDTH = 80;
// Concrete pixel widths for the bubble menu's size presets. Full = clear width.
export const IMAGE_SIZE_PRESETS: ReadonlyArray<{ label: string; px: number }> = [
  { label: 'S', px: 240 },
  { label: 'M', px: 420 },
  { label: 'L', px: 640 },
];

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .img-nv { position: relative; display: inline-block; max-width: 100%; line-height: 0; }
    .img-nv > img { max-width: 100%; height: auto; border-radius: 4px; display: block; }
    .img-nv.is-selected > img { outline: 2px solid var(--link, #2383e2); outline-offset: 2px; }
    /* Notion-style edge grips: thin rounded vertical bars centered on each side. */
    .img-nv-grip { position: absolute; top: 50%; transform: translateY(-50%);
      width: 6px; height: 38px; max-height: 60%; border-radius: 6px;
      background: rgba(15, 15, 15, 0.62); border: 1px solid rgba(255, 255, 255, 0.85);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35); opacity: 0; transition: opacity .12s;
      cursor: ew-resize; z-index: 6; }
    .img-nv:hover .img-nv-grip, .img-nv.is-selected .img-nv-grip { opacity: 1; }
    .img-nv-grip.left  { left: 6px; }
    .img-nv-grip.right { right: 6px; }
  `;
  document.head.appendChild(style);
}

interface NodeViewCtx {
  node: any;
  editor: Editor;
  getPos: () => number | undefined;
}

export function imageNodeViewFactory() {
  return (ctx: NodeViewCtx) => new ImageNodeView(ctx);
}

class ImageNodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private node: any;
  private editor: Editor;
  private getPos: () => number | undefined;

  constructor(ctx: NodeViewCtx) {
    injectStyles();
    this.node = ctx.node;
    this.editor = ctx.editor;
    this.getPos = ctx.getPos;

    this.dom = document.createElement('span');
    this.dom.className = 'img-nv';
    this.img = document.createElement('img');
    this.applyImg();
    this.dom.appendChild(this.img);
    (['left', 'right'] as const).forEach((side) => this.addGrip(side));
  }

  private applyImg(): void {
    const src = this.node.attrs.src as string;
    this.img.src = resolveImageSrc(src);
    this.img.alt = (this.node.attrs.alt as string) || '';
    const w = this.node.attrs.width as number | null;
    if (w) this.img.style.width = `${w}px`;
    else this.img.style.removeProperty('width');
  }

  private setWidth(width: number | null): void {
    const pos = this.getPos();
    if (pos == null) return;
    this.editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, width });
      return true;
    });
  }

  private maxWidth(): number {
    const editorWidth = (this.editor.view.dom as HTMLElement).clientWidth || 700;
    return Math.max(IMAGE_MIN_WIDTH, editorWidth);
  }

  // --- Notion-style edge grips ----------------------------------------------
  private addGrip(side: 'left' | 'right'): void {
    const g = document.createElement('span');
    g.className = `img-nv-grip ${side}`;
    g.addEventListener('mousedown', (e) => this.beginDrag(e, side));
    this.dom.appendChild(g);
  }

  private beginDrag(e: MouseEvent, side: 'left' | 'right'): void {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = this.img.getBoundingClientRect().width;
    const grows = side === 'right'; // dragging the right edge outward grows
    const max = this.maxWidth();
    let lastWidth = clampWidth(startW, IMAGE_MIN_WIDTH, max);
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      lastWidth = clampWidth(startW + (grows ? dx : -dx), IMAGE_MIN_WIDTH, max);
      this.img.style.width = `${lastWidth}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.setWidth(lastWidth);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // --- TipTap NodeView hooks ------------------------------------------------
  selectNode(): void {
    this.dom.classList.add('is-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected');
  }

  update(node: any): boolean {
    if (node.type.name !== this.node.type.name) return false;
    this.node = node;
    this.applyImg();
    return true;
  }

  ignoreMutation(): boolean {
    return true; // we manage our own DOM (grips)
  }

  destroy(): void {
    /* listeners are bound per-drag and removed on mouseup; nothing persistent */
  }
}
