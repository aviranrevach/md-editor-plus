import editorCss from './styles/editor.css';
import lightCss from './styles/notion-light.css';
import darkCss from './styles/notion-dark.css';
import boardCss from './styles/board.css';
import diffCss from './styles/diff.css';
import { createDiffEditor } from './editor';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { splitFrontmatter } from './frontmatter';
import { preprocessMarkdownBoards } from './extensions/board';
import { preprocessMarkdownCallouts } from './extensions/callout';
import { computeAlignment, AlignRow } from './diffAlign';

interface InitMsg { type: 'init'; base: string; baseLabel: string; current: string; }

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

let leftEditor: Editor | null = null;
let rightEditor: Editor | null = null;
let lastInit: InitMsg | null = null;
let alignWired = false;

// Split markdown into normalized top-level block strings using an editor's own
// parser+serializer, so base and current compare identically (c55).
function blocksOf(editor: Editor, markdown: string): string[] {
  const body = splitFrontmatter(markdown).body;
  const pre = preprocessMarkdownBoards(preprocessMarkdownCallouts(body));
  try {
    const doc = editor.storage.markdown.parser.parse(pre) as PMNode;
    const out: string[] = [];
    doc.forEach((node) => {
      try { out.push((editor.storage.markdown.serializer.serialize(node) as string).trim()); }
      catch { out.push(node.textContent.trim()); }
    });
    return out;
  } catch { return []; }
}

// Map a top-level block index → its DOM element in a rendered pane. ProseMirror
// renders each top-level node as a direct child of the .ProseMirror element.
function blockElements(editor: Editor): HTMLElement[] {
  const root = editor.view.dom as HTMLElement;
  return Array.from(root.children) as HTMLElement[];
}

// --- Filler alignment ---

function clearFillers(): void {
  document.querySelectorAll('.diff-filler').forEach((f) => f.remove());
}

function filler(height: number): HTMLElement {
  const f = document.createElement('div');
  f.className = 'diff-filler';
  f.style.height = `${Math.max(0, height)}px`;
  return f;
}

function nextRightEl(rows: AlignRow[], row: AlignRow, rightEls: HTMLElement[]): HTMLElement | null {
  const idx = rows.indexOf(row);
  for (let i = idx + 1; i < rows.length; i++) if (rows[i].right !== null) return rightEls[rows[i].right!] ?? null;
  return null;
}

function nextLeftEl(rows: AlignRow[], row: AlignRow, leftEls: HTMLElement[]): HTMLElement | null {
  const idx = rows.indexOf(row);
  for (let i = idx + 1; i < rows.length; i++) if (rows[i].left !== null) return leftEls[rows[i].left!] ?? null;
  return null;
}

function alignPanes(): void {
  if (!leftEditor || !rightEditor || !lastInit) return;
  clearFillers();
  const baseBlocks = blocksOf(leftEditor, lastInit.base);
  const curBlocks = blocksOf(rightEditor, lastInit.current);
  const rows = computeAlignment(baseBlocks, curBlocks);
  const leftEls = blockElements(leftEditor).filter((el) => !el.classList.contains('diff-filler'));
  const rightEls = blockElements(rightEditor).filter((el) => !el.classList.contains('diff-filler'));

  for (const row of rows) {
    const lEl = row.left !== null ? leftEls[row.left] : null;
    const rEl = row.right !== null ? rightEls[row.right] : null;
    if (lEl && rEl) {
      // paired (eq or change): pad the shorter so tops line up
      const lh = lEl.offsetHeight, rh = rEl.offsetHeight;
      if (lh < rh) lEl.parentElement!.insertBefore(filler(rh - lh), lEl);
      else if (rh < lh) rEl.parentElement!.insertBefore(filler(lh - rh), rEl);
    } else if (lEl && !rEl) {
      // base-only (del): full-height filler on the right at the same flow point.
      const next = nextRightEl(rows, row, rightEls);
      const body = document.getElementById('diff-right')!;
      const f = filler(lEl.offsetHeight);
      if (next) next.parentElement!.insertBefore(f, next); else body.appendChild(f);
    } else if (rEl && !lEl) {
      // current-only (add): full-height filler on the left at the same flow point.
      const next = nextLeftEl(rows, row, leftEls);
      const body = document.getElementById('diff-left')!;
      const f = filler(rEl.offsetHeight);
      if (next) next.parentElement!.insertBefore(f, next); else body.appendChild(f);
    }
  }
}

// --------------------------

function applyTint(): void {
  if (!leftEditor || !rightEditor) return;
  const baseBlocks = blocksOf(leftEditor, lastInit!.base);
  const curBlocks = blocksOf(rightEditor, lastInit!.current);
  const rows = computeAlignment(baseBlocks, curBlocks);
  const leftEls = blockElements(leftEditor);
  const rightEls = blockElements(rightEditor);
  for (const row of rows) {
    if (row.kind === 'change') {
      if (row.left !== null) leftEls[row.left]?.classList.add('diff-block-change');
      if (row.right !== null) rightEls[row.right]?.classList.add('diff-block-change');
    } else if (row.kind === 'del' && row.left !== null) {
      leftEls[row.left]?.classList.add('diff-block-del');
    } else if (row.kind === 'add' && row.right !== null) {
      rightEls[row.right]?.classList.add('diff-block-add');
    }
  }
}

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = `${lightCss}\n${darkCss}\n${editorCss}\n${boardCss}\n${diffCss}`;
  document.head.appendChild(style);
}

function mount(msg: InitMsg): void {
  lastInit = msg;
  const leftEl = document.getElementById('diff-left')!;
  const rightEl = document.getElementById('diff-right')!;
  leftEditor?.destroy();
  rightEditor?.destroy();
  leftEditor = createDiffEditor(leftEl, msg.base);
  rightEditor = createDiffEditor(rightEl, msg.current);
  const leftLabel = document.getElementById('diff-left-label');
  if (leftLabel) leftLabel.textContent = msg.baseLabel;
  // Editors render synchronously enough that the top-level children exist now;
  // requestAnimationFrame ensures layout has flushed before we touch DOM.
  requestAnimationFrame(() => { applyTint(); alignPanes(); });

  // Rendered heights settle asynchronously (images, mermaid, fonts). Re-align
  // when content loads or the panel resizes. Debounce to avoid thrashing.
  if (!alignWired) {
    alignWired = true;
    let raf = 0;
    const reAlign = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(alignPanes); };
    window.addEventListener('resize', reAlign);
    window.addEventListener('load', reAlign);
    document.addEventListener('load', reAlign, true); // capture <img> load events
    // Mermaid renders asynchronously; observe DOM mutations within the panes.
    // Guard: skip mutations whose added/removed nodes are ALL .diff-filler to
    // avoid an infinite loop from our own filler inserts.
    const mo = new MutationObserver((records) => {
      const onlyFillers = records.every((r) =>
        [...r.addedNodes, ...r.removedNodes].every((n) => n instanceof HTMLElement && n.classList.contains('diff-filler')));
      if (!onlyFillers) reAlign();
    });
    mo.observe(document.getElementById('diff-panes')!, { subtree: true, childList: true, attributes: true });
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as InitMsg;
  if (msg?.type === 'init') mount(msg);
});

injectStyles();
vscode.postMessage({ type: 'ready' });
