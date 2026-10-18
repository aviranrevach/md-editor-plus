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
import { canEdit, parseMermaid } from '../mermaidVisualEdit';
import { createVisualEditor, VisualEditorHandle, applyPositionsOverlay, applyStylesOverlay, applyStandaloneLinesOverlay } from '../mermaidVisualEditDom';

// SVGs — kept inline so the bundle has no extra asset deps.
const ICON_EXPAND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>`;
const ICON_COPY   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_PENCIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
const ICON_ALERT  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
const ICON_MORE   = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5"  cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`;
// Eye + Code icons — same Phosphor glyphs as the top-of-plugin Preview/Code
// segmented toggle so the visual language matches.
const ICON_EYE    = `<svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M251,123.13c-.37-.81-9.13-20.26-28.48-39.61C196.63,57.67,164,44,128,44S59.37,57.67,33.51,83.52C14.16,102.87,5.4,122.32,5,123.13a12.08,12.08,0,0,0,0,9.75c.37.82,9.13,20.26,28.49,39.61C59.37,198.34,92,212,128,212s68.63-13.66,94.48-39.51c19.36-19.35,28.12-38.79,28.49-39.61A12.08,12.08,0,0,0,251,123.13Zm-46.06,33C183.47,177.27,157.59,188,128,188s-55.47-10.73-76.91-31.88A130.36,130.36,0,0,1,29.52,128,130.45,130.45,0,0,1,51.09,99.89C72.54,78.73,98.41,68,128,68s55.46,10.73,76.91,31.89A130.36,130.36,0,0,1,226.48,128,130.45,130.45,0,0,1,204.91,156.12ZM128,84a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,84Zm0,64a20,20,0,1,1,20-20A20,20,0,0,1,128,148Z"/></svg>`;
const ICON_CODE_V = `<svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M96,73,34.06,128,96,183A12,12,0,1,1,80,201L8,137A12,12,0,0,1,8,119L80,55A12,12,0,0,1,96,73ZM248,119,176,55A12,12,0,1,0,160,73l61.91,55L160,183A12,12,0,1,0,176,201l72-64A12,12,0,0,0,248,119Z"/></svg>`;

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
  const { node, editor, getPos } = props as {
    node:   { attrs: { language?: string }; type: { name: string } };
    editor: {
      state:  { doc: { nodeAt: (p: number) => { type: { create: (attrs: unknown, content?: unknown) => unknown }; attrs: unknown; nodeSize: number } | null }; tr: { replaceWith: (a: number, b: number, n: unknown) => unknown } };
      view:   { dispatch: (tr: unknown) => void };
      schema: { text: (s: string) => unknown };
    };
    getPos: unknown;
  };

  const dom = document.createElement('div');
  dom.className = 'mb';
  dom.dataset.lang = 'mermaid';

  // ── Header (floating chrome, no bar) ─────────────────────────────────────
  // LEFT:  segmented eye/code toggle (preview ↔ source) — matches the
  //        Preview/Code toggle at the top of the plugin minus the labels.
  // RIGHT: Expand icon + ⋯ More menu (Edit toggle + copy/download).
  // The chrome is hidden in preview mode unless the user hovers the block;
  // it stays visible while editing source or in visual-edit mode.
  const header = document.createElement('div');
  header.className = 'mb-header';
  header.contentEditable = 'false';

  const leftGroup = document.createElement('div');
  leftGroup.className = 'mb-header-left';
  const viewToggle = buildViewToggle();
  leftGroup.append(viewToggle.el);

  const rightGroup = document.createElement('div');
  rightGroup.className = 'mb-header-right';
  const expandBtn = buildIconButton(ICON_EXPAND, 'Open fullscreen');
  expandBtn.classList.add('mb-expand');
  const more = buildMoreMenu();
  // Compatibility shim: the rest of the file talks to a `toggle` and
  // `copySplit` object — we expose the same surface from inside `more`.
  const toggle = more.toggle;
  const copySplit = more.copy;
  rightGroup.append(expandBtn, more.el);

  header.append(leftGroup, rightGroup);

  // ── Preview pane ───────────────────────────────────────────────────────
  // preview = outer pane (also hosts visual-edit overlays as siblings)
  // svgHost = inner div whose innerHTML we replace with each render
  const preview = document.createElement('div');
  preview.className = 'mb-preview';
  preview.contentEditable = 'false';

  const svgHost = document.createElement('div');
  svgHost.className = 'mb-svg-host';
  preview.appendChild(svgHost);

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
  let visualHandle: VisualEditorHandle | null = null;
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
    // Source mode and visual mode are mutually exclusive — entering source
    // tears down visual.
    if (on && visualHandle) setVisualEditing(false);
    editing = on;
    dom.classList.toggle('mb-editing', on);
    toggle.setOn(on);
    viewToggle.setMode(on ? 'source' : 'preview');
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

  // Replace the codeBlock node's text content with a new mermaid source.
  // Mirrors the moveLine() pattern in codeBlock.ts — replaceWith forces lowlight
  // (irrelevant here) to re-decorate and ProseMirror to fire update() on us.
  function writeSourceBack(newSource: string): void {
    if (typeof getPos !== 'function') return;
    const pos = (getPos as () => number)();
    if (typeof pos !== 'number') return;
    const cbNode = editor.state.doc.nodeAt(pos);
    if (!cbNode) return;
    const newContent = newSource.length > 0 ? editor.schema.text(newSource) : undefined;
    const newNode = cbNode.type.create(cbNode.attrs, newContent);
    editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + cbNode.nodeSize, newNode));
  }

  function setVisualEditing(on: boolean): void {
    if (on === !!visualHandle) return;
    if (on) {
      // Don't enter visual when source mode is active — there's nothing to
      // overlay on (preview pane is hidden).
      if (editing) return;
      // Refuse to activate if the parser can't make sense of the source.
      if (!canEdit(currentSource())) {
        // Fall back to source mode so the user can still edit.
        setEditing(true);
        return;
      }
      visualHandle = createVisualEditor({
        block:       dom,
        previewPane: preview,
        getSource:   currentSource,
        onSourceChange: (newSource) => {
          writeSourceBack(newSource);
        },
        onExit: () => setVisualEditing(false),
      });
      dom.classList.add('mb-visual');
    } else {
      visualHandle?.destroy();
      visualHandle = null;
      dom.classList.remove('mb-visual');
    }
  }

  async function renderPreview(): Promise<void> {
    const myToken = ++renderToken;
    const src = currentSource();
    if (!src.trim()) {
      svgHost.innerHTML = emptyHtml();
      lastSvg = null;
      expandBtn.classList.add('mb-disabled');
      return;
    }
    svgHost.innerHTML = spinnerHtml();
    const result = await renderMermaid(src);
    // If the user edited again while we were rendering, drop the stale result.
    if (myToken !== renderToken) return;
    if (result.ok) {
      svgHost.innerHTML = result.svg;
      lastSvg = result.svg;
      expandBtn.classList.remove('mb-disabled');
      // Phase 2: apply pinned positions (if any) over mermaid's auto-layout.
      // Runs regardless of visual mode so positioned diagrams render
      // correctly on initial load too.
      try {
        const ast = parseMermaid(src);
        applyPositionsOverlay(ast, preview);
        applyStylesOverlay(ast, preview);
        applyStandaloneLinesOverlay(ast, preview);
      } catch (err) {
        console.warn('[md-editor-plus] overlay apply failed', err);
      }
      // Let the visual editor re-bind its overlays to the freshly painted SVG.
      // Defer one frame so the new <g.node> elements are laid out before we
      // measure their bounding rects.
      if (visualHandle) requestAnimationFrame(() => visualHandle?.onMermaidRerender());
    } else {
      svgHost.innerHTML = errorHtml(result.message, result.line);
      lastSvg = null;
      expandBtn.classList.add('mb-disabled');
      wireFixButton();
      // A broken parse while in visual mode → bail back to preview/source.
      // The user can keep editing source until syntax is valid again.
      if (visualHandle) setVisualEditing(false);
    }
  }

  function wireFixButton(): void {
    const btn = svgHost.querySelector<HTMLButtonElement>('.mb-err-fix');
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
  // Eye/Code segmented control fires the same setEditing path so the two
  // controls stay in sync.
  viewToggle.onChange((mode) => setEditing(mode === 'source'));

  // ── Wire double-click on preview ───────────────────────────────────────
  // Double-click prefers visual edit; only flowchart/graph blocks qualify.
  // For diagrams we can't visually edit (sequence, state, gantt, exotic
  // syntax), double-click falls through to source mode.
  preview.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('.mb-err-fix')) return; // button handled separately
    e.preventDefault();
    e.stopPropagation();
    if (canEdit(currentSource())) {
      setVisualEditing(true);
    } else {
      setEditing(true);
    }
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
  copySplit.onMenu('delete', () => {
    if (typeof getPos !== 'function') return;
    const pos = (getPos as () => number)();
    if (typeof pos !== 'number') return;
    const cbNode = editor.state.doc.nodeAt(pos);
    if (!cbNode) return;
    const tr = editor.state.tr as unknown as { delete: (a: number, b: number) => unknown };
    editor.view.dispatch(tr.delete(pos, pos + cbNode.nodeSize));
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

  (dom as Element & { __mbOpenVisualMode?: () => void }).__mbOpenVisualMode = () => {
    if (canEdit(currentSource())) setVisualEditing(true);
  };

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
      visualHandle?.destroy();
      visualHandle = null;
    },
  };
}

