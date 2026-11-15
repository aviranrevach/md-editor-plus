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
import { getDocumentDir } from './docContext';
import { revealImage, copyImagePath } from './imageUpload';

const ICON_COPY = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg>';
const ICON_FOLDER = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72Zm0,128H40V56H92.69l27.31,27.31A15.86,15.86,0,0,0,131.31,88H216Z"/></svg>';

/** Absolute filesystem path of a document-relative image src, or null when the
 *  image is remote/inline (or the document has no folder, e.g. untitled). */
export function absoluteImagePath(src: string, docDir: string): string | null {
  if (!src || !docDir || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return null;
  let rel = src;
  try { rel = decodeURI(src); } catch { /* keep raw */ }
  rel = rel.replace(/[?#].*$/, '');
  const sep = docDir.includes('\\') && !docDir.includes('/') ? '\\' : '/';
  const parts = docDir.split(/[\\/]/);
  const root = parts[0] === '' ? '' : parts[0]; // '' for POSIX, 'C:' for Windows
  const stack = parts.slice(1).filter(Boolean);
  for (const seg of rel.split(/[\\/]/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return root + sep + stack.join(sep);
}

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
    .img-nv-path { display: flex; align-items: center; gap: 4px; margin-top: 4px; line-height: 1.3;
      font-size: 11px; color: var(--muted, #787774); user-select: none; -webkit-user-select: none; cursor: default; }
    .img-nv-path-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      direction: rtl; text-align: left; font-family: var(--font-mono, ui-monospace, monospace); }
    .img-nv-path-btn { flex: none; display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: transparent;
      color: inherit; cursor: pointer; }
    .img-nv-path-btn:hover { background: rgba(127, 127, 127, 0.2); color: var(--fg, inherit); }
    html.hide-image-paths .img-nv-path { display: none; }
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
  private pathRow: HTMLElement;
  private pathText!: HTMLElement;
  private relSrc = '';
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
    this.pathRow = this.buildPathRow();
    this.dom.appendChild(this.pathRow);
    this.applyPath();
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

  // Path caption under the image. contenteditable=false + user-select:none keep
  // it out of selections; ProseMirror's copy serialises the doc model (never
  // this DOM), so Select All / copy never include it.
  private buildPathRow(): HTMLElement {
    const row = document.createElement('span');
    row.className = 'img-nv-path';
    row.contentEditable = 'false';
    this.pathText = document.createElement('span');
    this.pathText.className = 'img-nv-path-text';
    row.appendChild(this.pathText);
    const mk = (icon: string, tip: string, run: () => Promise<void>) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'img-nv-path-btn';
      b.title = tip;
      b.setAttribute('aria-label', tip);
      b.innerHTML = icon;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); void run().catch(() => undefined); });
      row.appendChild(b);
    };
    mk(ICON_COPY, 'Copy path', () => copyImagePath(this.relSrc));
    mk(ICON_FOLDER, 'Reveal in Finder', () => revealImage(this.relSrc));
    return row;
  }

  private applyPath(): void {
    this.relSrc = this.node.attrs.src as string;
    const abs = absoluteImagePath(this.relSrc, getDocumentDir());
    this.pathRow.style.display = abs ? '' : 'none';
    if (abs) {
      // rtl + LRM keeps the filename visible when the path is truncated
      this.pathText.textContent = '\u200E' + abs;
      this.pathText.title = abs;
    }
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
    this.applyPath();
    return true;
  }

  ignoreMutation(): boolean {
    return true; // we manage our own DOM (grips)
  }

  destroy(): void {
    /* listeners are bound per-drag and removed on mouseup; nothing persistent */
  }
}
