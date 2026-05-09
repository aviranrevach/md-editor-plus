import lightCss from './styles/notion-light.css';
import darkCss from './styles/notion-dark.css';
import editorCss from './styles/editor.css';
import { createEditor, updateContent, createSourceEditor, updateSourceContent, getSourceMarkdown, getCurrentMarkdown, setFrontmatterChangeListener, setMediaBaseUri } from './editor';
import { initTheme, applyTheme, ThemeSetting } from './theme';
import { initTooltips } from './tooltip';
import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' :
    '&#39;'
  ));
}

interface HastNode {
  type: 'root' | 'element' | 'text';
  value?: string;
  tagName?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
}

function hastToHtml(node: HastNode): string {
  if (node.type === 'text') return escapeHtml(node.value ?? '');
  if (node.type === 'root') return (node.children ?? []).map(hastToHtml).join('');
  if (node.type === 'element') {
    const cls = (node.properties?.className ?? []).join(' ');
    const inner = (node.children ?? []).map(hastToHtml).join('');
    return `<span class="${escapeHtml(cls)}">${inner}</span>`;
  }
  return '';
}

function highlightMarkdown(text: string): string {
  try {
    const tree = lowlight.highlight('markdown', text);
    return hastToHtml(tree as unknown as HastNode);
  } catch {
    return escapeHtml(text);
  }
}

declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
};

const vscode = acquireVsCodeApi();
// Expose the handle so other modules (like bubbleMenu.ts) can post messages
// without trying to call acquireVsCodeApi() a second time (which throws).
(window as unknown as { __mdViewerVscode?: typeof vscode }).__mdViewerVscode = vscode;

interface SavedDefaults {
  theme?: ThemeSetting;
  font?: FontKind;
  textSize?: TextSize;
  pageWidth?: number;
  fullWidth?: boolean;
  alwaysDarkCode?: boolean;
  alwaysDarkSource?: boolean;
  sourceFullWidth?: boolean;
  shortenCodeSnippets?: boolean;
}
interface InitMessage   { type: 'init';   markdown: string; defaults: SavedDefaults; mediaBaseUri?: string; }
interface UpdateMessage { type: 'update'; markdown: string; }
type HostMessage = InitMessage | UpdateMessage;

type WidthMode  = 'normal' | 'full';
type TextSize   = 's' | 'm' | 'l' | 'xl';
type FontKind   = 'sans' | 'serif' | 'mono';

const WIDTH_CLASSES = ['width-normal', 'width-full'];
const TEXT_CLASSES  = ['text-s', 'text-m', 'text-l', 'text-xl'];
const FONT_CLASSES  = ['font-sans', 'font-serif', 'font-mono'];

const DEFAULT_WIDTH_PX = 800;
const SNAP_STOPS = [600, 800, 1000, 1200, 1400];
const SNAP_THRESHOLD_PX = 30;

const FACTORY_DEFAULTS = {
  theme:               'light' as ThemeSetting,
  font:                'sans'  as FontKind,
  textSize:            'm'     as TextSize,
  pageWidth:           DEFAULT_WIDTH_PX,
  fullWidth:           false,
  alwaysDarkCode:      false,
  alwaysDarkSource:    false,
  sourceFullWidth:     false,
  shortenCodeSnippets: false,
};

const DEFAULT_KEYS = [
  'theme', 'font', 'textSize', 'pageWidth', 'fullWidth',
  'alwaysDarkCode', 'alwaysDarkSource', 'sourceFullWidth', 'shortenCodeSnippets',
] as const;

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = lightCss + darkCss + editorCss;
  document.head.appendChild(style);
}

function segActivate(btns: HTMLButtonElement[], key: string, value: string): void {
  btns.forEach(b => b.classList.toggle('active', b.dataset[key] === value));
}

