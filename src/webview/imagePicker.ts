import type { Editor } from '@tiptap/core';
import { saveImageBytes, listWorkspaceImages, WorkspaceImage } from './imageUpload';

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .image-picker { position: fixed; z-index: 10000; min-width: 280px; max-width: 360px;
      background: var(--mb-popover-bg, #fff); color: inherit;
      border: 1px solid rgba(0,0,0,.12); border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 8px; display: none; }
    .image-picker.open { display: block; }
    .image-picker-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
    .image-picker-tab { flex: 1; padding: 6px 8px; font-size: 12px; border-radius: 6px;
      border: none; background: transparent; cursor: pointer; color: inherit; }
    .image-picker-tab.active { background: rgba(35,131,226,.12); color: #2383e2; font-weight: 600; }
    .image-picker-body { font-size: 13px; }
    .image-picker-upload-btn { width: 100%; padding: 10px; border-radius: 8px;
      border: 1px dashed rgba(0,0,0,.25); background: transparent; cursor: pointer; color: inherit; }
    .image-picker-url-input { width: 100%; box-sizing: border-box; padding: 8px 10px;
      border-radius: 8px; border: 1px solid rgba(0,0,0,.18); background: transparent; color: inherit; }
    .image-picker-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
      max-height: 220px; overflow: auto; }
    .image-picker-thumb { aspect-ratio: 1; border-radius: 6px; overflow: hidden; cursor: pointer;
      border: 1px solid rgba(0,0,0,.1); background: rgba(0,0,0,.03); }
    .image-picker-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .image-picker-empty { padding: 16px; text-align: center; opacity: .6; font-size: 12px; }
    .image-picker-error { color: #c0392b; font-size: 12px; padding: 6px 2px; }
  `;
  document.head.appendChild(style);
}

type Tab = 'upload' | 'browse' | 'link';

export function openImagePicker(editor: Editor, pos: number, onPick: (src: string) => void): void {
  injectStyles();

  const el = document.createElement('div');
  el.className = 'image-picker';
  el.innerHTML = `
    <div class="image-picker-tabs">
      <button class="image-picker-tab active" data-tab="upload">Upload</button>
      <button class="image-picker-tab" data-tab="browse">Browse project</button>
      <button class="image-picker-tab" data-tab="link">Embed link</button>
    </div>
    <div class="image-picker-body"></div>
  `;
  document.body.appendChild(el);
  const tabsEl = el.querySelector<HTMLElement>('.image-picker-tabs')!;
  const body = el.querySelector<HTMLElement>('.image-picker-body')!;

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
    err.className = 'image-picker-error';
    err.textContent = msg;
    body.appendChild(err);
  }

  function renderUpload(): void {
    body.innerHTML = '<button class="image-picker-upload-btn">Choose an image…</button>';
    const btn = body.querySelector<HTMLButtonElement>('.image-picker-upload-btn')!;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    el.appendChild(fileInput);
    btn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      btn.textContent = 'Saving…';
      btn.disabled = true;
      try {
        const buffer = await file.arrayBuffer();
        const relPath = await saveImageBytes(file.name, buffer);
        finish(relPath);
      } catch (err) {
        btn.textContent = 'Choose an image…';
        btn.disabled = false;
        showError((err as Error).message);
      }
    });
  }

  function renderLink(): void {
    body.innerHTML = '<input class="image-picker-url-input" placeholder="Paste image URL, press Enter" />';
    const input = body.querySelector<HTMLInputElement>('.image-picker-url-input')!;
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = input.value.trim();
        if (url) finish(url);
      } else if (e.key === 'Escape') {
        finish();
      }
    });
  }

  async function renderBrowse(): Promise<void> {
    body.innerHTML = '<div class="image-picker-empty">Loading project images…</div>';
    let images: WorkspaceImage[] = [];
    try {
      images = await listWorkspaceImages();
    } catch (err) {
      body.innerHTML = '';
      showError((err as Error).message);
      return;
    }
    if (done) return;
    if (!images.length) {
      body.innerHTML = '<div class="image-picker-empty">No images found in this workspace yet.</div>';
      return;
    }
    body.innerHTML = '<div class="image-picker-grid"></div>';
    const grid = body.querySelector<HTMLElement>('.image-picker-grid')!;
    images.forEach((img) => {
      const cell = document.createElement('div');
      cell.className = 'image-picker-thumb';
      cell.title = img.label;
      const im = document.createElement('img');
      im.src = img.webviewUri;
      cell.appendChild(im);
      cell.addEventListener('click', () => finish(img.relPath));
      grid.appendChild(cell);
    });
  }

  function selectTab(tab: Tab): void {
    tabsEl.querySelectorAll<HTMLElement>('.image-picker-tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.tab === tab));
    if (tab === 'upload') renderUpload();
    else if (tab === 'link') renderLink();
    else void renderBrowse();
  }

  tabsEl.querySelectorAll<HTMLElement>('.image-picker-tab').forEach((t) => {
    t.addEventListener('click', () => selectTab(t.dataset.tab as Tab));
  });

  // Position near the insertion caret; fall back to viewport center.
  let left = window.innerWidth / 2 - 150;
  let top = window.innerHeight / 2 - 80;
  try {
    const coords = editor.view.coordsAtPos(pos);
    left = Math.min(coords.left, window.innerWidth - 380);
    top = coords.bottom + 6;
  } catch { /* use fallback */ }
  el.style.left = `${Math.max(12, left)}px`;
  el.style.top = `${Math.max(12, top)}px`;
  el.classList.add('open');

  selectTab('upload');
  // Defer the outside-click listener so the opening click doesn't immediately close it.
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}
