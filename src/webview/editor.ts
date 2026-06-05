import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Image from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import CodeBlock from './extensions/codeBlock';
import MermaidBlock from './extensions/mermaidBlock';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import GlobalDragHandle from 'tiptap-extension-global-drag-handle';
import { common, createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import Callout, { preprocessMarkdownCallouts } from './extensions/callout';
import Board, { preprocessMarkdownBoards } from './extensions/board';
import Toggle from './extensions/toggle';
import BlockDirection from './extensions/blockDirection';
import BlockOutline from './extensions/outline';
import { createBubbleMenu } from './bubbleMenu';
import { createBlockHandle } from './blockHandle';
import { splitFrontmatter, frontmatterInfo } from './frontmatter';
import SearchExtension from './searchExtension';

const lowlight = createLowlight(common);

let _editor: Editor | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _frontmatter = '';
let _onFrontmatterChange: ((info: { lines: number; kind: 'yaml' | 'toml' | 'none' }) => void) | null = null;
let _mediaBaseUri = '';

export function setMediaBaseUri(uri: string): void {
  _mediaBaseUri = uri || '';
}

// Resolve a relative image src against the document's directory so the VS Code
// webview can actually load it. Absolute URLs, data: URIs and protocol-relative
// URLs pass through untouched.
function resolveImageSrc(src: string): string {
  if (!src || !_mediaBaseUri) return src;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return src;
  try {
    return new URL(src, _mediaBaseUri).href;
  } catch {
    return src;
  }
}

const ResolvedImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const out: Record<string, unknown> = { ...HTMLAttributes };
    if (typeof out.src === 'string') out.src = resolveImageSrc(out.src);
    return ['img', mergeAttributes(this.options.HTMLAttributes, out)];
  },
});

export function getFrontmatterInfo(): {
  lines: number;
  kind: 'yaml' | 'toml' | 'none';
} {
  return frontmatterInfo(_frontmatter);
}

export function setFrontmatterChangeListener(
  fn: (info: { lines: number; kind: 'yaml' | 'toml' | 'none' }) => void,
): void {
  _onFrontmatterChange = fn;
}

function notifyFrontmatterChange(): void {
  _onFrontmatterChange?.(getFrontmatterInfo());
}

export type OnChangeCallback = (markdown: string) => void;

export function createEditor(
  element: HTMLElement,
  initialMarkdown: string,
  onChange: OnChangeCallback,
): Editor {
  const split = splitFrontmatter(initialMarkdown);
  _frontmatter = split.frontmatter;
  let body: string;
  try {
    body = preprocessMarkdownBoards(preprocessMarkdownCallouts(split.body));
  } catch (err) {
    console.error('[md-editor-plus] callout preprocess failed', err);
    body = split.body;
  }

  _editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        dropcursor: { color: '#2383e2', width: 3 },
      }),
      MermaidBlock.configure({ lowlight, HTMLAttributes: { dir: 'ltr' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      ResolvedImage,
      Link.configure({ openOnClick: false }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Markdown.configure({ transformCopiedText: true }),
      Callout,
      Board,
      Toggle,
      BlockDirection,
      BlockOutline,
      SearchExtension,
      GlobalDragHandle.configure({ dragHandleWidth: 48 }),
    ],
    editorProps: {
      attributes: { spellcheck: 'true' },
    },
    content: body,
    onUpdate({ editor }) {
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        const markdown = editor.storage.markdown.getMarkdown() as string;
        onChange(_frontmatter + markdown);
      }, 500);
    },
  });

  createBubbleMenu(_editor);
  createBlockHandle(_editor);
  notifyFrontmatterChange();
  return _editor;
}

