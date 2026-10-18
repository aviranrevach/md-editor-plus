import { Extension, InputRule, Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { insertPoint } from '@tiptap/pm/transform';
import katex from 'katex';
import 'katex/contrib/mhchem';
import texmath from 'markdown-it-texmath';

export type InlineMathDelimiter = '$' | '$$' | '\\(';
export type BlockMathDelimiter = '$$' | '\\[';

const KATEX_OPTIONS = {
  throwOnError: false,
  trust: false,
  strict: 'ignore' as const,
  maxSize: 20,
  maxExpand: 1000,
};

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '&#10;');
}

function inlineSource(latex: string, delimiter: InlineMathDelimiter): string {
  if (delimiter === '\\(') return `\\(${latex}\\)`;
  return `${delimiter}${latex}${delimiter}`;
}

function blockSource(
  latex: string,
  delimiter: BlockMathDelimiter,
  equationNumber = '',
): string {
  const open = delimiter;
  const close = delimiter === '\\[' ? '\\]' : '$$';
  const suffix = equationNumber ? ` (${equationNumber})` : '';
  return `${open}\n${latex}\n${close}${suffix}`;
}

/**
 * Install math tokenisation into tiptap-markdown's shared markdown-it parser.
 * The parser calls extension setup hooks on every parse, so the guard is
 * essential: registering the same rules repeatedly makes a later setContent
 * parse a formula more than once.
 */
export function setupMathMarkdown(md: any): void {
  if (md.__mdEditorPlusMathReady) return;
  md.__mdEditorPlusMathReady = true;

  md.use(texmath as any, {
    engine: katex,
    delimiters: ['dollars', 'brackets'],
    katexOptions: KATEX_OPTIONS,
  });

  const inlineRenderer = (tokens: any[], idx: number): string => {
    const token = tokens[idx];
    const delimiter: InlineMathDelimiter = token.markup === '\\(' ? '\\(' : token.markup === '$$' ? '$$' : '$';
    return `<span data-math-inline="" data-latex="${escapeAttr(token.content ?? '')}" data-math-delimiter="${escapeAttr(delimiter)}"></span>`;
  };
  const blockRenderer = (tokens: any[], idx: number): string => {
    const token = tokens[idx];
    const delimiter: BlockMathDelimiter = token.tag === '\\[' ? '\\[' : '$$';
    const equationNumber = token.type === 'math_block_eqno' ? token.info ?? '' : '';
    const latex = String(token.content ?? '').replace(/^\n/, '').replace(/\n$/, '');
    return `<div data-math-block="" data-latex="${escapeAttr(latex)}" data-math-delimiter="${escapeAttr(delimiter)}" data-equation-number="${escapeAttr(equationNumber)}"></div>`;
  };

  md.renderer.rules.math_inline = inlineRenderer;
  md.renderer.rules.math_inline_double = inlineRenderer;
  md.renderer.rules.math_block = blockRenderer;
  md.renderer.rules.math_block_eqno = blockRenderer;
}

export function renderMath(host: HTMLElement, latex: string, displayMode: boolean): void {
  host.replaceChildren();
  host.removeAttribute('title');
  host.classList.remove('math-render-error', 'math-render-empty');
  if (!latex.trim()) {
    host.classList.add('math-render-empty');
    host.textContent = displayMode ? 'Type an equation…' : 'equation';
    return;
  }
  try {
    katex.render(latex, host, { ...KATEX_OPTIONS, displayMode, throwOnError: true });
  } catch (error) {
    katex.render(latex, host, { ...KATEX_OPTIONS, displayMode, throwOnError: false });
    host.classList.add('math-render-error');
    host.title = error instanceof Error ? error.message : 'Invalid equation';
  }
}

interface MathNodeLike {
  type: { name: string };
  nodeSize: number;
  attrs: {
    latex?: string;
    delimiter?: InlineMathDelimiter | BlockMathDelimiter;
    equationNumber?: string;
  };
}

function setNodeLatex(editor: Editor, getPos: unknown, node: MathNodeLike, latex: string): boolean {
  if (typeof getPos !== 'function') return false;
  const pos = getPos();
  if (typeof pos !== 'number') return false;
  const current = editor.state.doc.nodeAt(pos);
  if (!current || current.type.name !== node.type.name) return false;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, latex }));
  return true;
}

