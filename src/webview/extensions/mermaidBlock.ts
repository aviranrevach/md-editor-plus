// Tiptap extension that *extends* the existing CodeBlock with a custom
// NodeView for blocks whose `language` attr is "mermaid". For any other
// language we defer to the parent NodeView (the existing line-gutter /
// line-drag / lowlight chrome). This means:
//  - the underlying ProseMirror node type stays `codeBlock`
//  - markdown round-trip is unchanged (still serializes as ```mermaid\n…\n```)
//  - lowlight's tokenization plugin still runs (it warns about the unknown
//    "mermaid" grammar and skips coloring, which is what we want here).
//
// UX (per docs/superpowers/specs/2026-05-21-mermaid-preview-design.md):
//  - Preview by default. SVG renders into a preview pane.
//  - Toggle in the header (label "Edit") OR double-click on the diagram
//    switches to source. Snackbar fades in below the toggle for ~2s.
//  - Esc / click outside / toggle-off returns to preview, which re-parses.
//  - Parse error → hard error placeholder with line number + "Fix in source".
//  - Header also has Expand (fullscreen modal) and a Copy split-button
//    (default click = copy source; caret = menu with Copy/Copy SVG/Download).

import CodeBlock from './codeBlock';
import { renderMermaid, detectDiagramKind } from '../mermaidRenderer';
import { openMermaidFullscreen } from '../mermaidFullscreen';

// SVGs — kept inline so the bundle has no extra asset deps.
const ICON_EXPAND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>`;
const ICON_COPY   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_PENCIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
const ICON_ALERT  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
const ICON_CARET  = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>`;

const MermaidBlock = CodeBlock.extend({
  name: 'codeBlock', // keep the same node type as the base CodeBlock
  addNodeView() {
    const parentBuild = this.parent?.();

    return (props) => {
      const lang = (props.node.attrs.language ?? '').toLowerCase();
      if (lang !== 'mermaid') {
        // Fall back to the existing rich code-block view.
        return parentBuild ? parentBuild(props) : ({} as ReturnType<NonNullable<typeof parentBuild>>);
      }
      return buildMermaidView(props);
    };
  },
});

export default MermaidBlock;

// ── Mermaid NodeView ────────────────────────────────────────────────────────

