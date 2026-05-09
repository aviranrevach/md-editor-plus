import lightCss from './styles/notion-light.css';
import darkCss from './styles/notion-dark.css';
import editorCss from './styles/editor.css';
import { createEditor, updateContent } from './editor';
import { initTheme, applyTheme, ThemeSetting } from './theme';

declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
};

const vscode = acquireVsCodeApi();

interface InitMessage   { type: 'init';        markdown: string; theme: ThemeSetting; alwaysDarkCode?: boolean; }
interface UpdateMessage { type: 'update';      markdown: string; }
interface ThemeMessage  { type: 'themeChange'; theme: ThemeSetting; }
type HostMessage = InitMessage | UpdateMessage | ThemeMessage;

type WidthMode  = 'normal' | 'full' | 'custom';
type WidthLevel = '1' | '2' | '3' | '4';
type TextSize   = 's' | 'm' | 'l' | 'xl';
type FontKind   = 'sans' | 'serif' | 'mono';

const WIDTH_CLASSES = ['width-normal', 'width-full', 'width-custom'];
const TEXT_CLASSES  = ['text-s', 'text-m', 'text-l', 'text-xl'];
const FONT_CLASSES  = ['font-sans', 'font-serif', 'font-mono'];

// 4 page-width levels (default is "2" = 900px)
const WIDTH_LEVELS: Record<WidthLevel, number> = {
  '1': 720,
  '2': 900,
  '3': 1100,
  '4': 1300,
};

// 5-step custom width preset (slider step 0..4)
const CUSTOM_WIDTHS = [600, 720, 850, 1000, 1200];

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = lightCss + darkCss + editorCss;
  document.head.appendChild(style);
}

function segActivate(btns: HTMLButtonElement[], key: string, value: string): void {
  btns.forEach(b => b.classList.toggle('active', b.dataset[key] === value));
}