// ── Header sub-component builders ──────────────────────────────────────────

interface ToggleHandle {
  el:    HTMLElement;
  setOn: (on: boolean) => void;
}

// Segmented eye/code toggle for the LEFT side of the block header. Two
// pill-shaped icon buttons, the active one filled. Drives setEditing(on)
// via the `onChange` callback the caller wires up.
interface ViewToggleHandle {
  el:      HTMLElement;
  setMode: (mode: 'preview' | 'source') => void;
  onChange:(cb: (mode: 'preview' | 'source') => void) => void;
}
function buildViewToggle(): ViewToggleHandle {
  const wrap = document.createElement('div');
  wrap.className = 'mb-view-seg';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'View mode');

  function makeBtn(mode: 'preview' | 'source', icon: string, tip: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mb-view-seg-btn';
    b.dataset.mode = mode;
    b.dataset.tip = tip;
    b.setAttribute('aria-label', tip);
    b.setAttribute('aria-pressed', mode === 'preview' ? 'true' : 'false');
    b.innerHTML = icon;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    return b;
  }
  const previewBtn = makeBtn('preview', ICON_EYE,    'Preview');
  const sourceBtn  = makeBtn('source',  ICON_CODE_V, 'Source');
  previewBtn.classList.add('mb-view-seg-active');
  wrap.append(previewBtn, sourceBtn);

  const listeners: Array<(mode: 'preview' | 'source') => void> = [];
  function dispatch(mode: 'preview' | 'source'): void {
    for (const fn of listeners) fn(mode);
  }
  previewBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dispatch('preview'); });
  sourceBtn .addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dispatch('source');  });

  function setMode(mode: 'preview' | 'source'): void {
    previewBtn.classList.toggle('mb-view-seg-active', mode === 'preview');
    sourceBtn .classList.toggle('mb-view-seg-active', mode === 'source');
    previewBtn.setAttribute('aria-pressed', String(mode === 'preview'));
    sourceBtn .setAttribute('aria-pressed', String(mode === 'source'));
  }

  return {
    el: wrap,
    setMode,
    onChange(cb) { listeners.push(cb); },
  };
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

