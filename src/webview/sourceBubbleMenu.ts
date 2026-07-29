import { Editor } from '@tiptap/core';
import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';
import { PluginKey } from '@tiptap/pm/state';

const ICON = {
  bold:    `<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M185.08,114.46A48,48,0,0,0,148,36H80A12,12,0,0,0,68,48V200a12,12,0,0,0,12,12h80a52,52,0,0,0,25.08-97.54ZM92,60h56a24,24,0,0,1,0,48H92Zm68,128H92V132h68a28,28,0,0,1,0,56Z"/></svg>`,
  italic:  `<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M204,56a12,12,0,0,1-12,12H160.65l-40,120H144a12,12,0,0,1,0,24H64a12,12,0,0,1,0-24H95.35l40-120H112a12,12,0,0,1,0-24h80A12,12,0,0,1,204,56Z"/></svg>`,
  strike:  `<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M228,128a12,12,0,0,1-12,12H185.86A41.48,41.48,0,0,1,196,168c0,14.45-7.81,28.32-21.43,38.05C162,215.05,145.44,220,128,220s-34-4.95-46.57-13.95C67.81,196.32,60,182.45,60,168a12,12,0,0,1,24,0c0,15.18,20.15,28,44,28s44-12.82,44-28c0-12.76-9.3-20.18-35.35-28H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128ZM75.11,100a12,12,0,0,0,12-12c0-16,17.58-28,40.89-28,17.36,0,31.37,6.65,37.48,17.78a12,12,0,0,0,21-11.56C176.13,47.3,154.25,36,128,36,91,36,63.11,58.35,63.11,88A12,12,0,0,0,75.11,100Z"/></svg>`,
  code:    `<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M71.68,97.22,34.74,128l36.94,30.78a12,12,0,1,1-15.36,18.44l-48-40a12,12,0,0,1,0-18.44l48-40A12,12,0,0,1,71.68,97.22Zm176,21.56-48-40a12,12,0,1,0-15.36,18.44L221.26,128l-36.94,30.78a12,12,0,1,0,15.36,18.44l48-40a12,12,0,0,0,0-18.44Z"/></svg>`,
  link:    `<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M117.18,188.74a12,12,0,0,1,0,17l-5.12,5.12A58.26,58.26,0,0,1,70.6,228h0A58.62,58.62,0,0,1,29.14,127.92L63.89,93.17a58.64,58.64,0,0,1,98.56,28.11,12,12,0,1,1-23.37,5.44,34.65,34.65,0,0,0-58.22-16.58L46.11,144.89A34.62,34.62,0,0,0,70.57,204h0a34.41,34.41,0,0,0,24.49-10.14l5.11-5.12A12,12,0,0,1,117.18,188.74ZM226.83,45.17a58.65,58.65,0,0,0-82.93,0l-5.11,5.11a12,12,0,0,0,17,17l5.12-5.12a34.63,34.63,0,1,1,49,49L175.1,145.86A34.39,34.39,0,0,1,150.61,156h0a34.63,34.63,0,0,1-33.69-26.72,12,12,0,0,0-23.38,5.44A58.64,58.64,0,0,0,150.56,180h.05a58.28,58.28,0,0,0,41.47-17.17l34.75-34.75a58.62,58.62,0,0,0,0-82.91Z"/></svg>`,
  bullet:  `<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M76,64A12,12,0,0,1,88,52H216a12,12,0,0,1,0,24H88A12,12,0,0,1,76,64Zm140,52H88a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24Zm0,64H88a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24ZM44,112a16,16,0,1,0,16,16A16,16,0,0,0,44,112Zm0-64A16,16,0,1,0,60,64,16,16,0,0,0,44,48Zm0,128a16,16,0,1,0,16,16A16,16,0,0,0,44,176Z"/></svg>`,
  number:  `<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M228,128a12,12,0,0,1-12,12H116a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128ZM116,76H216a12,12,0,0,0,0-24H116a12,12,0,0,0,0,24ZM216,180H116a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24ZM44,59.31V104a12,12,0,0,0,24,0V40A12,12,0,0,0,50.64,29.27l-16,8a12,12,0,0,0,9.36,22Zm39.73,96.86a27.7,27.7,0,0,0-11.2-18.63A28.89,28.89,0,0,0,32.9,143a27.71,27.71,0,0,0-4.17,7.54,12,12,0,0,0,22.55,8.21,4,4,0,0,1,.58-1,4.78,4.78,0,0,1,6.5-.82,3.82,3.82,0,0,1,1.61,2.6,3.63,3.63,0,0,1-.77,2.77l-.13.17L30.39,200.82A12,12,0,0,0,40,220H72a12,12,0,0,0,0-24H64l14.28-19.11A27.48,27.48,0,0,0,83.73,156.17Z"/></svg>`,
  quote:   `<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M100,52H40A20,20,0,0,0,20,72v64a20,20,0,0,0,20,20H96v4a28,28,0,0,1-28,28,12,12,0,0,0,0,24,52.06,52.06,0,0,0,52-52V72A20,20,0,0,0,100,52Zm-4,80H44V76H96ZM216,52H156a20,20,0,0,0-20,20v64a20,20,0,0,0,20,20h56v4a28,28,0,0,1-28,28,12,12,0,0,0,0,24,52.06,52.06,0,0,0,52-52V72A20,20,0,0,0,216,52Zm-4,80H160V76h52Z"/></svg>`,
};

