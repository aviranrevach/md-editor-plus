// Image bubble menu — the controls shown when a body image is selected.
// Reuses the editor's bubble-menu chrome (.bubble-menu / .bubble-row / .bm-btn /
// .bubble-into / .bm-into-item) so it looks identical to the text formatting menu
// and only one ever shows at a time (the text menu suppresses itself on a node
// selection — see bubbleMenu.ts). Freeform drag-resize lives in the NodeView;
// this menu owns replace / size presets / compress / reveal / remove.
import { Editor } from '@tiptap/core';
import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';
import { PluginKey } from '@tiptap/pm/state';
import { NodeSelection } from '@tiptap/pm/state';
import { resolveImageSrc } from './mediaResolve';
import { compressImage } from './imageCompress';
import {
  saveImageBytes,
  pickProjectImage,
  embedImageFromClipboard,
  revealImage,
  fetchImageBytes,
} from './imageUpload';
import { sanitizeImageFileName, extensionForMime } from '../imageAssets';
import { IMAGE_SIZE_PRESETS } from './imageNodeView';

// Phosphor (256-viewBox, fill) icons — same set/style the bubble menu uses.
const ICON = {
  image:     `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z"/></svg>`,
  upload:    `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M74.34,85.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,51.31V152a8,8,0,0,1-16,0V51.31L85.66,85.66A8,8,0,0,1,74.34,85.66ZM216,144a8,8,0,0,0-8,8v48H48V152a8,8,0,0,0-16,0v48a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V152A8,8,0,0,0,216,144Z"/></svg>`,
  folder:    `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72Zm0,128H40V56H92.69l27.31,27.31A15.86,15.86,0,0,0,131.31,88H216Z"/></svg>`,
  clipboard: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M200,32H163.74a47.92,47.92,0,0,0-71.48,0H56A16,16,0,0,0,40,48V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm-72,0a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Zm72,184H56V48H82.75A47.93,47.93,0,0,0,80,64v8a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V64a47.93,47.93,0,0,0-2.75-16H200Z"/></svg>`,
  trash:     `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M216 48h-40v-8a24 24 0 0 0-24-24h-48a24 24 0 0 0-24 24v8H40a8 8 0 0 0 0 16h8v144a16 16 0 0 0 16 16h128a16 16 0 0 0 16-16V64h8a8 8 0 0 0 0-16ZM96 40a8 8 0 0 1 8-8h48a8 8 0 0 1 8 8v8H96Zm16 152a8 8 0 0 1-16 0v-72a8 8 0 0 1 16 0Zm48 0a8 8 0 0 1-16 0v-72a8 8 0 0 1 16 0Z"/></svg>`,
  // Corners-pulling-in = compress/minimize.
  compress:  `<svg width="20" height="20" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"><polyline points="100,44 100,100 44,100"/><polyline points="156,44 156,100 212,100"/><polyline points="100,212 100,156 44,156"/><polyline points="156,212 156,156 212,156"/></svg>`,
} as const;

const DIV = `<span class="bm-div"></span>`;

function sizeButtonsHtml(): string {
  const presets = IMAGE_SIZE_PRESETS
    .map((p) => `<button class="bm-btn" data-size="${p.px}" data-tip="${p.label} · ${p.px}px"><span class="bm-into-text" style="font-weight:700;font-size:13px">${p.label}</span></button>`)
    .join('');
  return `${presets}<button class="bm-btn" data-size="full" data-tip="Full width"><span class="bm-into-text" style="font-weight:700;font-size:12px;letter-spacing:-.2px">Full</span></button>`;
}

