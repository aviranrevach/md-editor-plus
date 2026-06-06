// NodeView for the body image: renders the <img> plus, when selected, a floating
// toolbar (source/replace/size/compress/reveal/remove) and corner drag-handles.
// Sizes are committed to the node's `width` attribute, which the markdown
// serializer turns into a portable <img width> tag.
import type { Editor } from '@tiptap/core';
import { resolveImageSrc } from './mediaResolve';
import { clampWidth } from './imageMarkdown';
import { compressImage } from './imageCompress';
import {
  saveImageBytes,
  pickProjectImage,
  embedImageFromClipboard,
  revealImage,
  fetchImageBytes,
} from './imageUpload';
import { sanitizeImageFileName, extensionForMime } from '../imageAssets';

export const IMAGE_MIN_WIDTH = 80;
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
    .img-nv.is-selected > img { outline: 2px solid var(--accent, #2383e2); outline-offset: 2px; }
    .img-nv-handle { position: absolute; width: 12px; height: 12px; background: var(--accent, #2383e2);
      border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.15); z-index: 6; }
    .img-nv-handle.nw { top: -6px; left: -6px; cursor: nwse-resize; }
    .img-nv-handle.ne { top: -6px; right: -6px; cursor: nesw-resize; }
    .img-nv-handle.sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
    .img-nv-handle.se { bottom: -6px; right: -6px; cursor: nwse-resize; }
    .img-nv-toolbar { position: absolute; top: -42px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 2px; padding: 4px; z-index: 7;
      background: var(--bg, #fff); border: 1px solid var(--border, rgba(0,0,0,.12));
      border-radius: 8px; box-shadow: 0 6px 22px rgba(0,0,0,.18); white-space: nowrap; }
    .img-nv-btn { border: none; background: transparent; color: inherit; font: inherit;
      font-size: 12px; padding: 4px 8px; border-radius: 5px; cursor: pointer; line-height: 1.2; }
    .img-nv-btn:hover { background: var(--block-hover, rgba(0,0,0,.06)); }
    .img-nv-sep { width: 1px; align-self: stretch; background: var(--border, rgba(0,0,0,.12)); margin: 2px 2px; }
    .img-nv-src { max-width: 180px; overflow: hidden; text-overflow: ellipsis; opacity: .7;
      font-size: 11px; padding: 4px 6px; }
    .img-nv-submenu { position: absolute; top: 100%; left: 0; margin-top: 4px; display: flex;
      flex-direction: column; min-width: 160px; background: var(--bg, #fff);
      border: 1px solid var(--border, rgba(0,0,0,.12)); border-radius: 8px;
      box-shadow: 0 6px 22px rgba(0,0,0,.18); padding: 4px; }
    .img-nv-submenu button { text-align: left; }
  `;
  document.head.appendChild(style);
}

interface NodeViewCtx {
  node: any;
  editor: Editor;
  getPos: () => number;
}

export function imageNodeViewFactory() {
  return (ctx: NodeViewCtx) => new ImageNodeView(ctx);
}

class ImageNodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private node: any;
  private editor: Editor;
  private getPos: () => number;
  private selected = false;
  private toolbar: HTMLElement | null = null;
  private submenu: HTMLElement | null = null;

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
    this.editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, width });
      return true;
    });
  }

  private setSrc(src: string, width: number | null): void {
    const pos = this.getPos();
    this.editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, src, width });
      return true;
    });
  }

  private remove(): void {
    const pos = this.getPos();
    this.editor.commands.command(({ tr }) => {
      tr.delete(pos, pos + this.node.nodeSize);
      return true;
    });
  }

  private maxWidth(): number {
    const editorWidth = (this.editor.view.dom as HTMLElement).clientWidth || 700;
    return Math.max(IMAGE_MIN_WIDTH, editorWidth);
  }

  // --- drag handles ---------------------------------------------------------
  private addHandle(corner: 'nw' | 'ne' | 'sw' | 'se'): void {
    const h = document.createElement('span');
    h.className = `img-nv-handle ${corner}`;
    h.addEventListener('mousedown', (e) => this.beginDrag(e, corner));
    this.dom.appendChild(h);
  }

  private beginDrag(e: MouseEvent, corner: 'nw' | 'ne' | 'sw' | 'se'): void {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = this.img.getBoundingClientRect().width;
    const grows = corner === 'ne' || corner === 'se'; // dragging right edge grows
    const max = this.maxWidth();
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next = clampWidth(startW + (grows ? dx : -dx), IMAGE_MIN_WIDTH, max);
      this.img.style.width = `${next}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const committed = clampWidth(this.img.getBoundingClientRect().width, IMAGE_MIN_WIDTH, max);
      this.setWidth(committed);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // --- toolbar --------------------------------------------------------------
  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'img-nv-btn';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep node selected
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  private closeSubmenu(): void {
    this.submenu?.remove();
    this.submenu = null;
  }

  private openReplaceMenu(anchor: HTMLElement): void {
    this.closeSubmenu();
    const menu = document.createElement('div');
    menu.className = 'img-nv-submenu';
    const add = (label: string, fn: () => Promise<void>) => {
      const b = this.button(label, () => { this.closeSubmenu(); void fn(); });
      menu.appendChild(b);
    };
    add('Upload from computer', async () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        const src = await saveImageBytes(file.name, await file.arrayBuffer());
        if (src) this.setSrc(src, null);
      });
      input.click();
    });
    add('Browse project', async () => {
      const src = await pickProjectImage();
      if (src) this.setSrc(src, null);
    });
    add('From clipboard', async () => {
      const src = await embedImageFromClipboard();
      if (src) this.setSrc(src, null);
    });
    anchor.appendChild(menu);
    this.submenu = menu;
  }

  private async compress(): Promise<void> {
    const rawSrc = this.node.attrs.src as string;
    // Only local assets can be overwritten; skip http/data URLs.
    if (/^(?:https?:|data:)/i.test(rawSrc)) return;
    const resolved = resolveImageSrc(rawSrc);
    const guessMime = `image/${extensionForMime(`image/${(rawSrc.split('.').pop() || '').toLowerCase()}`)}`;
    try {
      const bytes = await fetchImageBytes(resolved);
      // Derive input mime from the file extension.
      const ext = (rawSrc.split('.').pop() || 'png').toLowerCase();
      const inputMime =
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : ext === 'png' ? 'image/png'
        : `image/${ext}`;
      const result = await compressImage(bytes, inputMime, { quality: 0.8 });
      if (!result.changed) return;
      // New filename: original stem + new extension (PNG->webp changes ext).
      const stem = (rawSrc.split('/').pop() || 'image').replace(/\.[^.]+$/, '');
      const name = sanitizeImageFileName(`${stem}.${extensionForMime(result.mime)}`);
      const newSrc = await saveImageBytes(name, result.bytes);
      if (newSrc) this.setSrc(newSrc, this.node.attrs.width ?? null);
    } catch {
      /* swallow: compress is best-effort, never corrupts the asset */
      void guessMime;
    }
  }

  private buildToolbar(): void {
    const bar = document.createElement('div');
    bar.className = 'img-nv-toolbar';
    bar.addEventListener('mousedown', (e) => e.preventDefault());

    const src = document.createElement('span');
    src.className = 'img-nv-src';
    src.textContent = (this.node.attrs.src as string) || '';
    src.title = (this.node.attrs.src as string) || '';
    bar.appendChild(src);

    bar.appendChild(this.sep());
    const replaceBtn = this.button('Replace', () => {
      if (this.submenu) this.closeSubmenu();
      else this.openReplaceMenu(replaceBtn);
    });
    replaceBtn.style.position = 'relative';
    bar.appendChild(replaceBtn);

    bar.appendChild(this.sep());
    for (const p of IMAGE_SIZE_PRESETS) {
      bar.appendChild(this.button(p.label, () => this.setWidth(p.px)));
    }
    bar.appendChild(this.button('Full', () => this.setWidth(null)));

    bar.appendChild(this.sep());
    bar.appendChild(this.button('Compress', () => { void this.compress(); }));
    bar.appendChild(this.button('Reveal', () => {
      void revealImage(this.node.attrs.src as string);
    }));
    bar.appendChild(this.button('Remove', () => this.remove()));

    this.dom.appendChild(bar);
    this.toolbar = bar;
  }

  private sep(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'img-nv-sep';
    return s;
  }

  private showChrome(): void {
    if (this.toolbar) return;
    this.dom.classList.add('is-selected');
    this.buildToolbar();
    (['nw', 'ne', 'sw', 'se'] as const).forEach((c) => this.addHandle(c));
  }

  private hideChrome(): void {
    this.dom.classList.remove('is-selected');
    this.closeSubmenu();
    this.toolbar?.remove();
    this.toolbar = null;
    this.dom.querySelectorAll('.img-nv-handle').forEach((h) => h.remove());
  }

  // --- TipTap NodeView hooks ------------------------------------------------
  selectNode(): void {
    this.selected = true;
    this.showChrome();
  }

  deselectNode(): void {
    this.selected = false;
    this.hideChrome();
  }

  update(node: any): boolean {
    if (node.type.name !== this.node.type.name) return false;
    this.node = node;
    this.applyImg();
    if (this.selected && this.toolbar) {
      const srcEl = this.toolbar.querySelector('.img-nv-src') as HTMLElement | null;
      if (srcEl) { srcEl.textContent = node.attrs.src || ''; srcEl.title = node.attrs.src || ''; }
    }
    return true;
  }

  ignoreMutation(): boolean {
    return true; // we manage our own DOM (toolbar/handles)
  }

  destroy(): void {
    this.hideChrome();
  }
}