function init(): void {
  injectStyles();

  const editorEl  = document.getElementById('editor')!;
  const sourceEl  = document.getElementById('source-view')!;
  const sourcePre = document.getElementById('source-pre')!;

  const viewBtns  = Array.from(document.querySelectorAll<HTMLButtonElement>('#view-seg .seg-btn'));
  const themeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('#theme-seg .seg-btn'));
  const fontBtns  = Array.from(document.querySelectorAll<HTMLButtonElement>('#font-seg .seg-btn'));
  const textBtns  = Array.from(document.querySelectorAll<HTMLButtonElement>('#text-seg .seg-btn'));
  const levelBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('#width-level-seg .seg-btn'));
  const levelSeg  = document.getElementById('width-level-seg') as HTMLElement;

  const settingsBtn   = document.getElementById('settings-btn') as HTMLElement;
  const settingsPanel = document.getElementById('settings-panel') as HTMLElement;
  const fullWidthTog  = document.getElementById('full-width-toggle') as HTMLElement;
  const customWidthTog = document.getElementById('custom-width-toggle') as HTMLElement;
  const customSliderRow = document.getElementById('custom-slider-row') as HTMLElement;
  const widthSlider   = document.getElementById('width-slider') as HTMLInputElement;
  const widthValue    = document.getElementById('width-value') as HTMLElement;
  const finderBtn     = document.getElementById('finder-btn') as HTMLElement;

  const alwaysDarkCodeToggle = document.getElementById('always-dark-code-toggle') as HTMLElement;

  function setAlwaysDarkCode(on: boolean, notify: boolean): void {
    document.documentElement.classList.toggle('code-always-dark', on);
    alwaysDarkCodeToggle.classList.toggle('on', on);
    alwaysDarkCodeToggle.setAttribute('aria-checked', String(on));
    if (notify) vscode.postMessage({ type: 'alwaysDarkCodeOverride', value: on });
  }

  alwaysDarkCodeToggle.addEventListener('click', () => {
    const isOn = alwaysDarkCodeToggle.classList.contains('on');
    setAlwaysDarkCode(!isOn, true);
  });

  let editorReady     = false;
  let currentMarkdown = '';
  let sourceMode      = false;
  let widthMode: WidthMode = 'normal';
  let widthLevel: WidthLevel = '2';

  function setView(mode: 'preview' | 'source'): void {
    sourceMode = mode === 'source';
    segActivate(viewBtns, 'view', mode);
    if (sourceMode) {
      sourcePre.textContent  = currentMarkdown;
      editorEl.style.display = 'none';
      sourceEl.style.display = 'block';
    } else {
      editorEl.style.display = '';
      sourceEl.style.display = 'none';
    }
  }

  function setWidth(mode: WidthMode): void {
    widthMode = mode;
    WIDTH_CLASSES.forEach(c => { editorEl.classList.remove(c); sourceEl.classList.remove(c); });
    editorEl.classList.add(`width-${mode}`);
    sourceEl.classList.add(`width-${mode}`);
    fullWidthTog.classList.toggle('on', mode === 'full');
    fullWidthTog.setAttribute('aria-checked', String(mode === 'full'));
    customWidthTog.classList.toggle('on', mode === 'custom');
    customWidthTog.setAttribute('aria-checked', String(mode === 'custom'));
    customSliderRow.classList.toggle('hidden', mode !== 'custom');
    levelSeg.classList.toggle('disabled', mode !== 'normal');
    if (mode === 'custom') applyCustomWidth();
    if (mode === 'normal') applyWidthLevel();
  }

  function setWidthLevel(level: WidthLevel): void {
    widthLevel = level;
    segActivate(levelBtns, 'level', level);
    if (widthMode !== 'normal') setWidth('normal');
    else applyWidthLevel();
  }

  function applyWidthLevel(): void {
    const px = WIDTH_LEVELS[widthLevel];
    document.documentElement.style.setProperty('--editor-normal-width', `${px}px`);
  }

  function setTextSize(size: TextSize): void {
    TEXT_CLASSES.forEach(c => { editorEl.classList.remove(c); sourceEl.classList.remove(c); });
    editorEl.classList.add(`text-${size}`);
    sourceEl.classList.add(`text-${size}`);
    segActivate(textBtns, 'text', size);
  }

  function setFont(font: FontKind): void {
    FONT_CLASSES.forEach(c => editorEl.classList.remove(c));
    editorEl.classList.add(`font-${font}`);
    segActivate(fontBtns, 'font', font);
  }

  function applyCustomWidth(): void {
    const idx = parseInt(widthSlider.value, 10);
    const px = CUSTOM_WIDTHS[idx] ?? 850;
    document.documentElement.style.setProperty('--editor-custom-width', `${px}px`);
    widthValue.textContent = String(px);
  }

  widthSlider.addEventListener('input', applyCustomWidth);

  type ManualTheme = 'light' | 'sepia' | 'claude' | 'dark';
  const themeSeg = document.getElementById('theme-seg') as HTMLElement;
  const autoToggle = document.getElementById('auto-theme-toggle') as HTMLElement;
  let manualTheme: ManualTheme = 'light';
  let autoEnabled = false;

  function notifyTheme(): void {
    const setting: ThemeSetting = autoEnabled ? 'auto' : manualTheme;
    vscode.postMessage({ type: 'themeOverride', theme: setting });
  }

  function applyThemeState(notify: boolean): void {
    if (autoEnabled) {
      applyTheme('auto');
    } else {
      applyTheme(manualTheme);
    }
    segActivate(themeBtns, 'theme', manualTheme);
    themeSeg.classList.toggle('disabled', autoEnabled);
    autoToggle.classList.toggle('on', autoEnabled);
    autoToggle.setAttribute('aria-checked', String(autoEnabled));
    if (notify) notifyTheme();
  }

  function setManualTheme(theme: ManualTheme, notify: boolean): void {
    manualTheme = theme;
    autoEnabled = false;
    applyThemeState(notify);
  }

  function setAutoTheme(enabled: boolean, notify: boolean): void {
    autoEnabled = enabled;
    applyThemeState(notify);
  }

  function loadInitialTheme(setting: ThemeSetting): void {
    if (setting === 'auto') {
      autoEnabled = true;
    } else {
      autoEnabled = false;
      manualTheme = setting;
    }
    applyThemeState(false);
  }

  autoToggle.addEventListener('click', () => setAutoTheme(!autoEnabled, true));

  // Wire up clicks
  viewBtns.forEach(b  => b.addEventListener('click', () => setView(b.dataset.view as 'preview' | 'source')));
  themeBtns.forEach(b => b.addEventListener('click', () => setManualTheme(b.dataset.theme as ManualTheme, true)));
  fontBtns.forEach(b  => b.addEventListener('click', () => setFont(b.dataset.font as FontKind)));
  textBtns.forEach(b  => b.addEventListener('click', () => setTextSize(b.dataset.text as TextSize)));
  levelBtns.forEach(b => b.addEventListener('click', () => setWidthLevel(b.dataset.level as WidthLevel)));

  fullWidthTog.addEventListener('click', () => {
    setWidth(widthMode === 'full' ? 'normal' : 'full');
  });
  customWidthTog.addEventListener('click', () => {
    setWidth(widthMode === 'custom' ? 'normal' : 'custom');
  });

  finderBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'openInFinder' });
  });

  document.getElementById('copy-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyContent' });
  });

  document.getElementById('duplicate-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'duplicate' });
  });

  // Settings dropdown toggle
  settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    settingsPanel.classList.toggle('hidden');
    settingsBtn.classList.toggle('active');
  });
  document.addEventListener('click', e => {
    if (settingsPanel.classList.contains('hidden')) return;
    if (settingsPanel.contains(e.target as Node)) return;
    if (settingsBtn.contains(e.target as Node)) return;
    settingsPanel.classList.add('hidden');
    settingsBtn.classList.remove('active');
  });

  // Initialize defaults
  setWidthLevel('2');
  setWidth('normal');
  setTextSize('m');
  setFont('sans');

  window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
    const msg = event.data;

    if (msg.type === 'init') {
      currentMarkdown = msg.markdown;
      initTheme(msg.theme);
      loadInitialTheme(msg.theme);
      setAlwaysDarkCode(Boolean(msg.alwaysDarkCode), false);
      createEditor(editorEl, msg.markdown, (markdown) => {
        currentMarkdown = markdown;
        if (sourceMode) sourcePre.textContent = markdown;
        vscode.postMessage({ type: 'edit', markdown });
      });
      editorReady = true;
    }

    if (msg.type === 'update' && editorReady) {
      currentMarkdown = msg.markdown;
      updateContent(msg.markdown);
      if (sourceMode) sourcePre.textContent = msg.markdown;
    }

    if (msg.type === 'themeChange') {
      loadInitialTheme(msg.theme);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