function moveSelectionOutside(editor: Editor, getPos: unknown, node: MathNodeLike, after: boolean): void {
  if (typeof getPos !== 'function') return;
  const pos = getPos();
  if (typeof pos !== 'number') return;
  const target = after ? pos + node.nodeSize : pos;
  try {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(target), after ? 1 : -1)));
    editor.view.focus();
  } catch { /* best-effort cursor movement */ }
}

function createInlineMathView(props: any) {
  let node = props.node as MathNodeLike;
  const editor = props.editor as Editor;
  const getPos = props.getPos as unknown;
  let editing = false;
  let originalLatex = String(node.attrs.latex ?? '');

  const dom = document.createElement('span');
  dom.className = 'math-inline';
  dom.contentEditable = 'false';
  dom.setAttribute('dir', 'ltr');

  const preview = document.createElement('span');
  preview.className = 'math-inline-preview';
  const popover = document.createElement('span');
  popover.className = 'math-inline-input-wrap';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'math-inline-input';
  input.placeholder = 'Type a LaTeX equation…';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Edit inline equation');
  const actions = document.createElement('span');
  actions.className = 'math-inline-actions';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy source';
  const blockButton = document.createElement('button');
  blockButton.type = 'button';
  blockButton.textContent = 'Make block';
  actions.append(copyButton, blockButton);
  popover.append(input, actions);
  dom.append(preview, popover);

  const redraw = (): void => renderMath(preview, String(node.attrs.latex ?? ''), false);

  const close = (restore: boolean, moveAfter?: boolean): void => {
    if (!editing) return;
    if (restore) setNodeLatex(editor, getPos, node, originalLatex);
    editing = false;
    dom.classList.remove('math-editing');
    if (moveAfter !== undefined) moveSelectionOutside(editor, getPos, node, moveAfter);
  };

  const open = (): void => {
    if (!editor.isEditable || editing) return;
    editing = true;
    originalLatex = String(node.attrs.latex ?? '');
    input.value = originalLatex;
    dom.classList.add('math-editing');
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  };

  preview.addEventListener('mousedown', (event) => {
    if (!editor.isEditable || typeof getPos !== 'function') return;
    const pos = getPos();
    if (typeof pos !== 'number') return;
    event.preventDefault();
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    open();
  });
  input.addEventListener('input', () => { setNodeLatex(editor, getPos, node, input.value); });
  copyButton.addEventListener('click', () => { void copyMathSource(input.value); });
  blockButton.addEventListener('click', () => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (typeof pos === 'number') convertInlineMathAt(editor, pos, node);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      close(false, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true, true);
    } else if (event.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) {
      event.preventDefault();
      close(false, false);
    } else if (event.key === 'ArrowRight' && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
      event.preventDefault();
      close(false, true);
    }
  });
  popover.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (editing && !popover.contains(document.activeElement)) close(false);
    });
  });

  redraw();
  return {
    dom,
    update(updatedNode: MathNodeLike) {
      if (updatedNode.type.name !== node.type.name) return false;
      node = updatedNode;
      if (!editing || input.value !== String(node.attrs.latex ?? '')) input.value = String(node.attrs.latex ?? '');
      redraw();
      return true;
    },
    selectNode() { dom.classList.add('math-selected'); open(); },
    deselectNode() { dom.classList.remove('math-selected'); if (editing && document.activeElement !== input) close(false); },
    stopEvent(event: Event) { return popover.contains(event.target as globalThis.Node); },
    ignoreMutation() { return true; },
    destroy() { editing = false; },
  };
}

