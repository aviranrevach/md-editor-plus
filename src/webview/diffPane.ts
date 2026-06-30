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
import { computeAlignment } from './diffAlign';

interface InitMsg { type: 'init'; base: string; baseLabel: string; current: string; }

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

let leftEditor: Editor | null = null;
let rightEditor: Editor | null = null;
let lastInit: InitMsg | null = null;

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
  requestAnimationFrame(applyTint);
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as InitMsg;
  if (msg?.type === 'init') mount(msg);
});

injectStyles();
vscode.postMessage({ type: 'ready' });
