import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableWithRail } from './tableNodeView';
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
import { EmptyPlaceholder } from './extensions/emptyPlaceholder';
import { common, createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import Callout, { preprocessMarkdownCallouts } from './extensions/callout';
import Board, { preprocessMarkdownBoards } from './extensions/board';
import Toggle from './extensions/toggle';
import BlockDirection from './extensions/blockDirection';
import BlockOutline from './extensions/outline';
import SmartTypography from './extensions/smartTypography';
import { createBubbleMenu } from './bubbleMenu';
import { initBoardFormatToolbar } from './boardFormatToolbar';
import { createImageBubbleMenu } from './imageBubbleMenu';
import { createBlockHandle } from './blockHandle';
import { splitFrontmatter, frontmatterInfo } from './frontmatter';
import SearchExtension from './searchExtension';
import ImagePasteDrop from './extensions/imagePasteDrop';
import ClickBelowContent from './extensions/clickBelowContent';
import { createFlushableDebounce, FlushableDebounce } from './flushableDebounce';
import { setMediaBaseUri, resolveImageSrc } from './mediaResolve';
import { imageNodeToMarkdown, normalizeWidth } from './imageMarkdown';
import { imageNodeViewFactory } from './imageNodeView';
export { setMediaBaseUri };

const lowlight = createLowlight(common);

// Returns the shared extension set. `suppressEmptyPlaceholder` drops the
// generic empty hint (used by the board card panel, c50). The diff panes
// also suppress it — an empty base side should look empty, not prompt.
function editorExtensions(options?: { suppressEmptyPlaceholder?: boolean }) {
  return [
    StarterKit.configure({
      codeBlock: false,
      dropcursor: { color: '#2383e2', width: 3 },
    }),
    MermaidBlock.configure({ lowlight, HTMLAttributes: { dir: 'ltr' } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableWithRail.configure({ resizable: false }),
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
    SmartTypography,
    SearchExtension,
    ImagePasteDrop,
    ClickBelowContent,
    GlobalDragHandle.configure({ dragHandleWidth: 48 }),
    // The board card panel supplies its own "Add a description…" placeholder,
    // so suppress this generic hint there to avoid two overlapping placeholders (c50).
    ...(options?.suppressEmptyPlaceholder ? [] : [EmptyPlaceholder]),
  ];
}

let _editor: Editor | null = null;
let _editDebounce: FlushableDebounce | null = null;
let _frontmatter = '';
let _onFrontmatterChange: ((info: { lines: number; kind: 'yaml' | 'toml' | 'none' }) => void) | null = null;

const ResolvedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        // Read width off an <img> (from HTML round-trip) as a positive int.
        parseHTML: (el: HTMLElement) => normalizeWidth(el.getAttribute('width')),
        // Emitted into the editor DOM; the markdown serializer (below) handles files.
        renderHTML: (attrs: { width?: number | null }) =>
          attrs.width ? { width: String(attrs.width) } : {},
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const out: Record<string, unknown> = { ...HTMLAttributes };
    if (typeof out.src === 'string') out.src = resolveImageSrc(out.src);
    return ['img', mergeAttributes(this.options.HTMLAttributes, out)];
  },
  addStorage() {
    return {
      markdown: {
        // Sized images persist as HTML <img width>; unsized stay ![](). This
        // overrides tiptap-markdown's default image serializer (getMarkdownSpec
        // merges {...default, ...thisStorage}).
        serialize(state: any, node: any) {
          state.write(imageNodeToMarkdown(node.attrs));
        },
        parse: {},
      },
    };
  },
  addNodeView() {
    return imageNodeViewFactory();
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

interface BuiltEditor {
  editor: Editor;
  debounce: FlushableDebounce;
  frontmatter: string;
}

// Builds a fully self-contained rich editor whose onChange/flush operate ONLY
// on its own instance. The `debounce` it returns is closed over by this
// editor's own onUpdate/onBlur, so nothing here touches the module-level
// primary singletons. Both the primary editor and detached editors (card
// description panel) are built through here.
function buildRichEditor(
  element: HTMLElement,
  initialMarkdown: string,
  onChange: OnChangeCallback,
  onDirty?: () => void,
  options?: { suppressEmptyPlaceholder?: boolean },
): BuiltEditor {
  const split = splitFrontmatter(initialMarkdown);
  const frontmatter = split.frontmatter;
  let body: string;
  try {
    body = preprocessMarkdownBoards(preprocessMarkdownCallouts(split.body));
  } catch (err) {
    console.error('[md-editor-plus] callout preprocess failed', err);
    body = split.body;
  }

  let debounce: FlushableDebounce | null = null;
  const editor = new Editor({
    element,
    extensions: editorExtensions(options),
    editorProps: {
      attributes: { spellcheck: 'true' },
    },
    content: body,
    onUpdate() {
      onDirty?.();
      debounce?.schedule();
    },
    onBlur() {
      // Losing focus is a natural save point — flush so the last keystrokes
      // reach the host immediately instead of waiting on the debounce.
      debounce?.flush();
    },
  });

  debounce = createFlushableDebounce(() => {
    const markdown = editor.storage.markdown.getMarkdown() as string;
    onChange(frontmatter + markdown);
  }, 500);

  createBubbleMenu(editor);
  createImageBubbleMenu(editor);
  createBlockHandle(editor);
  // Selection toolbar for board free-text cells (idempotent document-level singleton).
  initBoardFormatToolbar();

  return { editor, debounce, frontmatter };
}

// Creates the PRIMARY document editor and registers it as the module-level
// singleton the host save path reads (getCurrentMarkdown / flushPendingEdit).
export function createEditor(
  element: HTMLElement,
  initialMarkdown: string,
  onChange: OnChangeCallback,
  onDirty?: () => void,
): Editor {
  const built = buildRichEditor(element, initialMarkdown, onChange, onDirty);
  _editor = built.editor;
  _editDebounce = built.debounce;
  _frontmatter = built.frontmatter;
  notifyFrontmatterChange();
  return built.editor;
}

export interface DetachedEditorHandle {
  editor: Editor;
  flush(): void;
  destroy(): void;
}

// Creates an INDEPENDENT rich editor (used for the board card description
// panel). Unlike createEditor it does NOT register itself as `_editor` /
// `_editDebounce` / `_frontmatter`, so the host's save path keeps reading the
// MAIN document. Hijacking those singletons with a nested editor is the c37
// data-loss bug: saving wrote one card's description as the entire file.
export function createDetachedEditor(
  element: HTMLElement,
  initialMarkdown: string,
  onChange: OnChangeCallback,
  onDirty?: () => void,
): DetachedEditorHandle {
  // Suppress the generic empty-state hint: the board card panel renders its own
  // "Add a description to this card…" placeholder over this editor (c50).
  const built = buildRichEditor(element, initialMarkdown, onChange, onDirty, {
    suppressEmptyPlaceholder: true,
  });
  return {
    editor: built.editor,
    flush: () => built.debounce.flush(),
    destroy: () => {
      built.debounce.flush();
      built.editor.destroy();
    },
  };
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

export function flushPendingEdit(): void {
  _editDebounce?.flush();
  _sourceEditDebounce?.flush();
}

export function destroyEditor(): void {
  // Flush — NOT clear — so edits made in the last 500ms before close are sent
  // to the host instead of being silently discarded.
  _editDebounce?.flush();
  _editDebounce = null;
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
let _sourceEditDebounce: FlushableDebounce | null = null;
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
  onDirty?: () => void,
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
    onUpdate() {
      if (_suppressSourceUpdate) return;
      onDirty?.();
      _sourceEditDebounce?.schedule();
    },
    onBlur() {
      // Flush on blur so Code-view edits reach the host immediately. Guard on
      // the suppress flag for symmetry with onUpdate — a blur during a
      // programmatic setContent must not push content back as a user edit.
      if (!_suppressSourceUpdate) _sourceEditDebounce?.flush();
    },
  });
  _sourceEditDebounce = createFlushableDebounce(() => {
    if (!_sourceEditor || _suppressSourceUpdate) return;
    onChange(getSourceMarkdown());
  }, 500);
  createSourceBubbleMenu(_sourceEditor);
  return _sourceEditor;
}

export function updateSourceContent(markdown: string): void {
  if (!_sourceEditor) return;
  const current = _sourceEditor.state.doc.firstChild?.textContent ?? '';
  if (current === markdown) return;
  _suppressSourceUpdate = true;
  try {
    _sourceEditor.commands.setContent(buildSourceContent(markdown), false);
  } finally {
    // Always clear the flag — if setContent throws and we leak `true`, every
    // subsequent Code-view keystroke would be silently dropped (data loss).
    _suppressSourceUpdate = false;
  }
}

export function getSourceMarkdown(): string {
  return _sourceEditor?.state.doc.firstChild?.textContent ?? '';
}

export function destroySourceEditor(): void {
  _sourceEditDebounce?.flush();
  _sourceEditDebounce = null;
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

// Build a standalone, read-only editor for ONE diff pane. Does NOT touch the
// module singletons (_editor/_editDebounce/_frontmatter) — the diff renders two
// of these and must not hijack the main editor's state. Read-only sidesteps the
// whole save/dirty family (c56, c28, c37); the diff never writes.
export function createDiffEditor(element: HTMLElement, markdown: string): Editor {
  const split = splitFrontmatter(markdown);
  let body: string;
  try {
    body = preprocessMarkdownBoards(preprocessMarkdownCallouts(split.body));
  } catch {
    body = split.body;
  }
  return new Editor({
    element,
    editable: false,
    extensions: editorExtensions({ suppressEmptyPlaceholder: true }),
    content: body,
  });
}