const CB_TEXT_START = 1; // doc → codeBlock(start at 0, content starts at 1)

interface SelectionInfo {
  text: string;
  from: number;
  to: number;
  fullText: string;
  fOff: number;
  tOff: number;
}

function getSelection(editor: Editor): SelectionInfo | null {
  const { from, to } = editor.state.selection;
  const cb = editor.state.doc.firstChild;
  if (!cb || cb.type.name !== 'codeBlock') return null;
  const fullText = cb.textContent;
  const fOff = Math.max(0, from - CB_TEXT_START);
  const tOff = Math.min(fullText.length, to - CB_TEXT_START);
  return { text: fullText.slice(fOff, tOff), from, to, fullText, fOff, tOff };
}

function replaceRange(editor: Editor, from: number, to: number, text: string): void {
  editor.view.dispatch(editor.state.tr.insertText(text, from, to));
  editor.view.focus();
}

// ── Active-state checks ──────────────────────────────────────────────────────

function isWrapped(sel: SelectionInfo, prefix: string, suffix = prefix): boolean {
  // Selection text itself is wrapped: e.g., user selected "**bold**"
  if (
    sel.text.length >= prefix.length + suffix.length &&
    sel.text.startsWith(prefix) &&
    sel.text.endsWith(suffix)
  ) {
    return true;
  }
  // Selection is inside a wrap: e.g., user selected "bold" within "**bold**"
  const before = sel.fullText.slice(Math.max(0, sel.fOff - prefix.length), sel.fOff);
  const after = sel.fullText.slice(sel.tOff, sel.tOff + suffix.length);
  return before === prefix && after === suffix;
}

function isBoldActive(sel: SelectionInfo): boolean {
  return isWrapped(sel, '**');
}

function isItalicActive(sel: SelectionInfo): boolean {
  // Match a single * that is not part of a `**` pair.
  // Strict: text is *foo* (not **foo**) OR neighbouring chars are single *.
  const t = sel.text;
  if (t.length >= 2 && t.startsWith('*') && t.endsWith('*') && !t.startsWith('**') && !t.endsWith('**')) {
    return true;
  }
  const cb = sel.fullText;
  const charBefore  = cb[sel.fOff - 1];
  const charBefore2 = cb[sel.fOff - 2];
  const charAfter   = cb[sel.tOff];
  const charAfter2  = cb[sel.tOff + 1];
  return charBefore === '*' && charBefore2 !== '*' && charAfter === '*' && charAfter2 !== '*';
}

function isStrikeActive(sel: SelectionInfo): boolean {
  return isWrapped(sel, '~~');
}

function isCodeActive(sel: SelectionInfo): boolean {
  return isWrapped(sel, '`');
}

function selectionLineRange(sel: SelectionInfo): { firstStart: number; lastEnd: number } {
  const text = sel.fullText;
  let firstStart = sel.fOff;
  let lastEnd = sel.tOff;
  while (firstStart > 0 && text[firstStart - 1] !== '\n') firstStart--;
  while (lastEnd < text.length && text[lastEnd] !== '\n') lastEnd++;
  return { firstStart, lastEnd };
}

function allLinesMatch(sel: SelectionInfo, re: RegExp): boolean {
  const { firstStart, lastEnd } = selectionLineRange(sel);
  const lines = sel.fullText.slice(firstStart, lastEnd).split('\n');
  return lines.length > 0 && lines.every((l) => re.test(l));
}

// ── Toggle actions ───────────────────────────────────────────────────────────

