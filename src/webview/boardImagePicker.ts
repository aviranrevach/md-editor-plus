import { saveImageBytes, pickProjectImage, embedImageFromClipboard, revealImage, fetchImageBytes } from './imageUpload';
import { resolveImageSrc } from './mediaResolve';
import { parseImageLinks, appendImageLink, removeImageLinkAt, replaceImageLinkAt } from './boardImageLinks';
import { compressImage } from './imageCompress';
import { sanitizeImageFileName, extensionForMime } from '../imageAssets';

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .bd-image-mgr { position: fixed; z-index: 10000; min-width: 220px; max-width: 300px;
      background: var(--bg, #fff); color: inherit; border: 1px solid var(--border, rgba(0,0,0,.12));
      border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 8px; }
    .bd-image-mgr-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .bd-image-mgr-thumbwrap { position: relative; width: 56px; height: 56px; }
    .bd-image-mgr-thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 6px;
      border: 1px solid var(--border); display: block; }
    .bd-image-mgr-broken { width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;
      border-radius: 6px; border: 1px dashed var(--border); color: var(--text-secondary); background: var(--block-hover); }
    .bd-image-mgr-del { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px;
      border-radius: 50%; border: none; background: #c0392b; color: #fff; font-size: 12px; line-height: 1;
      cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
    .bd-image-mgr-sep { height: 1px; background: var(--border); margin: 4px 0; }
    .bd-image-mgr-row { display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 8px 10px; border: none; background: transparent; color: inherit;
      font: inherit; font-size: 13px; border-radius: 6px; cursor: pointer; text-align: left; }
    .bd-image-mgr-row:hover { background: var(--block-hover, rgba(0,0,0,.05)); }
    .bd-image-mgr-err { color: #c0392b; font-size: 12px; padding: 4px 10px; }
    .bd-image-mgr-actions { position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%); display: flex; gap: 2px; }
    .bd-image-mgr-mini { width: 20px; height: 18px; border: none; border-radius: 4px; cursor: pointer; background: var(--bg, #fff); color: inherit; font-size: 11px; line-height: 1; box-shadow: 0 1px 4px rgba(0,0,0,.25); padding: 0; }
    .bd-image-mgr-mini:hover { background: var(--block-hover, rgba(0,0,0,.08)); }
  `;
  document.head.appendChild(style);
}

// Manage the images in a board image cell: view current images (each removable)
// and add new ones (upload / browse / clipboard). onChange is called with the
// full new cell value after every add or remove.
export function openBoardImageManager(
  anchor: HTMLElement,
  currentValue: string,
  onChange: (newValue: string) => void,
): void {
  injectStyles();
  let value = currentValue;

  const el = document.createElement('div');
  el.className = 'bd-image-mgr';
  document.body.appendChild(el);
  const rect = anchor.getBoundingClientRect();
  el.style.left = `${Math.min(rect.left, window.innerWidth - 320)}px`;
  el.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 320)}px`;

  let done = false;
  function finish(): void {
    if (done) return;
    done = true;
    el.remove();
    document.removeEventListener('mousedown', onDocDown, true);
  }
  function onDocDown(e: MouseEvent): void { if (!el.contains(e.target as Node)) finish(); }

  function commit(next: string): void { value = next; onChange(value); render(); }

  async function compressLink(index: number, src: string): Promise<void> {
    if (/^(?:https?:|data:)/i.test(src)) return; // only local assets
    try {
      const ext = (src.split('.').pop() || 'png').toLowerCase();
      const inputMime =
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : ext === 'png' ? 'image/png'
        : `image/${ext}`;
      const bytes = await fetchImageBytes(resolveImageSrc(src));
      const result = await compressImage(bytes, inputMime, { quality: 0.8 });
      if (!result.changed) return;
      const stem = (src.split('/').pop() || 'image').replace(/\.[^.]+$/, '');
      const name = sanitizeImageFileName(`${stem}.${extensionForMime(result.mime)}`);
      const newSrc = await saveImageBytes(name, result.bytes);
      if (newSrc) commit(replaceImageLinkAt(value, index, newSrc));
    } catch (err) {
      showError((err as Error).message);
    }
  }

  function showError(msg: string): void {
    const err = document.createElement('div');
    err.className = 'bd-image-mgr-err';
    err.textContent = msg;
    el.appendChild(err);
  }

  function render(): void {
    el.innerHTML = '';
    const links = parseImageLinks(value);
    if (links.length) {
      const grid = document.createElement('div');
      grid.className = 'bd-image-mgr-grid';
      links.forEach((link, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'bd-image-mgr-thumbwrap';
        const img = document.createElement('img');
        img.className = 'bd-image-mgr-thumb';
        img.src = resolveImageSrc(link.src);
        img.alt = link.alt;
        img.title = link.src;
        img.addEventListener('error', () => {
          // eslint-disable-next-line no-console
          console.warn('[md-editor-plus] board image failed to load', { raw: link.src, resolved: img.src });
          const broken = document.createElement('div');
          broken.className = 'bd-image-mgr-broken';
          broken.title = `couldn't load: ${link.src}`;
          broken.textContent = '⚠';
          img.replaceWith(broken);
        });
        const del = document.createElement('button');
        del.className = 'bd-image-mgr-del';
        del.textContent = '×';
        del.title = 'Remove';
        del.addEventListener('click', (e) => { e.stopPropagation(); commit(removeImageLinkAt(value, i)); });
        wrap.appendChild(img);
        wrap.appendChild(del);
        const actions = document.createElement('div');
        actions.className = 'bd-image-mgr-actions';
        const mkBtn = (label: string, title: string, fn: () => void) => {
          const b = document.createElement('button');
          b.className = 'bd-image-mgr-mini';
          b.textContent = label;
          b.title = title;
          b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
          actions.appendChild(b);
        };
        mkBtn('⤢', `Reveal in Finder: ${link.src}`, () => { void revealImage(link.src); });
        mkBtn('🗜', `Compress: ${link.src}`, () => { void compressLink(i, link.src); });
        wrap.appendChild(actions);
        grid.appendChild(wrap);
      });
      el.appendChild(grid);
      const sep = document.createElement('div');
      sep.className = 'bd-image-mgr-sep';
      el.appendChild(sep);
    }

    const addRow = (label: string, handler: () => void): void => {
      const btn = document.createElement('button');
      btn.className = 'bd-image-mgr-row';
      btn.textContent = label;
      btn.addEventListener('click', handler);
      el.appendChild(btn);
    };
    addRow('Upload from computer', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
      el.appendChild(input);
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try { const src = await saveImageBytes(file.name, await file.arrayBuffer()); if (src) commit(appendImageLink(value, src)); }
        catch (err) { showError((err as Error).message); }
      });
      input.click();
    });
    addRow('Browse project', async () => {
      try { const src = await pickProjectImage(); if (src) commit(appendImageLink(value, src)); }
      catch (err) { showError((err as Error).message); }
    });
    addRow('From clipboard', async () => {
      try { const src = await embedImageFromClipboard(); if (src) commit(appendImageLink(value, src)); }
      catch (err) { showError((err as Error).message); }
    });
  }

  render();
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}