function buildMermaidView(props: unknown) {
  const { node } = props as { node: { attrs: { language?: string }; type: { name: string } } };

  const dom = document.createElement('div');
  dom.className = 'mb';
  dom.dataset.lang = 'mermaid';

  // ── Header ─────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'mb-header';
  header.contentEditable = 'false';

  const langEl = document.createElement('span');
  langEl.className = 'mb-lang';
  langEl.textContent = 'mermaid';

  const actions = document.createElement('div');
  actions.className = 'mb-actions';

  const toggle = buildToggle();
  const expandBtn = buildIconButton(`${ICON_EXPAND}<span>Expand</span>`, 'Open fullscreen');
  expandBtn.classList.add('mb-expand');
  const copySplit = buildCopySplit();

  actions.append(toggle.el, expandBtn, copySplit.el);
  header.append(langEl, actions);

  // ── Preview pane ───────────────────────────────────────────────────────
  const preview = document.createElement('div');
  preview.className = 'mb-preview';
  preview.contentEditable = 'false';

  // ── Source pane (holds the actual ProseMirror contentDOM) ──────────────
  const source = document.createElement('div');
  source.className = 'mb-source';
  const pre = document.createElement('pre');
  pre.className = 'mb-source-pre';
  const code = document.createElement('code');
  code.className = 'mb-source-code language-mermaid';
  pre.appendChild(code);
  source.appendChild(pre);

  // ── Snackbar ────────────────────────────────────────────────────────────
  const snackbar = document.createElement('div');
  snackbar.className = 'mb-snackbar';
  snackbar.setAttribute('role', 'status');
  snackbar.innerHTML = `${ICON_PENCIL}<span>Editing source · press <kbd>Esc</kbd> to preview</span>`;

  dom.append(header, preview, source, snackbar);

  // ── State ──────────────────────────────────────────────────────────────
  let editing = false;
  let lastSvg: string | null = null;
  let snackbarTimer: ReturnType<typeof setTimeout> | null = null;
  let renderToken = 0;

  function showSnackbar(): void {
    snackbar.classList.add('mb-snackbar-show');
    if (snackbarTimer) clearTimeout(snackbarTimer);
    snackbarTimer = setTimeout(() => {
      snackbar.classList.remove('mb-snackbar-show');
      snackbarTimer = null;
    }, 1800);
  }

  function setEditing(on: boolean): void {
    if (editing === on) return;
    editing = on;
    dom.classList.toggle('mb-editing', on);
    toggle.setOn(on);
    if (on) {
      showSnackbar();
      // Place the caret at the end of the code block so typing works
      // immediately. (Without this the click target inside contentDOM
      // would still need a separate selection action.)
      requestAnimationFrame(() => {
        try {
          const range = document.createRange();
          range.selectNodeContents(code);
          range.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        } catch { /* ignore — selection is best-effort */ }
      });
    } else {
      renderPreview();
    }
  }

  function currentSource(): string {
    // contentDOM (.mb-source-code) holds the raw mermaid text. Newlines in
    // ProseMirror codeBlocks are real "\n" characters in textContent.
    return code.textContent ?? '';
  }

  async function renderPreview(): Promise<void> {
    const myToken = ++renderToken;
    const src = currentSource();
    if (!src.trim()) {
      preview.innerHTML = emptyHtml();
      lastSvg = null;
      expandBtn.classList.add('mb-disabled');
      return;
    }
    preview.innerHTML = spinnerHtml();
    const result = await renderMermaid(src);
    // If the user edited again while we were rendering, drop the stale result.
    if (myToken !== renderToken) return;
    if (result.ok) {
      preview.innerHTML = result.svg;
      lastSvg = result.svg;
      expandBtn.classList.remove('mb-disabled');
    } else {
      preview.innerHTML = errorHtml(result.message, result.line);
      lastSvg = null;
      expandBtn.classList.add('mb-disabled');
      wireFixButton();
    }
  }

  function wireFixButton(): void {
    const btn = preview.querySelector<HTMLButtonElement>('.mb-err-fix');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const lineAttr = btn.dataset.line;
      const targetLine = lineAttr ? parseInt(lineAttr, 10) : NaN;
      setEditing(true);
      if (Number.isFinite(targetLine)) jumpToLine(targetLine);
    });
  }

  function jumpToLine(line1: number): void {
    // Best-effort: place caret at the start of the given 1-based line within
    // the codeBlock's content. textContent + offset is enough because
    // codeBlock holds a single text node.
    requestAnimationFrame(() => {
      try {
        const text = currentSource();
        const lines = text.split('\n');
        const targetIdx = Math.max(0, Math.min(line1 - 1, lines.length - 1));
        let offset = 0;
        for (let i = 0; i < targetIdx; i++) offset += lines[i].length + 1; // +1 for \n
        const range = document.createRange();
        const textNode = code.firstChild;
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          const safe = Math.min(offset, (textNode.textContent ?? '').length);
          range.setStart(textNode, safe);
          range.collapse(true);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      } catch { /* ignore */ }
    });
  }

  // ── Wire toggle ─────────────────────────────────────────────────────────
  toggle.el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  toggle.el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setEditing(!editing);
  });

  // ── Wire double-click on preview ───────────────────────────────────────
  preview.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('.mb-err-fix')) return; // button handled separately
    e.preventDefault();
    e.stopPropagation();
    setEditing(true);
  });

  // ── Wire expand button ─────────────────────────────────────────────────
  expandBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  expandBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (expandBtn.classList.contains('mb-disabled')) return;
    if (!lastSvg) return;
    openMermaidFullscreen({ svg: lastSvg, title: detectDiagramKind(currentSource()) });
  });

  // ── Wire copy split-button ─────────────────────────────────────────────
  copySplit.onMain(() => copyText(currentSource(), copySplit.flash));
  copySplit.onMenu('copy-code', () => copyText(currentSource(), copySplit.flash));
  copySplit.onMenu('copy-svg',  () => {
    if (!lastSvg) return;
    copyText(lastSvg, copySplit.flash);
  });
  copySplit.onMenu('download-svg', () => {
    if (!lastSvg) return;
    downloadBlob(new Blob([lastSvg], { type: 'image/svg+xml' }), filenameStem(currentSource()) + '.svg');
  });
  copySplit.onMenu('download-png', () => {
    if (!lastSvg) return;
    void rasterizeAndDownload(lastSvg, filenameStem(currentSource()) + '.png');
  });

  // ── Esc / outside click exit edit ──────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    if (!editing) return;
    if (e.key !== 'Escape') return;
    if (!dom.contains(document.activeElement)) return;
    e.preventDefault();
    setEditing(false);
  }
  document.addEventListener('keydown', onKey, true);

  function onOutsideClick(e: MouseEvent): void {
    if (!editing) return;
    if (dom.contains(e.target as Node)) return;
    setEditing(false);
  }
  document.addEventListener('mousedown', onOutsideClick, true);

  // ── React to theme changes ─────────────────────────────────────────────
  function onThemeChange(): void {
    if (!editing) renderPreview();
  }
  document.addEventListener('mermaid-theme-changed', onThemeChange);

  // Initial render. Defer one frame so ProseMirror has injected the text
  // into our contentDOM before we read it.
  requestAnimationFrame(() => { void renderPreview(); });

  return {
    dom,
    contentDOM: code,
    update(updatedNode: { type: { name: string }; attrs: { language?: string } }) {
      if (updatedNode.type.name !== node.type.name) return false;
      const newLang = (updatedNode.attrs.language ?? '').toLowerCase();
      // If the language was changed away from mermaid, force ProseMirror to
      // rebuild the NodeView with the parent code-block one.
      if (newLang !== 'mermaid') return false;
      // Re-render preview when the document mutated the content (e.g. via
      // setContent or external edits) — but only if we're not editing, since
      // edit mode displays the source pane directly.
      if (!editing) requestAnimationFrame(() => { void renderPreview(); });
      return true;
    },
    ignoreMutation(mutation: { target: Node; type: string }) {
      const t = mutation.target;
      if (t === preview  || preview.contains(t))  return true;
      if (t === header   || header.contains(t))   return true;
      if (t === snackbar || snackbar.contains(t)) return true;
      if (t === dom && mutation.type === 'attributes') return true;
      return false;
    },
    destroy() {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onOutsideClick, true);
      document.removeEventListener('mermaid-theme-changed', onThemeChange);
      if (snackbarTimer) clearTimeout(snackbarTimer);
    },
  };
}

