import { saveImageBytes, pickProjectImage, embedImageFromClipboard } from './imageUpload';

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .bd-image-picker { position: fixed; z-index: 10000; min-width: 200px;
      background: var(--bg, #fff); color: inherit; border: 1px solid var(--border, rgba(0,0,0,.12));
      border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 6px; }
    .bd-image-picker-row { display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 8px 10px; border: none; background: transparent; color: inherit;
      font: inherit; font-size: 13px; border-radius: 6px; cursor: pointer; text-align: left; }
    .bd-image-picker-row:hover { background: var(--block-hover, rgba(0,0,0,.05)); }
    .bd-image-picker-err { color: #c0392b; font-size: 12px; padding: 6px 10px; }
  `;
  document.head.appendChild(style);
}

// Opens a small menu anchored to `anchor`. When the user picks an image, calls
// onPick(src) with the resolved relative path (or URL), letting the caller
// append it to the cell value and persist.
export function openBoardImagePicker(anchor: HTMLElement, onPick: (src: string) => void): void {
  injectStyles();
  const el = document.createElement('div');
  el.className = 'bd-image-picker';
  el.innerHTML = `
    <button class="bd-image-picker-row" data-act="upload">Upload from computer</button>
    <button class="bd-image-picker-row" data-act="browse">Browse project</button>
    <button class="bd-image-picker-row" data-act="clipboard">From clipboard</button>
  `;
  document.body.appendChild(el);

  const rect = anchor.getBoundingClientRect();
  el.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
  el.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 160)}px`;

  let done = false;
  function finish(src?: string): void {
    if (done) return;
    done = true;
    el.remove();
    document.removeEventListener('mousedown', onDocDown, true);
    if (src) onPick(src);
  }
  function onDocDown(e: MouseEvent): void {
    if (!el.contains(e.target as Node)) finish();
  }
  function showError(msg: string): void {
    const err = document.createElement('div');
    err.className = 'bd-image-picker-err';
    err.textContent = msg;
    el.appendChild(err);
  }

  el.querySelector('[data-act="upload"]')!.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    el.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try { finish(await saveImageBytes(file.name, await file.arrayBuffer())); }
      catch (err) { showError((err as Error).message); }
    });
    input.click();
  });
  el.querySelector('[data-act="browse"]')!.addEventListener('click', async () => {
    try { const src = await pickProjectImage(); if (src) finish(src); else finish(); }
    catch (err) { showError((err as Error).message); }
  });
  el.querySelector('[data-act="clipboard"]')!.addEventListener('click', async () => {
    try { finish(await embedImageFromClipboard()); }
    catch (err) { showError((err as Error).message); }
  });

  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}
