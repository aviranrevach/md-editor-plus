import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { computeDiffMarks, type BlockSide, type DiffMark } from './diffMapCore';
import { createDiffEditor } from './editor';

export interface DiffMap {
  setBase: (markdown: string) => void;
  recompute: () => void;
  destroy: () => void;
}

const SCROLL_OFFSET = 80; // matches the rail's jump offset
const LABEL: Record<DiffMark['kind'], string> = { add: 'Added', change: 'Modified', del: 'Removed' };

export function createDiffMap(opts: { editor: Editor; railEl: HTMLElement }): DiffMap {
  const { editor, railEl } = opts;
  let baseBlocks: string[] = [];

  const marksLayer = document.createElement('div');
  marksLayer.className = 'diff-map-marks';
  railEl.appendChild(marksLayer); // sibling of the structure-map ticks/viewport layers

  // Serialize one top-level node to markdown via tiptap-markdown's serializer.
  function serializeNode(node: PMNode): string {
    try {
      return (editor.storage.markdown.serializer.serialize(node) as string).trim();
    } catch {
      return node.textContent.trim();
    }
  }

  // Render base markdown through a throwaway read-only editor — the SAME load path
  // the live editor uses (createDiffEditor does the frontmatter/board/callout
  // preprocessing + parse) — then serialize each top-level node. So base + current
  // blocks are normalized identically.
  //
  // We deliberately do NOT call `editor.storage.markdown.parser.parse(md).forEach`:
  // tiptap-markdown's parser.parse() returns an HTML *string*, not a ProseMirror
  // node, so `.forEach` threw and the old catch silently returned [] — leaving the
  // base side empty and marking every block as "added".
  function blocksFromMarkdown(markdown: string): string[] {
    const el = document.createElement('div');
    const tmp = createDiffEditor(el, markdown);
    try {
      const out: string[] = [];
      tmp.state.doc.forEach((node) => {
        try { out.push((tmp.storage.markdown.serializer.serialize(node) as string).trim()); }
        catch { out.push(node.textContent.trim()); }
      });
      return out;
    } finally {
      tmp.destroy();
    }
  }

  function currentBlocks(): BlockSide[] {
    const out: BlockSide[] = [];
    const doc = editor.view.state.doc;
    doc.forEach((node, offset) => {
      const pos = offset + 1; // inside the node
      let docY = 0;
      try { docY = editor.view.coordsAtPos(pos).top + window.scrollY; } catch { return; }
      out.push({ md: serializeNode(node), docY, pos });
    });
    return out;
  }

  function paint(marks: DiffMark[]): void {
    marksLayer.replaceChildren(...marks.map((m) => {
      const docHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight);
      const el = document.createElement('div');
      el.className = `diff-mark ${m.kind}`;
      el.style.top = `${(m.docY / docHeight) * 100}%`;
      el.dataset.tip = LABEL[m.kind];
      el.dataset.docy = String(m.docY);
      if (m.pos !== undefined) el.dataset.pos = String(m.pos);
      return el;
    }));
  }

  function recompute(): void {
    const result = computeDiffMarks({ baseBlocks, currentBlocks: currentBlocks() });
    paint(result.marks);
  }

  function setBase(markdown: string): void {
    baseBlocks = blocksFromMarkdown(markdown);
    recompute();
  }

  function onMarkClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.diff-mark');
    if (!el) return;
    e.stopPropagation(); // don't also trigger the rail's click-to-fraction

    if (el.dataset.pos !== undefined) {
      // jump to a real block position
      try {
        const top = editor.view.coordsAtPos(Number(el.dataset.pos)).top + window.scrollY - SCROLL_OFFSET;
        window.scrollTo({ top, behavior: 'smooth' });
      } catch { /* stale pos */ }
    } else if (el.dataset.docy !== undefined) {
      // jump to a deletion seam (no real pos, scroll to docY directly)
      window.scrollTo({ top: Math.max(0, Number(el.dataset.docy) - SCROLL_OFFSET), behavior: 'smooth' });
    }
  }
  marksLayer.addEventListener('click', onMarkClick);

  return {
    setBase,
    recompute,
    destroy() { marksLayer.removeEventListener('click', onMarkClick); marksLayer.remove(); },
  };
}