function normalizeMd(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

function init(): void {
  injectStyles();
  initTooltips();

  const editorEl       = document.getElementById('editor')!;
  const sourceEl       = document.getElementById('source-view')!;
  const sourceEditorEl = document.getElementById('source-editor') as HTMLElement;
  let sourceEditorReady = false;

  function ensureSourceEditor(): void {
    // Pull the live markdown straight from the main editor (bypasses the
    // 500ms onUpdate debounce) so the Code view always reflects the latest
    // edit — even if the user toggles immediately after editing.
    const fresh = editorReady ? getCurrentMarkdown() : currentMarkdown;
    if (fresh !== currentMarkdown) {
      currentMarkdown = fresh;
      lastSentMarkdown = normalizeMd(fresh);
      vscode.postMessage({ type: 'edit', markdown: fresh });
    }
    if (sourceEditorReady) {
      updateSourceContent(currentMarkdown);
      return;
    }
    createSourceEditor(sourceEditorEl, currentMarkdown, (md) => {
      currentMarkdown = md;
      lastSentMarkdown = normalizeMd(md);
      vscode.postMessage({ type: 'edit', markdown: md });
    });
    sourceEditorReady = true;
  }

  const viewBtns  = Array.from(document.querySelectorAll<HTMLButtonElement>('#view-seg .seg-btn'));
  const themeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('#theme-seg .seg-btn'));
  const fontBtns  = Array.from(document.querySelectorAll<HTMLButtonElement>('#font-seg .seg-btn'));
  const textBtns  = Array.from(document.querySelectorAll<HTMLButtonElement>('#text-seg .seg-btn'));

  const settingsBtn   = document.getElementById('settings-btn') as HTMLElement;
  const settingsPanel = document.getElementById('settings-panel') as HTMLElement;
  const fullWidthTog  = document.getElementById('full-width-toggle') as HTMLElement;
  const widthSlider   = document.getElementById('width-slider') as HTMLInputElement;
  const widthValue    = document.getElementById('width-value') as HTMLElement;
  const sliderRow     = document.getElementById('custom-slider-row') as HTMLElement;
  const pageWidthRow  = document.getElementById('page-width-row') as HTMLElement;

  const alwaysDarkCodeToggle = document.getElementById('always-dark-code-toggle') as HTMLElement;
  const alwaysDarkSourceToggle = document.getElementById('always-dark-source-toggle') as HTMLElement;
  const sourceFullWidthToggle = document.getElementById('source-full-width-toggle') as HTMLElement;
  const shortenSnippetsToggle = document.getElementById('shorten-snippets-toggle') as HTMLElement;

  function setAlwaysDarkCode(on: boolean): void {
    document.documentElement.classList.toggle('code-always-dark', on);
    alwaysDarkCodeToggle.classList.toggle('on', on);
    alwaysDarkCodeToggle.setAttribute('aria-checked', String(on));
    refreshDefaultsButtons();
  }

  function setAlwaysDarkSource(on: boolean): void {
    document.documentElement.classList.toggle('source-always-dark', on);
    alwaysDarkSourceToggle.classList.toggle('on', on);
    alwaysDarkSourceToggle.setAttribute('aria-checked', String(on));
    // If we're already in source mode, the page-level dark needs to refresh too.
    applyThemeState();
    refreshDefaultsButtons();
  }

  function setSourceFullWidth(on: boolean): void {
    document.documentElement.classList.toggle('source-full-width', on);
    sourceFullWidthToggle.classList.toggle('on', on);
    sourceFullWidthToggle.setAttribute('aria-checked', String(on));
    refreshDefaultsButtons();
  }

  function setShortenSnippets(on: boolean): void {
    document.documentElement.classList.toggle('shorten-snippets', on);
    shortenSnippetsToggle.classList.toggle('on', on);
    shortenSnippetsToggle.setAttribute('aria-checked', String(on));
    document.querySelectorAll('.cb.cb-expanded').forEach((el) => el.classList.remove('cb-expanded'));
    refreshDefaultsButtons();
  }

  alwaysDarkCodeToggle.addEventListener('click', () => {
    setAlwaysDarkCode(!alwaysDarkCodeToggle.classList.contains('on'));
  });
  alwaysDarkSourceToggle.addEventListener('click', () => {
    setAlwaysDarkSource(!alwaysDarkSourceToggle.classList.contains('on'));
  });
  sourceFullWidthToggle.addEventListener('click', () => {
    setSourceFullWidth(!sourceFullWidthToggle.classList.contains('on'));
  });
  shortenSnippetsToggle.addEventListener('click', () => {
    setShortenSnippets(!shortenSnippetsToggle.classList.contains('on'));
  });

  let editorReady     = false;
  let currentMarkdown = '';
  let lastSentMarkdown: string | null = null;
  let sourceMode      = false;
  let widthMode: WidthMode = 'normal';

  function setView(mode: 'preview' | 'source'): void {
    const targetSource = mode === 'source';
    // Idempotent — clicking the active button does nothing
    if (sourceMode === targetSource && editorReady) {
      segActivate(viewBtns, 'view', mode);
      return;
    }
    // Flush any unsaved source-editor content before leaving source mode so
    // the main editor / VS Code see the latest text immediately.
    if (sourceMode && !targetSource && sourceEditorReady) {
      const md = getSourceMarkdown();
      if (md !== currentMarkdown) {
        currentMarkdown = md;
        lastSentMarkdown = normalizeMd(md);
        vscode.postMessage({ type: 'edit', markdown: md });
      }
    }

    sourceMode = targetSource;
    segActivate(viewBtns, 'view', mode);

    // Tear down any floating editor UI so it doesn't bleed across views
    document.querySelectorAll('.bubble-menu, .block-picker, .cb-drop-line').forEach(el => {
      el.classList.remove('open');
      (el as HTMLElement).style.display = 'none';
    });

    if (sourceMode) {
      ensureSourceEditor();
      editorEl.style.display = 'none';
      sourceEl.style.display = 'block';
    } else {
      editorEl.style.display = '';
      sourceEl.style.display = 'none';
    }

    // Re-evaluate theme so the source-mode dark override takes effect / clears.
    applyThemeState();

    if (!sourceMode) {
      // Re-sync the editor's content with the source-of-truth markdown when
      // returning to preview, so any external edits applied while in code
      // view are reflected.
      if (editorReady) updateContent(currentMarkdown);
    }
  }

  // Frontmatter badge on the Code view-toggle button. Surfaces that the file
  // has YAML/TOML frontmatter without putting chrome above the document body.
  const fmBadge = document.getElementById('fm-badge') as HTMLElement | null;
  const codeBtn = viewBtns.find(b => b.dataset.view === 'source') ?? null;
  setFrontmatterChangeListener(({ lines, kind }) => {
    const present = kind !== 'none' && lines > 0;
    if (fmBadge) {
      fmBadge.classList.toggle('hidden', !present);
      fmBadge.textContent = present ? String(lines) : '';
    }
    if (codeBtn) {
      codeBtn.dataset.tip = present
        ? `Source view — raw markdown · ${lines} ${lines === 1 ? 'line' : 'lines'} of frontmatter`
        : 'Source view — raw markdown';
    }
  });

  function setWidth(mode: WidthMode): void {
    widthMode = mode;
    WIDTH_CLASSES.forEach(c => { editorEl.classList.remove(c); sourceEl.classList.remove(c); });
    editorEl.classList.add(`width-${mode}`);
    sourceEl.classList.add(`width-${mode}`);
    fullWidthTog.classList.toggle('on', mode === 'full');
    fullWidthTog.setAttribute('aria-checked', String(mode === 'full'));
    sliderRow.classList.toggle('disabled', mode === 'full');
    pageWidthRow.classList.toggle('disabled', mode === 'full');
    refreshDefaultsButtons();
  }

  function exitFullWidth(): void {
    if (widthMode === 'full') setWidth('normal');
  }

  function setTextSize(size: TextSize): void {
    TEXT_CLASSES.forEach(c => { editorEl.classList.remove(c); sourceEl.classList.remove(c); });
    editorEl.classList.add(`text-${size}`);
    sourceEl.classList.add(`text-${size}`);
    segActivate(textBtns, 'text', size);
    refreshDefaultsButtons();
  }

  function setFont(font: FontKind): void {
    FONT_CLASSES.forEach(c => editorEl.classList.remove(c));
    editorEl.classList.add(`font-${font}`);
    segActivate(fontBtns, 'font', font);
    refreshDefaultsButtons();
  }

  const stopEls = Array.from(document.querySelectorAll<HTMLElement>('.slider-stop'));

  function applyPageWidth(): void {
    const px = parseInt(widthSlider.value, 10) || DEFAULT_WIDTH_PX;
    document.documentElement.style.setProperty('--editor-normal-width', `${px}px`);
    widthValue.textContent = String(px);
    stopEls.forEach(el => {
      el.classList.toggle('active', Number(el.dataset.stop) === px);
    });
    refreshDefaultsButtons();
  }

  function snapToNearestStop(): void {
    const raw = parseInt(widthSlider.value, 10);
    let best = raw;
    let bestDist = SNAP_THRESHOLD_PX + 1;
    for (const s of SNAP_STOPS) {
      const d = Math.abs(raw - s);
      if (d <= SNAP_THRESHOLD_PX && d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    if (best !== raw) {
      widthSlider.value = String(best);
      applyPageWidth();
    }
  }

  widthSlider.addEventListener('pointerdown', exitFullWidth);
  widthSlider.addEventListener('keydown', exitFullWidth);
  widthSlider.addEventListener('input', applyPageWidth);
  widthSlider.addEventListener('change', snapToNearestStop);
  widthSlider.addEventListener('pointerup', snapToNearestStop);
  widthSlider.addEventListener('keyup', snapToNearestStop);

  stopEls.forEach(el => {
    el.addEventListener('click', () => {
      exitFullWidth();
      const px = Number(el.dataset.stop);
      if (!Number.isFinite(px)) return;
      widthSlider.value = String(px);
      applyPageWidth();
    });
  });

  pageWidthRow.addEventListener('click', exitFullWidth);

  type ManualTheme = 'light' | 'sepia' | 'claude' | 'dark';
  const themeSeg = document.getElementById('theme-seg') as HTMLElement;
  const autoToggle = document.getElementById('auto-theme-toggle') as HTMLElement;
  let manualTheme: ManualTheme = 'light';
  let autoEnabled = false;

  function applyThemeState(): void {
    // When in code/source view and "Always dark: Code view" is on, force the
    // entire page into dark mode regardless of the user's selected theme.
    const sourceForcesDark =
      sourceMode && document.documentElement.classList.contains('source-always-dark');
    if (sourceForcesDark) applyTheme('dark');
    else if (autoEnabled) applyTheme('auto');
    else applyTheme(manualTheme);
    segActivate(themeBtns, 'theme', manualTheme);
    themeSeg.classList.toggle('disabled', autoEnabled || sourceForcesDark);
    autoToggle.classList.toggle('on', autoEnabled);
    autoToggle.setAttribute('aria-checked', String(autoEnabled));
    refreshDefaultsButtons();
  }

  function setManualTheme(theme: ManualTheme): void {
    manualTheme = theme;
    autoEnabled = false;
    applyThemeState();
  }

  function setAutoTheme(enabled: boolean): void {
    autoEnabled = enabled;
    applyThemeState();
  }

  function loadInitialTheme(setting: ThemeSetting): void {
    if (setting === 'auto') {
      autoEnabled = true;
    } else {
      autoEnabled = false;
      manualTheme = setting;
    }
    applyThemeState();
  }

  autoToggle.addEventListener('click', () => setAutoTheme(!autoEnabled));

  // Wire up clicks
  viewBtns.forEach(b  => b.addEventListener('click', () => setView(b.dataset.view as 'preview' | 'source')));
  themeBtns.forEach(b => b.addEventListener('click', () => setManualTheme(b.dataset.theme as ManualTheme)));
  fontBtns.forEach(b  => b.addEventListener('click', () => setFont(b.dataset.font as FontKind)));
  textBtns.forEach(b  => b.addEventListener('click', () => setTextSize(b.dataset.text as TextSize)));

  fullWidthTog.addEventListener('click', () => {
    setWidth(widthMode === 'full' ? 'normal' : 'full');
  });

  const actionsBtn          = document.getElementById('actions-btn') as HTMLElement;
  const actionsPanelDots    = document.getElementById('actions-panel-dots') as HTMLElement;
  const actionsPanelFile    = document.getElementById('actions-panel-filename') as HTMLElement;
  const filenameEl          = document.getElementById('toolbar-filename') as HTMLElement | null;

  const toolbarEl = document.getElementById('toolbar') as HTMLElement;
  function anyActionsPanelOpen(): boolean {
    return !actionsPanelDots.classList.contains('hidden')
        || !actionsPanelFile.classList.contains('hidden');
  }
  function syncToolbarPanelState(): void {
    const open = !settingsPanel.classList.contains('hidden') || anyActionsPanelOpen();
    toolbarEl.classList.toggle('panel-open', open);
  }

  function closeDotsPanel(): void {
    actionsPanelDots.classList.add('hidden');
    actionsBtn.classList.remove('active');
    syncToolbarPanelState();
  }
  function closeFilenamePanel(): void {
    actionsPanelFile.classList.add('hidden');
    filenameEl?.classList.remove('active');
    syncToolbarPanelState();
  }
  function closeAllActionsPanels(): void {
    closeDotsPanel();
    closeFilenamePanel();
  }
  function closeSettingsPanel(): void {
    settingsPanel.classList.add('hidden');
    settingsBtn.classList.remove('active');
    syncToolbarPanelState();
  }

  // Wire up action buttons inside both panels (each panel has its own DOM)
  function bindActions(panel: HTMLElement): void {
    panel.querySelector<HTMLElement>('.act-copy')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'copyContent' });
      closeAllActionsPanels();
    });
    panel.querySelector<HTMLElement>('.act-copy-path')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'copyFilePath' });
      closeAllActionsPanels();
    });
    panel.querySelector<HTMLElement>('.act-duplicate')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'duplicate' });
      closeAllActionsPanels();
    });
    panel.querySelector<HTMLElement>('.act-finder')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openInFinder' });
      closeAllActionsPanels();
    });
  }
  bindActions(actionsPanelDots);
  bindActions(actionsPanelFile);

  // Settings dropdown toggle
  settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    closeAllActionsPanels();
    settingsPanel.classList.toggle('hidden');
    settingsBtn.classList.toggle('active');
    syncToolbarPanelState();
  });

  // Three-dots — click only, anchored top-right
  function openDotsPanel(): void {
    closeSettingsPanel();
    closeFilenamePanel();
    actionsPanelDots.classList.remove('hidden');
    actionsBtn.classList.add('active');
    syncToolbarPanelState();
  }
  function toggleDotsPanel(): void {
    if (actionsPanelDots.classList.contains('hidden')) openDotsPanel();
    else closeDotsPanel();
  }
  actionsBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleDotsPanel();
  });

  // Filename — hover only, anchored centered under filename
  let fileOpenTimer: number | null = null;
  let fileCloseTimer: number | null = null;
  function openFilenamePanel(): void {
    closeSettingsPanel();
    closeDotsPanel();
    actionsPanelFile.classList.remove('hidden');
    filenameEl?.classList.add('active');
    syncToolbarPanelState();
  }
  function scheduleFilenameOpen(): void {
    if (fileCloseTimer) { clearTimeout(fileCloseTimer); fileCloseTimer = null; }
    if (!actionsPanelFile.classList.contains('hidden')) return;
    if (fileOpenTimer) return;
    fileOpenTimer = window.setTimeout(() => {
      fileOpenTimer = null;
      openFilenamePanel();
    }, 120);
  }
  function scheduleFilenameClose(): void {
    if (fileOpenTimer) { clearTimeout(fileOpenTimer); fileOpenTimer = null; }
    if (fileCloseTimer) return;
    fileCloseTimer = window.setTimeout(() => {
      fileCloseTimer = null;
      closeFilenamePanel();
    }, 220);
  }
  filenameEl?.addEventListener('mouseenter', scheduleFilenameOpen);
  filenameEl?.addEventListener('mouseleave', scheduleFilenameClose);
  actionsPanelFile.addEventListener('mouseenter', () => {
    if (fileCloseTimer) { clearTimeout(fileCloseTimer); fileCloseTimer = null; }
  });
  actionsPanelFile.addEventListener('mouseleave', scheduleFilenameClose);

  document.addEventListener('click', e => {
    const t = e.target as Node;
    if (!settingsPanel.classList.contains('hidden')
        && !settingsPanel.contains(t)
        && !settingsBtn.contains(t)) {
      closeSettingsPanel();
    }
    if (!actionsPanelDots.classList.contains('hidden')
        && !actionsPanelDots.contains(t)
        && !actionsBtn.contains(t)) {
      closeDotsPanel();
    }
    if (!actionsPanelFile.classList.contains('hidden')
        && !actionsPanelFile.contains(t)
        && !(filenameEl?.contains(t))) {
      closeFilenamePanel();
    }
  });

  // Reveal toolbar contents when cursor is within 150px of the top
  const TOOLBAR_REVEAL_PX = 150;
  window.addEventListener('mousemove', e => {
    toolbarEl.classList.toggle('cursor-near', e.clientY <= TOOLBAR_REVEAL_PX);
  });

  function applyDefaults(d: SavedDefaults): void {
    initTheme(d.theme ?? 'light');
    loadInitialTheme(d.theme ?? 'light');
    setFont(d.font ?? 'sans');
    setTextSize(d.textSize ?? 'm');
    const px = typeof d.pageWidth === 'number' ? d.pageWidth : DEFAULT_WIDTH_PX;
    widthSlider.value = String(px);
    applyPageWidth();
    setWidth(d.fullWidth ? 'full' : 'normal');
    setAlwaysDarkCode(Boolean(d.alwaysDarkCode));
    setAlwaysDarkSource(Boolean(d.alwaysDarkSource));
    setSourceFullWidth(Boolean(d.sourceFullWidth));
    setShortenSnippets(Boolean(d.shortenCodeSnippets));
  }

  let savedDefaults: SavedDefaults = { ...FACTORY_DEFAULTS };

  function defaultsEqual(a: SavedDefaults, b: SavedDefaults): boolean {
    for (const k of DEFAULT_KEYS) {
      const av = (a as Record<string, unknown>)[k] ?? (FACTORY_DEFAULTS as Record<string, unknown>)[k];
      const bv = (b as Record<string, unknown>)[k] ?? (FACTORY_DEFAULTS as Record<string, unknown>)[k];
      if (av !== bv) return false;
    }
    return true;
  }

  const saveBtn  = document.getElementById('save-defaults-btn')  as HTMLButtonElement | null;
  const resetBtn = document.getElementById('reset-defaults-btn') as HTMLButtonElement | null;

  function refreshDefaultsButtons(): void {
    if (!saveBtn || !resetBtn) return;
    const cur = currentDefaults();
    const savedIsFactory = defaultsEqual(savedDefaults, FACTORY_DEFAULTS);
    const curIsSaved     = defaultsEqual(cur, savedDefaults);
    const curIsFactory   = defaultsEqual(cur, FACTORY_DEFAULTS);
    saveBtn.disabled  = curIsSaved;
    resetBtn.disabled = savedIsFactory && curIsFactory;
  }

  // Initial render before init message arrives — keeps things consistent if
  // the message is delayed.
  applyPageWidth();
  setWidth('normal');
  setTextSize('m');
  setFont('sans');

  function currentDefaults(): SavedDefaults {
    return {
      theme:               (autoEnabled ? 'auto' : manualTheme) as ThemeSetting,
      font:                (FONT_CLASSES.find(c => editorEl.classList.contains(c))?.replace('font-', '') as FontKind) ?? 'sans',
      textSize:            (TEXT_CLASSES.find(c => editorEl.classList.contains(c))?.replace('text-', '') as TextSize) ?? 'm',
      pageWidth:           parseInt(widthSlider.value, 10) || DEFAULT_WIDTH_PX,
      fullWidth:           widthMode === 'full',
      alwaysDarkCode:      alwaysDarkCodeToggle.classList.contains('on'),
      alwaysDarkSource:    alwaysDarkSourceToggle.classList.contains('on'),
      sourceFullWidth:     sourceFullWidthToggle.classList.contains('on'),
      shortenCodeSnippets: shortenSnippetsToggle.classList.contains('on'),
    };
  }

  saveBtn?.addEventListener('click', () => {
    if (saveBtn.disabled) return;
    const cur = currentDefaults();
    vscode.postMessage({ type: 'saveDefaults', defaults: cur });
    savedDefaults = cur;
    refreshDefaultsButtons();
  });
  resetBtn?.addEventListener('click', () => {
    if (resetBtn.disabled) return;
    vscode.postMessage({ type: 'resetDefaults' });
    savedDefaults = { ...FACTORY_DEFAULTS };
    applyDefaults({});
    refreshDefaultsButtons();
  });

  window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
    const msg = event.data;

    if (msg.type === 'init') {
      currentMarkdown = msg.markdown;
      if (msg.mediaBaseUri) setMediaBaseUri(msg.mediaBaseUri);
      savedDefaults = { ...FACTORY_DEFAULTS, ...(msg.defaults ?? {}) };
      applyDefaults(msg.defaults ?? {});
      refreshDefaultsButtons();
      createEditor(editorEl, msg.markdown, (markdown) => {
        currentMarkdown = markdown;
        lastSentMarkdown = normalizeMd(markdown);
        if (sourceMode && sourceEditorReady) updateSourceContent(markdown);
        vscode.postMessage({ type: 'edit', markdown });
      });
      editorReady = true;
    }

    if (msg.type === 'update' && editorReady) {
      // Skip the round-trip echo of our own edit — re-running setContent
      // forces lowlight to re-tokenize, which briefly clears syntax colors.
      // Compare normalized (VS Code may rewrite trailing whitespace / line endings).
      if (lastSentMarkdown !== null && normalizeMd(msg.markdown) === lastSentMarkdown) {
        currentMarkdown = msg.markdown;
        if (sourceMode && sourceEditorReady) updateSourceContent(msg.markdown);
        return;
      }
      currentMarkdown = msg.markdown;
      updateContent(msg.markdown);
      if (sourceMode && sourceEditorReady) updateSourceContent(msg.markdown);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