function createBlockMathView(props: any) {
  let node = props.node as MathNodeLike;
  const editor = props.editor as Editor;
  const getPos = props.getPos as unknown;
  let editing = false;
  let originalLatex = String(node.attrs.latex ?? '');

  const dom = document.createElement('div');
  dom.className = 'math-block';
  dom.contentEditable = 'false';
  dom.setAttribute('dir', 'ltr');
  const preview = document.createElement('div');
  preview.className = 'math-block-preview';
  const source = document.createElement('div');
  source.className = 'math-block-source';
  const textarea = document.createElement('textarea');
  textarea.className = 'math-block-input';
  textarea.placeholder = 'Type or paste a LaTeX equation…';
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', 'Edit block equation');
  const hint = document.createElement('span');
  hint.className = 'math-block-hint';
  hint.textContent = '⌘/Ctrl + Enter to finish · Esc to cancel';
  const actions = document.createElement('div');
  actions.className = 'math-block-actions';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy source';
  actions.appendChild(copyButton);
  source.append(textarea, hint, actions);
  dom.append(preview, source);

  const redraw = (): void => renderMath(preview, String(node.attrs.latex ?? ''), true);
  const close = (restore: boolean, moveAfter?: boolean): void => {
    if (!editing) return;
    if (restore) setNodeLatex(editor, getPos, node, originalLatex);
    editing = false;
    dom.classList.remove('math-editing');
    if (moveAfter !== undefined) moveSelectionOutside(editor, getPos, node, moveAfter);
  };
  const open = (): void => {
    if (!editor.isEditable || editing) return;
    editing = true;
    originalLatex = String(node.attrs.latex ?? '');
    textarea.value = originalLatex;
    dom.classList.add('math-editing');
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  };

  preview.addEventListener('mousedown', (event) => {
    if (!editor.isEditable || typeof getPos !== 'function') return;
    const pos = getPos();
    if (typeof pos !== 'number') return;
    event.preventDefault();
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    open();
  });
  textarea.addEventListener('input', () => { setNodeLatex(editor, getPos, node, textarea.value); });
  copyButton.addEventListener('click', () => { void copyMathSource(textarea.value); });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      close(false, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true, true);
    }
  });
  source.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (editing && !source.contains(document.activeElement)) close(false);
    });
  });

  redraw();
  return {
    dom,
    update(updatedNode: MathNodeLike) {
      if (updatedNode.type.name !== node.type.name) return false;
      node = updatedNode;
      if (!editing || textarea.value !== String(node.attrs.latex ?? '')) textarea.value = String(node.attrs.latex ?? '');
      redraw();
      return true;
    },
    selectNode() { dom.classList.add('math-selected'); open(); },
    deselectNode() { dom.classList.remove('math-selected'); if (editing && document.activeElement !== textarea) close(false); },
    stopEvent(event: Event) { return source.contains(event.target as globalThis.Node); },
    ignoreMutation() { return true; },
    destroy() { editing = false; },
  };
}

function selectionInsideCode(editor: Editor): boolean {
  if (editor.isActive('code') || editor.isActive('codeBlock')) return true;
  const { $from } = editor.state.selection;
  return $from.parent.type.spec.code === true;
}

async function copyMathSource(latex: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(latex);
    return;
  } catch { /* VS Code webviews may deny direct clipboard access. */ }
  const host = (window as unknown as {
    __mdViewerVscode?: { postMessage: (message: unknown) => void };
  }).__mdViewerVscode;
  host?.postMessage({ type: 'copyText', text: latex, toast: 'Equation source copied' });
}