// ── Header sub-component builders ──────────────────────────────────────────

interface ToggleHandle {
  el:    HTMLElement;
  setOn: (on: boolean) => void;
}

function buildToggle(): ToggleHandle {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'mb-toggle';
  el.setAttribute('role', 'switch');
  el.setAttribute('aria-checked', 'false');
  el.setAttribute('aria-label', 'Edit mermaid source');
  el.innerHTML = `<span class="mb-toggle-label">Edit</span><span class="mb-toggle-track"><span class="mb-toggle-thumb"></span></span>`;
  return {
    el,
    setOn(on) {
      el.classList.toggle('mb-toggle-on', on);
      el.setAttribute('aria-checked', String(on));
    },
  };
}

function buildIconButton(html: string, tip: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mb-iconbtn';
  b.innerHTML = html;
  b.setAttribute('aria-label', tip);
  b.dataset.tip = tip;
  return b;
}

interface CopySplitHandle {
  el:      HTMLElement;
  onMain:  (cb: () => void) => void;
  onMenu:  (action: string, cb: () => void) => void;
  flash:   (text: string) => void;
}

function buildCopySplit(): CopySplitHandle {
  const wrap = document.createElement('div');
  wrap.className = 'mb-copy';

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'mb-copy-main';
  main.innerHTML = `${ICON_COPY}<span class="mb-copy-label">Copy</span>`;
  main.setAttribute('aria-label', 'Copy mermaid code');

  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'mb-copy-caret';
  caret.innerHTML = ICON_CARET;
  caret.setAttribute('aria-label', 'More copy and download options');
  caret.setAttribute('aria-haspopup', 'menu');
  caret.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'mb-copy-menu mb-hidden';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button type="button" role="menuitem" data-action="copy-code">Copy mermaid code</button>
    <button type="button" role="menuitem" data-action="copy-svg">Copy as SVG</button>
    <div class="mb-copy-sep" role="separator"></div>
    <button type="button" role="menuitem" data-action="download-svg">Download as SVG</button>
    <button type="button" role="menuitem" data-action="download-png">Download as PNG</button>
  `;

  wrap.append(main, caret, menu);

  // Stop ProseMirror from stealing focus.
  [main, caret].forEach(b => {
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  });

  function openMenu(): void {
    menu.classList.remove('mb-hidden');
    caret.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onOutside, true);
  }
  function closeMenu(): void {
    menu.classList.add('mb-hidden');
    caret.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside, true);
  }
  function onOutside(e: MouseEvent): void {
    if (!wrap.contains(e.target as Node)) closeMenu();
  }
  caret.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu.classList.contains('mb-hidden')) openMenu();
    else closeMenu();
  });

  const mainListeners: (() => void)[] = [];
  const menuListeners = new Map<string, (() => void)>();

  main.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    mainListeners.forEach(fn => fn());
  });

  menu.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    const action = item.dataset.action ?? '';
    menuListeners.get(action)?.();
    closeMenu();
  });

  function flash(text: string): void {
    const original = main.querySelector('.mb-copy-label');
    if (!original) return;
    const previous = original.textContent;
    original.textContent = text;
    setTimeout(() => { original.textContent = previous; }, 1500);
  }

  return {
    el: wrap,
    onMain(cb) { mainListeners.push(cb); },
    onMenu(action, cb) { menuListeners.set(action, cb); },
    flash,
  };
}

// ── HTML fragment helpers ───────────────────────────────────────────────────

function spinnerHtml(): string {
  return `<div class="mb-spinner" aria-label="Rendering diagram"></div>`;
}

function emptyHtml(): string {
  return `<div class="mb-empty">Empty mermaid block · toggle <strong>Edit</strong> to add content</div>`;
}

function errorHtml(message: string, line?: number): string {
  const lineMeta = line ? `Parse error · line ${line}` : 'Parse error';
  const lineAttr = line ? ` data-line="${line}"` : '';
  return `
    <div class="mb-err" role="alert">
      <div class="mb-err-icon">${ICON_ALERT}</div>
      <div class="mb-err-title">Couldn't render diagram</div>
      <div class="mb-err-meta">${escapeHtml(lineMeta)}</div>
      <div class="mb-err-msg">${escapeHtml(message)}</div>
      <button type="button" class="mb-err-fix"${lineAttr}>Fix in source</button>
    </div>
  `;
}

// ── Copy / download helpers ─────────────────────────────────────────────────

function copyText(text: string, flash: (s: string) => void): void {
  navigator.clipboard.writeText(text).then(
    () => flash('Copied!'),
    () => flash('Copy failed'),
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function rasterizeAndDownload(svg: string, filename: string): Promise<void> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload  = () => resolve();
      img.onerror = () => reject(new Error('SVG load failed'));
      img.src = url;
    });
    // Pick a sensible export size: native intrinsic dimensions × 2 for DPR.
    const w = (img.naturalWidth  || 800) * 2;
    const h = (img.naturalHeight || 600) * 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas context unavailable');
    ctx.fillStyle = '#ffffff'; // PNGs default-opaque; transparent confuses paste targets.
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return;
      downloadBlob(pngBlob, filename);
    }, 'image/png');
  } catch (err) {
    console.error('[md-editor-plus] PNG rasterize failed', err);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function filenameStem(source: string): string {
  return `mermaid-${detectDiagramKind(source)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;'  :
    c === '>' ? '&gt;'  :
    c === '"' ? '&quot;' :
    '&#39;'
  ));
}
