import editorCss from './styles/editor.css';
import lightCss from './styles/notion-light.css';
import darkCss from './styles/notion-dark.css';
import boardCss from './styles/board.css';
import { createDiffEditor } from './editor';
import type { Editor } from '@tiptap/core';

interface InitMsg { type: 'init'; base: string; baseLabel: string; current: string; }

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

let leftEditor: Editor | null = null;
let rightEditor: Editor | null = null;

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = `${lightCss}\n${darkCss}\n${editorCss}\n${boardCss}`;
  document.head.appendChild(style);
}

function mount(msg: InitMsg): void {
  const leftEl = document.getElementById('diff-left')!;
  const rightEl = document.getElementById('diff-right')!;
  leftEditor?.destroy();
  rightEditor?.destroy();
  leftEditor = createDiffEditor(leftEl, msg.base);
  rightEditor = createDiffEditor(rightEl, msg.current);
  const leftLabel = document.getElementById('diff-left-label');
  if (leftLabel) leftLabel.textContent = msg.baseLabel;
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as InitMsg;
  if (msg?.type === 'init') mount(msg);
});

injectStyles();
vscode.postMessage({ type: 'ready' });