function buildEl(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bubble-menu';
  el.innerHTML = `
    <div class="bubble-row">
      <button class="bm-btn" data-action="replace" data-tip="Replace image">${ICON.image}</button>
      ${DIV}
      ${sizeButtonsHtml()}
      ${DIV}
      <button class="bm-btn" data-action="compress" data-tip="Compress (smaller file)">${ICON.compress}</button>
      <button class="bm-btn" data-action="reveal" data-tip="Reveal in Finder">${ICON.folder}</button>
      <button class="bm-btn" data-action="remove" data-tip="Remove image">${ICON.trash}</button>
    </div>
    <div class="bubble-into hidden" id="img-replace">
      <div class="bubble-into-title">Replace with</div>
      <div class="bubble-into-list">
        <button class="bm-into-item" data-replace="upload"><span class="bm-into-icon">${ICON.upload}</span><span class="bm-into-label">Upload from computer</span></button>
        <button class="bm-into-item" data-replace="browse"><span class="bm-into-icon">${ICON.folder}</span><span class="bm-into-label">Browse project</span></button>
        <button class="bm-into-item" data-replace="clipboard"><span class="bm-into-icon">${ICON.clipboard}</span><span class="bm-into-label">From clipboard</span></button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  return el;
}

export function createImageBubbleMenu(editor: Editor): void {
  const el = buildEl();
  const replacePanel = el.querySelector<HTMLElement>('#img-replace')!;
  const replaceBtn = el.querySelector<HTMLElement>('[data-action="replace"]')!;

  function selectedImagePos(): number | null {
    const sel = editor.state.selection;
    if (sel instanceof NodeSelection && sel.node.type.name === 'image') return sel.from;
    return null;
  }

  // Patch the image node living at `pos` (re-read live so it survives async gaps).
  function patchAt(pos: number, attrs: Record<string, unknown>): void {
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'image') return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }),
    );
  }

  function closeReplace(): void {
    replacePanel.classList.add('hidden');
    replaceBtn.classList.remove('active');
  }

  function setSize(value: string): void {
    const pos = selectedImagePos();
    if (pos == null) return;
    patchAt(pos, { width: value === 'full' ? null : parseInt(value, 10) });
  }

  async function replaceVia(kind: 'upload' | 'browse' | 'clipboard'): Promise<void> {
    const pos = selectedImagePos();
    if (pos == null) return;
    let src: string | null = null;
    if (kind === 'browse') src = await pickProjectImage();
    else if (kind === 'clipboard') src = (await embedImageFromClipboard()) || null;
    else {
      src = await new Promise<string | null>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          input.remove();
          if (!file) return resolve(null);
          try { resolve(await saveImageBytes(file.name, await file.arrayBuffer())); }
          catch { resolve(null); }
        });
        input.click();
      });
    }
    if (src) patchAt(pos, { src, width: null });
  }

  async function compress(): Promise<void> {
    const pos = selectedImagePos();
    if (pos == null) return;
    const node = editor.state.doc.nodeAt(pos);
    const rawSrc = (node?.attrs.src as string) || '';
    if (!rawSrc || /^(?:https?:|data:)/i.test(rawSrc)) return; // local assets only
    try {
      const ext = (rawSrc.split('.').pop() || 'png').toLowerCase();
      const inputMime =
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : ext === 'png' ? 'image/png'
        : `image/${ext}`;
      const bytes = await fetchImageBytes(resolveImageSrc(rawSrc));
      const result = await compressImage(bytes, inputMime, { quality: 0.8 });
      if (!result.changed) return;
      const stem = (rawSrc.split('/').pop() || 'image').replace(/\.[^.]+$/, '');
      const name = sanitizeImageFileName(`${stem}.${extensionForMime(result.mime)}`);
      const newSrc = await saveImageBytes(name, result.bytes);
      if (newSrc) patchAt(pos, { src: newSrc });
    } catch {
      /* best-effort: never corrupt the asset */
    }
  }

  function reveal(): void {
    const pos = selectedImagePos();
    if (pos == null) return;
    const src = (editor.state.doc.nodeAt(pos)?.attrs.src as string) || '';
    if (!src || /^(?:https?:|data:)/i.test(src)) return;
    void revealImage(src);
  }

  function remove(): void {
    if (selectedImagePos() == null) return;
    editor.chain().focus().deleteSelection().run();
  }

  editor.registerPlugin(
    BubbleMenuPlugin({
      pluginKey: new PluginKey('imageBubbleMenu'),
      editor,
      element: el,
      tippyOptions: { duration: 100, placement: 'top' },
      shouldShow: ({ state }) =>
        state.selection instanceof NodeSelection &&
        state.selection.node.type.name === 'image',
    }),
  );

  // Keep the node selected on mousedown so actions can read the selection.
  el.addEventListener('mousedown', (e) => e.preventDefault());

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    const replaceItem = target.closest<HTMLElement>('[data-replace]');
    if (replaceItem) {
      e.stopPropagation();
      closeReplace();
      void replaceVia(replaceItem.dataset.replace as 'upload' | 'browse' | 'clipboard');
      return;
    }

    const sizeBtn = target.closest<HTMLElement>('[data-size]');
    if (sizeBtn) {
      e.stopPropagation();
      setSize(sizeBtn.dataset.size!);
      closeReplace();
      return;
    }

    const btn = target.closest<HTMLElement>('[data-action]');
    if (!btn) return;
    e.stopPropagation();
    switch (btn.dataset.action) {
      case 'replace': {
        const open = !replacePanel.classList.contains('hidden');
        if (open) closeReplace();
        else { replacePanel.classList.remove('hidden'); replaceBtn.classList.add('active'); }
        break;
      }
      case 'compress': closeReplace(); void compress(); break;
      case 'reveal':   closeReplace(); reveal(); break;
      case 'remove':   closeReplace(); remove(); break;
    }
  });

  // Reset the replace panel whenever the image is deselected.
  editor.on('transaction', () => {
    if (selectedImagePos() == null) closeReplace();
  });
}