function convertInlineMathAt(editor: Editor, pos: number, node: MathNodeLike): boolean {
  const blockType = editor.schema.nodes.blockMath;
  if (!blockType) return false;
  const $pos = editor.state.doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return false;
  const offset = $pos.parentOffset;
  const beforeContent = parent.content.cut(0, offset);
  const afterContent = parent.content.cut(offset + node.nodeSize);
  const replacement = [];
  if (beforeContent.size) replacement.push(parent.copy(beforeContent));
  replacement.push(blockType.create({
    latex: String(node.attrs.latex ?? ''),
    delimiter: '$$',
    equationNumber: '',
  }));
  if (afterContent.size) replacement.push(parent.copy(afterContent));
  const parentPos = $pos.before($pos.depth);
  const mathPos = parentPos + (beforeContent.size ? replacement[0].nodeSize : 0);
  const tr = editor.state.tr.replaceWith(
    parentPos,
    parentPos + parent.nodeSize,
    Fragment.fromArray(replacement),
  );
  tr.setSelection(NodeSelection.create(tr.doc, mathPos));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function insertInlineMath(editor: Editor, latex?: string): boolean {
  if (!editor.isEditable || selectionInsideCode(editor)) return false;
  const type = editor.schema.nodes.inlineMath;
  if (!type) return false;
  const { from, to } = editor.state.selection;
  const selected = latex ?? editor.state.doc.textBetween(from, to, ' ', ' ');
  const node = type.create({ latex: selected, delimiter: '$' });
  const tr = editor.state.tr.replaceRangeWith(from, to, node);
  tr.setSelection(NodeSelection.create(tr.doc, from));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function insertBlockMath(editor: Editor, pos?: number, latex = ''): boolean {
  if (!editor.isEditable) return false;
  const type = editor.schema.nodes.blockMath;
  if (!type) return false;
  const at = pos ?? editor.state.selection.from;
  const node = type.create({ latex, delimiter: '$$', equationNumber: '' });
  const $at = editor.state.doc.resolve(at);
  let nodePos: number;
  let tr = editor.state.tr;
  if ($at.depth > 0 && $at.parent.isTextblock && $at.parent.content.size === 0) {
    nodePos = $at.before($at.depth);
    tr = tr.replaceWith(nodePos, nodePos + $at.parent.nodeSize, node);
  } else {
    const resolvedInsert = insertPoint(editor.state.doc, at, type);
    if (resolvedInsert == null) return false;
    nodePos = resolvedInsert;
    tr = tr.insert(nodePos, node);
  }
  tr.setSelection(NodeSelection.create(tr.doc, nodePos));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-latex') ?? '',
        renderHTML: (attrs: { latex?: string }) => ({ 'data-latex': attrs.latex ?? '' }),
      },
      delimiter: {
        default: '$' as InlineMathDelimiter,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-math-delimiter') ?? '$',
        renderHTML: (attrs: { delimiter?: string }) => ({ 'data-math-delimiter': attrs.delimiter ?? '$' }),
      },
    };
  },
  parseHTML() { return [{ tag: 'span[data-math-inline]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes({ 'data-math-inline': '' }, HTMLAttributes)]; },
  renderText({ node }) { return inlineSource(node.attrs.latex ?? '', node.attrs.delimiter ?? '$'); },
  addNodeView() { return createInlineMathView; },
  addStorage() {
    return {
      markdown: {
        parse: { setup: setupMathMarkdown },
        serialize(state: any, node: any) {
          state.write(inlineSource(node.attrs.latex ?? '', node.attrs.delimiter ?? '$'));
        },
      },
    };
  },
});

export const BlockMath = Node.create({
  name: 'blockMath',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-latex') ?? '',
        renderHTML: (attrs: { latex?: string }) => ({ 'data-latex': attrs.latex ?? '' }),
      },
      delimiter: {
        default: '$$' as BlockMathDelimiter,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-math-delimiter') ?? '$$',
        renderHTML: (attrs: { delimiter?: string }) => ({ 'data-math-delimiter': attrs.delimiter ?? '$$' }),
      },
      equationNumber: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-equation-number') ?? '',
        renderHTML: (attrs: { equationNumber?: string }) => ({ 'data-equation-number': attrs.equationNumber ?? '' }),
      },
    };
  },
  parseHTML() { return [{ tag: 'div[data-math-block]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ 'data-math-block': '' }, HTMLAttributes)]; },
  renderText({ node }) { return blockSource(node.attrs.latex ?? '', node.attrs.delimiter ?? '$$', node.attrs.equationNumber ?? ''); },
  addNodeView() { return createBlockMathView; },
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(blockSource(node.attrs.latex ?? '', node.attrs.delimiter ?? '$$', node.attrs.equationNumber ?? ''));
          state.ensureNewLine();
          state.write('\n');
        },
      },
    };
  },
});

export const MathShortcuts = Extension.create({
  name: 'mathShortcuts',

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-e': () => insertInlineMath(this.editor),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        // Notion shortcut: $$equation$$. The markdown parser also accepts the
        // standard $equation$ form when content is loaded from disk.
        find: /\$\$([^$\n]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const type = state.schema.nodes.inlineMath;
          if (!type || !match[1]) return null;
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code || state.schema.marks.code?.isInSet(state.storedMarks ?? $from.marks())) return null;
          state.tr.replaceRangeWith(range.from, range.to, type.create({ latex: match[1], delimiter: '$$' }));
          return undefined;
        },
      }),
    ];
  },
});