// "More" dropdown menu — combines the Edit toggle, Copy actions, and
// downloads behind a single 3-dots icon. Exposes the existing `toggle`
// and `copySplit` handles so the rest of the file keeps working.
interface MoreMenuHandle {
  el:       HTMLElement;
  toggle:   ToggleHandle;
  copy:     CopySplitHandle;
}
function buildMoreMenu(): MoreMenuHandle {
  const wrap = document.createElement('div');
  wrap.className = 'mb-more';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mb-iconbtn mb-more-btn';
  btn.innerHTML = ICON_MORE;
  btn.setAttribute('aria-label', 'More actions');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.dataset.tip = 'More';

  const menu = document.createElement('div');
  menu.className = 'mb-more-menu mb-hidden';
  menu.setAttribute('role', 'menu');

  // Edit toggle row — switch lives inside the menu, with a left-side label.
  const toggleRow = document.createElement('div');
  toggleRow.className = 'mb-more-row mb-more-row-toggle';
  toggleRow.setAttribute('role', 'menuitemcheckbox');
  toggleRow.setAttribute('aria-label', 'Edit mermaid source');
  toggleRow.tabIndex = 0;
  const innerToggle = buildToggle();
  // The row itself is clickable AND the switch reflects state.
  const toggleLabel = document.createElement('span');
  toggleLabel.className = 'mb-more-row-label';
  toggleLabel.textContent = 'Edit';
  // Hide the toggle's own internal label since the row supplies its own.
  innerToggle.el.querySelector('.mb-toggle-label')?.classList.add('mb-hidden');
  toggleRow.append(toggleLabel, innerToggle.el);

  const sep1 = document.createElement('div');
  sep1.className = 'mb-copy-sep';
  sep1.setAttribute('role', 'separator');

  // Copy / download items.
  const items: Array<[string, string]> = [
    ['copy-code',    'Copy mermaid code'],
    ['copy-svg',     'Copy as SVG'],
    ['download-svg', 'Download as SVG'],
    ['download-png', 'Download as PNG'],
  ];
  for (const [action, label] of items) {
    const it = document.createElement('button');
    it.type = 'button';
    it.className = 'mb-more-row';
    it.setAttribute('role', 'menuitem');
    it.dataset.action = action;
    it.textContent = label;
    menu.appendChild(it);
  }

  // Delete — destructive, at the bottom under its own separator.
  const delSep = document.createElement('div');
  delSep.className = 'mb-copy-sep';
  delSep.setAttribute('role', 'separator');
  menu.appendChild(delSep);
  const delIt = document.createElement('button');
  delIt.type = 'button';
  delIt.className = 'mb-more-row mb-more-row-delete';
  delIt.setAttribute('role', 'menuitem');
  delIt.dataset.action = 'delete';
  delIt.textContent = 'Delete';
  menu.appendChild(delIt);

  // Place toggle row + separator at the top.
  menu.prepend(sep1);
  menu.prepend(toggleRow);

  wrap.append(btn, menu);

  // Stop ProseMirror from stealing focus.
  [btn, toggleRow, innerToggle.el].forEach(b => {
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  });

  function openMenu(): void {
    menu.classList.remove('mb-hidden');
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onOutside, true);
  }
  function closeMenu(): void {
    menu.classList.add('mb-hidden');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside, true);
  }
  function onOutside(e: MouseEvent): void {
    if (!wrap.contains(e.target as Node)) closeMenu();
  }
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (menu.classList.contains('mb-hidden')) openMenu();
    else closeMenu();
  });

  // Toggle row: clicking anywhere on the row flips the switch via the
  // outer wiring (we expose innerToggle.el so the existing handlers work).
  // Re-dispatch a click on the inner toggle from a click on the row.
  toggleRow.addEventListener('click', (e) => {
    // Don't loop when the click was on the toggle button itself.
    if ((e.target as Element).closest('.mb-toggle')) return;
    e.preventDefault();
    e.stopPropagation();
    innerToggle.el.click();
  });

  // Menu items: copy actions etc. We expose the same `onMain` / `onMenu`
  // interface as the old CopySplit so the existing wiring stays intact.
  const mainListeners: (() => void)[] = [];
  const menuListeners = new Map<string, (() => void)>();
  menu.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    menuListeners.get(item.dataset.action ?? '')?.();
    closeMenu();
  });

  // The legacy copySplit had a `flash` method that updated a label. Without
  // a visible inline label we use a transient snackbar-style text on the
  // first menu item. Best-effort — copy actions still work either way.
  function flash(text: string): void {
    const target = menu.querySelector<HTMLElement>('[data-action="copy-code"]');
    if (!target) return;
    const previous = target.textContent;
    target.textContent = text;
    setTimeout(() => { target.textContent = previous; }, 1500);
  }

  const copy: CopySplitHandle = {
    el: wrap,
    onMain(cb)  { mainListeners.push(cb); }, // unused now; preserved for API.
    onMenu(action, cb) { menuListeners.set(action, cb); },
    flash,
  };

  return { el: wrap, toggle: innerToggle, copy };
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
