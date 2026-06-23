import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { computeDiffMarks, type BlockSide, type DiffMark } from './diffMapCore';
import { preprocessMarkdownBoards } from './extensions/board';
import { preprocessMarkdownCallouts } from './extensions/callout';
import { splitFrontmatter } from './frontmatter';

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

  // Parse base markdown the SAME way the editor loads content, then serialize each
  // top-level node — so base + current blocks are normalized identically.
  function blocksFromMarkdown(markdown: string): string[] {
    const body = splitFrontmatter(markdown).body;
    const pre = preprocessMarkdownBoards(preprocessMarkdownCallouts(body));
    try {
      const doc = editor.storage.markdown.parser.parse(pre) as PMNode;
      const out: string[] = [];
      doc.forEach((node) => { out.push(serializeNode(node)); });
      return out;
    } catch {
      return [];
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
    if (!el || el.dataset.pos === undefined) return;
    e.stopPropagation(); // don't also trigger the rail's click-to-fraction
    try {
      const top = editor.view.coordsAtPos(Number(el.dataset.pos)).top + window.scrollY - SCROLL_OFFSET;
      window.scrollTo({ top, behavior: 'smooth' });
    } catch { /* stale pos */ }
  }
  marksLayer.addEventListener('click', onMarkClick);

  return {
    setBase,
    recompute,
    destroy() { marksLayer.removeEventListener('click', onMarkClick); marksLayer.remove(); },
  };
}
