import lightCss from './styles/notion-light.css';
import darkCss from './styles/notion-dark.css';
import editorCss from './styles/editor.css';
import { unresolveImageSrc } from './mediaResolve';

const BUNDLED_CSS = lightCss + '\n' + darkCss + '\n' + editorCss;

const EXPORT_CSS = `
/* Standalone export adjustments */
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
}
body {
  padding: 32px 16px;
  min-height: 100vh;
}
.export-page {
  margin: 0 auto;
  width: 100%;
}
.export-page .ProseMirror {
  outline: none;
}
/* Strip the toolbar / chrome / interactive bits that may sneak in via stylesheet
   selectors but have no DOM in the export. */
#toolbar, .settings-panel, .actions-panel, .block-picker, .callout-menu,
.bubble-menu, .drag-handle, .block-handle-tooltip {
  display: none !important;
}
@media print {
  body { padding: 0; }
  .export-page { width: 100% !important; max-width: none !important; }
}
`;

interface ExportContext {
  filename: string;
  themeClasses: string[]; // e.g. ['theme-dark'] or []
  editorClasses: string[]; // font-X text-X width-X
  pageWidthPx: number;
  fullWidth: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanContent(editorEl: HTMLElement): string {
  const clone = editorEl.cloneNode(true) as HTMLElement;
  // Strip ProseMirror editor-only attributes
  clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
  clone.querySelectorAll('[draggable]').forEach((el) => el.removeAttribute('draggable'));
  clone.querySelectorAll('[spellcheck]').forEach((el) => el.removeAttribute('spellcheck'));
  // Drop translate=no, role attributes that the editor adds for a11y inside the IDE
  clone.querySelectorAll('[translate]').forEach((el) => el.removeAttribute('translate'));
  // Remove drop placeholder / cursor markers
  clone.querySelectorAll('.ProseMirror-yjs-cursor, .ProseMirror-gapcursor, .ProseMirror-dropcursor')
    .forEach((el) => el.remove());
  // Strip class="ProseMirror-trailingBreak" content used purely for caret
  clone.querySelectorAll('br.ProseMirror-trailingBreak').forEach((el) => el.remove());
  // Remove editor-state-only classes that style hover/selected blocks. These
  // get left on the DOM when the user clicks Export while the bubble menu or
  // a hover effect is active.
  const STATE_CLASSES = [
    'bm-target-block',
    'has-focus',
    'ProseMirror-selectednode',
  ];
  STATE_CLASSES.forEach((cls) => {
    clone.querySelectorAll('.' + cls).forEach((el) => el.classList.remove(cls));
  });
  // Strip the class from the outer editor element too (the clone root).
  STATE_CLASSES.forEach((cls) => clone.classList.remove(cls));
  // Boards (kanban + table) render interactive chrome and hidden layout mirrors
  // that must not appear in a static export (c15). We keep the active view's real
  // content — status/tag pills are <span>s, card text is real DOM — and remove:
  //   • every <button> (view switcher, + New card / + Add row, ⋯ menus) — none work in a file
  //   • aria-hidden sizing mirrors, which carry DUPLICATE column/card text
  //   • drag handles, add-row/add-card affordances, and toolbar control clusters
  clone.querySelectorAll('.board-block').forEach((board) => {
    board.querySelectorAll('button').forEach((el) => el.remove());
    board.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
    const CHROME = [
      '.board-chrome .bd-view-seg', '.board-chrome .bd-more',
      '.board-add', '.board-add-card',
      '.board-add-column-big', '.board-add-column-spacer', '.board-add-column-mirror',
      '.bd-row-grip', '.bd-col-drag-handle', '.bd-col-menu-btn',
      '.bd-table-addrow', '.bd-addrow-placeholder', '.bd-group-add',
      '.board-properties-handle', '.board-properties-add', '.board-properties-more',
    ].join(',');
    board.querySelectorAll(CHROME).forEach((el) => el.remove());
  });
  // Turn resolved webview-resource image URLs back into document-relative paths.
  // Those relative paths are portable and let the extension inline the bytes as
  // data: URIs; a raw webview URI would 404 in a standalone file.
  clone.querySelectorAll('img[src]').forEach((el) => {
    const img = el as HTMLImageElement;
    const raw = img.getAttribute('src') ?? '';
    const rel = unresolveImageSrc(raw);
    if (rel !== raw) img.setAttribute('src', rel);
  });
  return clone.innerHTML;
}

export interface BuildOptions {
  /** When true, the rendered page calls window.print() right after load. */
  autoPrint?: boolean;
}

export function buildHtmlExport(
  editorEl: HTMLElement,
  ctx: ExportContext,
  opts: BuildOptions = {},
): string {
  const contentHtml = cleanContent(editorEl);
  const htmlClass = ctx.themeClasses.join(' ');
  const editorClass = ['editor-export', ...ctx.editorClasses].join(' ');
  const widthStyle = ctx.fullWidth
    ? 'max-width: 100%;'
    : `max-width: ${ctx.pageWidthPx}px;`;
  const autoPrintScript = opts.autoPrint
    ? `<script>window.addEventListener('load', () => { setTimeout(() => window.print(), 250); });</script>`
    : '';
  return `<!doctype html>
<html lang="en"${htmlClass ? ` class="${htmlClass}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ctx.filename)}</title>
<style>
${BUNDLED_CSS}
${EXPORT_CSS}
.export-page { ${widthStyle} }
</style>
</head>
<body>
<div class="export-page ${escapeHtml(editorClass)}">${contentHtml}</div>
${autoPrintScript}
</body>
</html>
`;
}
