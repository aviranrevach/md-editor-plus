import editorCss from './styles/editor.css';
import lightCss from './styles/notion-light.css';
import darkCss from './styles/notion-dark.css';
import boardCss from './styles/board.css';
import diffCss from './styles/diff.css';
import { createDiffEditor } from './editor';
import type { Editor } from '@tiptap/core';
import { computeAlignment } from './diffAlign';

interface InitMsg { type: 'init'; base: string; baseLabel: string; current: string; }

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

let leftEditor: Editor | null = null;
let rightEditor: Editor | null = null;
let lastInit: InitMsg | null = null;
let alignWired = false;

// Serialize each top-level block of an editor's ALREADY-PARSED document back to
// markdown via its own serializer. Both diff panes are built by createDiffEditor
// from the same extension set, so base and current normalize identically (c55).
// (We use the live doc rather than re-parsing the markdown string: tiptap-markdown's
// parser.parse() returns an HTML string, not a ProseMirror node — re-parsing here
// silently produced zero blocks, so nothing was tinted/aligned.)
function blocksOf(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.forEach((node) => {
    try { out.push((editor.storage.markdown.serializer.serialize(node) as string).trim()); }
    catch { out.push(node.textContent.trim()); }
  });
  return out;
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

function alignPanes(): void {
  if (!leftEditor || !rightEditor || !lastInit) return;
  clearFillers();
  const rows = computeAlignment(blocksOf(leftEditor), blocksOf(rightEditor));
  const leftEls = blockElements(leftEditor).filter((el) => !el.classList.contains('diff-filler'));
  const rightEls = blockElements(rightEditor).filter((el) => !el.classList.contains('diff-filler'));
  const pairs = rows.filter((r) => r.left !== null && r.right !== null);

  // Align by measured TOPS, not heights: for each paired (eq/change) block, push
  // whichever side sits higher down by the exact pixel gap so the pair's tops
  // match. Measuring live accounts for margins/margin-collapse a height-delta
  // approach can't. A filler inserted between two blocks breaks their collapsed
  // margin, so one pass slightly overshoots; we iterate, correcting the residual
  // each pass (it shrinks to 0 within a couple of passes). del/add rows need no
  // explicit filler — the next paired row re-aligns, opening a gap opposite them.
  for (let pass = 0; pass < 4; pass++) {
    let maxResidual = 0;
    for (const row of pairs) {
      const lEl = leftEls[row.left!];
      const rEl = rightEls[row.right!];
      if (!lEl || !rEl) continue;
      const d = Math.round(rEl.getBoundingClientRect().top - lEl.getBoundingClientRect().top);
      if (Math.abs(d) > Math.abs(maxResidual)) maxResidual = d;
      if (d > 0) lEl.parentElement!.insertBefore(filler(d), lEl);
      else if (d < 0) rEl.parentElement!.insertBefore(filler(-d), rEl);
    }
    if (Math.abs(maxResidual) <= 1) break; // converged
  }
  buildRail();
}

function buildRail(): void {
  const rail = document.getElementById('diff-rail')!;
  rail.replaceChildren();
  if (!lastInit || !leftEditor || !rightEditor) return;
  const baseBlocks = blocksOf(leftEditor);
  const curBlocks = blocksOf(rightEditor);
  const rows = computeAlignment(baseBlocks, curBlocks);
  const leftEls = blockElements(leftEditor).filter((el) => !el.classList.contains('diff-filler'));
  const rightEls = blockElements(rightEditor).filter((el) => !el.classList.contains('diff-filler'));
  const docH = Math.max(document.documentElement.scrollHeight, window.innerHeight);

  let painted = 0;
  for (const row of rows) {
    if (row.kind === 'eq') continue;
    if (painted >= 200) break; // reuse the c55 ceiling
    const anchor = row.right !== null ? rightEls[row.right] : (row.left !== null ? leftEls[row.left] : null);
    if (!anchor) continue;
    const top = anchor.getBoundingClientRect().top + window.scrollY;
    const mark = document.createElement('div');
    mark.className = `diff-mark ${row.kind}`;
    mark.style.top = `${(top / docH) * 100}%`;
    mark.dataset.top = String(top);
    rail.appendChild(mark);
    painted++;
  }
}

// --------------------------

function applyTint(): void {
  if (!leftEditor || !rightEditor) return;
  const baseBlocks = blocksOf(leftEditor);
  const curBlocks = blocksOf(rightEditor);
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
        (r.addedNodes.length > 0 || r.removedNodes.length > 0) &&
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

// Rail click handler — attached once at module init (not per alignPanes pass).
document.getElementById('diff-rail')?.addEventListener('click', (e) => {
  const mark = (e.target as HTMLElement).closest<HTMLElement>('.diff-mark');
  if (!mark?.dataset.top) return;
  window.scrollTo({ top: Math.max(0, Number(mark.dataset.top) - 80), behavior: 'smooth' });
});

injectStyles();
vscode.postMessage({ type: 'ready' });