export function updateContent(markdown: string): void {
  if (!_editor) return;
  const split = splitFrontmatter(markdown);
  _frontmatter = split.frontmatter;
  let next: string;
  try {
    next = preprocessMarkdownBoards(preprocessMarkdownCallouts(split.body));
  } catch (err) {
    console.error('[md-editor-plus] callout preprocess failed', err);
    next = split.body;
  }
  // Preserve viewport scroll and best-effort cursor across the re-set. setContent
  // re-renders the whole doc which would otherwise yank the user to the top.
  const savedScroll = window.scrollY;
  const sel = _editor.state.selection;
  const savedFrom = sel.from;
  const savedTo = sel.to;
  _editor.commands.setContent(next);
  try {
    const docSize = _editor.state.doc.content.size;
    const clamp = (n: number) => Math.max(0, Math.min(n, Math.max(0, docSize - 1)));
    _editor.commands.setTextSelection({ from: clamp(savedFrom), to: clamp(savedTo) });
  } catch { /* selection restore is best-effort */ }
  window.scrollTo(0, savedScroll);
  notifyFrontmatterChange();
}

export function setReadOnly(readOnly: boolean): void {
  _editor?.setEditable(!readOnly);
}

// Reads the current markdown directly from the editor — bypasses the 500 ms
// onUpdate debounce so callers (e.g. view-toggle handlers) can sync the source
// view to the absolute latest preview state.
export function getCurrentMarkdown(): string {
  if (!_editor) return '';
  const markdown = _editor.storage.markdown.getMarkdown() as string;
  return _frontmatter + markdown;
}

export function destroyEditor(): void {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _editor?.destroy();
  _editor = null;
}

// ─── Source editor ──────────────────────────────────────────────────────────
// The Code view renders the entire markdown inside a single CodeBlock node so
// the existing CodeBlock NodeView (line numbers, line-drag, copy button, lowlight
// syntax highlighting) is reused for free. The doc schema is locked to a single
// codeBlock so users can't accidentally split out into other node types.

import { Document } from '@tiptap/extension-document';
import { Text } from '@tiptap/extension-text';
import { HardBreak } from '@tiptap/extension-hard-break';
import { createSourceBubbleMenu } from './sourceBubbleMenu';

const SourceDocument = Document.extend({ content: 'codeBlock' });

let _sourceEditor: Editor | null = null;
let _sourceDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let _suppressSourceUpdate = false;

function buildSourceContent(markdown: string): object {
  return {
    type: 'doc',
    content: [
      {
        type: 'codeBlock',
        attrs: { language: 'markdown' },
        content: markdown ? [{ type: 'text', text: markdown }] : [],
      },
    ],
  };
}

export function createSourceEditor(
  element: HTMLElement,
  initialMarkdown: string,
  onChange: OnChangeCallback,
): Editor {
  _sourceEditor = new Editor({
    element,
    extensions: [
      SourceDocument,
      Text,
      HardBreak,
      CodeBlock.configure({ lowlight, defaultLanguage: 'markdown', HTMLAttributes: { dir: 'ltr' } }),
      SearchExtension,
    ],
    content: buildSourceContent(initialMarkdown),
    onUpdate({ editor }) {
      if (_suppressSourceUpdate) return;
      const md = editor.state.doc.firstChild?.textContent ?? '';
      if (_sourceDebounceTimer) clearTimeout(_sourceDebounceTimer);
      _sourceDebounceTimer = setTimeout(() => onChange(md), 500);
    },
  });
  createSourceBubbleMenu(_sourceEditor);
  return _sourceEditor;
}

export function updateSourceContent(markdown: string): void {
  if (!_sourceEditor) return;
  const current = _sourceEditor.state.doc.firstChild?.textContent ?? '';
  if (current === markdown) return;
  _suppressSourceUpdate = true;
  _sourceEditor.commands.setContent(buildSourceContent(markdown), false);
  _suppressSourceUpdate = false;
}

export function getSourceMarkdown(): string {
  return _sourceEditor?.state.doc.firstChild?.textContent ?? '';
}

export function destroySourceEditor(): void {
  if (_sourceDebounceTimer) clearTimeout(_sourceDebounceTimer);
  _sourceEditor?.destroy();
  _sourceEditor = null;
}

// Editor handles for features that need to talk to the live ProseMirror
// instances directly (e.g. the find bar routing search to the active view).
export function getEditor(): Editor | null {
  return _editor;
}

export function getSourceEditor(): Editor | null {
  return _sourceEditor;
}