function toggleWrap(editor: Editor, prefix: string, suffix = prefix): void {
  const sel = getSelection(editor);
  if (!sel) return;
  const { text, from, to } = sel;
  // Unwrap if selection itself contains the markers
  if (
    text.length >= prefix.length + suffix.length &&
    text.startsWith(prefix) &&
    text.endsWith(suffix)
  ) {
    replaceRange(editor, from, to, text.slice(prefix.length, text.length - suffix.length));
    return;
  }
  // Unwrap if selection is *inside* a wrap — extend the range and drop the markers
  const before = sel.fullText.slice(Math.max(0, sel.fOff - prefix.length), sel.fOff);
  const after = sel.fullText.slice(sel.tOff, sel.tOff + suffix.length);
  if (before === prefix && after === suffix) {
    replaceRange(editor, from - prefix.length, to + suffix.length, text);
    return;
  }
  // Otherwise, wrap.
  replaceRange(editor, from, to, prefix + text + suffix);
}

function transformLines(editor: Editor, transformer: (line: string, idx: number) => string): void {
  const sel = getSelection(editor);
  if (!sel) return;
  if (sel.fullText.length === 0) return;
  const { firstStart, lastEnd } = selectionLineRange(sel);
  const lines = sel.fullText.slice(firstStart, lastEnd).split('\n');
  const out = lines.map(transformer).join('\n');
  replaceRange(editor, CB_TEXT_START + firstStart, CB_TEXT_START + lastEnd, out);
}

