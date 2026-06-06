import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { saveImageBytes } from '../imageUpload';
import { pastedImageName } from '../../imageAssets';

export interface PendingImage {
  name: string;
  file: File;
}

// Extract image files from a clipboard/drag DataTransfer. Prefers `.items`
// (clipboard paste), falls back to `.files` (OS file drop). Clipboard images
// carry no filename, so those get a pasted-<date> name from their MIME type.
export function imageFilesFrom(dt: DataTransfer | null): PendingImage[] {
  if (!dt) return [];
  const out: PendingImage[] = [];
  const nameFor = (f: File): string =>
    f.name && f.name.length ? f.name : pastedImageName(f.type, new Date());

  const items = dt.items;
  if (items && items.length) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) out.push({ file: f, name: nameFor(f) });
      }
    }
  }
  if (!out.length && dt.files && dt.files.length) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files[i];
      if (f.type.startsWith('image/')) out.push({ file: f, name: nameFor(f) });
    }
  }
  return out;
}

// Save each image and insert it inline starting at `pos`. Errors are logged,
// not thrown — one bad file shouldn't abort the rest or break the editor.
async function ingest(editor: Editor, images: PendingImage[], pos: number): Promise<void> {
  let at = pos;
  for (const { name, file } of images) {
    try {
      const buffer = await file.arrayBuffer();
      const src = await saveImageBytes(name, buffer);
      editor.chain().focus().insertContentAt(at, { type: 'image', attrs: { src, alt: '' } }).run();
      at = editor.state.selection.to;
    } catch (err) {
      console.error('[md-editor-plus] image paste/drop failed', err);
    }
  }
}

const ImagePasteDrop = Extension.create({
  name: 'imagePasteDrop',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const images = imageFilesFrom(event.clipboardData);
            if (!images.length) return false; // let normal paste happen
            event.preventDefault();
            void ingest(editor, images, view.state.selection.from);
            return true;
          },
          handleDrop(view, event) {
            const images = imageFilesFrom(event.dataTransfer);
            if (!images.length) return false; // let block-drag / text drop happen
            event.preventDefault();
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const pos = coords ? coords.pos : view.state.selection.from;
            void ingest(editor, images, pos);
            return true;
          },
        },
      }),
    ];
  },
});

export default ImagePasteDrop;