const stripHeading = (l: string): string => l.replace(/^\s*#{1,6}\s+/, '');
const stripList    = (l: string): string => l.replace(/^\s*([-*+]|\d+\.)\s+/, '');
const stripQuote   = (l: string): string => l.replace(/^\s*>\s?/, '');
const stripAll     = (l: string): string => stripQuote(stripList(stripHeading(l)));

// ── UI ───────────────────────────────────────────────────────────────────────

interface BtnSpec {
  el: HTMLButtonElement;
  isActive: (sel: SelectionInfo) => boolean;
}

function makeBtn(
  html: string,
  tip: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bm-btn';
  btn.innerHTML = html;
  btn.dataset.tip = tip;
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function makeDivider(): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'bm-div';
  return d;
}

export function createSourceBubbleMenu(editor: Editor): void {
  const el = document.createElement('div');
  el.className = 'bubble-menu source-bubble';

  const row = document.createElement('div');
  row.className = 'bubble-row';

  // Inline URL input that replaces the button row in place. window.prompt is
  // silently no-op'd in some VS Code webviews, so we render the input ourselves.
  const linkRow = document.createElement('div');
  linkRow.className = 'bubble-row bm-link-row';
  linkRow.style.display = 'none';
  const linkInput = document.createElement('input');
  linkInput.type = 'text';
  linkInput.placeholder = 'Paste URL and press Enter';
  linkInput.className = 'bm-link-row-input';
  const linkApply = document.createElement('button');
  linkApply.type = 'button';
  linkApply.className = 'bm-btn bm-link-row-apply';
  linkApply.textContent = 'Apply';
  const linkCancel = document.createElement('button');
  linkCancel.type = 'button';
  linkCancel.className = 'bm-btn bm-link-row-cancel';
  linkCancel.textContent = '✕';
  linkRow.append(linkInput, linkApply, linkCancel);

  let savedSel: { from: number; to: number; text: string } | null = null;

  function openLinkRow(): void {
    const sel = getSelection(editor);
    if (!sel) return;
    savedSel = { from: sel.from, to: sel.to, text: sel.text };
    const existing = sel.text.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
    linkInput.value = existing ? existing[2] : '';
    row.style.display = 'none';
    linkRow.style.display = 'flex';
    setTimeout(() => { linkInput.focus(); linkInput.select(); }, 0);
  }

  function closeLinkRow(): void {
    linkRow.style.display = 'none';
    row.style.display = '';
    savedSel = null;
  }

  function applyLinkRow(): void {
    if (!savedSel) return closeLinkRow();
    const url = linkInput.value.trim();
    if (!url) return closeLinkRow();
    const inner = savedSel.text.match(/^\[([^\]]*)\]\([^)]+\)$/);
    const labelText = inner ? inner[1] : (savedSel.text || 'link');
    replaceRange(editor, savedSel.from, savedSel.to, `[${labelText}](${url})`);
    closeLinkRow();
  }

  linkApply.addEventListener('mousedown', (e) => { e.preventDefault(); applyLinkRow(); }, true);
  linkCancel.addEventListener('mousedown', (e) => { e.preventDefault(); closeLinkRow(); }, true);
  linkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyLinkRow(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeLinkRow(); }
  });
  // Document-level capture-phase listener — most aggressive way to catch the
  // mousedown before any focus/blur dance can swallow it.
  document.addEventListener('mousedown', (e) => {
    const t = e.target as HTMLElement;
    if (!t?.closest) return;
    if (t.closest('.source-bubble .bm-btn[data-action="link"]')) {
      e.preventDefault();
      e.stopPropagation();
      openLinkRow();
    }
  }, true);

  const buttons: BtnSpec[] = [];
  const reg = (el: HTMLButtonElement, isActive: BtnSpec['isActive']): HTMLButtonElement => {
    buttons.push({ el, isActive });
    return el;
  };

  // Inline wraps
  row.appendChild(reg(
    makeBtn(ICON.bold,   'Bold (**…**)',          () => toggleWrap(editor, '**')),
    isBoldActive,
  ));
  row.appendChild(reg(
    makeBtn(ICON.italic, 'Italic (*…*)',          () => toggleWrap(editor, '*')),
    isItalicActive,
  ));
  row.appendChild(reg(
    makeBtn(ICON.strike, 'Strikethrough (~~…~~)', () => toggleWrap(editor, '~~')),
    isStrikeActive,
  ));
  row.appendChild(reg(
    makeBtn(ICON.code,   'Inline code (`…`)',     () => toggleWrap(editor, '`')),
    isCodeActive,
  ));
  // Link button uses event delegation (mirroring the main bubble menu pattern
  // that's known to work in VS Code webviews). The makeBtn handler on its own
  // didn't fire reliably for this specific button.
  const linkBtn = makeBtn(ICON.link, 'Link [text](url)', () => {});
  linkBtn.dataset.action = 'link';
  row.appendChild(reg(
    linkBtn,
    (sel) => /^\[[^\]]*\]\([^)]+\)$/.test(sel.text),
  ));

  row.appendChild(makeDivider());

  // Headings
  const setHeadingLevel = (level: 1 | 2 | 3) => () => {
    const prefix = '#'.repeat(level) + ' ';
    transformLines(editor, (line) => prefix + stripHeading(line));
  };
  row.appendChild(reg(
    makeBtn(`<span class="bm-into-text" style="font-weight:800;font-size:13px">H1</span>`, 'Heading 1 (#)',  setHeadingLevel(1)),
    (sel) => allLinesMatch(sel, /^\s*#\s+/),
  ));
  row.appendChild(reg(
    makeBtn(`<span class="bm-into-text" style="font-weight:700;font-size:12px">H2</span>`, 'Heading 2 (##)', setHeadingLevel(2)),
    (sel) => allLinesMatch(sel, /^\s*##\s+/),
  ));
  row.appendChild(reg(
    makeBtn(`<span class="bm-into-text" style="font-weight:600;font-size:11px">H3</span>`, 'Heading 3 (###)',setHeadingLevel(3)),
    (sel) => allLinesMatch(sel, /^\s*###\s+/),
  ));

  row.appendChild(makeDivider());

  // Lists / quote
  row.appendChild(reg(
    makeBtn(ICON.bullet, 'Bullet list (- )', () => {
      transformLines(editor, (line) => '- ' + stripAll(line));
    }),
    (sel) => allLinesMatch(sel, /^\s*[-*+]\s+/),
  ));
  row.appendChild(reg(
    makeBtn(ICON.number, 'Numbered list (1. )', () => {
      let i = 0;
      transformLines(editor, (line) => `${++i}. ` + stripAll(line));
    }),
    (sel) => allLinesMatch(sel, /^\s*\d+\.\s+/),
  ));
  row.appendChild(reg(
    makeBtn(ICON.quote, 'Quote (> )', () => {
      transformLines(editor, (line) => '> ' + stripQuote(line));
    }),
    (sel) => allLinesMatch(sel, /^\s*>\s?/),
  ));

  el.appendChild(row);
  el.appendChild(linkRow);

  function refreshActive(): void {
    const sel = getSelection(editor);
    if (!sel) {
      buttons.forEach((b) => b.el.classList.remove('active'));
      return;
    }
    for (const b of buttons) {
      b.el.classList.toggle('active', b.isActive(sel));
    }
  }

  editor.on('selectionUpdate', refreshActive);
  editor.on('update', refreshActive);

  editor.registerPlugin(BubbleMenuPlugin({
    pluginKey: new PluginKey('sourceBubbleMenu'),
    editor,
    element: el,
    shouldShow: ({ state }) => {
      // Keep the menu visible while the inline URL input is shown, even if
      // focus has moved to the input (selection in editor stays intact).
      if (linkRow.style.display !== 'none') return true;
      const { from, to } = state.selection;
      return from !== to;
    },
    // `options` is not a BubbleMenuPlugin prop — tippy settings go under
    // `tippyOptions`, so this 8px offset was silently ignored (and tripped a
    // type error). Tippy's offset is [skidding, distance].
    tippyOptions: { offset: [0, 8] },
  }));
}
